import {
  buildMonitoringQuery,
  isMonitoringAPIKeyID,
  type MonitoringIdentity,
  type MonitoringQueryInput,
  type MonitoringRequest,
  type MonitoringSummary,
} from '@/services/api/requestMonitoring';

export type MonitoringTimeRange = '1h' | '24h' | '7d' | '30d' | 'custom';

export interface MonitoringFilters {
  search: string;
  provider: string;
  pluginId: string;
  requestedModel: string;
  resolvedModel: string;
  result: string;
  failureCategory: string;
  authId: string;
  apiKeyId: string;
  credentialGroupId: string;
  apiKeyGroupId: string;
  proxyPoolId: string;
  cache: string;
  statusCode: string;
  minLatencyMs: string;
  maxLatencyMs: string;
  requestId: string;
  trace: string;
}

export interface MonitoringDrillQueryState {
  range: { from: string; to: string } | null;
  filters: MonitoringFilters;
  preservedQuery: string;
}

export const EMPTY_MONITORING_FILTERS: MonitoringFilters = {
  search: '',
  provider: 'all',
  pluginId: '',
  requestedModel: 'all',
  resolvedModel: 'all',
  result: 'all',
  failureCategory: 'all',
  authId: 'all',
  apiKeyId: 'all',
  credentialGroupId: '',
  apiKeyGroupId: '',
  proxyPoolId: '',
  cache: 'all',
  statusCode: '',
  minLatencyMs: '',
  maxLatencyMs: '',
  requestId: '',
  trace: '',
};

const MONITORING_ROUTE_PARAMS = new Set([
  'from',
  'to',
  'search',
  'provider',
  'plugin_id',
  'requested_model',
  'resolved_model',
  'result',
  'failure_category',
  'api_key_id',
  'auth_id',
  'credential_group_id',
  'api_key_group_id',
  'proxy_pool_id',
  'request_id',
  'trace',
  'status_code',
  'min_latency_ms',
  'max_latency_ms',
  'cache',
  'cursor',
  'limit',
  'max_records',
]);

const isRawAPIKeyParam = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return (
    ['apikey', 'rawapikey', 'xapikey', 'authorization', 'key'].includes(normalized) ||
    ['token', 'secret', 'password', 'cookie'].some((fragment) => normalized.includes(fragment))
  );
};

const queryParamsFrom = (source: string): URLSearchParams => {
  const hashRoute = source.includes('#') ? source.slice(source.indexOf('#') + 1) : source;
  const queryIndex = hashRoute.indexOf('?');
  if (queryIndex >= 0) return new URLSearchParams(hashRoute.slice(queryIndex + 1));
  if (hashRoute.startsWith('/')) return new URLSearchParams();
  return new URLSearchParams(hashRoute);
};

const selectedParam = (params: URLSearchParams, key: string): string => params.get(key) || 'all';

const integerParam = (params: URLSearchParams, key: string): string => {
  const value = params.get(key)?.trim() ?? '';
  if (!/^\d+$/.test(value)) return '';
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? value : '';
};

const isRFC3339 = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(new Date(value).getTime());

export const parseMonitoringDrillQuery = (source: string): MonitoringDrillQueryState => {
  const params = queryParamsFrom(source);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  const range = isRFC3339(from) && isRFC3339(to) && fromTime < toTime ? { from, to } : null;
  const result = params.get('result');
  const cache = params.get('cache');
  const preserved = new URLSearchParams();
  params.forEach((value, key) => {
    if (!MONITORING_ROUTE_PARAMS.has(key) && !isRawAPIKeyParam(key)) {
      preserved.append(key, value);
    }
  });

  return {
    range,
    filters: {
      search: params.get('search') ?? '',
      provider: selectedParam(params, 'provider'),
      pluginId: params.get('plugin_id') ?? '',
      requestedModel: selectedParam(params, 'requested_model'),
      resolvedModel: selectedParam(params, 'resolved_model'),
      result: result === 'success' || result === 'failure' ? result : 'all',
      failureCategory: selectedParam(params, 'failure_category'),
      authId: selectedParam(params, 'auth_id'),
      apiKeyId: isMonitoringAPIKeyID(params.get('api_key_id') ?? '')
        ? (params.get('api_key_id') as string)
        : 'all',
      credentialGroupId: params.get('credential_group_id') ?? '',
      apiKeyGroupId: params.get('api_key_group_id') ?? '',
      proxyPoolId: params.get('proxy_pool_id') ?? '',
      cache: cache === 'hit' || cache === 'miss' ? cache : 'all',
      statusCode: integerParam(params, 'status_code'),
      minLatencyMs: integerParam(params, 'min_latency_ms'),
      maxLatencyMs: integerParam(params, 'max_latency_ms'),
      requestId: params.get('request_id') ?? '',
      trace: params.get('trace') ?? '',
    },
    preservedQuery: preserved.toString(),
  };
};

