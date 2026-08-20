import type {
  RuntimeObservationEvent,
  RuntimeObservationAdmissionScope,
  RuntimeObservationAvailabilityScope,
  RuntimeObservationConsecutive429,
  RuntimeAvailabilityCounts,
  RuntimeAvailabilityState,
  RuntimeObservationResource,
  RuntimeObservationScope,
  RuntimeObservationSnapshot,
} from '@/types/runtimeObservation';
import { computeApiUrl } from '@/utils/connection';
import { normalizeRecentRequestBuckets, normalizeUsageTotal } from '@/utils/recentRequests';
import { isValidConsecutive429Threshold } from '@/utils/consecutive429Threshold';

type RuntimeObservationRequest = {
  apiBase: string;
  managementKey: string;
  signal: AbortSignal;
  etag?: string;
};

type RuntimeObservationSnapshotResult = {
  snapshot: RuntimeObservationSnapshot | null;
  etag: string;
  notModified: boolean;
};

const normalizeNonNegativeInteger = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
};

const normalizeScope = (value: unknown): RuntimeObservationScope | null => {
  if (value === 'provider' || value === 'supplier' || value === 'credential') return value;
  return null;
};

const normalizeAdmissionScope = (value: unknown): RuntimeObservationAdmissionScope => {
  if (value === 'process-local' || value === 'home-remote') return value;
  return 'unknown';
};

const normalizeAvailabilityScope = (value: unknown): RuntimeObservationAvailabilityScope => {
  if (value === 'process-local' || value === 'home-remote' || value === 'unavailable') {
    return value;
  }
  return 'unknown';
};

const normalizeAvailabilityState = (value: unknown): RuntimeAvailabilityState => {
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

const normalizeAvailabilityCounts = (value: unknown): RuntimeAvailabilityCounts => {
  const counts =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    ready: normalizeNonNegativeInteger(counts.ready),
    transientThrottled: normalizeNonNegativeInteger(
      counts.transient_throttled ?? counts.transientThrottled
    ),
    usageWait: normalizeNonNegativeInteger(counts.usage_wait ?? counts.usageWait),
    probing: normalizeNonNegativeInteger(counts.probing),
    halfOpen: normalizeNonNegativeInteger(counts.half_open ?? counts.halfOpen),
    authInvalid: normalizeNonNegativeInteger(counts.auth_invalid ?? counts.authInvalid),
    excluded: normalizeNonNegativeInteger(counts.excluded),
    disabled: normalizeNonNegativeInteger(counts.disabled),
  };
};

const normalizeConsecutive429 = (value: unknown): RuntimeObservationConsecutive429 | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const threshold = Number(record.threshold);
  if (!isValidConsecutive429Threshold(threshold)) return null;
  const scope =
    record.scope === 'model' ? 'model' : record.scope === 'credential' ? 'credential' : null;
  if (!scope) return null;
  const model = String(record.model ?? '').trim();
  if (scope === 'model' && !model) return null;
  return {
    count: normalizeNonNegativeInteger(record.count),
    threshold,
    scope,
    model: scope === 'model' ? model : '',
    throttled: record.throttled === true,
  };
};

export const normalizeRuntimeObservationResource = (
  value: unknown
): RuntimeObservationResource | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id ?? '').trim();
  const scope = normalizeScope(record.scope);
  if (!id || !scope) return null;
  return {
    id,
    authIndex: String(record.auth_index ?? record.authIndex ?? '').trim(),
    scope,
    parentId: String(record.parent_id ?? record.parentId ?? '').trim(),
    provider: String(record.provider ?? '').trim(),
    supplierId: String(record.supplier_id ?? record.supplierId ?? '').trim(),
    name: String(record.name ?? '').trim(),
    inFlight: normalizeNonNegativeInteger(record.in_flight ?? record.inFlight),
    maximum: normalizeNonNegativeInteger(record.maximum),
    queued: normalizeNonNegativeInteger(record.queued),
    success: normalizeUsageTotal(record.success),
    failed: normalizeUsageTotal(record.failed),
    recentRequests: normalizeRecentRequestBuckets(record.recent_requests ?? record.recentRequests),
    availabilityState: normalizeAvailabilityState(
      record.availability_state ?? record.availabilityState
    ),
    availabilityModel: String(record.availability_model ?? record.availabilityModel ?? '').trim(),
    availabilityDeadline: String(
      record.availability_deadline ?? record.availabilityDeadline ?? ''
    ).trim(),
    availabilityUpdatedAt: String(
      record.availability_updated_at ?? record.availabilityUpdatedAt ?? ''
    ).trim(),
    availabilityCounts: normalizeAvailabilityCounts(
      record.availability_counts ?? record.availabilityCounts
    ),
    healthFailureStreak: normalizeNonNegativeInteger(
      record.health_failure_streak ?? record.healthFailureStreak
    ),
    healthExcluded: record.health_excluded === true || record.healthExcluded === true,
    healthExclusionCode: String(
      record.health_exclusion_code ?? record.healthExclusionCode ?? ''
    ).trim(),
    healthExcludedAt: String(record.health_excluded_at ?? record.healthExcludedAt ?? '').trim(),
    consecutive429:
      scope === 'credential'
        ? normalizeConsecutive429(record.consecutive_429 ?? record.consecutive429)
        : null,
  };
};

