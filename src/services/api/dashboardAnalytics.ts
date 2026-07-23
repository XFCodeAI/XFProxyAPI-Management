import type { ApiError } from '@/types/api';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';
import {
  normalizeAnalyticsBucket,
  normalizeAnalyticsMetrics,
  normalizeAnalyticsRanking,
  type AnalyticsBucket,
  type AnalyticsMetrics,
  type AnalyticsRanking,
} from './usageAnalytics';

export interface DashboardRolling {
  windowMinutes: number;
  calls: number;
  tokens: number;
  rpm: number;
  tpm: number;
}

export interface DashboardCollectorHealth {
  accepted: number;
  persisted: number;
  dropped: number;
  sqlErrors: number;
  depth: number;
  capacity: number;
  lagNanoseconds: number;
  lastSuccessAt: string;
  lastErrorAt: string;
  schemaReady: boolean;
  degraded: boolean;
  stale: boolean;
  started: boolean;
  closed: boolean;
}

export interface DashboardFailure {
  id: string;
  requestId: string;
  requestedAt: string;
  provider: string;
  resolvedModel: string;
  requestedModel: string;
  statusCode: number;
  failureCategory: string;
  latencyMs: number;
  credential: string;
  costAmount: string;
  costCurrency: string;
  costCoverage: string;
}

export interface DashboardAnalytics {
  available: true;
  generatedAt: string;
  snapshotAt: string;
  timezone: string;
  todayFrom: string;
  today: AnalyticsMetrics;
  rolling: DashboardRolling;
  timeline: AnalyticsBucket[];
  topModels: AnalyticsRanking[];
  collector: DashboardCollectorHealth;
  recentFailures: DashboardFailure[];
}

const invalidResponse = (context: string): never => {
  throw new Error(`dashboard_analytics_invalid_response:${context}`);
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

const numberValue = (record: Record<string, unknown>, key: string, context: string): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : invalidResponse(`${context}.${key}`);
};

const booleanValue = (record: Record<string, unknown>, key: string, context: string): boolean =>
  typeof record[key] === 'boolean'
    ? (record[key] as boolean)
    : invalidResponse(`${context}.${key}`);

const arrayValue = (record: Record<string, unknown>, key: string, context: string): unknown[] =>
  Array.isArray(record[key]) ? (record[key] as unknown[]) : invalidResponse(`${context}.${key}`);

const normalizeCollector = (value: unknown): DashboardCollectorHealth => {
  const record = requireRecord(value, 'dashboard.collector');
  if (record.available !== true) return invalidResponse('dashboard.collector.available');
  return {
    accepted: countValue(record, 'accepted', 'dashboard.collector'),
    persisted: countValue(record, 'persisted', 'dashboard.collector'),
    dropped: countValue(record, 'dropped', 'dashboard.collector'),
    sqlErrors: countValue(record, 'sql_errors', 'dashboard.collector'),
    depth: countValue(record, 'depth', 'dashboard.collector'),
    capacity: countValue(record, 'capacity', 'dashboard.collector'),
    lagNanoseconds: countValue(record, 'lag', 'dashboard.collector'),
    lastSuccessAt: stringValue(record, 'last_success_at', 'dashboard.collector'),
    lastErrorAt: stringValue(record, 'last_error_at', 'dashboard.collector'),
    schemaReady: booleanValue(record, 'schema_ready', 'dashboard.collector'),
    degraded: booleanValue(record, 'degraded', 'dashboard.collector'),
    stale: booleanValue(record, 'stale', 'dashboard.collector'),
    started: booleanValue(record, 'started', 'dashboard.collector'),
    closed: booleanValue(record, 'closed', 'dashboard.collector'),
  };
};

const normalizeFailure = (value: unknown, context: string): DashboardFailure => {
  const record = requireRecord(value, context);
  const identities = requireRecord(record.identities, `${context}.identities`);
  const credential = requireRecord(identities.credential, `${context}.identities.credential`);
  const cost = requireRecord(record.cost, `${context}.cost`);
  const amount = requiredString(cost, 'amount', `${context}.cost`);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    return invalidResponse(`${context}.cost.amount`);
  }
  return {
    id: requiredString(record, 'id', context),
    requestId: stringValue(record, 'request_id', context),
    requestedAt: requiredString(record, 'requested_at', context),
    provider: stringValue(record, 'provider', context),
    resolvedModel: stringValue(record, 'resolved_model', context),
    requestedModel: stringValue(record, 'requested_model', context),
    statusCode: countValue(record, 'status_code', context),
    failureCategory: stringValue(record, 'failure_category', context),
    latencyMs: countValue(record, 'latency_ms', context),
    credential:
      stringValue(credential, 'display_name', `${context}.identities.credential`) ||
      stringValue(credential, 'recorded_id', `${context}.identities.credential`),
    costAmount: amount,
    costCurrency: requiredString(cost, 'currency', `${context}.cost`),
    costCoverage: requiredString(cost, 'coverage', `${context}.cost`),
  };
};

export const normalizeDashboardAnalytics = (value: unknown): DashboardAnalytics => {
  const record = requireRecord(value, 'dashboard');
  if (record.available !== true) return invalidResponse('dashboard.available');
  const rolling = requireRecord(record.rolling, 'dashboard.rolling');
  return {
    available: true,
    generatedAt: requiredString(record, 'generated_at', 'dashboard'),
    snapshotAt: requiredString(record, 'snapshot_at', 'dashboard'),
    timezone: requiredString(record, 'timezone', 'dashboard'),
    todayFrom: requiredString(record, 'today_from', 'dashboard'),
    today: normalizeAnalyticsMetrics(record.today, 'dashboard.today'),
    rolling: {
      windowMinutes: countValue(rolling, 'window_minutes', 'dashboard.rolling'),
      calls: countValue(rolling, 'calls', 'dashboard.rolling'),
      tokens: countValue(rolling, 'tokens', 'dashboard.rolling'),
      rpm: numberValue(rolling, 'rpm', 'dashboard.rolling'),
      tpm: numberValue(rolling, 'tpm', 'dashboard.rolling'),
    },
    timeline: arrayValue(record, 'timeline', 'dashboard').map((entry, index) =>
      normalizeAnalyticsBucket(entry, `dashboard.timeline[${index}]`)
    ),
    topModels: arrayValue(record, 'top_models', 'dashboard').map((entry, index) =>
      normalizeAnalyticsRanking(entry, `dashboard.top_models[${index}]`)
    ),
    collector: normalizeCollector(record.collector),
    recentFailures: arrayValue(record, 'recent_failures', 'dashboard').map((entry, index) =>
      normalizeFailure(entry, `dashboard.recent_failures[${index}]`)
    ),
  };
};

export const isDashboardAnalyticsUnavailable = (error: unknown): boolean => {
  const status = (error as ApiError | null)?.status;
  return status === 404 || status === 405 || status === 501;
};

export const dashboardAnalyticsApi = {
  get: async (timezone: string): Promise<DashboardAnalytics> =>
    normalizeDashboardAnalytics(
      await apiClient.get(`/usage-analytics/dashboard?${new URLSearchParams({ timezone })}`)
    ),
};
