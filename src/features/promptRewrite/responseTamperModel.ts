import type {
  ResponseTamperAsset,
  ResponseTamperConfig,
  ResponseTamperRule,
  ResponseTamperTargetType,
} from '@/types';
import { mergePolicyCollection, mergePolicyValue } from './model';

export const cloneResponseTamperConfig = (config: ResponseTamperConfig): ResponseTamperConfig =>
  structuredClone(config);

export interface ResponseTamperRebaseResult {
  config: ResponseTamperConfig;
  conflicts: string[];
}

export const rebaseResponseTamperConfig = (
  base: ResponseTamperConfig,
  draft: ResponseTamperConfig,
  latest: ResponseTamperConfig
): ResponseTamperRebaseResult => {
  const conflicts: string[] = [];
  const field = <T>(baseValue: T, draftValue: T, latestValue: T, path: string): T =>
    mergePolicyValue(baseValue, draftValue, latestValue, path, conflicts) as T;
  return {
    config: {
      enabled: field(base.enabled, draft.enabled, latest.enabled, 'enabled'),
      allowReplacement: field(
        base.allowReplacement,
        draft.allowReplacement,
        latest.allowReplacement,
        'allowReplacement'
      ),
      maxBufferBytes: field(
        base.maxBufferBytes,
        draft.maxBufferBytes,
        latest.maxBufferBytes,
        'maxBufferBytes'
      ),
      assets: mergePolicyCollection(
        base.assets,
        draft.assets,
        latest.assets,
        (asset) => asset.id,
        'assets',
        conflicts
      ),
      rules: mergePolicyCollection(
        base.rules,
        draft.rules,
        latest.rules,
        (rule) => rule.id,
        'rules',
        conflicts
      ),
      programs: mergePolicyCollection(
        base.programs,
        draft.programs,
        latest.programs,
        (program) => program.id,
        'programs',
        conflicts
      ),
    },
    conflicts: [...new Set(conflicts)],
  };
};

export const responseTamperTargetTypeOf = (rule: ResponseTamperRule): ResponseTamperTargetType =>
  rule.target?.type ?? 'global';

export const responseTamperTargetValueOf = (rule: ResponseTamperRule): string =>
  rule.target?.value ?? '';

export const createResponseTamperId = (prefix: string, existing: readonly string[]): string => {
  const taken = new Set(existing.map((value) => value.trim().toLowerCase()));
  let index = 1;
  let candidate = prefix;
  while (taken.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${prefix}-${index}`;
  }
  return candidate;
};

export const createResponseTamperAsset = (id: string): ResponseTamperAsset => ({
  id,
  enabled: true,
  content: 'Managed downstream response',
});

export const createResponseTamperRule = (
  id: string,
  asset?: string,
  trigger: ResponseTamperRule['trigger'] = asset ? 'official-refusal' : 'nerv',
  program?: string
): ResponseTamperRule => ({
  id,
  enabled: true,
  priority: 0,
  models: [],
  trigger,
  ...(asset ? { asset } : {}),
  ...(trigger === 'nerv' && program ? { program } : {}),
});

export interface ResponseTamperIssue {
  scope: 'document' | 'asset' | 'rule' | 'program';
  owner: string;
  message: string;
}

export const validateResponseTamperDraft = (
  config: ResponseTamperConfig
): ResponseTamperIssue[] => {
  const issues: ResponseTamperIssue[] = [];
  if (config.enabled && !config.allowReplacement) {
    issues.push({
      scope: 'document',
      owner: '',
      message: 'Enabled response replacement requires explicit authorization.',
    });
  }
  if (
    config.maxBufferBytes !== 0 &&
    (config.maxBufferBytes < 65_536 || config.maxBufferBytes > 33_554_432)
  ) {
    issues.push({
      scope: 'document',
      owner: '',
      message: 'Buffer limit must be zero or between 65,536 and 33,554,432 bytes.',
    });
  }

  const assets = new Map<string, ResponseTamperAsset>();
  config.assets.forEach((asset) => {
    const id = asset.id.trim();
    const key = id.toLowerCase();
    if (!id) issues.push({ scope: 'asset', owner: '', message: 'Asset ID is required.' });
    if (!asset.content.trim()) {
      issues.push({ scope: 'asset', owner: id, message: 'Replacement content is required.' });
    }
    if (key && assets.has(key)) {
      issues.push({ scope: 'asset', owner: id, message: 'Asset ID must be unique.' });
    }
    if (key) assets.set(key, asset);
  });

  const programs = new Map<string, ResponseTamperConfig['programs'][number]>();
  config.programs.forEach((program) => {
    const id = program.id.trim();
    const key = id.toLowerCase();
    if (!id) issues.push({ scope: 'program', owner: '', message: 'Program ID is required.' });
    if (key && programs.has(key)) {
      issues.push({ scope: 'program', owner: id, message: 'Program ID must be unique.' });
    }
    if (key) programs.set(key, program);
  });

  const rules = new Set<string>();
  config.rules.forEach((rule) => {
    const id = rule.id.trim();
    const key = id.toLowerCase();
    if (!id) issues.push({ scope: 'rule', owner: '', message: 'Rule ID is required.' });
    if (key && rules.has(key)) {
      issues.push({ scope: 'rule', owner: id, message: 'Rule ID must be unique.' });
    }
    if (key) rules.add(key);
    const assetID = rule.asset?.trim() ?? '';
    if (rule.trigger === 'nerv') {
      if (assetID) {
        issues.push({
          scope: 'rule',
          owner: id,
          message: 'NERV rules must not define a replacement asset.',
        });
      }
    } else if (!assetID) {
      issues.push({ scope: 'rule', owner: id, message: 'A replacement asset is required.' });
    } else {
      const asset = assets.get(assetID.toLowerCase());
      if (!asset) {
        issues.push({ scope: 'rule', owner: id, message: `Unknown asset: ${assetID}` });
      } else if (rule.enabled !== false && asset.enabled === false) {
        issues.push({ scope: 'rule', owner: id, message: `Disabled asset: ${assetID}` });
      }
    }
    if (rule.trigger === 'text-regex' && !rule.pattern?.trim()) {
      issues.push({ scope: 'rule', owner: id, message: 'Text regex rules require a pattern.' });
    }
    if (rule.trigger === 'official-refusal' && rule.pattern?.trim()) {
      issues.push({
        scope: 'rule',
        owner: id,
        message: 'Official refusal rules must not define a regex pattern.',
      });
    }
    if (rule.trigger === 'nerv') {
      const programID = rule.program?.trim() ?? '';
      if (!programID || !programs.has(programID.toLowerCase())) {
        issues.push({ scope: 'rule', owner: id, message: 'NERV rules require a known program.' });
      }
      if (rule.pattern?.trim()) {
        issues.push({
          scope: 'rule',
          owner: id,
          message: 'NERV rules must not define a regex pattern.',
        });
      }
    }
    if (rule.target && rule.target.type !== 'global' && !rule.target.value?.trim()) {
      issues.push({ scope: 'rule', owner: id, message: 'A target value is required.' });
    }
  });
  return issues;
};
