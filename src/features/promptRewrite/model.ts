import type {
  PromptRewriteAsset,
  PromptRewriteBuiltinAsset,
  PromptRewriteConfig,
  PromptRewriteMatch,
  PromptRewriteRule,
  PromptRewriteTargetType,
} from '@/types';

export const emptyPromptRewriteMatch = (): PromptRewriteMatch => ({
  models: [],
  requestedModels: [],
  requestPaths: [],
  input: { exact: [], contains: [], suffixes: [] },
});

export const clonePromptRewriteConfig = (config: PromptRewriteConfig): PromptRewriteConfig =>
  structuredClone(config);

const missingPromptRewriteValue = Symbol('missing-prompt-rewrite-value');
type PromptRewriteMergeValue = unknown | typeof missingPromptRewriteValue;

const isPromptRewriteRecord = (value: PromptRewriteMergeValue): value is Record<string, unknown> =>
  value !== missingPromptRewriteValue &&
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value);

const promptRewriteValuesEqual = (
  left: PromptRewriteMergeValue,
  right: PromptRewriteMergeValue
): boolean => {
  if (left === missingPromptRewriteValue || right === missingPromptRewriteValue) {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
};

const clonePromptRewriteMergeValue = (value: PromptRewriteMergeValue): PromptRewriteMergeValue =>
  value === missingPromptRewriteValue ? value : structuredClone(value);

const hasPromptRewriteField = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

export const mergePolicyValue = (
  base: PromptRewriteMergeValue,
  draft: PromptRewriteMergeValue,
  latest: PromptRewriteMergeValue,
  path: string,
  conflicts: string[]
): PromptRewriteMergeValue => {
  if (promptRewriteValuesEqual(draft, base)) return clonePromptRewriteMergeValue(latest);
  if (promptRewriteValuesEqual(latest, base) || promptRewriteValuesEqual(draft, latest)) {
    return clonePromptRewriteMergeValue(draft);
  }
  if (
    isPromptRewriteRecord(base) &&
    isPromptRewriteRecord(draft) &&
    isPromptRewriteRecord(latest)
  ) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(draft), ...Object.keys(latest)]);
    keys.forEach((key) => {
      const value = mergePolicyValue(
        hasPromptRewriteField(base, key) ? base[key] : missingPromptRewriteValue,
        hasPromptRewriteField(draft, key) ? draft[key] : missingPromptRewriteValue,
        hasPromptRewriteField(latest, key) ? latest[key] : missingPromptRewriteValue,
        `${path}.${key}`,
        conflicts
      );
      if (value !== missingPromptRewriteValue) merged[key] = value;
    });
    return merged;
  }
  conflicts.push(path);
  return clonePromptRewriteMergeValue(draft);
};

