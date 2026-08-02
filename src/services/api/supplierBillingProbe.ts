import { apiClient } from './client';

const SUPPLIER_BILLING_PROBE_TIMEOUT_MS = 20 * 1000;

export type SupplierBillingProbeStatus = 'not_checked' | 'ok' | 'unsupported' | 'failed';

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
  provider_name: string;
  api_key_index: number;
  alias?: string;
  status: SupplierBillingProbeStatus;
  multiplier?: SupplierBillingMultiplier;
  received_at?: string;
  last_attempt_at?: string;
  http_status?: number;
  last_error?: string;
}

export interface SupplierBillingProbeResponse {
  provider_name: string;
  entries: SupplierBillingProbeEntry[];
}

export const supplierBillingProbeApi = {
  list: (providerName: string) =>
    apiClient.get<SupplierBillingProbeResponse>('/supplier-billing-probes', {
      params: { provider_name: providerName },
      timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS,
    }),
  probe: (providerName: string, apiKeyIndex: number) =>
    apiClient.post<SupplierBillingProbeEntry>(
      '/supplier-billing-probes',
      { provider_name: providerName, api_key_index: apiKeyIndex },
      { timeout: SUPPLIER_BILLING_PROBE_TIMEOUT_MS }
    ),
};
