import { apiClient } from './client';
import type {
  PromptRewriteAsset,
  PromptRewriteBuiltinAsset,
  PromptRewriteBuiltinSource,
  PromptRewriteBuiltinPack,
  PromptRewriteBuiltinPackResource,
  PromptRewriteCatalog,
  PromptRewriteConfig,
  PromptRewriteCredentialCatalogEntry,
  PromptRewriteEvaluation,
  PromptRewriteInputMatch,
  PromptRewriteMatch,
  PromptRewriteMode,
  PromptRewriteMutationEnvelope,
  PromptRewritePreviewRequest,
  PromptRewritePreviewResult,
  PromptRewriteProfile,
  PromptRewriteProviderCatalogEntry,
  PromptRewriteRule,
  PromptRewriteLicenseStatus,
  PromptRewriteSourceLayer,
  PromptRewriteTarget,
  PromptRewriteTargetType,
} from '@/types';

type RecordValue = Record<string, unknown>;

export class PromptRewriteResponseError extends Error {
  readonly code = 'prompt_rewrite_invalid_response';

  constructor(detail: string) {
    super(`prompt_rewrite_invalid_response:${detail}`);
    this.name = 'PromptRewriteResponseError';
  }
}

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};

const hasOwn = (record: RecordValue, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

const aliasValue = (record: RecordValue, snake: string, camel: string): unknown =>
  hasOwn(record, snake) ? record[snake] : record[camel];

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new PromptRewriteResponseError(`${field}_type`);
  return value;
};

const requiredString = (value: unknown, field: string): string => {
  const result = optionalString(value, field);
  if (result === undefined) throw new PromptRewriteResponseError(`${field}_required`);
  return result;
};

const optionalBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new PromptRewriteResponseError(`${field}_type`);
  return value;
};

const requiredBoolean = (value: unknown, field: string): boolean => {
  const result = optionalBoolean(value, field);
  if (result === undefined) throw new PromptRewriteResponseError(`${field}_required`);
  return result;
};

const optionalInteger = (value: unknown, field: string, fallback = 0): number => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PromptRewriteResponseError(`${field}_type`);
  }
  return value;
};

const requiredNumber = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new PromptRewriteResponseError(`${field}_type`);
};

const list = (value: unknown, field: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PromptRewriteResponseError(`${field}_type`);
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new PromptRewriteResponseError(`${field}_${index}_type`);
    }
    return item.trim();
  });
};

const normalizeMode = (value: unknown): PromptRewriteMode => {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new PromptRewriteResponseError('mode_type');
  }
  const candidate = (value ?? '').toString().trim().toLowerCase();
  if (
    candidate === 'preserve' ||
    candidate === 'prepend' ||
    candidate === 'append' ||
    candidate === 'replace'
  ) {
    return candidate;
  }
  if (!candidate) return 'append';
  throw new PromptRewriteResponseError('mode_value');
};

const normalizeEvaluation = (value: unknown): PromptRewriteEvaluation => {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new PromptRewriteResponseError('evaluation_type');
  }
  const candidate = (value ?? '').toString().trim().toLowerCase();
  if (!candidate || candidate === 'first-match') return 'first-match';
  if (candidate === 'layered') return 'layered';
  throw new PromptRewriteResponseError('evaluation_value');
};

const normalizeTargetType = (value: unknown): PromptRewriteTargetType => {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new PromptRewriteResponseError('target_type_type');
  }
  const candidate = (value ?? '').toString().trim().toLowerCase();
  if (!candidate || candidate === 'global') return 'global';
  if (candidate === 'provider' || candidate === 'credential-group' || candidate === 'credential') {
    return candidate;
  }
  throw new PromptRewriteResponseError('target_type_value');
};

const normalizeTarget = (value: unknown): PromptRewriteTarget | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('target_type');
  }
  const record = asRecord(value);
  const target: PromptRewriteTarget = { type: normalizeTargetType(record.type) };
  const targetValue = (optionalString(record.value, 'target_value') ?? '').trim();
  if (target.type === 'global') {
    if (targetValue) throw new PromptRewriteResponseError('global_target_value');
    return undefined;
  }
  if (!targetValue) throw new PromptRewriteResponseError('target_value_required');
  target.value = targetValue;
  return target;
};

