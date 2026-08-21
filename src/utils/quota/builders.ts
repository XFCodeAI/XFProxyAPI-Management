/**
 * Builder functions for constructing quota data structures.
 */

import type {
  AntigravityQuotaBucket,
  AntigravityQuotaGroup,
  AntigravityQuotaSummaryPayload,
  KimiUsagePayload,
  KimiUsageDetail,
  KimiLimitItem,
  KimiLimitWindow,
  KimiQuotaRow,
  XaiBillingConfig,
  XaiBillingPeriod,
  XaiBillingPeriodType,
  XaiBillingSummary,
  XaiProductUsageSummary,
} from '@/types';
import { normalizeNumberValue, normalizeQuotaFraction, normalizeStringValue } from './parsers';

const ANTIGRAVITY_BUCKET_WINDOW_ORDER = new Map<string, number>([
  ['5h', 0],
  ['five-hour', 0],
  ['five_hour', 0],
  ['weekly', 1],
  ['week', 1],
]);

function toStableId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function getAntigravityWindowOrder(bucket: AntigravityQuotaBucket): number {
  const window = bucket.window?.toLowerCase();
  if (!window) return Number.MAX_SAFE_INTEGER;
  return ANTIGRAVITY_BUCKET_WINDOW_ORDER.get(window) ?? Number.MAX_SAFE_INTEGER;
}

export function buildAntigravityQuotaGroups(
  payload: AntigravityQuotaSummaryPayload
): AntigravityQuotaGroup[] {
  const groups = Array.isArray(payload.groups) ? payload.groups : [];

  return groups
    .map((group, groupIndex): AntigravityQuotaGroup | null => {
      const label =
        normalizeStringValue(group.displayName ?? group.display_name) ??
        `Quota Group ${groupIndex + 1}`;
      const groupId = toStableId(label, `quota-group-${groupIndex + 1}`);
      const buckets = Array.isArray(group.buckets) ? group.buckets : [];
      const parsedBuckets = buckets
        .map((bucket, bucketIndex): AntigravityQuotaBucket | null => {
          const remainingFraction = normalizeQuotaFraction(
            bucket.remainingFraction ?? bucket.remaining_fraction
          );
          if (remainingFraction === null) return null;

          const window = normalizeStringValue(bucket.window) ?? undefined;
          const rawId =
            normalizeStringValue(bucket.bucketId ?? bucket.bucket_id) ??
            `${groupId}-${window ?? `bucket-${bucketIndex + 1}`}`;
          const label = normalizeStringValue(bucket.displayName ?? bucket.display_name) ?? rawId;

          return {
            id: rawId,
            label,
            window,
            remainingFraction,
            resetTime: normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined,
            description: normalizeStringValue(bucket.description) ?? undefined,
          };
        })
        .filter((bucket): bucket is AntigravityQuotaBucket => bucket !== null)
        .sort((a, b) => {
          const orderDiff = getAntigravityWindowOrder(a) - getAntigravityWindowOrder(b);
          if (orderDiff !== 0) return orderDiff;
          return a.label.localeCompare(b.label);
        });

      if (parsedBuckets.length === 0) return null;

      return {
        id: groupId,
        label,
        description: normalizeStringValue(group.description) ?? undefined,
        buckets: parsedBuckets,
      };
    })
    .filter((group): group is AntigravityQuotaGroup => group !== null);
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  return null;
}

type KimiRowLabel = Pick<KimiQuotaRow, 'label' | 'labelKey' | 'labelParams'>;

function kimiResetHint(data: Record<string, unknown>): string | undefined {
  const absoluteKeys = ['reset_at', 'resetAt', 'reset_time', 'resetTime'];
  for (const key of absoluteKeys) {
    const raw = data[key];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const truncated = raw.replace(/(\.\d{6})\d+/, '$1');
        const date = new Date(truncated);
        if (Number.isNaN(date.getTime())) continue;
        const now = Date.now();
        const delta = date.getTime() - now;
        if (delta <= 0) return undefined;
        const totalMinutes = Math.floor(delta / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h`;
        if (minutes > 0) return `${minutes}m`;
        return '<1m';
      } catch {
        continue;
      }
    }
  }

  const relativeKeys = ['reset_in', 'resetIn', 'ttl'];
  for (const key of relativeKeys) {
    const raw = toInt(data[key]);
    if (raw !== null && raw > 0) {
      const hours = Math.floor(raw / 3600);
      const minutes = Math.floor((raw % 3600) / 60);
      if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h`;
      if (minutes > 0) return `${minutes}m`;
      return '<1m';
    }
  }

  return undefined;
}

