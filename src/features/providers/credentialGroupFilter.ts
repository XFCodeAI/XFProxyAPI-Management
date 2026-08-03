import type { OpenAIProviderConfig } from '@/types';
import { normalizeCredentialGroups } from '@/utils/credentialGroups';
import { maskApiKey } from '@/utils/format';
import type { ProviderGroup, ProviderResource, SponsorProviderRaw } from './types';

export const CREDENTIAL_GROUP_QUERY_PARAM = 'credential-group';

export type CredentialGroupFilterState = 'inactive' | 'active' | 'oauth-only' | 'empty' | 'stale';

export const credentialGroupKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export const hasExactCredentialGroup = (groups: unknown, target: string): boolean => {
  const targetKey = credentialGroupKey(target);
  return (
    targetKey.length > 0 &&
    normalizeCredentialGroups(groups).some((group) => credentialGroupKey(group) === targetKey)
  );
};

export const readCredentialGroupFilter = (params: URLSearchParams): string =>
  String(params.get(CREDENTIAL_GROUP_QUERY_PARAM) ?? '').trim();

export const buildCredentialGroupRelayPath = (group: string): string => {
  const params = new URLSearchParams();
  params.set(CREDENTIAL_GROUP_QUERY_PARAM, group.trim());
  return `/ai-providers?${params.toString()}`;
};

export const clearCredentialGroupFilterParams = (params: URLSearchParams): URLSearchParams => {
  const next = new URLSearchParams(params);
  next.delete(CREDENTIAL_GROUP_QUERY_PARAM);
  return next;
};

const filterOpenAIResource = (
  resource: ProviderResource,
  group: string
): ProviderResource | null => {
  const config = resource.raw as OpenAIProviderConfig;
  const matchingEntryIndexes: number[] = [];
  const matchingEntries = (config.apiKeyEntries ?? []).filter((entry, index) => {
    const matches = hasExactCredentialGroup(entry.groups, group);
    if (matches) matchingEntryIndexes.push(index);
    return matches;
  });
  if (matchingEntries.length === 0) return null;

  const firstKey = matchingEntries.find((entry) => entry.apiKey.trim())?.apiKey ?? '';
  return {
    ...resource,
    groups: normalizeCredentialGroups(matchingEntries.flatMap((entry) => entry.groups ?? [])),
    apiKeyPreview: firstKey ? maskApiKey(firstKey) : null,
    apiKeyEntryCount: matchingEntries.length,
    usageRaw: { ...config, apiKeyEntries: matchingEntries },
    billingTargets: [
      {
        providerBrand: 'openaiCompatibility',
        providerIndex: resource.originalIndex,
        apiKeyIndexes: matchingEntryIndexes,
      },
    ],
  };
};

const filterSponsorResource = (
  resource: ProviderResource,
  group: string
): ProviderResource | null => {
  const raw = resource.raw as SponsorProviderRaw;
  const billingTargets: NonNullable<ProviderResource['billingTargets']> = [];
  const matchingOpenAI = raw.openai.flatMap((item) => {
    const apiKeyIndexes: number[] = [];
    const entries = (item.config.apiKeyEntries ?? []).filter((entry, index) => {
      const matches = hasExactCredentialGroup(entry.groups, group);
      if (matches) apiKeyIndexes.push(index);
      return matches;
    });
    if (apiKeyIndexes.length === 0) return [];
    billingTargets.push({
      providerBrand: 'openaiCompatibility',
      providerIndex: item.index,
      apiKeyIndexes,
    });
    return [{ ...item, config: { ...item.config, apiKeyEntries: entries } }];
  });
  const matchingOpenAIEntries = matchingOpenAI.flatMap((item) => item.config.apiKeyEntries ?? []);
  const matchingClaude = raw.claude.filter((item) =>
    hasExactCredentialGroup(item.config.groups, group)
  );
  matchingClaude.forEach((item) => {
    billingTargets.push({
      providerBrand: 'claude',
      providerIndex: item.index,
      apiKeyIndexes: [0],
    });
  });
  if (matchingOpenAIEntries.length === 0 && matchingClaude.length === 0) return null;

  const firstKey =
    matchingOpenAIEntries.find((entry) => entry.apiKey.trim())?.apiKey ??
    matchingClaude.find((item) => item.config.apiKey.trim())?.config.apiKey ??
    '';
  const matchingGroups = [
    ...matchingOpenAIEntries.flatMap((entry) => entry.groups ?? []),
    ...matchingClaude.flatMap((item) => item.config.groups ?? []),
  ];
  return {
    ...resource,
    groups: normalizeCredentialGroups(matchingGroups),
    apiKey: firstKey || null,
    apiKeyPreview: firstKey ? maskApiKey(firstKey) : null,
    apiKeyEntryCount: matchingOpenAIEntries.length + matchingClaude.length,
    billingRaw: { openai: matchingOpenAI, claude: matchingClaude },
    billingTargets,
  };
};

export const filterProviderResourceByCredentialGroup = (
  resource: ProviderResource,
  group: string
): ProviderResource | null => {
  if (!credentialGroupKey(group)) return resource;
  if (resource.brand === 'openaiCompatibility') {
    return filterOpenAIResource(resource, group);
  }
  if (resource.brand === 'kimi') {
    return filterSponsorResource(resource, group);
  }
  return hasExactCredentialGroup(resource.groups, group) ? resource : null;
};

export const filterProviderGroupsByCredentialGroup = (
  groups: ProviderGroup[],
  group: string
): ProviderGroup[] => {
  if (!credentialGroupKey(group)) return groups;
  return groups.map((providerGroup) => ({
    ...providerGroup,
    resources: providerGroup.resources
      .map((resource) => filterProviderResourceByCredentialGroup(resource, group))
      .filter((resource): resource is ProviderResource => resource !== null),
  }));
};

export const classifyCredentialGroupFilterState = ({
  filter,
  catalogReady,
  catalogGroups,
  matchingProviderCount,
  matchingOAuthCount,
}: {
  filter: string;
  catalogReady: boolean;
  catalogGroups: string[];
  matchingProviderCount: number;
  matchingOAuthCount: number;
}): CredentialGroupFilterState => {
  if (!credentialGroupKey(filter)) return 'inactive';
  if (
    catalogReady &&
    !catalogGroups.some((group) => credentialGroupKey(group) === credentialGroupKey(filter))
  ) {
    return 'stale';
  }
  if (matchingProviderCount > 0) return 'active';
  if (matchingOAuthCount > 0) return 'oauth-only';
  return 'empty';
};
