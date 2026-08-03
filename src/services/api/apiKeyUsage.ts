import { apiClient } from './client';
import {
  normalizeApiKeyFailureHistory,
  type ApiKeyFailureHistory,
  type ApiKeyUsageResponse,
} from '@/utils/recentRequests';

const API_KEY_USAGE_TIMEOUT_MS = 15 * 1000;

export const apiKeyUsageApi = {
  getUsage: () =>
    apiClient.get<ApiKeyUsageResponse>('/api-key-usage', {
      timeout: API_KEY_USAGE_TIMEOUT_MS,
    }),
  getFailures: async (authIndex: string): Promise<ApiKeyFailureHistory> => {
    const response = await apiClient.get<unknown>('/api-key-usage/failures', {
      params: { auth_index: authIndex },
      timeout: API_KEY_USAGE_TIMEOUT_MS,
    });
    const history = normalizeApiKeyFailureHistory(response);
    return history.authIndex ? history : { ...history, authIndex };
  },
};
