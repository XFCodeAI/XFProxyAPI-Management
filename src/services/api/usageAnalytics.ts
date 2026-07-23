import type { ApiError } from '@/types/api';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';
import { buildMonitoringQuery, type MonitoringQueryInput } from './requestMonitoring';

export type AnalyticsView =
  | 'overview'
  | 'trends'
  | 'models'
  | 'api-keys'
  | 'credentials'
  | 'credential-groups'
  | 'api-key-groups'
  | 'providers'
  | 'heatmap';

export type AnalyticsGranularity = 'hour' | 'day';
export type AnalyticsDataSource = 'raw' | 'rollup' | 'mixed';

export interface AnalyticsQueryInput extends MonitoringQueryInput {
  granularity: AnalyticsGranularity;
  timezone: string;
  limit?: number;
}

export interface AnalyticsCost {
  amount: string;
  currency: string;
  completeCalls: number;
  partialCalls: number;
  unpricedCalls: number;
  freeCalls: number;
  coverageRate: number;
  missingDimensions: Record<string, number>;
}

export interface AnalyticsMetrics {
  calls: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cacheHits: number;
  cacheHitRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageTtftMs: number;
  p95TtftMs: number;
  cost: AnalyticsCost;
}

export interface AnalyticsBucket {
  start: string;
  metrics: AnalyticsMetrics;
}

export interface AnalyticsIdentity {
  recordedId: string;
  displayName: string;
  provider: string;
  resolvedModel: string;
  requestedModel: string;
  current: boolean;
  currentId: string;
}

export interface AnalyticsRanking {
  identity: AnalyticsIdentity;
  metrics: AnalyticsMetrics;
  comparison: AnalyticsMetrics;
}

export interface AnalyticsHeatmapCell {
  isoWeekday: number;
  hour: number;
  metrics: AnalyticsMetrics;
  comparison: AnalyticsMetrics;
}

export interface AnalyticsAnomaly {
  start: string;
  reasons: string[];
  metrics: AnalyticsMetrics;
}

export interface AnalyticsReport {
  available: true;
  view: AnalyticsView;
  generatedAt: string;
  snapshotAt: string;
  from: string;
  to: string;
  comparisonFrom: string;
  comparisonTo: string;
  granularity: AnalyticsGranularity;
  timezone: string;
  dataSource: AnalyticsDataSource;
  fallbackReason: string;
  catalogVersion: number;
  summary: AnalyticsMetrics | null;
  comparison: AnalyticsMetrics | null;
  series: AnalyticsBucket[];
  comparisonSeries: AnalyticsBucket[];
  rankings: AnalyticsRanking[];
  heatmap: AnalyticsHeatmapCell[];
  anomalies: AnalyticsAnomaly[];
}

const BASE_PATH = '/usage-analytics/reports';

const invalidResponse = (context: string): never => {
  throw new Error(`usage_analytics_invalid_response:${context}`);
};

const requireRecord = (value: unknown, context: string): Record<string, unknown> =>
  isRecord(value) ? value : invalidResponse(context);

const stringValue = (record: Record<string, unknown>, key: string, context: string): string => {
  const value = record[key];
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : invalidResponse(`${context}.${key}`);
};

const requiredString = (record: Record<string, unknown>, key: string, context: string): string => {
  const value = stringValue(record, key, context).trim();
  return value || invalidResponse(`${context}.${key}`);
};

const countValue = (record: Record<string, unknown>, key: string, context: string): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidResponse(`${context}.${key}`);
};

const rateValue = (record: Record<string, unknown>, key: string, context: string): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : invalidResponse(`${context}.${key}`);
};

const booleanValue = (record: Record<string, unknown>, key: string, context: string): boolean =>
  typeof record[key] === 'boolean'
    ? (record[key] as boolean)
    : invalidResponse(`${context}.${key}`);

const arrayValue = (record: Record<string, unknown>, key: string, context: string): unknown[] =>
  Array.isArray(record[key]) ? (record[key] as unknown[]) : invalidResponse(`${context}.${key}`);

const decimalValue = (record: Record<string, unknown>, key: string, context: string): string => {
  const value = requiredString(record, key, context);
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : invalidResponse(`${context}.${key}`);
};

