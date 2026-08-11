import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TooltipButton } from '@/components/ui/TooltipControls';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  getQuotaCredentialCacheKey,
  runtimeObservationResourceKey,
  useAuthInventoryStore,
  useNotificationStore,
  useQuotaStore,
  useRuntimeObservationStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { normalizePlanType } from '@/utils/quota/parsers';
import { resolveCodexPlanType } from '@/utils/quota/resolvers';
import { hasAuthFileStatusMessage } from '@/features/authFiles/constants';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import {
  fetchQuotaWithIdentityRecovery,
  isQuotaCredentialCurrent,
  useQuotaLoader,
} from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { isCodexQuotaContextChangedError } from '@/services/api/codexQuota';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

export type QuotaStatusFilterMode = 'all' | 'enabled' | 'disabled' | 'problem';
type PlanAwareQuotaState = QuotaStatusState & {
  planType?: string | null;
  account?: {
    upstreamPlanType?: string | null;
    credentialPlanType?: string | null;
  } | null;
};

const MAX_ITEMS_PER_PAGE = 25;
const PLAN_FILTER_ALL = 'all';
const PLAN_FILTER_UNVERIFIED = '__unverified__';

// eslint-disable-next-line react-refresh/only-export-components
export const matchesQuotaCredentialStatus = (
  file: Pick<AuthFileItem, 'disabled'>,
  mode: QuotaStatusFilterMode,
  hasProblem: boolean
): boolean => {
  if (mode === 'enabled') return file.disabled !== true;
  if (mode === 'disabled') return file.disabled === true;
  if (mode === 'problem') return hasProblem;
  return true;
};

const resolveQuotaPlanType = (state: QuotaStatusState | undefined): string | null => {
  if (!state) return null;
  const planState = state as PlanAwareQuotaState;
  return normalizePlanType(
    planState.planType ??
      planState.account?.upstreamPlanType ??
      planState.account?.credentialPlanType
  );
};

const resolveFilePlanType = (file: AuthFileItem): string | null =>
  normalizePlanType(resolveCodexPlanType(file));

// eslint-disable-next-line react-refresh/only-export-components
export const resolveQuotaCredentialPlan = (
  file: AuthFileItem,
  state: QuotaStatusState | undefined
): string | null => resolveQuotaPlanType(state) ?? resolveFilePlanType(file);

const resolvePlanFilterValue = (file: AuthFileItem, state: QuotaStatusState | undefined): string =>
  resolveQuotaCredentialPlan(file, state) ?? PLAN_FILTER_UNVERIFIED;

// eslint-disable-next-line react-refresh/only-export-components
export const matchesQuotaCredentialPlan = (
  file: AuthFileItem,
  state: QuotaStatusState | undefined,
  planFilter: string
): boolean => planFilter === PLAN_FILTER_ALL || resolvePlanFilterValue(file, state) === planFilter;

// eslint-disable-next-line react-refresh/only-export-components
export const stablePartitionEnabledCredentials = <T extends Pick<AuthFileItem, 'disabled'>>(
  files: readonly T[]
): T[] => {
  const enabled: T[] = [];
  const disabled: T[] = [];
  files.forEach((file) => (file.disabled === true ? disabled : enabled).push(file));
  return [...enabled, ...disabled];
};

const CODEX_PLAN_LABEL_KEYS: Record<string, string> = {
  free: 'codex_quota.plan_free',
  plus: 'codex_quota.plan_plus',
  team: 'codex_quota.plan_team',
  pro: 'codex_quota.plan_pro',
  prolite: 'codex_quota.plan_prolite',
  'pro-lite': 'codex_quota.plan_prolite',
  pro_lite: 'codex_quota.plan_prolite',
};

const formatPlanFilterLabel = (plan: string, t: TFunction): string => {
  const translationKey = CODEX_PLAN_LABEL_KEYS[plan];
  if (translationKey) return t(translationKey);
  return plan
    .split(/([_\-\s]+)/)
    .map((part) => {
      if (/^[_\-\s]+$/.test(part)) return part;
      if (/\d/.test(part) && part.length <= 4) return part.toUpperCase();
      return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part;
    })
    .join('');
};

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

