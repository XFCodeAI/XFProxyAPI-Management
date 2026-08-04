import type { AuthFileItem, OpenAIProviderConfig } from '@/types';
import type {
  RuntimeAvailabilityCounts,
  RuntimeAvailabilityState,
  RuntimeObservationResource,
} from '@/types/runtimeObservation';
import {
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestAuthIndex,
} from '@/utils/recentRequests';
import { runtimeObservationResourceKey } from '@/stores/useRuntimeObservationStore';
import type { ProviderResource, SponsorProviderRaw } from '@/features/providers/types';

const normalizedAuthIndex = (value: unknown): string =>
  normalizeRecentRequestAuthIndex(value) ?? '';

const collectOpenAIAuthIndexes = (config: OpenAIProviderConfig): string[] =>
  (config.apiKeyEntries ?? []).map((entry) => normalizedAuthIndex(entry.authIndex)).filter(Boolean);

export const collectProviderRuntimeAuthIndexes = (resource: ProviderResource): string[] => {
  if (resource.brand === 'openaiCompatibility') {
    return collectOpenAIAuthIndexes((resource.usageRaw ?? resource.raw) as OpenAIProviderConfig);
  }
  if (resource.brand === 'kimi') {
    const raw = (resource.billingRaw ?? resource.raw) as SponsorProviderRaw;
    return [
      ...raw.openai.flatMap((item) => collectOpenAIAuthIndexes(item.config)),
      ...raw.claude.map((item) => normalizedAuthIndex(item.config.authIndex)),
    ].filter(Boolean);
  }
  return resource.authIndex ? [normalizedAuthIndex(resource.authIndex)].filter(Boolean) : [];
};

export const buildRuntimeCredentialIDByAuthIndex = (files: AuthFileItem[]): Map<string, string> => {
  const result = new Map<string, string>();
  files.forEach((file) => {
    const authIndex = normalizedAuthIndex(file.auth_index ?? file.authIndex);
    const id = String(file.id ?? '').trim();
    if (authIndex && id) result.set(authIndex, id);
  });
  return result;
};

export const getRuntimeCredentialByAuthIndex = (
  authIndex: unknown,
  credentialIDByAuthIndex: ReadonlyMap<string, string>,
  resourcesByKey: Record<string, RuntimeObservationResource>,
  credentialsByAuthIndex: Readonly<Record<string, RuntimeObservationResource>> = {}
): RuntimeObservationResource | null => {
  const normalizedIndex = normalizedAuthIndex(authIndex);
  if (!normalizedIndex) return null;
  const runtimeCredential = credentialsByAuthIndex[normalizedIndex];
  if (runtimeCredential) return runtimeCredential;
  const credentialID = credentialIDByAuthIndex.get(normalizedIndex);
  if (!credentialID) return null;
  return resourcesByKey[runtimeObservationResourceKey('credential', credentialID)] ?? null;
};

export const getProviderRuntimeCredentials = (
  resource: ProviderResource,
  files: AuthFileItem[],
  resourcesByKey: Record<string, RuntimeObservationResource>,
  credentialsByAuthIndex: Readonly<Record<string, RuntimeObservationResource>> = {}
): RuntimeObservationResource[] => {
  const credentialIDByAuthIndex = buildRuntimeCredentialIDByAuthIndex(files);
  const seen = new Set<string>();
  return collectProviderRuntimeAuthIndexes(resource).flatMap((authIndex) => {
    const credential = getRuntimeCredentialByAuthIndex(
      authIndex,
      credentialIDByAuthIndex,
      resourcesByKey,
      credentialsByAuthIndex
    );
    if (!credential || seen.has(credential.id)) return [];
    seen.add(credential.id);
    return [credential];
  });
};

const aggregateMaximum = (resources: RuntimeObservationResource[]): number => {
  if (resources.length === 0 || resources.some((resource) => resource.maximum === 0)) return 0;
  return resources.reduce((total, resource) => total + resource.maximum, 0);
};

