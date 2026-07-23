import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CircleDollarSign,
  Clock3,
  Gauge,
  RefreshCw,
  Timer,
  Zap,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { IconKey, IconBot, IconFileText, IconSatellite } from '@/components/ui/icons';
import {
  dashboardAnalyticsApi,
  isDashboardAnalyticsUnavailable,
  type DashboardAnalytics,
} from '@/services/api';
import {
  dashboardAnalyticsHref,
  dashboardFailureMonitoringHref,
  dashboardModelMonitoringHref,
  dashboardRollingMonitoringHref,
  dashboardTodayMonitoringHref,
} from '@/features/dashboard/viewModel';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthInventoryStore, useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { formatDateValue } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import styles from './DashboardPage.module.scss';

interface OverviewStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
  sublabel?: string;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: value < 10 ? 2 : 0,
  }).format(value);

const formatCost = (value: string, currency: string, locale: string): string => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount >= 1 ? 2 : 4,
    maximumFractionDigits: amount >= 1 ? 2 : 6,
  }).format(amount);
};

const formatDuration = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 2)}s` : `${value}ms`;

const formatTimestamp = (value: string, locale: string, fallback: string): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);
  const authFiles = useAuthInventoryStore((state) => state.files);
  const authFilesLoading = useAuthInventoryStore((state) => state.loading);
  const authFilesCount = connectionStatus === 'connected' ? authFiles.length : null;
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsUnavailable, setAnalyticsUnavailable] = useState(false);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTimeOfDay(getTimeOfDay());
      setCurrentTime(new Date());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const resolveApiKeysForModels = useApiKeysForModels();

  const fetchModels = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) return;
    try {
      const apiKeys = await resolveApiKeysForModels();
      await fetchModelsFromStore(apiBase, apiKeys[0]);
    } catch {
      // Model inventory is auxiliary on the dashboard.
    }
  }, [apiBase, connectionStatus, fetchModelsFromStore, resolveApiKeysForModels]);

  const fetchAnalytics = useCallback(async () => {
    if (connectionStatus !== 'connected') return;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const response = await dashboardAnalyticsApi.get(timezone);
      setAnalytics(response);
      setAnalyticsUnavailable(false);
    } catch (error: unknown) {
      if (isDashboardAnalyticsUnavailable(error)) {
        setAnalyticsUnavailable(true);
        setAnalytics(null);
      } else {
        setAnalyticsUnavailable(false);
        setAnalyticsError(getErrorMessage(error, t('dashboard.analytics.errors.load')));
      }
    } finally {
      setAnalyticsLoading(false);
    }
  }, [connectionStatus, t, timezone]);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([fetchModels(), fetchAnalytics()]);
  }, [fetchAnalytics, fetchModels]);

  useHeaderRefresh(refreshDashboard, connectionStatus === 'connected');

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void fetchConfig().catch(() => undefined);
    void refreshDashboard();
  }, [connectionStatus, fetchConfig, refreshDashboard]);

  const configLoading = !config;
  const providerStats = config
    ? {
        gemini: config.geminiApiKeys?.length ?? 0,
        codex: config.codexApiKeys?.length ?? 0,
        claude: config.claudeApiKeys?.length ?? 0,
        vertex: config.vertexApiKeys?.length ?? 0,
        openai: config.openaiCompatibility?.length ?? 0,
      }
    : null;
  const totalProviderKeys = providerStats
    ? Object.values(providerStats).reduce((sum, count) => sum + count, 0)
    : 0;
  const overviewStats: OverviewStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: config ? (config.apiKeys?.length ?? 0) : '-',
      icon: <IconKey size={22} />,
      path: '/config',
      loading: configLoading,
      sublabel: t('nav.config_management'),
    },
    {
      label: t('nav.ai_providers'),
      value: providerStats ? totalProviderKeys : '-',
      icon: <IconBot size={22} />,
      path: '/ai-providers',
      loading: configLoading,
      sublabel: providerStats
        ? t('dashboard.provider_keys_detail', {
            gemini: providerStats.gemini,
            codex: providerStats.codex,
            claude: providerStats.claude,
            vertex: providerStats.vertex,
            openai: providerStats.openai,
          })
        : undefined,
    },
    {
      label: t('nav.auth_files'),
      value: authFilesCount ?? '-',
      icon: <IconFileText size={22} />,
      path: '/quota',
      loading: authFilesLoading && authFilesCount === null,
      sublabel: t('dashboard.oauth_credentials'),
    },
    {
      label: t('dashboard.available_models'),
      value: modelsLoading ? '-' : models.length,
      icon: <IconSatellite size={22} />,
      path: '/system',
      loading: modelsLoading,
      sublabel: t('dashboard.available_models_desc'),
    },
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '-'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;
  const routingStrategyBadgeClass = !routingStrategyRaw
    ? styles.configBadgeUnknown
    : routingStrategyRaw === 'round-robin'
      ? styles.configBadgeRoundRobin
      : routingStrategyRaw === 'fill-first'
        ? styles.configBadgeFillFirst
        : styles.configBadgeUnknown;

  const formattedDate = currentTime.toLocaleDateString(i18n.language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = currentTime.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const serverBuildDateDisplay = formatDateValue(serverBuildDate, i18n.language);

  const renderAnalytics = () => {
    if (analyticsLoading && !analytics) {
      return (
        <>
          <div className={styles.operationsStrip} aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}>
                <Skeleton width="55%" height={11} />
                <Skeleton width="70%" height={22} />
              </div>
            ))}
          </div>
          <Skeleton height={280} />
        </>
      );
    }
    if (analyticsUnavailable) {
      return (
        <div className={styles.analyticsState}>
          <AlertTriangle size={20} />
          <div>
            <strong>{t('dashboard.analytics.states.unavailable')}</strong>
            <span>{t('dashboard.analytics.states.unavailable_description')}</span>
          </div>
        </div>
      );
    }
    if (!analytics) {
      return (
        <div className={styles.analyticsState} role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>{t('dashboard.analytics.states.error')}</strong>
            <span>{analyticsError}</span>
          </div>
        </div>
      );
    }

    const today = analytics.today;
    const successRate = today.calls > 0 ? today.successes / today.calls : 1;
    const timelineMaximum = Math.max(
      1,
      ...analytics.timeline.map((bucket) => bucket.metrics.calls)
    );
    const alerts = [
      analytics.collector.degraded || analytics.collector.stale
        ? {
            key: analytics.collector.stale ? 'collector_stale' : 'collector_degraded',
            path: dashboardAnalyticsHref(analytics, 'overview'),
            tone: 'danger',
          }
        : null,
      today.calls > 0 && today.cost.coverageRate < 1
        ? { key: 'unpriced', path: '/model-prices', tone: 'warning' }
        : null,
      today.calls === 0
        ? { key: 'no_traffic', path: dashboardTodayMonitoringHref(analytics), tone: 'neutral' }
        : null,
    ].filter(Boolean) as Array<{ key: string; path: string; tone: string }>;
    const operationStats = [
      {
        key: 'calls',
        value: formatNumber(today.calls, i18n.language),
        icon: <Activity size={17} />,
        path: dashboardTodayMonitoringHref(analytics),
      },
      {
        key: 'cost',
        value: formatCost(today.cost.amount, today.cost.currency, i18n.language),
        icon: <CircleDollarSign size={17} />,
        path: dashboardAnalyticsHref(analytics, 'overview'),
      },
      {
        key: 'success',
        value: `${(successRate * 100).toFixed(1)}%`,
        icon: <Gauge size={17} />,
        path: dashboardTodayMonitoringHref(analytics, { result: 'failure' }),
      },
      {
        key: 'rpm',
        value: formatNumber(analytics.rolling.rpm, i18n.language),
        icon: <Zap size={17} />,
        path: dashboardRollingMonitoringHref(analytics),
      },
      {
        key: 'tpm',
        value: formatNumber(analytics.rolling.tpm, i18n.language),
        icon: <Timer size={17} />,
        path: dashboardRollingMonitoringHref(analytics),
      },
      {
        key: 'latency',
        value: formatDuration(today.p95LatencyMs),
        icon: <Clock3 size={17} />,
        path: dashboardAnalyticsHref(analytics, 'trends'),
      },
    ];

    return (
      <>
        {analyticsError ? (
          <div className={styles.analyticsInlineError} role="alert">
            <AlertTriangle size={15} />
            <span>{analyticsError}</span>
          </div>
        ) : null}
        {alerts.length ? (
          <div className={styles.alertList}>
            {alerts.map((alert) => (
              <Link to={alert.path} data-tone={alert.tone} key={alert.key}>
                <AlertTriangle size={15} />
                <span>{t(`dashboard.analytics.alerts.${alert.key}`)}</span>
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        ) : null}
        <div className={styles.operationsStrip}>
          {operationStats.map((stat) => (
            <Link to={stat.path} key={stat.key}>
              <span>
                {stat.icon}
                {t(`dashboard.analytics.metrics.${stat.key}`)}
              </span>
              <strong>{stat.value}</strong>
              <small>
                {t(
                  stat.key === 'rpm' || stat.key === 'tpm'
                    ? 'dashboard.analytics.window_15m'
                    : 'dashboard.analytics.today'
                )}
              </small>
            </Link>
          ))}
        </div>
        <div className={styles.operationsGrid}>
          <section className={`${styles.operationsPanel} ${styles.timelinePanel}`}>
            <div className={styles.panelHeader}>
              <div>
                <strong>{t('dashboard.analytics.timeline.title')}</strong>
                <span>{t('dashboard.analytics.timeline.subtitle')}</span>
              </div>
              <Link to={dashboardAnalyticsHref(analytics, 'trends')} aria-label={t('common.view')}>
                <ArrowRight size={15} />
              </Link>
            </div>
            {analytics.timeline.length ? (
              <div className={styles.timelineChart}>
                {analytics.timeline.map((bucket) => {
                  const volume = Math.max(4, (bucket.metrics.calls / timelineMaximum) * 100);
                  const success =
                    bucket.metrics.calls > 0
                      ? (bucket.metrics.successes / bucket.metrics.calls) * 100
                      : 0;
                  return (
                    <div
                      className={styles.timelineSlot}
                      key={bucket.start}
                      title={`${formatTimestamp(bucket.start, i18n.language, bucket.start)} · ${bucket.metrics.calls}`}
                    >
                      <div
                        className={styles.timelineBar}
                        style={{ '--volume': `${volume}%` } as CSSProperties}
                      >
                        <i style={{ height: `${success}%` }} />
                        <b style={{ height: `${100 - success}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title={t('dashboard.analytics.states.no_traffic')} />
            )}
          </section>
          <section className={styles.operationsPanel}>
            <div className={styles.panelHeader}>
              <div>
                <strong>{t('dashboard.analytics.collector.title')}</strong>
                <span>
                  {t(
                    `dashboard.analytics.collector.${analytics.collector.stale ? 'stale' : analytics.collector.degraded ? 'degraded' : 'healthy'}`
                  )}
                </span>
              </div>
              <Link
                to={dashboardAnalyticsHref(analytics, 'overview')}
                aria-label={t('common.view')}
              >
                <ArrowRight size={15} />
              </Link>
            </div>
            <dl className={styles.collectorGrid}>
              <div>
                <dt>{t('dashboard.analytics.collector.persisted')}</dt>
                <dd>{formatNumber(analytics.collector.persisted, i18n.language)}</dd>
              </div>
              <div>
                <dt>{t('dashboard.analytics.collector.queue')}</dt>
                <dd>
                  {analytics.collector.depth}/{analytics.collector.capacity}
                </dd>
              </div>
              <div>
                <dt>{t('dashboard.analytics.collector.dropped')}</dt>
                <dd data-warning={analytics.collector.dropped > 0}>
                  {formatNumber(analytics.collector.dropped, i18n.language)}
                </dd>
              </div>
              <div>
                <dt>{t('dashboard.analytics.collector.last_success')}</dt>
                <dd>
                  {formatTimestamp(
                    analytics.collector.lastSuccessAt,
                    i18n.language,
                    t('common.not_set')
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section className={styles.operationsPanel}>
            <div className={styles.panelHeader}>
              <div>
                <strong>{t('dashboard.analytics.top_models.title')}</strong>
                <span>{t('dashboard.analytics.today')}</span>
              </div>
              <Link to={dashboardAnalyticsHref(analytics, 'models')} aria-label={t('common.view')}>
                <ArrowRight size={15} />
              </Link>
            </div>
            {analytics.topModels.length ? (
              <div className={styles.compactRows}>
                {analytics.topModels.map((model) => (
                  <Link
                    to={dashboardModelMonitoringHref(analytics, model.identity)}
                    key={model.identity.recordedId}
                  >
                    <div>
                      <strong>{model.identity.displayName || model.identity.resolvedModel}</strong>
                      <span>{model.identity.provider}</span>
                    </div>
                    <span>{formatNumber(model.metrics.calls, i18n.language)}</span>
                    <strong>
                      {formatCost(
                        model.metrics.cost.amount,
                        model.metrics.cost.currency,
                        i18n.language
                      )}
                    </strong>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title={t('dashboard.analytics.top_models.empty')} />
            )}
          </section>
          <section className={styles.operationsPanel}>
            <div className={styles.panelHeader}>
              <div>
                <strong>{t('dashboard.analytics.failures.title')}</strong>
                <span>{t('dashboard.analytics.failures.subtitle')}</span>
              </div>
              <Link
                to={dashboardTodayMonitoringHref(analytics, { result: 'failure' })}
                aria-label={t('common.view')}
              >
                <ArrowRight size={15} />
              </Link>
            </div>
            {analytics.recentFailures.length ? (
              <div className={styles.compactRows}>
                {analytics.recentFailures.map((failure) => (
                  <Link to={dashboardFailureMonitoringHref(failure)} key={failure.id}>
                    <div>
                      <strong>
                        {failure.resolvedModel || failure.requestedModel || failure.provider}
                      </strong>
                      <span>
                        {formatTimestamp(failure.requestedAt, i18n.language, failure.requestedAt)}
                      </span>
                    </div>
                    <span>{failure.statusCode || failure.failureCategory}</span>
                    <strong>{formatDuration(failure.latencyMs)}</strong>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title={t('dashboard.analytics.failures.empty')} />
            )}
          </section>
        </div>
      </>
    );
  };

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>{t(`dashboard.greeting_${timeOfDay}`)}</span>
          <h1 className={styles.pageTitle}>{t('dashboard.welcome_back')}</h1>
          <p className={styles.pageDescription}>{t(`dashboard.caring_${timeOfDay}`)}</p>
        </div>
        <div className={styles.headerMeta}>
          <div className={styles.dateTimeBlock}>
            <span className={styles.time}>{formattedTime}</span>
            <span className={styles.date}>{formattedDate}</span>
          </div>
          <div className={styles.metaRow}>
            <div className={styles.connectionPill}>
              <span
                className={`${styles.statusDot} ${connectionStatus === 'connected' ? styles.connected : connectionStatus === 'connecting' ? styles.connecting : styles.disconnected}`}
              />
              <span className={styles.pillText}>
                {serverVersion
                  ? `v${serverVersion.trim().replace(/^[vV]+/, '')}`
                  : t(
                      connectionStatus === 'connected'
                        ? 'common.connected'
                        : connectionStatus === 'connecting'
                          ? 'common.connecting'
                          : 'common.disconnected'
                    )}
              </span>
            </div>
            <TooltipIconButton
              label={t('common.refresh')}
              onClick={() => void refreshDashboard()}
              disabled={connectionStatus !== 'connected' || analyticsLoading}
            >
              <RefreshCw size={16} />
            </TooltipIconButton>
          </div>
          {serverBuildDateDisplay ? (
            <span className={styles.buildDate}>{serverBuildDateDisplay}</span>
          ) : null}
        </div>
      </header>

      <section className={styles.analyticsSection}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionHeading}>{t('dashboard.analytics.title')}</h2>
          {analytics ? (
            <span className={styles.sectionMeta}>
              {t('dashboard.analytics.updated', {
                value: formatTimestamp(analytics.generatedAt, i18n.language, ''),
              })}
            </span>
          ) : null}
        </div>
        {renderAnalytics()}
      </section>

      <section className={styles.statsSection}>
        <h2 className={styles.sectionHeading}>{t('dashboard.system_overview')}</h2>
        <div className={styles.statsGrid}>
          {overviewStats.map((stat) => (
            <Link key={stat.path} to={stat.path} className={styles.statCard}>
              <div className={styles.statHeader}>
                <span className={styles.statLabel}>{stat.label}</span>
                <span className={styles.statIcon}>{stat.icon}</span>
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{stat.loading ? '...' : stat.value}</span>
                {stat.sublabel && !stat.loading ? (
                  <span className={styles.statSublabel}>{stat.sublabel}</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {config ? (
        <section className={styles.configSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionHeading}>{t('dashboard.current_config')}</h2>
            <Link to="/config" className={styles.viewMoreLink}>
              <span>{t('dashboard.edit_settings')}</span>
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className={styles.configPillGrid}>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.debug_enable')}</span>
              <span
                className={`${styles.configPillValue} ${config.debug ? styles.on : styles.off}`}
              >
                {config.debug ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>
                {t('basic_settings.logging_to_file_enable')}
              </span>
              <span
                className={`${styles.configPillValue} ${config.loggingToFile ? styles.on : styles.off}`}
              >
                {config.loggingToFile ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>
                {t('basic_settings.retry_count_label')}
              </span>
              <span className={styles.configPillValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.ws_auth_enable')}</span>
              <span
                className={`${styles.configPillValue} ${config.wsAuth ? styles.on : styles.off}`}
              >
                {config.wsAuth ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('dashboard.routing_strategy')}</span>
              <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
                {routingStrategyDisplay}
              </span>
            </div>
            {config.proxyUrl ? (
              <div className={`${styles.configPill} ${styles.configPillWide}`}>
                <span className={styles.configPillLabel}>
                  {t('basic_settings.proxy_url_label')}
                </span>
                <span className={styles.configPillMono}>{config.proxyUrl}</span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
