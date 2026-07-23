import type { AxiosResponse } from 'axios';
import type { ApiError } from '@/types/api';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

export type MonitoringResult = 'success' | 'failure';
export type MonitoringCacheFilter = '' | 'hit' | 'miss';
export type MonitoringCostCoverage = 'complete' | 'partial' | 'unpriced' | 'free';

export const isMonitoringAPIKeyID = (value: string): boolean =>
  /^hmac-sha256:[a-f0-9]{64}$/.test(value);

export interface MonitoringQueryInput {
  from: string;
  to: string;
  search?: string;
  provider?: string;
  pluginId?: string;
  requestedModel?: string;
  resolvedModel?: string;
  result?: MonitoringResult | '';
  failureCategory?: string;
  apiKeyId?: string;
  authId?: string;
  credentialGroupId?: string;
  apiKeyGroupId?: string;
  proxyPoolId?: string;
  requestId?: string;
  trace?: string;
  statusCode?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  cache?: MonitoringCacheFilter;
  cursor?: string;
  limit?: number;
}

export interface MonitoringIdentity {
  recordedId: string;
  displayName: string;
  currentId: string;
  current: boolean;
}

export interface MonitoringGroupIdentity extends MonitoringIdentity {
  name: string;
}

export interface MonitoringIdentities {
  credential: MonitoringIdentity;
  apiKey: MonitoringIdentity;
  credentialGroups: MonitoringGroupIdentity[];
  apiKeyGroups: MonitoringGroupIdentity[];
  plugin: MonitoringIdentity;
  source: MonitoringIdentity;
  proxyPool: MonitoringIdentity;
}

