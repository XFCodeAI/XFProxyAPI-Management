export type StatusBlockState = 'success' | 'failure' | 'mixed' | 'idle';

export interface StatusBlockDetail {
  success: number;
  failure: number;
  rate: number;
  startTime: number;
  endTime: number;
}

export interface StatusBarData {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number;
  totalSuccess: number;
  totalFailure: number;
}

export interface RecentRequestBucket {
  time?: string;
  success: number;
  failed: number;
}

export interface RecentFailure {
  timestamp: string;
  statusCode?: number;
  code?: string;
  message: string;
  model?: string;
  requestId?: string;
  scope: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  nextRetryAt?: string;
}

export interface RecentRequestUsageEntry {
  success: number;
  failed: number;
  recentRequests: RecentRequestBucket[];
  authIndexes: string[];
  recentFailureCount: number;
  latestFailure: RecentFailure | null;
}

export interface ApiKeyFailureHistory {
  authIndex: string;
  authId: string;
  provider: string;
  alias: string;
  keyPreview: string;
  monitoringAvailable: boolean;
  failures: RecentFailure[];
}

export type ApiKeyUsageResponse = Record<
  string,
  Record<
    string,
    {
      success?: unknown;
      failed?: unknown;
      recent_requests?: unknown;
      recentRequests?: unknown;
      auth_indexes?: unknown;
      authIndexes?: unknown;
      recent_failure_count?: unknown;
      recentFailureCount?: unknown;
      latest_failure?: unknown;
      latestFailure?: unknown;
    }
  >
>;

const RECENT_REQUEST_BLOCK_COUNT = 20;
const RECENT_REQUEST_BLOCK_DURATION_MS = 10 * 60 * 1000;

const toFiniteNumber = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const toOptionalFiniteNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

export function normalizeUsageTotal(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const numberValue = Number(trimmed);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  return 0;
}

export function buildRecentRequestCompositeKey(baseUrl: unknown, apiKey: unknown): string {
  const normalizedBaseUrl = String(baseUrl ?? '').trim();
  const normalizedApiKey = String(apiKey ?? '').trim();
  return `${normalizedBaseUrl}|${normalizedApiKey}`;
}

export function normalizeRecentRequestAuthIndex(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function normalizeRecentFailure(input: unknown): RecentFailure | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const message = normalizeOptionalString(record.message);
  if (!message) return null;

  const timestamp = normalizeOptionalString(record.timestamp) ?? '';
  const statusCode = toOptionalFiniteNumber(record.status_code ?? record.statusCode);
  const retryAfterSeconds = toOptionalFiniteNumber(
    record.retry_after_seconds ?? record.retryAfterSeconds
  );
  const code = normalizeOptionalString(record.code);
  const model = normalizeOptionalString(record.model);
  const requestId = normalizeOptionalString(record.request_id ?? record.requestId);
  const nextRetryAt = normalizeOptionalString(record.next_retry_at ?? record.nextRetryAt);

  return {
    timestamp,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(code ? { code } : {}),
    message,
    ...(model ? { model } : {}),
    ...(requestId ? { requestId } : {}),
    scope: normalizeOptionalString(record.scope) ?? 'transport',
    retryable: record.retryable === true,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(nextRetryAt ? { nextRetryAt } : {}),
  };
}

const normalizeRecentFailureList = (input: unknown): RecentFailure[] =>
  Array.isArray(input)
    ? input
        .map((item) => normalizeRecentFailure(item))
        .filter((item): item is RecentFailure => item !== null)
    : [];

const normalizeAuthIndexes = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  input.forEach((value) => {
    const normalized = normalizeRecentRequestAuthIndex(value);
    if (normalized) seen.add(normalized);
  });
  return Array.from(seen);
};

export function normalizeRecentRequestBuckets(input: unknown): RecentRequestBucket[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.slice(-RECENT_REQUEST_BLOCK_COUNT).map((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const time = typeof record.time === 'string' ? record.time : undefined;

    return {
      ...(time ? { time } : {}),
      success: toFiniteNumber(record.success),
      failed: toFiniteNumber(record.failed),
    };
  });
}

