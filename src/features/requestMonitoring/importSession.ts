import {
  isMonitoringImportSessionsUnavailable,
  isMonitoringImportSessionNotFound,
  requestMonitoringApi,
  type MonitoringImportResult,
  type MonitoringImportSession,
  type MonitoringImportSessionStatus,
} from '@/services/api/requestMonitoring';
import type { ApiError } from '@/types/api';

const STORAGE_KEY = 'xfproxyapi:monitoring-import-sessions:v1';
const DEFAULT_POLL_INTERVAL_MS = 500;
const RESUME_KEY_PATTERN = /^[0-9a-f]{32}$/;

export type MonitoringImportPhase =
  'preparing' | 'uploading' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface MonitoringImportProgress {
  sessionId: string;
  filename: string;
  phase: MonitoringImportPhase;
  status?: MonitoringImportSessionStatus;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  retryable?: boolean;
  error?: string;
  result?: MonitoringImportResult;
}

export type MonitoringImportSessionClient = Pick<
  typeof requestMonitoringApi,
  | 'createImportSession'
  | 'getImportSession'
  | 'uploadImportSessionChunk'
  | 'completeImportSession'
  | 'cancelImportSession'
>;

export interface MonitoringImportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredMonitoringImportSession {
  sessionId: string;
  resumeKey: string;
}

export interface UploadMonitoringImportFileOptions {
  scope: string;
  file: File;
  signal?: AbortSignal;
  onProgress?: (progress: MonitoringImportProgress) => void;
  pollIntervalMs?: number;
  client?: MonitoringImportSessionClient;
  storage?: MonitoringImportStorage | null;
}

export interface CancelMonitoringImportFileOptions {
  scope: string;
  sessionId: string;
  file?: File;
  client?: MonitoringImportSessionClient;
  storage?: MonitoringImportStorage | null;
}

export class MonitoringImportPausedError extends Error {
  constructor() {
    super('monitoring import paused');
    this.name = 'MonitoringImportPausedError';
  }
}

export class MonitoringImportCancelledError extends Error {
  constructor() {
    super('monitoring import cancelled');
    this.name = 'MonitoringImportCancelledError';
  }
}

export class MonitoringImportFailedError extends Error {
  readonly sessionId: string;
  readonly retryable: boolean;

  constructor(session: MonitoringImportSession) {
    super(session.error || 'monitoring import failed');
    this.name = 'MonitoringImportFailedError';
    this.sessionId = session.id;
    this.retryable = session.retryable;
  }
}

export const isMonitoringImportPausedError = (
  error: unknown
): error is MonitoringImportPausedError => error instanceof MonitoringImportPausedError;

export const isMonitoringImportCancelledError = (
  error: unknown
): error is MonitoringImportCancelledError => error instanceof MonitoringImportCancelledError;

