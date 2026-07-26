type ModelAliasDraftEntry = {
  id?: string;
  name?: string;
  alias?: string;
  fork?: boolean;
  displayName?: string;
  forceMapping?: boolean;
};

const getRuleKey = (value: string): string => value.trim().toLowerCase();

export const normalizeOAuthExcludedRules = (values: Iterable<string>): string[] => {
  const seen = new Set<string>();
  const rules: string[] = [];

  for (const value of values) {
    const rule = value.trim();
    const key = getRuleKey(rule);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }

  return rules;
};

export const getEffectiveOAuthExcludedRules = (
  selectedRules: Iterable<string>,
  pendingRule: string
): string[] => normalizeOAuthExcludedRules([...selectedRules, pendingRule]);

export const hasOAuthExcludedRule = (values: Iterable<string>, candidate: string): boolean => {
  const candidateKey = getRuleKey(candidate);
  if (!candidateKey) return false;
  return Array.from(values).some((value) => getRuleKey(value) === candidateKey);
};

export const updateOAuthExcludedRule = (
  values: Iterable<string>,
  candidate: string,
  selected: boolean
): string[] => {
  const candidateRule = candidate.trim();
  const candidateKey = getRuleKey(candidateRule);
  const rules = normalizeOAuthExcludedRules(values).filter(
    (value) => getRuleKey(value) !== candidateKey
  );

  if (selected && candidateKey) rules.push(candidateRule);
  return rules;
};

export const getCustomOAuthExcludedRules = (
  selectedRules: Iterable<string>,
  catalogRules: Iterable<string>
): string[] => {
  const catalogKeys = new Set(
    normalizeOAuthExcludedRules(catalogRules).map((value) => getRuleKey(value))
  );
  return normalizeOAuthExcludedRules(selectedRules).filter(
    (value) => !catalogKeys.has(getRuleKey(value))
  );
};

export const getStringSetSignature = (values: Iterable<string>): string =>
  JSON.stringify(
    normalizeOAuthExcludedRules(values).sort((left, right) => left.localeCompare(right))
  );

export const getModelAliasDraftSignature = (entries: ModelAliasDraftEntry[]): string =>
  JSON.stringify(
    entries
      .map((entry) => ({
        name: entry.name ?? '',
        alias: entry.alias ?? '',
        fork: entry.fork === true,
        displayName: entry.displayName?.trim() || undefined,
        forceMapping: typeof entry.forceMapping === 'boolean' ? entry.forceMapping : undefined,
      }))
      .filter(
        (entry) =>
          entry.name !== '' ||
          entry.alias !== '' ||
          entry.fork !== true ||
          entry.displayName !== undefined ||
          entry.forceMapping !== undefined
      )
  );

export const isOAuthEditorDirty = (
  initialProviderKey: string,
  currentProviderKey: string,
  baselineContentSignature: string,
  currentContentSignature: string
): boolean =>
  initialProviderKey !== currentProviderKey || baselineContentSignature !== currentContentSignature;