const normalizeAsset = (value: unknown): PromptRewriteAsset => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('asset_type');
  }
  const record = asRecord(value);
  const id = requiredString(record.id, 'asset_id').trim();
  const content = requiredString(record.content, 'asset_content');
  if (!id) throw new PromptRewriteResponseError('asset_id_required');
  return {
    id,
    enabled: optionalBoolean(record.enabled, 'asset_enabled'),
    content,
    preserveWhitespace:
      optionalBoolean(record['preserve-whitespace'] ?? record.preserveWhitespace, 'asset_preserve_whitespace'),
    version: optionalString(record.version, 'asset_version')?.trim() || undefined,
    source: optionalString(record.source, 'asset_source')?.trim() || undefined,
    attribution: optionalString(record.attribution, 'asset_attribution')?.trim() || undefined,
    digest: optionalString(record.digest, 'asset_digest')?.trim() || undefined,
  };
};

const normalizeLicenseStatus = (
  value: unknown,
  field: string,
  fallback: PromptRewriteLicenseStatus
): PromptRewriteLicenseStatus => {
  const candidate = (optionalString(value, field) ?? fallback).trim().toLowerCase();
  if (candidate === 'local' || candidate === 'approved' || candidate === 'rejected') {
    return candidate;
  }
  throw new PromptRewriteResponseError(`${field}_value`);
};

const normalizeSourceLayer = (value: unknown, field: string): PromptRewriteSourceLayer => {
  const candidate = (optionalString(value, field) ?? 'bundled').trim().toLowerCase();
  if (
    candidate === 'override' ||
    candidate === 'remote' ||
    candidate === 'cache' ||
    candidate === 'bundled'
  ) {
    return candidate;
  }
  throw new PromptRewriteResponseError(`${field}_value`);
};

const normalizeBuiltinSource = (value: unknown, index: number): PromptRewriteBuiltinSource => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError(`builtin_source_${index}_type`);
  }
  const record = asRecord(value);
  const field = (name: string) => `builtin_source_${index}_${name}`;
  const asset = requiredString(record.asset, field('asset')).trim();
  if (!asset) throw new PromptRewriteResponseError(`${field('asset')}_required`);
  return {
    asset,
    content: requiredString(record.content, field('content')),
    sourceURL:
      optionalString(aliasValue(record, 'source-url', 'sourceURL'), field('source_url'))?.trim() ||
      undefined,
    importedAt:
      optionalString(
        aliasValue(record, 'imported-at', 'importedAt'),
        field('imported_at')
      )?.trim() || undefined,
    sourceRevision:
      optionalString(
        aliasValue(record, 'source-revision', 'sourceRevision'),
        field('source_revision')
      )?.trim() || undefined,
    etag: optionalString(record.etag, field('etag'))?.trim() || undefined,
    digest: optionalString(record.digest, field('digest'))?.trim() || undefined,
    license: optionalString(record.license, field('license'))?.trim() || undefined,
    licenseStatus: normalizeLicenseStatus(
      aliasValue(record, 'license-status', 'licenseStatus'),
      field('license_status'),
      'local'
    ),
    attribution: optionalString(record.attribution, field('attribution'))?.trim() || undefined,
  };
};

