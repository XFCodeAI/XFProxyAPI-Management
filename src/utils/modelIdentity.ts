export type ModelIdentityRole = 'requested' | 'analytics' | 'resolved';

export type ModelIdentityValues = {
  requestedModel?: string;
  analyticsModel?: string;
  resolvedModel?: string;
};

export type ModelIdentityDisplay = {
  role: ModelIdentityRole;
  value: string;
};

const REASONING_MODEL_SUFFIXES = new Set([
  'none',
  'auto',
  '-1',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const isReasoningModelSuffix = (value: string): boolean => {
  if (REASONING_MODEL_SUFFIXES.has(value.toLowerCase())) return true;
  if (!/^[+-]?\d+$/.test(value)) return false;
  try {
    const numeric = BigInt(value);
    return numeric >= 0n && numeric <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
};

export const normalizeAnalyticsModel = (value: unknown): string => {
  const model = value === null || value === undefined ? '' : String(value);
  const open = model.lastIndexOf('(');
  if (open <= 0 || !model.endsWith(')')) return model;
  const suffix = model.slice(open + 1, -1);
  return isReasoningModelSuffix(suffix) ? model.slice(0, open) || model : model;
};

const MODEL_IDENTITY_KEYS: Record<ModelIdentityRole, keyof ModelIdentityValues> = {
  requested: 'requestedModel',
  analytics: 'analyticsModel',
  resolved: 'resolvedModel',
};

export const buildModelIdentityDisplay = (
  values: ModelIdentityValues,
  primary: Extract<ModelIdentityRole, 'requested' | 'analytics'>
): ModelIdentityDisplay[] => {
  const order: ModelIdentityRole[] =
    primary === 'requested'
      ? ['requested', 'analytics', 'resolved']
      : ['analytics', 'requested', 'resolved'];
  const seen = new Set<string>();
  const result: ModelIdentityDisplay[] = [];

  order.forEach((role) => {
    const value = values[MODEL_IDENTITY_KEYS[role]];
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push({ role, value });
  });

  return result;
};
