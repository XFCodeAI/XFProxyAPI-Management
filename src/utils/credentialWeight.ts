export const DEFAULT_CREDENTIAL_WEIGHT = 1;
export const MAX_CREDENTIAL_WEIGHT = 1_000_000;

export type CredentialWeightErrorCode = 'integer' | 'maximum';
export type CredentialWeightInputValue = number | string | undefined;

const INTEGER_PATTERN = /^[+-]?\d+$/;

export const toCredentialWeightInputValue = (raw: string): CredentialWeightInputValue =>
  raw.trim() === '' ? undefined : raw;

export const getCredentialWeightError = (value: unknown): CredentialWeightErrorCode | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!INTEGER_PATTERN.test(trimmed)) return 'integer';
    parsed = Number(trimmed);
  } else {
    return 'integer';
  }

  if (!Number.isSafeInteger(parsed)) return 'integer';
  if (parsed > MAX_CREDENTIAL_WEIGHT) return 'maximum';
  return undefined;
};

export const normalizeCredentialWeight = (value: unknown): number | undefined => {
  if (getCredentialWeightError(value)) return undefined;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const resolveEffectiveCredentialWeight = (value: unknown): number =>
  Math.max(0, normalizeCredentialWeight(value) ?? DEFAULT_CREDENTIAL_WEIGHT);
