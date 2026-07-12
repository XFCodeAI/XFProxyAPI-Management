import { parse as parseYaml, parseDocument, isMap } from 'yaml';
import type {
  ProxyPoolAutoAssignResult,
  ProxyPoolEntry,
  ProxyPoolProtocol,
  ProxyPoolStatusEntry,
  ProxyPoolsConfigSnapshot,
  ProxyPoolUsage,
  ProxySelection,
} from '@/types/proxyPool';
import { generateId, isRecord } from '@/utils/helpers';
import { apiClient } from './client';
import { configFileApi } from './configFile';

export const PROXY_POOL_PROTOCOLS: ProxyPoolProtocol[] = ['http', 'https', 'socks5', 'socks5h'];
export const DEFAULT_PROXY_POOL_NAME = 'main';

const PROXY_POOLS_YAML_KEY = 'proxy-pools';
const protocolAliases: Record<string, ProxyPoolProtocol> = {
  sock5: 'socks5',
  sock5h: 'socks5h',
};

const providerSections: Array<{ key: string; label: string }> = [
  { key: 'gemini-api-key', label: 'Gemini' },
  { key: 'claude-api-key', label: 'Claude' },
  { key: 'codex-api-key', label: 'Codex' },
  { key: 'vertex-api-key', label: 'Vertex' },
];

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function readBool(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function normalizeProxyPoolProtocol(value: unknown): ProxyPoolProtocol | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (PROXY_POOL_PROTOCOLS.includes(normalized as ProxyPoolProtocol)) {
    return normalized as ProxyPoolProtocol;
  }
  return protocolAliases[normalized] ?? null;
}

function normalizeProtocol(value: unknown): ProxyPoolProtocol {
  return normalizeProxyPoolProtocol(value) ?? 'http';
}

function normalizePoolEntry(value: unknown, index: number): ProxyPoolEntry | null {
  if (!isRecord(value)) return null;

  const name = readString(value, 'name') || DEFAULT_PROXY_POOL_NAME;
  const host = readString(value, 'host');
  const port = readString(value, 'port');
  const protocol = normalizeProtocol(value.protocol);

  return {
    id: `${name || 'pool'}-${index}-${generateId()}`,
    name,
    enabled: readBool(value, 'enabled', true),
    protocol,
    host,
    port,
    username: readString(value, 'username'),
    password: readString(value, 'password'),
    note: readString(value, 'note'),
  };
}

function readProxyPools(parsed: unknown): ProxyPoolEntry[] {
  if (!isRecord(parsed)) return [];
  const rawPools = parsed[PROXY_POOLS_YAML_KEY];
  if (!Array.isArray(rawPools)) return [];
  return rawPools
    .map((entry, index) => normalizePoolEntry(entry, index))
    .filter((entry): entry is ProxyPoolEntry => entry !== null);
}

function maskKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function proxyUsageID(parts: string[]): string {
  return parts.map((part) => part.replace(/\s+/g, '-').toLowerCase()).join(':');
}

function usageTarget(record: Record<string, unknown>, fallback: string): string {
  const candidates = [
    readString(record, 'name'),
    readString(record, 'prefix'),
    maskKey(readString(record, 'api-key')),
    readString(record, 'base-url'),
  ];
  return candidates.find(Boolean) ?? fallback;
}

function collectProviderProxyUsages(parsed: Record<string, unknown>): ProxyPoolUsage[] {
  const usages: ProxyPoolUsage[] = [];

  for (const section of providerSections) {
    const entries = parsed[section.key];
    if (!Array.isArray(entries)) continue;

    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const proxyUrl = readString(entry, 'proxy-url');
      if (!proxyUrl) return;
      const target = usageTarget(entry, `#${index + 1}`);
      usages.push({
        id: proxyUsageID([section.key, String(index), proxyUrl]),
        kind: 'provider-key',
        provider: section.label,
        target,
        proxyUrl,
      });
    });
  }

  const openAICompatibility = parsed['openai-compatibility'];
  if (Array.isArray(openAICompatibility)) {
    openAICompatibility.forEach((compat, compatIndex) => {
      if (!isRecord(compat)) return;
      const provider = readString(compat, 'name') || `OpenAI-compatible #${compatIndex + 1}`;
      const entries = compat['api-key-entries'];
      if (!Array.isArray(entries)) return;

      entries.forEach((entry, entryIndex) => {
        if (!isRecord(entry)) return;
        const proxyUrl = readString(entry, 'proxy-url');
        if (!proxyUrl) return;
        usages.push({
          id: proxyUsageID(['openai-compatibility', String(compatIndex), String(entryIndex)]),
          kind: 'provider-key',
          provider,
          target: maskKey(readString(entry, 'api-key')) || `#${entryIndex + 1}`,
          proxyUrl,
        });
      });
    });
  }

  return usages;
}

