import {
  getProviderRecentUsageEntry,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import {
  mergeRecentRequestBucketGroups,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type RecentFailure,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';
import type { OpenAIProviderConfig } from '@/types';
import type { ProviderResource, SponsorProviderRaw } from './types';

interface ProviderUsageSelector {
  provider: string;
  apiKey: string;
  baseUrl?: string;
}

const usageSelectorKey = (selector: ProviderUsageSelector): string =>
  JSON.stringify([
    selector.provider.trim().toLowerCase(),
    selector.baseUrl?.trim() ?? '',
    selector.apiKey.trim(),
  ]);

const appendOpenAISelectors = (
  selectors: Map<string, ProviderUsageSelector>,
  config: OpenAIProviderConfig
) => {
  (config.apiKeyEntries ?? []).forEach((entry) => {
    const selector = {
      provider: config.name,
      apiKey: entry.apiKey,
      baseUrl: config.baseUrl,
    };
    if (selector.provider.trim() && selector.apiKey.trim()) {
      selectors.set(usageSelectorKey(selector), selector);
    }
  });
};

const collectProviderUsageSelectors = (resource: ProviderResource): ProviderUsageSelector[] => {
  const selectors = new Map<string, ProviderUsageSelector>();
  if (resource.brand === 'openaiCompatibility') {
    appendOpenAISelectors(selectors, (resource.usageRaw ?? resource.raw) as OpenAIProviderConfig);
    return Array.from(selectors.values());
  }
  if (resource.brand === 'kimi') {
    const raw = resource.raw as SponsorProviderRaw;
    raw.openai.forEach((item) => appendOpenAISelectors(selectors, item.config));
    raw.claude.forEach((item) => {
      const selector = {
        provider: 'claude',
        apiKey: item.config.apiKey,
        baseUrl: item.config.baseUrl,
      };
      if (selector.apiKey.trim()) selectors.set(usageSelectorKey(selector), selector);
    });
    return Array.from(selectors.values());
  }
  if (!resource.apiKey?.trim()) return [];
  return [
    {
      provider: resource.brand,
      apiKey: resource.apiKey,
      baseUrl: resource.baseUrl ?? undefined,
    },
  ];
};

const newerFailure = (
  current: RecentFailure | null,
  candidate: RecentFailure | null
): RecentFailure | null => {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTime = Date.parse(current.timestamp);
  const candidateTime = Date.parse(candidate.timestamp);
  if (!Number.isFinite(currentTime)) return candidate;
  if (!Number.isFinite(candidateTime)) return current;
  return candidateTime > currentTime ? candidate : current;
};

export const getProviderResourceUsage = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestUsageEntry => {
  const entries = collectProviderUsageSelectors(resource).map((selector) =>
    getProviderRecentUsageEntry(
      usageByProvider,
      selector.provider,
      selector.apiKey,
      selector.baseUrl
    )
  );
  const authIndexes = new Set<string>();
  let success = 0;
  let failed = 0;
  let recentFailureCount = 0;
  let latestFailure: RecentFailure | null = null;

  entries.forEach((entry) => {
    success += entry.success;
    failed += entry.failed;
    recentFailureCount += entry.recentFailureCount;
    entry.authIndexes.forEach((authIndex) => authIndexes.add(authIndex));
    latestFailure = newerFailure(latestFailure, entry.latestFailure);
  });

  return {
    success,
    failed,
    recentRequests: mergeRecentRequestBucketGroups(entries.map((entry) => entry.recentRequests)),
    authIndexes: Array.from(authIndexes),
    recentFailureCount,
    latestFailure,
  };
};

export const getProviderResourceTotalStats = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } => {
  const usage = getProviderResourceUsage(resource, usageByProvider);
  return { success: usage.success, failure: usage.failed };
};

export const getProviderResourceRecentWindowStats = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } =>
  sumRecentRequests(getProviderResourceUsage(resource, usageByProvider).recentRequests);

export const getProviderResourceStatusData = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData =>
  statusBarDataFromRecentRequests(
    getProviderResourceUsage(resource, usageByProvider).recentRequests
  );