const normalizeBuiltinAsset = (value: unknown, index: number): PromptRewriteBuiltinAsset => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError(`builtin_asset_${index}_type`);
  }
  const record = asRecord(value);
  const field = (name: string) => `builtin_asset_${index}_${name}`;
  const id = requiredString(record.id, field('id')).trim();
  const readOnly = requiredBoolean(aliasValue(record, 'read_only', 'readOnly'), field('read_only'));
  if (!id) throw new PromptRewriteResponseError(`${field('id')}_required`);
  if (!readOnly) throw new PromptRewriteResponseError(field('mutable'));
  const source = requiredString(record.source, field('source')).trim();
  const sourcePath = requiredString(
    aliasValue(record, 'source_path', 'sourcePath'),
    field('source_path')
  ).trim();
  const sourceRevision = requiredString(
    aliasValue(record, 'source_revision', 'sourceRevision'),
    field('source_revision')
  ).trim();
  const digest = requiredString(record.digest, field('digest')).trim();
  const project =
    optionalString(record.project, field('project'))?.trim() ||
    id.split('/')[0].replace(/^builtin:/, '');
  const templateID =
    optionalString(aliasValue(record, 'template_id', 'templateID'), field('template_id'))?.trim() ||
    id.replace(/^builtin:[^/]+\//, '');
  return {
    id,
    project,
    templateID,
    filename:
      optionalString(record.filename, field('filename'))?.trim() ||
      sourcePath.split('/').filter(Boolean).slice(-1)[0] ||
      templateID,
    content: requiredString(record.content, field('content')),
    version: requiredString(record.version, field('version')).trim(),
    source,
    sourcePath,
    sourceRevision,
    sourceLayer: normalizeSourceLayer(
      aliasValue(record, 'source_layer', 'sourceLayer'),
      field('source_layer')
    ),
    importedAt:
      optionalString(
        aliasValue(record, 'imported_at', 'importedAt'),
        field('imported_at')
      )?.trim() || undefined,
    etag: optionalString(record.etag, field('etag'))?.trim() || undefined,
    digest,
    bundledDigest:
      optionalString(
        aliasValue(record, 'bundled_digest', 'bundledDigest'),
        field('bundled_digest')
      )?.trim() || digest,
    bundledSource:
      optionalString(
        aliasValue(record, 'bundled_source', 'bundledSource'),
        field('bundled_source')
      )?.trim() || source,
    bundledSourceRevision:
      optionalString(
        aliasValue(record, 'bundled_source_revision', 'bundledSourceRevision'),
        field('bundled_source_revision')
      )?.trim() || sourceRevision,
    license: requiredString(record.license, field('license')).trim(),
    licenseStatus: normalizeLicenseStatus(
      aliasValue(record, 'license_status', 'licenseStatus'),
      field('license_status'),
      'approved'
    ),
    licenseText: requiredString(
      aliasValue(record, 'license_text', 'licenseText'),
      field('license_text')
    ),
    attribution: requiredString(record.attribution, field('attribution')).trim(),
    readOnly: true,
  };
};

const normalizeBuiltinPackResource = (
  value: unknown,
  packIndex: number,
  resourceIndex: number
): PromptRewriteBuiltinPackResource => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError(
      `builtin_pack_${packIndex}_resource_${resourceIndex}_type`
    );
  }
  const record = asRecord(value);
  const field = (name: string) => `builtin_pack_${packIndex}_resource_${resourceIndex}_${name}`;
  const executionSupported = requiredBoolean(
    aliasValue(record, 'execution_supported', 'executionSupported'),
    field('execution_supported')
  );
  if (executionSupported) throw new PromptRewriteResponseError(field('executable'));
  return {
    id: requiredString(record.id, field('id')).trim(),
    path: requiredString(record.path, field('path')).trim(),
    kind: requiredString(record.kind, field('kind')).trim(),
    applicability: requiredString(record.applicability, field('applicability')).trim(),
    bytes: requiredNumber(record.bytes, field('bytes')),
    newlineCount: requiredNumber(
      aliasValue(record, 'newline_count', 'newlineCount'),
      field('newline_count')
    ),
    lineEndings: requiredString(
      aliasValue(record, 'line_endings', 'lineEndings'),
      field('line_endings')
    ).trim(),
    sha256: requiredString(record.sha256, field('sha256')).trim(),
    promptBindable: requiredBoolean(
      aliasValue(record, 'prompt_bindable', 'promptBindable'),
      field('prompt_bindable')
    ),
    previewable: requiredBoolean(record.previewable, field('previewable')),
    exportable: requiredBoolean(record.exportable, field('exportable')),
    executionSupported: false,
  };
};

