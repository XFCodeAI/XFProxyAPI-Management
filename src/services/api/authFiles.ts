/**
 * Credential files and OAuth excluded-model APIs.
 */

import { apiClient } from './client';
import type { AuthFileCredentialIdentity, AuthFileItem, AuthFilesResponse } from '@/types/authFile';
import type { ConcurrencySetting, OAuthModelAliasEntry, ProxySelection } from '@/types';
import { readAuthFileCredentialIdentity } from '@/features/authFiles/credentialIdentity';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { parseTimestampMs } from '@/utils/timestamp';
import { proxySelectionParams } from './proxyPools';
import {
  normalizeSessionValidationFailures,
  type AuthFileSessionValidationFailure,
} from './sessionValidationFailure';
import { normalizeOauthModelAliasEntries, serializeOauthModelAliases } from './oauthModelAlias';

export type { AuthFileSessionValidationFailure } from './sessionValidationFailure';

type StatusError = { status?: number };
export type AuthFileMutationResponse = {
  status: string;
  disabled?: boolean;
  files?: AuthFileEntry[];
  revision?: number;
  inventory_id?: string;
};
type AuthFileStatusResponse = AuthFileMutationResponse & { disabled: boolean };
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileMutationTarget = string | AuthFileCredentialIdentity | AuthFileItem;
export type AuthFilesListQuery = {
  cursor?: string;
  limit?: number;
  provider?: string;
  group?: string;
  withoutGroup?: string;
  status?: string;
  search?: string;
  name?: string;
  authIndex?: string;
};
export type AuthFileDeleteFilter = Pick<
  AuthFilesListQuery,
  'provider' | 'group' | 'withoutGroup' | 'status' | 'search'
>;
export type AuthFileFieldsPatch = {
  alias?: string;
  groups?: string[];
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  weight?: number | null;
  concurrency_mode?: ConcurrencySetting['mode'];
  max_concurrency?: number | null;
  fallback?: boolean;
  disable_cooling?: boolean;
  websockets?: boolean;
  using_api?: boolean;
  note?: string;
  expired?: string;
};
export type AuthFileBatchFailure = { name: string; error: string };
export type AuthFileDeleteItem = { name: string; status: string; error?: string };
export type AuthFileAvailabilityReprobeResult = {
  status: string;
  requested: number;
  eligible: number;
  queued: number;
  alreadyProbing: number;
  skipped: Record<string, number>;
  maximumParallel: number;
  entries: AuthFileAvailabilityReprobeEntry[];
};
export type AuthFileAvailabilityReprobeEntry = {
  credentialId: string;
  authIndex: string;
  status: 'queued' | 'already_probing' | 'skipped' | string;
  reason: string;
};
type AuthFileBatchUploadResponse = {
  status?: string;
  uploaded?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileSessionValidationResponse = {
  status?: string;
  validated?: number;
  files?: unknown;
  resolved?: unknown;
  failed?: unknown;
};
type AuthFileBatchDeleteResponse = {
  status?: string;
  deleted?: number;
  files?: unknown;
  pending?: unknown;
  conflicts?: unknown;
  failed?: unknown;
  revision?: number;
  inventory_id?: string;
};
export type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};
export type AuthFileUploadProgress = {
  totalFiles: number;
  totalChunks: number;
  currentChunk: number;
  completedChunks: number;
  processedFiles: number;
  acceptedFiles: number;
  rejectedFiles: number;
  remainingFiles: number;
  phase: 'uploading' | 'cancelling' | 'cancelled' | 'completed';
};
export type AuthFileChunkedUploadResult = AuthFileBatchUploadResult & {
  attempted: number;
  completedChunks: number;
  totalChunks: number;
  cancelled: boolean;
  remainingFiles: File[];
};
export type AuthFileChunkedUploadOptions = {
  shouldCancel?: () => boolean;
  onProgress?: (progress: AuthFileUploadProgress) => void;
};
export type AuthFileSessionValidationResolvedFile = {
  name: string;
  proxyUrl: string;
};
export type AuthFileSessionValidationResult = {
  status: string;
  validated: number;
  files: string[];
  resolved: AuthFileSessionValidationResolvedFile[];
  failed: AuthFileSessionValidationFailure[];
};
export type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  pending: AuthFileDeleteItem[];
  conflicts: AuthFileDeleteItem[];
  failed: AuthFileBatchFailure[];
  revision: number;
  inventoryId: string;
};

