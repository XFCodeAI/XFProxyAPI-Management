/**
 * API 密钥管理
 */

import { apiClient } from './client';

export interface ManagedApiKeyEntry {
  key: string;
  allow: string[];
  groups: string[];
}

// extractApiKey pulls the key string from scalar entries and legacy object entries.
const extractApiKey = (entry: unknown): string | null => {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed ? trimmed : null;
  }
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    const key = record.key ?? record['api-key'] ?? record.apiKey ?? record.Key;
    if (typeof key === 'string') {
      const trimmed = key.trim();
      return trimmed ? trimmed : null;
    }
  }
  return null;
};

const normalizeStringList = (value: unknown, caseInsensitive = false): string[] => {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();

  value.forEach((item) => {
    const trimmed = String(item ?? '').trim();
    if (!trimmed) return;
    const key = caseInsensitive ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeApiKeyEntry = (entry: unknown): ManagedApiKeyEntry | null => {
  const key = extractApiKey(entry);
  if (!key) return null;
  const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
  return {
    key,
    allow: normalizeStringList(record?.allow),
    groups: normalizeStringList(record?.groups, true),
  };
};

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    if (!Array.isArray(keys)) return [];
    return keys.map(extractApiKey).filter((key): key is string => Boolean(key));
  },

  async listEntries(): Promise<ManagedApiKeyEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    if (!Array.isArray(keys)) return [];
    return keys
      .map((entry) => normalizeApiKeyEntry(entry))
      .filter((entry): entry is ManagedApiKeyEntry => Boolean(entry));
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  replaceEntries: (entries: ManagedApiKeyEntry[]) =>
    apiClient.put(
      '/api-keys',
      entries.map((entry) =>
        entry.groups.length === 0
          ? entry.key
          : {
              key: entry.key,
              ...(entry.groups.length > 0 ? { groups: entry.groups } : {}),
            }
      )
    ),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
};