const availabilityRank: Record<RuntimeAvailabilityState, number> = {
  unknown: -1,
  ready: 0,
  half_open: 1,
  transient_throttled: 2,
  usage_wait: 3,
  probing: 4,
  disabled: 5,
  auth_invalid: 6,
};

const aggregateAvailabilityCounts = (
  resources: RuntimeObservationResource[]
): RuntimeAvailabilityCounts =>
  resources.reduce<RuntimeAvailabilityCounts>(
    (counts, item) => ({
      ready: counts.ready + item.availabilityCounts.ready,
      transientThrottled: counts.transientThrottled + item.availabilityCounts.transientThrottled,
      usageWait: counts.usageWait + item.availabilityCounts.usageWait,
      probing: counts.probing + item.availabilityCounts.probing,
      halfOpen: counts.halfOpen + item.availabilityCounts.halfOpen,
      authInvalid: counts.authInvalid + item.availabilityCounts.authInvalid,
      disabled: counts.disabled + item.availabilityCounts.disabled,
    }),
    {
      ready: 0,
      transientThrottled: 0,
      usageWait: 0,
      probing: 0,
      halfOpen: 0,
      authInvalid: 0,
      disabled: 0,
    }
  );

const dominantAvailability = (
  resources: RuntimeObservationResource[]
): RuntimeObservationResource | null =>
  resources.reduce<RuntimeObservationResource | null>((current, candidate) => {
    if (!current) return candidate;
    const currentRank = availabilityRank[current.availabilityState];
    const candidateRank = availabilityRank[candidate.availabilityState];
    if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;
    const currentDeadline = Date.parse(current.availabilityDeadline);
    const candidateDeadline = Date.parse(candidate.availabilityDeadline);
    if (Number.isFinite(candidateDeadline) && !Number.isFinite(currentDeadline)) return candidate;
    if (
      Number.isFinite(candidateDeadline) &&
      Number.isFinite(currentDeadline) &&
      candidateDeadline < currentDeadline
    ) {
      return candidate;
    }
    return current;
  }, null);

export const getProviderRuntimeObservation = (
  resource: ProviderResource,
  files: AuthFileItem[],
  resourcesByKey: Record<string, RuntimeObservationResource>,
  credentialsByAuthIndex: Readonly<Record<string, RuntimeObservationResource>> = {}
): RuntimeObservationResource | null => {
  const credentials = getProviderRuntimeCredentials(
    resource,
    files,
    resourcesByKey,
    credentialsByAuthIndex
  );
  if (credentials.length === 0) return null;
  const suppliers = new Map<string, RuntimeObservationResource>();
  credentials.forEach((credential) => {
    const supplierID = credential.supplierId || credential.parentId;
    const supplier = resourcesByKey[runtimeObservationResourceKey('supplier', supplierID)];
    if (supplier) suppliers.set(supplier.id, supplier);
  });
  const capacityResources = suppliers.size > 0 ? Array.from(suppliers.values()) : credentials;
  const availability = dominantAvailability(capacityResources);
  return {
    id: resource.id,
    authIndex: '',
    scope: 'supplier',
    parentId: '',
    provider: credentials[0]?.provider ?? '',
    supplierId: Array.from(suppliers.keys()).join(','),
    name: resource.name ?? resource.identifier,
    inFlight: capacityResources.reduce((total, item) => total + item.inFlight, 0),
    maximum: aggregateMaximum(capacityResources),
    queued: capacityResources.reduce((total, item) => total + item.queued, 0),
    success: credentials.reduce((total, item) => total + item.success, 0),
    failed: credentials.reduce((total, item) => total + item.failed, 0),
    recentRequests: mergeRecentRequestBucketGroups(
      credentials.map((credential) => credential.recentRequests)
    ),
    availabilityState: availability?.availabilityState ?? 'unknown',
    availabilityModel: availability?.availabilityModel ?? '',
    availabilityDeadline: availability?.availabilityDeadline ?? '',
    availabilityUpdatedAt: availability?.availabilityUpdatedAt ?? '',
    availabilityCounts: aggregateAvailabilityCounts(capacityResources),
  };
};