const normalizeBuiltinPack = (value: unknown, index: number): PromptRewriteBuiltinPack => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError(`builtin_pack_${index}_type`);
  }
  const record = asRecord(value);
  const field = (name: string) => `builtin_pack_${index}_${name}`;
  if (!Array.isArray(record.resources)) {
    throw new PromptRewriteResponseError(field('resources_type'));
  }
  const readOnly = requiredBoolean(aliasValue(record, 'read_only', 'readOnly'), field('read_only'));
  const executionSupported = requiredBoolean(
    aliasValue(record, 'execution_supported', 'executionSupported'),
    field('execution_supported')
  );
  if (!readOnly) throw new PromptRewriteResponseError(field('mutable'));
  if (executionSupported) throw new PromptRewriteResponseError(field('executable'));
  const resources = record.resources.map((resource, resourceIndex) =>
    normalizeBuiltinPackResource(resource, index, resourceIndex)
  );
  const resourcePaths = new Set<string>();
  resources.forEach((resource) => {
    if (!resource.id || !resource.path) {
      throw new PromptRewriteResponseError(field('resource_identity'));
    }
    if (resourcePaths.has(resource.path)) {
      throw new PromptRewriteResponseError(field('resource_duplicate'));
    }
    resourcePaths.add(resource.path);
  });
  return {
    id: requiredString(record.id, field('id')).trim(),
    project: requiredString(record.project, field('project')).trim(),
    name: requiredString(record.name, field('name')).trim(),
    version: requiredString(record.version, field('version')).trim(),
    source: requiredString(record.source, field('source')).trim(),
    license: requiredString(record.license, field('license')).trim(),
    licenseSPDX:
      optionalString(
        aliasValue(record, 'license_spdx', 'licenseSPDX'),
        field('license_spdx')
      )?.trim() || undefined,
    licenseSHA256: requiredString(
      aliasValue(record, 'license_sha256', 'licenseSHA256'),
      field('license_sha256')
    ).trim(),
    attribution: requiredString(record.attribution, field('attribution')).trim(),
    distribution: requiredString(record.distribution, field('distribution')).trim(),
    archiveFilename:
      optionalString(
        aliasValue(record, 'archive_filename', 'archiveFilename'),
        field('archive_filename')
      )?.trim() || `${requiredString(record.project, field('project')).trim()}.zip`,
    readOnly: true,
    executionSupported: false,
    resources,
  };
};

const normalizeProfile = (value: unknown): PromptRewriteProfile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('profile_type');
  }
  const record = asRecord(value);
  const id = requiredString(record.id, 'profile_id').trim();
  if (!id) throw new PromptRewriteResponseError('profile_id_required');
  return {
    id,
    enabled: optionalBoolean(record.enabled, 'profile_enabled'),
    assets: list(record.assets, 'profile_assets'),
  };
};

const normalizeInputMatch = (value: unknown): PromptRewriteInputMatch => {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new PromptRewriteResponseError('input_match_type');
  }
  const record = asRecord(value);
  return {
    exact: list(record.exact, 'input_exact'),
    contains: list(record.contains, 'input_contains'),
    suffixes: list(record.suffixes, 'input_suffixes'),
  };
};

const normalizeMatch = (value: unknown): PromptRewriteMatch => {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new PromptRewriteResponseError('match_type');
  }
  const record = asRecord(value);
  return {
    models: list(record.models, 'models'),
    requestedModels: list(
      aliasValue(record, 'requested-models', 'requestedModels'),
      'requested_models'
    ),
    requestPaths: list(aliasValue(record, 'request-paths', 'requestPaths'), 'request_paths'),
    input: normalizeInputMatch(record.input),
  };
};

const normalizeRule = (value: unknown): PromptRewriteRule => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('rule_type');
  }
  const record = asRecord(value);
  const name = requiredString(record.name, 'rule_name').trim();
  if (!name) throw new PromptRewriteResponseError('rule_name_required');
  const prompt = (optionalString(record.prompt, 'rule_prompt') ?? '').trim();
  const asset = (optionalString(record.asset, 'rule_asset') ?? '').trim();
  const profile = (optionalString(record.profile, 'rule_profile') ?? '').trim();
  return {
    name,
    enabled: optionalBoolean(record.enabled, 'rule_enabled'),
    priority: optionalInteger(record.priority, 'rule_priority'),
    target: normalizeTarget(record.target),
    mode: normalizeMode(record.mode),
    prompt: prompt || undefined,
    asset: asset || undefined,
    profile: profile || undefined,
    route: (optionalString(record.route, 'rule_route') ?? '').trim() || undefined,
    match: normalizeMatch(record.match),
  };
};

