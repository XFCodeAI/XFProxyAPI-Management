import type { ProviderBrand } from './types';

export interface ProviderDescriptor {
  id: ProviderBrand;
  displayName: string;
  supportsName: boolean;
  supportsApiKey: boolean;
  supportsDisabled: boolean;
  supportsBaseUrl: boolean;
  baseUrlRequired: boolean;
  supportsProxyUrl: boolean;
  supportsPrefix: boolean;
  supportsModels: boolean;
  supportsHeaders: boolean;
  supportsExcludedModels: boolean;
  supportsPriority: boolean;
  supportsTestModel: boolean;
  supportsWebsockets: boolean;
  supportsCloak: boolean;
  supportsApiKeyEntries: boolean;
  sheetSize: 'md' | 'lg' | 'xl';
}

export const PROVIDER_DESCRIPTORS: Record<ProviderBrand, ProviderDescriptor> = {
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: true,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: true,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  xai: {
    id: 'xai',
    displayName: 'xAI',
    supportsName: true,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: true,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: true,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  claude: {
    id: 'claude',
    displayName: 'Claude',
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: true,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  vertex: {
    id: 'vertex',
    displayName: 'Vertex',
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  openaiCompatibility: {
    id: 'openaiCompatibility',
    displayName: 'OpenAI Compatible',
    supportsName: true,
    supportsApiKey: false,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: true,
    supportsProxyUrl: false,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: true,
    sheetSize: 'lg',
  },
  kimi: {
    id: 'kimi',
    displayName: 'Kimi',
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: false,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: false,
    supportsHeaders: false,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: false,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
};

export const PROVIDER_BRAND_ORDER: ProviderBrand[] = [
  'kimi',
  'gemini',
  'codex',
  'xai',
  'claude',
  'vertex',
  'openaiCompatibility',
];
