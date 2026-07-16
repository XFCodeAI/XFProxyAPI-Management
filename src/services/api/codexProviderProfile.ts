import { apiClient } from './client';

interface CodexProviderProfileResponse {
  provider_id: string;
  provider_name: string;
  base_url: string;
  environment_key: string;
  config_toml: string;
}

export interface CodexProviderProfile {
  providerId: string;
  providerName: string;
  baseUrl: string;
  environmentKey: string;
  configToml: string;
}

export const codexProviderProfileApi = {
  async create(baseUrl: string): Promise<CodexProviderProfile> {
    const response = await apiClient.post<CodexProviderProfileResponse>('/codex/provider-profile', {
      base_url: baseUrl,
    });
    return {
      providerId: response.provider_id,
      providerName: response.provider_name,
      baseUrl: response.base_url,
      environmentKey: response.environment_key,
      configToml: response.config_toml,
    };
  },
};