export const emptyPromptRewriteConfig = (): PromptRewriteConfig => ({
  enabled: false,
  allowReplace: false,
  evaluation: 'first-match',
  builtinOverrides: [],
  remoteSources: [],
  builtinCache: [],
  assets: [],
  profiles: [],
  rules: [],
});

export const normalizePromptRewriteConfig = (value: unknown): PromptRewriteConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('config_type');
  }
  const record = asRecord(value);
  const enabled = requiredBoolean(record.enabled, 'enabled');
  const allowReplaceValue = aliasValue(record, 'allow-replace', 'allowReplace');
  const allowReplace =
    allowReplaceValue === undefined ? false : requiredBoolean(allowReplaceValue, 'allow_replace');
  const builtinOverridesValue = aliasValue(record, 'builtin-overrides', 'builtinOverrides');
  const remoteSourcesValue = aliasValue(record, 'remote-sources', 'remoteSources');
  const builtinCacheValue = aliasValue(record, 'builtin-cache', 'builtinCache');
  for (const [field, fieldValue] of [
    ['builtin_overrides', builtinOverridesValue],
    ['remote_sources', remoteSourcesValue],
    ['builtin_cache', builtinCacheValue],
  ] as const) {
    if (fieldValue !== undefined && fieldValue !== null && !Array.isArray(fieldValue)) {
      throw new PromptRewriteResponseError(`${field}_type`);
    }
  }
  if (record.assets !== undefined && record.assets !== null && !Array.isArray(record.assets)) {
    throw new PromptRewriteResponseError('assets_type');
  }
  if (
    record.profiles !== undefined &&
    record.profiles !== null &&
    !Array.isArray(record.profiles)
  ) {
    throw new PromptRewriteResponseError('profiles_type');
  }
  if (record.rules !== undefined && record.rules !== null && !Array.isArray(record.rules)) {
    throw new PromptRewriteResponseError('rules_type');
  }
  return {
    enabled,
    allowReplace,
    evaluation: normalizeEvaluation(record.evaluation),
    builtinOverrides: Array.isArray(builtinOverridesValue)
      ? builtinOverridesValue.map(normalizeBuiltinSource)
      : [],
    remoteSources: Array.isArray(remoteSourcesValue)
      ? remoteSourcesValue.map(normalizeBuiltinSource)
      : [],
    builtinCache: Array.isArray(builtinCacheValue)
      ? builtinCacheValue.map(normalizeBuiltinSource)
      : [],
    assets: Array.isArray(record.assets) ? record.assets.map(normalizeAsset) : [],
    profiles: Array.isArray(record.profiles) ? record.profiles.map(normalizeProfile) : [],
    rules: Array.isArray(record.rules) ? record.rules.map(normalizeRule) : [],
  };
};

const serializeTarget = (target: PromptRewriteTarget | undefined) =>
  target
    ? {
        type: target.type,
        ...(target.value?.trim() ? { value: target.value.trim() } : {}),
      }
    : undefined;

const serializeAsset = (asset: PromptRewriteAsset) => ({
  id: asset.id.trim(),
  ...(asset.enabled === undefined ? {} : { enabled: asset.enabled }),
  content: asset.content,
  ...(asset.preserveWhitespace === undefined
    ? {}
    : { 'preserve-whitespace': asset.preserveWhitespace }),
  ...(asset.version?.trim() ? { version: asset.version.trim() } : {}),
  ...(asset.source?.trim() ? { source: asset.source.trim() } : {}),
  ...(asset.attribution?.trim() ? { attribution: asset.attribution.trim() } : {}),
  ...(asset.digest?.trim() ? { digest: asset.digest.trim() } : {}),
});

const serializeBuiltinSource = (source: PromptRewriteBuiltinSource) => ({
  asset: source.asset.trim(),
  content: source.content,
  ...(source.sourceURL?.trim() ? { 'source-url': source.sourceURL.trim() } : {}),
  ...(source.importedAt?.trim() ? { 'imported-at': source.importedAt.trim() } : {}),
  ...(source.sourceRevision?.trim() ? { 'source-revision': source.sourceRevision.trim() } : {}),
  ...(source.etag?.trim() ? { etag: source.etag.trim() } : {}),
  ...(source.digest?.trim() ? { digest: source.digest.trim() } : {}),
  ...(source.license?.trim() ? { license: source.license.trim() } : {}),
  ...(source.licenseStatus ? { 'license-status': source.licenseStatus } : {}),
  ...(source.attribution?.trim() ? { attribution: source.attribution.trim() } : {}),
});