export const mergePolicyCollection = <T>(
  base: readonly T[],
  draft: readonly T[],
  latest: readonly T[],
  identityOf: (item: T) => string,
  path: string,
  conflicts: string[]
): T[] => {
  const index = (items: readonly T[]): Map<string, T> | null => {
    const values = new Map<string, T>();
    for (const item of items) {
      const identity = identityOf(item).trim().toLowerCase();
      if (!identity || values.has(identity)) return null;
      values.set(identity, item);
    }
    return values;
  };
  const baseIndex = index(base);
  const draftIndex = index(draft);
  const latestIndex = index(latest);
  if (!baseIndex || !draftIndex || !latestIndex) {
    return mergePolicyValue(base, draft, latest, path, conflicts) as T[];
  }

  const merged = new Map<string, T>();
  const identities = new Set([...baseIndex.keys(), ...draftIndex.keys(), ...latestIndex.keys()]);
  identities.forEach((identity) => {
    const value = mergePolicyValue(
      baseIndex.get(identity) ?? missingPromptRewriteValue,
      draftIndex.get(identity) ?? missingPromptRewriteValue,
      latestIndex.get(identity) ?? missingPromptRewriteValue,
      `${path}[${identity}]`,
      conflicts
    );
    if (value !== missingPromptRewriteValue) merged.set(identity, value as T);
  });

  const identitiesOf = (items: readonly T[]) =>
    items.map((item) => identityOf(item).trim().toLowerCase());
  const baseOrder = identitiesOf(base);
  const draftOrder = identitiesOf(draft);
  const latestOrder = identitiesOf(latest);
  const draftOrderChanged = !promptRewriteValuesEqual(draftOrder, baseOrder);
  const latestOrderChanged = !promptRewriteValuesEqual(latestOrder, baseOrder);
  let preferredOrder = latestOrder;
  let secondaryOrder = draftOrder;
  if (draftOrderChanged) {
    preferredOrder = draftOrder;
    secondaryOrder = latestOrder;
  }
  if (
    draftOrderChanged &&
    latestOrderChanged &&
    !promptRewriteValuesEqual(draftOrder, latestOrder)
  ) {
    conflicts.push(`${path}.order`);
  }

  const result: T[] = [];
  const appended = new Set<string>();
  [...preferredOrder, ...secondaryOrder, ...baseOrder].forEach((identity) => {
    const value = merged.get(identity);
    if (!value || appended.has(identity)) return;
    appended.add(identity);
    result.push(value);
  });
  return result;
};

export interface PromptRewriteRebaseResult {
  config: PromptRewriteConfig;
  conflicts: string[];
}

export const rebasePromptRewriteConfig = (
  base: PromptRewriteConfig,
  draft: PromptRewriteConfig,
  latest: PromptRewriteConfig
): PromptRewriteRebaseResult => {
  const conflicts: string[] = [];
  const field = <T>(baseValue: T, draftValue: T, latestValue: T, path: string): T =>
    mergePolicyValue(baseValue, draftValue, latestValue, path, conflicts) as T;
  const config: PromptRewriteConfig = {
    enabled: field(base.enabled, draft.enabled, latest.enabled, 'enabled'),
    allowReplace: field(base.allowReplace, draft.allowReplace, latest.allowReplace, 'allowReplace'),
    evaluation: field(base.evaluation, draft.evaluation, latest.evaluation, 'evaluation'),
    builtinOverrides: mergePolicyCollection(
      base.builtinOverrides,
      draft.builtinOverrides,
      latest.builtinOverrides,
      (source) => source.asset,
      'builtinOverrides',
      conflicts
    ),
    remoteSources: mergePolicyCollection(
      base.remoteSources,
      draft.remoteSources,
      latest.remoteSources,
      (source) => source.asset,
      'remoteSources',
      conflicts
    ),
    builtinCache: mergePolicyCollection(
      base.builtinCache,
      draft.builtinCache,
      latest.builtinCache,
      (source) => source.asset,
      'builtinCache',
      conflicts
    ),
    assets: mergePolicyCollection(
      base.assets,
      draft.assets,
      latest.assets,
      (asset) => asset.id,
      'assets',
      conflicts
    ),
    profiles: mergePolicyCollection(
      base.profiles,
      draft.profiles,
      latest.profiles,
      (profile) => profile.id,
      'profiles',
      conflicts
    ),
    rules: mergePolicyCollection(
      base.rules,
      draft.rules,
      latest.rules,
      (rule) => rule.name,
      'rules',
      conflicts
    ),
  };
  return { config, conflicts: [...new Set(conflicts)] };
};

