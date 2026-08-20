import { apiClient } from './client';
import type {
  ResponseTamperAsset,
  ResponseTamperBuiltinProgram,
  ResponseTamperCatalog,
  ResponseTamperConfig,
  ResponseTamperCredentialCatalogEntry,
  ResponseTamperMutationEnvelope,
  ResponseTamperPreviewRequest,
  ResponseTamperPreviewResult,
  ResponseTamperProgram,
  ResponseTamperProgramMode,
  ResponseTamperRule,
  ResponseTamperTarget,
  ResponseTamperTargetType,
  ResponseTamperTrigger,
} from '@/types';

type RecordValue = Record<string, unknown>;

export class ResponseTamperResponseError extends Error {
  readonly code = 'response_tamper_invalid_response';

  constructor(detail: string) {
    super(`response_tamper_invalid_response:${detail}`);
    this.name = 'ResponseTamperResponseError';
  }
}

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};

const aliasValue = (record: RecordValue, snake: string, camel: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, snake) ? record[snake] : record[camel];

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new ResponseTamperResponseError(`${field}_type`);
  return value;
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
};

const requiredBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') throw new ResponseTamperResponseError(`${field}_type`);
  return value;
};

const optionalBoolean = (value: unknown, field: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  return requiredBoolean(value, field);
};

const integer = (value: unknown, field: string, fallback = 0): number => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new ResponseTamperResponseError(`${field}_type`);
};

const stringList = (value: unknown, field: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ResponseTamperResponseError(`${field}_type`);
  return value.map((item, index) => {
    const text = requiredString(item, `${field}_${index}`).trim();
    if (!text) throw new ResponseTamperResponseError(`${field}_${index}_empty`);
    return text;
  });
};

const targetType = (value: unknown): ResponseTamperTargetType => {
  const candidate = optionalString(value, 'target_type')?.trim().toLowerCase() ?? 'global';
  if (
    candidate === 'global' ||
    candidate === 'provider' ||
    candidate === 'credential-group' ||
    candidate === 'credential'
  ) {
    return candidate;
  }
  throw new ResponseTamperResponseError('target_type_value');
};

const normalizeTarget = (value: unknown): ResponseTamperTarget | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseTamperResponseError('target_shape');
  }
  const record = asRecord(value);
  const type = targetType(record.type);
  const targetValue = optionalString(record.value, 'target_value')?.trim() ?? '';
  if (type === 'global') return undefined;
  if (!targetValue) throw new ResponseTamperResponseError('target_value_required');
  return { type, value: targetValue };
};

const normalizeTrigger = (value: unknown): ResponseTamperTrigger => {
  const candidate = requiredString(value, 'trigger').trim().toLowerCase();
  if (
    candidate === 'official-refusal' ||
    candidate === 'text-regex' ||
    candidate === 'nerv'
  ) {
    return candidate;
  }
  throw new ResponseTamperResponseError('trigger_value');
};

const normalizeAsset = (value: unknown, index: number): ResponseTamperAsset => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseTamperResponseError(`asset_${index}_shape`);
  }
  const record = asRecord(value);
  return {
    id: requiredString(record.id, `asset_${index}_id`).trim(),
    enabled: optionalBoolean(record.enabled, `asset_${index}_enabled`),
    content: requiredString(record.content, `asset_${index}_content`),
    version: optionalString(record.version, `asset_${index}_version`)?.trim() || undefined,
    source: optionalString(record.source, `asset_${index}_source`)?.trim() || undefined,
    attribution:
      optionalString(record.attribution, `asset_${index}_attribution`)?.trim() || undefined,
    digest: optionalString(record.digest, `asset_${index}_digest`)?.trim() || undefined,
  };
};

