import { create } from 'zustand';
import {
  normalizeSupplierBillingProbeEvent,
  supplierBillingProbeApi,
  type SupplierBillingProbeEntry,
  type SupplierBillingProbeEvent,
  type SupplierBillingProbeResponse,
} from '@/services/api/supplierBillingProbe';
import { useAuthStore } from './useAuthStore';

export type SupplierBillingProbePhase = 'idle' | 'connecting' | 'live' | 'polling' | 'paused';

type SupplierBillingProbeState = {
  snapshotId: string;
  revision: number;
  serverTime: string;
  entries: SupplierBillingProbeEntry[];
  entriesByTarget: Record<string, SupplierBillingProbeEntry>;
  phase: SupplierBillingProbePhase;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  refreshTarget: (targetId: string) => Promise<void>;
  start: () => void;
  stop: (clear?: boolean) => void;
};

const FALLBACK_POLL_INTERVAL_MS = 5_000;
const MAX_RETRY_INTERVAL_MS = 30_000;
const SNAPSHOT_COALESCE_MS = 50;

export const indexSupplierBillingProbeEntries = (
  entries: readonly SupplierBillingProbeEntry[]
): Record<string, SupplierBillingProbeEntry> =>
  Object.fromEntries(entries.map((entry) => [entry.target_id, entry]));

export function mergeSupplierBillingProbeReadEntries(
  currentEntries: readonly SupplierBillingProbeEntry[],
  nextEntries: readonly SupplierBillingProbeEntry[],
  targetVersionsAtStart: ReadonlyMap<string, number>,
  currentTargetVersions: ReadonlyMap<string, number>
): SupplierBillingProbeEntry[] {
  const currentByTarget = new Map(currentEntries.map((entry) => [entry.target_id, entry]));
  const nextTargetIds = new Set(nextEntries.map((entry) => entry.target_id));
  const mergedEntries = nextEntries.map((entry) => {
    const startVersion = targetVersionsAtStart.get(entry.target_id) ?? 0;
    const currentVersion = currentTargetVersions.get(entry.target_id) ?? 0;
    return currentVersion === startVersion
      ? entry
      : (currentByTarget.get(entry.target_id) ?? entry);
  });

  currentEntries.forEach((entry) => {
    if (nextTargetIds.has(entry.target_id)) return;
    const startVersion = targetVersionsAtStart.get(entry.target_id) ?? 0;
    const currentVersion = currentTargetVersions.get(entry.target_id) ?? 0;
    if (currentVersion !== startVersion) mergedEntries.push(entry);
  });

  return mergedEntries;
}

export const supplierBillingProbeReadHasConflict = (
  currentEntries: readonly SupplierBillingProbeEntry[],
  nextEntries: readonly SupplierBillingProbeEntry[],
  targetVersionsAtStart: ReadonlyMap<string, number>,
  currentTargetVersions: ReadonlyMap<string, number>
): boolean => {
  const targetIds = new Set([
    ...currentEntries.map((entry) => entry.target_id),
    ...nextEntries.map((entry) => entry.target_id),
  ]);
  return Array.from(targetIds).some(
    (targetId) =>
      (targetVersionsAtStart.get(targetId) ?? 0) !== (currentTargetVersions.get(targetId) ?? 0)
  );
};

export const supplierBillingProbeShouldBeActive = (
  visibilityState: string,
  connectionStatus: string,
  apiBase: string,
  managementKey: string
): boolean =>
  visibilityState !== 'hidden' &&
  connectionStatus === 'connected' &&
  Boolean(apiBase.trim()) &&
  Boolean(managementKey.trim());

export const nextSupplierBillingProbeRetryDelay = (current: number): number => {
  if (!Number.isFinite(current) || current < FALLBACK_POLL_INTERVAL_MS) {
    return FALLBACK_POLL_INTERVAL_MS;
  }
  return Math.min(current * 2, MAX_RETRY_INTERVAL_MS);
};

