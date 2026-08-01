import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  OpenAIProviderProtocolMode,
  OpenAIProviderRetryOwner,
  ProviderKeyConfig,
  ProviderRuntimeStatus,
} from '@/types';

export type ProviderBrand =
  | 'gemini'
  | 'codex'
  | 'xai'
  | 'claude'
  | 'claudeApi'
  | 'vertex'
  | 'openaiCompatibility'
  | 'apikeyFun'
  | 'code0'
  | 'fennoAI'
  | 'qiniuCloud'
  | 'kimi';

export type SponsorProviderBrand = 'apikeyFun' | 'code0' | 'fennoAI' | 'qiniuCloud' | 'kimi';

export const PROVIDER_SORT_BY_VALUES = ['name', 'priority', 'recent-success'] as const;
export type ProviderSortBy = (typeof PROVIDER_SORT_BY_VALUES)[number];

export const SORT_DIR_VALUES = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIR_VALUES)[number];

export type ProviderResourceSelector =
  | { brand: 'gemini'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'codex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'xai'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'claude'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'claudeApi'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'vertex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'openaiCompatibility'; name: string; index: number }
  | {
      brand: SponsorProviderBrand;
      openaiIndices: number[];
      claudeIndices: number[];
      codexIndices: number[];
      geminiIndices: number[];
    };

export interface ProviderResourceFlags {
  cloakEnabled?: boolean;
  websockets?: boolean;
  isPlaceholder?: boolean;
  protocols?: string[];
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
  fallback: boolean;
  headerCount: number;
  excludedModelCount: number;
  apiKeyEntryCount: number;
  disabled: boolean;
  runtimeStatus: ProviderRuntimeStatus | null;
  flags: ProviderResourceFlags;
  selector: ProviderResourceSelector;
  raw: unknown;
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
  codex: Array<{ config: ProviderKeyConfig; index: number }>;
  gemini: Array<{ config: GeminiKeyConfig; index: number }>;
}

export interface ModelEntryInput {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  thinkingJson?: string;
}

export type SponsorProtocol = 'openai' | 'codex' | 'claude' | 'gemini';

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
  models: ModelEntryInput[];
}

export interface ApiKeyEntryInput {
  name?: string;
  apiKey: string;
  existingApiKey?: string;
  proxyUrl: string;
  authIndex?: string;
  groups?: string[];
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
  protocolMode?: OpenAIProviderProtocolMode;
  retryOwner?: OpenAIProviderRetryOwner;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  fallback: boolean;
  priority?: number;

  models: ModelEntryInput[];
  headers: Array<{ key: string; value: string }>;
  excludedModelsText: string;

  websockets?: boolean;
  cloak?: CloakInput;
  experimentalCchSigning?: boolean;
  testModel?: string;
  apiKeyEntries?: ApiKeyEntryInput[];
  sponsorKeyEntries?: SponsorKeyEntryInput[];
}
