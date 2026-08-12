import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  KeyRound,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import {
  isMonitoringCapabilityUnavailable,
  isMonitoringImportSessionsUnavailable,
  buildMonitoringQuery,
  requestMonitoringApi,
  type MonitoringIdentity,
  type MonitoringIdentityAggregate,
  type MonitoringRequest,
  type MonitoringQueryInput,
  type MonitoringRetention,
} from '@/services/api';
import {
  loadMonitoringTabSections,
  type MonitoringTab,
} from '@/features/requestMonitoring/loadMonitoringTabSections';
import { formatUsd } from '@/utils/format';
import {
  cancelMonitoringImportFile,
  isMonitoringImportCancelledError,
  isMonitoringImportPausedError,
  uploadMonitoringImportFile,
  type MonitoringImportProgress,
} from '@/features/requestMonitoring/importSession';
import { MonitoringImportProgressModal } from '@/features/requestMonitoring/MonitoringImportProgressModal';
import {
  buildMonitoringRange,
  buildMonitoringRequestQuery,
  EMPTY_MONITORING_FILTERS,
  hasAdvancedMonitoringFilters,
  hasCurrentMonitoringTarget,
  hasMonitoringEvidence,
  isCurrentMonitoringIdentity,
  mergeMonitoringCredentialRows,
  mergeMonitoringRequests,
  monitoringCacheRate,
  monitoringIdentityLabel,
  monitoringSuccessRate,
  parseMonitoringDrillQuery,
  type MonitoringFilters,
  type MonitoringTimeRange,
} from '@/features/requestMonitoring/viewModel';
import { reconcileCredentialIdentityCatalog } from '@/features/authFiles/credentialIdentityCatalog';
import { useDebouncedValue, useLatestAsyncSection } from '@/hooks';
import {
  authInventoryPageIsComplete,
  useAuthInventoryStore,
  useAuthStore,
  useNotificationStore,
} from '@/stores';
import { downloadBlob } from '@/utils/download';
import { getErrorMessage } from '@/utils/helpers';
import styles from './RequestMonitoringPage.module.scss';

const TIME_RANGES: MonitoringTimeRange[] = ['1h', '24h', '7d', '30d', 'custom'];
const AUTO_REFRESH_OPTIONS = ['0', '10000', '30000', '60000'];
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { notation: value >= 10000 ? 'compact' : 'standard' }).format(
    value
  );

const formatTime = (value: string | null, locale: string, fallback: string): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
};

