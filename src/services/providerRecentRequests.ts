import { apiKeyUsageApi } from '@/services/api';
import {
  normalizeRecentRequestUsageEntry,
  type ApiKeyUsageResponse,
  type RecentRequestUsageEntry,
} from '@/utils/recentRequests';
import { normalizeApiBase } from '@/utils/connection';

export const PROVIDER_RECENT_REQUESTS_STALE_TIME_MS = 240_000;

export type ProviderRecentRequests = Map<string, Map<string, RecentRequestUsageEntry>>;

export const EMPTY_PROVIDER_RECENT_REQUESTS: ProviderRecentRequests = new Map();

export interface ProviderRecentRequestsCache {
  current: () => ProviderRecentRequests;
  load: (options?: { force?: boolean }) => Promise<ProviderRecentRequests>;
  invalidate: () => void;
  subscribe: (listener: () => void) => () => void;
}

export interface ProviderRecentRequestsCacheController {
  forScope: (apiBase: string, managementKey: string) => ProviderRecentRequestsCache;
  current: () => ProviderRecentRequestsCache;
}

const normalizeProviderKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export const normalizeProviderRecentRequests = (
  payload: ApiKeyUsageResponse
): ProviderRecentRequests => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return EMPTY_PROVIDER_RECENT_REQUESTS;
  }

  const usageByProvider: ProviderRecentRequests = new Map();
  Object.entries(payload).forEach(([provider, entries]) => {
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey || !entries || typeof entries !== 'object' || Array.isArray(entries)) return;

    const usageByCompositeKey = new Map<string, RecentRequestUsageEntry>();
    Object.entries(entries).forEach(([compositeKey, entry]) => {
      usageByCompositeKey.set(compositeKey, normalizeRecentRequestUsageEntry(entry));
    });
    usageByProvider.set(providerKey, usageByCompositeKey);
  });
  return usageByProvider;
};

export const createProviderRecentRequestsCache = (
  loadUsage: () => Promise<ApiKeyUsageResponse>,
  now: () => number = Date.now,
  staleTimeMs = PROVIDER_RECENT_REQUESTS_STALE_TIME_MS
): ProviderRecentRequestsCache => {
  let cached = EMPTY_PROVIDER_RECENT_REQUESTS;
  let cachedAt = 0;
  let revision = 0;
  let inFlight: { revision: number; promise: Promise<ProviderRecentRequests> } | null = null;
  const listeners = new Set<() => void>();

  const load = (options: { force?: boolean } = {}): Promise<ProviderRecentRequests> => {
    const hasFreshCache = cachedAt > 0 && now() - cachedAt < staleTimeMs;
    if (!options.force && hasFreshCache) return Promise.resolve(cached);
    if (inFlight?.revision === revision) return inFlight.promise;

    const requestRevision = revision;
    const request = loadUsage()
      .then(normalizeProviderRecentRequests)
      .then((next) => {
        if (requestRevision !== revision) return load({ force: true });
        cached = next;
        cachedAt = now();
        return cached;
      })
      .finally(() => {
        if (inFlight?.promise === request) inFlight = null;
      });
    inFlight = { revision: requestRevision, promise: request };
    return request;
  };

  return {
    current: () => cached,
    load,
    invalidate: () => {
      revision += 1;
      cachedAt = 0;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const createProviderRecentRequestsCacheController = (
  createCache: () => ProviderRecentRequestsCache
): ProviderRecentRequestsCacheController => {
  let currentApiBase = '';
  let currentManagementKey = '';
  let hasScope = false;
  let currentCache = createCache();

  return {
    forScope: (apiBase, managementKey) => {
      const normalizedApiBase = normalizeApiBase(apiBase);
      const normalizedManagementKey = managementKey.trim();
      if (
        !hasScope ||
        normalizedApiBase !== currentApiBase ||
        normalizedManagementKey !== currentManagementKey
      ) {
        currentApiBase = normalizedApiBase;
        currentManagementKey = normalizedManagementKey;
        hasScope = true;
        currentCache = createCache();
      }
      return currentCache;
    },
    current: () => currentCache,
  };
};

const providerRecentRequestsCacheController = createProviderRecentRequestsCacheController(() =>
  createProviderRecentRequestsCache(() => apiKeyUsageApi.getUsage())
);

export const getProviderRecentRequestsCache = (apiBase: string, managementKey: string) =>
  providerRecentRequestsCacheController.forScope(apiBase, managementKey);

export const invalidateProviderRecentRequests = () =>
  providerRecentRequestsCacheController.current().invalidate();