export interface MonitoringTokens {
  input: number;
  output: number;
  reasoning: number;
  cached: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

export interface MonitoringCost {
  estimate: boolean;
  currency: string;
  amount: string;
  coverage: MonitoringCostCoverage;
  missingDimensions: string[];
  ruleId: string;
  ruleSource: string;
  catalogVersion: number;
}

export interface MonitoringRequest {
  id: string;
  requestId: string;
  requestedAt: string;
  ingestedAt: string;
  provider: string;
  executorType: string;
  resolvedModel: string;
  requestedModel: string;
  authType: string;
  authIndex: string;
  reasoningEffort: string;
  serviceTier: string;
  responseServiceTier: string;
  generate: boolean;
  tokens: MonitoringTokens;
  latencyMs: number;
  ttftMs: number;
  result: MonitoringResult;
  statusCode: number;
  failureCategory: string;
  responseHeaders: Record<string, string[]>;
  identities: MonitoringIdentities;
  cost: MonitoringCost;
}

export interface MonitoringSummary {
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageTtftMs: number;
  cacheHits: number;
}

export interface MonitoringCostSummary {
  amount: string;
  currency: string;
  completeCalls: number;
  partialCalls: number;
  unpricedCalls: number;
  freeCalls: number;
  missingDimensions: Record<string, number>;
  catalogVersion: number;
  truncated: boolean;
}

export interface MonitoringIdentityAggregate {
  recordedId: string;
  displayName: string;
  provider: string;
  requests: number;
  failures: number;
  totalTokens: number;
  averageLatencyMs: number;
  lastRequestAt: string;
  currentId: string;
  current: boolean;
}

export interface MonitoringFacetValue {
  value: string;
  count: number;
}

export interface MonitoringFacets {
  providers: MonitoringFacetValue[];
  resolvedModels: MonitoringFacetValue[];
  requestedModels: MonitoringFacetValue[];
  failureCategories: MonitoringFacetValue[];
}

export interface MonitoringResponse {
  available: true;
  generatedAt: string;
  snapshotAt: string;
  summary: MonitoringSummary;
  cost: MonitoringCostSummary;
  facets: MonitoringFacets;
  credentials: MonitoringIdentityAggregate[];
  apiKeys: MonitoringIdentityAggregate[];
  requests: MonitoringRequest[];
  nextCursor: string;
}

export interface MonitoringRetention {
  days: number;
  eventCount: number;
  oldestAt: string | null;
  newestAt: string | null;
}

export interface MonitoringRetentionRun {
  days: number;
  cutoff: string;
  deleted: number;
  hasMore: boolean;
  remaining: number;
}

export interface MonitoringImportResult {
  added: number;
  skipped: number;
  failed: number;
}

const BASE_PATH = '/usage-analytics/monitoring';

const invalidResponse = (context: string): never => {
  throw new Error(`request_monitoring_invalid_response:${context}`);
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

const optionalCountValue = (
  record: Record<string, unknown>,
  key: string,
  context: string
): number => {
  const value = record[key];
  return value === undefined || value === null ? 0 : countValue(record, key, context);
};

const booleanValue = (record: Record<string, unknown>, key: string, context: string): boolean => {
  const value = record[key];
  return typeof value === 'boolean' ? value : invalidResponse(`${context}.${key}`);
};

const arrayValue = (record: Record<string, unknown>, key: string, context: string): unknown[] => {
  const value = record[key];
  return Array.isArray(value) ? value : invalidResponse(`${context}.${key}`);
};

const stringArray = (record: Record<string, unknown>, key: string, context: string): string[] =>
  arrayValue(record, key, context).map((value, index) =>
    typeof value === 'string' ? value : invalidResponse(`${context}.${key}[${index}]`)
  );

const nullableStringArray = (
  record: Record<string, unknown>,
  key: string,
  context: string
): string[] => {
  const value = record[key];
  return value === undefined || value === null ? [] : stringArray(record, key, context);
};

const decimalValue = (record: Record<string, unknown>, key: string, context: string): string => {
  const value = requiredString(record, key, context);
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : invalidResponse(`${context}.${key}`);
};

const normalizeIdentity = (value: unknown, context: string): MonitoringIdentity => {
  const record = requireRecord(value, context);
  return {
    recordedId: stringValue(record, 'recorded_id', context),
    displayName: stringValue(record, 'display_name', context),
    currentId: stringValue(record, 'current_id', context),
    current: booleanValue(record, 'current', context),
  };
};

const normalizeGroup = (value: unknown, context: string): MonitoringGroupIdentity => {
  const record = requireRecord(value, context);
  return { ...normalizeIdentity(record, context), name: stringValue(record, 'name', context) };
};

const normalizeIdentities = (value: unknown, context: string): MonitoringIdentities => {
  const record = requireRecord(value, context);
  return {
    credential: normalizeIdentity(record.credential, `${context}.credential`),
    apiKey: normalizeIdentity(record.api_key, `${context}.api_key`),
    credentialGroups: arrayValue(record, 'credential_groups', context).map((entry, index) =>
      normalizeGroup(entry, `${context}.credential_groups[${index}]`)
    ),
    apiKeyGroups: arrayValue(record, 'api_key_groups', context).map((entry, index) =>
      normalizeGroup(entry, `${context}.api_key_groups[${index}]`)
    ),
    plugin: normalizeIdentity(record.plugin, `${context}.plugin`),
    source: normalizeIdentity(record.source, `${context}.source`),
    proxyPool: normalizeIdentity(record.proxy_pool, `${context}.proxy_pool`),
  };
};

const normalizeTokens = (value: unknown, context: string): MonitoringTokens => {
  const record = requireRecord(value, context);
  return {
    input: countValue(record, 'input', context),
    output: countValue(record, 'output', context),
    reasoning: countValue(record, 'reasoning', context),
    cached: countValue(record, 'cached', context),
    cacheRead: countValue(record, 'cache_read', context),
    cacheCreation: countValue(record, 'cache_creation', context),
    total: countValue(record, 'total', context),
  };
};

const normalizeCost = (value: unknown, context: string): MonitoringCost => {
  const record = requireRecord(value, context);
  const coverage = requiredString(record, 'coverage', context);
  if (!['complete', 'partial', 'unpriced', 'free'].includes(coverage)) {
    return invalidResponse(`${context}.coverage`);
  }
  return {
    estimate: booleanValue(record, 'estimate', context),
    currency: requiredString(record, 'currency', context),
    amount: decimalValue(record, 'amount', context),
    coverage: coverage as MonitoringCostCoverage,
    missingDimensions: nullableStringArray(record, 'missing_dimensions', context),
    ruleId: stringValue(record, 'rule_id', context),
    ruleSource: stringValue(record, 'rule_source', context),
    catalogVersion: countValue(record, 'catalog_version', context),
  };
};

const normalizeHeaders = (value: unknown, context: string): Record<string, string[]> => {
  const record = requireRecord(value ?? {}, context);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => {
      if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string')) {
        return invalidResponse(`${context}.${key}`);
      }
      return [key, entry as string[]];
    })
  );
};

