/**
 * AI provider types.
 * Based on the original src/modules/ai-providers.js module.
 */

import type { ConcurrencyMode } from './concurrency';

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
  weight?: number;
  proxyUrl?: string;
  authIndex?: string;
  groups?: string[];
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;
  runtimeStatus?: ProviderRuntimeStatus;
}

export interface CloakConfig {
  mode?: string;
  strictMode?: boolean;
  sensitiveWords?: string[];
  cacheUserId?: boolean;
}

export type OpenAIProviderProtocolMode = 'chat-completions' | 'preserve-openai' | 'auto';
export type OpenAIProviderRetryOwner = 'xfpa' | 'upstream';
export type ClaudeAuthMode = 'x-api-key' | 'bearer';

export interface CodexImageRouteConfig {
  enabled: boolean;
  targetSupplier: string;
  targetModel: string;
}

export interface GeminiKeyConfig {
  name?: string;
  apiKey: string;
  groups?: string[];
  priority?: number;
  weight?: number;
  fallback?: boolean;
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;
  prefix?: string;
  baseUrl?: string;
  proxyUrl?: string;
  models?: ModelAlias[];
  headers?: Record<string, string>;
  excludedModels?: string[];
  disableCooling?: boolean | null;
  consecutive429Threshold?: number;
  authIndex?: string;
  runtimeStatus?: ProviderRuntimeStatus;
}

export interface InteractionsKeyConfig extends GeminiKeyConfig {
  requestRetry?: number;
}

export interface ProviderKeyConfig {
  name?: string;
  apiKey: string;
  groups?: string[];
  priority?: number;
  weight?: number;
  fallback?: boolean;
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;
  prefix?: string;
  baseUrl?: string;
  authMode?: ClaudeAuthMode;
  websockets?: boolean;
  proxyUrl?: string;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  excludedModels?: string[];
  disableCooling?: boolean | null;
  consecutive429Threshold?: number;
  cloak?: CloakConfig;
  experimentalCchSigning?: boolean;
  authIndex?: string;
  runtimeStatus?: ProviderRuntimeStatus;
}

export interface OpenAIProviderConfig {
  name: string;
  prefix?: string;
  baseUrl: string;
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;
  protocolMode?: OpenAIProviderProtocolMode;
  retryOwner?: OpenAIProviderRetryOwner;
  apiKeyEntries: ApiKeyEntry[];
  disabled?: boolean;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  priority?: number;
  fallback?: boolean;
  testModel?: string;
  disableCooling?: boolean | null;
  consecutive429Threshold?: number;
  codexImageRoute?: CodexImageRouteConfig;
  authIndex?: string;
  runtimeStatus?: ProviderRuntimeStatus;
  [key: string]: unknown;
}