const currentVisibilityState = (): string =>
  typeof document === 'undefined' ? 'visible' : document.visibilityState;

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

let started = false;
let lifecycleGeneration = 0;
let streamAbort: AbortController | null = null;
let snapshotAbort: AbortController | null = null;
let snapshotRequest: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let etag = '';
let reconnectDelay = 2_000;
let pollDelay = FALLBACK_POLL_INTERVAL_MS;
let requiredSnapshotId = '';
let requiredRevision = 0;
let forceFollowUpSnapshot = false;
const targetVersions = new Map<string, number>();
const targetRequests = new Map<string, Promise<void>>();
const targetAborts = new Map<string, AbortController>();

const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
  if (timer !== null) clearTimeout(timer);
};

const clearSupplierBillingTasks = () => {
  lifecycleGeneration++;
  streamAbort?.abort();
  streamAbort = null;
  snapshotAbort?.abort();
  snapshotAbort = null;
  snapshotRequest = null;
  targetAborts.forEach((controller) => controller.abort());
  targetAborts.clear();
  targetRequests.clear();
  clearTimer(reconnectTimer);
  clearTimer(pollTimer);
  clearTimer(snapshotTimer);
  reconnectTimer = null;
  pollTimer = null;
  snapshotTimer = null;
};

const bumpSupplierBillingTargetVersion = (targetId: string): number => {
  const nextVersion = (targetVersions.get(targetId) ?? 0) + 1;
  targetVersions.set(targetId, nextVersion);
  return nextVersion;
};

const setSupplierBillingEntries = (
  entries: SupplierBillingProbeEntry[],
  state: Partial<SupplierBillingProbeState> = {}
) => {
  useSupplierBillingProbeStore.setState({
    ...state,
    entries,
    entriesByTarget: indexSupplierBillingProbeEntries(entries),
  });
};

const patchSupplierBillingTarget = (
  targetId: string,
  update: (entry: SupplierBillingProbeEntry) => SupplierBillingProbeEntry
) => {
  const entries = useSupplierBillingProbeStore
    .getState()
    .entries.map((entry) => (entry.target_id === targetId ? update(entry) : entry));
  setSupplierBillingEntries(entries);
};

export const applySupplierBillingProbeSnapshot = (snapshot: SupplierBillingProbeResponse) => {
  setSupplierBillingEntries(snapshot.entries, {
    snapshotId: snapshot.snapshot_id,
    revision: snapshot.revision,
    serverTime: snapshot.server_time,
    error: '',
  });
};

const supplierBillingSnapshotIsRequired = (): boolean => {
  const state = useSupplierBillingProbeStore.getState();
  return (
    forceFollowUpSnapshot ||
    Boolean(requiredSnapshotId && requiredSnapshotId !== state.snapshotId) ||
    requiredRevision > state.revision
  );
};

const commitSupplierBillingSnapshot = (
  snapshot: SupplierBillingProbeResponse,
  nextETag: string,
  targetVersionsAtStart: ReadonlyMap<string, number>
) => {
  const current = useSupplierBillingProbeStore.getState();
  const identityChanged = Boolean(
    current.snapshotId && snapshot.snapshot_id && current.snapshotId !== snapshot.snapshot_id
  );
  if (
    !identityChanged &&
    current.snapshotId === snapshot.snapshot_id &&
    snapshot.revision < current.revision
  ) {
    return;
  }
  if (identityChanged) {
    targetAborts.forEach((controller) => controller.abort());
    targetAborts.clear();
    targetRequests.clear();
    targetVersions.clear();
  }
  const hasConflict =
    !identityChanged &&
    supplierBillingProbeReadHasConflict(
      current.entries,
      snapshot.entries,
      targetVersionsAtStart,
      targetVersions
    );
  if (hasConflict) {
    forceFollowUpSnapshot = true;
    requiredSnapshotId = snapshot.snapshot_id || requiredSnapshotId;
    requiredRevision = Math.max(requiredRevision, snapshot.revision);
    setSupplierBillingEntries(
      mergeSupplierBillingProbeReadEntries(
        current.entries,
        snapshot.entries,
        targetVersionsAtStart,
        targetVersions
      ),
      { error: '' }
    );
    return;
  }
  etag = nextETag || etag;
  forceFollowUpSnapshot = false;
  if (!requiredSnapshotId || requiredSnapshotId === snapshot.snapshot_id) {
    requiredSnapshotId = '';
    if (snapshot.revision >= requiredRevision) requiredRevision = 0;
  }
  applySupplierBillingProbeSnapshot(snapshot);
};

