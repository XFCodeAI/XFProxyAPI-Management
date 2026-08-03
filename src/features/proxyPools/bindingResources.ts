import type { ProxyPoolAssignableResource } from '@/types';

export interface ProxyPoolSupplierGroup {
  id: string;
  provider: string;
  alias: string;
  resources: ProxyPoolAssignableResource[];
}

export interface ProxyPoolBindingResourceGroups {
  credentials: ProxyPoolAssignableResource[];
  suppliers: ProxyPoolSupplierGroup[];
}

function resourceLabel(resource: ProxyPoolAssignableResource): string {
  return resource.keyAlias || resource.alias || resource.label || resource.maskedIdentity || '';
}

export function groupProxyPoolBindingResources(
  resources: ProxyPoolAssignableResource[]
): ProxyPoolBindingResourceGroups {
  const credentials = resources
    .filter((resource) => resource.kind === 'credential')
    .sort((left, right) => resourceLabel(left).localeCompare(resourceLabel(right)));
  const supplierMap = new Map<string, ProxyPoolSupplierGroup>();

  resources
    .filter((resource) => resource.kind === 'provider_api_key')
    .forEach((resource) => {
      const id = resource.supplierId || `${resource.provider}:${resource.supplierAlias || ''}`;
      const current = supplierMap.get(id);
      if (current) {
        current.resources.push(resource);
        return;
      }
      supplierMap.set(id, {
        id,
        provider: resource.provider,
        alias: resource.supplierAlias || resource.alias || resource.provider,
        resources: [resource],
      });
    });

  const suppliers = Array.from(supplierMap.values())
    .map((supplier) => ({
      ...supplier,
      resources: supplier.resources.sort((left, right) =>
        resourceLabel(left).localeCompare(resourceLabel(right))
      ),
    }))
    .sort((left, right) =>
      `${left.alias}:${left.provider}`.localeCompare(`${right.alias}:${right.provider}`)
    );

  return { credentials, suppliers };
}

export function assignedProxyPoolResourceIDs(
  resources: ProxyPoolAssignableResource[],
  poolId: string
): string[] {
  return resources
    .filter((resource) => resource.proxySupported && resource.currentPoolId === poolId)
    .map((resource) => resource.resourceId);
}

export function setProxyPoolResourceSelection(
  current: Set<string>,
  resourceIds: Iterable<string>,
  selected: boolean
): Set<string> {
  const next = new Set(current);
  for (const resourceId of resourceIds) {
    if (selected) {
      next.add(resourceId);
    } else {
      next.delete(resourceId);
    }
  }
  return next;
}
