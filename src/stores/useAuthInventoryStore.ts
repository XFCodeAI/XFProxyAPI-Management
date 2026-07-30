import { create } from 'zustand';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem, AuthFilesResponse } from '@/types/authFile';
import { computeApiUrl } from '@/utils/connection';
import { useAuthStore } from './useAuthStore';

type InventoryAction = 'added' | 'updated' | 'deleted' | 'reconciled';

type InventoryEvent = {
  inventoryId: string;
  revision: number;
  action: InventoryAction;
  ids: string[];
  files: AuthFileItem[];
};

type FilesUpdater = AuthFileItem[] | ((current: AuthFileItem[]) => AuthFileItem[]);

type AuthInventoryState = {
  files: AuthFileItem[];
  inventoryId: string;
  revision: number;
  loading: boolean;
  error: string;
  streamConnected: boolean;
  refresh: (fresh?: boolean) => Promise<AuthFilesResponse>;
  setFiles: (updater: FilesUpdater) => void;
  commitMutationVersion: (inventoryId: string, revision: number, files?: AuthFileItem[]) => void;
  start: () => void;
  stop: (clear?: boolean) => void;
};

let streamAbort: AbortController | null = null;
let streamTask: Promise<void> | null = null;
let streamGeneration = 0;
let refreshGeneration = 0;
let refreshPromise: Promise<AuthFilesResponse> | null = null;
let refreshPromiseGeneration = -1;
let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;
let targetInventoryId = '';
let targetRevision = 0;
let requiredInventoryId = '';

const normalizeRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
};

const inventorySnapshot = (
  state: Pick<AuthInventoryState, 'files' | 'inventoryId' | 'revision'>
): AuthFilesResponse => ({
  files: state.files,
  total: state.files.length,
  inventory_id: state.inventoryId,
  revision: state.revision,
});

const normalizeEvent = (value: unknown): InventoryEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const inventoryId = String(record.inventory_id ?? '').trim();
  const revision = normalizeRevision(record.revision);
  const action = String(record.action ?? '') as InventoryAction;
  if (!['added', 'updated', 'deleted', 'reconciled'].includes(action)) return null;
  const ids = Array.isArray(record.ids)
    ? record.ids.map((id) => String(id ?? '').trim()).filter(Boolean)
    : [];
  const files = Array.isArray(record.files)
    ? record.files.filter((file): file is AuthFileItem => Boolean(file && typeof file === 'object'))
    : [];
  return { inventoryId, revision, action, ids, files };
};

const parseEventBlock = (block: string): InventoryEvent | null => {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return normalizeEvent(JSON.parse(data) as unknown);
  } catch {
    return null;
  }
};

const waitForRetry = (delay: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(resolve, delay);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });

const scheduleInventoryRefresh = () => {
  if (scheduledRefresh !== null) return;
  scheduledRefresh = window.setTimeout(() => {
    scheduledRefresh = null;
    void useAuthInventoryStore
      .getState()
      .refresh()
      .catch(() => undefined);
  }, 50);
};

const authFileIdentityKeys = (file: AuthFileItem): string[] =>
  [file.id, file.name, file.authIndex, file.auth_index]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

const authFileMatchesIDs = (file: AuthFileItem, ids: Set<string>): boolean =>
  authFileIdentityKeys(file).some((key) => ids.has(key));

const upsertInventoryFiles = (
  current: AuthFileItem[],
  incoming: AuthFileItem[]
): AuthFileItem[] => {
  if (incoming.length === 0) return current;
  const next = [...current];
  incoming.forEach((file) => {
    const keys = new Set(authFileIdentityKeys(file));
    if (keys.size === 0) return;
    const index = next.findIndex((candidate) =>
      authFileIdentityKeys(candidate).some((key) => keys.has(key))
    );
    if (index >= 0) {
      next[index] = file;
    } else {
      next.push(file);
    }
  });
  return next;
};

