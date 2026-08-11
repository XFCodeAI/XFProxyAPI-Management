import type {
  SupplierBillingProbeEntry,
  SupplierRuntimeAvailabilityState,
} from '@/services/api/supplierBillingProbe';

export type SupplierRecoveryControlReason =
  'ready' | 'recover' | 'probing' | 'disabled' | 'missing_runtime' | 'unsupported';

export interface SupplierRecoveryControlState {
  supplierIds: string[];
  reason: SupplierRecoveryControlReason;
  disabled: boolean;
}

export const getSupplierRecoveryControlState = (
  entries: readonly SupplierBillingProbeEntry[],
  resourceDisabled: boolean,
  recoveringSupplierIds: ReadonlySet<string>,
  aggregateState: SupplierRuntimeAvailabilityState | 'unknown' = 'unknown'
): SupplierRecoveryControlState => {
  const supplierIds = Array.from(
    new Set(entries.map((entry) => entry.supplier_id.trim()).filter(Boolean))
  ).sort();
  const runtimeStates = entries.flatMap((entry) =>
    entry.runtime ? [entry.runtime.availability_state] : []
  );
  if (resourceDisabled || aggregateState === 'disabled' || runtimeStates.includes('disabled')) {
    return { supplierIds, reason: 'disabled', disabled: true };
  }
  if (
    entries.length === 0 ||
    supplierIds.length === 0 ||
    entries.every((entry) => !entry.eligible)
  ) {
    return { supplierIds, reason: 'unsupported', disabled: true };
  }
  if (entries.every((entry) => !entry.runtime)) {
    return { supplierIds, reason: 'missing_runtime', disabled: true };
  }
  if (
    supplierIds.some((supplierId) => recoveringSupplierIds.has(supplierId)) ||
    aggregateState === 'probing' ||
    runtimeStates.includes('probing')
  ) {
    return { supplierIds, reason: 'probing', disabled: true };
  }
  const recoverableEntries = entries.filter((entry) => entry.eligible && entry.runtime);
  const ready =
    recoverableEntries.length > 0 &&
    recoverableEntries.every((entry) => entry.runtime?.availability_state === 'ready');
  return { supplierIds, reason: ready ? 'ready' : 'recover', disabled: false };
};
