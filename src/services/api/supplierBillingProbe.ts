import { computeApiUrl } from '@/utils/connection';
import { apiClient } from './client';

const SUPPLIER_BILLING_PROBE_TIMEOUT_MS = 20 * 1000;

export type SupplierBillingProbeStatus = 'not_checked' | 'ok' | 'unsupported' | 'failed';

export type SupplierRuntimeAvailabilityState =
  | 'ready'
  | 'transient_throttled'
  | 'usage_wait'
  | 'probing'
  | 'half_open'
  | 'auth_invalid'
  | 'excluded'
  | 'disabled'
  | 'unknown';

export interface SupplierRuntimeIdentity {
  supplier_id: string;
  entry_id: string;
  auth_id: string;
  auth_index?: string;
  credential_generation: number;
  availability_revision: number;
  availability_state: SupplierRuntimeAvailabilityState;
  availability_deadline?: string;
  availability_reason?: string;
  provider_code?: string;
}

export interface SupplierUsageProbeEntry {
  status: SupplierBillingProbeStatus;
  is_valid?: boolean;
  remaining?: number;
  unit?: string;
  stale: boolean;
  received_at?: string;
  fresh_until?: string;
  last_attempt_at?: string;
  next_probe_at?: string;
  reset_at?: string;
  failure_count?: number;
  http_status?: number;
  last_error?: string;
}

export interface SupplierBillingMultiplier {
  schema_version: number;
  billing_scope: string;
  group_rate_multiplier: number;
  group_rate_multiplier_text: string;
  user_rate_multiplier?: number;
  user_rate_multiplier_text?: string;
  resolved_rate_multiplier: number;
  resolved_rate_multiplier_text: string;
  peak_rate_enabled: boolean;
  peak_start?: string;
  peak_end?: string;
  peak_rate_multiplier?: number;
  peak_rate_multiplier_text?: string;
  applied_peak_multiplier?: number;
  applied_peak_multiplier_text?: string;
  timezone?: string;
  effective_rate_multiplier: number;
  effective_rate_multiplier_text: string;
  observed_at: string;
}

export interface SupplierBillingProbeEntry {
  target_id: string;
  supplier_id: string;
  entry_id: string;
  provider_brand: string;
  provider_name: string;
  provider_index: number;
  api_key_index: number;
  alias?: string;
  eligible: boolean;
  queued: boolean;
  probing: boolean;
  stale: boolean;
  status: SupplierBillingProbeStatus;
  multiplier?: SupplierBillingMultiplier;
  received_at?: string;
  fresh_until?: string;
  last_attempt_at?: string;
  next_probe_at?: string;
  failure_count?: number;
  http_status?: number;
  last_error?: string;
  usage?: SupplierUsageProbeEntry;
  runtime?: SupplierRuntimeIdentity;
}

export interface SupplierBillingProbeResponse {
  provider_name: string;
  snapshot_id: string;
  revision: number;
  server_time: string;
  entries: SupplierBillingProbeEntry[];
}

export interface SupplierBillingProbeEvent {
  snapshot_id: string;
  revision: number;
  server_time: string;
  target_ids: string[];
  capabilities: string[];
  resync: boolean;
}

type SupplierBillingProbeRequest = {
  apiBase: string;
  managementKey: string;
  signal: AbortSignal;
};

export type SupplierBillingProbeSnapshotResult = {
  snapshot: SupplierBillingProbeResponse | null;
  etag: string;
  notModified: boolean;
};

export type SupplierBillingProbeEnqueueResult = {
  entry: SupplierBillingProbeEntry;
  snapshotId: string;
  revision: number;
};

export type SupplierAvailabilityReprobeStatus = 'queued' | 'already_probing' | 'skipped';

export interface SupplierAvailabilityReprobeEntry {
  supplier_id: string;
  entry_id: string;
  status: SupplierAvailabilityReprobeStatus;
  reason?: string;
  runtime?: SupplierRuntimeIdentity;
}

