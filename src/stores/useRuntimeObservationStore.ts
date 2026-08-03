import { create } from 'zustand';
import { runtimeObservationsApi, normalizeRuntimeObservationEvent } from '@/services/api/runtimeObservations';
import type {
  RuntimeObservationEvent,
  RuntimeObservationQueue,
  RuntimeObservationResource,
  RuntimeObservationScope,
  RuntimeObservationSnapshot,
} from '@/types/runtimeObservation';
import { useAuthStore } from './useAuthStore';

export type RuntimeObservationPhase =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'polling'
  | 'paused';

type RuntimeObservationState = {
  observationId: string;
  revision: number;
  observedAt: string;
  resourcesByKey: Record<string, RuntimeObservationResource>;
  credentialsByAuthIndex: Record<string, RuntimeObservationResource>;
  queue: RuntimeObservationQueue;
  truncated: boolean;
  phase: RuntimeObservationPhase;
  error: string;
  refresh: () => Promise<void>;
  start: () => void;
  stop: (clear?: boolean) => void;
};

const FALLBACK_POLL_INTERVAL_MS = 5_000;
const MAX_RETRY_INTERVAL_MS = 30_000;
const SNAPSHOT_COALESCE_MS = 50;

const emptyQueue = (): RuntimeObservationQueue => ({ waiting: 0, maximum: 0, closed: false });

export const runtimeObservationResourceKey = (
  scope: RuntimeObservationScope,
  id: string
): string => `${scope}:${id.trim()}`;

export const indexRuntimeObservationResources = (
  resources: RuntimeObservationResource[]
): Record<string, RuntimeObservationResource> => {
  const indexed: Record<string, RuntimeObservationResource> = {};
  resources.forEach((resource) => {
    if (!resource.id) return;
    indexed[runtimeObservationResourceKey(resource.scope, resource.id)] = resource;
  });
  return indexed;
};

export const indexRuntimeObservationCredentialsByAuthIndex = (
  resources: RuntimeObservationResource[]
): Record<string, RuntimeObservationResource> => {
  const indexed: Record<string, RuntimeObservationResource> = {};
  resources.forEach((resource) => {
    const authIndex = resource.authIndex.trim();
    if (resource.scope === 'credential' && authIndex) indexed[authIndex] = resource;
  });
  return indexed;
};

export const runtimeObservationShouldBeActive = (
  visibilityState: string,
  connectionStatus: string,
  apiBase: string,
  managementKey: string
): boolean =>
  visibilityState !== 'hidden' &&
  connectionStatus === 'connected' &&
  Boolean(apiBase.trim()) &&
  Boolean(managementKey.trim());

export const nextRuntimeObservationRetryDelay = (current: number): number => {
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

const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
  if (timer !== null) clearTimeout(timer);
};

const clearRuntimeTasks = () => {
  lifecycleGeneration++;
  streamAbort?.abort();
  streamAbort = null;
  snapshotAbort?.abort();
  snapshotAbort = null;
  snapshotRequest = null;
  clearTimer(reconnectTimer);
  clearTimer(pollTimer);
  clearTimer(snapshotTimer);
  reconnectTimer = null;
  pollTimer = null;
  snapshotTimer = null;
};

const parseRuntimeObservationEventBlock = (block: string): RuntimeObservationEvent | null => {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return normalizeRuntimeObservationEvent(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
};

const consumeRuntimeObservationStream = async (
  response: Response,
  signal: AbortSignal,
  onEvent: (event: RuntimeObservationEvent) => void
) => {
  if (!response.body) throw new Error('Runtime observation event stream is unavailable');
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
      const event = parseRuntimeObservationEventBlock(block);
      if (event) onEvent(event);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (!signal.aborted) throw new Error('Runtime observation event stream closed');
};

export const applyRuntimeObservationSnapshot = (snapshot: RuntimeObservationSnapshot) => {
  useRuntimeObservationStore.setState({
    observationId: snapshot.observationId,
    revision: snapshot.revision,
    observedAt: snapshot.observedAt,
    resourcesByKey: indexRuntimeObservationResources(snapshot.resources),
    credentialsByAuthIndex: indexRuntimeObservationCredentialsByAuthIndex(snapshot.resources),
    queue: snapshot.queue,
    truncated: snapshot.truncated,
    error: '',
  });
};

const scheduleSnapshotRefresh = () => {
  if (snapshotTimer !== null || !started || currentVisibilityState() === 'hidden') return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void useRuntimeObservationStore
      .getState()
      .refresh()
      .catch(() => undefined);
  }, SNAPSHOT_COALESCE_MS);
};

const scheduleFallbackPoll = (generation: number, delay = pollDelay) => {
  if (!started || generation !== lifecycleGeneration || pollTimer !== null) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    if (!started || generation !== lifecycleGeneration || currentVisibilityState() === 'hidden') {
      return;
    }
    void useRuntimeObservationStore
      .getState()
      .refresh()
      .then(() => {
        pollDelay = FALLBACK_POLL_INTERVAL_MS;
      })
      .catch(() => {
        pollDelay = nextRuntimeObservationRetryDelay(pollDelay);
      })
      .finally(() => scheduleFallbackPoll(generation));
  }, Math.max(0, delay));
};