const parseSupplierBillingProbeEventBlock = (block: string): SupplierBillingProbeEvent | null => {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return normalizeSupplierBillingProbeEvent(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
};

const consumeSupplierBillingProbeStream = async (
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SupplierBillingProbeEvent) => void
) => {
  if (!response.body) throw new Error('Supplier billing event stream is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSupplierBillingProbeEventBlock(block);
      if (event) onEvent(event);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (!signal.aborted) throw new Error('Supplier billing event stream closed');
};

const scheduleSupplierBillingSnapshotRefresh = () => {
  if (snapshotTimer !== null || !started || currentVisibilityState() === 'hidden') return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void useSupplierBillingProbeStore
      .getState()
      .refresh()
      .catch(() => undefined);
  }, SNAPSHOT_COALESCE_MS);
};

const scheduleSupplierBillingFallbackPoll = (generation: number, delay = pollDelay) => {
  if (!started || generation !== lifecycleGeneration || pollTimer !== null) return;
  pollTimer = setTimeout(
    () => {
      pollTimer = null;
      if (
        !started ||
        generation !== lifecycleGeneration ||
        currentVisibilityState() === 'hidden' ||
        useSupplierBillingProbeStore.getState().phase !== 'polling'
      ) {
        return;
      }
      void useSupplierBillingProbeStore
        .getState()
        .refresh()
        .then(() => {
          pollDelay = FALLBACK_POLL_INTERVAL_MS;
        })
        .catch(() => {
          pollDelay = nextSupplierBillingProbeRetryDelay(pollDelay);
        })
        .finally(() => scheduleSupplierBillingFallbackPoll(generation));
    },
    Math.max(0, delay)
  );
};

const scheduleSupplierBillingStreamReconnect = (generation: number) => {
  if (!started || generation !== lifecycleGeneration || reconnectTimer !== null) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RETRY_INTERVAL_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectSupplierBillingProbeStream(generation);
  }, delay);
};

const requireSupplierBillingSnapshot = (event: SupplierBillingProbeEvent) => {
  const state = useSupplierBillingProbeStore.getState();
  if (
    !event.resync &&
    (!event.snapshot_id || event.snapshot_id === state.snapshotId) &&
    event.revision <= state.revision
  ) {
    return;
  }
  requiredSnapshotId = event.snapshot_id || requiredSnapshotId;
  requiredRevision = Math.max(requiredRevision, event.revision);
  scheduleSupplierBillingSnapshotRefresh();
};

