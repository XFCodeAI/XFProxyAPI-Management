import type { ApiError } from '@/types/api';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

export type DecimalString = string;
export type ModelPriceCoverage = 'priced' | 'partial' | 'unpriced';
export type ModelPriceSyncSource = 'litellm' | 'openrouter';

export interface ModelPriceDimensions {
  inputPerMillion: DecimalString | null;
  outputPerMillion: DecimalString | null;
  reasoningPerMillion: DecimalString | null;
  cacheReadPerMillion: DecimalString | null;
  cacheCreationPerMillion: DecimalString | null;
  fixedRequest: DecimalString | null;
}

export interface ModelPriceMultipliers {
  input: DecimalString | null;
  output: DecimalString | null;
  reasoning: DecimalString | null;
  cacheRead: DecimalString | null;
  cacheCreation: DecimalString | null;
  fixedRequest: DecimalString | null;
}

export interface ModelPriceSource {
  kind: 'manual' | ModelPriceSyncSource;
  manualOverride: boolean;
  model: string | null;
  url: string | null;
  fetchedAt: string | null;
  syncId: string | null;
  version: string | null;
}

export interface ModelPriceRuleInput {
  model: string;
  provider: string;
  serviceTier: string | null;
  contextMinTokens: number | null;
  contextMaxTokens: number | null;
  prices: ModelPriceDimensions;
  multipliers: ModelPriceMultipliers;
}

export interface ModelPriceRule extends ModelPriceRuleInput {
  id: string;
  version: number;
  catalogVersion: number;
  coverage: ModelPriceCoverage;
  missingDimensions: string[];
  source: ModelPriceSource;
  createdAt: string;
  updatedAt: string;
  used: boolean;
  requestCount: number;
  estimatedCost: DecimalString | null;
}

export interface UnpricedModel {
  model: string;
  provider: string;
  requestedModel: string | null;
  requestCount: number;
  reason: string;
  missingDimensions: string[];
}

export interface ModelPriceSummary {
  ruleCount: number;
  usedModelCount: number;
  unpricedModelCount: number;
  estimatedCost: DecimalString | null;
  currency: string;
  truncated: boolean;
}

export interface ModelPriceCatalogAvailable {
  available: true;
  generatedAt: string;
  lastSyncAt: string | null;
  catalogVersion: number;
  summary: ModelPriceSummary;
  rules: ModelPriceRule[];
  unpricedModels: UnpricedModel[];
}

export interface ModelPriceCatalogUnavailable {
  available: false;
  reason: string;
}

export type ModelPriceCatalog = ModelPriceCatalogAvailable | ModelPriceCatalogUnavailable;

export interface ModelPriceSyncSourceResult {
  source: string;
  status: string;
  fetchedCount: number;
  candidateCount: number;
  rejectedCount: number;
  error: string | null;
}

export interface ModelPriceSyncCandidate {
  id: string;
  targetProvider: string;
  targetModel: string;
  status: string;
  reason: string | null;
  ambiguityReason: string | null;
  rejectionReason: string | null;
  source: string;
  sourceModelId: string;
  rule: ModelPriceRuleInput;
}

export interface ModelPriceSyncRejection {
  source: string;
  sourceModelId: string;
  targetModel: string | null;
  reason: string;
}

export interface ModelPriceSyncPreview {
  previewId: string;
  stale: boolean;
  expiresAt: string | null;
  sourceResults: ModelPriceSyncSourceResult[];
  candidates: ModelPriceSyncCandidate[];
  rejected: ModelPriceSyncRejection[];
}

export interface ModelPriceSyncApplyResult {
  applied: true;
  appliedCount: number;
  skippedCount: number;
}

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const invalidResponse = (context: string): never => {
  throw new Error(`model_prices_invalid_response:${context}`);
};

const requireRecord = (value: unknown, context: string): Record<string, unknown> =>
  isRecord(value) ? value : invalidResponse(context);

const requireString = (record: Record<string, unknown>, key: string, context: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) return invalidResponse(`${context}.${key}`);
  return value.trim();
};

const readNullableString = (
  record: Record<string, unknown>,
  key: string,
  context: string,
  required = false
): string | null => {
  if (!hasOwn(record, key)) {
    return required ? invalidResponse(`${context}.${key}`) : null;
  }
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string') return invalidResponse(`${context}.${key}`);
  return value.trim() || null;
};

const requireBoolean = (record: Record<string, unknown>, key: string, context: string): boolean => {
  const value = record[key];
  return typeof value === 'boolean' ? value : invalidResponse(`${context}.${key}`);
};

