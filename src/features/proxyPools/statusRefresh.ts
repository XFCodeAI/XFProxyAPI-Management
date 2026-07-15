export const PROXY_POOL_STATUS_POLL_INTERVAL_MS = 10_000;

export interface StatusSnapshotCoordinator<T> {
  refresh: () => Promise<T>;
  refreshLatest: () => Promise<T>;
  publish: (snapshot: T) => void;
  resume: () => void;
  dispose: () => void;
}

interface StatusSnapshotCoordinatorOptions<T> {
  load: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onError?: (error: unknown) => void;
}

export function createStatusSnapshotCoordinator<T>({
  load,
  onSnapshot,
  onError,
}: StatusSnapshotCoordinatorOptions<T>): StatusSnapshotCoordinator<T> {
  let activeRequest: Promise<T> | null = null;
  let queuedRequest: Promise<T> | null = null;
  let version = 0;
  let acceptedVersion = 0;
  let disposed = false;

  const startRequest = (): Promise<T> => {
    const requestVersion = ++version;
    const request = load()
      .then((snapshot) => {
        if (!disposed && requestVersion >= acceptedVersion) {
          acceptedVersion = requestVersion;
          onSnapshot(snapshot);
        }
        return snapshot;
      })
      .catch((error: unknown) => {
        if (!disposed && requestVersion >= acceptedVersion) {
          onError?.(error);
        }
        throw error;
      })
      .finally(() => {
        if (activeRequest === request) {
          activeRequest = null;
        }
      });
    activeRequest = request;
    return request;
  };

  const refresh = (): Promise<T> => activeRequest ?? startRequest();

  const refreshLatest = (): Promise<T> => {
    acceptedVersion = ++version;
    if (!activeRequest) {
      return startRequest();
    }
    if (queuedRequest) {
      return queuedRequest;
    }
    const currentRequest = activeRequest;
    const nextRequest = currentRequest
      .catch(() => undefined)
      .then(() => {
        queuedRequest = null;
        if (disposed) {
          throw new Error('status snapshot coordinator disposed');
        }
        return startRequest();
      });
    queuedRequest = nextRequest;
    return nextRequest;
  };

  return {
    refresh,
    refreshLatest,
    publish: (snapshot) => {
      acceptedVersion = ++version;
      if (!disposed) {
        onSnapshot(snapshot);
      }
    },
    resume: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
    },
  };
}

export function reconcileBindingSelection(
  selectedIDs: Set<string>,
  previousAssignedIDs: Iterable<string>,
  nextAssignedIDs: Iterable<string>
): Set<string> {
  const nextAssigned = new Set(nextAssignedIDs);
  const removed = new Set(Array.from(previousAssignedIDs).filter((id) => !nextAssigned.has(id)));
  if (removed.size === 0) return selectedIDs;
  const nextSelected = new Set(Array.from(selectedIDs).filter((id) => !removed.has(id)));
  return nextSelected.size === selectedIDs.size ? selectedIDs : nextSelected;
}

export interface StatusPollingEnvironment {
  visibilityState: () => string;
  isOnline: () => boolean;
  setInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (handle: unknown) => void;
  addWindowListener: (type: 'focus' | 'online', listener: () => void) => void;
  removeWindowListener: (type: 'focus' | 'online', listener: () => void) => void;
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
}

interface StatusPollingOptions {
  refresh: () => Promise<unknown>;
  intervalMs?: number;
  environment?: StatusPollingEnvironment;
}

function browserStatusPollingEnvironment(): StatusPollingEnvironment {
  return {
    visibilityState: () => document.visibilityState,
    isOnline: () => navigator.onLine,
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (handle) => window.clearInterval(handle as number),
    addWindowListener: (type, listener) => window.addEventListener(type, listener),
    removeWindowListener: (type, listener) => window.removeEventListener(type, listener),
    addVisibilityListener: (listener) => document.addEventListener('visibilitychange', listener),
    removeVisibilityListener: (listener) =>
      document.removeEventListener('visibilitychange', listener),
  };
}

export function startStatusPolling({
  refresh,
  intervalMs = PROXY_POOL_STATUS_POLL_INTERVAL_MS,
  environment = browserStatusPollingEnvironment(),
}: StatusPollingOptions): () => void {
  let stopped = false;
  const refreshWhenActive = () => {
    if (stopped || environment.visibilityState() !== 'visible' || !environment.isOnline()) {
      return;
    }
    void refresh().catch(() => undefined);
  };
  const handleVisibilityChange = () => refreshWhenActive();
  const handleFocus = () => refreshWhenActive();
  const handleOnline = () => refreshWhenActive();
  const interval = environment.setInterval(refreshWhenActive, intervalMs);

  environment.addWindowListener('focus', handleFocus);
  environment.addWindowListener('online', handleOnline);
  environment.addVisibilityListener(handleVisibilityChange);
  refreshWhenActive();

  return () => {
    stopped = true;
    environment.clearInterval(interval);
    environment.removeWindowListener('focus', handleFocus);
    environment.removeWindowListener('online', handleOnline);
    environment.removeVisibilityListener(handleVisibilityChange);
  };
}