const normalizeRule = (value: unknown, index: number): ResponseTamperRule => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseTamperResponseError(`rule_${index}_shape`);
  }
  const record = asRecord(value);
  const trigger = normalizeTrigger(record.trigger);
  const asset = optionalString(record.asset, `rule_${index}_asset`)?.trim() || undefined;
  const program = optionalString(record.program, `rule_${index}_program`)?.trim() || undefined;
  if (trigger !== 'nerv' && !asset) {
    throw new ResponseTamperResponseError(`rule_${index}_asset_required`);
  }
  if (trigger === 'nerv' && !program) {
    throw new ResponseTamperResponseError(`rule_${index}_program_required`);
  }
  return {
    id: requiredString(record.id, `rule_${index}_id`).trim(),
    enabled: optionalBoolean(record.enabled, `rule_${index}_enabled`),
    priority: integer(record.priority, `rule_${index}_priority`),
    target: normalizeTarget(record.target),
    models: stringList(record.models, `rule_${index}_models`),
    trigger,
    pattern: optionalString(record.pattern, `rule_${index}_pattern`)?.trim() || undefined,
    asset,
    program,
  };
};

const normalizeProgram = (value: unknown, index: number): ResponseTamperProgram => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseTamperResponseError(`program_${index}_shape`);
  }
  const record = asRecord(value);
  const minTextRunes = integer(
    aliasValue(record, 'min-text-runes', 'minTextRunes'),
    `program_${index}_min_text_runes`
  );
  const modeValue = optionalString(record.mode, `program_${index}_mode`)?.trim().toLowerCase();
  const mode = (modeValue || (minTextRunes === 21 ? 'nerv-relay' : 'nerv-direct')) as ResponseTamperProgramMode;
  if (mode !== 'nerv-direct' && mode !== 'nerv-relay') {
    throw new ResponseTamperResponseError(`program_${index}_mode_value`);
  }
  return {
    id: requiredString(record.id, `program_${index}_id`).trim(),
    mode,
    source: optionalString(record.source, `program_${index}_source`)?.trim() || undefined,
    sourcePath:
      optionalString(
        aliasValue(record, 'source-path', 'sourcePath'),
        `program_${index}_source_path`
      )?.trim() || undefined,
    sourceRevision:
      optionalString(
        aliasValue(record, 'source-revision', 'sourceRevision'),
        `program_${index}_source_revision`
      )?.trim() || undefined,
    sourceSha256:
      optionalString(
        aliasValue(record, 'source-sha256', 'sourceSha256'),
        `program_${index}_source_sha256`
      )?.trim() || undefined,
    patterns: stringList(record.patterns, `program_${index}_patterns`),
    replacementTemplate: requiredString(
      aliasValue(record, 'replacement-template', 'replacementTemplate'),
      `program_${index}_replacement_template`
    ),
    minTextRunes,
  };
};