const serializeRule = (rule: PromptRewriteRule) => ({
  name: rule.name.trim(),
  ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
  ...(rule.priority ? { priority: rule.priority } : {}),
  ...(serializeTarget(rule.target) ? { target: serializeTarget(rule.target) } : {}),
  mode: rule.mode,
  ...(rule.prompt?.trim() ? { prompt: rule.prompt.trim() } : {}),
  ...(rule.asset?.trim() ? { asset: rule.asset.trim() } : {}),
  ...(rule.profile?.trim() ? { profile: rule.profile.trim() } : {}),
  ...(rule.route?.trim() ? { route: rule.route.trim() } : {}),
  match: {
    ...(rule.match.models.length ? { models: rule.match.models } : {}),
    ...(rule.match.requestedModels.length
      ? { 'requested-models': rule.match.requestedModels }
      : {}),
    ...(rule.match.requestPaths.length ? { 'request-paths': rule.match.requestPaths } : {}),
    ...(rule.match.input.exact.length ||
    rule.match.input.contains.length ||
    rule.match.input.suffixes.length
      ? {
          input: {
            ...(rule.match.input.exact.length ? { exact: rule.match.input.exact } : {}),
            ...(rule.match.input.contains.length ? { contains: rule.match.input.contains } : {}),
            ...(rule.match.input.suffixes.length ? { suffixes: rule.match.input.suffixes } : {}),
          },
        }
      : {}),
  },
});

export const serializePromptRewriteConfig = (config: PromptRewriteConfig) => ({
  enabled: config.enabled,
  ...(config.allowReplace ? { 'allow-replace': true } : {}),
  evaluation: config.evaluation,
  ...(config.builtinOverrides.length
    ? { 'builtin-overrides': config.builtinOverrides.map(serializeBuiltinSource) }
    : {}),
  ...(config.remoteSources.length
    ? { 'remote-sources': config.remoteSources.map(serializeBuiltinSource) }
    : {}),
  ...(config.builtinCache.length
    ? { 'builtin-cache': config.builtinCache.map(serializeBuiltinSource) }
    : {}),
  assets: config.assets.map(serializeAsset),
  profiles: config.profiles.map((profile) => ({
    id: profile.id.trim(),
    ...(profile.enabled === undefined ? {} : { enabled: profile.enabled }),
    assets: profile.assets,
  })),
  rules: config.rules.map(serializeRule),
});