export type AuthFileReconciliationCounts = {
  credentials: number;
  proxyBindings: number;
  groupBindings: number;
  apiKeyBindings: number;
  runtimeRecords: number;
  cleanupEntries: number;
  cleanupConflicts: number;
};

export type AuthFileForeignSourceSelection = {
  sourceId: string;
  contentSha256: string;
};

export type AuthFileMaintenanceItem = {
  sourceId: string;
  pluginId: string;
  provider: string;
  format: string;
  ownerState: string;
  identityFingerprint: string;
  duplicateIdentity: boolean;
  contentSha256: string;
  bindings: AuthFileReconciliationCounts;
  proposedAction: string;
  result: string;
};

export type AuthFileMaintenanceResult = {
  status: string;
  action: string;
  files: number;
  duplicateIdentities: number;
  bindings: AuthFileReconciliationCounts;
  unclassified: number;
  removed: number;
  pending: number;
  failed: number;
  items: AuthFileMaintenanceItem[];
};

export type AuthFileReconciliationResult = {
  status: 'completed' | 'partial';
  inventoryId: string;
  revision: number;
  scanned: AuthFileReconciliationCounts;
  preserved: AuthFileReconciliationCounts;
  removed: AuthFileReconciliationCounts;
  repaired: AuthFileReconciliationCounts;
  pending: AuthFileReconciliationCounts;
  failed: AuthFileReconciliationCounts;
  maintenance: AuthFileMaintenanceResult;
  startedAt: string;
  completedAt: string;
};

export type CodexIdentityAuditIssue = {
  name: string;
  canonicalName: string;
  issue: string;
  workspaceFingerprint: string;
  requiresReauthorization: boolean;
  requiresReimport: boolean;
  workspaceInferenceAvailable: boolean;
};

export type CodexIdentityAuditResult = {
  status: string;
  scanned: number;
  issueCount: number;
  issues: CodexIdentityAuditIssue[];
};

export const AUTH_FILE_INVALID_JSON_OBJECT_ERROR = 'AUTH_FILE_INVALID_JSON_OBJECT';

const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeBatchFileNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return normalizeRequestedAuthFileNames(value.map((item) => String(item ?? '')));
};

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileBatchFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';

    if (!name && !error) return result;
    result.push({ name, error: error || '未知错误' });
    return result;
  }, []);
};

const normalizeBatchDeleteItems = (
  value: unknown,
  fallbackStatus: string
): AuthFileDeleteItem[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileDeleteItem[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    if (!name) return result;
    const status = String(entry.status ?? fallbackStatus).trim() || fallbackStatus;
    const error = typeof entry.error === 'string' ? entry.error.trim() : '';
    result.push(error ? { name, status, error } : { name, status });
    return result;
  }, []);
};

const normalizeBatchUploadResponse = (
  payload: AuthFileBatchUploadResponse | undefined,
  requestedNames: string[]
): AuthFileBatchUploadResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-file success path returns only {status:"ok"} (auth_files.go:680).
  // Derive count + names from the request when no failures and counts are absent.
  const inferFromRequest = payload?.uploaded === undefined && failed.length === 0;
  return {
    status: payload?.status ?? (failed.length > 0 ? 'partial' : 'ok'),
    uploaded: payload?.uploaded ?? (inferFromRequest ? requestedNames.length : 0),
    files: filesFromPayload.length ? filesFromPayload : inferFromRequest ? [...requestedNames] : [],
    failed,
  };
};

const normalizeSessionValidationResponse = (
  payload: AuthFileSessionValidationResponse | undefined
): AuthFileSessionValidationResult => {
  const failed = normalizeSessionValidationFailures(payload?.failed);
  const files = normalizeBatchFileNames(payload?.files);
  const resolved = Array.isArray(payload?.resolved)
    ? payload.resolved.reduce<AuthFileSessionValidationResolvedFile[]>((result, item) => {
        if (!item || typeof item !== 'object') return result;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? '').trim();
        if (!name) return result;
        result.push({
          name,
          proxyUrl: typeof entry.proxy_url === 'string' ? entry.proxy_url.trim() : '',
        });
        return result;
      }, [])
    : [];
  return {
    status: payload?.status ?? (failed.length > 0 ? 'partial' : 'ok'),
    validated: payload?.validated ?? files.length,
    files,
    resolved,
    failed,
  };
};

