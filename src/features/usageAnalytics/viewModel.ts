import {
  buildMonitoringRequestQuery,
  credentialVisibleWithoutUsage,
  type MonitoringFilters,
} from '@/features/requestMonitoring/viewModel';
import type { ReconciledCredentialIdentity } from '@/features/authFiles/credentialIdentityCatalog';
import type {
  AnalyticsGranularity,
  AnalyticsIdentity,
  AnalyticsMetrics,
  AnalyticsQueryInput,
  AnalyticsRanking,
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

const zeroAnalyticsMetrics = (currency: string): AnalyticsMetrics => ({
  calls: 0,
  successes: 0,
  failures: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
  cacheHits: 0,
  cacheHitRate: 0,
  averageLatencyMs: 0,
  p95LatencyMs: 0,
  averageTtftMs: 0,
  p95TtftMs: 0,
  cost: {
    amount: '0',
    currency,
    completeCalls: 0,
    partialCalls: 0,
    unpricedCalls: 0,
    freeCalls: 0,
    coverageRate: 1,
    missingDimensions: {},
  },
});

export const mergeAnalyticsCredentialRankings = (
  rankings: AnalyticsRanking[],
  catalog: ReconciledCredentialIdentity[],
  filters: MonitoringFilters,
  currency = 'USD'
): AnalyticsRanking[] => {
  const catalogByID = new Map(catalog.map((entry) => [entry.recordedId, entry]));
  const seen = new Set<string>();
  const merged = rankings.map((ranking) => {
    const recordedId = ranking.identity.recordedId;
    const identity = catalogByID.get(recordedId);
    seen.add(recordedId);
    if (!identity) return ranking;
    return {
      ...ranking,
      identity: {
        ...ranking.identity,
        displayName: ranking.identity.displayName || identity.displayName,
        provider: ranking.identity.provider || identity.provider,
        current: identity.current,
        currentId: identity.currentId,
      },
    };
  });
  catalog.forEach((identity) => {
    if (seen.has(identity.recordedId) || !credentialVisibleWithoutUsage(identity, filters)) return;
    merged.push({
      identity: {
        recordedId: identity.recordedId,
        displayName: identity.displayName,
        provider: identity.provider,
        resolvedModel: '',
        requestedModel: '',
        current: true,
        currentId: identity.currentId,
      },
      metrics: zeroAnalyticsMetrics(currency),
      comparison: zeroAnalyticsMetrics(currency),
    });
  });
  return merged;
};