function collectProxyUsages(parsed: unknown): ProxyPoolUsage[] {
  if (!isRecord(parsed)) return [];

  const usages: ProxyPoolUsage[] = [];
  const globalProxyUrl = readString(parsed, 'proxy-url');
  if (globalProxyUrl) {
    usages.push({
      id: 'global',
      kind: 'global',
      provider: 'Global',
      target: 'proxy-url',
      proxyUrl: globalProxyUrl,
    });
  }

  return usages.concat(collectProviderProxyUsages(parsed));
}

function serializeProxyPool(pool: ProxyPoolEntry): Record<string, unknown> {
  const normalizedPort = pool.port.trim();
  const entry: Record<string, unknown> = {
    name: pool.name.trim() || DEFAULT_PROXY_POOL_NAME,
    enabled: pool.enabled,
    protocol: pool.protocol,
    host: pool.host.trim(),
    port: /^\d+$/.test(normalizedPort) ? Number(normalizedPort) : normalizedPort,
  };
  if (pool.username.trim()) entry.username = pool.username.trim();
  if (pool.password) entry.password = pool.password;
  if (pool.note.trim()) entry.note = pool.note.trim();
  return entry;
}

function parseConfigSnapshot(yamlContent: string): ProxyPoolsConfigSnapshot {
  const parsed = parseYaml(yamlContent);
  const record = isRecord(parsed) ? parsed : {};
  return {
    pools: readProxyPools(record),
    globalProxyUrl: readString(record, 'proxy-url'),
    usages: collectProxyUsages(record),
  };
}

function normalizeAssignments(value: unknown): ProxyPoolStatusEntry['assignedTo'] {
  if (!Array.isArray(value)) return [];
  return value.reduce<ProxyPoolStatusEntry['assignedTo']>((items, item) => {
    if (!isRecord(item)) return items;
    const id = readString(item, 'id');
    if (!id) return items;
    items.push({
      id,
      provider: readString(item, 'provider'),
      label: readString(item, 'label') || undefined,
      fileName: readString(item, 'file_name') || undefined,
      email: readString(item, 'email') || undefined,
    });
    return items;
  }, []);
}

function normalizeStatusEntry(value: unknown): ProxyPoolStatusEntry | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id');
  if (!id) return null;
  const protocol = normalizeProtocol(value.protocol);
  const assignedTo = normalizeAssignments(value.assigned_to ?? value.assignedTo);
  return {
    id,
    name: readString(value, 'name') || DEFAULT_PROXY_POOL_NAME,
    enabled: readBool(value, 'enabled', true),
    protocol,
    host: readString(value, 'host'),
    port: readNumber(value, 'port'),
    username: readString(value, 'username'),
    note: readString(value, 'note'),
    redactedUrl: readString(value, 'redacted_url') || readString(value, 'redactedUrl'),
    configError: readString(value, 'config_error') || readString(value, 'configError') || undefined,
    checked: readBool(value, 'checked', false),
    available: readBool(value, 'available', false),
    checkError: readString(value, 'check_error') || readString(value, 'checkError') || undefined,
    lastChecked: readString(value, 'last_checked') || readString(value, 'lastChecked') || undefined,
    ip: readString(value, 'ip') || undefined,
    country: readString(value, 'country') || undefined,
    region: readString(value, 'region') || undefined,
    city: readString(value, 'city') || undefined,
    location: readString(value, 'location') || undefined,
    org: readString(value, 'org') || undefined,
    timezone: readString(value, 'timezone') || undefined,
    assignedCount:
      readNumber(value, 'assigned_count') ||
      readNumber(value, 'assignedCount') ||
      assignedTo.length,
    assignedTo,
  };
}

function normalizeStatusResponse(payload: unknown): ProxyPoolStatusEntry[] {
  const pools = isRecord(payload) ? payload.pools : payload;
  if (!Array.isArray(pools)) return [];
  return pools
    .map((item) => normalizeStatusEntry(item))
    .filter((item): item is ProxyPoolStatusEntry => item !== null);
}

