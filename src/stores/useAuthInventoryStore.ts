import { create } from 'zustand';
import { authFilesApi, type AuthFilesListQuery } from '@/services/api';
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

export type AuthInventoryQuery = Omit<AuthFilesListQuery, 'cursor'>;

type FilesUpdater = AuthFileItem[] | ((current: AuthFileItem[]) => AuthFileItem[]);

type AuthInventoryState = {
  files: AuthFileItem[];
  filesById: Record<string, AuthFileItem>;
  inventoryId: string;
  revision: number;
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string;
  cursor: string;
  cursorHistory: string[];
  page: number;
  query: AuthInventoryQuery;
  providerTotals: Record<string, number>;
  groupTotals: Record<string, number>;
  loading: boolean;
  error: string;
  streamConnected: boolean;
  refresh: (fresh?: boolean) => Promise<AuthFilesResponse>;
  setQuery: (query: AuthInventoryQuery) => Promise<AuthFilesResponse>;
  nextPage: () => Promise<AuthFilesResponse>;
  previousPage: () => Promise<AuthFilesResponse>;
  setFiles: (updater: FilesUpdater) => void;
  commitMutationVersion: (inventoryId: string, revision: number, files?: AuthFileItem[]) => void;
  start: () => void;
  stop: (clear?: boolean) => void;
};

export const authInventoryPageIsComplete = (
  state: Pick<
    AuthInventoryState,
    'files' | 'inventoryId' | 'total' | 'hasMore' | 'cursor' | 'cursorHistory' | 'query'
  >
): boolean => {
  const query = normalizeQuery(state.query);
  const hasFilter = Boolean(
    query.provider ||
    query.group ||
    query.withoutGroup ||
    query.status ||
    query.search ||
    query.name ||
    query.authIndex
  );
  return Boolean(
    state.inventoryId &&
    !hasFilter &&
    !state.cursor &&
    state.cursorHistory.length === 0 &&
    !state.hasMore &&
    state.files.length >= state.total
  );
};

const DEFAULT_PAGE_LIMIT = 25;
const EMPTY_QUERY: AuthInventoryQuery = { limit: DEFAULT_PAGE_LIMIT };

let streamAbort: AbortController | null = null;
let streamTask: Promise<void> | null = null;
let streamGeneration = 0;
let refreshGeneration = 0;
let refreshPromise: Promise<AuthFilesResponse> | null = null;
let refreshPromiseGeneration = -1;
let refreshPromiseKey = '';
let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;
let targetInventoryId = '';
let targetRevision = 0;
let requiredInventoryId = '';

const normalizeRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
};

const normalizePositiveInteger = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeQuery = (query: AuthInventoryQuery = EMPTY_QUERY): AuthInventoryQuery => {
  const normalizeText = (value: unknown): string | undefined => {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  };
  return {
    limit: Math.min(normalizePositiveInteger(query.limit, DEFAULT_PAGE_LIMIT), 200),
    provider: normalizeText(query.provider),
    group: normalizeText(query.group),
    withoutGroup: normalizeText(query.withoutGroup),
    status: normalizeText(query.status),
    search: normalizeText(query.search),
    name: normalizeText(query.name),
    authIndex: normalizeText(query.authIndex),
  };
};

const queryKey = (query: AuthInventoryQuery, cursor: string): string =>
  JSON.stringify([normalizeQuery(query), cursor]);

export const authFileStableID = (file: AuthFileItem): string =>
  String(file.id ?? file.authIndex ?? file.auth_index ?? file.name ?? '').trim();

const indexPageFiles = (files: AuthFileItem[]): Record<string, AuthFileItem> => {
  const indexed: Record<string, AuthFileItem> = {};
  files.forEach((file) => {
    const id = authFileStableID(file);
    if (id) indexed[id] = file;
  });
  return indexed;
};

const normalizeProviderTotals = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const totals: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([provider, count]) => {
    const key = provider.trim().toLowerCase();
    const normalized = Number(count);
    if (key && Number.isSafeInteger(normalized) && normalized >= 0) totals[key] = normalized;
  });
  return totals;
};