const normalizeRequest = (value: unknown, context: string): MonitoringRequest => {
  const record = requireRecord(value, context);
  const result = requiredString(record, 'result', context);
  if (result !== 'success' && result !== 'failure') return invalidResponse(`${context}.result`);
  return {
    id: requiredString(record, 'id', context),
    requestId: stringValue(record, 'request_id', context),
    requestedAt: requiredString(record, 'requested_at', context),
    ingestedAt: requiredString(record, 'ingested_at', context),
    provider: stringValue(record, 'provider', context),
    executorType: stringValue(record, 'executor_type', context),
    resolvedModel: stringValue(record, 'resolved_model', context),
    requestedModel: stringValue(record, 'requested_model', context),
    authType: stringValue(record, 'auth_type', context),
    authIndex: stringValue(record, 'auth_index', context),
    reasoningEffort: stringValue(record, 'reasoning_effort', context),
    serviceTier: stringValue(record, 'service_tier', context),
    responseServiceTier: stringValue(record, 'response_service_tier', context),
    generate: booleanValue(record, 'generate', context),
    tokens: normalizeTokens(record.tokens, `${context}.tokens`),
    latencyMs: countValue(record, 'latency_ms', context),
    ttftMs: countValue(record, 'ttft_ms', context),
    result,
    statusCode: optionalCountValue(record, 'status_code', context),
    failureCategory: stringValue(record, 'failure_category', context),
    responseHeaders: normalizeHeaders(record.response_headers, `${context}.response_headers`),
    identities: normalizeIdentities(record.identities, `${context}.identities`),
    cost: normalizeCost(record.cost, `${context}.cost`),
  };
};

const normalizeSummary = (value: unknown): MonitoringSummary => {
  const record = requireRecord(value, 'summary');
  return {
    requests: countValue(record, 'requests', 'summary'),
    successes: countValue(record, 'successes', 'summary'),
    failures: countValue(record, 'failures', 'summary'),
    inputTokens: countValue(record, 'input_tokens', 'summary'),
    outputTokens: countValue(record, 'output_tokens', 'summary'),
    reasoningTokens: countValue(record, 'reasoning_tokens', 'summary'),
    cacheReadTokens: countValue(record, 'cache_read_tokens', 'summary'),
    cacheCreationTokens: countValue(record, 'cache_creation_tokens', 'summary'),
    totalTokens: countValue(record, 'total_tokens', 'summary'),
    averageLatencyMs: countValue(record, 'average_latency_ms', 'summary'),
    p95LatencyMs: countValue(record, 'p95_latency_ms', 'summary'),
    averageTtftMs: countValue(record, 'average_ttft_ms', 'summary'),
    cacheHits: countValue(record, 'cache_hits', 'summary'),
  };
};

