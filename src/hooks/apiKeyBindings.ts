export type VisualApiKeyEntry = {
  key: string;
  groups: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractApiKeyValue(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }

  const record = asRecord(raw);
  if (!record) return null;

  const candidates = [record['api-key'], record.apiKey, record.key, record.Key];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

export function normalizeCredentialGroupNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const group = String(item ?? '').trim();
    if (!group) continue;
    const lower = group.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(group);
  }
  return out;
}

function parseApiKeyEntries(raw: unknown): VisualApiKeyEntry[] {
  if (!Array.isArray(raw)) return [];

  const entries: VisualApiKeyEntry[] = [];
  for (const item of raw) {
    const key = extractApiKeyValue(item);
    if (!key) continue;
    const record = asRecord(item);
    entries.push({
      key,
      groups: normalizeCredentialGroupNames(record?.groups),
    });
  }
  return entries;
}

export function resolveApiKeyEntries(parsed: Record<string, unknown>): VisualApiKeyEntry[] {
  if (Object.prototype.hasOwnProperty.call(parsed, 'api-keys')) {
    return parseApiKeyEntries(parsed['api-keys']);
  }

  const auth = asRecord(parsed.auth);
  const providers = asRecord(auth?.providers);
  const configApiKeyProvider = asRecord(providers?.['config-api-key']);
  if (!configApiKeyProvider) return [];

  if (Object.prototype.hasOwnProperty.call(configApiKeyProvider, 'api-key-entries')) {
    return parseApiKeyEntries(configApiKeyProvider['api-key-entries']);
  }

  return parseApiKeyEntries(configApiKeyProvider['api-keys']);
}

export function resolveApiKeysText(parsed: Record<string, unknown>): string {
  return resolveApiKeyEntries(parsed)
    .map((entry) => entry.key)
    .join('\n');
}

export function resolveApiKeyCredentialGroups(
  parsed: Record<string, unknown>
): Record<string, string[]> {
  const bindings: Record<string, string[]> = {};
  for (const entry of resolveApiKeyEntries(parsed)) {
    if (entry.groups.length > 0) {
      bindings[entry.key] = [...entry.groups];
    }
  }
  return bindings;
}

const PROVIDER_CREDENTIAL_CONFIG_KEYS: string[] = [
  'gemini-api-key',
  'claude-api-key',
  'codex-api-key',
  'vertex-api-key',
];

function collectEntryCredentialGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (groups: unknown) => {
    for (const group of normalizeCredentialGroupNames(groups)) {
      const lower = group.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(group);
    }
  };
  for (const item of raw) {
    const record = asRecord(item);
    push(record?.groups);
  }
  return out;
}

export function resolveCredentialGroupOptions(parsed: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (groups: unknown) => {
    for (const group of normalizeCredentialGroupNames(groups)) {
      const lower = group.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(group);
    }
  };

  push(parsed['credential-groups']);
  for (const entry of resolveApiKeyEntries(parsed)) {
    push(entry.groups);
  }
  for (const key of PROVIDER_CREDENTIAL_CONFIG_KEYS) {
    push(collectEntryCredentialGroups(parsed[key]));
  }

  const compat = parsed['openai-compatibility'];
  if (Array.isArray(compat)) {
    for (const item of compat) {
      const record = asRecord(item);
      push(collectEntryCredentialGroups(record?.['api-key-entries']));
    }
  }

  return out;
}

function parseApiKeyTextLines(value: string): string[] {
  return value
    .split('\n')
    .map((key) => key.trim())
    .filter(Boolean);
}

export function serializeApiKeyEntriesForYaml(
  apiKeysText: string,
  groupBindings: Record<string, string[]> = {}
): Array<string | { key: string; groups?: string[] }> {
  const nextKeys = parseApiKeyTextLines(apiKeysText);

  return nextKeys.map((key) => {
    const groups = normalizeCredentialGroupNames(groupBindings[key]);
    if (groups.length === 0) {
      return key;
    }
    return { key, groups };
  });
}
