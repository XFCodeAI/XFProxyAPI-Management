/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  getQuotaCredentialCacheKey,
  useQuotaStore,
} from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  cacheKey: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

export function useQuotaLoader<TState, TData>(
  config: QuotaConfig<TState, TData>,
  currentFiles: AuthFileItem[]
) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const currentCredentialKeysRef = useRef<Set<string>>(new Set());
  currentCredentialKeysRef.current = new Set(currentFiles.map(getQuotaCredentialCacheKey));

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void,
      batchSize = targets.length
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      const cacheGeneration = captureQuotaCacheGeneration();
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[getQuotaCredentialCacheKey(file)] = config.buildLoadingState();
          });
          return nextState;
        });

        const resolvedBatchSize = Math.max(1, Math.min(targets.length, Math.floor(batchSize)));
        for (let start = 0; start < targets.length; start += resolvedBatchSize) {
          const batch = targets.slice(start, start + resolvedBatchSize);
          const results = await Promise.all(
            batch.map(async (file): Promise<LoadQuotaResult<TData>> => {
              const cacheKey = getQuotaCredentialCacheKey(file);
              try {
                const data = await config.fetchQuota(file, t);
                return { cacheKey, status: 'success', data };
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : t('common.unknown_error');
                const errorStatus = getStatusFromError(err);
                return { cacheKey, status: 'error', error: message, errorStatus };
              }
            })
          );

          if (requestId !== requestIdRef.current) return;

          const committed = commitIfQuotaCacheCurrent(cacheGeneration, () => {
            setQuota((prev) => {
              const nextState = { ...prev };
              results.forEach((result) => {
                if (!currentCredentialKeysRef.current.has(result.cacheKey)) return;
                if (result.status === 'success') {
                  nextState[result.cacheKey] = config.buildSuccessState(result.data as TData);
                } else {
                  nextState[result.cacheKey] = config.buildErrorState(
                    result.error || t('common.unknown_error'),
                    result.errorStatus
                  );
                }
              });
              return nextState;
            });
          });
          if (!committed) return;
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