export function normalizeRecentRequestUsageEntry(input: unknown): RecentRequestUsageEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      success: 0,
      failed: 0,
      recentRequests: [],
      authIndexes: [],
      recentFailureCount: 0,
      latestFailure: null,
    };
  }

  const record = input as Record<string, unknown>;
  const recentFailureCount = Math.max(
    0,
    Math.trunc(toFiniteNumber(record.recent_failure_count ?? record.recentFailureCount))
  );

  return {
    success: normalizeUsageTotal(record.success),
    failed: normalizeUsageTotal(record.failed),
    recentRequests: normalizeRecentRequestBuckets(record.recent_requests ?? record.recentRequests),
    authIndexes: normalizeAuthIndexes(record.auth_indexes ?? record.authIndexes),
    recentFailureCount,
    latestFailure: normalizeRecentFailure(record.latest_failure ?? record.latestFailure),
  };
}

export function normalizeApiKeyFailureHistory(input: unknown): ApiKeyFailureHistory {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    authIndex: normalizeRecentRequestAuthIndex(record.auth_index ?? record.authIndex) ?? '',
    authId: normalizeOptionalString(record.auth_id ?? record.authId) ?? '',
    provider: normalizeOptionalString(record.provider) ?? '',
    alias: normalizeOptionalString(record.alias) ?? '',
    keyPreview: normalizeOptionalString(record.key_preview ?? record.keyPreview) ?? '',
    monitoringAvailable: (record.monitoring_available ?? record.monitoringAvailable) === true,
    failures: normalizeRecentFailureList(record.failures),
  };
}

export function mergeRecentRequestBucketGroups(
  groups: RecentRequestBucket[][]
): RecentRequestBucket[] {
  const normalizedGroups = groups
    .map((group) => normalizeRecentRequestBuckets(group))
    .filter((group) => group.length > 0);

  if (normalizedGroups.length === 0) {
    return [];
  }

  const mergedLength = Math.min(
    RECENT_REQUEST_BLOCK_COUNT,
    Math.max(...normalizedGroups.map((group) => group.length))
  );
  const merged: RecentRequestBucket[] = Array.from({ length: mergedLength }, () => ({
    success: 0,
    failed: 0,
  }));

  normalizedGroups.forEach((group) => {
    const tail = group.slice(-mergedLength);
    const offset = mergedLength - tail.length;

    tail.forEach((bucket, index) => {
      const target = merged[offset + index];
      target.success += bucket.success;
      target.failed += bucket.failed;
      if (!target.time && bucket.time) {
        target.time = bucket.time;
      }
    });
  });

  return merged;
}

export function sumRecentRequests(buckets: RecentRequestBucket[]): {
  success: number;
  failure: number;
} {
  return normalizeRecentRequestBuckets(buckets).reduce(
    (total, bucket) => ({
      success: total.success + bucket.success,
      failure: total.failure + bucket.failed,
    }),
    { success: 0, failure: 0 }
  );
}

export function statusBarDataFromRecentRequests(buckets: RecentRequestBucket[]): StatusBarData {
  const normalizedBuckets = normalizeRecentRequestBuckets(buckets);
  const emptyBucketCount = Math.max(0, RECENT_REQUEST_BLOCK_COUNT - normalizedBuckets.length);
  const blockStats = [
    ...Array.from({ length: emptyBucketCount }, () => ({ success: 0, failed: 0 })),
    ...normalizedBuckets.slice(-RECENT_REQUEST_BLOCK_COUNT),
  ];

  const now = Date.now();
  const windowStart = now - RECENT_REQUEST_BLOCK_COUNT * RECENT_REQUEST_BLOCK_DURATION_MS;

  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBarData['blockDetails'] = [];
  let totalSuccess = 0;
  let totalFailure = 0;

  blockStats.forEach((bucket, index) => {
    const success = bucket.success;
    const failure = bucket.failed;
    const total = success + failure;

    totalSuccess += success;
    totalFailure += failure;

    if (total === 0) {
      blocks.push('idle');
    } else if (failure === 0) {
      blocks.push('success');
    } else if (success === 0) {
      blocks.push('failure');
    } else {
      blocks.push('mixed');
    }

    const blockStartTime = windowStart + index * RECENT_REQUEST_BLOCK_DURATION_MS;
    blockDetails.push({
      success,
      failure,
      rate: total > 0 ? success / total : -1,
      startTime: blockStartTime,
      endTime: blockStartTime + RECENT_REQUEST_BLOCK_DURATION_MS,
    });
  });

  const total = totalSuccess + totalFailure;

  return {
    blocks,
    blockDetails,
    successRate: total > 0 ? (totalSuccess / total) * 100 : 100,
    totalSuccess,
    totalFailure,
  };
}
