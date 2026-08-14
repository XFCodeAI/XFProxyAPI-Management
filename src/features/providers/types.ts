import type {
  ClaudeAuthMode,
  CodexImageRouteConfig,
  OpenAIProviderConfig,
  OpenAIProviderProtocolMode,
  OpenAIProviderRetryOwner,
  ProviderKeyConfig,
  ProviderRuntimeStatus,
  ConcurrencyMode,
} from '@/types';
import type { CredentialWeightInputValue } from '@/utils/credentialWeight';

export type ProviderBrand =
  | 'gemini'
  | 'interactions'
  | 'codex'
  | 'xai'
  | 'claude'
  | 'vertex'
  | 'openaiCompatibility'
  | 'kimi';

export type SponsorProviderBrand = 'kimi';

export const PROVIDER_SORT_BY_VALUES = ['name', 'priority', 'recent-success'] as const;
export type ProviderSortBy = (typeof PROVIDER_SORT_BY_VALUES)[number];

export const SORT_DIR_VALUES = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIR_VALUES)[number];

export type ProviderResourceSelector =
  | { brand: 'gemini'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'interactions'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'codex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'xai'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'claude'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'vertex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'openaiCompatibility'; name: string; index: number }
  | {
      brand: SponsorProviderBrand;
      openaiIndices: number[];
      claudeIndices: number[];
    };

export interface ProviderResourceFlags {
  cloakEnabled?: boolean;
  websockets?: boolean;
  isPlaceholder?: boolean;
  protocols?: string[];
}

export interface ProviderResourceBillingTarget {
  providerBrand: string;
  providerIndex: number;
  apiKeyIndexes: number[];
}

export interface ProviderResource {
  id: string;
  brand: ProviderBrand;
  originalIndex: number;
  name: string | null;
  groups: string[];
  identifier: string;
  apiKeyPreview: string | null;
  apiKey: string | null;
  authIndex: string | null;
  baseUrl: string | null;
  proxyUrl: string | null;
  prefix: string | null;
  modelCount: number;
  models: string[];
  priority: number;
  weight: number | null;
  concurrencyMode: ConcurrencyMode | null;
  maxConcurrency: number;
  fallback: boolean;
  headerCount: number;
  excludedModelCount: number;
  apiKeyEntryCount: number;
  disabled: boolean;
  runtimeStatus: ProviderRuntimeStatus | null;
  flags: ProviderResourceFlags;
  selector: ProviderResourceSelector;
  raw: unknown;
  usageRaw?: unknown;
  billingRaw?: unknown;
  billingTargets?: ProviderResourceBillingTarget[];
}

export interface ProviderGroup {
  id: ProviderBrand;
  resources: ProviderResource[];
}

export interface ProviderSnapshot {
  fetchedAt: string;
  groups: ProviderGroup[];
}

export interface SponsorProviderRaw {
  openai: Array<{ config: OpenAIProviderConfig; index: number }>;
  claude: Array<{ config: ProviderKeyConfig; index: number }>;
}

export interface ModelEntryInput {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  thinkingJson?: string;
}

export type SponsorProtocol = 'openai' | 'claude';

export interface SponsorKeyEntryInput {
  protocol: SponsorProtocol;
  apiKey: string;
  existingApiKey?: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  fallback?: boolean;
  priority?: number;
  weight?: CredentialWeightInputValue;
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;
  apiKeyConcurrencyMode?: ConcurrencyMode;
  apiKeyMaxConcurrency?: number;
  models: ModelEntryInput[];
}

export interface ApiKeyEntryInput {
  name?: string;
  apiKey: string;
  existingApiKey?: string;
  weight?: CredentialWeightInputValue;
  proxyUrl: string;
  authIndex?: string;
  groups?: string[];
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;
}

export interface CloakInput {
  mode: string;
  strictMode: boolean;
  sensitiveWordsText: string;
  cacheUserId: boolean;
}

export interface ProviderEntryFormInput {
  apiKey: string;
  name: string;
  groups?: string[];
  baseUrl: string;
  authMode?: ClaudeAuthMode | '';
  protocolMode?: OpenAIProviderProtocolMode;
  retryOwner?: OpenAIProviderRetryOwner;
  requestRetry?: number;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  fallback: boolean;
  priority?: number;
  weight?: CredentialWeightInputValue;
  concurrencyMode?: ConcurrencyMode;
  maxConcurrency?: number;

  models: ModelEntryInput[];
  headers: Array<{ key: string; value: string }>;
  excludedModelsText: string;

  websockets?: boolean;
  cloak?: CloakInput;
  experimentalCchSigning?: boolean;
  testModel?: string;
  codexImageRoute?: CodexImageRouteConfig;
  apiKeyEntries?: ApiKeyEntryInput[];
  sponsorKeyEntries?: SponsorKeyEntryInput[];
}
