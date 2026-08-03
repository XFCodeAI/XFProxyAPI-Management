import type { OpenAIProviderConfig } from '@/types';
import {
  buildRecentRequestCompositeKey,
  mergeRecentRequestBucketGroups,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type RecentRequestBucket,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';

const DISABLE_ALL_MODELS_RULE = '*';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_VERTEX_BASE_URL = 'https://aiplatform.googleapis.com';

const OPENAI_ENDPOINT_SUFFIXES = [
  '/responses/compact',
  '/chat/completions',
  '/images/generations',
  '/images/edits',
  '/videos/generations',
  '/videos/edits',
  '/videos/extensions',
  '/responses',
  '/completions',
];

export const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

export const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

export const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

export const withoutDisableAllModelsRule = (models?: string[]) => stripDisableAllModelsRule(models);

const normalizeUpstreamBaseUrl = (baseUrl: string, fallback = ''): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return fallback;
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

const buildGeminiModelResource = (model: string): string => {
  const trimmed = String(model || '')
    .trim()
    .replace(/^\/+/g, '')
    .replace(/:generateContent$/i, '');
  if (!trimmed) return '';

  if (/^(models|tunedModels)\//i.test(trimmed)) {
    return trimmed.split('/').map(encodeURIComponent).join('/');
  }

  return `models/${encodeURIComponent(trimmed)}`;
};

const isVersionPathSegment = (value: string): boolean => /^v\d[\da-z.-]*$/i.test(value);

const buildOpenAIVersionedEndpoint = (baseUrl: string, endpoint: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    let path = parsed.pathname.replace(/\/+$/g, '');
    const lowerPath = path.toLowerCase();
    const suffix = OPENAI_ENDPOINT_SUFFIXES.find((candidate) =>
      lowerPath.endsWith(candidate.toLowerCase())
    );
    if (suffix) path = path.slice(0, -suffix.length);

    const segments = path.split('/').filter(Boolean);
    const endpointRemainder = endpoint.replace(/^\/v1\/?/i, '/');
    path = isVersionPathSegment(segments[segments.length - 1] ?? '')
      ? `${path}${endpointRemainder}`
      : `${path}/v1${endpointRemainder}`;
    parsed.pathname = path.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    return '';
  }
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string =>
  buildOpenAIVersionedEndpoint(baseUrl, '/v1/chat/completions');

export const buildOpenAIResponsesEndpoint = (baseUrl: string): string =>
  buildOpenAIVersionedEndpoint(baseUrl, '/v1/responses');

export const buildCodexResponsesEndpoint = (baseUrl: string): string =>
  buildOpenAIVersionedEndpoint(baseUrl, '/v1/responses');

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl, 'https://api.anthropic.com');
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

export const buildGeminiGenerateContentEndpoint = (baseUrl: string, model: string): string => {
  const resource = buildGeminiModelResource(model);
  if (!resource) return '';

  const trimmed = normalizeUpstreamBaseUrl(baseUrl, DEFAULT_GEMINI_BASE_URL);
  if (!trimmed) return '';
  if (/:generateContent$/i.test(trimmed)) {
    return trimmed;
  }

  let root = trimmed.replace(/\/+$/g, '');
  if (/\/v1beta\/models$/i.test(root)) {
    root = root.replace(/\/models$/i, '');
  } else if (!/\/v1beta$/i.test(root)) {
    root = root.replace(/\/v1beta(?:\/.*)?$/i, '');
    root = `${root}/v1beta`;
  }

  return `${root}/${resource}:generateContent`;
};

export const buildVertexGenerateContentEndpoint = (baseUrl: string, model: string): string => {
  const modelName = String(model || '')
    .trim()
    .replace(/^\/+|:generateContent$/gi, '');
  if (!modelName) return '';

  const trimmed = normalizeUpstreamBaseUrl(baseUrl, DEFAULT_VERTEX_BASE_URL);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    let path = parsed.pathname.replace(/\/+$/g, '');
    const modelsIndex = path.toLowerCase().lastIndexOf('/publishers/google/models/');
    if (modelsIndex >= 0) path = path.slice(0, modelsIndex);
    const segments = path.split('/').filter(Boolean);
    const versionRoot = isVersionPathSegment(segments[segments.length - 1] ?? '')
      ? path
      : `${path}/v1`;
    parsed.pathname =
      `${versionRoot}/publishers/google/models/${encodeURIComponent(modelName)}:generateContent`.replace(
        /\/{2,}/g,
        '/'
      );
    return parsed.toString();
  } catch {
    return '';
  }
};

export type ProviderRecentUsageMap = Map<string, Map<string, RecentRequestUsageEntry>>;

const EMPTY_RECENT_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
  authIndexes: [],
  recentFailureCount: 0,
  latestFailure: null,
};

const normalizeProviderRecentKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export const getProviderRecentUsageEntry = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestUsageEntry => {
  if (!String(apiKey ?? '').trim()) {
    return EMPTY_RECENT_USAGE_ENTRY;
  }

  const providerKey = normalizeProviderRecentKey(provider);
  const compositeKey = buildRecentRequestCompositeKey(baseUrl, apiKey);
  return usageByProvider.get(providerKey)?.get(compositeKey) ?? EMPTY_RECENT_USAGE_ENTRY;
};

const getProviderRecentBuckets = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestBucket[] =>
  getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl).recentRequests;

export function getProviderRecentStatusData(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): StatusBarData {
  return statusBarDataFromRecentRequests(
    getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl)
  );
}

export function getProviderTotalStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl);
  return { success: entry.success, failure: entry.failed };
}

export function getProviderRecentWindowStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return sumRecentRequests(getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl));
}

const collectOpenAIProviderRecentBuckets = (
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] => {
  if (!provider.apiKeyEntries?.length) {
    return [];
  }

  const groups = provider.apiKeyEntries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
};

export function getOpenAIProviderRecentWindowStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return sumRecentRequests(collectOpenAIProviderRecentBuckets(provider, usageByProvider));
}

export function getOpenAIProviderTotalStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return (provider.apiKeyEntries || []).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider.name,
        entry.apiKey,
        provider.baseUrl
      );
      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getOpenAIProviderRecentStatusData(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectOpenAIProviderRecentBuckets(provider, usageByProvider)
  );
}