function kimiDurationToken(duration: number, rawTimeUnit: unknown): string {
  const unit = typeof rawTimeUnit === 'string' ? rawTimeUnit.trim().toUpperCase() : '';
  if (unit === 'SECONDS' || unit === 'SECOND') return `${duration}s`;
  if (!unit || unit === 'MINUTES' || unit === 'MINUTE') {
    return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
  }
  if (unit === 'HOURS' || unit === 'HOUR') return `${duration}h`;
  if (unit === 'DAYS' || unit === 'DAY') return `${duration}d`;
  return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
}

function kimiLimitLabel(
  item: KimiLimitItem,
  detail: KimiUsageDetail | KimiLimitItem,
  window: KimiLimitWindow,
  index: number
): KimiRowLabel {
  for (const key of ['name', 'title', 'scope'] as const) {
    const val = (item as Record<string, unknown>)[key] ?? (detail as Record<string, unknown>)[key];
    if (typeof val === 'string' && val.trim()) return { label: val.trim() };
  }

  const duration =
    toInt(window.duration) ??
    toInt((item as Record<string, unknown>).duration) ??
    toInt((detail as Record<string, unknown>).duration);
  const timeUnit =
    (window as Record<string, unknown>).timeUnit ??
    (item as Record<string, unknown>).timeUnit ??
    (detail as Record<string, unknown>).timeUnit;

  if (duration !== null && duration > 0) {
    return {
      labelKey: 'kimi_quota.limit_window',
      labelParams: {
        duration: kimiDurationToken(duration, timeUnit),
      },
    };
  }

  return {
    labelKey: 'kimi_quota.limit_index',
    labelParams: {
      index: index + 1,
    },
  };
}

function toKimiUsageRow(
  data: Record<string, unknown>,
  fallbackLabel: KimiRowLabel
): (KimiRowLabel & { used: number; limit: number; resetHint?: string }) | null {
  const limit = toInt(data.limit);
  let used = toInt(data.used);
  if (used === null) {
    const remaining = toInt(data.remaining);
    if (remaining !== null && limit !== null) {
      used = limit - remaining;
    }
  }
  if (used === null && limit === null) return null;
  const explicitLabel =
    (typeof data.name === 'string' && data.name.trim()) ||
    (typeof data.title === 'string' && data.title.trim());
  const label = explicitLabel ? { label: explicitLabel } : fallbackLabel;
  return {
    ...label,
    used: used ?? 0,
    limit: limit ?? 0,
    resetHint: kimiResetHint(data),
  };
}

export function buildKimiQuotaRows(payload: KimiUsagePayload): KimiQuotaRow[] {
  const rows: KimiQuotaRow[] = [];

  const limits = payload.limits;
  if (Array.isArray(limits)) {
    limits.forEach((item, idx) => {
      const detail = (item.detail && typeof item.detail === 'object' ? item.detail : item) as
        KimiUsageDetail | KimiLimitItem;
      const window = (
        item.window && typeof item.window === 'object' ? item.window : {}
      ) as KimiLimitWindow;
      const fallbackLabel = kimiLimitLabel(item, detail, window, idx);
      const row = toKimiUsageRow(detail as Record<string, unknown>, fallbackLabel);
      if (row) {
        rows.push({ id: `limit-${idx}`, ...row });
      }
    });
  }

  const usage = payload.usage;
  if (usage && typeof usage === 'object') {
    const summary = toKimiUsageRow(usage as Record<string, unknown>, {
      labelKey: 'kimi_quota.weekly_limit',
    });
    if (summary) {
      rows.push({ id: 'summary', ...summary });
    }
  }

  return rows;
}

function normalizeXaiCentValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as { val?: unknown; value?: unknown };
    if (Object.keys(record).length === 0) return null;
    return normalizeNumberValue(record.val) ?? normalizeNumberValue(record.value);
  }
  return normalizeNumberValue(value);
}

function resolveXaiCentCandidate(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeXaiCentValue(value);
    if (normalized !== null) return { value: normalized, hasEvidence: true };
  }
  return { value: null, hasEvidence: false };
}