const normalizeCostSummary = (value: unknown): MonitoringCostSummary => {
  const record = requireRecord(value, 'cost');
  const missing = requireRecord(record.missing_dimensions ?? {}, 'cost.missing_dimensions');
  return {
    amount: decimalValue(record, 'amount', 'cost'),
    currency: requiredString(record, 'currency', 'cost'),
    completeCalls: countValue(record, 'complete_calls', 'cost'),
    partialCalls: countValue(record, 'partial_calls', 'cost'),
    unpricedCalls: countValue(record, 'unpriced_calls', 'cost'),
    freeCalls: countValue(record, 'free_calls', 'cost'),
    missingDimensions: Object.fromEntries(
      Object.entries(missing).map(([key, entry]) => [
        key,
        typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
          ? entry
          : invalidResponse(`cost.missing_dimensions.${key}`),
      ])
    ),
    catalogVersion: countValue(record, 'catalog_version', 'cost'),
    truncated: booleanValue(record, 'truncated', 'cost'),
  };
};

const normalizeAggregate = (value: unknown, context: string): MonitoringIdentityAggregate => {
  const record = requireRecord(value, context);
  return {
    recordedId: stringValue(record, 'recorded_id', context),
    displayName: stringValue(record, 'display_name', context),
    provider: stringValue(record, 'provider', context),
    requests: countValue(record, 'requests', context),
    failures: countValue(record, 'failures', context),
    totalTokens: countValue(record, 'total_tokens', context),
    averageLatencyMs: countValue(record, 'average_latency_ms', context),
    lastRequestAt: requiredString(record, 'last_request_at', context),
    currentId: stringValue(record, 'current_id', context),
    current: booleanValue(record, 'current', context),
  };
};

const normalizeFacets = (value: unknown): MonitoringFacets => {
  const record = requireRecord(value, 'facets');
  const normalizeValues = (key: string) =>
    arrayValue(record, key, 'facets').map((entry, index) => {
      const item = requireRecord(entry, `facets.${key}[${index}]`);
      return {
        value: requiredString(item, 'value', `facets.${key}[${index}]`),
        count: countValue(item, 'count', `facets.${key}[${index}]`),
      };
    });
  return {
    providers: normalizeValues('providers'),
    resolvedModels: normalizeValues('resolved_models'),
    requestedModels: normalizeValues('requested_models'),
    failureCategories: normalizeValues('failure_categories'),
  };
};

export const normalizeMonitoringResponse = (value: unknown): MonitoringResponse => {
  const record = requireRecord(value, 'monitoring');
  if (record.available !== true) return invalidResponse('monitoring.available');
  return {
    available: true,
    generatedAt: requiredString(record, 'generated_at', 'monitoring'),
    snapshotAt: requiredString(record, 'snapshot_at', 'monitoring'),
    summary: normalizeSummary(record.summary),
    cost: normalizeCostSummary(record.cost),
    facets: normalizeFacets(record.facets),
    credentials: arrayValue(record, 'credentials', 'monitoring').map((entry, index) =>
      normalizeAggregate(entry, `monitoring.credentials[${index}]`)
    ),
    apiKeys: arrayValue(record, 'api_keys', 'monitoring').map((entry, index) =>
      normalizeAggregate(entry, `monitoring.api_keys[${index}]`)
    ),
    requests: arrayValue(record, 'requests', 'monitoring').map((entry, index) =>
      normalizeRequest(entry, `monitoring.requests[${index}]`)
    ),
    nextCursor: stringValue(record, 'next_cursor', 'monitoring'),
  };
};

