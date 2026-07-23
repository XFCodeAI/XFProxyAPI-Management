import type {
  ModelPriceCatalogAvailable,
  ModelPriceEntry,
  ModelPriceRule,
  ModelPriceRuleInput,
  ModelPriceSyncCandidate,
} from '@/services/api/modelPrices';

export type ModelPriceFilter = 'all' | 'used' | 'unpriced';
export type DecimalDisplayKind = 'missing' | 'free' | 'value';

export interface ModelPriceRow {
  key: string;
  model: string;
  provider: string;
  used: boolean;
  requestCount: number;
  unpriced: boolean;
  source: string | null;
  sourceModelId: string | null;
  entry: ModelPriceEntry;
}

export interface ModelPriceDraft {
  model: string;
  provider: string;
  serviceTier: string;
  contextMinTokens: string;
  contextMaxTokens: string;
  inputPerMillion: string;
  outputPerMillion: string;
  reasoningPerMillion: string;
  cacheReadPerMillion: string;
  cacheCreationPerMillion: string;
  fixedRequest: string;
  inputMultiplier: string;
  outputMultiplier: string;
  reasoningMultiplier: string;
  cacheReadMultiplier: string;
  cacheCreationMultiplier: string;
  fixedRequestMultiplier: string;
}

export type ModelPriceDraftErrors = Partial<
  Record<keyof ModelPriceDraft | 'prices' | 'contextRange', string>
>;

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DECIMAL_FIELDS: Array<keyof ModelPriceDraft> = [
  'inputPerMillion',
  'outputPerMillion',
  'reasoningPerMillion',
  'cacheReadPerMillion',
  'cacheCreationPerMillion',
  'fixedRequest',
  'inputMultiplier',
  'outputMultiplier',
  'reasoningMultiplier',
  'cacheReadMultiplier',
  'cacheCreationMultiplier',
  'fixedRequestMultiplier',
];
const PRICE_FIELDS: Array<keyof ModelPriceDraft> = [
  'inputPerMillion',
  'outputPerMillion',
  'reasoningPerMillion',
  'cacheReadPerMillion',
  'cacheCreationPerMillion',
  'fixedRequest',
];

const MULTIPLIER_PRICE_FIELDS: Array<[keyof ModelPriceDraft, keyof ModelPriceDraft]> = [
  ['inputMultiplier', 'inputPerMillion'],
  ['outputMultiplier', 'outputPerMillion'],
  ['reasoningMultiplier', 'reasoningPerMillion'],
  ['cacheReadMultiplier', 'cacheReadPerMillion'],
  ['cacheCreationMultiplier', 'cacheCreationPerMillion'],
  ['fixedRequestMultiplier', 'fixedRequest'],
];

export const createModelPriceDraft = (rule?: ModelPriceRule): ModelPriceDraft => ({
  model: rule?.model ?? '',
  provider: rule?.provider ?? '',
  serviceTier: rule?.serviceTier ?? '',
  contextMinTokens: rule?.contextMinTokens?.toString() ?? '',
  contextMaxTokens: rule?.contextMaxTokens?.toString() ?? '',
  inputPerMillion: rule?.prices.inputPerMillion ?? '',
  outputPerMillion: rule?.prices.outputPerMillion ?? '',
  reasoningPerMillion: rule?.prices.reasoningPerMillion ?? '',
  cacheReadPerMillion: rule?.prices.cacheReadPerMillion ?? '',
  cacheCreationPerMillion: rule?.prices.cacheCreationPerMillion ?? '',
  fixedRequest: rule?.prices.fixedRequest ?? '',
  inputMultiplier: rule?.multipliers.input ?? '',
  outputMultiplier: rule?.multipliers.output ?? '',
  reasoningMultiplier: rule?.multipliers.reasoning ?? '',
  cacheReadMultiplier: rule?.multipliers.cacheRead ?? '',
  cacheCreationMultiplier: rule?.multipliers.cacheCreation ?? '',
  fixedRequestMultiplier: rule?.multipliers.fixedRequest ?? '',
});

export const validateModelPriceDraft = (draft: ModelPriceDraft): ModelPriceDraftErrors => {
  const errors: ModelPriceDraftErrors = {};
  if (!draft.model.trim()) errors.model = 'required';
  if (!draft.provider.trim()) errors.provider = 'provider_required';

  DECIMAL_FIELDS.forEach((field) => {
    const value = draft[field].trim();
    if (value && !DECIMAL_PATTERN.test(value)) errors[field] = 'decimal';
  });

  if (!PRICE_FIELDS.some((field) => draft[field].trim())) errors.prices = 'price_required';

  const contextValues = [draft.contextMinTokens.trim(), draft.contextMaxTokens.trim()];
  contextValues.forEach((value, index) => {
    const field = index === 0 ? 'contextMinTokens' : 'contextMaxTokens';
    if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      errors[field] = 'integer';
    }
  });
  if (
    !errors.contextMinTokens &&
    !errors.contextMaxTokens &&
    contextValues[0] &&
    contextValues[1] &&
    Number(contextValues[0]) > Number(contextValues[1])
  ) {
    errors.contextRange = 'context_range';
  }

  MULTIPLIER_PRICE_FIELDS.forEach(([multiplierField, priceField]) => {
    if (draft[multiplierField].trim() && !draft[priceField].trim()) {
      errors[multiplierField] = 'base_price_required';
    }
  });

  return errors;
};

