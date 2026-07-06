import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TooltipButton } from '@/components/ui/TooltipControls';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { normalizePlanType } from '@/utils/quota/parsers';
import { resolveCodexPlanType } from '@/utils/quota/resolvers';
import { hasAuthFileStatusMessage } from '@/features/authFiles/constants';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';
type StatusFilterMode = 'all' | 'enabled' | 'disabled' | 'problem';
type PlanAwareQuotaState = QuotaStatusState & { planType?: string | null };

const MAX_ITEMS_PER_PAGE = 25;
const ALL_VIEW_MIN_CHUNK_SIZE = 12;
const QUOTA_REFRESH_BATCH_SIZE = 6;
const PLAN_FILTER_ALL = 'all';
const PLAN_FILTER_UNVERIFIED = '__unverified__';

const resolveQuotaPlanType = (state: QuotaStatusState | undefined): string | null => {
  if (!state) return null;
  return normalizePlanType((state as PlanAwareQuotaState).planType);
};

const resolveFilePlanType = (file: AuthFileItem): string | null =>
  normalizePlanType(resolveCodexPlanType(file));

const resolvePlanFilterValue = (
  file: AuthFileItem,
  state: QuotaStatusState | undefined
): string => resolveQuotaPlanType(state) ?? resolveFilePlanType(file) ?? PLAN_FILTER_UNVERIFIED;