const connectSupplierBillingProbeStream = async (generation: number) => {
  if (!started || generation !== lifecycleGeneration) return;
  const auth = useAuthStore.getState();
  if (
    !supplierBillingProbeShouldBeActive(
      currentVisibilityState(),
      auth.connectionStatus,
      auth.apiBase,
      auth.managementKey
    )
  ) {
    return;
  }

  const controller = new AbortController();
  streamAbort?.abort();
  streamAbort = controller;
  const state = useSupplierBillingProbeStore.getState();
  try {
    const response = await supplierBillingProbeApi.events({
      apiBase: auth.apiBase,
      managementKey: auth.managementKey,
      signal: controller.signal,
      snapshotId: state.snapshotId,
      revision: state.revision,
    });
    if (!started || generation !== lifecycleGeneration || controller.signal.aborted) return;
    clearTimer(pollTimer);
    pollTimer = null;
    reconnectDelay = 2_000;
    pollDelay = FALLBACK_POLL_INTERVAL_MS;
    useSupplierBillingProbeStore.setState({ phase: 'live', error: '' });
    await consumeSupplierBillingProbeStream(
      response,
      controller.signal,
      requireSupplierBillingSnapshot
    );
  } catch (error) {
    if (controller.signal.aborted || generation !== lifecycleGeneration || !started) return;
    useSupplierBillingProbeStore.setState({
      phase: 'polling',
      error: error instanceof Error ? error.message : 'Supplier billing event stream failed',
    });
    scheduleSupplierBillingFallbackPoll(generation, 0);
    scheduleSupplierBillingStreamReconnect(generation);
  } finally {
    if (streamAbort === controller) streamAbort = null;
  }
};

const activateSupplierBillingProbes = () => {
  if (!started) return;
  const auth = useAuthStore.getState();
  if (
    !supplierBillingProbeShouldBeActive(
      currentVisibilityState(),
      auth.connectionStatus,
      auth.apiBase,
      auth.managementKey
    )
  ) {
    clearSupplierBillingTasks();
    useSupplierBillingProbeStore.setState({ phase: 'paused', loading: false });
    return;
  }
  clearSupplierBillingTasks();
  const generation = lifecycleGeneration;
  reconnectDelay = 2_000;
  pollDelay = FALLBACK_POLL_INTERVAL_MS;
  useSupplierBillingProbeStore.setState({ phase: 'connecting' });
  void useSupplierBillingProbeStore
    .getState()
    .refresh()
    .catch(() => undefined)
    .finally(() => void connectSupplierBillingProbeStream(generation));
};

const handleSupplierBillingVisibilityChange = () => {
  if (currentVisibilityState() === 'hidden') {
    clearSupplierBillingTasks();
    useSupplierBillingProbeStore.setState({ phase: 'paused', loading: false });
    return;
  }
  activateSupplierBillingProbes();
};

const handleSupplierBillingWindowFocus = () => {
  if (!started || currentVisibilityState() === 'hidden') return;
  if (useSupplierBillingProbeStore.getState().phase !== 'live') {
    activateSupplierBillingProbes();
    return;
  }
  void useSupplierBillingProbeStore
    .getState()
    .refresh()
    .catch(() => undefined);
};