export async function uploadMonitoringImportFile(
  options: UploadMonitoringImportFileOptions
): Promise<MonitoringImportResult> {
  const client = options.client ?? requestMonitoringApi;
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  let session: MonitoringImportSession | null = null;

  const emit = (
    phase: MonitoringImportPhase,
    current = session,
    error = '',
    retryable = current?.retryable
  ) => {
    const uploadedBytes = current?.receivedBytes ?? 0;
    const totalBytes = current?.sizeBytes ?? options.file.size;
    options.onProgress?.({
      sessionId: current?.id ?? '',
      filename: options.file.name,
      phase,
      status: current?.status,
      uploadedBytes,
      totalBytes,
      percent:
        totalBytes > 0
          ? uploadedBytes >= totalBytes
            ? 100
            : Math.max(0, Math.floor((uploadedBytes / totalBytes) * 100))
          : 0,
      retryable,
      error: error || current?.error || undefined,
      result: current?.result ?? undefined,
    });
  };

  try {
    throwIfPaused(options.signal);
    emit('preparing');
    session = await resolveOrCreateSession({ ...options, client, storage });
    emit(resolvePhase(session));

    for (;;) {
      throwIfPaused(options.signal);
      switch (session.status) {
        case 'receiving': {
          validateReceivingSession(session, options.file);
          if (session.receivedBytes === session.sizeBytes) {
            session = await completeAndReconcile(client, session, options.signal);
            emit(resolvePhase(session));
            break;
          }
          const offset = session.receivedBytes;
          const end = Math.min(options.file.size, offset + session.chunkSizeBytes);
          const next = await client.uploadImportSessionChunk(
            session.id,
            offset,
            options.file.slice(offset, end),
            options.signal
          );
          if (next.receivedBytes <= offset || next.receivedBytes > end) {
            throw new Error('monitoring import session did not advance by the uploaded chunk');
          }
          session = next;
          storeSession(storage, options.scope, options.file, session.id);
          emit('uploading');
          break;
        }
        case 'processing':
          emit('processing');
          await abortableDelay(pollIntervalMs, options.signal);
          session = await client.getImportSession(session.id, options.signal);
          emit(resolvePhase(session));
          break;
        case 'completed':
          if (!session.result) {
            throw new Error('monitoring import completed without a result');
          }
          clearStoredSession(storage, options.scope, options.file, session.id);
          emit('completed');
          return session.result;
        case 'failed':
          if (!session.retryable) {
            clearStoredSession(storage, options.scope, options.file, session.id);
          }
          emit('failed');
          throw new MonitoringImportFailedError(session);
        case 'cancelled':
          clearStoredSession(storage, options.scope, options.file, session.id);
          emit('cancelled');
          throw new MonitoringImportCancelledError();
      }
    }
  } catch (error: unknown) {
    if (options.signal?.aborted) {
      emit('paused');
      throw new MonitoringImportPausedError();
    }
    if (
      !(error instanceof MonitoringImportFailedError) &&
      !(error instanceof MonitoringImportCancelledError)
    ) {
      const code = (error as ApiError | null)?.code;
      const rejectedBeforeCreate =
        !session && (code === 'invalid_request' || code === 'too_large' || code === 'conflict');
      if (rejectedBeforeCreate || (!session && isMonitoringImportSessionsUnavailable(error))) {
        clearStoredSession(storage, options.scope, options.file, '');
      }
      emit(
        'failed',
        session,
        error instanceof Error ? error.message : String(error),
        rejectedBeforeCreate ? false : (session?.retryable ?? true)
      );
    }
    throw error;
  }
}

export async function cancelMonitoringImportFile(
  options: CancelMonitoringImportFileOptions
): Promise<MonitoringImportSession | null> {
  const client = options.client ?? requestMonitoringApi;
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  let session: MonitoringImportSession | null;
  try {
    session = await client.cancelImportSession(options.sessionId);
  } catch (error: unknown) {
    if (!isMonitoringImportSessionNotFound(error)) throw error;
    session = null;
  }
  if (options.file) {
    clearStoredSession(storage, options.scope, options.file, options.sessionId);
  } else {
    clearStoredSessionByID(storage, options.sessionId);
  }
  return session;
}

async function completeAndReconcile(
  client: MonitoringImportSessionClient,
  session: MonitoringImportSession,
  signal?: AbortSignal
): Promise<MonitoringImportSession> {
  try {
    return await client.completeImportSession(session.id, signal);
  } catch (error: unknown) {
    throwIfPaused(signal);
    try {
      const current = await client.getImportSession(session.id, signal);
      if (current.status !== 'receiving') return current;
    } catch (readError: unknown) {
      if (!isMonitoringImportSessionNotFound(readError)) throw error;
    }
    throw error;
  }
}