const requireInventoryRefresh = (inventoryId: string, revision: number) => {
  targetInventoryId = inventoryId || targetInventoryId;
  targetRevision = Math.max(targetRevision, revision);
  if (inventoryId) requiredInventoryId = inventoryId;
  scheduleInventoryRefresh();
};

const commitInventoryRevision = (
  inventoryId: string,
  revision: number,
  files: AuthFileItem[] = []
) => {
  if (!inventoryId || revision <= 0) return;
  const state = useAuthInventoryStore.getState();
  if (state.inventoryId && inventoryId !== state.inventoryId) {
    requireInventoryRefresh(inventoryId, revision);
    return;
  }
  if (revision <= state.revision) return;
  if (revision !== state.revision + 1) {
    requireInventoryRefresh(inventoryId, revision);
    return;
  }
  targetInventoryId = inventoryId;
  targetRevision = revision;
  useAuthInventoryStore.setState((current) => ({
    files: upsertInventoryFiles(current.files, files),
    inventoryId,
    revision,
  }));
};

export const applyInventoryEvent = (event: InventoryEvent) => {
  const state = useAuthInventoryStore.getState();
  if (event.inventoryId && state.inventoryId && event.inventoryId !== state.inventoryId) {
    requireInventoryRefresh(event.inventoryId, event.revision);
    return;
  }
  if (event.revision <= state.revision) return;
  const inventoryId = event.inventoryId || state.inventoryId;
  if (event.action === 'reconciled' || event.revision !== state.revision + 1) {
    requireInventoryRefresh(inventoryId, event.revision);
    return;
  }
  const eventIDs = new Set(event.ids);
  if (event.action === 'deleted') {
    useAuthInventoryStore.setState((current) => ({
      files: current.files.filter((file) => !authFileMatchesIDs(file, eventIDs)),
      inventoryId,
      revision: event.revision,
    }));
    targetInventoryId = inventoryId;
    targetRevision = event.revision;
    return;
  }
  const covered = event.ids.every((id) =>
    event.files.some((file) => authFileIdentityKeys(file).includes(id))
  );
  if (!covered) {
    requireInventoryRefresh(inventoryId, event.revision);
    return;
  }
  useAuthInventoryStore.setState((current) => ({
    files: upsertInventoryFiles(current.files, event.files),
    inventoryId,
    revision: event.revision,
  }));
  targetInventoryId = inventoryId;
  targetRevision = event.revision;
};

const consumeInventoryStream = async (response: Response, signal: AbortSignal) => {
  if (!response.body) throw new Error('Credential event stream is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEventBlock(block);
      if (event) applyInventoryEvent(event);
      boundary = buffer.indexOf('\n\n');
    }
  }
};