function normalizeXaiPeriodTimestamp(value: unknown): string | undefined {
  return normalizeStringValue(value) ?? undefined;
}

function hasValidXaiPeriodWindow(start?: string, end?: string): boolean {
  if (!start || !end) return false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function resolveXaiPeriodType(period?: XaiBillingPeriod | null): XaiBillingPeriodType {
  const rawType = normalizeStringValue(period?.type)?.toLowerCase() ?? '';
  if (rawType.includes('weekly')) return 'weekly';
  if (rawType.includes('monthly')) return 'monthly';
  return 'unknown';
}

function normalizeXaiProductUsage(
  productUsage: XaiBillingConfig['productUsage'],
  fallbackPrefix: string
): XaiProductUsageSummary[] {
  if (!Array.isArray(productUsage)) return [];

  return productUsage
    .map((item, index): XaiProductUsageSummary | null => {
      if (!item || typeof item !== 'object') return null;
      const product = normalizeStringValue(item.product) ?? `${fallbackPrefix} ${index + 1}`;
      const usagePercent = normalizeNumberValue(item.usagePercent ?? item.usage_percent);
      return { product, usagePercent };
    })
    .filter((item): item is XaiProductUsageSummary => item !== null);
}

const emptyXaiBillingSummary = (): XaiBillingSummary => ({
  mode: 'billing',
  source: 'cli-chat-proxy',
  periodType: 'unknown',
  usagePercent: null,
  productUsage: [],
  monthlyLimitCents: null,
  usedCents: null,
  includedUsedCents: null,
  onDemandCapCents: null,
  onDemandUsedCents: null,
  onDemandUsedPercent: null,
  usedPercent: null,
});

type XaiBillingFieldEvidence = {
  monthlyLimit: boolean;
  used: boolean;
  includedUsed: boolean;
  onDemandCap: boolean;
  onDemandUsed: boolean;
};

const xaiBillingFieldEvidence = new WeakMap<XaiBillingSummary, XaiBillingFieldEvidence>();

const getXaiBillingFieldEvidence = (summary: XaiBillingSummary): XaiBillingFieldEvidence =>
  xaiBillingFieldEvidence.get(summary) ?? {
    monthlyLimit: summary.monthlyLimitCents !== null,
    used: summary.usedCents !== null,
    includedUsed: summary.includedUsedCents !== null,
    onDemandCap: summary.onDemandCapCents !== null,
    onDemandUsed: summary.onDemandUsedCents !== null,
  };

export function buildXaiBillingSummary(
  config: XaiBillingConfig | null | undefined
): XaiBillingSummary | null {
  if (!config || typeof config !== 'object') return null;

  const summary = emptyXaiBillingSummary();
  const currentPeriod = config.currentPeriod ?? config.current_period ?? null;
  const periodType = resolveXaiPeriodType(currentPeriod);
  const rawCreditUsagePercent = normalizeNumberValue(
    config.creditUsagePercent ?? config.credit_usage_percent
  );
  const periodStart = normalizeXaiPeriodTimestamp(currentPeriod?.start);
  const periodEnd = normalizeXaiPeriodTimestamp(currentPeriod?.end);
  const creditUsagePercent =
    rawCreditUsagePercent ??
    (periodType === 'weekly' && hasValidXaiPeriodWindow(periodStart, periodEnd) ? 0 : null);
  const billingCycle = config.billingCycle ?? config.billing_cycle ?? null;
  const nestedUsage = config.usage ?? null;
  const productUsage = normalizeXaiProductUsage(
    config.productUsage ?? config.product_usage,
    'Product'
  );

  const monthlyLimit = resolveXaiCentCandidate(config.monthlyLimit, config.monthly_limit);
  const nestedIncludedUsed = resolveXaiCentCandidate(
    nestedUsage?.includedUsed,
    nestedUsage?.included_used
  );
  const explicitOnDemandUsed = resolveXaiCentCandidate(
    config.onDemandUsed,
    config.on_demand_used,
    nestedUsage?.onDemandUsed,
    nestedUsage?.on_demand_used
  );
  const rawUsed = resolveXaiCentCandidate(
    config.used,
    nestedUsage?.totalUsed,
    nestedUsage?.total_used
  );
  const onDemandCap = resolveXaiCentCandidate(config.onDemandCap, config.on_demand_cap);
  const monthlyLimitCents = monthlyLimit.value;
  const nestedIncludedUsedCents = nestedIncludedUsed.value;
  const explicitOnDemandUsedCents = explicitOnDemandUsed.value;
  const rawUsedCents = rawUsed.value;
  const usedCents =
    rawUsedCents ??
    (nestedIncludedUsedCents !== null || explicitOnDemandUsedCents !== null
      ? (nestedIncludedUsedCents ?? 0) + (explicitOnDemandUsedCents ?? 0)
      : null);
  const onDemandCapCents = onDemandCap.value;
  const billingPeriodStart =
    normalizeStringValue(
      config.billingPeriodStart ??
        config.billing_period_start ??
        billingCycle?.billingPeriodStart ??
        billingCycle?.billing_period_start
    ) ?? undefined;
  const billingPeriodEnd =
    normalizeStringValue(
      config.billingPeriodEnd ??
        config.billing_period_end ??
        billingCycle?.billingPeriodEnd ??
        billingCycle?.billing_period_end
    ) ?? undefined;

  const hasMonthlyData =
    monthlyLimit.hasEvidence || rawUsed.hasEvidence || nestedIncludedUsed.hasEvidence;
  const includedUsedCents = hasMonthlyData
    ? (nestedIncludedUsedCents ??
      (usedCents === null
        ? null
        : monthlyLimitCents !== null && monthlyLimitCents > 0
          ? Math.min(usedCents, monthlyLimitCents)
          : usedCents))
    : null;
  const derivedOnDemandUsedCents =
    usedCents !== null && monthlyLimitCents !== null
      ? Math.max(0, usedCents - monthlyLimitCents)
      : null;
  const onDemandUsedCents = explicitOnDemandUsedCents ?? derivedOnDemandUsedCents;
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : null;
  const onDemandUsedPercent =
    onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : null;

  const hasWeeklyData =
    creditUsagePercent !== null || periodType === 'weekly' || productUsage.length > 0;
  const hasOnDemandData =
    onDemandCap.hasEvidence ||
    explicitOnDemandUsed.hasEvidence ||
    (derivedOnDemandUsedCents !== null && derivedOnDemandUsedCents > 0);
  const hasBillingPeriodData = hasMonthlyData || hasOnDemandData;

  if (!hasWeeklyData && !hasMonthlyData && !hasOnDemandData) return null;

  summary.periodType = hasWeeklyData
    ? periodType === 'unknown'
      ? 'weekly'
      : periodType
    : hasMonthlyData
      ? 'monthly'
      : 'unknown';
  summary.usagePercent = hasWeeklyData ? creditUsagePercent : usedPercent;
  summary.periodStart = hasWeeklyData ? periodStart : billingPeriodStart;
  summary.periodEnd = hasWeeklyData ? periodEnd : billingPeriodEnd;
  summary.productUsage = productUsage;
  summary.monthlyLimitCents = hasMonthlyData ? monthlyLimitCents : null;
  summary.usedCents = hasBillingPeriodData ? usedCents : null;
  summary.includedUsedCents = includedUsedCents;
  summary.onDemandCapCents = hasOnDemandData ? onDemandCapCents : null;
  summary.onDemandUsedCents = hasOnDemandData ? onDemandUsedCents : null;
  summary.onDemandUsedPercent = hasOnDemandData ? onDemandUsedPercent : null;
  summary.billingPeriodStart = hasBillingPeriodData ? billingPeriodStart : undefined;
  summary.billingPeriodEnd = hasBillingPeriodData ? billingPeriodEnd : undefined;
  summary.usedPercent = usedPercent;
  xaiBillingFieldEvidence.set(summary, {
    monthlyLimit: monthlyLimit.hasEvidence,
    used: rawUsed.hasEvidence,
    includedUsed: nestedIncludedUsed.hasEvidence,
    onDemandCap: onDemandCap.hasEvidence,
    onDemandUsed: explicitOnDemandUsed.hasEvidence,
  });

  return summary;
}

export function mergeXaiBillingSummaries(
  primary: XaiBillingSummary | null,
  fallback: XaiBillingSummary | null
): XaiBillingSummary | null {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const primaryHasWeeklyData =
    primary.periodType === 'weekly' ||
    primary.usagePercent !== null ||
    primary.productUsage.length > 0;
  const weeklySource = primaryHasWeeklyData ? primary : fallback;
  const primaryEvidence = getXaiBillingFieldEvidence(primary);
  const fallbackEvidence = getXaiBillingFieldEvidence(fallback);
  const monthlyLimitCents =
    (primaryEvidence.monthlyLimit ? primary.monthlyLimitCents : null) ??
    (fallbackEvidence.monthlyLimit ? fallback.monthlyLimitCents : null);
  const primaryRawUsed = primaryEvidence.used ? primary.usedCents : null;
  const fallbackRawUsed = fallbackEvidence.used ? fallback.usedCents : null;
  let includedUsedHasEvidence = primaryEvidence.includedUsed;
  let includedUsedCents = includedUsedHasEvidence ? primary.includedUsedCents : null;
  if (includedUsedCents === null && primaryRawUsed !== null) includedUsedCents = primaryRawUsed;
  if (includedUsedCents === null && fallbackEvidence.includedUsed) {
    includedUsedCents = fallback.includedUsedCents;
    includedUsedHasEvidence = includedUsedCents !== null;
  }
  if (includedUsedCents === null && fallbackRawUsed !== null) includedUsedCents = fallbackRawUsed;
  if (includedUsedCents !== null && monthlyLimitCents !== null && monthlyLimitCents > 0) {
    includedUsedCents = Math.min(includedUsedCents, monthlyLimitCents);
  }

  const onDemandCapCents =
    (primaryEvidence.onDemandCap ? primary.onDemandCapCents : null) ??
    (fallbackEvidence.onDemandCap ? fallback.onDemandCapCents : null);
  let onDemandUsedHasEvidence = primaryEvidence.onDemandUsed;
  let onDemandUsedCents = onDemandUsedHasEvidence ? primary.onDemandUsedCents : null;
  if (onDemandUsedCents === null && primaryRawUsed !== null && monthlyLimitCents !== null) {
    onDemandUsedCents = Math.max(0, primaryRawUsed - monthlyLimitCents);
  }
  if (onDemandUsedCents === null && fallbackEvidence.onDemandUsed) {
    onDemandUsedCents = fallback.onDemandUsedCents;
    onDemandUsedHasEvidence = onDemandUsedCents !== null;
  }
  if (onDemandUsedCents === null && fallbackRawUsed !== null && monthlyLimitCents !== null) {
    onDemandUsedCents = Math.max(0, fallbackRawUsed - monthlyLimitCents);
  }
  const hasPrimaryComponentEvidence = primaryEvidence.includedUsed || primaryEvidence.onDemandUsed;
  const usedCents =
    primaryRawUsed ??
    (hasPrimaryComponentEvidence
      ? includedUsedCents !== null && onDemandUsedCents !== null
        ? includedUsedCents + onDemandUsedCents
        : (includedUsedCents ?? onDemandUsedCents)
      : (fallbackRawUsed ??
        (includedUsedCents !== null && onDemandUsedCents !== null
          ? includedUsedCents + onDemandUsedCents
          : (includedUsedCents ?? onDemandUsedCents))));
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : (primary.usedPercent ?? fallback.usedPercent);
  const onDemandUsedPercent =
    onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : (primary.onDemandUsedPercent ?? fallback.onDemandUsedPercent);

  const merged: XaiBillingSummary = {
    mode: 'billing',
    source: 'cli-chat-proxy',
    periodType: weeklySource.periodType,
    usagePercent: weeklySource.usagePercent,
    periodStart: weeklySource.periodStart,
    periodEnd: weeklySource.periodEnd,
    productUsage: weeklySource.productUsage,
    monthlyLimitCents,
    usedCents,
    includedUsedCents,
    onDemandCapCents,
    onDemandUsedCents,
    onDemandUsedPercent,
    billingPeriodStart: primary.billingPeriodStart ?? fallback.billingPeriodStart,
    billingPeriodEnd: primary.billingPeriodEnd ?? fallback.billingPeriodEnd,
    usedPercent,
  };
  xaiBillingFieldEvidence.set(merged, {
    monthlyLimit: primaryEvidence.monthlyLimit || fallbackEvidence.monthlyLimit,
    used: primaryEvidence.used || (!hasPrimaryComponentEvidence && fallbackEvidence.used),
    includedUsed: includedUsedHasEvidence,
    onDemandCap: primaryEvidence.onDemandCap || fallbackEvidence.onDemandCap,
    onDemandUsed: onDemandUsedHasEvidence,
  });
  return merged;
}