export interface SupplierAvailabilityReprobeResponse {
  status: string;
  supplier_id: string;
  requested: number;
  eligible: number;
  queued: number;
  already_probing: number;
  skipped: Record<string, number>;
  maximum_parallel: number;
  entries: SupplierAvailabilityReprobeEntry[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeString = (value: unknown): string => String(value ?? '').trim();

const normalizeOptionalString = (value: unknown): string | undefined => {
  const normalized = normalizeString(value);
  return normalized || undefined;
};

const normalizeNumber = (value: unknown, fallback = 0): number => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const normalizeOptionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const normalizeNonNegativeInteger = (value: unknown): number => {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0;
};

const normalizeStatus = (value: unknown): SupplierBillingProbeStatus => {
  switch (value) {
    case 'ok':
    case 'unsupported':
    case 'failed':
      return value;
    default:
      return 'not_checked';
  }
};

const normalizeAvailabilityState = (value: unknown): SupplierRuntimeAvailabilityState => {
  switch (value) {
    case 'ready':
    case 'transient_throttled':
    case 'usage_wait':
    case 'probing':
    case 'half_open':
    case 'auth_invalid':
    case 'excluded':
    case 'disabled':
      return value;
    default:
      return 'unknown';
  }
};

export const normalizeSupplierRuntimeIdentity = (
  value: unknown
): SupplierRuntimeIdentity | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const supplierId = normalizeString(record.supplier_id ?? record.supplierId);
  const entryId = normalizeString(record.entry_id ?? record.entryId);
  const authId = normalizeString(record.auth_id ?? record.authId);
  if (!supplierId || !entryId || !authId) return undefined;
  return {
    supplier_id: supplierId,
    entry_id: entryId,
    auth_id: authId,
    ...(normalizeOptionalString(record.auth_index ?? record.authIndex)
      ? { auth_index: normalizeString(record.auth_index ?? record.authIndex) }
      : {}),
    credential_generation: normalizeNonNegativeInteger(
      record.credential_generation ?? record.credentialGeneration
    ),
    availability_revision: normalizeNonNegativeInteger(
      record.availability_revision ?? record.availabilityRevision
    ),
    availability_state: normalizeAvailabilityState(
      record.availability_state ?? record.availabilityState
    ),
    ...(normalizeOptionalString(record.availability_deadline ?? record.availabilityDeadline)
      ? {
          availability_deadline: normalizeString(
            record.availability_deadline ?? record.availabilityDeadline
          ),
        }
      : {}),
    ...(normalizeOptionalString(record.availability_reason ?? record.availabilityReason)
      ? {
          availability_reason: normalizeString(
            record.availability_reason ?? record.availabilityReason
          ),
        }
      : {}),
    ...(normalizeOptionalString(record.provider_code ?? record.providerCode)
      ? { provider_code: normalizeString(record.provider_code ?? record.providerCode) }
      : {}),
  };
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => normalizeString(entry)).filter(Boolean) : [];

export const normalizeSupplierUsageProbeEntry = (
  value: unknown
): SupplierUsageProbeEntry | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const isValid =
    typeof record.is_valid === 'boolean'
      ? record.is_valid
      : typeof record.isValid === 'boolean'
        ? record.isValid
        : undefined;
  return {
    status: normalizeStatus(record.status),
    ...(isValid === undefined ? {} : { is_valid: isValid }),
    ...(normalizeOptionalNumber(record.remaining) === undefined
      ? {}
      : { remaining: normalizeOptionalNumber(record.remaining) }),
    ...(normalizeOptionalString(record.unit) ? { unit: normalizeString(record.unit) } : {}),
    stale: record.stale === true,
    ...(normalizeOptionalString(record.received_at ?? record.receivedAt)
      ? { received_at: normalizeString(record.received_at ?? record.receivedAt) }
      : {}),
    ...(normalizeOptionalString(record.fresh_until ?? record.freshUntil)
      ? { fresh_until: normalizeString(record.fresh_until ?? record.freshUntil) }
      : {}),
    ...(normalizeOptionalString(record.last_attempt_at ?? record.lastAttemptAt)
      ? { last_attempt_at: normalizeString(record.last_attempt_at ?? record.lastAttemptAt) }
      : {}),
    ...(normalizeOptionalString(record.next_probe_at ?? record.nextProbeAt)
      ? { next_probe_at: normalizeString(record.next_probe_at ?? record.nextProbeAt) }
      : {}),
    ...(normalizeOptionalString(record.reset_at ?? record.resetAt)
      ? { reset_at: normalizeString(record.reset_at ?? record.resetAt) }
      : {}),
    ...(normalizeOptionalNumber(record.failure_count ?? record.failureCount) === undefined
      ? {}
      : { failure_count: normalizeNumber(record.failure_count ?? record.failureCount) }),
    ...(normalizeOptionalNumber(record.http_status ?? record.httpStatus) === undefined
      ? {}
      : { http_status: normalizeNumber(record.http_status ?? record.httpStatus) }),
    ...(normalizeOptionalString(record.last_error ?? record.lastError)
      ? { last_error: normalizeString(record.last_error ?? record.lastError) }
      : {}),
  };
};