const useQuotaPagination = <T,>(items: T[], defaultPageSize = 6): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: 'page' | 'all' | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading,
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  credentialActionDisabled?: boolean;
  selectedCredentialNames?: Set<string>;
  deletingCredentialName?: string | null;
  credentialStatusUpdating?: Record<string, boolean>;
  onDownloadCredential?: (name: string) => void;
  onShowCredentialModels?: (item: AuthFileItem) => void;
  onOpenCredentialSettings?: (item: AuthFileItem) => void;
  onDeleteCredential?: (item: AuthFileItem) => void;
  onToggleCredentialStatus?: (item: AuthFileItem, enabled: boolean) => void;
  onToggleCredentialSelect?: (name: string) => void;
  onVisibleCredentialsChange?: (items: AuthFileItem[]) => void;
  inventoryTotal?: number;
  inventoryPage?: number;
  inventoryHasNext?: boolean;
  inventoryHasPrevious?: boolean;
  onInventoryNext?: () => void;
  onInventoryPrevious?: () => void;
  onInventoryPageSizeChange?: (size: number) => void;
  onInventoryStatusChange?: (status: QuotaStatusFilterMode) => void;
  headerActionAfterRefresh?: ReactNode;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
  credentialActionDisabled = false,
  selectedCredentialNames,
  deletingCredentialName = null,
  credentialStatusUpdating = {},
  onDownloadCredential,
  onShowCredentialModels,
  onOpenCredentialSettings,
  onDeleteCredential,
  onToggleCredentialStatus,
  onToggleCredentialSelect,
  onVisibleCredentialsChange,
  inventoryTotal = files.length,
  inventoryPage = 1,
  inventoryHasNext = false,
  inventoryHasPrevious = false,
  onInventoryNext,
  onInventoryPrevious,
  onInventoryPageSizeChange,
  onInventoryStatusChange,
  headerActionAfterRefresh,
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const refreshAuthInventory = useAuthInventoryStore((state) => state.refresh);
  const runtimeResources = useRuntimeObservationStore((state) => state.resourcesByKey);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;
  const [columns, gridRef] = useGridColumns(380);
  const [statusFilterMode, setStatusFilterMode] = useState<QuotaStatusFilterMode>('all');
  const [planFilter, setPlanFilter] = useState(PLAN_FILTER_ALL);
  const [resettingQuotaKey, setResettingQuotaKey] = useState<string | null>(null);

  const providerFiles = useMemo(
    () => files.filter((file) => config.filterFn(file)),
    [files, config]
  );
  const currentCredentialKeysRef = useRef<Set<string>>(new Set());
  currentCredentialKeysRef.current = new Set(providerFiles.map(getQuotaCredentialCacheKey));
  const { quota, loadQuota } = useQuotaLoader(config, providerFiles);
  const isProblemCredential = useCallback(
    (file: AuthFileItem) => {
      const quotaStatus = quota[getQuotaCredentialCacheKey(file)]?.status;
      return hasAuthFileStatusMessage(file) || quotaStatus === 'error';
    },
    [quota]
  );
  const statusFilteredFiles = useMemo(
    () =>
      providerFiles.filter((file) =>
        matchesQuotaCredentialStatus(file, statusFilterMode, isProblemCredential(file))
      ),
    [isProblemCredential, providerFiles, statusFilterMode]
  );

  const showPlanFilter = config.type === 'codex';

  const planFilterOptions = useMemo(() => {
    if (!showPlanFilter) return [];

    const counts = new Map<string, number>();
    statusFilteredFiles.forEach((file) => {
      const plan = resolvePlanFilterValue(file, quota[getQuotaCredentialCacheKey(file)]);
      counts.set(plan, (counts.get(plan) ?? 0) + 1);
    });
    if (planFilter !== PLAN_FILTER_ALL && !counts.has(planFilter)) {
      counts.set(planFilter, 0);
    }

    const plans = Array.from(counts.keys()).sort((a, b) => {
      if (a === PLAN_FILTER_UNVERIFIED) return 1;
      if (b === PLAN_FILTER_UNVERIFIED) return -1;
      return a.localeCompare(b);
    });

    return [
      { value: PLAN_FILTER_ALL, label: t('auth_files.plan_filter_all') },
      ...plans.map((plan) => ({
        value: plan,
        label:
          plan === PLAN_FILTER_UNVERIFIED
            ? `${t('auth_files.plan_filter_unverified')} (${counts.get(plan) ?? 0})`
            : `${formatPlanFilterLabel(plan, t)} (${counts.get(plan) ?? 0})`,
      })),
    ];
  }, [planFilter, quota, showPlanFilter, statusFilteredFiles, t]);

  const filteredFiles = useMemo(() => {
    if (!showPlanFilter) return statusFilteredFiles;
    return statusFilteredFiles.filter((file) =>
      matchesQuotaCredentialPlan(file, quota[getQuotaCredentialCacheKey(file)], planFilter)
    );
  }, [planFilter, quota, showPlanFilter, statusFilteredFiles]);
  const orderedFiles = useMemo(
    () => stablePartitionEnabledCredentials(filteredFiles),
    [filteredFiles]
  );
  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    setLoading,
  } = useQuotaPagination(orderedFiles);

  useEffect(() => {
    const nextPageSize = Math.min(columns * 3, MAX_ITEMS_PER_PAGE);
    setPageSize(nextPageSize);
    onInventoryPageSizeChange?.(nextPageSize);
  }, [columns, onInventoryPageSizeChange, setPageSize]);

  useEffect(() => {
    onInventoryStatusChange?.(statusFilterMode);
  }, [onInventoryStatusChange, statusFilterMode]);

  const visibleItems = pageItems;

  useEffect(() => {
    onVisibleCredentialsChange?.(visibleItems);
  }, [onVisibleCredentialsChange, visibleItems]);

  const refreshTargets = useMemo(
    () => pageItems.filter((file) => file.disabled !== true),
    [pageItems]
  );
  const statusFilterOptions = useMemo(
    () =>
      [
        { value: 'all', label: t('auth_files.problem_filter_all') },
        { value: 'enabled', label: t('auth_files.problem_filter_enabled') },
        { value: 'disabled', label: t('auth_files.problem_filter_disabled') },
        { value: 'problem', label: t('auth_files.problem_filter_problem') },
      ] satisfies Array<{ value: QuotaStatusFilterMode; label: string }>,
    [t]
  );

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    if (refreshTargets.length === 0) return;
    loadQuota(refreshTargets, 'page', setLoading, refreshTargets.length);
  }, [loading, refreshTargets, loadQuota, setLoading]);

  useEffect(() => {
    if (loading) return;
    if (providerFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      providerFiles.forEach((file) => {
        const cacheKey = getQuotaCredentialCacheKey(file);
        const cached = prev[cacheKey];
        if (cached) {
          nextState[cacheKey] = cached;
        }
      });
      return nextState;
    });
  }, [providerFiles, loading, setQuota]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      const credentialCacheKey = getQuotaCredentialCacheKey(file);
      if (quota[credentialCacheKey]?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration();
      const previousState = quota[credentialCacheKey];

      setQuota((prev) => ({
        ...prev,
        [credentialCacheKey]: config.buildLoadingState(file, previousState),
      }));

      try {
        const resolved = await fetchQuotaWithIdentityRecovery({
          file,
          previousState,
          t,
          fetchQuota: config.fetchQuota,
          refreshInventory: async () => {
            await refreshAuthInventory(true);
          },
          getCurrentFiles: () => useAuthInventoryStore.getState().files,
        });
        const resolvedCacheKey = getQuotaCredentialCacheKey(resolved.file);
        commitIfQuotaCacheCurrent(
          cacheGeneration,
          () => {
            setQuota((prev) => {
              const next = { ...prev };
              if (resolvedCacheKey !== credentialCacheKey) {
                delete next[credentialCacheKey];
              }
              next[resolvedCacheKey] = config.buildSuccessState(resolved.data, resolved.file);
              return next;
            });
            showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
          },
          () =>
            (currentCredentialKeysRef.current.has(credentialCacheKey) ||
              currentCredentialKeysRef.current.has(resolvedCacheKey)) &&
            isQuotaCredentialCurrent(useAuthInventoryStore.getState().files, resolved.file)
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(
          cacheGeneration,
          () => {
            setQuota((prev) => ({
              ...prev,
              [credentialCacheKey]: config.buildErrorState(message, status, file, previousState),
            }));
            showNotification(
              t('auth_files.quota_refresh_failed', { name: file.name, message }),
              'error'
            );
          },
          () => currentCredentialKeysRef.current.has(credentialCacheKey)
        );
      }
    },
    [config, disabled, quota, refreshAuthInventory, setQuota, showNotification, t]
  );

  const resetQuotaForFile = useCallback(
    (file: AuthFileItem) => {
      const resetQuota = config.resetQuota;
      if (!resetQuota) return;
      if (disabled || file.disabled) return;
      const credentialCacheKey = getQuotaCredentialCacheKey(file);
      if (quota[credentialCacheKey]?.status === 'loading') return;
      if (resettingQuotaKey === credentialCacheKey) return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: file.name }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          if (!currentCredentialKeysRef.current.has(credentialCacheKey)) return;
          const cacheGeneration = captureQuotaCacheGeneration();
          const previousState = quota[credentialCacheKey];
          setResettingQuotaKey(credentialCacheKey);
          try {
            const data = await resetQuota(file, t, previousState);
            commitIfQuotaCacheCurrent(
              cacheGeneration,
              () => {
                setQuota((prev) => ({
                  ...prev,
                  [credentialCacheKey]: config.buildSuccessState(data, file),
                }));
                showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
              },
              () => currentCredentialKeysRef.current.has(credentialCacheKey)
            );
          } catch (err: unknown) {
            if (isCodexQuotaContextChangedError(err)) {
              await refreshAuthInventory(true).catch(() => undefined);
            }
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(
              cacheGeneration,
              () => {
                showNotification(
                  t('codex_quota.reset_failed', { name: file.name, message }),
                  'error'
                );
              },
              () => currentCredentialKeysRef.current.has(credentialCacheKey)
            );
          } finally {
            setResettingQuotaKey((current) => (current === credentialCacheKey ? null : current));
          }
        },
      });
    },
    [
      config,
      disabled,
      quota,
      refreshAuthInventory,
      resettingQuotaKey,
      setQuota,
      showConfirmation,
      showNotification,
      t,
    ]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {inventoryTotal > 0 && <span className={styles.countBadge}>{inventoryTotal}</span>}
    </div>
  );

  const isRefreshing = sectionLoading || loading;

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div
            className={styles.viewModeToggle}
            role="group"
            aria-label={t('auth_files.problem_filter_label')}
          >
            {statusFilterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.viewModeButton} ${
                  statusFilterMode === option.value ? styles.viewModeButtonActive : ''
                }`}
                onClick={() => setStatusFilterMode(option.value)}
                aria-pressed={statusFilterMode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          {showPlanFilter && (
            <div
              className={`${styles.viewModeToggle} ${styles.planFilterToggle}`}
              role="group"
              aria-label={t('auth_files.plan_filter_label')}
            >
              {planFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.viewModeButton} ${
                    planFilter === option.value ? styles.viewModeButtonActive : ''
                  }`}
                  onClick={() => setPlanFilter(option.value)}
                  aria-pressed={planFilter === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <TooltipButton
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing || refreshTargets.length === 0}
            loading={isRefreshing}
            label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
          </TooltipButton>
          {headerActionAfterRefresh}
        </div>
      }
    >
      {loading && providerFiles.length === 0 ? (
        <div className={styles.sectionState} role="status" aria-live="polite">
          <LoadingSpinner size={20} />
          <span>{t('common.loading')}</span>
        </div>
      ) : filteredFiles.length === 0 ? (
        <EmptyState
          title={
            providerFiles.length === 0
              ? t(`${config.i18nPrefix}.empty_title`)
              : t('auth_files.filtered_empty_title', { defaultValue: '暂无符合筛选的凭证' })
          }
          description={
            providerFiles.length === 0
              ? t(`${config.i18nPrefix}.empty_desc`)
              : t('auth_files.filtered_empty_desc', {
                  defaultValue: '请切换状态筛选或导入更多认证文件。',
                })
          }
        />
      ) : (
        <>
          <div ref={gridRef} className={config.gridClassName}>
            {visibleItems.map((item) => {
              const credentialCacheKey = getQuotaCredentialCacheKey(item);
              const credentialID = String(item.id ?? '').trim();
              const runtimeResource = credentialID
                ? runtimeResources[runtimeObservationResourceKey('credential', credentialID)]
                : undefined;
              const itemQuota = quota[credentialCacheKey];
              const credentialPlanType = showPlanFilter
                ? resolveQuotaCredentialPlan(item, itemQuota)
                : null;
              const credentialPlan = showPlanFilter
                ? {
                    type: credentialPlanType,
                    label: credentialPlanType
                      ? formatPlanFilterLabel(credentialPlanType, t)
                      : t('auth_files.plan_filter_unverified'),
                  }
                : undefined;
              const isResettingQuota = resettingQuotaKey === credentialCacheKey;
              const canUseQuotaAction =
                !disabled && !item.disabled && itemQuota?.status !== 'loading';
              const showResetQuotaAction =
                itemQuota !== undefined && Boolean(config.canResetQuota?.(itemQuota));
              const resetQuotaAction =
                config.resetQuota && showResetQuotaAction ? (
                  <TooltipButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={styles.quotaResetCreditButton}
                    onClick={() => resetQuotaForFile(item)}
                    disabled={!canUseQuotaAction || isResettingQuota}
                    loading={isResettingQuota}
                    label={t('codex_quota.reset_button')}
                  >
                    {!isResettingQuota && <IconRefreshCw size={14} />}
                    {t('codex_quota.reset_button')}
                  </TooltipButton>
                ) : undefined;

              return (
                <QuotaCard
                  key={item.name}
                  item={item}
                  runtimeResource={runtimeResource}
                  quota={itemQuota}
                  i18nPrefix={config.i18nPrefix}
                  cardIdleMessageKey={config.cardIdleMessageKey}
                  cardClassName={config.cardClassName}
                  defaultType={config.type}
                  canRefresh={canUseQuotaAction && !isResettingQuota}
                  onRefresh={() => void refreshQuotaForFile(item)}
                  actionDisabled={credentialActionDisabled}
                  selected={selectedCredentialNames?.has(item.name) === true}
                  deletingCredentialName={deletingCredentialName}
                  credentialStatusUpdating={credentialStatusUpdating}
                  onDownload={onDownloadCredential}
                  onShowModels={onShowCredentialModels}
                  onOpenSettings={onOpenCredentialSettings}
                  onDelete={onDeleteCredential}
                  onToggleStatus={onToggleCredentialStatus}
                  onToggleSelect={onToggleCredentialSelect}
                  resetQuotaAction={resetQuotaAction}
                  credentialPlan={credentialPlan}
                  renderQuotaItems={config.renderQuotaItems}
                />
              );
            })}
          </div>
          {filteredFiles.length > pageSize && (
            <div className={styles.pagination}>
              <Button variant="secondary" size="sm" onClick={goToPrev} disabled={currentPage <= 1}>
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length,
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
          {(inventoryHasPrevious || inventoryHasNext) && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={onInventoryPrevious}
                disabled={!inventoryHasPrevious || loading}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: inventoryPage,
                  total: Math.max(1, Math.ceil(inventoryTotal / Math.max(1, pageSize))),
                  count: inventoryTotal,
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={onInventoryNext}
                disabled={!inventoryHasNext || loading}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