export const normalizeRuntimeObservationSnapshot = (value: unknown): RuntimeObservationSnapshot => {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const resources = Array.isArray(record.resources)
    ? record.resources
        .map((resource) => normalizeRuntimeObservationResource(resource))
        .filter((resource): resource is RuntimeObservationResource => resource !== null)
    : [];
  const queue =
    record.queue && typeof record.queue === 'object' && !Array.isArray(record.queue)
      ? (record.queue as Record<string, unknown>)
      : {};
  return {
    observationId: String(record.observation_id ?? record.observationId ?? '').trim(),
    revision: normalizeNonNegativeInteger(record.revision),
    observedAt: String(record.observed_at ?? record.observedAt ?? '').trim(),
    admissionScope: normalizeAdmissionScope(record.admission_scope ?? record.admissionScope),
    availabilityScope: normalizeAvailabilityScope(
      record.availability_scope ?? record.availabilityScope
    ),
    resources,
    queue: {
      waiting: normalizeNonNegativeInteger(queue.waiting),
      maximum: normalizeNonNegativeInteger(queue.maximum),
      closed: queue.closed === true,
    },
    totalProviders: normalizeNonNegativeInteger(record.total_providers ?? record.totalProviders),
    totalSuppliers: normalizeNonNegativeInteger(record.total_suppliers ?? record.totalSuppliers),
    totalCredentials: normalizeNonNegativeInteger(
      record.total_credentials ?? record.totalCredentials
    ),
    truncated: record.truncated === true,
  };
};

export const normalizeRuntimeObservationEvent = (
  value: unknown
): RuntimeObservationEvent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const observationId = String(record.observation_id ?? record.observationId ?? '').trim();
  const revision = normalizeNonNegativeInteger(record.revision);
  if (!observationId) return null;
  return {
    observationId,
    revision,
    observedAt: String(record.observed_at ?? record.observedAt ?? '').trim(),
  };
};

const dispatchUnauthorized = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('unauthorized'));
};

const requestHeaders = (managementKey: string): HeadersInit => ({
  Accept: 'application/json',
  Authorization: `Bearer ${managementKey}`,
});

export const runtimeObservationsApi = {
  async snapshot({
    apiBase,
    managementKey,
    signal,
    etag = '',
  }: RuntimeObservationRequest): Promise<RuntimeObservationSnapshotResult> {
    const headers = new Headers(requestHeaders(managementKey));
    if (etag) headers.set('If-None-Match', etag);
    const response = await fetch(`${computeApiUrl(apiBase)}/runtime-observations`, {
      headers,
      cache: 'no-store',
      signal,
    });
    if (response.status === 401) {
      dispatchUnauthorized();
      throw new Error('Runtime observation authorization failed');
    }
    if (response.status === 304) {
      return { snapshot: null, etag: response.headers.get('ETag') ?? etag, notModified: true };
    }
    if (!response.ok) {
      throw new Error(`Runtime observation request failed: ${response.status}`);
    }
    return {
      snapshot: normalizeRuntimeObservationSnapshot(await response.json()),
      etag: response.headers.get('ETag') ?? '',
      notModified: false,
    };
  },

  async events({
    apiBase,
    managementKey,
    signal,
    observationId,
    revision,
  }: RuntimeObservationRequest & { observationId: string; revision: number }): Promise<Response> {
    const params = new URLSearchParams({ since: String(revision) });
    if (observationId) params.set('observation_id', observationId);
    const response = await fetch(
      `${computeApiUrl(apiBase)}/runtime-observations/events?${params.toString()}`,
      {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${managementKey}`,
        },
        cache: 'no-store',
        signal,
      }
    );
    if (response.status === 401) {
      dispatchUnauthorized();
      throw new Error('Runtime observation authorization failed');
    }
    if (!response.ok) {
      throw new Error(`Runtime observation event stream failed: ${response.status}`);
    }
    return response;
  },
};
