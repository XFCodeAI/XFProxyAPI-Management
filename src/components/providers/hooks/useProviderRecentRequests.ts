import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_PROVIDER_RECENT_REQUESTS,
  getProviderRecentRequestsCache,
  PROVIDER_RECENT_REQUESTS_STALE_TIME_MS,
  type ProviderRecentRequestsCache,
  type ProviderRecentRequests,
} from '@/services/providerRecentRequests';
import { useInterval } from '@/hooks/useInterval';
import { usePageActivityRefresh } from '@/hooks/usePageActivityRefresh';
import { useAuthStore } from '@/stores';

export type { ProviderRecentRequests } from '@/services/providerRecentRequests';

export type UseProviderRecentRequestsOptions = {
  enabled?: boolean;
};

export function useProviderRecentRequests(options: UseProviderRecentRequestsOptions = {}) {
  const enabled = options.enabled ?? true;
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const cache = useMemo(
    () => getProviderRecentRequestsCache(apiBase, managementKey),
    [apiBase, managementKey]
  );
  const [usageState, setUsageState] = useState<{
    cache: ProviderRecentRequestsCache;
    value: ProviderRecentRequests;
  }>(() => ({ cache, value: cache.current() }));
  const [loadingState, setLoadingState] = useState<{
    cache: ProviderRecentRequestsCache;
    value: boolean;
  }>(() => ({ cache, value: false }));

  const setUsageForCurrentScope = useCallback(
    (value: ProviderRecentRequests) => setUsageState({ cache, value }),
    [cache]
  );

  const setLoadingForCurrentScope = useCallback(
    (value: boolean) => setLoadingState({ cache, value }),
    [cache]
  );

  const loadRecentRequests = useCallback(
    async (loadOptions: { force?: boolean } = {}) => {
      if (!enabled) {
        return EMPTY_PROVIDER_RECENT_REQUESTS;
      }

      setLoadingForCurrentScope(true);
      try {
        const nextUsage = await cache.load(loadOptions);
        setUsageForCurrentScope(nextUsage);
        return nextUsage;
      } catch {
        const current = cache.current();
        setUsageForCurrentScope(current);
        return current;
      } finally {
        setLoadingForCurrentScope(false);
      }
    },
    [cache, enabled, setLoadingForCurrentScope, setUsageForCurrentScope]
  );

  const refreshRecentRequests = useCallback(
    async () => loadRecentRequests({ force: true }),
    [loadRecentRequests]
  );

  useEffect(() => {
    if (!enabled) {
      setUsageForCurrentScope(EMPTY_PROVIDER_RECENT_REQUESTS);
      return;
    }
    void loadRecentRequests().catch(() => {});
  }, [enabled, loadRecentRequests, setUsageForCurrentScope]);

  useEffect(() => {
    if (!enabled) return;
    return cache.subscribe(() => {
      void refreshRecentRequests().catch(() => {});
    });
  }, [cache, enabled, refreshRecentRequests]);

  usePageActivityRefresh(refreshRecentRequests, enabled);

  useInterval(
    () => {
      void refreshRecentRequests().catch(() => {});
    },
    enabled ? PROVIDER_RECENT_REQUESTS_STALE_TIME_MS : null
  );

  const usageByProvider = usageState.cache === cache ? usageState.value : cache.current();
  const isLoading = loadingState.cache === cache ? loadingState.value : false;

  return {
    usageByProvider: enabled ? usageByProvider : EMPTY_PROVIDER_RECENT_REQUESTS,
    isLoading: enabled ? isLoading : false,
    loadRecentRequests,
    refreshRecentRequests,
  };
}
