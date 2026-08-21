/**
 * Authentication file types.
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';
import type { ConcurrencyMode } from './concurrency';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileCredentialIdentity {
  name: string;
  credentialId?: string | null;
  authIndex?: string | number | null;
  credentialGeneration?: number | null;
}

export interface AuthFileItem {
  id?: string;
  credentialId?: string;
  credential_id?: string;
  credentialGeneration?: number;
  credential_generation?: number;
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  alias?: string;
  planType?: string;
  plan_type?: string;
  chatgptPlanType?: string;
  chatgpt_plan_type?: string;
  id_token?: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  groups?: string[];
  size?: number;
  authIndex?: string | number | null;
  auth_index?: string | number | null;
  runtimeOnly?: boolean | string;
  fallback?: boolean;
  weight?: number | string | null;
  concurrencyMode?: ConcurrencyMode;
  concurrency_mode?: ConcurrencyMode;
  'concurrency-mode'?: ConcurrencyMode;
  maxConcurrency?: number;
  max_concurrency?: number;
  'max-concurrency'?: number;
  disableCooling?: boolean | null;
  disable_cooling?: boolean | null;
  'disable-cooling'?: boolean | string | number | null;
  disabled?: boolean;
  unavailable?: boolean;
  assignable?: boolean;
  proxySupported?: boolean;
  proxy_supported?: boolean;
  proxySupportStatus?: string;
  proxy_support_status?: string;
  admission?: 'builtin' | 'plugin' | string;
  status?: string;
  statusMessage?: string;
  statusCode?: number | string;
  status_code?: number | string;
  errorStatus?: number | string;
  error_status?: number | string;
  updatedAt?: string | number;
  updated_at?: string | number;
  updatedAtMs?: string | number;
  updated_at_ms?: string | number;
  modtime?: string | number;
  lastRefresh?: string | number;
  modified?: number;
  success?: unknown;
  failed?: unknown;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
  limit?: number;
  next_cursor?: string;
  has_more?: boolean;
  provider_totals?: Record<string, number>;
  group_totals?: Record<string, number>;
  revision?: number;
  inventory_id?: string;
}