export const normalizeSupplierBillingMultiplier = (
  value: unknown
): SupplierBillingMultiplier | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const effectiveText = normalizeString(
    record.effective_rate_multiplier_text ?? record.effectiveRateMultiplierText
  );
  if (!effectiveText) return undefined;
  const optionalNumber = (snakeName: string, camelName: string) =>
    normalizeOptionalNumber(record[snakeName] ?? record[camelName]);
  const optionalString = (snakeName: string, camelName: string) =>
    normalizeOptionalString(record[snakeName] ?? record[camelName]);
  return {
    schema_version: normalizeNonNegativeInteger(record.schema_version ?? record.schemaVersion),
    billing_scope: normalizeString(record.billing_scope ?? record.billingScope),
    group_rate_multiplier: normalizeNumber(
      record.group_rate_multiplier ?? record.groupRateMultiplier
    ),
    group_rate_multiplier_text: normalizeString(
      record.group_rate_multiplier_text ?? record.groupRateMultiplierText
    ),
    ...(optionalNumber('user_rate_multiplier', 'userRateMultiplier') === undefined
      ? {}
      : { user_rate_multiplier: optionalNumber('user_rate_multiplier', 'userRateMultiplier') }),
    ...(optionalString('user_rate_multiplier_text', 'userRateMultiplierText')
      ? {
          user_rate_multiplier_text: normalizeString(
            record.user_rate_multiplier_text ?? record.userRateMultiplierText
          ),
        }
      : {}),
    resolved_rate_multiplier: normalizeNumber(
      record.resolved_rate_multiplier ?? record.resolvedRateMultiplier
    ),
    resolved_rate_multiplier_text: normalizeString(
      record.resolved_rate_multiplier_text ?? record.resolvedRateMultiplierText
    ),
    peak_rate_enabled: record.peak_rate_enabled === true || record.peakRateEnabled === true,
    ...(optionalString('peak_start', 'peakStart')
      ? { peak_start: normalizeString(record.peak_start ?? record.peakStart) }
      : {}),
    ...(optionalString('peak_end', 'peakEnd')
      ? { peak_end: normalizeString(record.peak_end ?? record.peakEnd) }
      : {}),
    ...(optionalNumber('peak_rate_multiplier', 'peakRateMultiplier') === undefined
      ? {}
      : { peak_rate_multiplier: optionalNumber('peak_rate_multiplier', 'peakRateMultiplier') }),
    ...(optionalString('peak_rate_multiplier_text', 'peakRateMultiplierText')
      ? {
          peak_rate_multiplier_text: normalizeString(
            record.peak_rate_multiplier_text ?? record.peakRateMultiplierText
          ),
        }
      : {}),
    ...(optionalNumber('applied_peak_multiplier', 'appliedPeakMultiplier') === undefined
      ? {}
      : {
          applied_peak_multiplier: optionalNumber(
            'applied_peak_multiplier',
            'appliedPeakMultiplier'
          ),
        }),
    ...(optionalString('applied_peak_multiplier_text', 'appliedPeakMultiplierText')
      ? {
          applied_peak_multiplier_text: normalizeString(
            record.applied_peak_multiplier_text ?? record.appliedPeakMultiplierText
          ),
        }
      : {}),
    ...(optionalString('timezone', 'timezone')
      ? { timezone: normalizeString(record.timezone) }
      : {}),
    effective_rate_multiplier: normalizeNumber(
      record.effective_rate_multiplier ?? record.effectiveRateMultiplier
    ),
    effective_rate_multiplier_text: effectiveText,
    observed_at: normalizeString(record.observed_at ?? record.observedAt),
  };
};