const scheduleStreamReconnect = (generation: number) => {
  if (!started || generation !== lifecycleGeneration || reconnectTimer !== null) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RETRY_INTERVAL_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectRuntimeObservationStream(generation);
  }, delay);
};

const connectRuntimeObservationStream = async (generation: number) => {
  if (!started || generation !== lifecycleGeneration) return;
  const auth = useAuthStore.getState();
  if (
    !runtimeObservationShouldBeActive(
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
  const state = useRuntimeObservationStore.getState();
  try {
    const response = await runtimeObservationsApi.events({
      apiBase: auth.apiBase,
      managementKey: auth.managementKey,
      signal: controller.signal,
      observationId: state.observationId,
      revision: state.revision,
    });
    if (!started || generation !== lifecycleGeneration || controller.signal.aborted) return;
    clearTimer(pollTimer);
    pollTimer = null;
    reconnectDelay = 2_000;
    pollDelay = FALLBACK_POLL_INTERVAL_MS;
    useRuntimeObservationStore.setState({ phase: 'live', error: '' });
    await consumeRuntimeObservationStream(response, controller.signal, (event) => {
      const current = useRuntimeObservationStore.getState();
      if (
        event.observationId !== current.observationId ||
        event.revision > current.revision
      ) {
        scheduleSnapshotRefresh();
      }
    });
  } catch (error) {
    if (controller.signal.aborted || generation !== lifecycleGeneration || !started) return;
    useRuntimeObservationStore.setState({
      phase: 'polling',
      error: error instanceof Error ? error.message : 'Runtime observation stream failed',
    });
    scheduleFallbackPoll(generation, 0);
    scheduleStreamReconnect(generation);
  } finally {
    if (streamAbort === controller) streamAbort = null;
  }
};

const activateRuntimeObservation = () => {
  if (!started) return;
  const auth = useAuthStore.getState();
  if (
    !runtimeObservationShouldBeActive(
      currentVisibilityState(),
      auth.connectionStatus,
      auth.apiBase,
      auth.managementKey
    )
  ) {
    clearRuntimeTasks();
    useRuntimeObservationStore.setState({ phase: 'paused' });
    return;
  }
  clearRuntimeTasks();
  const generation = lifecycleGeneration;
  reconnectDelay = 2_000;
  pollDelay = FALLBACK_POLL_INTERVAL_MS;
  useRuntimeObservationStore.setState({ phase: 'connecting' });
  void useRuntimeObservationStore
    .getState()
    .refresh()
    .catch(() => undefined)
    .finally(() => void connectRuntimeObservationStream(generation));
};

const handleVisibilityChange = () => {
  if (currentVisibilityState() === 'hidden') {
    clearRuntimeTasks();
    useRuntimeObservationStore.setState({ phase: 'paused' });
    return;
  }
  activateRuntimeObservation();
};

const handleWindowFocus = () => {
  if (!started || currentVisibilityState() === 'hidden') return;
  if (useRuntimeObservationStore.getState().phase !== 'live') {
    activateRuntimeObservation();
    return;
  }
  void useRuntimeObservationStore
    .getState()
    .refresh()
    .catch(() => undefined);
};

export const useRuntimeObservationStore = create<RuntimeObservationState>((set) => ({
  observationId: '',
  revision: 0,
  observedAt: '',
  resourcesByKey: {},
  credentialsByAuthIndex: {},
  queue: emptyQueue(),
  truncated: false,
  phase: 'idle',
  error: '',

  refresh: async () => {
    if (snapshotRequest) return snapshotRequest;
    const auth = useAuthStore.getState();
    if (!auth.apiBase || !auth.managementKey || auth.connectionStatus !== 'connected') return;
    const requestGeneration = lifecycleGeneration;
    const controller = new AbortController();
    snapshotAbort = controller;
    const request = runtimeObservationsApi
      .snapshot({
        apiBase: auth.apiBase,
        managementKey: auth.managementKey,
        signal: controller.signal,
        etag,
      })
      .then((result) => {
        if (controller.signal.aborted || requestGeneration !== lifecycleGeneration) return;
        etag = result.etag || etag;
        if (result.snapshot) applyRuntimeObservationSnapshot(result.snapshot);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (requestGeneration === lifecycleGeneration) {
          set({
            error: error instanceof Error ? error.message : 'Runtime observation refresh failed',
          });
        }
        throw error;
      })
      .finally(() => {
        if (snapshotAbort === controller) snapshotAbort = null;
        if (snapshotRequest === request) snapshotRequest = null;
      });
    snapshotRequest = request;
    return request;
  },

  start: () => {
    if (started) return;
    started = true;
    if (typeof window !== 'undefined') window.addEventListener('focus', handleWindowFocus);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    activateRuntimeObservation();
  },

  stop: (clear = false) => {
    if (typeof window !== 'undefined') window.removeEventListener('focus', handleWindowFocus);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    started = false;
    clearRuntimeTasks();
    if (clear) {
      etag = '';
      reconnectDelay = 2_000;
      pollDelay = FALLBACK_POLL_INTERVAL_MS;
      set({
        observationId: '',
        revision: 0,
        observedAt: '',
        resourcesByKey: {},
        credentialsByAuthIndex: {},
        queue: emptyQueue(),
        truncated: false,
        phase: 'idle',
        error: '',
      });
    } else {
      set({ phase: 'idle' });
    }
  },
}));