const normalizeBatchDeleteResponse = (
  payload: AuthFileBatchDeleteResponse | undefined,
  requestedNames: string[]
): AuthFileBatchDeleteResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const pending = normalizeBatchDeleteItems(payload?.pending, 'pending');
  const conflicts = normalizeBatchDeleteItems(payload?.conflicts, 'conflict');
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  const inferFromRequest =
    payload?.deleted === undefined &&
    failed.length === 0 &&
    pending.length === 0 &&
    conflicts.length === 0 &&
    requestedNames.length > 0;
  return {
    status:
      payload?.status ??
      (failed.length > 0 || pending.length > 0 || conflicts.length > 0 ? 'partial' : 'ok'),
    deleted: payload?.deleted ?? (inferFromRequest ? requestedNames.length : 0),
    files: filesFromPayload.length ? filesFromPayload : inferFromRequest ? [...requestedNames] : [],
    pending,
    conflicts,
    failed,
    revision:
      typeof payload?.revision === 'number' && Number.isSafeInteger(payload.revision)
        ? payload.revision
        : 0,
    inventoryId: typeof payload?.inventory_id === 'string' ? payload.inventory_id.trim() : '',
  };
};

const normalizeAuthFileMutationTarget = (
  target: AuthFileMutationTarget
): AuthFileCredentialIdentity => {
  const identity =
    typeof target === 'string'
      ? readAuthFileCredentialIdentity({ name: target })
      : readAuthFileCredentialIdentity(target);
  if (!identity.name) throw new Error('auth file name is required');
  return identity;
};

const buildAuthFileMutationPayload = (target: AuthFileMutationTarget) => {
  const identity = normalizeAuthFileMutationTarget(target);
  return {
    name: identity.name,
    ...(identity.credentialId ? { credential_id: identity.credentialId } : {}),
    ...(identity.authIndex ? { auth_index: String(identity.authIndex) } : {}),
  };
};