const inventorySnapshot = (state: AuthInventoryState): AuthFilesResponse => ({
  files: state.files,
  total: state.total,
  limit: state.limit,
  next_cursor: state.nextCursor,
  has_more: state.hasMore,
  provider_totals: state.providerTotals,
  group_totals: state.groupTotals,
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

const replacePageFiles = (files: AuthFileItem[]) => ({
  files,
  filesById: indexPageFiles(files),
});

const updatePageFiles = (
  current: AuthFileItem[],
  incoming: AuthFileItem[],
  appendUnknown: boolean
): AuthFileItem[] => {
  if (incoming.length === 0) return current;
  const next = [...current];
  const positions = new Map<string, number>();
  next.forEach((file, index) => {
    const id = authFileStableID(file);
    if (id) positions.set(id, index);
  });
  incoming.forEach((file) => {
    const id = authFileStableID(file);
    if (!id) return;
    const index = positions.get(id);
    if (index !== undefined) {
      next[index] = file;
      return;
    }
    if (appendUnknown) {
      positions.set(id, next.length);
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
  const reconcilePage =
    files.length === 0 ||
    Boolean(
      state.query.provider ||
      state.query.group ||
      state.query.withoutGroup ||
      state.query.status ||
      state.query.search ||
      state.query.name ||
      state.query.authIndex
    );
  useAuthInventoryStore.setState((current) => {
    const nextFiles = updatePageFiles(current.files, files, false);
    return {
      ...replacePageFiles(nextFiles),
      inventoryId,
      revision,
    };
  });
  if (reconcilePage) scheduleInventoryRefresh();
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

  const pageIDs = new Set(state.files.map(authFileStableID));
  if (event.action === 'deleted') {
    const deleted = new Set(event.ids);
    useAuthInventoryStore.setState((current) => {
      const nextFiles = current.files.filter((file) => !deleted.has(authFileStableID(file)));
      return {
        ...replacePageFiles(nextFiles),
        inventoryId,
        revision: event.revision,
      };
    });
    targetInventoryId = inventoryId;
    targetRevision = event.revision;
    scheduleInventoryRefresh();
    return;
  }

  const filesByID = new Map(event.files.map((file) => [authFileStableID(file), file]));
  const covered = event.ids.every((id) => filesByID.has(id));
  const allOnPage = event.ids.every((id) => pageIDs.has(id));
  if (!covered || event.action === 'added' || !allOnPage) {
    useAuthInventoryStore.setState({ inventoryId, revision: event.revision });
    targetInventoryId = inventoryId;
    targetRevision = event.revision;
    scheduleInventoryRefresh();
    return;
  }

  useAuthInventoryStore.setState((current) => {
    const nextFiles = updatePageFiles(current.files, event.files, false);
    return {
      ...replacePageFiles(nextFiles),
      inventoryId,
      revision: event.revision,
    };
  });
  targetInventoryId = inventoryId;
  targetRevision = event.revision;
  scheduleInventoryRefresh();
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

const initialInventoryState = () => ({
  files: [] as AuthFileItem[],
  filesById: {} as Record<string, AuthFileItem>,
  inventoryId: '',
  revision: 0,
  total: 0,
  limit: DEFAULT_PAGE_LIMIT,
  hasMore: false,
  nextCursor: '',
  cursor: '',
  cursorHistory: [] as string[],
  page: 1,
  query: { ...EMPTY_QUERY },
  providerTotals: {} as Record<string, number>,
  groupTotals: {} as Record<string, number>,
  loading: false,
  error: '',
  streamConnected: false,
});

export const useAuthInventoryStore = create<AuthInventoryState>((set, get) => ({
  ...initialInventoryState(),

  refresh: async (fresh = false) => {
    const generation = refreshGeneration;
    const stateAtStart = get();
    const requestQuery = normalizeQuery(stateAtStart.query);
    const requestCursor = stateAtStart.cursor;
    const requestKey = queryKey(requestQuery, requestCursor);
    const activeRefresh = refreshPromise;
    if (
      activeRefresh &&
      refreshPromiseGeneration === generation &&
      refreshPromiseKey === requestKey
    ) {
      if (!fresh) return activeRefresh;
      await activeRefresh.catch(() => undefined);
      if (generation !== refreshGeneration) return get().refresh(true);
    }

    set({ loading: true });
    const request = authFilesApi
      .list({ ...requestQuery, cursor: requestCursor || undefined })
      .then((response) => {
        if (
          generation !== refreshGeneration ||
          requestKey !== queryKey(get().query, get().cursor)
        ) {
          return inventorySnapshot(get());
        }
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
        set((latest) => {
          const sameInventory =
            !inventoryId || !latest.inventoryId || inventoryId === latest.inventoryId;
          if (sameInventory && revision < latest.revision) return { loading: false };
          const files = response.files ?? [];
          return {
            ...replacePageFiles(files),
            inventoryId: inventoryId || latest.inventoryId,
            revision,
            total: normalizePositiveInteger(response.total, files.length),
            limit: normalizePositiveInteger(
              response.limit,
              requestQuery.limit ?? DEFAULT_PAGE_LIMIT
            ),
            hasMore: response.has_more === true,
            nextCursor: String(response.next_cursor ?? '').trim(),
            providerTotals: normalizeProviderTotals(response.provider_totals),
            groupTotals: normalizeProviderTotals(response.group_totals),
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
          refreshPromiseKey = '';
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
    refreshPromiseKey = requestKey;
    return request;
  },

  setQuery: async (query) => {
    const normalized = normalizeQuery(query);
    const current = get();
    if (queryKey(normalized, '') === queryKey(current.query, '') && !current.cursor) {
      return current.refresh();
    }
    refreshGeneration++;
    set({
      query: normalized,
      cursor: '',
      cursorHistory: [],
      page: 1,
      nextCursor: '',
      hasMore: false,
    });
    return get().refresh(true);
  },

  nextPage: async () => {
    const current = get();
    if (!current.hasMore || !current.nextCursor || current.loading)
      return inventorySnapshot(current);
    refreshGeneration++;
    set({
      cursorHistory: [...current.cursorHistory, current.cursor],
      cursor: current.nextCursor,
      page: current.page + 1,
      nextCursor: '',
      hasMore: false,
    });
    try {
      return await get().refresh(true);
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status);
      if (status !== 409) throw error;
      refreshGeneration++;
      set({ cursor: '', cursorHistory: [], page: 1 });
      return get().refresh(true);
    }
  },

  previousPage: async () => {
    const current = get();
    if (current.cursorHistory.length === 0 || current.loading) return inventorySnapshot(current);
    const history = [...current.cursorHistory];
    const cursor = history.pop() ?? '';
    refreshGeneration++;
    set({
      cursor,
      cursorHistory: history,
      page: Math.max(1, current.page - 1),
      nextCursor: '',
      hasMore: false,
    });
    return get().refresh(true);
  },

  setFiles: (updater) => {
    set((state) => {
      const files = typeof updater === 'function' ? updater(state.files) : updater;
      return replacePageFiles(files);
    });
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
        if (!controller.signal.aborted) await runInventoryStream(generation, controller.signal);
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
      set(initialInventoryState());
    } else {
      set({ streamConnected: false });
    }
  },
}));