const normalizeBuiltinProgram = (value: unknown, index: number): ResponseTamperBuiltinProgram => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseTamperResponseError(`builtin_program_${index}_shape`);
  }
  const record = asRecord(value);
  const patterns = stringList(record.patterns, `builtin_program_${index}_patterns`);
  const patternCount = integer(
    aliasValue(record, 'pattern_count', 'patternCount'),
    `builtin_program_${index}_pattern_count`
  );
  if (patternCount !== patterns.length) {
    throw new ResponseTamperResponseError(`builtin_program_${index}_pattern_count_mismatch`);
  }
  return {
    id: requiredString(record.id, `builtin_program_${index}_id`).trim(),
    name: requiredString(record.name, `builtin_program_${index}_name`).trim(),
    mode: (() => {
      const value = requiredString(record.mode, `builtin_program_${index}_mode`).trim().toLowerCase();
      if (value !== 'nerv-direct' && value !== 'nerv-relay') {
        throw new ResponseTamperResponseError(`builtin_program_${index}_mode_value`);
      }
      return value as ResponseTamperProgramMode;
    })(),
    source: requiredString(record.source, `builtin_program_${index}_source`).trim(),
    sourcePath: requiredString(
      aliasValue(record, 'source_path', 'sourcePath'),
      `builtin_program_${index}_source_path`
    ).trim(),
    sourceRevision: requiredString(
      aliasValue(record, 'source_revision', 'sourceRevision'),
      `builtin_program_${index}_source_revision`
    ).trim(),
    sourceSha256: requiredString(
      aliasValue(record, 'source_sha256', 'sourceSha256'),
      `builtin_program_${index}_source_sha256`
    ).trim(),
    sourceBytes: integer(
      aliasValue(record, 'source_bytes', 'sourceBytes'),
      `builtin_program_${index}_source_bytes`
    ),
    sourceNewlineCount: integer(
      aliasValue(record, 'source_newline_count', 'sourceNewlineCount'),
      `builtin_program_${index}_source_newline_count`
    ),
    license: requiredString(record.license, `builtin_program_${index}_license`).trim(),
    licenseSha256: requiredString(
      aliasValue(record, 'license_sha256', 'licenseSha256'),
      `builtin_program_${index}_license_sha256`
    ).trim(),
    attribution: requiredString(record.attribution, `builtin_program_${index}_attribution`).trim(),
    patternCount,
    patterns,
    replacementTemplate: requiredString(
      aliasValue(record, 'replacement_template', 'replacementTemplate'),
      `builtin_program_${index}_replacement_template`
    ),
    readOnly: requiredBoolean(
      aliasValue(record, 'read_only', 'readOnly'),
      `builtin_program_${index}_read_only`
    ),
    executionSupported: requiredBoolean(
      aliasValue(record, 'execution_supported', 'executionSupported'),
      `builtin_program_${index}_execution_supported`
    ),
  };
};

export const emptyResponseTamperConfig = (): ResponseTamperConfig => ({
  enabled: false,
  allowReplacement: false,
  maxBufferBytes: 0,
  assets: [],
  rules: [],
  programs: [],
});

export const normalizeResponseTamperConfig = (value: unknown): ResponseTamperConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseTamperResponseError('config_shape');
  }
  const record = asRecord(value);
  const assets = record.assets ?? [];
  const rules = record.rules ?? [];
  const programs = record.programs ?? [];
  if (!Array.isArray(assets) || !Array.isArray(rules) || !Array.isArray(programs)) {
    throw new ResponseTamperResponseError('collections_shape');
  }
  return {
    enabled: requiredBoolean(record.enabled, 'enabled'),
    allowReplacement: requiredBoolean(
      aliasValue(record, 'allow-replacement', 'allowReplacement') ?? false,
      'allow_replacement'
    ),
    maxBufferBytes: integer(
      aliasValue(record, 'max-buffer-bytes', 'maxBufferBytes'),
      'max_buffer_bytes'
    ),
    assets: assets.map(normalizeAsset),
    rules: rules.map(normalizeRule),
    programs: programs.map(normalizeProgram),
  };
};

const serializeTarget = (target: ResponseTamperTarget | undefined) =>
  target
    ? { type: target.type, ...(target.value?.trim() ? { value: target.value.trim() } : {}) }
    : undefined;

