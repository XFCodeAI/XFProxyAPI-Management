export const DEFAULT_CONSECUTIVE_429_THRESHOLD = 3;
export const MIN_CONSECUTIVE_429_THRESHOLD = 1;
export const MAX_CONSECUTIVE_429_THRESHOLD = 100;

export const isValidConsecutive429Threshold = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_CONSECUTIVE_429_THRESHOLD &&
  value <= MAX_CONSECUTIVE_429_THRESHOLD;

export const normalizeConsecutive429Threshold = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return isValidConsecutive429Threshold(parsed) ? parsed : DEFAULT_CONSECUTIVE_429_THRESHOLD;
};