export const normalizeSupplierBillingProbeEntry = (
  value: unknown
): SupplierBillingProbeEntry | null => {
  const record = asRecord(value);
  if (!record) return null;
  const targetId = normalizeString(record.target_id ?? record.targetId);
  if (!targetId) return null;
  const multiplier = normalizeSupplierBillingMultiplier(record.multiplier);
  const usage = normalizeSupplierUsageProbeEntry(record.usage);
  const runtime = normalizeSupplierRuntimeIdentity(record.runtime);
  return {
    target_id: targetId,
    supplier_id: normalizeString(record.supplier_id ?? record.supplierId),
    entry_id: normalizeString(record.entry_id ?? record.entryId),
    provider_brand: normalizeString(record.provider_brand ?? record.providerBrand),
    provider_name: normalizeString(record.provider_name ?? record.providerName),
    provider_index: normalizeNonNegativeInteger(record.provider_index ?? record.providerIndex),
    api_key_index: normalizeNonNegativeInteger(record.api_key_index ?? record.apiKeyIndex),
    ...(normalizeOptionalString(record.alias) ? { alias: normalizeString(record.alias) } : {}),
    eligible: record.eligible === true,
    queued: record.queued === true,
    probing: record.probing === true,
    stale: record.stale === true,
    status: normalizeStatus(record.status),
    ...(multiplier ? { multiplier } : {}),
    ...(normalizeOptionalString(record.received_at ?? record.receivedAt)
      ? { received_at: normalizeString(record.received_at ?? record.receivedAt) }
      : {}),
    ...(normalizeOptionalString(record.fresh_until ?? record.freshUntil)
      ? { fresh_until: normalizeString(record.fresh_until ?? record.freshUntil) }
      : {}),
    ...(normalizeOptionalString(record.last_attempt_at ?? record.lastAttemptAt)
      ? { last_attempt_at: normalizeString(record.last_attempt_at ?? record.lastAttemptAt) }
      : {}),
    ...(normalizeOptionalString(record.next_probe_at ?? record.nextProbeAt)
      ? { next_probe_at: normalizeString(record.next_probe_at ?? record.nextProbeAt) }
      : {}),
    ...(normalizeOptionalNumber(record.failure_count ?? record.failureCount) === undefined
      ? {}
      : { failure_count: normalizeNumber(record.failure_count ?? record.failureCount) }),
    ...(normalizeOptionalNumber(record.http_status ?? record.httpStatus) === undefined
      ? {}
      : { http_status: normalizeNumber(record.http_status ?? record.httpStatus) }),
    ...(normalizeOptionalString(record.last_error ?? record.lastError)
      ? { last_error: normalizeString(record.last_error ?? record.lastError) }
      : {}),
    ...(usage ? { usage } : {}),
    ...(runtime ? { runtime } : {}),
  };
};

const normalizeSupplierAvailabilityReprobeStatus = (
  value: unknown
): SupplierAvailabilityReprobeStatus => {
  if (value === 'queued' || value === 'already_probing') return value;
  return 'skipped';
};

