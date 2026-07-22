import { apiClient } from './client';

const normalizeCredentialGroups = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();

  value.forEach((item) => {
    const trimmed = String(item ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized;
};

export const credentialGroupsApi = {
  async list(signal?: AbortSignal): Promise<string[]> {
    const payload = await apiClient.get<Record<string, unknown>>('/credential-groups', { signal });
    return normalizeCredentialGroups(payload['credential-groups'] ?? payload.items);
  },

  create: (name: string) => apiClient.patch('/credential-groups', { name }),

  delete: (name: string) => apiClient.delete(`/credential-groups?name=${encodeURIComponent(name)}`),
};