const runInventoryStream = async (generation: number, signal: AbortSignal) => {
  let retryDelay = 1_000;
  while (!signal.aborted && generation === streamGeneration) {
    const { apiBase, managementKey, connectionStatus } = useAuthStore.getState();
    if (connectionStatus !== 'connected' || !apiBase || !managementKey) return;
    const revision = useAuthInventoryStore.getState().revision;
    const inventoryId = useAuthInventoryStore.getState().inventoryId;
    const params = new URLSearchParams({ since: String(revision) });
    if (inventoryId) params.set('inventory_id', inventoryId);
    const url = `${computeApiUrl(apiBase)}/auth-files/events?${params.toString()}`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${managementKey}`,
        },
        cache: 'no-store',
        signal,
      });
      if (response.status === 401) {
        window.dispatchEvent(new Event('unauthorized'));
        return;
      }
      if (!response.ok) throw new Error(`Credential event stream failed: ${response.status}`);
      useAuthInventoryStore.setState({ streamConnected: true, error: '' });
      retryDelay = 1_000;
      await consumeInventoryStream(response, signal);
    } catch (error) {
      if (signal.aborted) return;
      useAuthInventoryStore.setState({
        streamConnected: false,
        error: error instanceof Error ? error.message : 'Credential event stream failed',
      });
    }
    if (signal.aborted) return;
    await waitForRetry(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  }
};

export const useAuthInventoryStore = create<AuthInventoryState>((set, get) => ({
  files: [],
  inventoryId: '',
  revision: 0,
  loading: false,
  error: '',
  streamConnected: false,

  refresh: async (fresh = false) => {
    const generation = refreshGeneration;
    const activeRefresh = refreshPromise;
    if (activeRefresh && refreshPromiseGeneration === generation) {
      if (!fresh) return activeRefresh;
      await activeRefresh.catch(() => undefined);
      if (generation !== refreshGeneration) {
        return get().refresh(true);
      }
      if (
        refreshPromise &&
        refreshPromise !== activeRefresh &&
        refreshPromiseGeneration === generation
      ) {
        return refreshPromise;
      }
    }

    set({ loading: true });
    const request = authFilesApi
      .list()
      .then((response) => {
        if (generation !== refreshGeneration) return inventorySnapshot(get());
        const revision = normalizeRevision(response.revision);
        const inventoryId = String(response.inventory_id ?? '').trim();
        const current = get();
        if (requiredInventoryId && inventoryId && inventoryId !== requiredInventoryId) {
          set({ loading: false });
          return inventorySnapshot(get());
        }
        const inventoryChanged = Boolean(
          inventoryId && current.inventoryId && inventoryId !== current.inventoryId
        );
        set((state) => {
          const sameInventory =
            !inventoryId || !state.inventoryId || inventoryId === state.inventoryId;
          if (sameInventory && revision < state.revision) return { loading: false };
          return {
            files: response.files ?? [],
            inventoryId: inventoryId || state.inventoryId,
            revision,
            loading: false,
            error: '',
          };
        });
        if (inventoryId) {
          targetInventoryId = inventoryId;
          if (requiredInventoryId === inventoryId) requiredInventoryId = '';
        }
        if (inventoryChanged) {
          targetRevision = revision;
        } else if (inventoryId === targetInventoryId && revision >= targetRevision) {
          targetRevision = revision;
        }
        return inventorySnapshot(get());
      })
      .catch((error: unknown) => {
        if (generation !== refreshGeneration) throw error;
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'Credential inventory refresh failed',
        });
        throw error;
      })
      .finally(() => {
        if (refreshPromise === request) {
          refreshPromise = null;
          refreshPromiseGeneration = -1;
        }
        if (generation !== refreshGeneration) return;
        const state = useAuthInventoryStore.getState();
        if (
          targetRevision > state.revision ||
          (targetInventoryId && state.inventoryId !== targetInventoryId)
        ) {
          scheduleInventoryRefresh();
        }
      });
    refreshPromise = request;
    refreshPromiseGeneration = generation;
    return request;
  },

  setFiles: (updater) => {
    set((state) => ({
      files: typeof updater === 'function' ? updater(state.files) : updater,
    }));
  },

  commitMutationVersion: (inventoryId, revision, files = []) => {
    commitInventoryRevision(String(inventoryId ?? '').trim(), normalizeRevision(revision), files);
  },

  start: () => {
    if (streamTask) return;
    const generation = ++streamGeneration;
    const controller = new AbortController();
    streamAbort = controller;
    streamTask = (async () => {
      try {
        await get().refresh();
        await runInventoryStream(generation, controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          await runInventoryStream(generation, controller.signal);
        }
      } finally {
        if (generation === streamGeneration) {
          streamTask = null;
          streamAbort = null;
          set({ streamConnected: false });
        }
      }
    })();
  },

  stop: (clear = false) => {
    streamGeneration++;
    refreshGeneration++;
    streamAbort?.abort();
    streamAbort = null;
    streamTask = null;
    if (scheduledRefresh !== null) {
      window.clearTimeout(scheduledRefresh);
      scheduledRefresh = null;
    }
    if (clear) {
      targetInventoryId = '';
      targetRevision = 0;
      requiredInventoryId = '';
      set({
        files: [],
        inventoryId: '',
        revision: 0,
        loading: false,
        error: '',
        streamConnected: false,
      });
    } else {
      set({ streamConnected: false });
    }
  },
}));
