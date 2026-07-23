import {
  buildMonitoringRequestQuery,
  type MonitoringFilters,
} from '@/features/requestMonitoring/viewModel';
import type {
  AnalyticsGranularity,
  AnalyticsIdentity,
  AnalyticsMetrics,
  AnalyticsQueryInput,
  AnalyticsView,
} from '@/services/api/usageAnalytics';

export type AnalyticsTab =
  | 'overview'
  | 'trends'
  | 'models'
  | 'api_keys'
  | 'credentials'
  | 'groups'
  | 'providers'
  | 'heatmap';

export type AnalyticsGroupView = 'credential-groups' | 'api-key-groups';
export type AnalyticsChartMetric = 'calls' | 'tokens' | 'cost' | 'failures' | 'latency';

export const ANALYTICS_TABS: AnalyticsTab[] = [
  'overview',
  'trends',
  'models',
  'api_keys',
  'credentials',
  'groups',
  'providers',
  'heatmap',
];

export const analyticsViewForTab = (
  tab: AnalyticsTab,
  groupView: AnalyticsGroupView
): AnalyticsView => {
  if (tab === 'api_keys') return 'api-keys';
  if (tab === 'groups') return groupView;
  return tab;
};

export const buildAnalyticsRequestQuery = (
  range: { from: string; to: string },
  filters: MonitoringFilters,
  granularity: AnalyticsGranularity,
  timezone: string
): AnalyticsQueryInput => {
  const monitoring = buildMonitoringRequestQuery(range, filters);
  return {
    ...monitoring,
    cursor: undefined,
    limit: 25,
    granularity,
    timezone,
  };
};

export const analyticsSuccessRate = (metrics: AnalyticsMetrics): number =>
  metrics.calls > 0 ? metrics.successes / metrics.calls : 1;

export const analyticsDelta = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
};

export const analyticsMetricValue = (
  metrics: AnalyticsMetrics,
  metric: AnalyticsChartMetric
): number => {
  switch (metric) {
    case 'calls':
      return metrics.calls;
    case 'tokens':
      return metrics.totalTokens;
    case 'cost':
      return Number(metrics.cost.amount);
    case 'failures':
      return metrics.failures;
    case 'latency':
      return metrics.averageLatencyMs;
  }
};

export const analyticsRankingFilters = (
  view: AnalyticsView,
  identity: AnalyticsIdentity
): Partial<MonitoringFilters> => {
  switch (view) {
    case 'models':
      return {
        provider: identity.provider || 'all',
        resolvedModel: identity.resolvedModel || 'all',
        requestedModel: identity.requestedModel || 'all',
      };
    case 'api-keys':
      return { apiKeyId: identity.recordedId || 'all' };
    case 'credentials':
      return { authId: identity.recordedId || 'all' };
    case 'credential-groups':
      return { credentialGroupId: identity.recordedId };
    case 'api-key-groups':
      return { apiKeyGroupId: identity.recordedId };
    case 'providers':
      return { provider: identity.recordedId || identity.provider || 'all' };
    default:
      return {};
  }
};

export const analyticsAnomalyRange = (
  start: string,
  granularity: AnalyticsGranularity
): { from: string; to: string } | null => {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return null;
  const duration = granularity === 'day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  return { from: from.toISOString(), to: new Date(from.getTime() + duration).toISOString() };
};

export const analyticsIdentityLabel = (identity: AnalyticsIdentity, fallback: string): string =>
  identity.displayName || identity.resolvedModel || identity.recordedId || fallback;