export const buildMonitoringQuery = (
  input: MonitoringQueryInput,
  options: { maxRecords?: number } = {}
): string => {
  const params = new URLSearchParams();
  const append = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return;
    params.set(key, String(value));
  };
  append('from', input.from);
  append('to', input.to);
  append('search', input.search?.trim());
  append('provider', input.provider);
  append('plugin_id', input.pluginId);
  append('requested_model', input.requestedModel);
  append('resolved_model', input.resolvedModel);
  append('result', input.result);
  append('failure_category', input.failureCategory);
  append(
    'api_key_id',
    input.apiKeyId && isMonitoringAPIKeyID(input.apiKeyId) ? input.apiKeyId : undefined
  );
  append('auth_id', input.authId);
  append('credential_group_id', input.credentialGroupId);
  append('api_key_group_id', input.apiKeyGroupId);
  append('proxy_pool_id', input.proxyPoolId);
  append('request_id', input.requestId);
  append('trace', input.trace);
  append('status_code', input.statusCode);
  append('min_latency_ms', input.minLatencyMs);
  append('max_latency_ms', input.maxLatencyMs);
  append('cache', input.cache);
  append('cursor', input.cursor);
  append('limit', input.limit);
  append('max_records', options.maxRecords);
  return params.toString();
};

const normalizeRetention = (value: unknown, context: string): MonitoringRetention => {
  const record = requireRecord(value, context);
  const readTime = (key: string): string | null => {
    const entry = record[key];
    if (entry === null || entry === undefined) return null;
    return typeof entry === 'string' ? entry : invalidResponse(`${context}.${key}`);
  };
  return {
    days: countValue(record, 'days', context),
    eventCount: countValue(record, 'event_count', context),
    oldestAt: readTime('oldest_at'),
    newestAt: readTime('newest_at'),
  };
};

const normalizeImportResult = (value: unknown): MonitoringImportResult => {
  const record = requireRecord(value, 'import');
  const result = requireRecord(record.result, 'import.result');
  return {
    added: countValue(result, 'added', 'import.result'),
    skipped: countValue(result, 'skipped', 'import.result'),
    failed: countValue(result, 'failed', 'import.result'),
  };
};

export const isMonitoringCapabilityUnavailable = (error: unknown): boolean => {
  const status = (error as ApiError | null)?.status;
  return status === 404 || status === 405 || status === 501;
};

export const requestMonitoringApi = {
  get: async (query: MonitoringQueryInput): Promise<MonitoringResponse> =>
    normalizeMonitoringResponse(await apiClient.get(`${BASE_PATH}?${buildMonitoringQuery(query)}`)),

  export: async (query: MonitoringQueryInput, maxRecords = 5000): Promise<AxiosResponse<Blob>> =>
    apiClient.getRaw(`${BASE_PATH}/export?${buildMonitoringQuery(query, { maxRecords })}`, {
      responseType: 'blob',
    }) as Promise<AxiosResponse<Blob>>,

  import: async (file: File): Promise<MonitoringImportResult> =>
    normalizeImportResult(
      await apiClient.post(`${BASE_PATH}/import`, file, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    ),

  getRetention: async (): Promise<MonitoringRetention> => {
    const record = requireRecord(await apiClient.get(`${BASE_PATH}/retention`), 'retention');
    if (record.available !== true) return invalidResponse('retention.available');
    return normalizeRetention(record.retention, 'retention.retention');
  },

  setRetention: async (days: number): Promise<MonitoringRetention> => {
    const record = requireRecord(
      await apiClient.put(`${BASE_PATH}/retention`, { days }),
      'retention_update'
    );
    return normalizeRetention(record.retention, 'retention_update.retention');
  },

  runRetention: async (limit = 10000): Promise<MonitoringRetentionRun> => {
    const record = requireRecord(
      await apiClient.post(`${BASE_PATH}/retention/run`, { limit }),
      'retention_run'
    );
    const result = requireRecord(record.result, 'retention_run.result');
    return {
      days: countValue(result, 'days', 'retention_run.result'),
      cutoff: requiredString(result, 'cutoff', 'retention_run.result'),
      deleted: countValue(result, 'deleted', 'retention_run.result'),
      hasMore: booleanValue(result, 'has_more', 'retention_run.result'),
      remaining: countValue(result, 'remaining', 'retention_run.result'),
    };
  },
};