export const useSupplierBillingProbeStore = create<SupplierBillingProbeState>((set, get) => ({
  snapshotId: '',
  revision: 0,
  serverTime: '',
  entries: [],
  entriesByTarget: {},
  phase: 'idle',
  loading: false,
  error: '',

  refresh: async () => {
    if (snapshotRequest) return snapshotRequest;
    const auth = useAuthStore.getState();
    if (
      !supplierBillingProbeShouldBeActive(
        currentVisibilityState(),
        auth.connectionStatus,
        auth.apiBase,
        auth.managementKey
      )
    ) {
      return;
    }
    const requestGeneration = lifecycleGeneration;
    const targetVersionsAtStart = new Map(targetVersions);
    const controller = new AbortController();
    snapshotAbort = controller;
    set({ loading: true });
    const request = supplierBillingProbeApi
      .snapshot({
        apiBase: auth.apiBase,
        managementKey: auth.managementKey,
        signal: controller.signal,
        etag,
      })
      .then((result) => {
        if (controller.signal.aborted || requestGeneration !== lifecycleGeneration) return;
        if (result.snapshot) {
          commitSupplierBillingSnapshot(result.snapshot, result.etag, targetVersionsAtStart);
        } else {
          etag = result.etag || etag;
          if (supplierBillingSnapshotIsRequired()) {
            etag = '';
            forceFollowUpSnapshot = true;
          }
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (requestGeneration === lifecycleGeneration) {
          set({
            error: error instanceof Error ? error.message : 'Supplier billing refresh failed',
          });
        }
        throw error;
      })
      .finally(() => {
        if (snapshotAbort === controller) snapshotAbort = null;
        if (snapshotRequest === request) snapshotRequest = null;
        if (requestGeneration === lifecycleGeneration) {
          set({ loading: false });
          if (supplierBillingSnapshotIsRequired()) scheduleSupplierBillingSnapshotRefresh();
        }
      });
    snapshotRequest = request;
    return request;
  },

  refreshTarget: async (targetId: string) => {
    const normalizedTargetId = targetId.trim();
    if (!normalizedTargetId) return;
    const existingRequest = targetRequests.get(normalizedTargetId);
    if (existingRequest) return existingRequest;
    const auth = useAuthStore.getState();
    if (!auth.apiBase || !auth.managementKey || auth.connectionStatus !== 'connected') {
      throw new Error('Supplier billing refresh requires an active management session');
    }
    if (!get().entriesByTarget[normalizedTargetId]) {
      throw new Error('Supplier billing target is not available');
    }
    const requestGeneration = lifecycleGeneration;
    const targetVersion = bumpSupplierBillingTargetVersion(normalizedTargetId);
    patchSupplierBillingTarget(normalizedTargetId, (entry) => ({
      ...entry,
      queued: true,
    }));
    const controller = new AbortController();
    targetAborts.set(normalizedTargetId, controller);
    const request = supplierBillingProbeApi
      .enqueue({
        apiBase: auth.apiBase,
        managementKey: auth.managementKey,
        signal: controller.signal,
        targetId: normalizedTargetId,
      })
      .then((result) => {
        if (
          controller.signal.aborted ||
          requestGeneration !== lifecycleGeneration ||
          targetVersions.get(normalizedTargetId) !== targetVersion
        ) {
          return;
        }
        bumpSupplierBillingTargetVersion(normalizedTargetId);
        const current = useSupplierBillingProbeStore.getState();
        if (
          (result.snapshotId && current.snapshotId && result.snapshotId !== current.snapshotId) ||
          result.revision < current.revision
        ) {
          return;
        }
        patchSupplierBillingTarget(normalizedTargetId, () => result.entry);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (
          requestGeneration === lifecycleGeneration &&
          targetVersions.get(normalizedTargetId) === targetVersion
        ) {
          bumpSupplierBillingTargetVersion(normalizedTargetId);
          patchSupplierBillingTarget(normalizedTargetId, (entry) => ({
            ...entry,
            queued: false,
            probing: false,
          }));
          set({
            error: error instanceof Error ? error.message : 'Supplier billing refresh failed',
          });
        }
        throw error;
      })
      .finally(() => {
        if (targetAborts.get(normalizedTargetId) === controller) {
          targetAborts.delete(normalizedTargetId);
        }
        if (targetRequests.get(normalizedTargetId) === request) {
          targetRequests.delete(normalizedTargetId);
        }
      });
    targetRequests.set(normalizedTargetId, request);
    return request;
  },

  start: () => {
    if (started) return;
    started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleSupplierBillingWindowFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleSupplierBillingVisibilityChange);
    }
    activateSupplierBillingProbes();
  },

  stop: (clear = false) => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleSupplierBillingWindowFocus);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleSupplierBillingVisibilityChange);
    }
    started = false;
    clearSupplierBillingTasks();
    if (clear) {
      etag = '';
      reconnectDelay = 2_000;
      pollDelay = FALLBACK_POLL_INTERVAL_MS;
      requiredSnapshotId = '';
      requiredRevision = 0;
      forceFollowUpSnapshot = false;
      targetVersions.clear();
      set({
        snapshotId: '',
        revision: 0,
        serverTime: '',
        entries: [],
        entriesByTarget: {},
        phase: 'idle',
        loading: false,
        error: '',
      });
    } else {
      set({ phase: 'idle', loading: false });
    }
  },
}));
