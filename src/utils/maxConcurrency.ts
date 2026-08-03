import type { ConcurrencyMode, ConcurrencySetting } from '@/types/concurrency';

export const MAX_CONCURRENCY = 1_000_000;
export const DEFAULT_MAX_CONCURRENCY = 10;

export type OptionalMaxConcurrencyParseResult =
  { valid: true; value?: number } | { valid: false; value?: undefined };

export const isValidMaxConcurrency = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_CONCURRENCY;

export const parseOptionalMaxConcurrency = (input: string): OptionalMaxConcurrencyParseResult => {
  const normalized = input.trim();
  if (!normalized) return { valid: true };
  if (!/^[+-]?\d+$/.test(normalized)) return { valid: false };
  const value = Number(normalized);
  return isValidMaxConcurrency(value) ? { valid: true, value } : { valid: false };
};

export const normalizeConcurrencySetting = (
  modeValue: unknown,
  maxConcurrencyValue: unknown
): ConcurrencySetting => {
  const parsedMaxConcurrency = Number(maxConcurrencyValue);
  const maxConcurrency = isValidMaxConcurrency(parsedMaxConcurrency) ? parsedMaxConcurrency : 0;
  const mode = String(modeValue ?? '')
    .trim()
    .toLowerCase();

  if (mode === 'independent') {
    return { mode: 'independent', maxConcurrency };
  }
  if (mode === 'inherit') {
    return { mode: 'inherit', maxConcurrency: 0 };
  }
  return maxConcurrency > 0
    ? { mode: 'independent', maxConcurrency }
    : { mode: 'inherit', maxConcurrency: 0 };
};

export const effectiveMaxConcurrency = (
  setting: ConcurrencySetting,
  defaultMaxConcurrency: number
): number => (setting.mode === 'independent' ? setting.maxConcurrency : defaultMaxConcurrency);

export const resolveAuthFileConcurrencySetting = (
  value: Record<string, unknown>
): ConcurrencySetting =>
  normalizeConcurrencySetting(
    value.concurrencyMode ?? value.concurrency_mode ?? value['concurrency-mode'],
    value.maxConcurrency ?? value.max_concurrency ?? value['max-concurrency']
  );

export const isConcurrencyMode = (value: unknown): value is ConcurrencyMode =>
  value === 'inherit' || value === 'independent';
