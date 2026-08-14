import { getAuthFileStatusMessage } from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import type {
  RuntimeAvailabilityState,
  RuntimeObservationResource,
} from '@/types/runtimeObservation';
import { parseTimestampMs } from '@/utils/timestamp';

const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);

const AUTH_FAILURE_PATTERN =
  /\b(?:auth(?:entication|orization)?(?:[_ -]?(?:error|failed|failure|invalid))?|invalid[_ -]?(?:access[_ -]?token|api[_ -]?key|token|credential)|unauthori[sz]ed|forbidden|token[_ -]?(?:expired|invalid|revoked)|account[_ -]?(?:deleted|disabled|deactivated)|workspace[_ -]?(?:deleted|disabled|deactivated))\b/i;

const USAGE_LIMIT_PATTERN =
  /\b(?:insufficient[_ -]?quota|rate[_ -]?limit(?:ed|[_ -](?:reached|exceeded))|(?:usage|billing|spending)[_ -]?limit(?:ed|[_ -](?:reached|exceeded))|quota(?:[_ -]?limit)?[_ -]?(?:reached|exceeded|depleted|exhausted|limited)|balance[_ -]?(?:depleted|exhausted|insufficient))\b/i;

const PERSISTENT_RUNTIME_STATES = new Set<RuntimeAvailabilityState>([
  'transient_throttled',
  'usage_wait',
  'auth_invalid',
  'excluded',
]);

const RECOVERED_RUNTIME_STATES = new Set<RuntimeAvailabilityState>(['ready', 'half_open']);

export type AuthFileStatusWarning = {
  message: string;
  hasProblem: boolean;
  hasRawWarning: boolean;
};

const normalizeTimestampMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    }
  }
  return parseTimestampMs(value);
};

const latestTimestampMs = (values: unknown[]): number => {
  let latest = Number.NaN;
  values.forEach((value) => {
    const timestamp = normalizeTimestampMs(value);
    if (!Number.isFinite(timestamp)) return;
    latest = Number.isFinite(latest) ? Math.max(latest, timestamp) : timestamp;
  });
  return latest;
};

const getAuthFileStatusObservedAtMs = (file: AuthFileItem): number =>
  latestTimestampMs([
    file['updatedAtMs'],
    file['updated_at_ms'],
    file['updatedAt'],
    file['updated_at'],
    file['modtime'],
    file.modified,
    file.lastRefresh,
    file['last_refresh'],
  ]);

const normalizeStatusCode = (file: AuthFileItem, message: string): number | null => {
  const raw = file['errorStatus'] ?? file['error_status'] ?? file['statusCode'] ?? file['status_code'];
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  const match = message.match(/\b([1-5][0-9]{2})\b/);
  return match ? Number(match[1]) : null;
};

const isSupersededByRuntimeRecovery = (
  file: AuthFileItem,
  runtimeResource: RuntimeObservationResource | undefined
): boolean => {
  if (!runtimeResource || !RECOVERED_RUNTIME_STATES.has(runtimeResource.availabilityState)) {
    return false;
  }
  const statusObservedAt = getAuthFileStatusObservedAtMs(file);
  const recoveryObservedAt = normalizeTimestampMs(runtimeResource.availabilityUpdatedAt);
  return (
    Number.isFinite(statusObservedAt) &&
    Number.isFinite(recoveryObservedAt) &&
    recoveryObservedAt > statusObservedAt
  );
};

const hasRawStatusWarning = (
  file: AuthFileItem,
  runtimeResource: RuntimeObservationResource | undefined,
  message: string
): boolean => {
  if (!message || HEALTHY_STATUS_MESSAGES.has(message.toLowerCase())) return false;
  if (isSupersededByRuntimeRecovery(file, runtimeResource)) return false;

  const statusCode = normalizeStatusCode(file, message);
  if (statusCode === 499) return false;
  if (
    statusCode === 401 ||
    statusCode === 402 ||
    statusCode === 429 ||
    AUTH_FAILURE_PATTERN.test(message) ||
    USAGE_LIMIT_PATTERN.test(message)
  ) {
    return true;
  }
  if (statusCode !== null && statusCode >= 200 && statusCode < 600) return false;

  // Preserve unknown diagnostics until a typed runtime recovery supersedes them.
  return true;
};

export const resolveAuthFileStatusWarning = (
  file: AuthFileItem,
  runtimeResource?: RuntimeObservationResource
): AuthFileStatusWarning => {
  const message = getAuthFileStatusMessage(file);
  const hasRawWarning = hasRawStatusWarning(file, runtimeResource, message);
  const hasRuntimeProblem = runtimeResource
    ? PERSISTENT_RUNTIME_STATES.has(runtimeResource.availabilityState)
    : false;
  return {
    message,
    hasRawWarning,
    hasProblem: hasRawWarning || hasRuntimeProblem,
  };
};

export const hasAuthFileStatusProblem = (
  file: AuthFileItem,
  runtimeResource?: RuntimeObservationResource
): boolean => resolveAuthFileStatusWarning(file, runtimeResource).hasProblem;