export const splitPromptRewriteValues = (value: string): string[] => {
  const seen = new Set<string>();
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const joinPromptRewriteValues = (values: readonly string[]): string => values.join('\n');

export const createUniquePromptRewriteId = (
  prefix: string,
  existing: readonly string[]
): string => {
  const normalized = new Set(existing.map((value) => value.toLowerCase()));
  let index = 1;
  let candidate = prefix;
  while (normalized.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${prefix}-${index}`;
  }
  return candidate;
};

export const isBuiltinPromptRewriteAssetID = (id: string): boolean =>
  id.trim().toLowerCase().startsWith('builtin:');

export const createManagedAssetFromBuiltin = (
  builtin: PromptRewriteBuiltinAsset,
  existingIds: readonly string[]
): PromptRewriteAsset => {
  const baseId =
    builtin.id
      .replace(/^builtin:/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'prompt-asset';
  return {
    id: createUniquePromptRewriteId(baseId, existingIds),
    enabled: true,
    content: builtin.content,
    version: builtin.version,
    source: builtin.source,
    attribution: `${builtin.attribution} (${builtin.license})`,
  };
};

export const createPromptRewriteRule = (
  name: string,
  targetType: PromptRewriteTargetType = 'global',
  targetValue = '',
  assetId = ''
): PromptRewriteRule => ({
  name,
  enabled: true,
  priority: 0,
  target:
    targetType === 'global'
      ? undefined
      : {
          type: targetType,
          value: targetValue,
        },
  mode: 'append',
  ...(assetId ? { asset: assetId } : { prompt: 'New managed instruction' }),
  match: emptyPromptRewriteMatch(),
});

export interface PromptRewriteIssue {
  scope: 'asset' | 'source' | 'profile' | 'rule' | 'document';
  owner: string;
  message: string;
}

export const validatePromptRewriteDraft = (
  config: PromptRewriteConfig,
  builtinAssets: readonly PromptRewriteBuiltinAsset[] = []
): PromptRewriteIssue[] => {
  const issues: PromptRewriteIssue[] = [];
  const assetIds = new Map<string, PromptRewriteAsset>();
  const availableAssets = new Map<string, { enabled?: boolean }>();
  builtinAssets.forEach((asset) => availableAssets.set(asset.id.toLowerCase(), { enabled: true }));
  const builtinAssetIds = new Set(builtinAssets.map((asset) => asset.id.toLowerCase()));
  const validateSources = (
    layer: 'override' | 'remote' | 'cache',
    sources: PromptRewriteConfig['builtinOverrides']
  ) => {
    const seen = new Set<string>();
    sources.forEach((source) => {
      const owner = source.asset.trim();
      const key = owner.toLowerCase();
      if (!builtinAssetIds.has(key)) {
        issues.push({ scope: 'source', owner, message: `Unknown built-in asset: ${owner}` });
      }
      if (seen.has(key)) {
        issues.push({ scope: 'source', owner, message: `Duplicate ${layer} source.` });
      }
      seen.add(key);
      if (!source.content.trim()) {
        issues.push({ scope: 'source', owner, message: `${layer} content is required.` });
      }
      if (layer !== 'override') {
        if (!source.sourceURL?.trim() || !source.importedAt?.trim()) {
          issues.push({
            scope: 'source',
            owner,
            message: `${layer} URL and import time are required.`,
          });
        }
        if (!source.sourceRevision?.trim() && !source.etag?.trim()) {
          issues.push({ scope: 'source', owner, message: `${layer} commit or ETag is required.` });
        }
        if (source.licenseStatus !== 'approved') {
          issues.push({ scope: 'source', owner, message: `${layer} license must be approved.` });
        }
      }
    });
  };
  validateSources('override', config.builtinOverrides);
  validateSources('remote', config.remoteSources);
  validateSources('cache', config.builtinCache);
  config.assets.forEach((asset) => {
    const id = asset.id.trim();
    if (!id) issues.push({ scope: 'asset', owner: '', message: 'Asset ID is required.' });
    if (isBuiltinPromptRewriteAssetID(id)) {
      issues.push({ scope: 'asset', owner: id, message: 'The builtin: namespace is reserved.' });
    }
    if (!asset.content.trim()) {
      issues.push({ scope: 'asset', owner: id, message: 'Asset content is required.' });
    }
    const key = id.toLowerCase();
    if (key && assetIds.has(key)) {
      issues.push({ scope: 'asset', owner: id, message: 'Asset ID must be unique.' });
    }
    if (key) assetIds.set(key, asset);
    if (key && !isBuiltinPromptRewriteAssetID(key)) availableAssets.set(key, asset);
  });

  const profileIds = new Set<string>();
  config.profiles.forEach((profile) => {
    const id = profile.id.trim();
    const key = id.toLowerCase();
    if (!id) issues.push({ scope: 'profile', owner: '', message: 'Profile ID is required.' });
    if (key && profileIds.has(key)) {
      issues.push({ scope: 'profile', owner: id, message: 'Profile ID must be unique.' });
    }
    if (key) profileIds.add(key);
    if (profile.assets.length === 0) {
      issues.push({ scope: 'profile', owner: id, message: 'Select at least one asset.' });
    }
    profile.assets.forEach((assetId) => {
      const asset = availableAssets.get(assetId.toLowerCase());
      if (!asset) {
        issues.push({ scope: 'profile', owner: id, message: `Unknown asset: ${assetId}` });
      } else if (profile.enabled !== false && asset.enabled === false) {
        issues.push({ scope: 'profile', owner: id, message: `Disabled asset: ${assetId}` });
      }
    });
  });

  const ruleNames = new Set<string>();
  config.rules.forEach((rule) => {
    const name = rule.name.trim();
    const key = name.toLowerCase();
    if (!name) issues.push({ scope: 'rule', owner: '', message: 'Binding name is required.' });
    if (key && ruleNames.has(key)) {
      issues.push({ scope: 'rule', owner: name, message: 'Binding name must be unique.' });
    }
    if (key) ruleNames.add(key);
    const sources = [rule.prompt?.trim(), rule.asset?.trim(), rule.profile?.trim()].filter(Boolean);
    if (sources.length !== 1) {
      issues.push({
        scope: 'rule',
        owner: name,
        message: 'Select exactly one prompt source.',
      });
    }
    if (rule.asset && !availableAssets.has(rule.asset.toLowerCase())) {
      issues.push({ scope: 'rule', owner: name, message: `Unknown asset: ${rule.asset}` });
    }
    if (rule.profile && !profileIds.has(rule.profile.toLowerCase())) {
      issues.push({ scope: 'rule', owner: name, message: `Unknown profile: ${rule.profile}` });
    }
    if (rule.target && rule.target.type !== 'global' && !rule.target.value?.trim()) {
      issues.push({ scope: 'rule', owner: name, message: 'Binding target is required.' });
    }
    if (rule.mode === 'replace' && !config.allowReplace) {
      issues.push({ scope: 'rule', owner: name, message: 'Replace must be enabled explicitly.' });
    }
  });
  return issues;
};

export const promptRewriteAssetReferences = (
  config: PromptRewriteConfig,
  assetId: string
): string[] => {
  const key = assetId.trim().toLowerCase();
  if (!key) return [];
  const references: string[] = [];
  config.profiles.forEach((profile) => {
    if (profile.assets.some((id) => id.toLowerCase() === key))
      references.push(`profile:${profile.id}`);
  });
  config.rules.forEach((rule) => {
    if (rule.asset?.toLowerCase() === key) references.push(`binding:${rule.name}`);
  });
  return references;
};

export const promptRewriteProfileReferences = (
  config: PromptRewriteConfig,
  profileId: string
): string[] => {
  const key = profileId.trim().toLowerCase();
  return config.rules
    .filter((rule) => rule.profile?.toLowerCase() === key)
    .map((rule) => `binding:${rule.name}`);
};

export const targetTypeOf = (rule: PromptRewriteRule): PromptRewriteTargetType =>
  rule.target?.type ?? 'global';

export const targetValueOf = (rule: PromptRewriteRule): string => rule.target?.value ?? '';
