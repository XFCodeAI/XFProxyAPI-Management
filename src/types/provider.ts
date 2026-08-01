/**
 * AI provider types.
 * Based on the original src/modules/ai-providers.js module.
 */

export interface ModelAlias {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  thinking?: Record<string, unknown>;
}

export type ProviderConnectivityStatus = 'unknown' | 'reachable' | 'unreachable';
export type ProviderSchedulingStatus =
  | 'ready'
  | 'disabled'
  | 'disabled_by_wildcard'
  | 'no_effective_model'
  | 'cooling'
  | 'unavailable'
  | 'not_registered';

export interface ProviderRuntimeStatus {
  connectivity: ProviderConnectivityStatus;
  scheduling: ProviderSchedulingStatus;
  ready: boolean;
  nextRetryAfter?: string;
}

export interface ApiKeyEntry {
  name?: string;
  apiKey: string;
  proxyUrl?: string;
  authIndex?: string;
  groups?: string[];
  runtimeStatus?: ProviderRuntimeStatus;
}

export interface CloakConfig {
  mode?: string;
  strictMode?: boolean;
  sensitiveWords?: string[];
  cacheUserId?: boolean;
}

export type OpenAIProviderProtocolMode = 'chat-completions' | 'preserve-openai';
export type OpenAIProviderRetryOwner = 'xfpa' | 'upstream';

export interface GeminiKeyConfig {
  name?: string;
  apiKey: string;
  groups?: string[];
  priority?: number;
  fallback?: boolean;
  prefix?: string;
  baseUrl?: string;
  proxyUrl?: string;
  models?: ModelAlias[];
  headers?: Record<string, string>;
  excludedModels?: string[];
  disableCooling?: boolean;
  authIndex?: string;
  runtimeStatus?: ProviderRuntimeStatus;
}

export interface ProviderKeyConfig {
  name?: string;
  apiKey: string;
  groups?: string[];
  priority?: number;
  fallback?: boolean;
  prefix?: string;
  baseUrl?: string;
  websockets?: boolean;
  proxyUrl?: string;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  excludedModels?: string[];
  disableCooling?: boolean;
  cloak?: CloakConfig;
  experimentalCchSigning?: boolean;
  authIndex?: string;
  runtimeStatus?: ProviderRuntimeStatus;
}

export interface OpenAIProviderConfig {
  name: string;
  prefix?: string;
  baseUrl: string;
  protocolMode?: OpenAIProviderProtocolMode;
  retryOwner?: OpenAIProviderRetryOwner;
  apiKeyEntries: ApiKeyEntry[];
  disabled?: boolean;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  priority?: number;
  fallback?: boolean;
  testModel?: string;
  disableCooling?: boolean;
  authIndex?: string;
  runtimeStatus?: ProviderRuntimeStatus;
  [key: string]: unknown;
}