const mergeAuthFileDeleteResults = (
  results: AuthFileBatchDeleteResult[],
  failures: AuthFileBatchFailure[]
): AuthFileBatchDeleteResult => {
  const latestVersion = results.reduce(
    (latest, result) => (result.revision > latest.revision ? result : latest),
    { revision: 0, inventoryId: '' } as Pick<AuthFileBatchDeleteResult, 'revision' | 'inventoryId'>
  );
  const pending = results.flatMap((result) => result.pending);
  const conflicts = results.flatMap((result) => result.conflicts);
  const failed = [...results.flatMap((result) => result.failed), ...failures];
  const deleted = results.reduce((total, result) => total + result.deleted, 0);
  return {
    status:
      pending.length > 0 || conflicts.length > 0 || failed.length > 0
        ? deleted > 0
          ? 'partial'
          : 'error'
        : 'ok',
    deleted,
    files: normalizeRequestedAuthFileNames(results.flatMap((result) => result.files)),
    pending,
    conflicts,
    failed,
    revision: latestVersion.revision,
    inventoryId: latestVersion.inventoryId,
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const normalizeCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

export const normalizeAuthFileAvailabilityReprobeResult = (
  payload: unknown
): AuthFileAvailabilityReprobeResult => {
  const record = asRecord(payload);
  const rawSkipped = asRecord(record.skipped);
  const skipped = Object.entries(rawSkipped).reduce<Record<string, number>>(
    (result, [reason, value]) => {
      const normalizedReason = reason.trim();
      const count = normalizeCount(value);
      if (normalizedReason && count > 0) result[normalizedReason] = count;
      return result;
    },
    {}
  );
  const entries = Array.isArray(record.entries)
    ? record.entries.reduce<AuthFileAvailabilityReprobeEntry[]>((result, value) => {
        const entry = asRecord(value);
        const credentialId = String(entry.credential_id ?? entry.credentialId ?? '').trim();
        const authIndex = String(entry.auth_index ?? entry.authIndex ?? '').trim();
        const status = String(entry.status ?? '').trim();
        if (!credentialId || !authIndex || !status) return result;
        result.push({
          credentialId,
          authIndex,
          status,
          reason: String(entry.reason ?? '').trim(),
        });
        return result;
      }, [])
    : [];
  return {
    status: String(record.status ?? '').trim(),
    requested: normalizeCount(record.requested),
    eligible: normalizeCount(record.eligible),
    queued: normalizeCount(record.queued),
    alreadyProbing: normalizeCount(record.already_probing ?? record.alreadyProbing),
    skipped,
    maximumParallel: normalizeCount(record.maximum_parallel ?? record.maximumParallel),
    entries,
  };
};

const normalizeReconciliationCounts = (value: unknown): AuthFileReconciliationCounts => {
  const record = asRecord(value);
  return {
    credentials: normalizeCount(record.credentials),
    proxyBindings: normalizeCount(record.proxy_bindings),
    groupBindings: normalizeCount(record.group_bindings),
    apiKeyBindings: normalizeCount(record.api_key_bindings),
    runtimeRecords: normalizeCount(record.runtime_records),
    cleanupEntries: normalizeCount(record.cleanup_entries),
    cleanupConflicts: normalizeCount(record.cleanup_conflicts),
  };
};

const normalizeCodexIdentityAuditIssue = (value: unknown): CodexIdentityAuditIssue | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const name = String(record.name ?? '').trim();
  const issue = String(record.issue ?? '').trim();
  if (!name || !issue) return null;
  return {
    name,
    canonicalName: String(record.canonical_name ?? '').trim(),
    issue,
    workspaceFingerprint: String(record.workspace_fingerprint ?? '').trim(),
    requiresReauthorization: record.requires_reauthorization === true,
    requiresReimport: record.requires_reimport === true,
    workspaceInferenceAvailable: record.workspace_inference_available === true,
  };
};

export const normalizeCodexIdentityAuditResult = (payload: unknown): CodexIdentityAuditResult => {
  const record = asRecord(payload);
  const issues = Array.isArray(record.issues)
    ? record.issues
        .map(normalizeCodexIdentityAuditIssue)
        .filter((issue): issue is CodexIdentityAuditIssue => issue !== null)
    : [];
  return {
    status: String(record.status ?? '').trim(),
    scanned: normalizeCount(record.scanned),
    issueCount: normalizeCount(record.issue_count ?? issues.length),
    issues,
  };
};

const normalizeMaintenanceItem = (value: unknown): AuthFileMaintenanceItem | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const sourceId = String(record.source_id ?? '').trim();
  const contentSha256 = String(record.content_sha256 ?? '').trim();
  if (!sourceId || !contentSha256) return null;
  return {
    sourceId,
    pluginId: String(record.plugin_id ?? '').trim(),
    provider: String(record.provider ?? '').trim(),
    format: String(record.format ?? '').trim(),
    ownerState: String(record.owner_state ?? '').trim(),
    identityFingerprint: String(record.identity_fingerprint ?? '').trim(),
    duplicateIdentity: record.duplicate_identity === true,
    contentSha256,
    bindings: normalizeReconciliationCounts(record.bindings),
    proposedAction: String(record.proposed_action ?? '').trim(),
    result: String(record.result ?? '').trim(),
  };
};

const normalizeMaintenanceResult = (value: unknown): AuthFileMaintenanceResult => {
  const record = asRecord(value);
  const items = Array.isArray(record.items)
    ? record.items
        .map(normalizeMaintenanceItem)
        .filter((item): item is AuthFileMaintenanceItem => item !== null)
    : [];
  return {
    status: String(record.status ?? '').trim(),
    action: String(record.action ?? '').trim(),
    files: normalizeCount(record.files),
    duplicateIdentities: normalizeCount(record.duplicate_identities),
    bindings: normalizeReconciliationCounts(record.bindings),
    unclassified: normalizeCount(record.unclassified),
    removed: normalizeCount(record.removed),
    pending: normalizeCount(record.pending),
    failed: normalizeCount(record.failed),
    items,
  };
};

