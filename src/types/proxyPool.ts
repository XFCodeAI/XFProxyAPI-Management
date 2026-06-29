export type ProxyPoolProtocol = 'http' | 'https' | 'socks5' | 'socks5h';

export interface ProxyPoolEntry {
  id: string;
  name: string;
  enabled: boolean;
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

export interface ProxyPoolStatusEntry {
  id: string;
  name: string;
  enabled: boolean;
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