const requireCount = (record: Record<string, unknown>, key: string, context: string): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidResponse(`${context}.${key}`);
};

const requireVersion = (record: Record<string, unknown>, key: string, context: string): number => {
  const value = requireCount(record, key, context);
  return value >= 1 ? value : invalidResponse(`${context}.${key}`);
};

const readNullableInteger = (
  record: Record<string, unknown>,
  key: string,
  context: string
): number | null => {
  if (!hasOwn(record, key)) return invalidResponse(`${context}.${key}`);
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidResponse(`${context}.${key}`);
};

const readNullableDecimal = (
  record: Record<string, unknown>,
  key: string,
  context: string
): DecimalString | null => {
  if (!hasOwn(record, key)) return invalidResponse(`${context}.${key}`);
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value.trim())) {
    return invalidResponse(`${context}.${key}`);
  }
  return value.trim();
};

const readStringArray = (
  record: Record<string, unknown>,
  key: string,
  context: string,
  required = false
): string[] => {
  if (!hasOwn(record, key)) {
    return required ? invalidResponse(`${context}.${key}`) : [];
  }
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return invalidResponse(`${context}.${key}`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
};

const requireArray = (record: Record<string, unknown>, key: string, context: string): unknown[] => {
  const value = record[key];
  return Array.isArray(value) ? value : invalidResponse(`${context}.${key}`);
};

const normalizeDimensions = (value: unknown, context: string): ModelPriceDimensions => {
  const record = requireRecord(value, context);
  return {
    inputPerMillion: readNullableDecimal(record, 'input_per_million', context),
    outputPerMillion: readNullableDecimal(record, 'output_per_million', context),
    reasoningPerMillion: readNullableDecimal(record, 'reasoning_per_million', context),
    cacheReadPerMillion: readNullableDecimal(record, 'cache_read_per_million', context),
    cacheCreationPerMillion: readNullableDecimal(record, 'cache_creation_per_million', context),
    fixedRequest: readNullableDecimal(record, 'fixed_request', context),
  };
};

const normalizeMultipliers = (value: unknown, context: string): ModelPriceMultipliers => {
  const record = requireRecord(value, context);
  return {
    input: readNullableDecimal(record, 'input', context),
    output: readNullableDecimal(record, 'output', context),
    reasoning: readNullableDecimal(record, 'reasoning', context),
    cacheRead: readNullableDecimal(record, 'cache_read', context),
    cacheCreation: readNullableDecimal(record, 'cache_creation', context),
    fixedRequest: readNullableDecimal(record, 'fixed_request', context),
  };
};

const normalizeSource = (value: unknown, context: string): ModelPriceSource => {
  const record = requireRecord(value, context);
  const kind = requireString(record, 'kind', context);
  if (kind !== 'manual' && kind !== 'litellm' && kind !== 'openrouter') {
    return invalidResponse(`${context}.kind`);
  }
  return {
    kind,
    manualOverride: requireBoolean(record, 'manual_override', context),
    model: readNullableString(record, 'model', context),
    url: readNullableString(record, 'url', context),
    fetchedAt: readNullableString(record, 'fetched_at', context),
    syncId: readNullableString(record, 'sync_id', context),
    version: readNullableString(record, 'version', context),
  };
};

const normalizeRuleInput = (value: unknown, context: string): ModelPriceRuleInput => {
  const record = requireRecord(value, context);
  return {
    model: requireString(record, 'model', context),
    provider: requireString(record, 'provider', context),
    serviceTier: readNullableString(record, 'service_tier', context, true),
    contextMinTokens: readNullableInteger(record, 'context_min_tokens', context),
    contextMaxTokens: readNullableInteger(record, 'context_max_tokens', context),
    prices: normalizeDimensions(record.prices, `${context}.prices`),
    multipliers: normalizeMultipliers(record.multipliers, `${context}.multipliers`),
  };
};

const normalizeCoverage = (value: unknown, context: string): ModelPriceCoverage => {
  if (value === 'priced' || value === 'partial' || value === 'unpriced') return value;
  return invalidResponse(`${context}.coverage`);
};

export const normalizeModelPriceRule = (value: unknown, context = 'rule'): ModelPriceRule => {
  const record = requireRecord(value, context);
  return {
    id: requireString(record, 'id', context),
    ...normalizeRuleInput(record, context),
    version: requireVersion(record, 'version', context),
    catalogVersion: requireVersion(record, 'catalog_version', context),
    coverage: normalizeCoverage(record.coverage, context),
    missingDimensions: readStringArray(record, 'missing_dimensions', context),
    source: normalizeSource(record.source, `${context}.source`),
    createdAt: requireString(record, 'created_at', context),
    updatedAt: requireString(record, 'updated_at', context),
    used: requireBoolean(record, 'used', context),
    requestCount: requireCount(record, 'request_count', context),
    estimatedCost: readNullableDecimal(record, 'estimated_cost', context),
  };
};

const normalizeUnpricedModel = (value: unknown, context: string): UnpricedModel => {
  const record = requireRecord(value, context);
  return {
    model: requireString(record, 'model', context),
    provider: requireString(record, 'provider', context),
    requestedModel: readNullableString(record, 'requested_model', context),
    requestCount: requireCount(record, 'request_count', context),
    reason: requireString(record, 'reason', context),
    missingDimensions: readStringArray(record, 'missing_dimensions', context),
  };
};

const normalizeSummary = (value: unknown): ModelPriceSummary => {
  const record = requireRecord(value, 'summary');
  return {
    ruleCount: requireCount(record, 'rule_count', 'summary'),
    usedModelCount: requireCount(record, 'used_model_count', 'summary'),
    unpricedModelCount: requireCount(record, 'unpriced_model_count', 'summary'),
    estimatedCost: readNullableDecimal(record, 'estimated_cost', 'summary'),
    currency: requireString(record, 'currency', 'summary').toUpperCase(),
    truncated: requireBoolean(record, 'truncated', 'summary'),
  };
};

export const normalizeModelPriceCatalogResponse = (value: unknown): ModelPriceCatalog => {
  const record = requireRecord(value, 'catalog');
  if (record.available === false) {
    return {
      available: false,
      reason: readNullableString(record, 'reason', 'catalog') ?? 'capability_unavailable',
    };
  }
  if (record.available !== true) return invalidResponse('catalog.available');

  return {
    available: true,
    generatedAt: requireString(record, 'generated_at', 'catalog'),
    lastSyncAt: readNullableString(record, 'last_sync_at', 'catalog'),
    catalogVersion: requireCount(record, 'catalog_version', 'catalog'),
    summary: normalizeSummary(record.summary),
    rules: requireArray(record, 'rules', 'catalog').map((entry, index) =>
      normalizeModelPriceRule(entry, `catalog.rules[${index}]`)
    ),
    unpricedModels: requireArray(record, 'unpriced_models', 'catalog').map((entry, index) =>
      normalizeUnpricedModel(entry, `catalog.unpriced_models[${index}]`)
    ),
  };
};

export const normalizeModelPriceRuleResponse = (value: unknown): ModelPriceRule => {
  const record = requireRecord(value, 'mutation');
  return normalizeModelPriceRule(record.rule, 'mutation.rule');
};

const normalizeSyncSourceResult = (value: unknown, context: string): ModelPriceSyncSourceResult => {
  const record = requireRecord(value, context);
  return {
    source: requireString(record, 'source', context),
    status: requireString(record, 'status', context),
    fetchedCount: requireCount(record, 'fetched_count', context),
    candidateCount: requireCount(record, 'candidate_count', context),
    rejectedCount: requireCount(record, 'rejected_count', context),
    error: readNullableString(record, 'error', context),
  };
};

const normalizeSyncCandidate = (value: unknown, context: string): ModelPriceSyncCandidate => {
  const record = requireRecord(value, context);
  return {
    id: requireString(record, 'id', context),
    targetProvider: requireString(record, 'target_provider', context),
    targetModel: requireString(record, 'target_model', context),
    status: requireString(record, 'status', context),
    reason: readNullableString(record, 'reason', context),
    ambiguityReason: readNullableString(record, 'ambiguity_reason', context),
    rejectionReason: readNullableString(record, 'rejection_reason', context),
    source: requireString(record, 'source', context),
    sourceModelId: requireString(record, 'source_model_id', context),
    rule: normalizeRuleInput(record.rule, `${context}.rule`),
  };
};

const normalizeSyncRejection = (value: unknown, context: string): ModelPriceSyncRejection => {
  const record = requireRecord(value, context);
  return {
    source: requireString(record, 'source', context),
    sourceModelId: requireString(record, 'source_model_id', context),
    targetModel: readNullableString(record, 'target_model', context),
    reason: requireString(record, 'reason', context),
  };
};

export const normalizeModelPriceSyncPreviewResponse = (value: unknown): ModelPriceSyncPreview => {
  const record = requireRecord(value, 'preview');
  return {
    previewId: requireString(record, 'preview_id', 'preview'),
    stale: requireBoolean(record, 'stale', 'preview'),
    expiresAt: readNullableString(record, 'expires_at', 'preview'),
    sourceResults: requireArray(record, 'source_results', 'preview').map((entry, index) =>
      normalizeSyncSourceResult(entry, `preview.source_results[${index}]`)
    ),
    candidates: requireArray(record, 'candidates', 'preview').map((entry, index) =>
      normalizeSyncCandidate(entry, `preview.candidates[${index}]`)
    ),
    rejected: requireArray(record, 'rejected', 'preview').map((entry, index) =>
      normalizeSyncRejection(entry, `preview.rejected[${index}]`)
    ),
  };
};

export const normalizeModelPriceSyncApplyResponse = (value: unknown): ModelPriceSyncApplyResult => {
  const record = requireRecord(value, 'apply');
  if (record.applied !== true) return invalidResponse('apply.applied');
  return {
    applied: true,
    appliedCount: requireCount(record, 'applied_count', 'apply'),
    skippedCount: requireCount(record, 'skipped_count', 'apply'),
  };
};

export const normalizeModelPriceDeleteResponse = (value: unknown, expectedID: string): string => {
  const record = requireRecord(value, 'delete');
  if (record.deleted !== true) return invalidResponse('delete.deleted');
  const id = requireString(record, 'id', 'delete');
  if (id !== expectedID) return invalidResponse('delete.id');
  return id;
};

const toDimensionsPayload = (dimensions: ModelPriceDimensions) => ({
  input_per_million: dimensions.inputPerMillion,
  output_per_million: dimensions.outputPerMillion,
  reasoning_per_million: dimensions.reasoningPerMillion,
  cache_read_per_million: dimensions.cacheReadPerMillion,
  cache_creation_per_million: dimensions.cacheCreationPerMillion,
  fixed_request: dimensions.fixedRequest,
});

const toMultipliersPayload = (multipliers: ModelPriceMultipliers) => ({
  input: multipliers.input,
  output: multipliers.output,
  reasoning: multipliers.reasoning,
  cache_read: multipliers.cacheRead,
  cache_creation: multipliers.cacheCreation,
  fixed_request: multipliers.fixedRequest,
});

const toRulePayload = (input: ModelPriceRuleInput, expectedVersion?: number) => ({
  model: input.model,
  provider: input.provider,
  service_tier: input.serviceTier,
  context_min_tokens: input.contextMinTokens,
  context_max_tokens: input.contextMaxTokens,
  prices: toDimensionsPayload(input.prices),
  multipliers: toMultipliersPayload(input.multipliers),
  ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion }),
});