export const normalizeAuthFileReconciliationResult = (
  payload: unknown
): AuthFileReconciliationResult => {
  const record = asRecord(payload);
  return {
    status: record.status === 'completed' ? 'completed' : 'partial',
    inventoryId: typeof record.inventory_id === 'string' ? record.inventory_id.trim() : '',
    revision: normalizeCount(record.revision),
    scanned: normalizeReconciliationCounts(record.scanned),
    preserved: normalizeReconciliationCounts(record.preserved),
    removed: normalizeReconciliationCounts(record.removed),
    repaired: normalizeReconciliationCounts(record.repaired),
    pending: normalizeReconciliationCounts(record.pending),
    failed: normalizeReconciliationCounts(record.failed),
    maintenance: normalizeMaintenanceResult(record.maintenance),
    startedAt: typeof record.started_at === 'string' ? record.started_at : '',
    completedAt: typeof record.completed_at === 'string' ? record.completed_at : '',
  };
};

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => entry['runtime_only'] === true;

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const dedupeAuthFilesResponse = (payload: AuthFilesResponse): AuthFilesResponse => {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const id = readTextField(entry, 'id');
    const name = readTextField(entry, 'name');
    const key = id || name || JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map(mergeAuthFileEntries);
  normalizedFiles.sort((left, right) =>
    readTextField(left, 'name').localeCompare(readTextField(right, 'name'), undefined, {
      sensitivity: 'accent',
    })
  );

  return {
    ...payload,
    files: normalizedFiles,
    total:
      typeof payload.total === 'number' && Number.isFinite(payload.total)
        ? payload.total
        : normalizedFiles.length,
  };
};

const buildAuthFilesListPath = (query: AuthFilesListQuery = {}): string => {
  const params = new URLSearchParams();
  const append = (key: string, value: unknown) => {
    const normalized = String(value ?? '').trim();
    if (normalized) params.set(key, normalized);
  };
  append('cursor', query.cursor);
  if (Number.isSafeInteger(query.limit) && Number(query.limit) > 0) {
    params.set('limit', String(query.limit));
  }
  append('provider', query.provider);
  append('group', query.group);
  append('without_group', query.withoutGroup);
  append('status', query.status);
  append('search', query.search);
  append('name', query.name);
  append('auth_index', query.authIndex);
  const encoded = params.toString();
  return encoded ? `/auth-files?${encoded}` : '/auth-files';
};

const parseAuthFileJsonObject = (rawText: string): Record<string, unknown> => {
  const trimmed = rawText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  return { ...(parsed as Record<string, unknown>) };
};

const saveAuthFileText = async (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  await authFilesApi.upload(file);
};

export const isAuthFileInvalidJsonObjectError = (err: unknown): boolean =>
  err instanceof Error && err.message === AUTH_FILE_INVALID_JSON_OBJECT_ERROR;

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = normalizeOAuthProviderKey(String(provider ?? ''));
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const normalized = result[key] ?? [];
    const seen = new Set(normalized.map((item) => item.toLowerCase()));
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

const normalizeOauthModelAlias = (payload: unknown): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-model-alias'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!key) return;
    if (!Array.isArray(mappings)) return;

    const normalized = result[key] ?? [];
    const seenAlias = new Set(normalized.map((entry) => entry.alias.toLowerCase()));
    normalizeOauthModelAliasEntries(mappings).forEach((entry) => {
      const aliasKey = entry.alias.toLowerCase();
      if (seenAlias.has(aliasKey)) return;
      seenAlias.add(aliasKey);
      normalized.push(entry);
    });

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias';
const MANUAL_REFRESH_EXPIRY_OFFSET_MS = 60_000;
export const AUTH_FILE_UPLOAD_CHUNK_SIZE = 100;
export const AUTH_FILE_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

