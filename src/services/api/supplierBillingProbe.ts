import { apiClient } from './client';

const SUPPLIER_BILLING_PROBE_TIMEOUT_MS = 20 * 1000;

export type SupplierBillingProbeStatus = 'not_checked' | 'ok' | 'unsupported' | 'failed';

export interface SupplierUsageProbeEntry {
  status: SupplierBillingProbeStatus;
  is_valid?: boolean;
  remaining?: number;
  unit?: string;
  stale: boolean;
  received_at?: string;
  fresh_until?: string;
  last_attempt_at?: string;
  next_probe_at?: string;
  failure_count?: number;
  http_status?: number;
  last_error?: string;
}

export interface SupplierBillingMultiplier {
  schema_version: number;
  billing_scope: string;
  group_rate_multiplier: number;
  group_rate_multiplier_text: string;
  user_rate_multiplier?: number;
  user_rate_multiplier_text?: string;
  resolved_rate_multiplier: number;
  resolved_rate_multiplier_text: string;
  peak_rate_enabled: boolean;
  peak_start?: string;
  peak_end?: string;
  peak_rate_multiplier?: number;
  peak_rate_multiplier_text?: string;
  applied_peak_multiplier?: number;
  applied_peak_multiplier_text?: string;
  timezone?: string;
  effective_rate_multiplier: number;
  effective_rate_multiplier_text: string;
  observed_at: string;
}

export interface SupplierBillingProbeEntry {
  target_id: string;
  provider_brand: string;
  provider_name: string;
  provider_index: number;
  api_key_index: number;
  alias?: string;
  eligible: boolean;
  probing: boolean;
  stale: boolean;
  status: SupplierBillingProbeStatus;
  multiplier?: SupplierBillingMultiplier;
  received_at?: string;
  fresh_until?: string;
  last_attempt_at?: string;
  next_probe_at?: string;
  failure_count?: number;
  http_status?: number;
  last_error?: string;
  usage?: SupplierUsageProbeEntry;
}

export interface SupplierBillingProbeResponse {
  provider_name: string;
  entries: SupplierBillingProbeEntry[];
}

export const supplierBillingProbeApi = {
  list: (resourceKeys?: readonly string[]) => {
    const normalizedResourceKeys = Array.from(
      new Set((resourceKeys ?? []).map((value) => value.trim()).filter(Boolean))
    ).sort();
    return apiClient.get<SupplierBillingProbeResponse>('/supplier-billing-probes', {
      ...(normalizedResourceKeys.length > 0
        ? { params: { resource_keys: normalizedResourceKeys.join(',') } }
        : {}),
      timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS,
    });
  },
  probe: (targetId: string) =>
    apiClient.post<SupplierBillingProbeEntry>(
      '/supplier-billing-probes',
      { target_id: targetId },
      { timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS }
    ),
};