function normalizeAutoAssignResult(payload: unknown): ProxyPoolAutoAssignResult {
  const record = isRecord(payload) ? payload : {};
  const failures = Array.isArray(record.failures)
    ? record.failures.flatMap((item) => {
        if (!isRecord(item)) return [];
        const authId = readString(item, 'auth_id') || readString(item, 'authId');
        const error = readString(item, 'error');
        return authId && error ? [{ authId, error }] : [];
      })
    : [];
  return {
    status: record.status === 'partial' ? 'partial' : 'ok',
    updated: readNumber(record, 'updated'),
    skipped: readNumber(record, 'skipped'),
    failed: readNumber(record, 'failed'),
    failures,
    pools: normalizeStatusResponse(record),
  };
}

async function load(): Promise<ProxyPoolsConfigSnapshot> {
  const yamlContent = await configFileApi.fetchConfigYaml();
  return parseConfigSnapshot(yamlContent);
}

async function save(pools: ProxyPoolEntry[]): Promise<ProxyPoolsConfigSnapshot> {
  const latestYaml = await configFileApi.fetchConfigYaml();
  const doc = parseDocument(latestYaml);
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]?.message || 'YAML 无效');
  }
  if (!isMap(doc.contents)) {
    doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  }

  const nextPools = pools.map(serializeProxyPool);
  if (nextPools.length > 0) {
    doc.set(PROXY_POOLS_YAML_KEY, nextPools);
  } else {
    doc.delete(PROXY_POOLS_YAML_KEY);
  }

  await configFileApi.saveConfigYaml(
    doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 })
  );
  return load();
}

function decodeURLPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function defaultProxyPort(protocol: ProxyPoolProtocol): string {
  switch (protocol) {
    case 'https':
      return '443';
    case 'socks5':
    case 'socks5h':
      return '1080';
    default:
      return '80';
  }
}

export function parseProxyPoolURL(raw: string): Omit<ProxyPoolEntry, 'id' | 'note'> {
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('代理地址格式无效');
  }
  const protocol = normalizeProxyPoolProtocol(parsed.protocol.replace(/:$/, ''));
  if (!protocol) {
    throw new Error('不支持的代理协议');
  }
  if (!parsed.hostname.trim()) {
    throw new Error('代理地址不能为空');
  }

  return {
    name: DEFAULT_PROXY_POOL_NAME,
    enabled: true,
    protocol,
    host: parsed.hostname.trim(),
    port: parsed.port.trim() || defaultProxyPort(protocol),
    username: decodeURLPart(parsed.username),
    password: decodeURLPart(parsed.password),
  };
}

export function buildProxyPoolURL(pool: ProxyPoolEntry, revealCredentials = false): string {
  const host = pool.host.trim();
  if (!host) return '';
  const port = pool.port.trim();
  const username = pool.username.trim();
  const password = pool.password;
  const auth =
    username && revealCredentials
      ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
      : username
        ? 'redacted@'
        : '';
  return `${pool.protocol}://${auth}${host}${port ? `:${port}` : ''}`;
}

export function redactProxyURL(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.toLowerCase() === 'direct' || value.toLowerCase() === 'none') return value;

  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = 'redacted';
      parsed.password = '';
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value;
  }
}

export const proxyPoolsApi = {
  load,
  save,
  loadStatus: async () => normalizeStatusResponse(await apiClient.get('/proxy-pools')),
  checkAll: async () => normalizeStatusResponse(await apiClient.post('/proxy-pools/check')),
  checkOne: async (id: string) => {
    const payload = await apiClient.post(`/proxy-pools/${encodeURIComponent(id)}/check`);
    if (isRecord(payload) && payload.pool) {
      const entry = normalizeStatusEntry(payload.pool);
      return entry ? [entry] : [];
    }
    return normalizeStatusResponse(payload);
  },
  assign: async (id: string, authIds: string[]) =>
    normalizeStatusResponse(
      await apiClient.post(`/proxy-pools/${encodeURIComponent(id)}/assign`, {
        auth_ids: authIds,
      })
    ),
  autoAssign: async (authIds: string[]) =>
    normalizeStatusResponse(
      await apiClient.post('/proxy-pools/auto-assign', {
        auth_ids: authIds,
      })
    ),
  autoAssignUnassigned: async (authIds: string[]) =>
    normalizeAutoAssignResult(
      await apiClient.post('/proxy-pools/auto-assign', {
        auth_ids: authIds,
        only_unassigned: true,
      })
    ),
};

export function proxySelectionParams(selection?: ProxySelection): Record<string, string> {
  if (!selection) return {};
  const params: Record<string, string> = { proxy_mode: selection.mode };
  if (selection.proxyId) params.proxy_id = selection.proxyId;
  if (selection.proxyUrl) params.proxy_url = selection.proxyUrl;
  return params;
}
