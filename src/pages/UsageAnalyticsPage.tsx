import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CircleDollarSign,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import {
  buildMonitoringDrillHref,
  buildMonitoringRange,
  EMPTY_MONITORING_FILTERS,
  hasAdvancedMonitoringFilters,
  parseMonitoringDrillQuery,
  type MonitoringFilters,
  type MonitoringTimeRange,
} from '@/features/requestMonitoring/viewModel';
import {
  ANALYTICS_TABS,
  analyticsAnomalyRange,
  analyticsDelta,
  analyticsIdentityLabel,
  analyticsMetricValue,
  analyticsRankingFilters,
  analyticsSuccessRate,
  analyticsViewForTab,
  buildAnalyticsRequestQuery,
  type AnalyticsChartMetric,
  type AnalyticsGroupView,
  type AnalyticsTab,
} from '@/features/usageAnalytics/viewModel';
import {
  isAnalyticsCapabilityUnavailable,
  usageAnalyticsApi,
  type AnalyticsBucket,
  type AnalyticsGranularity,
  type AnalyticsReport,
} from '@/services/api';
import { useAuthStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import styles from './UsageAnalyticsPage.module.scss';

const TIME_RANGES: MonitoringTimeRange[] = ['1h', '24h', '7d', '30d', 'custom'];
const CHART_METRICS: AnalyticsChartMetric[] = ['calls', 'tokens', 'cost', 'failures', 'latency'];

const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 2,
  }).format(value);

