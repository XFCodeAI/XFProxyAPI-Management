/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelAliasEntry, ProxySelection } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { parseTimestampMs } from '@/utils/timestamp';
import { proxySelectionParams } from './proxyPools';

type StatusError = { status?: number };
type AuthFileStatusResponse = { status: string; disabled: boolean };
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileFieldsPatch = {
  alias?: string;
  groups?: string[];
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  fallback?: boolean;
  websockets?: boolean;
  note?: string;
};
type AuthFileBatchFailure = { name: string; error: string };
export type AuthFileDeleteItem = { name: string; status: string; error?: string };
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
};
type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
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
  failed: AuthFileBatchFailure[];
};
export type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  pending: AuthFileDeleteItem[];
  conflicts: AuthFileDeleteItem[];
  failed: AuthFileBatchFailure[];
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
  const failed = normalizeBatchFailures(payload?.failed);
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
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const normalizeCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
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
    total: normalizedFiles.length,
  };
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
    mappings
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const fork = entry.fork === true;
        return fork ? { name, alias, fork } : { name, alias };
      })
      .filter(Boolean)
      .forEach((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const aliasKey = aliasEntry.alias.toLowerCase();
        if (seenAlias.has(aliasKey)) return;
        seenAlias.add(aliasKey);
        normalized.push(aliasEntry);
      });

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias';

export const authFilesApi = {
  list: async () => dedupeAuthFilesResponse(await apiClient.get<AuthFilesResponse>('/auth-files')),

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

  setStatus: (name: string, disabled: boolean) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', { name, disabled }),

  patchFields: (name: string, fields: AuthFileFieldsPatch) =>
    apiClient.patch('/auth-files/fields', { name, ...fields }),

  uploadFiles: async (
    files: File[],
    proxySelection?: ProxySelection
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
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/auth-files', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  upload: (file: File, proxySelection?: ProxySelection) =>
    authFilesApi.uploadFiles([file], proxySelection),

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
      return { status: 'ok', deleted: 0, files: [], pending: [], conflicts: [], failed: [] };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
      data: { names: requestedNames },
    });
    return normalizeBatchDeleteResponse(payload, requestedNames);
  },

  deleteFile: (name: string) => authFilesApi.deleteFiles([name]),

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
      aliases: normalizedAliases,
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