export const normalizePromptRewriteCatalog = (value: unknown): PromptRewriteCatalog => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('catalog_type');
  }
  const record = asRecord(value);
  const credentialGroupsValue = aliasValue(record, 'credential_groups', 'credentialGroups');
  const builtinAssetsValue = aliasValue(record, 'builtin_assets', 'builtinAssets');
  const builtinPacksValue = aliasValue(record, 'builtin_packs', 'builtinPacks');
  if (
    !Array.isArray(record.credentials) ||
    !Array.isArray(record.providers) ||
    !Array.isArray(credentialGroupsValue)
  ) {
    throw new PromptRewriteResponseError('catalog_shape');
  }
  if (
    builtinAssetsValue !== undefined &&
    builtinAssetsValue !== null &&
    !Array.isArray(builtinAssetsValue)
  ) {
    throw new PromptRewriteResponseError('builtin_assets_type');
  }
  if (
    builtinPacksValue !== undefined &&
    builtinPacksValue !== null &&
    !Array.isArray(builtinPacksValue)
  ) {
    throw new PromptRewriteResponseError('builtin_packs_type');
  }
  const revision = requiredString(record.revision, 'catalog_revision').trim();
  if (!revision) {
    throw new PromptRewriteResponseError('catalog_revision');
  }
  const credentials = record.credentials.map((item, index): PromptRewriteCredentialCatalogEntry => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new PromptRewriteResponseError(`credential_${index}_type`);
    }
    const entry = asRecord(item);
    const id = requiredString(entry.id, `credential_${index}_id`).trim();
    if (!id) throw new PromptRewriteResponseError(`credential_${index}_id_required`);
    return {
      id,
      displayName: requiredString(
        aliasValue(entry, 'display_name', 'displayName'),
        `credential_${index}_display_name`
      ),
      provider: requiredString(entry.provider, `credential_${index}_provider`).trim(),
      groups: list(entry.groups, `credential_${index}_groups`),
      status: optionalString(entry.status, `credential_${index}_status`)?.trim() || undefined,
      carrierSupported: requiredBoolean(
        aliasValue(entry, 'carrier_supported', 'carrierSupported'),
        `credential_${index}_carrier_supported`
      ),
      carrierFormat:
        optionalString(
          aliasValue(entry, 'carrier_format', 'carrierFormat'),
          `credential_${index}_carrier_format`
        )?.trim() || undefined,
    };
  });
  const providers = record.providers.map((item, index): PromptRewriteProviderCatalogEntry => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new PromptRewriteResponseError(`provider_${index}_type`);
    }
    const entry = asRecord(item);
    const id = requiredString(entry.id, `provider_${index}_id`).trim();
    if (!id) throw new PromptRewriteResponseError(`provider_${index}_id_required`);
    return {
      id,
      carrierSupported: requiredBoolean(
        aliasValue(entry, 'carrier_supported', 'carrierSupported'),
        `provider_${index}_carrier_supported`
      ),
      carrierFormat:
        optionalString(
          aliasValue(entry, 'carrier_format', 'carrierFormat'),
          `provider_${index}_carrier_format`
        )?.trim() || undefined,
    };
  });
  const builtinAssets = Array.isArray(builtinAssetsValue)
    ? builtinAssetsValue.map(normalizeBuiltinAsset)
    : [];
  const builtinIDs = new Set<string>();
  builtinAssets.forEach((asset) => {
    const key = asset.id.toLowerCase();
    if (builtinIDs.has(key)) throw new PromptRewriteResponseError('builtin_asset_duplicate');
    builtinIDs.add(key);
  });
  const builtinPacks = Array.isArray(builtinPacksValue)
    ? builtinPacksValue.map(normalizeBuiltinPack)
    : [];
  const builtinPackIDs = new Set<string>();
  builtinPacks.forEach((pack) => {
    const key = pack.id.toLowerCase();
    if (!key || builtinPackIDs.has(key)) {
      throw new PromptRewriteResponseError('builtin_pack_duplicate');
    }
    builtinPackIDs.add(key);
  });
  return {
    builtinAssets,
    builtinPacks,
    credentials,
    providers,
    credentialGroups: list(credentialGroupsValue, 'credential_groups'),
    revision,
    activeGeneration: requiredNumber(
      aliasValue(record, 'active_generation', 'activeGeneration'),
      'active_generation'
    ),
    inventoryId: (
      optionalString(aliasValue(record, 'inventory_id', 'inventoryId'), 'inventory_id') ?? ''
    ).trim(),
    inventoryRevision: requiredNumber(
      aliasValue(record, 'inventory_revision', 'inventoryRevision'),
      'inventory_revision'
    ),
  };
};

export const normalizePromptRewriteMutation = (value: unknown): PromptRewriteMutationEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('mutation_type');
  }
  const record = asRecord(value);
  const promptRewrite = aliasValue(record, 'prompt-rewrite', 'promptRewrite');
  if (promptRewrite === undefined) throw new PromptRewriteResponseError('missing_policy');
  const revision = requiredString(record.revision, 'revision').trim();
  if (!revision) {
    throw new PromptRewriteResponseError('revision');
  }
  return {
    promptRewrite: normalizePromptRewriteConfig(promptRewrite),
    revision,
    inventoryId: (
      optionalString(aliasValue(record, 'inventory_id', 'inventoryId'), 'inventory_id') ?? ''
    ).trim(),
    inventoryRevision: requiredNumber(
      aliasValue(record, 'inventory_revision', 'inventoryRevision'),
      'inventory_revision'
    ),
  };
};