const formatPlanFilterLabel = (plan: string): string => {
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
  onDeleteCredential?: (name: string) => void;
  onToggleCredentialStatus?: (item: AuthFileItem, enabled: boolean) => void;
  onToggleCredentialSelect?: (name: string) => void;
  onVisibleCredentialsChange?: (items: AuthFileItem[]) => void;
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
  headerActionAfterRefresh,
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;
  const [columns, gridRef] = useGridColumns(380);
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [statusFilterMode, setStatusFilterMode] = useState<StatusFilterMode>('all');
  const [planFilter, setPlanFilter] = useState(PLAN_FILTER_ALL);
  const [visibleAllCount, setVisibleAllCount] = useState(0);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);
  const lazyLoadRef = useRef<HTMLDivElement | null>(null);
  const { quota, loadQuota } = useQuotaLoader(config);

  const providerFiles = useMemo(
    () => files.filter((file) => config.filterFn(file)),
    [files, config]
  );
  const isProblemCredential = useCallback(
    (file: AuthFileItem) => {
      const quotaStatus = quota[file.name]?.status;
      return hasAuthFileStatusMessage(file) || quotaStatus === 'error';
    },
    [quota]
  );
  const statusFilteredFiles = useMemo(
    () =>
      providerFiles.filter((file) => {
        if (statusFilterMode === 'enabled') return file.disabled !== true;
        if (statusFilterMode === 'disabled') return file.disabled === true;
        if (statusFilterMode === 'problem') return isProblemCredential(file);
        return true;
      }),
    [isProblemCredential, providerFiles, statusFilterMode]
  );

  const showPlanFilter = config.type === 'codex';

  const planFilterOptions = useMemo(() => {
    if (!showPlanFilter) return [];

    const counts = new Map<string, number>();
    statusFilteredFiles.forEach((file) => {
      const plan = resolvePlanFilterValue(file, quota[file.name]);
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
            : `${formatPlanFilterLabel(plan)} (${counts.get(plan) ?? 0})`,
      })),
    ];
  }, [planFilter, quota, showPlanFilter, statusFilteredFiles, t]);

  const filteredFiles = useMemo(() => {
    if (!showPlanFilter || planFilter === PLAN_FILTER_ALL) return statusFilteredFiles;
    return statusFilteredFiles.filter(
      (file) => resolvePlanFilterValue(file, quota[file.name]) === planFilter
    );
  }, [planFilter, quota, showPlanFilter, statusFilteredFiles]);
  const effectiveViewMode: ViewMode = viewMode;
  const allViewChunkSize = Math.max(ALL_VIEW_MIN_CHUNK_SIZE, columns * 3);

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
  } = useQuotaPagination(filteredFiles);

  useEffect(() => {
    setPageSize(Math.min(columns * 3, MAX_ITEMS_PER_PAGE));
  }, [columns, setPageSize]);

  useEffect(() => {
    if (effectiveViewMode !== 'all') {
      setVisibleAllCount(0);
      return;
    }
    setVisibleAllCount(Math.min(filteredFiles.length, allViewChunkSize));
  }, [allViewChunkSize, effectiveViewMode, filteredFiles.length, planFilter, statusFilterMode]);

  const visibleAllItems = useMemo(
    () => filteredFiles.slice(0, visibleAllCount),
    [filteredFiles, visibleAllCount]
  );
  const visibleItems = effectiveViewMode === 'all' ? visibleAllItems : pageItems;

  useEffect(() => {
    onVisibleCredentialsChange?.(visibleItems);
  }, [onVisibleCredentialsChange, visibleItems]);

  const canLoadMoreAll = effectiveViewMode === 'all' && visibleAllCount < filteredFiles.length;
  const loadMoreAll = useCallback(() => {
    setVisibleAllCount((current) =>
      Math.min(filteredFiles.length, Math.max(current, 0) + allViewChunkSize)
    );
  }, [allViewChunkSize, filteredFiles.length]);
  const refreshTargets = useMemo(() => {
    const targets = effectiveViewMode === 'all' ? filteredFiles : pageItems;
    return targets.filter((file) => file.disabled !== true);
  }, [effectiveViewMode, filteredFiles, pageItems]);
  const statusFilterOptions = useMemo(
    () =>
      [
        { value: 'all', label: t('auth_files.problem_filter_all') },
        { value: 'enabled', label: t('auth_files.problem_filter_enabled') },
        { value: 'disabled', label: t('auth_files.problem_filter_disabled') },
        { value: 'problem', label: t('auth_files.problem_filter_problem') },
      ] satisfies Array<{ value: StatusFilterMode; label: string }>,
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
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    if (refreshTargets.length === 0) return;
    loadQuota(
      refreshTargets,
      scope,
      setLoading,
      effectiveViewMode === 'all' ? QUOTA_REFRESH_BATCH_SIZE : refreshTargets.length
    );
  }, [loading, effectiveViewMode, refreshTargets, loadQuota, setLoading]);

  useEffect(() => {
    if (loading) return;
    if (providerFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      providerFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [providerFiles, loading, setQuota]);

  useEffect(() => {
    if (!canLoadMoreAll) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const target = lazyLoadRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreAll();
        }
      },
      { rootMargin: '360px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMoreAll, loadMoreAll]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState(),
      }));

      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const resetQuotaForFile = useCallback(
    (file: AuthFileItem) => {
      const resetQuota = config.resetQuota;
      if (!resetQuota) return;
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;
      if (resettingQuotaName === file.name) return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: file.name }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          setResettingQuotaName(file.name);
          try {
            const data = await resetQuota(file, t);
            setQuota((prev) => ({
              ...prev,
              [file.name]: config.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          } finally {
            setResettingQuotaName((current) => (current === file.name ? null : current));
          }
        },
      });
    },
    [config, disabled, quota, resettingQuotaName, setQuota, showConfirmation, showNotification, t]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>{filteredFiles.length}</span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <button
              type="button"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
              aria-pressed={effectiveViewMode === 'paged'}
            >
              {t('auth_files.view_mode_paged')}
            </button>
            <button
              type="button"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('all')}
              aria-pressed={effectiveViewMode === 'all'}
            >
              {t('auth_files.view_mode_all')}
            </button>
          </div>
          <div className={styles.viewModeToggle}>
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
      {filteredFiles.length === 0 ? (
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
              const itemQuota = quota[item.name];
              const isResettingQuota = resettingQuotaName === item.name;
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
                  renderQuotaItems={config.renderQuotaItems}
                />
              );
            })}
          </div>
          {filteredFiles.length > pageSize && effectiveViewMode === 'paged' && (
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
          {effectiveViewMode === 'all' && filteredFiles.length > visibleItems.length && (
            <div ref={lazyLoadRef} className={styles.pagination}>
              <div className={styles.pageInfo}>
                {t('auth_files.lazy_loaded_info', {
                  defaultValue: '已显示 {{current}} / {{total}} 个凭证',
                  current: visibleItems.length,
                  total: filteredFiles.length,
                })}
              </div>
              <Button variant="secondary" size="sm" onClick={loadMoreAll}>
                {t('auth_files.load_more', { defaultValue: '加载更多' })}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
