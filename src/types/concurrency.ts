export type ConcurrencyMode = 'inherit' | 'independent';

export interface ConcurrencySetting {
  mode: ConcurrencyMode;
  maxConcurrency: number;
}