export const normalizePromptRewritePreview = (value: unknown): PromptRewritePreviewResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PromptRewriteResponseError('preview_type');
  }
  const record = asRecord(value);
  if (
    typeof record.changed !== 'boolean' ||
    !Object.prototype.hasOwnProperty.call(record, 'body')
  ) {
    throw new PromptRewriteResponseError('preview_shape');
  }
  const previewModeValue = optionalString(record.mode, 'preview_mode');
  const previewMode = previewModeValue?.trim() ? normalizeMode(previewModeValue) : undefined;
  return {
    changed: record.changed,
    matchedRules: list(aliasValue(record, 'matched_rules', 'matchedRules'), 'matched_rules'),
    suppressedRules: list(
      aliasValue(record, 'suppressed_rules', 'suppressedRules'),
      'suppressed_rules'
    ),
    assetIds: list(aliasValue(record, 'asset_ids', 'assetIds'), 'asset_ids'),
    suppressedAssets: list(
      aliasValue(record, 'suppressed_assets', 'suppressedAssets'),
      'suppressed_assets'
    ),
    mode: previewMode,
    evaluation: normalizeEvaluation(record.evaluation),
    addedBytes: requiredNumber(aliasValue(record, 'added_bytes', 'addedBytes'), 'added_bytes'),
    instructions: record.instructions,
    body: record.body,
    error: optionalString(record.error, 'preview_error')?.trim() || undefined,
  };
};

const serializePreviewRequest = (request: PromptRewritePreviewRequest) => ({
  ...(request.promptRewrite
    ? { 'prompt-rewrite': serializePromptRewriteConfig(request.promptRewrite) }
    : {}),
  ...(request.body === undefined ? {} : { body: request.body }),
  ...(request.instructions ? { instructions: request.instructions } : {}),
  ...(request.input === undefined ? {} : { input: request.input }),
  ...(request.sourceFormat ? { source_format: request.sourceFormat } : {}),
  ...(request.targetFormat ? { target_format: request.targetFormat } : {}),
  ...(request.requestPath ? { request_path: request.requestPath } : {}),
  ...(request.model ? { model: request.model } : {}),
  ...(request.requestedModel ? { requested_model: request.requestedModel } : {}),
  ...(request.codexClient === undefined ? {} : { codex_client: request.codexClient }),
  ...(request.authId ? { auth_id: request.authId } : {}),
  ...(request.provider ? { provider: request.provider } : {}),
  ...(request.groups?.length ? { groups: request.groups } : {}),
});

export const promptRewriteApi = {
  async get(): Promise<PromptRewriteMutationEnvelope> {
    return normalizePromptRewriteMutation(await apiClient.get('/prompt-rewrite'));
  },

  async catalog(): Promise<PromptRewriteCatalog> {
    return normalizePromptRewriteCatalog(await apiClient.get('/prompt-rewrite/catalog'));
  },

  async packResource(packId: string, resourcePath: string): Promise<string> {
    const encodedPath = resourcePath.split('/').map(encodeURIComponent).join('/');
    const response = await apiClient.getRaw(
      `/prompt-rewrite/packs/${encodeURIComponent(packId)}/resources/${encodedPath}`,
      { responseType: 'blob' }
    );
    return (response.data as Blob).text();
  },

  async exportPack(packId: string): Promise<Blob> {
    const response = await apiClient.getRaw(
      `/prompt-rewrite/packs/${encodeURIComponent(packId)}/export`,
      { responseType: 'blob' }
    );
    return response.data as Blob;
  },

  async save(
    config: PromptRewriteConfig,
    revision: string,
    inventoryId: string,
    inventoryRevision: number
  ): Promise<PromptRewriteMutationEnvelope> {
    const response = await apiClient.put(
      '/prompt-rewrite',
      {
        'prompt-rewrite': serializePromptRewriteConfig(config),
        revision,
        inventory_id: inventoryId,
        inventory_revision: inventoryRevision,
      },
      { headers: { 'If-Match': revision } }
    );
    return normalizePromptRewriteMutation(response);
  },

  async preview(request: PromptRewritePreviewRequest): Promise<PromptRewritePreviewResult> {
    return normalizePromptRewritePreview(
      await apiClient.post('/prompt-rewrite/preview', serializePreviewRequest(request))
    );
  },

};
