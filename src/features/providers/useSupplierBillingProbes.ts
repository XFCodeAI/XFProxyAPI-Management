import { useMemo } from 'react';
import {
  supplierBillingProbeApi,
  type SupplierAvailabilityReprobeResponse,
  type SupplierBillingProbeEntry,
} from '@/services/api/supplierBillingProbe';
import { useSupplierBillingProbeStore } from '@/stores/useSupplierBillingProbeStore';
import type { ProviderResource } from './types';

export { mergeSupplierBillingProbeReadEntries } from '@/stores/useSupplierBillingProbeStore';

export type SupplierBillingProbeEntriesByResource = Readonly<
  Record<string, readonly SupplierBillingProbeEntry[]>
>;

export const supplierBillingResourceKey = (providerBrand: string, providerIndex: number): string =>
  `${providerBrand}:${providerIndex}`;

export function supplierBillingSourceKeys(resource: ProviderResource): string[] {
  if (resource.selector.brand === 'kimi') {
    return [
      ...resource.selector.openaiIndices.map((index) =>
        supplierBillingResourceKey('openaiCompatibility', index)
      ),
      ...resource.selector.claudeIndices.map((index) =>
        supplierBillingResourceKey('claude', index)
      ),
    ];
  }
  if (
    resource.brand === 'codex' ||
    resource.brand === 'claude' ||
    resource.brand === 'xai' ||
    resource.brand === 'openaiCompatibility'
  ) {
    return [supplierBillingResourceKey(resource.brand, resource.originalIndex)];
  }
  return [];
}

export const isSupplierBillingProbeResource = (resource: ProviderResource): boolean =>
  supplierBillingSourceKeys(resource).length > 0;

export function groupSupplierBillingProbeEntries(
  entries: readonly SupplierBillingProbeEntry[]
): SupplierBillingProbeEntriesByResource {
  const grouped: Record<string, SupplierBillingProbeEntry[]> = {};
  entries.forEach((entry) => {
    const key = supplierBillingResourceKey(entry.provider_brand, entry.provider_index);
    (grouped[key] ??= []).push(entry);
  });
  Object.values(grouped).forEach((items) => {
    items.sort((left, right) => left.api_key_index - right.api_key_index);
  });
  return grouped;
}

const kimiBillingAlias = (entry: SupplierBillingProbeEntry): string => {
  const protocol = entry.provider_brand === 'claude' ? 'Claude' : 'OpenAI';
  const alias = entry.alias?.trim();
  return alias ? `${protocol} / ${alias}` : protocol;
};

export function mapSupplierBillingProbeEntriesToResources(
  entries: readonly SupplierBillingProbeEntry[],
  resources: readonly ProviderResource[]
): SupplierBillingProbeEntriesByResource {
  const entriesBySource = groupSupplierBillingProbeEntries(entries);
  const mapped: Record<string, SupplierBillingProbeEntry[]> = {};

  resources.forEach((resource) => {
    const resourceEntries = supplierBillingSourceKeys(resource).flatMap((sourceKey) => {
      const sourceEntries = entriesBySource[sourceKey] ?? [];
      const visibleEntries = resource.billingTargets
        ? sourceEntries.filter((entry) =>
            resource.billingTargets?.some(
              (target) =>
                supplierBillingResourceKey(target.providerBrand, target.providerIndex) ===
                  sourceKey && target.apiKeyIndexes.includes(entry.api_key_index)
            )
          )
        : sourceEntries;
      return visibleEntries.map((entry) =>
        resource.brand === 'kimi' ? { ...entry, alias: kimiBillingAlias(entry) } : entry
      );
    });
    if (resourceEntries.length > 0) {
      mapped[supplierBillingResourceKey(resource.brand, resource.originalIndex)] = resourceEntries;
    }
  });

  return mapped;
}

export async function loadSupplierBillingProbeEntries(
  resourceKeys: ReadonlySet<string>
): Promise<SupplierBillingProbeEntry[]> {
  const response = await supplierBillingProbeApi.list(Array.from(resourceKeys));
  return response.entries.filter((entry) =>
    resourceKeys.has(supplierBillingResourceKey(entry.provider_brand, entry.provider_index))
  );
}

interface UseSupplierBillingProbesOptions {
  enabled: boolean;
  resources: readonly ProviderResource[];
}

interface UseSupplierBillingProbesResult {
  entriesByResource: SupplierBillingProbeEntriesByResource;
  isFetching: boolean;
  refetch: () => Promise<void>;
  refreshTarget: (targetId: string) => Promise<void>;
  recoverSupplier: (supplierId: string) => Promise<SupplierAvailabilityReprobeResponse>;
  recoveringSupplierIds: ReadonlySet<string>;
}

export function useSupplierBillingProbes({
  enabled,
  resources,
}: UseSupplierBillingProbesOptions): UseSupplierBillingProbesResult {
  const entries = useSupplierBillingProbeStore((state) => state.entries);
  const isFetching = useSupplierBillingProbeStore((state) => state.loading);
  const refetch = useSupplierBillingProbeStore((state) => state.refresh);
  const refreshTarget = useSupplierBillingProbeStore((state) => state.refreshTarget);
  const recoverSupplier = useSupplierBillingProbeStore((state) => state.recoverSupplier);
  const recoveringSupplierIdList = useSupplierBillingProbeStore(
    (state) => state.recoveringSupplierIds
  );
  const resourceKeyList = Array.from(
    new Set(resources.flatMap((resource) => supplierBillingSourceKeys(resource)))
  ).sort();
  const scopeKey = resourceKeyList.join('\u0000');
  const resourceKeys = useMemo(() => new Set(scopeKey ? scopeKey.split('\u0000') : []), [scopeKey]);

  const visibleEntries = useMemo(
    () =>
      enabled
        ? entries.filter((entry) =>
            resourceKeys.has(supplierBillingResourceKey(entry.provider_brand, entry.provider_index))
          )
        : [],
    [enabled, entries, resourceKeys]
  );

  const entriesByResource = useMemo(
    () => mapSupplierBillingProbeEntriesToResources(visibleEntries, resources),
    [resources, visibleEntries]
  );
  const recoveringSupplierIds = useMemo(
    () => new Set(recoveringSupplierIdList),
    [recoveringSupplierIdList]
  );

  return {
    entriesByResource,
    isFetching,
    refetch,
    refreshTarget,
    recoverSupplier,
    recoveringSupplierIds,
  };
}