const nullable = (value: string): string | null => value.trim() || null;
const nullableInteger = (value: string): number | null => {
  const normalized = value.trim();
  return normalized ? Number(normalized) : null;
};

export const buildModelPriceRuleInput = (draft: ModelPriceDraft): ModelPriceRuleInput | null => {
  if (Object.keys(validateModelPriceDraft(draft)).length > 0) return null;
  return {
    model: draft.model.trim(),
    provider: draft.provider.trim(),
    serviceTier: nullable(draft.serviceTier),
    contextMinTokens: nullableInteger(draft.contextMinTokens),
    contextMaxTokens: nullableInteger(draft.contextMaxTokens),
    prices: {
      inputPerMillion: nullable(draft.inputPerMillion),
      outputPerMillion: nullable(draft.outputPerMillion),
      reasoningPerMillion: nullable(draft.reasoningPerMillion),
      cacheReadPerMillion: nullable(draft.cacheReadPerMillion),
      cacheCreationPerMillion: nullable(draft.cacheCreationPerMillion),
      fixedRequest: nullable(draft.fixedRequest),
    },
    multipliers: {
      input: nullable(draft.inputMultiplier),
      output: nullable(draft.outputMultiplier),
      reasoning: nullable(draft.reasoningMultiplier),
      cacheRead: nullable(draft.cacheReadMultiplier),
      cacheCreation: nullable(draft.cacheCreationMultiplier),
      fixedRequest: nullable(draft.fixedRequestMultiplier),
    },
  };
};

export const buildModelPriceRows = (catalog: ModelPriceCatalogAvailable): ModelPriceRow[] => {
  const rowsByIdentity = new Map<string, ModelPriceRow>();
  catalog.entries.forEach((entry) => {
    const key = `${entry.provider}\0${entry.model}`;
    if (rowsByIdentity.has(key)) return;
    const rules = [entry.default, ...entry.variants, ...entry.conflicts].filter(
      (rule): rule is ModelPriceRule => rule !== null
    );
    const sources = [...new Set(rules.map((rule) => rule.source.kind))];
    const sourceModels = rules.map((rule) => rule.source.model).filter(Boolean);
    rowsByIdentity.set(key, {
      key,
      model: entry.model,
      provider: entry.provider,
      used: entry.used,
      requestCount: entry.requestCount,
      unpriced: entry.coverage !== 'priced',
      source: sources.length === 1 ? sources[0] : sources.length > 1 ? 'mixed' : null,
      sourceModelId: sourceModels[0] ?? null,
      entry,
    });
  });

  const rows = [...rowsByIdentity.values()];

  return rows.sort(
    (left, right) =>
      Number(right.unpriced) - Number(left.unpriced) ||
      Number(right.used) - Number(left.used) ||
      right.requestCount - left.requestCount ||
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model)
  );
};

export const filterModelPriceRows = (
  rows: ModelPriceRow[],
  filter: ModelPriceFilter,
  search: string
): ModelPriceRow[] => {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'used' && !row.used) return false;
    if (filter === 'unpriced' && !row.unpriced) return false;
    if (!query) return true;
    const rules = [row.entry.default, ...row.entry.variants, ...row.entry.conflicts].filter(
      (rule): rule is ModelPriceRule => rule !== null
    );
    return [
      row.model,
      row.provider,
      row.source,
      row.sourceModelId,
      ...row.entry.requestedModels,
      ...rules.flatMap((rule) => [
        rule.serviceTier,
        rule.source.kind,
        rule.source.provider,
        rule.source.model,
      ]),
    ].some((value) => value?.toLowerCase().includes(query));
  });
};

export const getDecimalDisplayKind = (value: string | null): DecimalDisplayKind => {
  if (value === null) return 'missing';
  return /^0(?:\.0+)?$/.test(value) ? 'free' : 'value';
};

export const canAcceptSyncCandidate = (candidate: ModelPriceSyncCandidate): boolean =>
  (candidate.status === 'ready' || candidate.status === 'ambiguous') && !candidate.rejectionReason;

export const toggleAcceptedCandidate = (
  selected: ReadonlySet<string>,
  candidate: ModelPriceSyncCandidate,
  candidates: ModelPriceSyncCandidate[]
): Set<string> => {
  const next = new Set(selected);
  if (next.has(candidate.id)) {
    next.delete(candidate.id);
    return next;
  }
  if (!canAcceptSyncCandidate(candidate)) return next;
  candidates.forEach((entry) => {
    if (
      entry.targetProvider === candidate.targetProvider &&
      entry.targetModel === candidate.targetModel
    ) {
      next.delete(entry.id);
    }
  });
  next.add(candidate.id);
  return next;
};