const withExpectedVersion = (path: string, expectedVersion: number): string =>
  `${path}?expected_version=${encodeURIComponent(String(expectedVersion))}`;

export const isModelPricesCapabilityUnavailable = (error: unknown): boolean => {
  const status = (error as ApiError | null)?.status;
  return status === 404 || status === 405 || status === 501;
};

const BASE_PATH = '/usage-analytics/model-prices';

export const modelPricesApi = {
  getCatalog: async (): Promise<ModelPriceCatalog> =>
    normalizeModelPriceCatalogResponse(await apiClient.get(BASE_PATH)),

  createRule: async (input: ModelPriceRuleInput): Promise<ModelPriceRule> =>
    normalizeModelPriceRuleResponse(await apiClient.post(BASE_PATH, toRulePayload(input))),

  updateRule: async (
    id: string,
    expectedVersion: number,
    input: ModelPriceRuleInput
  ): Promise<ModelPriceRule> =>
    normalizeModelPriceRuleResponse(
      await apiClient.put(
        withExpectedVersion(`${BASE_PATH}/${encodeURIComponent(id)}`, expectedVersion),
        toRulePayload(input, expectedVersion)
      )
    ),

  deleteRule: async (id: string, expectedVersion: number): Promise<string> =>
    normalizeModelPriceDeleteResponse(
      await apiClient.delete(
        withExpectedVersion(`${BASE_PATH}/${encodeURIComponent(id)}`, expectedVersion)
      ),
      id
    ),

  previewSync: async (sources: ModelPriceSyncSource[]): Promise<ModelPriceSyncPreview> =>
    normalizeModelPriceSyncPreviewResponse(
      await apiClient.post(`${BASE_PATH}/sync/preview`, { sources })
    ),

  applySync: async (
    previewId: string,
    acceptedCandidateIds: string[]
  ): Promise<ModelPriceSyncApplyResult> =>
    normalizeModelPriceSyncApplyResponse(
      await apiClient.post(`${BASE_PATH}/sync/apply`, {
        preview_id: previewId,
        accepted_candidate_ids: acceptedCandidateIds,
      })
    ),
};