export const serializeResponseTamperConfig = (config: ResponseTamperConfig) => ({
  enabled: config.enabled,
  'allow-replacement': config.allowReplacement,
  ...(config.maxBufferBytes ? { 'max-buffer-bytes': config.maxBufferBytes } : {}),
  assets: config.assets.map((asset) => ({
    id: asset.id.trim(),
    ...(asset.enabled === undefined ? {} : { enabled: asset.enabled }),
    content: asset.content,
    ...(asset.version?.trim() ? { version: asset.version.trim() } : {}),
    ...(asset.source?.trim() ? { source: asset.source.trim() } : {}),
    ...(asset.attribution?.trim() ? { attribution: asset.attribution.trim() } : {}),
    ...(asset.digest?.trim() ? { digest: asset.digest.trim() } : {}),
  })),
  rules: config.rules.map((rule) => ({
    id: rule.id.trim(),
    ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
    ...(rule.priority ? { priority: rule.priority } : {}),
    ...(serializeTarget(rule.target) ? { target: serializeTarget(rule.target) } : {}),
    ...(rule.models.length ? { models: rule.models } : {}),
    trigger: rule.trigger,
    ...(rule.trigger === 'text-regex' && rule.pattern?.trim()
      ? { pattern: rule.pattern.trim() }
      : {}),
    ...(rule.trigger !== 'nerv' && rule.asset?.trim()
      ? { asset: rule.asset.trim() }
      : {}),
    ...(rule.trigger === 'nerv' && rule.program?.trim() ? { program: rule.program.trim() } : {}),
  })),
  programs: config.programs.map((program) => ({
    id: program.id.trim(),
    mode: program.mode,
    ...(program.source?.trim() ? { source: program.source.trim() } : {}),
    ...(program.sourcePath?.trim() ? { 'source-path': program.sourcePath.trim() } : {}),
    ...(program.sourceRevision?.trim() ? { 'source-revision': program.sourceRevision.trim() } : {}),
    ...(program.sourceSha256?.trim() ? { 'source-sha256': program.sourceSha256.trim() } : {}),
    patterns: program.patterns,
    'replacement-template': program.replacementTemplate,
    ...(program.minTextRunes ? { 'min-text-runes': program.minTextRunes } : {}),
  })),
});

export const normalizeResponseTamperMutation = (value: unknown): ResponseTamperMutationEnvelope => {
  const record = asRecord(value);
  const policy = aliasValue(record, 'response-tamper', 'responseTamper');
  if (policy === undefined) throw new ResponseTamperResponseError('missing_policy');
  const revision = requiredString(record.revision, 'revision').trim();
  if (!revision) throw new ResponseTamperResponseError('revision_empty');
  return {
    responseTamper: normalizeResponseTamperConfig(policy),
    revision,
    inventoryId:
      optionalString(aliasValue(record, 'inventory_id', 'inventoryId'), 'inventory_id')?.trim() ??
      '',
    inventoryRevision: integer(
      aliasValue(record, 'inventory_revision', 'inventoryRevision'),
      'inventory_revision'
    ),
  };
};

export const normalizeResponseTamperCatalog = (value: unknown): ResponseTamperCatalog => {
  const record = asRecord(value);
  if (!Array.isArray(record.credentials))
    throw new ResponseTamperResponseError('credentials_shape');
  const providers = stringList(record.providers, 'providers');
  const credentialGroups = stringList(
    aliasValue(record, 'credential_groups', 'credentialGroups'),
    'credential_groups'
  );
  const builtinProgramsValue = aliasValue(record, 'builtin_programs', 'builtinPrograms');
  if (builtinProgramsValue !== undefined && !Array.isArray(builtinProgramsValue)) {
    throw new ResponseTamperResponseError('builtin_programs_shape');
  }
  const builtinPrograms = (builtinProgramsValue ?? []).map(normalizeBuiltinProgram);
  const credentials = record.credentials.map(
    (value, index): ResponseTamperCredentialCatalogEntry => {
      const entry = asRecord(value);
      return {
        id: requiredString(entry.id, `credential_${index}_id`).trim(),
        displayName: requiredString(
          aliasValue(entry, 'display_name', 'displayName'),
          `credential_${index}_display_name`
        ),
        provider: requiredString(entry.provider, `credential_${index}_provider`).trim(),
        groups: stringList(entry.groups, `credential_${index}_groups`),
        status: optionalString(entry.status, `credential_${index}_status`)?.trim() || undefined,
      };
    }
  );
  return {
    builtinPrograms,
    credentials,
    providers,
    credentialGroups,
    revision: requiredString(record.revision, 'revision').trim(),
    activeGeneration: integer(
      aliasValue(record, 'active_generation', 'activeGeneration'),
      'active_generation'
    ),
    inventoryId:
      optionalString(aliasValue(record, 'inventory_id', 'inventoryId'), 'inventory_id')?.trim() ??
      '',
    inventoryRevision: integer(
      aliasValue(record, 'inventory_revision', 'inventoryRevision'),
      'inventory_revision'
    ),
    codexClientOnly: requiredBoolean(
      aliasValue(record, 'codex_client_only', 'codexClientOnly'),
      'codex_client_only'
    ),
    responseFormat: requiredString(
      aliasValue(record, 'response_format', 'responseFormat'),
      'response_format'
    ),
  };
};