export const normalizeSupplierAvailabilityReprobeResponse = (
  value: unknown
): SupplierAvailabilityReprobeResponse => {
  const record = asRecord(value) ?? {};
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap((value) => {
        const entry = asRecord(value);
        if (!entry) return [];
        const supplierId = normalizeString(entry.supplier_id ?? entry.supplierId);
        const entryId = normalizeString(entry.entry_id ?? entry.entryId);
        if (!supplierId || !entryId) return [];
        const runtime = normalizeSupplierRuntimeIdentity(entry.runtime);
        return [
          {
            supplier_id: supplierId,
            entry_id: entryId,
            status: normalizeSupplierAvailabilityReprobeStatus(entry.status),
            ...(normalizeOptionalString(entry.reason)
              ? { reason: normalizeString(entry.reason) }
              : {}),
            ...(runtime ? { runtime } : {}),
          } satisfies SupplierAvailabilityReprobeEntry,
        ];
      })
    : [];
  const skippedRecord = asRecord(record.skipped) ?? {};
  const skipped = Object.fromEntries(
    Object.entries(skippedRecord)
      .map(([reason, count]) => [reason.trim(), normalizeNonNegativeInteger(count)] as const)
      .filter(([reason, count]) => Boolean(reason) && count > 0)
  );
  return {
    status: normalizeString(record.status),
    supplier_id: normalizeString(record.supplier_id ?? record.supplierId),
    requested: normalizeNonNegativeInteger(record.requested),
    eligible: normalizeNonNegativeInteger(record.eligible),
    queued: normalizeNonNegativeInteger(record.queued),
    already_probing: normalizeNonNegativeInteger(record.already_probing ?? record.alreadyProbing),
    skipped,
    maximum_parallel: normalizeNonNegativeInteger(
      record.maximum_parallel ?? record.maximumParallel
    ),
    entries,
  };
};

export const normalizeSupplierBillingProbeResponse = (
  value: unknown
): SupplierBillingProbeResponse => {
  const record = asRecord(value) ?? {};
  const entries = Array.isArray(record.entries)
    ? record.entries
        .map((entry) => normalizeSupplierBillingProbeEntry(entry))
        .filter((entry): entry is SupplierBillingProbeEntry => entry !== null)
    : [];
  return {
    provider_name: normalizeString(record.provider_name ?? record.providerName),
    snapshot_id: normalizeString(record.snapshot_id ?? record.snapshotId),
    revision: normalizeNonNegativeInteger(record.revision),
    server_time: normalizeString(record.server_time ?? record.serverTime),
    entries,
  };
};

export const normalizeSupplierBillingProbeEvent = (
  value: unknown
): SupplierBillingProbeEvent | null => {
  const record = asRecord(value);
  if (!record) return null;
  const snapshotId = normalizeString(record.snapshot_id ?? record.snapshotId);
  const revision = normalizeNonNegativeInteger(record.revision);
  if (!snapshotId && revision === 0) return null;
  return {
    snapshot_id: snapshotId,
    revision,
    server_time: normalizeString(record.server_time ?? record.serverTime),
    target_ids: normalizeStringArray(record.target_ids ?? record.targetIds),
    capabilities: normalizeStringArray(record.capabilities),
    resync: record.resync === true,
  };
};

const dispatchUnauthorized = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('unauthorized'));
};

const authorizedHeaders = (managementKey: string, accept: string): Headers => {
  const headers = new Headers({ Accept: accept, Authorization: `Bearer ${managementKey}` });
  return headers;
};

const ensureAuthorizedResponse = (response: Response, operation: string): Response => {
  if (response.status === httpStatusUnauthorized) {
    dispatchUnauthorized();
    throw new Error(`${operation} authorization failed`);
  }
  if (!response.ok) throw new Error(`${operation} failed: ${response.status}`);
  return response;
};

const httpStatusUnauthorized = 401;

