import { apiClient } from './client';
import { DEFAULT_MAX_CONCURRENCY, isValidMaxConcurrency } from '@/utils/maxConcurrency';

export interface CredentialConcurrencyConfig {
  defaultMaxConcurrency: number;
}

const normalizeConfig = (payload: unknown): CredentialConcurrencyConfig => {
  const raw =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)['default-max-concurrency']
      : undefined;
  const parsed = Number(raw);
  return {
    defaultMaxConcurrency: isValidMaxConcurrency(parsed) ? parsed : DEFAULT_MAX_CONCURRENCY,
  };
};

export const credentialConcurrencyApi = {
  async get(): Promise<CredentialConcurrencyConfig> {
    return normalizeConfig(await apiClient.get('/credential-concurrency'));
  },

  async update(defaultMaxConcurrency: number): Promise<void> {
    await apiClient.put('/credential-concurrency', {
      'default-max-concurrency': defaultMaxConcurrency,
    });
  },
};
