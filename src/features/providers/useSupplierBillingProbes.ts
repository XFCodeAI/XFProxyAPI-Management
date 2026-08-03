import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  supplierBillingProbeApi,
  type SupplierBillingProbeEntry,
} from '@/services/api/supplierBillingProbe';
import type { ProviderResource } from './types';

const SUPPLIER_BILLING_POLL_INTERVAL_MS = 1_000;
const SUPPLIER_BILLING_DUPLICATE_READ_WINDOW_MS = 250;
const SUPPLIER_BILLING_MAX_TIMER_MS = 2_147_000_000;

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

export const shouldPollSupplierBillingProbes = (
  entries: readonly SupplierBillingProbeEntry[]
): boolean =>
  entries.some(
    (entry) =>
      entry.eligible &&
      (entry.probing || entry.status === 'not_checked' || entry.usage?.status === 'not_checked')
  );

const parseProbeTime = (value?: string): number | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export function supplierBillingProbeRefreshDelay(
  entries: readonly SupplierBillingProbeEntry[],
  now = Date.now()
): number | null {
  if (shouldPollSupplierBillingProbes(entries)) return SUPPLIER_BILLING_POLL_INTERVAL_MS;

  let nearest = Number.POSITIVE_INFINITY;
  entries.forEach((entry) => {
    if (!entry.eligible) return;
    [entry.next_probe_at, entry.usage?.next_probe_at].forEach((value) => {
      const timestamp = parseProbeTime(value);
      if (timestamp !== null && timestamp < nearest) nearest = timestamp;
    });
  });
  if (!Number.isFinite(nearest)) return null;
  return Math.min(
    SUPPLIER_BILLING_MAX_TIMER_MS,
    Math.max(SUPPLIER_BILLING_POLL_INTERVAL_MS, nearest - now)
  );
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
}

export function useSupplierBillingProbes({
  enabled,
  resources,
}: UseSupplierBillingProbesOptions): UseSupplierBillingProbesResult {
  const resourceKeyList = Array.from(
    new Set(resources.flatMap((resource) => supplierBillingSourceKeys(resource)))
  ).sort();
  const scopeKey = resourceKeyList.join('\u0000');
  const resourceKeys = useMemo(() => new Set(scopeKey ? scopeKey.split('\u0000') : []), [scopeKey]);
  const [entries, setEntries] = useState<SupplierBillingProbeEntry[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );
  const resultGenerationRef = useRef(0);
  const activeReadRef = useRef<{
    scopeKey: string;
    request: Promise<SupplierBillingProbeEntry[]>;
  } | null>(null);
  const lastReadRef = useRef<{
    scopeKey: string;
    completedAt: number;
    entries: SupplierBillingProbeEntry[];
  } | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || resourceKeys.size === 0) {
      setEntries([]);
      return;
    }
    if (!pageVisible) return;
    const resultGeneration = ++resultGenerationRef.current;
    setPendingRequests((count) => count + 1);
    try {
      const activeRead = activeReadRef.current;
      let nextEntries: SupplierBillingProbeEntry[];
      if (activeRead?.scopeKey === scopeKey) {
        nextEntries = await activeRead.request;
      } else {
        const lastRead = lastReadRef.current;
        if (
          lastRead?.scopeKey === scopeKey &&
          Date.now() - lastRead.completedAt < SUPPLIER_BILLING_DUPLICATE_READ_WINDOW_MS
        ) {
          nextEntries = lastRead.entries;
        } else {
          const request = loadSupplierBillingProbeEntries(resourceKeys);
          activeReadRef.current = { scopeKey, request };
          try {
            nextEntries = await request;
            lastReadRef.current = {
              scopeKey,
              completedAt: Date.now(),
              entries: nextEntries,
            };
          } finally {
            if (activeReadRef.current?.request === request) {
              activeReadRef.current = null;
            }
          }
        }
      }
      if (resultGeneration === resultGenerationRef.current) {
        setEntries(nextEntries);
      }
    } finally {
      setPendingRequests((count) => Math.max(0, count - 1));
    }
  }, [enabled, pageVisible, resourceKeys, scopeKey]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisibilityChange = () => {
      setPageVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    resultGenerationRef.current += 1;
    setEntries([]);
  }, [enabled, scopeKey]);

  useEffect(() => {
    if (!enabled || !pageVisible || resourceKeys.size === 0) return;
    void refetch().catch(() => undefined);
  }, [enabled, pageVisible, refetch, resourceKeys.size, scopeKey]);

  const refreshDelay = useMemo(() => supplierBillingProbeRefreshDelay(entries), [entries]);
  useEffect(() => {
    if (!enabled || !pageVisible || refreshDelay === null) return undefined;
    const timer = window.setTimeout(() => {
      void refetch().catch(() => undefined);
    }, refreshDelay);
    return () => window.clearTimeout(timer);
  }, [enabled, pageVisible, refetch, refreshDelay]);

  const refreshTarget = useCallback(async (targetId: string) => {
    const resultGeneration = ++resultGenerationRef.current;
    setEntries((current) =>
      current.map((entry) => (entry.target_id === targetId ? { ...entry, probing: true } : entry))
    );
    try {
      const result = await supplierBillingProbeApi.probe(targetId);
      if (resultGeneration === resultGenerationRef.current) {
        setEntries((current) =>
          current.map((entry) => (entry.target_id === targetId ? result : entry))
        );
      }
    } catch (error) {
      if (resultGeneration === resultGenerationRef.current) {
        setEntries((current) =>
          current.map((entry) =>
            entry.target_id === targetId ? { ...entry, probing: false } : entry
          )
        );
      }
      throw error;
    }
  }, []);

  const entriesByResource = useMemo(
    () => mapSupplierBillingProbeEntriesToResources(entries, resources),
    [entries, resources]
  );

  return {
    entriesByResource,
    isFetching: pendingRequests > 0,
    refetch,
    refreshTarget,
  };
}
