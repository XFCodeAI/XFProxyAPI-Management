export type ProxyPoolProtocol = 'http' | 'https' | 'socks5' | 'socks5h';

export interface ProxyPoolEntry {
  id: string;
  name: string;
  enabled: boolean;
  excludeFromSmartAssignment: boolean;
  protocol: ProxyPoolProtocol;
  host: string;
  port: string;
  username: string;
  password: string;
  note: string;
}

export type ProxyPoolUsageKind = 'global' | 'provider-key' | 'auth-file';

export interface ProxyPoolUsage {
  id: string;
  kind: ProxyPoolUsageKind;
  provider: string;
  target: string;
  proxyUrl: string;
}

export interface ProxyPoolAssignment {
  id: string;
  provider: string;
  label?: string;
  fileName?: string;
  email?: string;
}

export interface ProxyPoolAssignmentFailure {
  authId: string;
  error: string;
}

export interface ProxyPoolAutoAssignResult {
  status: 'ok' | 'partial';
  updated: number;
  skipped: number;
  failed: number;
  failures: ProxyPoolAssignmentFailure[];
  pools: ProxyPoolStatusEntry[];
}

export type ProxyPoolRebalanceReason =
  'worthwhile' | 'within_threshold' | 'already_balanced' | 'no_movable_bindings' | 'ineligible';

export interface ProxyPoolRebalancePreviewEntry {
  id: string;
  name: string;
  redactedUrl: string;
  eligible: boolean;
  ineligibleReason?: string;
  currentCount: number;
  targetCount: number;
  credentialCount: number;
  providerApiKeyCount: number;
}

export interface ProxyPoolRebalancePreview {
  eligible: boolean;
  worthwhile: boolean;
  reason: ProxyPoolRebalanceReason;
  maxDifference: number;
  currentDifference: number;
  moveCount: number;
  totalBindings: number;
  revision: string;
  pools: ProxyPoolRebalancePreviewEntry[];
}

export interface ProxyPoolRebalanceFailure {
  resourceId: string;
  kind: string;
  error: string;
}

export interface ProxyPoolRebalanceResult {
  status: 'ok' | 'noop' | 'stale' | 'rolled_back' | 'partial' | 'failed';
  moved: number;
  skipped: number;
  failed: number;
  failures: ProxyPoolRebalanceFailure[];
  preview: ProxyPoolRebalancePreview;
}

export interface ProxyPoolStatusEntry {
  id: string;
  name: string;
  enabled: boolean;
  excludeFromSmartAssignment: boolean;
  protocol: ProxyPoolProtocol;
  host: string;
  port: number;
  username: string;
  note: string;
  redactedUrl: string;
  configError?: string;
  checked: boolean;
  available: boolean;
  checkError?: string;
  lastChecked?: string;
  ip?: string;
  country?: string;
  region?: string;
  city?: string;
  location?: string;
  org?: string;
  timezone?: string;
  assignedCount: number;
  assignedTo: ProxyPoolAssignment[];
}

export type ProxySelectionMode = 'file' | 'smart' | 'proxy' | 'direct';

export interface ProxySelection {
  mode: ProxySelectionMode;
  proxyId?: string;
  proxyUrl?: string;
}

export interface ProxyPoolsConfigSnapshot {
  pools: ProxyPoolEntry[];
  globalProxyUrl: string;
  usages: ProxyPoolUsage[];
}