export const buildMonitoringRange = (
  range: MonitoringTimeRange,
  now: Date,
  customFrom = '',
  customTo = ''
): { from: string; to: string } | null => {
  const to = range === 'custom' ? new Date(customTo) : now;
  const from = range === 'custom' ? new Date(customFrom) : new Date(now);
  if (range !== 'custom') {
    const durations: Record<Exclude<MonitoringTimeRange, 'custom'>, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    from.setTime(now.getTime() - durations[range]);
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return null;
  return { from: from.toISOString(), to: to.toISOString() };
};

const selected = (value: string): string | undefined =>
  value && value !== 'all' ? value : undefined;

const nonNegativeInteger = (value: string): number | undefined => {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const buildMonitoringRequestQuery = (
  range: { from: string; to: string },
  filters: MonitoringFilters,
  cursor = ''
): MonitoringQueryInput => {
  return {
    ...range,
    search: filters.search.trim() || undefined,
    provider: selected(filters.provider),
    pluginId: filters.pluginId.trim() || undefined,
    requestedModel: selected(filters.requestedModel),
    resolvedModel: selected(filters.resolvedModel),
    result: (selected(filters.result) as MonitoringQueryInput['result']) ?? '',
    failureCategory: selected(filters.failureCategory),
    authId: selected(filters.authId),
    apiKeyId: isMonitoringAPIKeyID(filters.apiKeyId) ? filters.apiKeyId : undefined,
    credentialGroupId: filters.credentialGroupId.trim() || undefined,
    apiKeyGroupId: filters.apiKeyGroupId.trim() || undefined,
    proxyPoolId: filters.proxyPoolId.trim() || undefined,
    cache: (selected(filters.cache) as MonitoringQueryInput['cache']) ?? '',
    statusCode: nonNegativeInteger(filters.statusCode),
    minLatencyMs: nonNegativeInteger(filters.minLatencyMs),
    maxLatencyMs: nonNegativeInteger(filters.maxLatencyMs),
    requestId: filters.requestId.trim() || undefined,
    trace: filters.trace.trim() || undefined,
    cursor: cursor || undefined,
    limit: 50,
  };
};

export const buildMonitoringDrillHref = (
  range: { from: string; to: string },
  filters: Partial<MonitoringFilters> = {},
  preservedQuery = ''
): string => {
  const params = queryParamsFrom(preservedQuery);
  Array.from(params.keys()).forEach((key) => {
    if (MONITORING_ROUTE_PARAMS.has(key) || isRawAPIKeyParam(key)) params.delete(key);
  });
  const query = buildMonitoringRequestQuery(range, {
    ...EMPTY_MONITORING_FILTERS,
    ...filters,
  });
  query.cursor = undefined;
  query.limit = undefined;
  new URLSearchParams(buildMonitoringQuery(query)).forEach((value, key) => {
    params.set(key, value);
  });
  const serialized = params.toString();
  return serialized ? `/monitoring?${serialized}` : '/monitoring';
};

export const hasAdvancedMonitoringFilters = (filters: MonitoringFilters): boolean =>
  Boolean(
    filters.pluginId ||
    filters.requestedModel !== 'all' ||
    filters.resolvedModel !== 'all' ||
    filters.failureCategory !== 'all' ||
    filters.authId !== 'all' ||
    filters.apiKeyId !== 'all' ||
    filters.credentialGroupId ||
    filters.apiKeyGroupId ||
    filters.proxyPoolId ||
    filters.cache !== 'all' ||
    filters.statusCode ||
    filters.minLatencyMs ||
    filters.maxLatencyMs ||
    filters.requestId ||
    filters.trace
  );

export const monitoringSuccessRate = (summary: MonitoringSummary): number =>
  summary.requests > 0 ? (summary.successes / summary.requests) * 100 : 100;

export const monitoringCacheRate = (summary: MonitoringSummary): number =>
  summary.requests > 0 ? (summary.cacheHits / summary.requests) * 100 : 0;

export const monitoringIdentityLabel = (identity: MonitoringIdentity, fallback: string): string =>
  identity.displayName || identity.recordedId || fallback;

export const isCurrentMonitoringIdentity = (
  identity: Pick<MonitoringIdentity, 'current' | 'currentId'>
): boolean => identity.current && Boolean(identity.currentId);

export const hasCurrentMonitoringTarget = (request: MonitoringRequest): boolean =>
  isCurrentMonitoringIdentity(request.identities.credential) ||
  isCurrentMonitoringIdentity(request.identities.apiKey) ||
  request.identities.credentialGroups.some(isCurrentMonitoringIdentity) ||
  request.identities.apiKeyGroups.some(isCurrentMonitoringIdentity) ||
  isCurrentMonitoringIdentity(request.identities.source) ||
  isCurrentMonitoringIdentity(request.identities.proxyPool) ||
  isCurrentMonitoringIdentity(request.identities.plugin);

export const hasMonitoringEvidence = (request: MonitoringRequest): boolean =>
  request.result === 'failure' ||
  Boolean(request.requestId) ||
  Object.keys(request.responseHeaders).length > 0;

export const mergeMonitoringRequests = (
  current: MonitoringRequest[],
  incoming: MonitoringRequest[]
): MonitoringRequest[] => {
  const byID = new Map(current.map((request) => [request.id, request]));
  incoming.forEach((request) => byID.set(request.id, request));
  return Array.from(byID.values()).sort(
    (left, right) =>
      new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime() ||
      right.id.localeCompare(left.id)
  );
};