const normalizeCost = (value: unknown, context: string): AnalyticsCost => {
  const record = requireRecord(value, context);
  const missing = requireRecord(record.missing_dimensions ?? {}, `${context}.missing_dimensions`);
  return {
    amount: decimalValue(record, 'amount', context),
    currency: requiredString(record, 'currency', context),
    completeCalls: countValue(record, 'complete_calls', context),
    partialCalls: countValue(record, 'partial_calls', context),
    unpricedCalls: countValue(record, 'unpriced_calls', context),
    freeCalls: countValue(record, 'free_calls', context),
    coverageRate: rateValue(record, 'coverage_rate', context),
    missingDimensions: Object.fromEntries(
      Object.entries(missing).map(([key, entry]) => [
        key,
        typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
          ? entry
          : invalidResponse(`${context}.missing_dimensions.${key}`),
      ])
    ),
  };
};

export const normalizeAnalyticsMetrics = (
  value: unknown,
  context: string
): AnalyticsMetrics => {
  const record = requireRecord(value, context);
  return {
    calls: countValue(record, 'calls', context),
    successes: countValue(record, 'successes', context),
    failures: countValue(record, 'failures', context),
    inputTokens: countValue(record, 'input_tokens', context),
    outputTokens: countValue(record, 'output_tokens', context),
    reasoningTokens: countValue(record, 'reasoning_tokens', context),
    cachedTokens: countValue(record, 'cached_tokens', context),
    cacheReadTokens: countValue(record, 'cache_read_tokens', context),
    cacheCreationTokens: countValue(record, 'cache_creation_tokens', context),
    totalTokens: countValue(record, 'total_tokens', context),
    cacheHits: countValue(record, 'cache_hits', context),
    cacheHitRate: rateValue(record, 'cache_hit_rate', context),
    averageLatencyMs: countValue(record, 'average_latency_ms', context),
    p95LatencyMs: countValue(record, 'p95_latency_ms', context),
    averageTtftMs: countValue(record, 'average_ttft_ms', context),
    p95TtftMs: countValue(record, 'p95_ttft_ms', context),
    cost: normalizeCost(record.cost, `${context}.cost`),
  };
};

const normalizeIdentity = (value: unknown, context: string): AnalyticsIdentity => {
  const record = requireRecord(value, context);
  return {
    recordedId: stringValue(record, 'recorded_id', context),
    displayName: stringValue(record, 'display_name', context),
    provider: stringValue(record, 'provider', context),
    resolvedModel: stringValue(record, 'resolved_model', context),
    requestedModel: stringValue(record, 'requested_model', context),
    current: booleanValue(record, 'current', context),
    currentId: stringValue(record, 'current_id', context),
  };
};

export const normalizeAnalyticsBucket = (value: unknown, context: string): AnalyticsBucket => {
  const record = requireRecord(value, context);
  return {
    start: requiredString(record, 'start', context),
    metrics: normalizeAnalyticsMetrics(record.metrics, `${context}.metrics`),
  };
};

export const normalizeAnalyticsRanking = (value: unknown, context: string): AnalyticsRanking => {
  const record = requireRecord(value, context);
  return {
    identity: normalizeIdentity(record.identity, `${context}.identity`),
    metrics: normalizeAnalyticsMetrics(record.metrics, `${context}.metrics`),
    comparison: normalizeAnalyticsMetrics(record.comparison, `${context}.comparison`),
  };
};

const normalizeHeatmapCell = (value: unknown, context: string): AnalyticsHeatmapCell => {
  const record = requireRecord(value, context);
  const isoWeekday = countValue(record, 'iso_weekday', context);
  const hour = countValue(record, 'hour', context);
  if (isoWeekday < 1 || isoWeekday > 7 || hour > 23) return invalidResponse(context);
  return {
    isoWeekday,
    hour,
    metrics: normalizeAnalyticsMetrics(record.metrics, `${context}.metrics`),
    comparison: normalizeAnalyticsMetrics(record.comparison, `${context}.comparison`),
  };
};