const formatDuration = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 2)}s` : `${value}ms`;

const formatCost = (amount: string, currency: string): string =>
  currency.toUpperCase() === 'USD' ? formatUsd(amount) : `${amount} ${currency}`;

const toDateTimeLocal = (date: Date): string => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 23);
};

function IdentityStatus({ identity, missing }: { identity: MonitoringIdentity; missing: string }) {
  return (
    <span className={identity.current ? styles.identityCurrent : styles.identityHistorical}>
      {monitoringIdentityLabel(identity, missing)}
    </span>
  );
}

function SectionStatus({
  loading,
  error,
  updatedAt,
  onRetry,
}: {
  loading: boolean;
  error: string;
  updatedAt: string;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const stale = Boolean(updatedAt) && (loading || Boolean(error));
  const state = error ? 'error' : loading ? 'loading' : updatedAt ? 'fresh' : 'pending';
  const message = error
    ? stale
      ? t('request_monitoring.states.section_stale_error', { error })
      : error
    : loading
      ? t(
          stale
            ? 'request_monitoring.states.section_stale_loading'
            : 'request_monitoring.states.section_loading'
        )
      : updatedAt
        ? t('request_monitoring.states.section_fresh', {
            value: formatTime(updatedAt, i18n.language, t('common.not_set')),
          })
        : t('request_monitoring.status_pending');
  return (
    <div className={styles.sectionStatus} data-state={state} data-stale={stale} aria-live="polite">
      {error ? <AlertTriangle size={14} /> : <Clock3 size={14} />}
      <span>{message}</span>
      {error ? (
        <TooltipIconButton label={t('common.refresh')} onClick={onRetry}>
          <RefreshCw size={14} />
        </TooltipIconButton>
      ) : null}
    </div>
  );
}

export function RequestMonitoringPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [initialDrillState] = useState(() =>
    parseMonitoringDrillQuery(`${location.pathname}${location.search}`)
  );
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const authFiles = useAuthInventoryStore((state) => state.files);
  const authInventoryComplete = useAuthInventoryStore(authInventoryPageIsComplete);
  const credentialInventoryId = useAuthInventoryStore((state) => state.inventoryId);
  const credentialRevision = useAuthInventoryStore((state) => state.revision);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const summarySection =
    useLatestAsyncSection<Awaited<ReturnType<typeof requestMonitoringApi.getSummary>>>();
  const facetsSection =
    useLatestAsyncSection<Awaited<ReturnType<typeof requestMonitoringApi.getFacets>>>();
  const identitiesSection =
    useLatestAsyncSection<Awaited<ReturnType<typeof requestMonitoringApi.getIdentities>>>();
  const requestsSection =
    useLatestAsyncSection<Awaited<ReturnType<typeof requestMonitoringApi.getRequests>>>();
  const { run: runSummary } = summarySection;
  const { run: runFacets } = facetsSection;
  const { run: runIdentities, cancel: cancelIdentities } = identitiesSection;
  const { data: requestsSectionData, run: runRequests } = requestsSection;
  const { cancel: cancelRequests } = requestsSection;
  const [rangeError, setRangeError] = useState('');
  const [activeTab, setActiveTab] = useState<MonitoringTab>('requests');
  const [timeRange, setTimeRange] = useState<MonitoringTimeRange>(
    initialDrillState.range ? 'custom' : '24h'
  );
  const [customFrom, setCustomFrom] = useState(() =>
    initialDrillState.range
      ? toDateTimeLocal(new Date(initialDrillState.range.from))
      : toDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000))
  );
  const [customTo, setCustomTo] = useState(() =>
    initialDrillState.range
      ? toDateTimeLocal(new Date(initialDrillState.range.to))
      : toDateTimeLocal(new Date())
  );
  const [filters, setFilters] = useState<MonitoringFilters>(() => ({
    ...initialDrillState.filters,
  }));
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    hasAdvancedMonitoringFilters(initialDrillState.filters)
  );
  const [autoRefresh, setAutoRefresh] = useState('0');
  const [expandedRequestIDs, setExpandedRequestIDs] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importControlBusy, setImportControlBusy] = useState(false);
  const [importProgressOpen, setImportProgressOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<MonitoringImportProgress | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importFileRef = useRef<File | null>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const importRunRef = useRef(0);
  const activeQueryRef = useRef<MonitoringQueryInput | null>(null);
  const detailControllersRef = useRef(new Map<string, AbortController>());
  const [requestDetails, setRequestDetails] = useState<Record<string, MonitoringRequest>>({});
  const [detailLoadingIDs, setDetailLoadingIDs] = useState<Set<string>>(new Set());
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retention, setRetention] = useState<MonitoringRetention | null>(null);
  const [retentionDays, setRetentionDays] = useState('90');
  const [retentionLoading, setRetentionLoading] = useState(false);

  const disabled = connectionStatus !== 'connected';
  const requestCriteria = useMemo(
    () => ({ timeRange, customFrom, customTo, filters }),
    [customFrom, customTo, filters, timeRange]
  );
  const debouncedCriteria = useDebouncedValue(requestCriteria, 250);
  const effectiveFilters = debouncedCriteria.filters;

  const buildCurrentRange = useCallback(
    () => buildMonitoringRange(timeRange, new Date(), customFrom, customTo),
    [customFrom, customTo, timeRange]
  );

  const loadMonitoring = useCallback(async () => {
    const range = buildMonitoringRange(
      debouncedCriteria.timeRange,
      new Date(),
      debouncedCriteria.customFrom,
      debouncedCriteria.customTo
    );
    if (!range) {
      setRangeError(t('request_monitoring.errors.invalid_range'));
      return;
    }
    setRangeError('');
    const query = {
      ...buildMonitoringRequestQuery(range, debouncedCriteria.filters),
      snapshotAt: new Date().toISOString(),
    };
    activeQueryRef.current = query;
    const key = buildMonitoringQuery(query);
    if (activeTab === 'requests') cancelIdentities();
    else cancelRequests();
    await loadMonitoringTabSections(activeTab, {
      summary: () => runSummary(key, (signal) => requestMonitoringApi.getSummary(query, signal)),
      facets: () => runFacets(key, (signal) => requestMonitoringApi.getFacets(query, signal)),
      identities: () =>
        runIdentities(key, (signal) => requestMonitoringApi.getIdentities(query, signal)),
      requests: () => runRequests(key, (signal) => requestMonitoringApi.getRequests(query, signal)),
    });
  }, [
    activeTab,
    cancelIdentities,
    cancelRequests,
    debouncedCriteria,
    runFacets,
    runIdentities,
    runRequests,
    runSummary,
    t,
  ]);

  const refreshMonitoring = loadMonitoring;

  const loadMoreRequests = useCallback(async () => {
    const activeQuery = activeQueryRef.current;
    const current = requestsSectionData;
    if (!activeQuery || !current?.nextCursor) return;
    const query = { ...activeQuery, cursor: current.nextCursor };
    const key = buildMonitoringQuery(query);
    await runRequests(key, async (signal) => {
      const next = await requestMonitoringApi.getRequests(query, signal);
      return {
        ...next,
        requests: mergeMonitoringRequests(current.requests, next.requests),
      };
    });
  }, [requestsSectionData, runRequests]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshMonitoring(), 0);
    return () => window.clearTimeout(timer);
  }, [credentialInventoryId, credentialRevision, refreshMonitoring]);

  useEffect(
    () => () => {
      detailControllersRef.current.forEach((controller) => controller.abort());
      importRunRef.current += 1;
      importControllerRef.current?.abort();
    },
    []
  );

  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const milliseconds = Number(autoRefresh);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || disabled || !pageVisible) return;
    const timer = window.setInterval(() => {
      void refreshMonitoring();
    }, milliseconds);
    return () => window.clearInterval(timer);
  }, [autoRefresh, disabled, pageVisible, refreshMonitoring]);

  const updateFilter = (field: keyof MonitoringFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const clearFilters = () => {
    setFilters(EMPTY_MONITORING_FILTERS);
    setAdvancedOpen(false);
  };

  const loadRequestDetail = useCallback(
    async (request: MonitoringRequest) => {
      if (!request.hasDetails || requestDetails[request.id]) return;
      detailControllersRef.current.get(request.id)?.abort();
      const controller = new AbortController();
      detailControllersRef.current.set(request.id, controller);
      setDetailLoadingIDs((current) => new Set(current).add(request.id));
      setDetailErrors((current) => ({ ...current, [request.id]: '' }));
      try {
        const detail = await requestMonitoringApi.getRequest(request.id, controller.signal);
        if (!controller.signal.aborted) {
          setRequestDetails((current) => ({ ...current, [request.id]: detail }));
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setDetailErrors((current) => ({
            ...current,
            [request.id]: getErrorMessage(error, t('request_monitoring.errors.load_detail')),
          }));
        }
      } finally {
        if (detailControllersRef.current.get(request.id) === controller) {
          detailControllersRef.current.delete(request.id);
          setDetailLoadingIDs((current) => {
            const next = new Set(current);
            next.delete(request.id);
            return next;
          });
        }
      }
    },
    [requestDetails, t]
  );

  const toggleExpanded = (request: MonitoringRequest) => {
    const opening = !expandedRequestIDs.has(request.id);
    setExpandedRequestIDs((current) => {
      const next = new Set(current);
      if (next.has(request.id)) next.delete(request.id);
      else next.add(request.id);
      return next;
    });
    if (opening) void loadRequestDetail(request);
  };

  const focusAggregate = (kind: 'credential' | 'api_key', row: MonitoringIdentityAggregate) => {
    setFilters((current) => ({
      ...current,
      authId: kind === 'credential' ? row.recordedId || 'all' : current.authId,
      apiKeyId: kind === 'api_key' ? row.recordedId || 'all' : current.apiKeyId,
    }));
    setActiveTab('requests');
  };

  const exportData = async () => {
    const range = buildCurrentRange();
    if (!range) {
      showNotification(t('request_monitoring.errors.invalid_range'), 'error');
      return;
    }
    setExporting(true);
    try {
      const response = await requestMonitoringApi.export(
        buildMonitoringRequestQuery(range, effectiveFilters)
      );
      downloadBlob({ filename: 'xfpa-usage-events.jsonl', blob: response.data });
      showNotification(t('request_monitoring.notifications.exported'), 'success');
    } catch (error: unknown) {
      showNotification(
        `${t('request_monitoring.errors.export')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const showImportResult = (result: { added: number; skipped: number; failed: number }) => {
    showNotification(
      t('request_monitoring.notifications.imported', {
        added: result.added,
        skipped: result.skipped,
        failed: result.failed,
      }),
      result.failed > 0 ? 'warning' : 'success'
    );
  };

  const importFile = async (file: File) => {
    const runID = ++importRunRef.current;
    const controller = new AbortController();
    importControllerRef.current = controller;
    importFileRef.current = file;
    setImporting(true);
    setImportProgressOpen(true);
    let sessionStarted = false;
    try {
      let result: Awaited<ReturnType<typeof requestMonitoringApi.import>>;
      try {
        result = await uploadMonitoringImportFile({
          scope: apiBase,
          file,
          signal: controller.signal,
          onProgress: (nextProgress) => {
            if (nextProgress.sessionId) sessionStarted = true;
            if (importRunRef.current === runID) setImportProgress(nextProgress);
          },
        });
      } catch (error: unknown) {
        if (!sessionStarted && isMonitoringImportSessionsUnavailable(error)) {
          if (importRunRef.current === runID) {
            setImportProgress(null);
            setImportProgressOpen(false);
          }
          result = await requestMonitoringApi.import(file);
        } else {
          throw error;
        }
      }
      if (importRunRef.current !== runID) return;
      showImportResult(result);
      await refreshMonitoring();
      if (importRunRef.current === runID) importFileRef.current = null;
    } catch (error: unknown) {
      if (importRunRef.current !== runID) return;
      if (isMonitoringImportPausedError(error) || isMonitoringImportCancelledError(error)) return;
      showNotification(
        `${t('request_monitoring.errors.import')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      if (importRunRef.current === runID) {
        setImporting(false);
        if (importControllerRef.current === controller) importControllerRef.current = null;
      }
    }
  };

  const pauseImport = () => {
    importControllerRef.current?.abort();
  };

  const resumeImport = () => {
    const file = importFileRef.current;
    if (!file || importing || importControlBusy) return;
    void importFile(file);
  };

  const cancelImport = async () => {
    const sessionID = importProgress?.sessionId;
    if (!sessionID || importControlBusy) return;
    const runID = ++importRunRef.current;
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    setImporting(false);
    setImportControlBusy(true);
    setImportProgress((current) =>
      current ? { ...current, phase: 'paused', retryable: true } : current
    );
    try {
      const session = await cancelMonitoringImportFile({
        scope: apiBase,
        sessionId: sessionID,
        file: importFileRef.current ?? undefined,
      });
      if (importRunRef.current !== runID) return;
      if (session?.status === 'completed' && session.result) {
        setImportProgress({
          sessionId: session.id,
          filename: importProgress?.filename ?? session.filename,
          phase: 'completed',
          status: session.status,
          uploadedBytes: session.receivedBytes,
          totalBytes: session.sizeBytes,
          percent: 100,
          retryable: false,
          result: session.result,
        });
        showImportResult(session.result);
        await refreshMonitoring();
      } else {
        setImportProgress((current) =>
          current
            ? {
                ...current,
                phase: 'cancelled',
                status: session?.status ?? 'cancelled',
                retryable: false,
                error: undefined,
              }
            : current
        );
        showNotification(t('request_monitoring.notifications.import_cancelled'), 'success');
      }
      importFileRef.current = null;
    } catch (error: unknown) {
      if (importRunRef.current !== runID) return;
      showNotification(
        `${t('request_monitoring.errors.import_cancel')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      if (importRunRef.current === runID) setImportControlBusy(false);
    }
  };

  const closeImportProgress = () => {
    if (importing || importControlBusy) return;
    setImportProgressOpen(false);
    if (
      importProgress?.phase === 'completed' ||
      importProgress?.phase === 'cancelled' ||
      (importProgress?.phase === 'failed' && !importProgress.retryable)
    ) {
      setImportProgress(null);
      importFileRef.current = null;
    }
  };

  const onImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.jsonl') || file.size > MAX_IMPORT_BYTES) {
      showNotification(t('request_monitoring.errors.import_file'), 'error');
      return;
    }
    showConfirmation({
      title: t('request_monitoring.import_confirm.title'),
      message: t('request_monitoring.import_confirm.message', { name: file.name }),
      confirmText: t('request_monitoring.actions.import'),
      cancelText: t('common.cancel'),
      variant: 'primary',
      onConfirm: () => void importFile(file),
    });
  };

  const openRetention = async () => {
    setRetentionOpen(true);
    setRetentionLoading(true);
    try {
      const next = await requestMonitoringApi.getRetention();
      setRetention(next);
      setRetentionDays(String(next.days));
    } catch (error: unknown) {
      showNotification(
        `${t('request_monitoring.errors.retention')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      setRetentionLoading(false);
    }
  };

  const saveRetention = async () => {
    const days = Number(retentionDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
      showNotification(t('request_monitoring.retention.invalid'), 'error');
      return;
    }
    setRetentionLoading(true);
    try {
      const next = await requestMonitoringApi.setRetention(days);
      setRetention(next);
      showNotification(t('request_monitoring.notifications.retention_saved'), 'success');
    } catch (error: unknown) {
      showNotification(
        `${t('request_monitoring.errors.retention')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      setRetentionLoading(false);
    }
  };

  const runRetention = () => {
    showConfirmation({
      title: t('request_monitoring.retention.run_title'),
      message: t('request_monitoring.retention.run_message', { days: retentionDays }),
      confirmText: t('request_monitoring.retention.run'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setRetentionLoading(true);
        try {
          const result = await requestMonitoringApi.runRetention();
          const next = await requestMonitoringApi.getRetention();
          setRetention(next);
          showNotification(
            t('request_monitoring.notifications.retention_ran', {
              deleted: result.deleted,
              remaining: result.remaining,
            }),
            result.hasMore ? 'warning' : 'success'
          );
          await refreshMonitoring();
        } catch (error: unknown) {
          showNotification(
            `${t('request_monitoring.errors.retention')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
            'error'
          );
        } finally {
          setRetentionLoading(false);
        }
      },
    });
  };

  const summaryData = summarySection.data;
  const facetsData = facetsSection.data;
  const identitiesData = identitiesSection.data;
  const requestsData = requestsSection.data;
  const loading =
    summarySection.loading ||
    facetsSection.loading ||
    (activeTab === 'requests' ? requestsSection.loading : identitiesSection.loading);
  const sectionErrors = [
    summarySection.error,
    facetsSection.error,
    activeTab === 'requests' ? requestsSection.error : identitiesSection.error,
  ].filter((error): error is unknown => Boolean(error));
  const capabilityUnavailable =
    !summaryData &&
    !facetsData &&
    !(activeTab === 'requests' ? requestsData : identitiesData) &&
    sectionErrors.some(isMonitoringCapabilityUnavailable);
  const summaryError = summarySection.error
    ? getErrorMessage(summarySection.error, t('request_monitoring.errors.load_summary'))
    : '';
  const facetsError = facetsSection.error
    ? getErrorMessage(facetsSection.error, t('request_monitoring.errors.load_facets'))
    : '';
  const identitiesError = identitiesSection.error
    ? getErrorMessage(identitiesSection.error, t('request_monitoring.errors.load_identities'))
    : '';
  const requestsError = requestsSection.error
    ? getErrorMessage(requestsSection.error, t('request_monitoring.errors.load_requests'))
    : '';

  const providerOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_providers') },
      ...(facetsData?.facets.providers ?? []).map((entry) => ({
        value: entry.value,
        label: `${entry.value} (${formatNumber(entry.count, i18n.language)})`,
      })),
    ],
    [facetsData?.facets.providers, i18n.language, t]
  );
  const modelOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_models') },
      ...(facetsData?.facets.resolvedModels ?? []).map((entry) => ({
        value: entry.value,
        label: `${entry.value} (${formatNumber(entry.count, i18n.language)})`,
      })),
    ],
    [facetsData?.facets.resolvedModels, i18n.language, t]
  );
  const requestedModelOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_models') },
      ...(facetsData?.facets.requestedModels ?? []).map((entry) => ({
        value: entry.value,
        label: `${entry.value} (${formatNumber(entry.count, i18n.language)})`,
      })),
    ],
    [facetsData?.facets.requestedModels, i18n.language, t]
  );
  const credentialCatalog = useMemo(
    () =>
      reconcileCredentialIdentityCatalog(
        identitiesData?.credentialCatalog ?? [],
        authFiles,
        authInventoryComplete
      ),
    [authFiles, authInventoryComplete, identitiesData?.credentialCatalog]
  );
  const credentialRows = useMemo(
    () =>
      mergeMonitoringCredentialRows(
        identitiesData?.credentials ?? [],
        credentialCatalog,
        effectiveFilters
      ),
    [credentialCatalog, effectiveFilters, identitiesData?.credentials]
  );
  const credentialOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_credentials') },
      ...credentialCatalog.map((entry) => ({
        value: entry.recordedId,
        label: `${entry.displayName || entry.recordedId} (${t(
          entry.current
            ? 'request_monitoring.identity.current'
            : 'request_monitoring.identity.historical'
        )})`,
      })),
    ],
    [credentialCatalog, t]
  );
  const apiKeyOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_api_keys') },
      ...(identitiesData?.apiKeys ?? [])
        .filter((entry) => entry.recordedId)
        .map((entry) => ({
          value: entry.recordedId,
          label: entry.displayName || t('request_monitoring.api_key_fallback'),
        })),
    ],
    [identitiesData?.apiKeys, t]
  );

  const renderAggregateRows = (
    rows: MonitoringIdentityAggregate[],
    kind: 'credential' | 'api_key'
  ) => {
    if (rows.length === 0) {
      return (
        <EmptyState
          title={t(
            `request_monitoring.empty.${kind === 'credential' ? 'credentials' : 'api_keys'}`
          )}
        />
      );
    }
    return (
      <div className={styles.aggregateList}>
        <div className={styles.aggregateHead}>
          <span>{t(`request_monitoring.columns.${kind}`)}</span>
          <span>{t('request_monitoring.columns.requests')}</span>
          <span>{t('request_monitoring.columns.failures')}</span>
          <span>{t('request_monitoring.columns.tokens')}</span>
          <span>{t('request_monitoring.columns.latency')}</span>
          <span>{t('common.action')}</span>
        </div>
        {rows.map((row) => (
          <div className={styles.aggregateRow} key={`${kind}:${row.recordedId}:${row.displayName}`}>
            <div className={styles.aggregateIdentity}>
              {kind === 'credential' ? <UserRound size={16} /> : <KeyRound size={16} />}
              <div>
                <strong>{row.displayName || t(`request_monitoring.${kind}_fallback`)}</strong>
                <span data-current={row.current}>
                  {row.current
                    ? t('request_monitoring.identity.current')
                    : t('request_monitoring.identity.historical')}
                </span>
              </div>
            </div>
            <strong>{formatNumber(row.requests, i18n.language)}</strong>
            <span data-failure={row.failures > 0}>{formatNumber(row.failures, i18n.language)}</span>
            <span>{formatNumber(row.totalTokens, i18n.language)}</span>
            <span>{formatDuration(row.averageLatencyMs)}</span>
            <div className={styles.rowActions}>
              <TooltipIconButton
                label={t('request_monitoring.actions.filter_requests')}
                onClick={() => focusAggregate(kind, row)}
                disabled={!row.recordedId}
              >
                <Filter size={16} />
              </TooltipIconButton>
              {isCurrentMonitoringIdentity(row) ? (
                <TooltipIconButton
                  label={t('request_monitoring.actions.open_current')}
                  onClick={() => navigate(kind === 'credential' ? '/quota' : '/config')}
                >
                  <ExternalLink size={16} />
                </TooltipIconButton>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderRequest = (listRequest: MonitoringRequest) => {
    const request = requestDetails[listRequest.id] ?? listRequest;
    const expanded = expandedRequestIDs.has(request.id);
    const credential = request.identities.credential;
    const apiKey = request.identities.apiKey;
    const expandable = hasMonitoringEvidence(request);
    return (
      <div
        className={styles.requestRow}
        data-failed={request.result === 'failure'}
        key={request.id}
      >
        <div className={styles.requestMain}>
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => toggleExpanded(listRequest)}
            disabled={!expandable}
            aria-label={t(expanded ? 'common.collapse' : 'common.expand')}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className={styles.requestTime}>
            <strong>{formatTime(request.requestedAt, i18n.language, t('common.not_set'))}</strong>
            <span>{request.provider || t('common.not_set')}</span>
          </div>
          <div className={styles.requestModel}>
            <strong>
              {request.resolvedModel || request.requestedModel || t('common.not_set')}
            </strong>
            {request.requestedModel && request.requestedModel !== request.resolvedModel ? (
              <span>{request.requestedModel}</span>
            ) : null}
          </div>
          <div className={styles.requestIdentity}>
            <IdentityStatus
              identity={credential}
              missing={t('request_monitoring.credential_fallback')}
            />
            <IdentityStatus identity={apiKey} missing={t('request_monitoring.api_key_fallback')} />
          </div>
          <div className={styles.requestUsage}>
            <strong>{formatNumber(request.tokens.total, i18n.language)}</strong>
            <span>{formatDuration(request.latencyMs)}</span>
          </div>
          <div className={styles.requestCost}>
            <strong>{formatCost(request.cost.amount, request.cost.currency)}</strong>
            <span data-coverage={request.cost.coverage}>{request.cost.coverage}</span>
          </div>
          <div className={styles.requestStatus} data-result={request.result}>
            <span>{t(`request_monitoring.result.${request.result}`)}</span>
            <strong>{request.statusCode || '-'}</strong>
          </div>
        </div>
        {expanded ? (
          <div className={styles.requestDetails}>
            {detailLoadingIDs.has(request.id) ? (
              <div className={styles.detailStatus}>
                {t('request_monitoring.states.detail_loading')}
              </div>
            ) : detailErrors[request.id] ? (
              <div className={styles.detailStatus} data-error="true" role="alert">
                {detailErrors[request.id]}
              </div>
            ) : null}
            <div className={styles.detailBlock}>
              <span>{t('request_monitoring.details.request_id')}</span>
              <code>{request.requestId || request.id}</code>
              <span>{t('request_monitoring.details.failure')}</span>
              <strong>
                {request.failureCategory || t('request_monitoring.details.no_failure')} /{' '}
                {request.statusCode || '-'}
              </strong>
            </div>
            <div className={styles.detailBlock}>
              <span>{t('request_monitoring.details.token_breakdown')}</span>
              <strong>
                {t('request_monitoring.details.token_value', {
                  input: request.tokens.input,
                  output: request.tokens.output,
                  reasoning: request.tokens.reasoning,
                  cache: Math.max(request.tokens.cached, request.tokens.cacheRead),
                })}
              </strong>
              <span>{t('request_monitoring.details.timing')}</span>
              <strong>{`TTFT ${formatDuration(request.ttftMs)} / ${formatDuration(request.latencyMs)}`}</strong>
            </div>
            <div className={styles.detailBlock}>
              <span>{t('request_monitoring.details.current_targets')}</span>
              <div className={styles.targetLinks}>
                {isCurrentMonitoringIdentity(credential) ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate('/quota')}>
                    <UserRound size={15} />
                    {t('nav.credential_quota')}
                  </Button>
                ) : null}
                {isCurrentMonitoringIdentity(apiKey) ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate('/config')}>
                    <KeyRound size={15} />
                    {t('nav.api_keys')}
                  </Button>
                ) : null}
                {request.identities.credentialGroups.some(isCurrentMonitoringIdentity) ||
                request.identities.apiKeyGroups.some(isCurrentMonitoringIdentity) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate('/credential-groups')}
                  >
                    <ExternalLink size={15} />
                    {t('nav.credential_groups')}
                  </Button>
                ) : null}
                {isCurrentMonitoringIdentity(request.identities.source) ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate('/ai-providers')}>
                    <ExternalLink size={15} />
                    {t('nav.ai_providers')}
                  </Button>
                ) : null}
                {isCurrentMonitoringIdentity(request.identities.proxyPool) ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate('/proxy-pools')}>
                    <ExternalLink size={15} />
                    {t('nav.proxy_pools')}
                  </Button>
                ) : null}
                {isCurrentMonitoringIdentity(request.identities.plugin) ? (
                  <Button size="sm" variant="secondary" onClick={() => navigate('/plugins')}>
                    <ExternalLink size={15} />
                    {t('nav.plugins')}
                  </Button>
                ) : null}
                {!hasCurrentMonitoringTarget(request) ? (
                  <span>{t('request_monitoring.details.no_current_targets')}</span>
                ) : null}
              </div>
            </div>
            <div className={styles.headerEvidence}>
              <span>{t('request_monitoring.details.safe_headers')}</span>
              {Object.keys(request.responseHeaders).length ? (
                <dl>
                  {Object.entries(request.responseHeaders).map(([key, values]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{values.join(', ')}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <strong>{t('request_monitoring.details.no_headers')}</strong>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t('request_monitoring.title')}</h1>
          <span>
            {(summaryData ?? requestsData)
              ? t('request_monitoring.last_refresh', {
                  value: formatTime(
                    summaryData?.generatedAt ?? requestsData?.generatedAt ?? null,
                    i18n.language,
                    t('common.not_set')
                  ),
                })
              : t('request_monitoring.status_pending')}
          </span>
        </div>
        <div className={styles.headerActions}>
          <input
            ref={importInputRef}
            type="file"
            accept=".jsonl,application/x-ndjson"
            onChange={onImportChange}
            hidden
          />
          <Select
            value={autoRefresh}
            options={AUTO_REFRESH_OPTIONS.map((value) => ({
              value,
              label: t(`request_monitoring.auto_refresh.${value}`),
            }))}
            onChange={setAutoRefresh}
            ariaLabel={t('request_monitoring.auto_refresh.label')}
            fullWidth={false}
            size="sm"
          />
          <TooltipIconButton
            label={t('common.refresh')}
            onClick={() => void refreshMonitoring()}
            disabled={loading}
          >
            <RefreshCw size={16} />
          </TooltipIconButton>
          <TooltipIconButton
            label={t('request_monitoring.actions.export')}
            onClick={() => void exportData()}
            disabled={disabled || exporting || (!summaryData && !requestsData)}
          >
            <Download size={16} />
          </TooltipIconButton>
          <TooltipIconButton
            label={t('request_monitoring.actions.import')}
            onClick={() => importInputRef.current?.click()}
            disabled={disabled || importing || importControlBusy}
          >
            <Upload size={16} />
          </TooltipIconButton>
          <TooltipIconButton
            label={t('request_monitoring.actions.retention')}
            onClick={() => void openRetention()}
            disabled={disabled}
          >
            <Archive size={16} />
          </TooltipIconButton>
        </div>
      </header>

      <section className={styles.filtersPanel}>
        <div
          className={styles.rangeControl}
          aria-label={t('request_monitoring.filters.time_range')}
        >
          {TIME_RANGES.map((range) => (
            <button
              type="button"
              key={range}
              data-active={timeRange === range}
              onClick={() => setTimeRange(range)}
            >
              {t(`request_monitoring.ranges.${range}`)}
            </button>
          ))}
        </div>
        <div className={styles.searchField}>
          <Input
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder={t('request_monitoring.filters.search')}
            rightElement={<Search size={16} />}
            aria-label={t('request_monitoring.filters.search')}
          />
        </div>
        <Select
          value={filters.provider}
          options={providerOptions}
          onChange={(value) => updateFilter('provider', value)}
          ariaLabel={t('request_monitoring.filters.provider')}
        />
        <Select
          value={filters.result}
          options={[
            { value: 'all', label: t('request_monitoring.filters.all_results') },
            { value: 'success', label: t('request_monitoring.result.success') },
            { value: 'failure', label: t('request_monitoring.result.failure') },
          ]}
          onChange={(value) => updateFilter('result', value)}
          ariaLabel={t('request_monitoring.filters.result')}
        />
        <Button
          variant={advancedOpen ? 'primary' : 'secondary'}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          <Filter size={16} />
          {t('request_monitoring.filters.advanced')}
        </Button>
        <TooltipIconButton label={t('request_monitoring.filters.clear')} onClick={clearFilters}>
          <X size={16} />
        </TooltipIconButton>

        {timeRange === 'custom' ? (
          <div className={styles.customRange}>
            <Input
              type="datetime-local"
              step="0.001"
              label={t('request_monitoring.filters.from')}
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <Input
              type="datetime-local"
              step="0.001"
              label={t('request_monitoring.filters.to')}
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </div>
        ) : null}

        {advancedOpen ? (
          <div className={styles.advancedFilters}>
            <Select
              value={filters.resolvedModel}
              options={modelOptions}
              onChange={(value) => updateFilter('resolvedModel', value)}
              ariaLabel={t('request_monitoring.filters.model')}
            />
            <Select
              value={filters.requestedModel}
              options={requestedModelOptions}
              onChange={(value) => updateFilter('requestedModel', value)}
              ariaLabel={t('model_prices.fields.requested_model')}
            />
            <Input
              value={filters.pluginId}
              onChange={(event) => updateFilter('pluginId', event.target.value)}
              placeholder={t('nav.plugins')}
              aria-label={t('nav.plugins')}
            />
            <Select
              value={filters.authId}
              options={credentialOptions}
              onChange={(value) => updateFilter('authId', value)}
              ariaLabel={t('request_monitoring.filters.credential')}
            />
            <Input
              value={filters.credentialGroupId}
              onChange={(event) => updateFilter('credentialGroupId', event.target.value)}
              placeholder={t('config_management.visual.api_keys.credential_groups_label')}
              aria-label={t('config_management.visual.api_keys.credential_groups_label')}
            />
            <Select
              value={filters.apiKeyId}
              options={apiKeyOptions}
              onChange={(value) => updateFilter('apiKeyId', value)}
              ariaLabel={t('request_monitoring.filters.api_key')}
            />
            <Input
              value={filters.apiKeyGroupId}
              onChange={(event) => updateFilter('apiKeyGroupId', event.target.value)}
              placeholder={t('request_monitoring.filters.api_key_group', {
                defaultValue: 'api_key_group_id',
              })}
              aria-label={t('request_monitoring.filters.api_key_group', {
                defaultValue: 'api_key_group_id',
              })}
            />
            <Input
              value={filters.proxyPoolId}
              onChange={(event) => updateFilter('proxyPoolId', event.target.value)}
              placeholder={t('nav.proxy_pools')}
              aria-label={t('nav.proxy_pools')}
            />
            <Select
              value={filters.failureCategory}
              options={[
                { value: 'all', label: t('request_monitoring.filters.all_failures') },
                ...(facetsData?.facets.failureCategories ?? []).map((entry) => ({
                  value: entry.value,
                  label: entry.value,
                })),
              ]}
              onChange={(value) => updateFilter('failureCategory', value)}
              ariaLabel={t('request_monitoring.filters.failure_category')}
            />
            <Select
              value={filters.cache}
              options={[
                { value: 'all', label: t('request_monitoring.filters.cache_all') },
                { value: 'hit', label: t('request_monitoring.filters.cache_hit') },
                { value: 'miss', label: t('request_monitoring.filters.cache_miss') },
              ]}
              onChange={(value) => updateFilter('cache', value)}
              ariaLabel={t('request_monitoring.filters.cache')}
            />
            <Input
              value={filters.statusCode}
              onChange={(event) => updateFilter('statusCode', event.target.value)}
              placeholder={t('common.status')}
              aria-label={t('common.status')}
              inputMode="numeric"
            />
            <Input
              value={filters.minLatencyMs}
              onChange={(event) => updateFilter('minLatencyMs', event.target.value)}
              placeholder={t('request_monitoring.filters.min_latency')}
              inputMode="numeric"
            />
            <Input
              value={filters.maxLatencyMs}
              onChange={(event) => updateFilter('maxLatencyMs', event.target.value)}
              placeholder={t('request_monitoring.filters.max_latency', {
                defaultValue: 'max_latency_ms',
              })}
              aria-label={t('request_monitoring.filters.max_latency', {
                defaultValue: 'max_latency_ms',
              })}
              inputMode="numeric"
            />
            <Input
              value={filters.requestId}
              onChange={(event) => updateFilter('requestId', event.target.value)}
              placeholder={t('request_monitoring.filters.request_id')}
            />
            <Input
              value={filters.trace}
              onChange={(event) => updateFilter('trace', event.target.value)}
              placeholder={t('request_monitoring.filters.trace')}
            />
          </div>
        ) : null}
      </section>

      <SectionStatus
        loading={facetsSection.loading}
        error={facetsError}
        updatedAt={facetsData?.generatedAt ?? ''}
        onRetry={() => void refreshMonitoring()}
      />

      {rangeError ? (
        <div className={styles.inlineError} role="alert">
          <AlertTriangle size={15} />
          <span>{rangeError}</span>
        </div>
      ) : null}

      {capabilityUnavailable ? (
        <section className={styles.statePanel}>
          <AlertTriangle size={22} />
          <div>
            <strong>{t('request_monitoring.states.unavailable_title')}</strong>
            <span>{t('request_monitoring.states.unavailable_description')}</span>
          </div>
        </section>
      ) : (
        <>
          <SectionStatus
            loading={summarySection.loading}
            error={summaryError}
            updatedAt={summaryData?.generatedAt ?? ''}
            onRetry={() => void refreshMonitoring()}
          />
          {summaryData ? (
            <section
              className={styles.summaryStrip}
              aria-label={t('request_monitoring.summary.label')}
            >
              <div>
                <span>{t('request_monitoring.summary.requests')}</span>
                <strong>{formatNumber(summaryData.summary.requests, i18n.language)}</strong>
              </div>
              <div>
                <span>{t('request_monitoring.summary.success_rate')}</span>
                <strong>{`${monitoringSuccessRate(summaryData.summary).toFixed(1)}%`}</strong>
              </div>
              <div>
                <span>{t('request_monitoring.summary.estimated_cost')}</span>
                <strong>{formatCost(summaryData.cost.amount, summaryData.cost.currency)}</strong>
                <small>
                  {summaryData.cost.truncated ? t('request_monitoring.summary.cost_truncated') : ''}
                </small>
              </div>
              <div>
                <span>{t('request_monitoring.summary.tokens')}</span>
                <strong>{formatNumber(summaryData.summary.totalTokens, i18n.language)}</strong>
              </div>
              <div>
                <span>{t('request_monitoring.summary.p95_latency')}</span>
                <strong>{formatDuration(summaryData.summary.p95LatencyMs)}</strong>
              </div>
              <div>
                <span>{t('request_monitoring.summary.cache_rate')}</span>
                <strong>{`${monitoringCacheRate(summaryData.summary).toFixed(1)}%`}</strong>
              </div>
            </section>
          ) : summarySection.loading || !summaryError ? (
            <div className={styles.summaryStrip} aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div key={index}>
                  <Skeleton width="50%" height={11} />
                  <Skeleton width="70%" height={22} />
                </div>
              ))}
            </div>
          ) : null}

          <section className={styles.dataPanel}>
            <div className={styles.tabsBar} role="tablist">
              {(['credentials', 'api_keys', 'requests'] as MonitoringTab[]).map((tab) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  data-active={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  key={tab}
                >
                  {tab === 'credentials' ? <UserRound size={16} /> : null}
                  {tab === 'api_keys' ? <KeyRound size={16} /> : null}
                  {tab === 'requests' ? <Activity size={16} /> : null}
                  {t(`request_monitoring.tabs.${tab}`)}
                  <span>
                    {tab === 'credentials'
                      ? credentialRows.length
                      : tab === 'api_keys'
                        ? (identitiesData?.apiKeys.length ?? 0)
                        : (summaryData?.summary.requests ?? requestsData?.requests.length ?? 0)}
                  </span>
                </button>
              ))}
            </div>

            {activeTab !== 'requests' ? (
              <SectionStatus
                loading={identitiesSection.loading}
                error={identitiesError}
                updatedAt={identitiesData?.generatedAt ?? ''}
                onRetry={() => void refreshMonitoring()}
              />
            ) : (
              <SectionStatus
                loading={requestsSection.loading}
                error={requestsError}
                updatedAt={requestsData?.generatedAt ?? ''}
                onRetry={() => void refreshMonitoring()}
              />
            )}
            {activeTab === 'credentials' && identitiesData
              ? renderAggregateRows(credentialRows, 'credential')
              : null}
            {activeTab === 'api_keys' && identitiesData
              ? renderAggregateRows(identitiesData.apiKeys, 'api_key')
              : null}
            {activeTab !== 'requests' && !identitiesData ? <Skeleton height={260} /> : null}
            {activeTab === 'requests' ? (
              requestsData?.requests.length ? (
                <div className={styles.requestList}>
                  <div className={styles.requestHead}>
                    <span />
                    <span>{t('request_monitoring.columns.time_provider')}</span>
                    <span>{t('request_monitoring.columns.model')}</span>
                    <span>{t('request_monitoring.columns.identities')}</span>
                    <span>{t('request_monitoring.columns.tokens_latency')}</span>
                    <span>{t('request_monitoring.columns.cost')}</span>
                    <span>{t('request_monitoring.columns.status')}</span>
                  </div>
                  {requestsData.requests.map(renderRequest)}
                  {requestsData.nextCursor ? (
                    <div className={styles.loadMore}>
                      <Button
                        variant="secondary"
                        onClick={() => void loadMoreRequests()}
                        loading={requestsSection.loading}
                      >
                        {t('request_monitoring.actions.load_more')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : requestsData ? (
                <EmptyState title={t('request_monitoring.empty.requests')} />
              ) : (
                <Skeleton height={260} />
              )
            ) : null}
          </section>
        </>
      )}

      <MonitoringImportProgressModal
        open={importProgressOpen}
        progress={importProgress}
        busy={importControlBusy}
        onPause={pauseImport}
        onResume={resumeImport}
        onCancel={() => void cancelImport()}
        onClose={closeImportProgress}
      />

      <Modal
        open={retentionOpen}
        onClose={() => setRetentionOpen(false)}
        closeDisabled={retentionLoading}
        title={t('request_monitoring.retention.title')}
        width={560}
        footer={
          <>
            <Button
              variant="danger"
              onClick={runRetention}
              disabled={retentionLoading || !retention}
            >
              <Trash2 size={16} />
              {t('request_monitoring.retention.run')}
            </Button>
            <Button variant="secondary" onClick={() => setRetentionOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveRetention()} loading={retentionLoading}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {retentionLoading && !retention ? (
          <Skeleton height={180} />
        ) : (
          <div className={styles.retentionBody}>
            <Input
              label={t('request_monitoring.retention.days')}
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
              inputMode="numeric"
              placeholder="90"
            />
            <div className={styles.retentionStats}>
              <div>
                <span>{t('request_monitoring.retention.events')}</span>
                <strong>{formatNumber(retention?.eventCount ?? 0, i18n.language)}</strong>
              </div>
              <div>
                <span>{t('request_monitoring.retention.oldest')}</span>
                <strong>
                  {formatTime(retention?.oldestAt ?? null, i18n.language, t('common.not_set'))}
                </strong>
              </div>
            </div>
            <div className={styles.retentionNotice}>
              <Clock3 size={16} />
              <span>{t('request_monitoring.retention.bound')}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
