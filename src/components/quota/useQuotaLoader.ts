/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  getQuotaCredentialCacheKey,
  useAuthInventoryStore,
  useQuotaStore,
} from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import {
  authFileMatchesCredentialIdentity,
  findCurrentAuthFileForIdentity,
  readAuthFileCredentialIdentity,
} from '@/features/authFiles/credentialIdentity';
import { isCodexQuotaContextChangedError } from '@/services/api/codexQuota';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  requestedCacheKey: string;
  cacheKey: string;
  file: AuthFileItem;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

type QuotaIdentityRecoveryOptions<TState, TData> = {
  file: AuthFileItem;
  previousState?: TState;
  t: TFunction;
  fetchQuota: (file: AuthFileItem, t: TFunction, previousState?: TState) => Promise<TData>;
  refreshInventory: () => Promise<void>;
  getCurrentFiles: () => readonly AuthFileItem[];
};

export const fetchQuotaWithIdentityRecovery = async <TState, TData>({
  file,
  previousState,
  t,
  fetchQuota,
  refreshInventory,
  getCurrentFiles,
}: QuotaIdentityRecoveryOptions<TState, TData>): Promise<{
  file: AuthFileItem;
  data: TData;
  recovered: boolean;
}> => {
  try {
    return { file, data: await fetchQuota(file, t, previousState), recovered: false };
  } catch (error: unknown) {
    if (!isCodexQuotaContextChangedError(error)) throw error;
    try {
      await refreshInventory();
    } catch {
      throw error;
    }
    const latest = findCurrentAuthFileForIdentity(
      getCurrentFiles(),
      readAuthFileCredentialIdentity(file)
    );
    if (!latest) throw error;
    return { file: latest, data: await fetchQuota(latest, t), recovered: true };
  }
};

export const isQuotaCredentialCurrent = (
  files: readonly AuthFileItem[],
  file: AuthFileItem
): boolean =>
  files.some((current) =>
    authFileMatchesCredentialIdentity(current, readAuthFileCredentialIdentity(file))
  );

export function useQuotaLoader<TState, TData>(
  config: QuotaConfig<TState, TData>,
  currentFiles: AuthFileItem[]
) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const refreshAuthInventory = useAuthInventoryStore((state) => state.refresh);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const identityRefreshRef = useRef<Promise<void> | null>(null);
  const currentCredentialKeysRef = useRef<Set<string>>(new Set());
  currentCredentialKeysRef.current = new Set(currentFiles.map(getQuotaCredentialCacheKey));

  const refreshIdentityInventory = useCallback(async () => {
    if (!identityRefreshRef.current) {
      identityRefreshRef.current = (async () => {
        await refreshAuthInventory(true);
      })().finally(() => {
        identityRefreshRef.current = null;
      });
    }
    await identityRefreshRef.current;
  }, [refreshAuthInventory]);

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

        const previousStates = new Map(
          targets.map((file) => {
            const cacheKey = getQuotaCredentialCacheKey(file);
            return [cacheKey, quota[cacheKey]] as const;
          })
        );

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            const cacheKey = getQuotaCredentialCacheKey(file);
            nextState[cacheKey] = config.buildLoadingState(file, previousStates.get(cacheKey));
          });
          return nextState;
        });

        const resolvedBatchSize = Math.max(1, Math.min(targets.length, Math.floor(batchSize)));
        for (let start = 0; start < targets.length; start += resolvedBatchSize) {
          const batch = targets.slice(start, start + resolvedBatchSize);
          const results = await Promise.all(
            batch.map(async (file): Promise<LoadQuotaResult<TData>> => {
              const requestedCacheKey = getQuotaCredentialCacheKey(file);
              try {
                const resolved = await fetchQuotaWithIdentityRecovery({
                  file,
                  previousState: previousStates.get(requestedCacheKey),
                  t,
                  fetchQuota: config.fetchQuota,
                  refreshInventory: refreshIdentityInventory,
                  getCurrentFiles: () => useAuthInventoryStore.getState().files,
                });
                return {
                  requestedCacheKey,
                  cacheKey: getQuotaCredentialCacheKey(resolved.file),
                  file: resolved.file,
                  status: 'success',
                  data: resolved.data,
                };
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : t('common.unknown_error');
                const errorStatus = getStatusFromError(err);
                return {
                  requestedCacheKey,
                  cacheKey: requestedCacheKey,
                  file,
                  status: 'error',
                  error: message,
                  errorStatus,
                };
              }
            })
          );

          if (requestId !== requestIdRef.current) return;

          const committed = commitIfQuotaCacheCurrent(cacheGeneration, () => {
            setQuota((prev) => {
              const nextState = { ...prev };
              results.forEach((result) => {
                if (
                  (!currentCredentialKeysRef.current.has(result.requestedCacheKey) &&
                    !currentCredentialKeysRef.current.has(result.cacheKey)) ||
                  !isQuotaCredentialCurrent(useAuthInventoryStore.getState().files, result.file)
                ) {
                  return;
                }
                if (result.requestedCacheKey !== result.cacheKey) {
                  delete nextState[result.requestedCacheKey];
                }
                if (result.status === 'success') {
                  nextState[result.cacheKey] = config.buildSuccessState(
                    result.data as TData,
                    result.file
                  );
                } else {
                  nextState[result.cacheKey] = config.buildErrorState(
                    result.error || t('common.unknown_error'),
                    result.errorStatus,
                    result.file,
                    previousStates.get(result.requestedCacheKey)
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
    [config, quota, refreshIdentityInventory, setQuota, t]
  );

  return { quota, loadQuota };
}
