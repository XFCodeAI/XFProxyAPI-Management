import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
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
  requestMonitoringApi,
  type MonitoringIdentity,
  type MonitoringIdentityAggregate,
  type MonitoringRequest,
  type MonitoringResponse,
  type MonitoringRetention,
} from '@/services/api';
import {
  buildMonitoringRange,
  buildMonitoringRequestQuery,
  EMPTY_MONITORING_FILTERS,
  hasAdvancedMonitoringFilters,
  hasCurrentMonitoringTarget,
  hasMonitoringEvidence,
  isCurrentMonitoringIdentity,
  mergeMonitoringRequests,
  monitoringCacheRate,
  monitoringIdentityLabel,
  monitoringSuccessRate,
  parseMonitoringDrillQuery,
  type MonitoringFilters,
  type MonitoringTimeRange,
} from '@/features/requestMonitoring/viewModel';
import { useAuthStore, useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import { getErrorMessage } from '@/utils/helpers';
import styles from './RequestMonitoringPage.module.scss';

type MonitoringTab = 'credentials' | 'api_keys' | 'requests';

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
  currency.toUpperCase() === 'USD' ? `$${amount}` : `${amount} ${currency}`;

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

export function RequestMonitoringPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [initialDrillState] = useState(() =>
    parseMonitoringDrillQuery(`${location.pathname}${location.search}`)
  );
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [capabilityUnavailable, setCapabilityUnavailable] = useState(false);
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
  const deferredSearch = useDeferredValue(filters.search);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    hasAdvancedMonitoringFilters(initialDrillState.filters)
  );
  const [autoRefresh, setAutoRefresh] = useState('0');
  const [expandedRequestIDs, setExpandedRequestIDs] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const requestSequence = useRef(0);
  const activeRangeRef = useRef<{ from: string; to: string } | null>(null);
  const nextCursorRef = useRef('');
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retention, setRetention] = useState<MonitoringRetention | null>(null);
  const [retentionDays, setRetentionDays] = useState('90');
  const [retentionLoading, setRetentionLoading] = useState(false);

  const disabled = connectionStatus !== 'connected';
  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [deferredSearch, filters]
  );

  const buildCurrentRange = useCallback(
    () => buildMonitoringRange(timeRange, new Date(), customFrom, customTo),
    [customFrom, customTo, timeRange]
  );

  const loadMonitoring = useCallback(
    async (append = false) => {
      const range = append ? activeRangeRef.current : buildCurrentRange();
      if (!range) {
        setLoadError(t('request_monitoring.errors.invalid_range'));
        return;
      }
      const cursor = append ? nextCursorRef.current : '';
      if (append && !cursor) return;
      const sequence = ++requestSequence.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setLoadError('');
      try {
        const response = await requestMonitoringApi.get(
          buildMonitoringRequestQuery(range, effectiveFilters, cursor)
        );
        if (requestSequence.current !== sequence) return;
        setCapabilityUnavailable(false);
        activeRangeRef.current = range;
        nextCursorRef.current = response.nextCursor;
        setData((current) =>
          append && current
            ? {
                ...response,
                requests: mergeMonitoringRequests(current.requests, response.requests),
              }
            : response
        );
      } catch (error: unknown) {
        if (requestSequence.current !== sequence) return;
        if (isMonitoringCapabilityUnavailable(error)) {
          setCapabilityUnavailable(true);
          setData(null);
        } else {
          setCapabilityUnavailable(false);
          setLoadError(getErrorMessage(error, t('request_monitoring.errors.load')));
        }
      } finally {
        if (requestSequence.current === sequence) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildCurrentRange, effectiveFilters, t]
  );

  useEffect(() => {
    void loadMonitoring(false);
  }, [loadMonitoring]);

  useEffect(() => {
    const milliseconds = Number(autoRefresh);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || disabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadMonitoring(false);
    }, milliseconds);
    return () => window.clearInterval(timer);
  }, [autoRefresh, disabled, loadMonitoring]);

  const updateFilter = (field: keyof MonitoringFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const clearFilters = () => {
    setFilters(EMPTY_MONITORING_FILTERS);
    setAdvancedOpen(false);
  };

  const toggleExpanded = (id: string) => {
    setExpandedRequestIDs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const result = await requestMonitoringApi.import(file);
      showNotification(
        t('request_monitoring.notifications.imported', {
          added: result.added,
          skipped: result.skipped,
          failed: result.failed,
        }),
        result.failed > 0 ? 'warning' : 'success'
      );
      await loadMonitoring(false);
    } catch (error: unknown) {
      showNotification(
        `${t('request_monitoring.errors.import')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      setImporting(false);
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
      onConfirm: () => importFile(file),
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
          await loadMonitoring(false);
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

  const providerOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_providers') },
      ...(data?.facets.providers ?? []).map((entry) => ({
        value: entry.value,
        label: `${entry.value} (${formatNumber(entry.count, i18n.language)})`,
      })),
    ],
    [data?.facets.providers, i18n.language, t]
  );
  const modelOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_models') },
      ...(data?.facets.resolvedModels ?? []).map((entry) => ({
        value: entry.value,
        label: `${entry.value} (${formatNumber(entry.count, i18n.language)})`,
      })),
    ],
    [data?.facets.resolvedModels, i18n.language, t]
  );
  const requestedModelOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_models') },
      ...(data?.facets.requestedModels ?? []).map((entry) => ({
        value: entry.value,
        label: `${entry.value} (${formatNumber(entry.count, i18n.language)})`,
      })),
    ],
    [data?.facets.requestedModels, i18n.language, t]
  );
  const credentialOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_credentials') },
      ...(data?.credentials ?? [])
        .filter((entry) => entry.recordedId)
        .map((entry) => ({
          value: entry.recordedId,
          label: entry.displayName || entry.recordedId,
        })),
    ],
    [data?.credentials, t]
  );
  const apiKeyOptions = useMemo(
    () => [
      { value: 'all', label: t('request_monitoring.filters.all_api_keys') },
      ...(data?.apiKeys ?? [])
        .filter((entry) => entry.recordedId)
        .map((entry) => ({
          value: entry.recordedId,
          label: entry.displayName || t('request_monitoring.api_key_fallback'),
        })),
    ],
    [data?.apiKeys, t]
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

  const renderRequest = (request: MonitoringRequest) => {
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
            onClick={() => toggleExpanded(request.id)}
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
            {data
              ? t('request_monitoring.last_refresh', {
                  value: formatTime(data.generatedAt, i18n.language, t('common.not_set')),
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
            onClick={() => void loadMonitoring(false)}
            disabled={loading}
          >
            <RefreshCw size={16} />
          </TooltipIconButton>
          <TooltipIconButton
            label={t('request_monitoring.actions.export')}
            onClick={() => void exportData()}
            disabled={disabled || exporting || !data}
          >
            <Download size={16} />
          </TooltipIconButton>
          <TooltipIconButton
            label={t('request_monitoring.actions.import')}
            onClick={() => importInputRef.current?.click()}
            disabled={disabled || importing}
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
                ...(data?.facets.failureCategories ?? []).map((entry) => ({
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

      {loading && !data ? (
        <>
          <div className={styles.summaryStrip} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index}>
                <Skeleton width="50%" height={11} />
                <Skeleton width="70%" height={22} />
              </div>
            ))}
          </div>
          <Skeleton height={260} />
        </>
      ) : capabilityUnavailable ? (
        <section className={styles.statePanel}>
          <AlertTriangle size={22} />
          <div>
            <strong>{t('request_monitoring.states.unavailable_title')}</strong>
            <span>{t('request_monitoring.states.unavailable_description')}</span>
          </div>
        </section>
      ) : loadError && !data ? (
        <section className={styles.statePanel} role="alert">
          <AlertTriangle size={22} />
          <div>
            <strong>{t('request_monitoring.states.error_title')}</strong>
            <span>{loadError}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void loadMonitoring(false)}>
            <RefreshCw size={16} />
            {t('common.refresh')}
          </Button>
        </section>
      ) : data ? (
        <>
          {loadError ? (
            <div className={styles.inlineError} role="alert">
              <AlertTriangle size={15} />
              <span>{loadError}</span>
            </div>
          ) : null}
          <section
            className={styles.summaryStrip}
            aria-label={t('request_monitoring.summary.label')}
          >
            <div>
              <span>{t('request_monitoring.summary.requests')}</span>
              <strong>{formatNumber(data.summary.requests, i18n.language)}</strong>
            </div>
            <div>
              <span>{t('request_monitoring.summary.success_rate')}</span>
              <strong>{`${monitoringSuccessRate(data.summary).toFixed(1)}%`}</strong>
            </div>
            <div>
              <span>{t('request_monitoring.summary.estimated_cost')}</span>
              <strong>{formatCost(data.cost.amount, data.cost.currency)}</strong>
              <small>
                {data.cost.truncated ? t('request_monitoring.summary.cost_truncated') : ''}
              </small>
            </div>
            <div>
              <span>{t('request_monitoring.summary.tokens')}</span>
              <strong>{formatNumber(data.summary.totalTokens, i18n.language)}</strong>
            </div>
            <div>
              <span>{t('request_monitoring.summary.p95_latency')}</span>
              <strong>{formatDuration(data.summary.p95LatencyMs)}</strong>
            </div>
            <div>
              <span>{t('request_monitoring.summary.cache_rate')}</span>
              <strong>{`${monitoringCacheRate(data.summary).toFixed(1)}%`}</strong>
            </div>
          </section>

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
                      ? data.credentials.length
                      : tab === 'api_keys'
                        ? data.apiKeys.length
                        : data.summary.requests}
                  </span>
                </button>
              ))}
            </div>

            {activeTab === 'credentials'
              ? renderAggregateRows(data.credentials, 'credential')
              : null}
            {activeTab === 'api_keys' ? renderAggregateRows(data.apiKeys, 'api_key') : null}
            {activeTab === 'requests' ? (
              data.requests.length ? (
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
                  {data.requests.map(renderRequest)}
                  {data.nextCursor ? (
                    <div className={styles.loadMore}>
                      <Button
                        variant="secondary"
                        onClick={() => void loadMonitoring(true)}
                        loading={loadingMore}
                      >
                        {t('request_monitoring.actions.load_more')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState title={t('request_monitoring.empty.requests')} />
              )
            ) : null}
          </section>
        </>
      ) : null}

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