export const normalizeResponseTamperPreview = (value: unknown): ResponseTamperPreviewResult => {
  const record = asRecord(value);
  if (typeof record.changed !== 'boolean') throw new ResponseTamperResponseError('preview_shape');
  const events = record.events;
  if (events !== undefined && !Array.isArray(events)) {
    throw new ResponseTamperResponseError('preview_events_shape');
  }
  const trigger =
    record.trigger === undefined || record.trigger === null
      ? undefined
      : normalizeTrigger(record.trigger);
  const programRuleIndexValue = aliasValue(record, 'program_rule_index', 'programRuleIndex');
  return {
    changed: record.changed,
    outcome: requiredString(record.outcome, 'preview_outcome').trim(),
    matchedRule:
      optionalString(aliasValue(record, 'matched_rule', 'matchedRule'), 'matched_rule')?.trim() ||
      undefined,
    assetId:
      optionalString(aliasValue(record, 'asset_id', 'assetId'), 'asset_id')?.trim() || undefined,
    trigger: trigger || undefined,
    inputBytes: integer(aliasValue(record, 'input_bytes', 'inputBytes'), 'input_bytes'),
    outputBytes: integer(aliasValue(record, 'output_bytes', 'outputBytes'), 'output_bytes'),
    matchTextBytes: integer(
      aliasValue(record, 'match_text_bytes', 'matchTextBytes'),
      'match_text_bytes'
    ),
    programId:
      optionalString(aliasValue(record, 'program_id', 'programId'), 'program_id')?.trim() ||
      undefined,
    programRuleIndex:
      programRuleIndexValue === undefined || programRuleIndexValue === null
        ? undefined
        : integer(programRuleIndexValue, 'program_rule_index'),
    ...(Object.prototype.hasOwnProperty.call(record, 'body') ? { body: record.body } : {}),
    ...(events ? { events } : {}),
  };
};

export const responseTamperApi = {
  async get(): Promise<ResponseTamperMutationEnvelope> {
    return normalizeResponseTamperMutation(await apiClient.get('/response-tamper'));
  },

  async catalog(): Promise<ResponseTamperCatalog> {
    return normalizeResponseTamperCatalog(await apiClient.get('/response-tamper/catalog'));
  },

  async save(
    config: ResponseTamperConfig,
    revision: string,
    inventoryId: string,
    inventoryRevision: number
  ): Promise<ResponseTamperMutationEnvelope> {
    return normalizeResponseTamperMutation(
      await apiClient.put(
        '/response-tamper',
        {
          'response-tamper': serializeResponseTamperConfig(config),
          revision,
          inventory_id: inventoryId,
          inventory_revision: inventoryRevision,
        },
        { headers: { 'If-Match': revision } }
      )
    );
  },

  async preview(request: ResponseTamperPreviewRequest): Promise<ResponseTamperPreviewResult> {
    return normalizeResponseTamperPreview(
      await apiClient.post('/response-tamper/preview', {
        ...(request.responseTamper
          ? { 'response-tamper': serializeResponseTamperConfig(request.responseTamper) }
          : {}),
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.events ? { events: request.events } : {}),
        ...(request.model ? { model: request.model } : {}),
        ...(request.authId ? { auth_id: request.authId } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
        ...(request.groups?.length ? { groups: request.groups } : {}),
      })
    );
  },
};