const formatDuration = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 2)}s` : `${value}ms`;

const formatCost = (amount: string, currency = 'USD'): string => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: numeric >= 1 ? 2 : 4,
    maximumFractionDigits: numeric >= 1 ? 2 : 6,
  }).format(numeric);
};

const formatTime = (value: string, locale: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const toDateTimeLocal = (date: Date): string => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 23);
};

const parseInitialView = (source: string): { tab: AnalyticsTab; group: AnalyticsGroupView } => {
  const params = new URLSearchParams(source);
  const view = params.get('view');
  if (view === 'credential-groups' || view === 'api-key-groups') {
    return { tab: 'groups', group: view };
  }
  const tab = view === 'api-keys' ? 'api_keys' : view;
  return ANALYTICS_TABS.includes(tab as AnalyticsTab)
    ? { tab: tab as AnalyticsTab, group: 'credential-groups' }
    : { tab: 'overview', group: 'credential-groups' };
};

const Delta = ({ value }: { value: number | null }) => {
  const { t } = useTranslation();
  if (value === null) return <small>{t('usage_analytics.comparison.new')}</small>;
  const rounded = Math.abs(value * 100).toFixed(Math.abs(value) >= 0.1 ? 0 : 1);
  return (
    <small data-direction={value > 0 ? 'up' : value < 0 ? 'down' : 'same'}>
      {value > 0 ? '+' : value < 0 ? '-' : ''}
      {rounded}%
    </small>
  );
};

function TrendChart({
  current,
  comparison,
  metric,
  locale,
}: {
  current: AnalyticsBucket[];
  comparison: AnalyticsBucket[];
  metric: AnalyticsChartMetric;
  locale: string;
}) {
  const { t } = useTranslation();
  const width = 960;
  const height = 280;
  const padding = { top: 20, right: 18, bottom: 38, left: 64 };
  const currentValues = current.map((bucket) => analyticsMetricValue(bucket.metrics, metric));
  const comparisonValues = comparison.map((bucket) => analyticsMetricValue(bucket.metrics, metric));
  const maximum = Math.max(1, ...currentValues, ...comparisonValues);
  const toPoints = (values: number[]): string => {
    if (values.length === 0) return '';
    const usableWidth = width - padding.left - padding.right;
    const usableHeight = height - padding.top - padding.bottom;
    return values
      .map((value, index) => {
        const x =
          padding.left +
          (values.length === 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth);
        const y = padding.top + usableHeight - (value / maximum) * usableHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  };
  const formatMetric = (value: number): string => {
    if (metric === 'cost') return formatCost(String(value));
    if (metric === 'latency') return formatDuration(value);
    return formatNumber(value, locale);
  };

  return (
    <div className={styles.chartFrame}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('usage_analytics.chart.aria', {
          metric: t(`usage_analytics.metrics.${metric}`),
        })}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + (1 - ratio) * (height - padding.top - padding.bottom);
          return (
            <g key={ratio}>
              <line
                className={styles.chartGrid}
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text
                className={styles.chartAxisText}
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
              >
                {formatMetric(maximum * ratio)}
              </text>
            </g>
          );
        })}
        {comparisonValues.length ? (
          <polyline className={styles.comparisonLine} points={toPoints(comparisonValues)} />
        ) : null}
        {currentValues.length ? (
          <polyline className={styles.currentLine} points={toPoints(currentValues)} />
        ) : null}
        {current.map((bucket, index) => {
          const values = currentValues;
          const usableWidth = width - padding.left - padding.right;
          const usableHeight = height - padding.top - padding.bottom;
          const x =
            padding.left +
            (values.length === 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth);
          const y = padding.top + usableHeight - (values[index] / maximum) * usableHeight;
          return (
            <circle className={styles.chartPoint} cx={x} cy={y} r="3.5" key={bucket.start}>
              <title>{`${formatTime(bucket.start, locale)}: ${formatMetric(values[index])}`}</title>
            </circle>
          );
        })}
        {current.length ? (
          <>
            <text
              className={styles.chartAxisText}
              x={padding.left}
              y={height - 10}
              textAnchor="start"
            >
              {formatTime(current[0].start, locale)}
            </text>
            <text
              className={styles.chartAxisText}
              x={width - padding.right}
              y={height - 10}
              textAnchor="end"
            >
              {formatTime(current[current.length - 1].start, locale)}
            </text>
          </>
        ) : null}
      </svg>
      <div className={styles.chartLegend}>
        <span data-series="current">{t('usage_analytics.comparison.current')}</span>
        <span data-series="previous">{t('usage_analytics.comparison.previous')}</span>
      </div>
    </div>
  );
}

export function UsageAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [initialDrill] = useState(() => parseMonitoringDrillQuery(location.search));
  const [initialView] = useState(() => parseInitialView(location.search));
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(initialView.tab);
  const [groupView, setGroupView] = useState<AnalyticsGroupView>(initialView.group);
  const [timeRange, setTimeRange] = useState<MonitoringTimeRange>(
    initialDrill.range ? 'custom' : '24h'
  );
  const [customFrom, setCustomFrom] = useState(() =>
    toDateTimeLocal(
      initialDrill.range ? new Date(initialDrill.range.from) : new Date(Date.now() - 86400000)
    )
  );
  const [customTo, setCustomTo] = useState(() =>
    toDateTimeLocal(initialDrill.range ? new Date(initialDrill.range.to) : new Date())
  );
  const [filters, setFilters] = useState<MonitoringFilters>(() => ({ ...initialDrill.filters }));
  const deferredSearch = useDeferredValue(filters.search);
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    hasAdvancedMonitoringFilters(initialDrill.filters)
  );
  const [granularity, setGranularity] = useState<AnalyticsGranularity>(() => {
    const value = new URLSearchParams(location.search).get('granularity');
    return value === 'day' ? 'day' : 'hour';
  });
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [chartMetric, setChartMetric] = useState<AnalyticsChartMetric>('calls');
  const [overview, setOverview] = useState<AnalyticsReport | null>(null);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [capabilityUnavailable, setCapabilityUnavailable] = useState(false);
  const requestSequence = useRef(0);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [deferredSearch, filters]
  );
  const activeView = analyticsViewForTab(activeTab, groupView);
  const buildCurrentRange = useCallback(
    () => buildMonitoringRange(timeRange, new Date(), customFrom, customTo),
    [customFrom, customTo, timeRange]
  );

  const loadAnalytics = useCallback(async () => {
    const range = buildCurrentRange();
    if (!range) {
      setLoadError(t('usage_analytics.errors.invalid_range'));
      return;
    }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const query = buildAnalyticsRequestQuery(range, effectiveFilters, granularity, timezone);
      const overviewPromise = usageAnalyticsApi.get('overview', query);
      const reportPromise =
        activeView === 'overview' ? overviewPromise : usageAnalyticsApi.get(activeView, query);
      const [nextOverview, nextReport] = await Promise.all([overviewPromise, reportPromise]);
      if (sequence !== requestSequence.current) return;
      setOverview(nextOverview);
      setReport(nextReport);
      setCapabilityUnavailable(false);
    } catch (error: unknown) {
      if (sequence !== requestSequence.current) return;
      if (isAnalyticsCapabilityUnavailable(error)) {
        setCapabilityUnavailable(true);
        setOverview(null);
        setReport(null);
      } else {
        setCapabilityUnavailable(false);
        setLoadError(getErrorMessage(error, t('usage_analytics.errors.load')));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [activeView, buildCurrentRange, effectiveFilters, granularity, t, timezone]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const updateFilter = (field: keyof MonitoringFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const clearFilters = () => {
    setFilters(EMPTY_MONITORING_FILTERS);
    setAdvancedOpen(false);
  };

  const summary = overview?.summary;
  const comparison = overview?.comparison;
  const costCoverage = summary?.cost.coverageRate ?? 0;
  const missingPrices = summary ? Object.entries(summary.cost.missingDimensions) : [];
  const timezoneOptions = useMemo(() => {
    const values = Array.from(
      new Set([timezone, 'UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/London'])
    );
    return values.map((value) => ({ value, label: value }));
  }, [timezone]);

  const renderSummary = () => {
    if (!summary || !comparison) return null;
    const cards = [
      {
        key: 'calls',
        value: formatNumber(summary.calls, i18n.language),
        delta: analyticsDelta(summary.calls, comparison.calls),
      },
      {
        key: 'success_rate',
        value: `${(analyticsSuccessRate(summary) * 100).toFixed(1)}%`,
        delta: analyticsDelta(analyticsSuccessRate(summary), analyticsSuccessRate(comparison)),
      },
      {
        key: 'cost',
        value: formatCost(summary.cost.amount, summary.cost.currency),
        delta: analyticsDelta(Number(summary.cost.amount), Number(comparison.cost.amount)),
      },
      {
        key: 'tokens',
        value: formatNumber(summary.totalTokens, i18n.language),
        delta: analyticsDelta(summary.totalTokens, comparison.totalTokens),
      },
      {
        key: 'p95_latency',
        value: formatDuration(summary.p95LatencyMs),
        delta: analyticsDelta(summary.p95LatencyMs, comparison.p95LatencyMs),
      },
      {
        key: 'cache_rate',
        value: `${(summary.cacheHitRate * 100).toFixed(1)}%`,
        delta: analyticsDelta(summary.cacheHitRate, comparison.cacheHitRate),
      },
    ];
    return (
      <section className={styles.summaryStrip} aria-label={t('usage_analytics.summary.label')}>
        {cards.map((card) => (
          <div key={card.key}>
            <span>{t(`usage_analytics.summary.${card.key}`)}</span>
            <strong>{card.value}</strong>
            <Delta value={card.delta} />
          </div>
        ))}
      </section>
    );
  };

  const renderOverview = () => {
    if (!summary || !overview) return null;
    if (summary.calls === 0) return <EmptyState title={t('usage_analytics.empty.overview')} />;
    const tokenParts = [
      ['input', summary.inputTokens],
      ['output', summary.outputTokens],
      ['reasoning', summary.reasoningTokens],
      ['cache_read', summary.cacheReadTokens],
      ['cache_creation', summary.cacheCreationTokens],
    ] as const;
    const maxTokens = Math.max(1, ...tokenParts.map(([, value]) => value));
    return (
      <div className={styles.overviewGrid}>
        <section className={styles.dataPanel}>
          <div className={styles.panelHeader}>
            <div>
              <strong>{t('usage_analytics.token_mix.title')}</strong>
              <span>
                {t('usage_analytics.token_mix.total', {
                  value: formatNumber(summary.totalTokens, i18n.language),
                })}
              </span>
            </div>
          </div>
          <div className={styles.tokenMix}>
            {tokenParts.map(([key, value]) => (
              <div key={key}>
                <span>{t(`usage_analytics.token_mix.${key}`)}</span>
                <div>
                  <i style={{ width: `${(value / maxTokens) * 100}%` }} />
                </div>
                <strong>{formatNumber(value, i18n.language)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.dataPanel}>
          <div className={styles.panelHeader}>
            <div>
              <strong>{t('usage_analytics.anomalies.title')}</strong>
              <span>
                {t('usage_analytics.anomalies.count', { count: overview.anomalies.length })}
              </span>
            </div>
          </div>
          {overview.anomalies.length ? (
            <div className={styles.anomalyList}>
              {overview.anomalies.map((anomaly) => {
                const range = analyticsAnomalyRange(anomaly.start, overview.granularity);
                const href = range ? buildMonitoringDrillHref(range, filters) : '/monitoring';
                return (
                  <div key={anomaly.start}>
                    <div>
                      <strong>{formatTime(anomaly.start, i18n.language)}</strong>
                      <span>
                        {anomaly.reasons
                          .map((reason) => t(`usage_analytics.anomalies.reasons.${reason}`))
                          .join(' / ')}
                      </span>
                    </div>
                    <span>{formatNumber(anomaly.metrics.calls, i18n.language)}</span>
                    <Link
                      to={href}
                      aria-label={t('usage_analytics.actions.open_monitoring')}
                      title={t('usage_analytics.actions.open_monitoring')}
                    >
                      <ExternalLink size={16} />
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title={t('usage_analytics.empty.anomalies')} />
          )}
        </section>
      </div>
    );
  };

  const renderTrends = () => {
    if (!report) return null;
    if (!report.series.length) return <EmptyState title={t('usage_analytics.empty.trends')} />;
    return (
      <section className={styles.dataPanel}>
        <div className={styles.panelHeader}>
          <div>
            <strong>{t('usage_analytics.trends.title')}</strong>
            <span>{t('usage_analytics.trends.bucket_count', { count: report.series.length })}</span>
          </div>
          <div className={styles.metricControl}>
            {CHART_METRICS.map((metric) => (
              <button
                type="button"
                data-active={chartMetric === metric}
                onClick={() => setChartMetric(metric)}
                key={metric}
              >
                {t(`usage_analytics.metrics.${metric}`)}
              </button>
            ))}
          </div>
        </div>
        <TrendChart
          current={report.series}
          comparison={report.comparisonSeries}
          metric={chartMetric}
          locale={i18n.language}
        />
      </section>
    );
  };

  const renderRankings = () => {
    if (!report) return null;
    if (!report.rankings.length) return <EmptyState title={t('usage_analytics.empty.rankings')} />;
    return (
      <section className={styles.dataPanel}>
        <div className={styles.rankingHead}>
          <span>{t('usage_analytics.rankings.identity')}</span>
          <span>{t('usage_analytics.summary.calls')}</span>
          <span>{t('usage_analytics.summary.success_rate')}</span>
          <span>{t('usage_analytics.summary.tokens')}</span>
          <span>{t('usage_analytics.summary.cost')}</span>
          <span>{t('usage_analytics.rankings.latency')}</span>
          <span>{t('usage_analytics.rankings.change')}</span>
          <span />
        </div>
        <div className={styles.rankingList}>
          {report.rankings.map((ranking) => {
            const label = analyticsIdentityLabel(ranking.identity, t('common.not_set'));
            const href = buildMonitoringDrillHref(
              { from: report.from, to: report.to },
              { ...filters, ...analyticsRankingFilters(report.view, ranking.identity) }
            );
            return (
              <div key={`${report.view}:${ranking.identity.recordedId}:${label}`}>
                <div className={styles.rankingIdentity}>
                  <strong>{label}</strong>
                  <span>{ranking.identity.provider || ranking.identity.recordedId}</span>
                  {['api-keys', 'credentials', 'credential-groups', 'api-key-groups'].includes(
                    report.view
                  ) ? (
                    <small data-current={ranking.identity.current}>
                      {t(
                        ranking.identity.current
                          ? 'usage_analytics.identity.current'
                          : 'usage_analytics.identity.historical'
                      )}
                    </small>
                  ) : null}
                </div>
                <strong>{formatNumber(ranking.metrics.calls, i18n.language)}</strong>
                <span>{`${(analyticsSuccessRate(ranking.metrics) * 100).toFixed(1)}%`}</span>
                <span>{formatNumber(ranking.metrics.totalTokens, i18n.language)}</span>
                <span>
                  {formatCost(ranking.metrics.cost.amount, ranking.metrics.cost.currency)}
                </span>
                <span>{formatDuration(ranking.metrics.averageLatencyMs)}</span>
                <Delta value={analyticsDelta(ranking.metrics.calls, ranking.comparison.calls)} />
                <Link
                  to={href}
                  aria-label={t('usage_analytics.actions.open_monitoring')}
                  title={t('usage_analytics.actions.open_monitoring')}
                >
                  <ExternalLink size={16} />
                </Link>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderHeatmap = () => {
    if (!report) return null;
    const byCell = new Map(report.heatmap.map((cell) => [`${cell.isoWeekday}:${cell.hour}`, cell]));
    const maximum = Math.max(1, ...report.heatmap.map((cell) => cell.metrics.calls));
    return (
      <section className={styles.dataPanel}>
        <div className={styles.panelHeader}>
          <div>
            <strong>{t('usage_analytics.heatmap.title')}</strong>
            <span>{report.timezone}</span>
          </div>
        </div>
        <div className={styles.heatmapScroll}>
          <div className={styles.heatmapGrid}>
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <strong key={hour}>{String(hour).padStart(2, '0')}</strong>
            ))}
            {Array.from({ length: 7 }, (_, dayIndex) => {
              const weekday = dayIndex + 1;
              return [
                <span key={`label:${weekday}`}>
                  {t(`usage_analytics.heatmap.days.${weekday}`)}
                </span>,
                ...Array.from({ length: 24 }, (_, hour) => {
                  const cell = byCell.get(`${weekday}:${hour}`);
                  const calls = cell?.metrics.calls ?? 0;
                  const heat = calls === 0 ? 0 : 12 + Math.round((calls / maximum) * 78);
                  return (
                    <div
                      className={styles.heatmapCell}
                      data-empty={calls === 0}
                      style={{ '--heat': heat } as CSSProperties}
                      key={`${weekday}:${hour}`}
                      title={t('usage_analytics.heatmap.cell', {
                        day: t(`usage_analytics.heatmap.days.${weekday}`),
                        hour: String(hour).padStart(2, '0'),
                        calls: formatNumber(calls, i18n.language),
                      })}
                    >
                      {calls ? formatNumber(calls, i18n.language) : ''}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div>
          <h1>{t('usage_analytics.title')}</h1>
          <span>
            {overview
              ? t('usage_analytics.last_refresh', {
                  value: formatTime(overview.generatedAt, i18n.language),
                })
              : t('usage_analytics.status_pending')}
          </span>
        </div>
        <div className={styles.headerActions}>
          {report ? (
            <span className={styles.sourceBadge}>
              {t(`usage_analytics.data_source.${report.dataSource}`)}
            </span>
          ) : null}
          <TooltipIconButton
            label={t('common.refresh')}
            onClick={() => void loadAnalytics()}
            disabled={loading || connectionStatus !== 'connected'}
          >
            <RefreshCw size={16} />
          </TooltipIconButton>
        </div>
      </header>

      <section className={styles.filtersPanel}>
        <div className={styles.rangeControl} aria-label={t('usage_analytics.filters.time_range')}>
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
          />
        </div>
        <Input
          value={filters.provider === 'all' ? '' : filters.provider}
          onChange={(event) => updateFilter('provider', event.target.value || 'all')}
          placeholder={t('request_monitoring.filters.provider')}
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

        <div className={styles.analysisControls}>
          <div
            className={styles.granularityControl}
            aria-label={t('usage_analytics.filters.granularity')}
          >
            {(['hour', 'day'] as AnalyticsGranularity[]).map((value) => (
              <button
                type="button"
                key={value}
                data-active={granularity === value}
                onClick={() => setGranularity(value)}
              >
                {t(`usage_analytics.granularity.${value}`)}
              </button>
            ))}
          </div>
          <Select
            value={timezone}
            options={timezoneOptions}
            onChange={setTimezone}
            ariaLabel={t('usage_analytics.filters.timezone')}
            fullWidth={false}
          />
        </div>

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
            <Input
              value={filters.resolvedModel === 'all' ? '' : filters.resolvedModel}
              onChange={(event) => updateFilter('resolvedModel', event.target.value || 'all')}
              placeholder={t('request_monitoring.filters.model')}
            />
            <Input
              value={filters.requestedModel === 'all' ? '' : filters.requestedModel}
              onChange={(event) => updateFilter('requestedModel', event.target.value || 'all')}
              placeholder={t('model_prices.fields.requested_model')}
            />
            <Input
              value={filters.pluginId}
              onChange={(event) => updateFilter('pluginId', event.target.value)}
              placeholder={t('nav.plugins')}
            />
            <Input
              value={filters.authId === 'all' ? '' : filters.authId}
              onChange={(event) => updateFilter('authId', event.target.value || 'all')}
              placeholder={t('request_monitoring.filters.credential')}
            />
            <Input
              value={filters.apiKeyId === 'all' ? '' : filters.apiKeyId}
              onChange={(event) => updateFilter('apiKeyId', event.target.value || 'all')}
              placeholder={t('request_monitoring.filters.api_key')}
            />
            <Input
              value={filters.credentialGroupId}
              onChange={(event) => updateFilter('credentialGroupId', event.target.value)}
              placeholder={t('config_management.visual.api_keys.credential_groups_label')}
            />
            <Input
              value={filters.apiKeyGroupId}
              onChange={(event) => updateFilter('apiKeyGroupId', event.target.value)}
              placeholder={t('request_monitoring.filters.api_key_group')}
            />
            <Input
              value={filters.proxyPoolId}
              onChange={(event) => updateFilter('proxyPoolId', event.target.value)}
              placeholder={t('nav.proxy_pools')}
            />
            <Input
              value={filters.failureCategory === 'all' ? '' : filters.failureCategory}
              onChange={(event) => updateFilter('failureCategory', event.target.value || 'all')}
              placeholder={t('request_monitoring.filters.failure_category')}
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
              placeholder={t('request_monitoring.filters.max_latency')}
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

      <nav className={styles.viewTabs} aria-label={t('usage_analytics.views.label')}>
        {ANALYTICS_TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            data-active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'overview' ? <BarChart3 size={16} /> : null}
            {t(`usage_analytics.views.${tab}`)}
          </button>
        ))}
      </nav>

      {activeTab === 'groups' ? (
        <div className={styles.groupControl}>
          {(['credential-groups', 'api-key-groups'] as AnalyticsGroupView[]).map((view) => (
            <button
              type="button"
              key={view}
              data-active={groupView === view}
              onClick={() => setGroupView(view)}
            >
              {t(`usage_analytics.group_views.${view}`)}
            </button>
          ))}
        </div>
      ) : null}

      {loading && !overview ? (
        <>
          <div className={styles.summaryStrip}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}>
                <Skeleton width="55%" height={11} />
                <Skeleton width="70%" height={22} />
              </div>
            ))}
          </div>
          <Skeleton height={320} />
        </>
      ) : capabilityUnavailable ? (
        <section className={styles.statePanel}>
          <AlertTriangle size={22} />
          <div>
            <strong>{t('usage_analytics.states.unavailable_title')}</strong>
            <span>{t('usage_analytics.states.unavailable_description')}</span>
          </div>
        </section>
      ) : loadError && !overview ? (
        <section className={styles.statePanel} role="alert">
          <AlertTriangle size={22} />
          <div>
            <strong>{t('usage_analytics.states.error_title')}</strong>
            <span>{loadError}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void loadAnalytics()}>
            <RefreshCw size={16} />
            {t('common.refresh')}
          </Button>
        </section>
      ) : overview && report ? (
        <>
          {loadError ? (
            <div className={styles.inlineError} role="alert">
              <AlertTriangle size={15} />
              <span>{loadError}</span>
            </div>
          ) : null}
          {renderSummary()}
          <section className={styles.coverageBar} data-complete={costCoverage === 1}>
            <CircleDollarSign size={18} />
            <strong>{t('usage_analytics.coverage.label')}</strong>
            <span>{`${(costCoverage * 100).toFixed(1)}%`}</span>
            <span>
              {t('usage_analytics.coverage.catalog', { version: overview.catalogVersion })}
            </span>
            {missingPrices.length ? (
              <span>
                {t('usage_analytics.coverage.missing', {
                  count: missingPrices.reduce((total, [, count]) => total + count, 0),
                })}
              </span>
            ) : null}
          </section>
          {activeView === 'overview' ? renderOverview() : null}
          {activeView === 'trends' ? renderTrends() : null}
          {[
            'models',
            'api-keys',
            'credentials',
            'credential-groups',
            'api-key-groups',
            'providers',
          ].includes(activeView)
            ? renderRankings()
            : null}
          {activeView === 'heatmap' ? renderHeatmap() : null}
        </>
      ) : null}
    </div>
  );
}
