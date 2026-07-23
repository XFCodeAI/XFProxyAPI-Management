/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

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

export interface AuthFileItem {
  id?: string;
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  alias?: string;
  groups?: string[];
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  fallback?: boolean;
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
  revision?: number;
  inventory_id?: string;
}
