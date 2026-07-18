import { apiClient } from './client';
import { computeApiUrl, normalizeApiBase } from '@/utils/connection';
import { isRecord } from '@/utils/helpers';

export type MigrationTransferStatus =
  'staging' | 'staged' | 'applying' | 'completed' | 'failed' | 'canceled';

export interface MigrationDomainInventory {
  id: string;
  records: number;
  logical_records?: number;
  bindings?: number;
  status: string;
}

export interface MigrationInventory {
  schema_version: number;
  storage_backend: string;
  inventory_id?: string;
  revision?: number;
  domains: MigrationDomainInventory[];
  warnings?: Array<{ code: string }>;
}

export interface MigrationSealStatus {
  sealed: boolean;
  generation: number;
  active_mutations: number;
  expires_at?: string;
}

export interface MigrationPreflightSource {
  capability: Record<string, unknown>;
  inventory: MigrationInventory;
  seal: MigrationSealStatus;
  snapshot_bytes: number;
  plugins?: Array<Record<string, unknown>>;
  validation_issues?: MigrationIssue[];
}

export interface MigrationIssue {
  code: string;
  domain?: string;
}

export interface MigrationDomainReplacement {
  id: string;
  source: MigrationDomainInventory;
  destination: MigrationDomainInventory;
  action: string;
}

export interface MigrationPreflightResult {
  status: 'ready' | 'blocked';
  confirmation_required: boolean;
  blocking?: MigrationIssue[];
  warnings?: MigrationIssue[];
  replacement: MigrationDomainReplacement[];
}

export interface MigrationPreflightJob {
  id: string;
  created_at: string;
  result: MigrationPreflightResult;
}

export interface MigrationTransferJob {
  id: string;
  preflight_job_id: string;
  source_url: string;
  status: MigrationTransferStatus;
  error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface SourceSealResponse {
  status: string;
  seal: MigrationSealStatus;
  pending_oauth?: number;
}

export function normalizeMigrationSourceEndpoint(value: string): string {
  const normalized = normalizeApiBase(value);
  if (!normalized) {
    throw new Error('migration_source_required');
  }
  const parsed = new URL(normalized);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    throw new Error('migration_source_invalid');
  }
  return parsed.origin;
}

async function sourceMigrationRequest<T>(
  sourceEndpoint: string,
  managementKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const key = managementKey.trim();
  if (!key) {
    throw new Error('migration_source_key_required');
  }
  const base = computeApiUrl(normalizeMigrationSourceEndpoint(sourceEndpoint));
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';
    throw new Error(message || `migration_source_http_${response.status}`);
  }
  return payload as T;
}

export const sourceMigrationApi = {
  seal: (sourceEndpoint: string, managementKey: string) =>
    sourceMigrationRequest<SourceSealResponse>(
      sourceEndpoint,
      managementKey,
      '/migrations/source-seal',
      { method: 'POST' }
    ),

  heartbeat: (sourceEndpoint: string, managementKey: string, generation: number) =>
    sourceMigrationRequest<SourceSealResponse>(
      sourceEndpoint,
      managementKey,
      '/migrations/source-seal',
      { method: 'PATCH', body: JSON.stringify({ generation }) }
    ),

  release: (sourceEndpoint: string, managementKey: string, generation: number) =>
    sourceMigrationRequest<SourceSealResponse>(
      sourceEndpoint,
      managementKey,
      `/migrations/source-seal?generation=${encodeURIComponent(String(generation))}`,
      { method: 'DELETE' }
    ),

  preflightSource: (sourceEndpoint: string, managementKey: string) =>
    sourceMigrationRequest<MigrationPreflightSource>(
      sourceEndpoint,
      managementKey,
      '/migrations/preflight-source'
    ),
};

export const migrationApi = {
  createPreflight: (source: MigrationPreflightSource) =>
    apiClient.post<{ job: MigrationPreflightJob }>('/migrations/preflight', {
      source,
      confirm_replace: true,
    }),

  startTransfer: (payload: {
    preflightJobID: string;
    sourceURL: string;
    sourceManagementKey: string;
  }) =>
    apiClient.post<{ job: MigrationTransferJob }>('/migrations/transfers', {
      preflight_job_id: payload.preflightJobID,
      source_url: payload.sourceURL,
      source_management_key: payload.sourceManagementKey,
    }),

  getTransfer: (id: string) =>
    apiClient.get<{ job: MigrationTransferJob }>(`/migrations/transfers/${id}`),

  resumeTransfer: (id: string) =>
    apiClient.post<{ job: MigrationTransferJob }>(`/migrations/transfers/${id}/resume`),

  cancelTransfer: (id: string) =>
    apiClient.delete<{ status: string }>(`/migrations/transfers/${id}`),
};
