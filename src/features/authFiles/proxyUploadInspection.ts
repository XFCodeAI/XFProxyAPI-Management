import { buildProxyPoolURL, parseProxyPoolURL, redactProxyURL } from '@/services/api/proxyPools';
import type { ProxyPoolEntry } from '@/types/proxyPool';
import { isRecord } from '@/utils/helpers';

export type AuthFileProxyInspectionStatus = 'idle' | 'loading' | 'ready';

export interface AuthFileProxyInspectionGroup {
  proxyUrl: string;
  redactedUrl: string;
  fileNames: string[];
}

export interface AuthFileProxyInspectionFailure {
  fileName: string;
  error: string;
}

export interface AuthFileProxyInspection {
  status: AuthFileProxyInspectionStatus;
  totalFiles: number;
  filesWithProxy: number;
  filesWithoutProxy: number;
  uniqueProxyCount: number;
  existingProxyCount: number;
  newProxyCount: number;
  duplicateProxyFileCount: number;
  existingProxies: AuthFileProxyInspectionGroup[];
  newProxies: AuthFileProxyInspectionGroup[];
  failures: AuthFileProxyInspectionFailure[];
  compareFailed?: boolean;
}

export interface AuthFileProxyPoolComparison {
  pools: ProxyPoolEntry[];
  compareFailed?: boolean;
}

type ParsedAuthFileProxy =
  | { fileName: string; status: 'proxy'; proxyUrl: string }
  | { fileName: string; status: 'none' }
  | { fileName: string; status: 'failed'; error: string };

const AUTH_FILE_PROXY_PARSE_BATCH_SIZE = 12;

export const emptyAuthFileProxyInspection = (): AuthFileProxyInspection => ({
  status: 'idle',
  totalFiles: 0,
  filesWithProxy: 0,
  filesWithoutProxy: 0,
  uniqueProxyCount: 0,
  existingProxyCount: 0,
  newProxyCount: 0,
  duplicateProxyFileCount: 0,
  existingProxies: [],
  newProxies: [],
  failures: [],
});

export const loadingAuthFileProxyInspection = (totalFiles: number): AuthFileProxyInspection => ({
  ...emptyAuthFileProxyInspection(),
  status: 'loading',
  totalFiles,
});

function normalizeProxyURL(raw: string): string {
  const parsed = parseProxyPoolURL(raw);
  return buildProxyPoolURL({ ...parsed, id: '', note: '' }, true);
}

function normalizePoolProxyURL(pool: ProxyPoolEntry): string {
  const raw = buildProxyPoolURL(pool, true);
  return raw ? normalizeProxyURL(raw) : '';
}

function readAuthFileProxyValue(record: Record<string, unknown>): string {
  const snakeCase = record.proxy_url;
  if (typeof snakeCase === 'string' && snakeCase.trim()) {
    return snakeCase.trim();
  }
  const camelCase = record.proxyUrl;
  return typeof camelCase === 'string' ? camelCase.trim() : '';
}

async function readAuthFileProxy(file: File): Promise<ParsedAuthFileProxy> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return { fileName: file.name, status: 'failed', error: 'JSON must be an object' };
    }
    const rawProxyURL = readAuthFileProxyValue(parsed);
    if (!rawProxyURL) {
      return { fileName: file.name, status: 'none' };
    }
    return { fileName: file.name, status: 'proxy', proxyUrl: normalizeProxyURL(rawProxyURL) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid JSON or proxy URL';
    return { fileName: file.name, status: 'failed', error: message };
  }
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function parseAuthFilesInBatches(files: File[]): Promise<ParsedAuthFileProxy[]> {
  const results: ParsedAuthFileProxy[] = [];
  for (let index = 0; index < files.length; index += AUTH_FILE_PROXY_PARSE_BATCH_SIZE) {
    const batch = files.slice(index, index + AUTH_FILE_PROXY_PARSE_BATCH_SIZE);
    results.push(...(await Promise.all(batch.map((file) => readAuthFileProxy(file)))));
    if (index + AUTH_FILE_PROXY_PARSE_BATCH_SIZE < files.length) {
      await yieldToBrowser();
    }
  }
  return results;
}

function groupProxyFiles(parsed: ParsedAuthFileProxy[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  parsed.forEach((item) => {
    if (item.status !== 'proxy') return;
    const current = groups.get(item.proxyUrl);
    if (current) {
      current.push(item.fileName);
      return;
    }
    groups.set(item.proxyUrl, [item.fileName]);
  });
  return groups;
}

function toInspectionGroup([proxyUrl, fileNames]: [
  string,
  string[],
]): AuthFileProxyInspectionGroup {
  return {
    proxyUrl,
    redactedUrl: redactProxyURL(proxyUrl),
    fileNames: [...fileNames].sort((left, right) => left.localeCompare(right)),
  };
}

export async function inspectAuthFileProxyUploads(
  files: File[],
  comparison: AuthFileProxyPoolComparison | Promise<AuthFileProxyPoolComparison>
): Promise<AuthFileProxyInspection> {
  const [parsed, poolComparison] = await Promise.all([
    parseAuthFilesInBatches(files),
    Promise.resolve(comparison),
  ]);
  const compareFailed = poolComparison.compareFailed === true;
  const groups = groupProxyFiles(parsed);
  const existingProxyURLs = new Set(
    poolComparison.pools
      .map((pool) => {
        try {
          return normalizePoolProxyURL(pool);
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  );

  const existingProxies: AuthFileProxyInspectionGroup[] = [];
  const newProxies: AuthFileProxyInspectionGroup[] = [];

  Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach((entry) => {
      const group = toInspectionGroup(entry);
      if (!compareFailed && existingProxyURLs.has(entry[0])) {
        existingProxies.push(group);
      } else {
        newProxies.push(group);
      }
    });

  const filesWithProxy = parsed.filter((item) => item.status === 'proxy').length;
  const failures = parsed
    .filter(
      (item): item is Extract<ParsedAuthFileProxy, { status: 'failed' }> => item.status === 'failed'
    )
    .map((item) => ({ fileName: item.fileName, error: item.error }));

  return {
    status: 'ready',
    totalFiles: files.length,
    filesWithProxy,
    filesWithoutProxy: parsed.filter((item) => item.status === 'none').length,
    uniqueProxyCount: groups.size,
    existingProxyCount: existingProxies.length,
    newProxyCount: newProxies.length,
    duplicateProxyFileCount: Math.max(0, filesWithProxy - groups.size),
    existingProxies,
    newProxies,
    failures,
    compareFailed,
  };
}