async function resolveOrCreateSession(
  options: UploadMonitoringImportFileOptions & {
    client: MonitoringImportSessionClient;
    storage: MonitoringImportStorage | null;
  }
): Promise<MonitoringImportSession> {
  const stored = readStoredSession(options.storage, options.scope, options.file);
  let resumeKey = stored?.resumeKey ?? '';
  if (stored?.sessionId) {
    try {
      const current = await options.client.getImportSession(stored.sessionId, options.signal);
      if (
        current.sizeBytes === options.file.size &&
        current.status !== 'cancelled' &&
        !(current.status === 'failed' && !current.retryable)
      ) {
        return current;
      }
      clearStoredSession(options.storage, options.scope, options.file, current.id);
      resumeKey = '';
    } catch (error: unknown) {
      if (!isMonitoringImportSessionNotFound(error)) throw error;
      clearStoredSession(options.storage, options.scope, options.file, stored.sessionId);
    }
  }

  if (!RESUME_KEY_PATTERN.test(resumeKey)) {
    resumeKey = createResumeKey();
  }
  storeSession(options.storage, options.scope, options.file, '', resumeKey);
  const created = await options.client.createImportSession(
    options.file.name,
    options.file.size,
    resumeKey,
    options.signal
  );
  if (created.sizeBytes !== options.file.size) {
    throw new Error('monitoring import session size does not match the selected file');
  }
  storeSession(options.storage, options.scope, options.file, created.id, resumeKey);
  return created;
}

function validateReceivingSession(session: MonitoringImportSession, file: File) {
  if (
    session.sizeBytes !== file.size ||
    session.receivedBytes < 0 ||
    session.receivedBytes > file.size ||
    session.chunkSizeBytes <= 0
  ) {
    throw new Error('monitoring import session upload state is invalid');
  }
}

function resolvePhase(session: MonitoringImportSession): MonitoringImportPhase {
  switch (session.status) {
    case 'processing':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'receiving':
      return 'uploading';
  }
}

function throwIfPaused(signal?: AbortSignal) {
  if (signal?.aborted) throw new MonitoringImportPausedError();
}

function abortableDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) {
    throwIfPaused(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new MonitoringImportPausedError());
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveStorage(): MonitoringImportStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function sessionFingerprint(scope: string, file: File): string {
  return JSON.stringify([scope.replace(/\/+$/, ''), file.name, file.size, file.lastModified]);
}

function readStoredSessions(
  storage: MonitoringImportStorage | null
): Record<string, StoredMonitoringImportSession> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const sessions: Record<string, StoredMonitoringImportSession> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const record = entry as Record<string, unknown>;
      const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
      const resumeKey = typeof record.resumeKey === 'string' ? record.resumeKey : '';
      if (sessionId || RESUME_KEY_PATTERN.test(resumeKey)) {
        sessions[key] = { sessionId, resumeKey };
      }
    });
    return sessions;
  } catch {
    return {};
  }
}

function writeStoredSessions(
  storage: MonitoringImportStorage | null,
  sessions: Record<string, StoredMonitoringImportSession>
) {
  if (!storage) return;
  try {
    if (Object.keys(sessions).length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    return;
  }
}

function readStoredSession(
  storage: MonitoringImportStorage | null,
  scope: string,
  file: File
): StoredMonitoringImportSession | null {
  return readStoredSessions(storage)[sessionFingerprint(scope, file)] ?? null;
}

function storeSession(
  storage: MonitoringImportStorage | null,
  scope: string,
  file: File,
  sessionId: string,
  resumeKey?: string
) {
  const sessions = readStoredSessions(storage);
  const key = sessionFingerprint(scope, file);
  sessions[key] = {
    sessionId,
    resumeKey: resumeKey ?? sessions[key]?.resumeKey ?? '',
  };
  writeStoredSessions(storage, sessions);
}

function clearStoredSession(
  storage: MonitoringImportStorage | null,
  scope: string,
  file: File,
  expectedSessionId: string
) {
  const sessions = readStoredSessions(storage);
  const key = sessionFingerprint(scope, file);
  if (sessions[key]?.sessionId !== expectedSessionId) return;
  delete sessions[key];
  writeStoredSessions(storage, sessions);
}

function clearStoredSessionByID(storage: MonitoringImportStorage | null, sessionId: string) {
  const sessions = readStoredSessions(storage);
  let changed = false;
  Object.entries(sessions).forEach(([key, value]) => {
    if (value.sessionId !== sessionId) return;
    delete sessions[key];
    changed = true;
  });
  if (changed) writeStoredSessions(storage, sessions);
}

function createResumeKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}