const normalizeAnomaly = (value: unknown, context: string): AnalyticsAnomaly => {
  const record = requireRecord(value, context);
  return {
    start: requiredString(record, 'start', context),
    reasons: arrayValue(record, 'reasons', context).map((reason, index) =>
      typeof reason === 'string' && reason
        ? reason
        : invalidResponse(`${context}.reasons[${index}]`)
    ),
    metrics: normalizeAnalyticsMetrics(record.metrics, `${context}.metrics`),
  };
};

const analyticsViews: AnalyticsView[] = [
  'overview',
  'trends',
  'models',
  'api-keys',
  'credentials',
  'credential-groups',
  'api-key-groups',
  'providers',
  'heatmap',
];

export const normalizeAnalyticsReport = (value: unknown): AnalyticsReport => {
  const record = requireRecord(value, 'analytics');
  if (record.available !== true) return invalidResponse('analytics.available');
  const view = requiredString(record, 'view', 'analytics') as AnalyticsView;
  const granularity = requiredString(record, 'granularity', 'analytics') as AnalyticsGranularity;
  const dataSource = requiredString(record, 'data_source', 'analytics') as AnalyticsDataSource;
  if (!analyticsViews.includes(view)) return invalidResponse('analytics.view');
  if (granularity !== 'hour' && granularity !== 'day') {
    return invalidResponse('analytics.granularity');
  }
  if (!['raw', 'rollup', 'mixed'].includes(dataSource)) {
    return invalidResponse('analytics.data_source');
  }
  const summary = record.summary;
  const comparison = record.comparison;
  return {
    available: true,
    view,
    generatedAt: requiredString(record, 'generated_at', 'analytics'),
    snapshotAt: requiredString(record, 'snapshot_at', 'analytics'),
    from: requiredString(record, 'from', 'analytics'),
    to: requiredString(record, 'to', 'analytics'),
    comparisonFrom: requiredString(record, 'comparison_from', 'analytics'),
    comparisonTo: requiredString(record, 'comparison_to', 'analytics'),
    granularity,
    timezone: requiredString(record, 'timezone', 'analytics'),
    dataSource,
    fallbackReason: stringValue(record, 'fallback_reason', 'analytics'),
    catalogVersion: countValue(record, 'catalog_version', 'analytics'),
    summary:
      summary === undefined || summary === null
        ? null
        : normalizeAnalyticsMetrics(summary, 'analytics.summary'),
    comparison:
      comparison === undefined || comparison === null
        ? null
        : normalizeAnalyticsMetrics(comparison, 'analytics.comparison'),
    series: arrayValue(record, 'series', 'analytics').map((entry, index) =>
      normalizeAnalyticsBucket(entry, `analytics.series[${index}]`)
    ),
    comparisonSeries: arrayValue(record, 'comparison_series', 'analytics').map((entry, index) =>
      normalizeAnalyticsBucket(entry, `analytics.comparison_series[${index}]`)
    ),
    rankings: arrayValue(record, 'rankings', 'analytics').map((entry, index) =>
      normalizeAnalyticsRanking(entry, `analytics.rankings[${index}]`)
    ),
    heatmap: arrayValue(record, 'heatmap', 'analytics').map((entry, index) =>
      normalizeHeatmapCell(entry, `analytics.heatmap[${index}]`)
    ),
    anomalies: arrayValue(record, 'anomalies', 'analytics').map((entry, index) =>
      normalizeAnomaly(entry, `analytics.anomalies[${index}]`)
    ),
  };
};

export const buildAnalyticsQuery = (input: AnalyticsQueryInput): string => {
  const params = new URLSearchParams(buildMonitoringQuery({ ...input, cursor: undefined }));
  params.set('granularity', input.granularity);
  params.set('timezone', input.timezone);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  return params.toString();
};

export const isAnalyticsCapabilityUnavailable = (error: unknown): boolean => {
  const status = (error as ApiError | null)?.status;
  return status === 404 || status === 405 || status === 501;
};

export const usageAnalyticsApi = {
  get: async (view: AnalyticsView, query: AnalyticsQueryInput): Promise<AnalyticsReport> => {
    const report = normalizeAnalyticsReport(
      await apiClient.get(`${BASE_PATH}/${view}?${buildAnalyticsQuery(query)}`)
    );
    return report.view === view ? report : invalidResponse('analytics.view_mismatch');
  },
};