export const chunkAuthFilesForUpload = (files: File[]): File[][] => {
  if (files.some((file) => file.size > AUTH_FILE_UPLOAD_CHUNK_BYTES)) {
    throw new Error('A credential file exceeds the upload chunk byte limit');
  }
  const chunks: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;
  files.forEach((file) => {
    const exceedsCount = current.length >= AUTH_FILE_UPLOAD_CHUNK_SIZE;
    const exceedsBytes =
      current.length > 0 && currentBytes + file.size > AUTH_FILE_UPLOAD_CHUNK_BYTES;
    if (exceedsCount || exceedsBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
};

export const buildManualRefreshExpiredAt = (nowMs = Date.now()): string =>
  new Date(nowMs - MANUAL_REFRESH_EXPIRY_OFFSET_MS).toISOString();

export const authFilesApi = {
  list: async (query: AuthFilesListQuery = {}) =>
    dedupeAuthFilesResponse(await apiClient.get<AuthFilesResponse>(buildAuthFilesListPath(query))),

  getCodexIdentityAudit: async (): Promise<CodexIdentityAuditResult> =>
    normalizeCodexIdentityAuditResult(await apiClient.get('/auth-files/codex-identity-audit')),

  reconcileBindings: async () =>
    normalizeAuthFileReconciliationResult(await apiClient.post('/auth-files/reconcile')),

  previewLegacyAuthSources: async () =>
    normalizeAuthFileReconciliationResult(await apiClient.post('/auth-files/reconcile')),

  repairLegacyAuthSources: async (selections: AuthFileForeignSourceSelection[]) =>
    normalizeAuthFileReconciliationResult(
      await apiClient.post('/auth-files/reconcile', {
        foreign_action: 'remove',
        foreign_selections: selections.map((selection) => ({
          source_id: selection.sourceId,
          content_sha256: selection.contentSha256,
        })),
      })
    ),

  setStatus: (target: AuthFileMutationTarget, disabled: boolean) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', {
      ...buildAuthFileMutationPayload(target),
      disabled,
    }),

  patchFields: (target: AuthFileMutationTarget, fields: AuthFileFieldsPatch) =>
    apiClient.patch<AuthFileMutationResponse>('/auth-files/fields', {
      ...fields,
      ...buildAuthFileMutationPayload(target),
    }),

  requestManualRefresh: (target: AuthFileMutationTarget) =>
    apiClient.patch('/auth-files/fields', {
      expired: buildManualRefreshExpiredAt(),
      ...buildAuthFileMutationPayload(target),
    }),

  reprobeAvailability: async (): Promise<AuthFileAvailabilityReprobeResult> =>
    normalizeAuthFileAvailabilityReprobeResult(
      await apiClient.post('/auth-files/availability/reprobe')
    ),

  uploadFiles: async (
    files: File[],
    proxySelection?: ProxySelection,
    concurrencyDefault?: ConcurrencySetting
  ): Promise<AuthFileBatchUploadResult> => {
    const requestedNames = files.map((file) => file.name);
    if (requestedNames.length === 0) {
      return { status: 'ok', uploaded: 0, files: [], failed: [] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('file', file, file.name);
    });
    Object.entries(proxySelectionParams(proxySelection)).forEach(([key, value]) => {
      formData.append(key, value);
    });
    if (concurrencyDefault) {
      formData.append('concurrency_mode_default', concurrencyDefault.mode);
      if (concurrencyDefault.mode === 'independent') {
        formData.append('max_concurrency_default', String(concurrencyDefault.maxConcurrency));
      }
    }
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/auth-files', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  uploadFilesInChunks: async (
    files: File[],
    proxySelection?: ProxySelection,
    concurrencyDefault?: ConcurrencySetting,
    options: AuthFileChunkedUploadOptions = {}
  ): Promise<AuthFileChunkedUploadResult> => {
    const nameCounts = new Map<string, number>();
    files.forEach((file) => nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1));

    const uploadableFiles: File[] = [];
    const failures: AuthFileBatchFailure[] = [];
    const retryFiles: File[] = [];
    files.forEach((file) => {
      let error = '';
      if ((nameCounts.get(file.name) ?? 0) > 1) {
        error = 'Duplicate filename in selected upload batch';
      } else if (file.size > AUTH_FILE_UPLOAD_CHUNK_BYTES) {
        error = 'Credential file exceeds the 16 MiB upload limit';
      }
      if (error) {
        failures.push({ name: file.name, error });
        retryFiles.push(file);
      } else {
        uploadableFiles.push(file);
      }
    });

    const chunks = chunkAuthFilesForUpload(uploadableFiles);
    if (files.length === 0) {
      return {
        status: 'ok',
        uploaded: 0,
        files: [],
        failed: [],
        attempted: 0,
        completedChunks: 0,
        totalChunks: 0,
        cancelled: false,
        remainingFiles: [],
      };
    }

    const acceptedNames: string[] = [];
    let attempted = 0;
    let acceptedInputFiles = 0;
    let rejectedInputFiles = retryFiles.length;
    let completedChunks = 0;
    let nextChunkIndex = 0;
    let cancelled = false;

    const publishProgress = (
      phase: AuthFileUploadProgress['phase'],
      remainingFiles = retryFiles.length + Math.max(0, uploadableFiles.length - attempted)
    ) => {
      options.onProgress?.({
        totalFiles: files.length,
        totalChunks: chunks.length,
        currentChunk: chunks.length === 0 ? 0 : Math.min(nextChunkIndex + 1, chunks.length),
        completedChunks,
        processedFiles: attempted + (files.length - uploadableFiles.length),
        acceptedFiles: acceptedInputFiles,
        rejectedFiles: rejectedInputFiles,
        remainingFiles,
        phase,
      });
    };

    publishProgress('uploading');
    for (; nextChunkIndex < chunks.length; nextChunkIndex += 1) {
      if (options.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const chunk = chunks[nextChunkIndex];
      try {
        const result = await authFilesApi.uploadFiles(chunk, proxySelection, concurrencyDefault);
        const failedByName = new Map(result.failed.map((failure) => [failure.name, failure]));
        acceptedNames.push(...result.files);
        chunk.forEach((file) => {
          const failure = failedByName.get(file.name);
          if (failure) {
            failures.push(failure);
            retryFiles.push(file);
            rejectedInputFiles += 1;
            return;
          }
          acceptedInputFiles += 1;
        });
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : 'Upload failed';
        chunk.forEach((file) => {
          failures.push({ name: file.name, error: message });
          retryFiles.push(file);
        });
        rejectedInputFiles += chunk.length;
      }
      attempted += chunk.length;
      completedChunks += 1;
      publishProgress(options.shouldCancel?.() ? 'cancelling' : 'uploading');
    }

    if (nextChunkIndex < chunks.length) {
      chunks.slice(nextChunkIndex).forEach((chunk) => retryFiles.push(...chunk));
    }
    cancelled = cancelled || (Boolean(options.shouldCancel?.()) && attempted < files.length);
    const phase: AuthFileUploadProgress['phase'] = cancelled ? 'cancelled' : 'completed';
    publishProgress(phase, retryFiles.length);

    return {
      status: cancelled ? 'cancelled' : failures.length > 0 ? 'partial' : 'ok',
      uploaded: acceptedNames.length,
      files: acceptedNames,
      failed: failures,
      attempted,
      completedChunks,
      totalChunks: chunks.length,
      cancelled,
      remainingFiles: retryFiles,
    };
  },

  upload: (file: File, proxySelection?: ProxySelection, concurrencyDefault?: ConcurrencySetting) =>
    authFilesApi.uploadFiles([file], proxySelection, concurrencyDefault),

  validateSessionFiles: async (
    files: File[],
    proxySelection?: ProxySelection
  ): Promise<AuthFileSessionValidationResult> => {
    if (files.length === 0) {
      return { status: 'ok', validated: 0, files: [], resolved: [], failed: [] };
    }

    const payload = {
      files: await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          content: await file.text(),
        }))
      ),
      ...proxySelectionParams(proxySelection),
    };
    const response = await apiClient.post<AuthFileSessionValidationResponse>(
      '/auth-files/session-validate',
      payload
    );
    return normalizeSessionValidationResponse(response);
  },

  deleteFiles: async (names: string[]): Promise<AuthFileBatchDeleteResult> => {
    const requestedNames = normalizeRequestedAuthFileNames(names);
    if (requestedNames.length === 0) {
      return {
        status: 'ok',
        deleted: 0,
        files: [],
        pending: [],
        conflicts: [],
        failed: [],
        revision: 0,
        inventoryId: '',
      };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
      data: { names: requestedNames },
    });
    return normalizeBatchDeleteResponse(payload, requestedNames);
  },

  deleteFile: async (target: AuthFileMutationTarget): Promise<AuthFileBatchDeleteResult> => {
    const identity = normalizeAuthFileMutationTarget(target);
    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
      data: buildAuthFileMutationPayload(identity),
    });
    return normalizeBatchDeleteResponse(payload, [identity.name]);
  },

  deleteTargets: async (targets: AuthFileMutationTarget[]): Promise<AuthFileBatchDeleteResult> => {
    const uniqueTargets = Array.from(
      targets
        .reduce<Map<string, AuthFileCredentialIdentity>>((result, target) => {
          const identity = normalizeAuthFileMutationTarget(target);
          if (!result.has(identity.name)) result.set(identity.name, identity);
          return result;
        }, new Map())
        .values()
    );
    if (uniqueTargets.length === 0) return normalizeBatchDeleteResponse(undefined, []);

    const settled = await Promise.allSettled(
      uniqueTargets.map((target) => authFilesApi.deleteFile(target))
    );
    const identityConflict = settled.find(
      (result) =>
        result.status === 'rejected' &&
        result.reason &&
        typeof result.reason === 'object' &&
        (result.reason as { status?: unknown; code?: unknown }).status === 409 &&
        (result.reason as { status?: unknown; code?: unknown }).code === 'auth_identity_changed'
    );
    if (identityConflict?.status === 'rejected') throw identityConflict.reason;

    const results: AuthFileBatchDeleteResult[] = [];
    const failures: AuthFileBatchFailure[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        return;
      }
      failures.push({
        name: uniqueTargets[index].name,
        error: result.reason instanceof Error ? result.reason.message : 'Delete failed',
      });
    });
    return mergeAuthFileDeleteResults(results, failures);
  },

  deleteMatching: async (filter: AuthFileDeleteFilter): Promise<AuthFileBatchDeleteResult> =>
    normalizeBatchDeleteResponse(
      await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
        data: {
          filter: {
            provider: filter.provider,
            group: filter.group,
            without_group: filter.withoutGroup,
            status: filter.status,
            search: filter.search,
          },
        },
      }),
      []
    ),

  deleteAll: async (): Promise<AuthFileBatchDeleteResult> =>
    normalizeBatchDeleteResponse(
      await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', { params: { all: true } }),
      []
    ),

  downloadText: async (name: string): Promise<string> => {
    const response = await apiClient.getRaw(
      `/auth-files/download?name=${encodeURIComponent(name)}`,
      {
        responseType: 'blob',
      }
    );
    const blob = response.data as Blob;
    return blob.text();
  },

  async downloadJsonObject(name: string): Promise<Record<string, unknown>> {
    const rawText = await authFilesApi.downloadText(name);
    return parseAuthFileJsonObject(rawText);
  },

  saveText: (name: string, text: string) => saveAuthFileText(name, text),

  saveJsonObject: (name: string, json: Record<string, unknown>) =>
    saveAuthFileText(name, JSON.stringify(json)),

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', {
      provider: normalizeOAuthProviderKey(provider),
      models,
    }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(
      `/oauth-excluded-models?provider=${encodeURIComponent(normalizeOAuthProviderKey(provider))}`
    ),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    apiClient.put('/oauth-excluded-models', normalizeOauthExcludedModels(map)),

  // OAuth 模型别名
  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT);
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    const normalizedAliases =
      normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
      channel: normalizedChannel,
      aliases: serializeOauthModelAliases(normalizedAliases),
    });
  },

  deleteOauthModelAlias: async (channel: string) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));

    try {
      await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
        channel: normalizedChannel,
        aliases: [],
      });
    } catch (err: unknown) {
      const status = getStatusCode(err);
      if (status !== 405) throw err;
      await apiClient.delete(
        `${OAUTH_MODEL_ALIAS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`
      );
    }
  },

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(
    name: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/auth-files/models?name=${encodeURIComponent(name)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 获取指定 channel 的模型定义
  async getModelDefinitions(
    channel: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },
};