export const supplierBillingProbeApi = {
  async list(resourceKeys?: readonly string[]): Promise<SupplierBillingProbeResponse> {
    const normalizedResourceKeys = Array.from(
      new Set((resourceKeys ?? []).map((value) => value.trim()).filter(Boolean))
    ).sort();
    const response = await apiClient.get<unknown>('/supplier-billing-probes', {
      ...(normalizedResourceKeys.length > 0
        ? { params: { resource_keys: normalizedResourceKeys.join(',') } }
        : {}),
      timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS,
    });
    return normalizeSupplierBillingProbeResponse(response);
  },

  async probe(targetId: string): Promise<SupplierBillingProbeEntry> {
    const response = await apiClient.post<unknown>(
      '/supplier-billing-probes',
      { target_id: targetId },
      { timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS }
    );
    const entry = normalizeSupplierBillingProbeEntry(response);
    if (!entry) throw new Error('Supplier billing probe returned an invalid target');
    return entry;
  },

  async recoverSupplier(
    supplierId: string,
    signal?: AbortSignal
  ): Promise<SupplierAvailabilityReprobeResponse> {
    const response = await apiClient.post<unknown>(
      '/supplier-billing-probes/availability/reprobe',
      { supplier_id: supplierId.trim() },
      { timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS, ...(signal ? { signal } : {}) }
    );
    return normalizeSupplierAvailabilityReprobeResponse(response);
  },

  async snapshot({
    apiBase,
    managementKey,
    signal,
    etag = '',
  }: SupplierBillingProbeRequest & { etag?: string }): Promise<SupplierBillingProbeSnapshotResult> {
    const headers = authorizedHeaders(managementKey, 'application/json');
    if (etag) headers.set('If-None-Match', etag);
    const response = await fetch(`${computeApiUrl(apiBase)}/supplier-billing-probes`, {
      headers,
      cache: 'no-store',
      signal,
    });
    if (response.status === httpStatusUnauthorized) {
      dispatchUnauthorized();
      throw new Error('Supplier billing snapshot authorization failed');
    }
    if (response.status === 304) {
      return {
        snapshot: null,
        etag: response.headers.get('ETag') ?? etag,
        notModified: true,
      };
    }
    ensureAuthorizedResponse(response, 'Supplier billing snapshot request');
    return {
      snapshot: normalizeSupplierBillingProbeResponse(await response.json()),
      etag: response.headers.get('ETag') ?? '',
      notModified: false,
    };
  },

  async events({
    apiBase,
    managementKey,
    signal,
    snapshotId,
    revision,
  }: SupplierBillingProbeRequest & { snapshotId: string; revision: number }): Promise<Response> {
    const params = new URLSearchParams({ since: String(revision) });
    if (snapshotId) params.set('snapshot_id', snapshotId);
    const headers = authorizedHeaders(managementKey, 'text/event-stream');
    if (revision > 0) headers.set('Last-Event-ID', String(revision));
    const response = await fetch(
      `${computeApiUrl(apiBase)}/supplier-billing-probes/events?${params.toString()}`,
      { headers, cache: 'no-store', signal }
    );
    return ensureAuthorizedResponse(response, 'Supplier billing event stream');
  },

  async enqueue({
    apiBase,
    managementKey,
    signal,
    targetId,
  }: SupplierBillingProbeRequest & {
    targetId: string;
  }): Promise<SupplierBillingProbeEnqueueResult> {
    const headers = authorizedHeaders(managementKey, 'application/json');
    headers.set('Content-Type', 'application/json');
    const response = await fetch(`${computeApiUrl(apiBase)}/supplier-billing-probes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ target_id: targetId }),
      cache: 'no-store',
      signal,
    });
    ensureAuthorizedResponse(response, 'Supplier billing manual refresh');
    const entry = normalizeSupplierBillingProbeEntry(await response.json());
    if (!entry) throw new Error('Supplier billing manual refresh returned an invalid target');
    return {
      entry,
      snapshotId: response.headers.get('X-Supplier-Billing-Snapshot-ID') ?? '',
      revision: normalizeNonNegativeInteger(response.headers.get('X-Supplier-Billing-Revision')),
    };
  },
};
