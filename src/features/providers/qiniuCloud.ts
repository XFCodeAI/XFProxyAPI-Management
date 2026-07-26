import type { Config, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const QINIU_CLOUD_PROVIDER_NAME = 'qiniuCloud';
export const QINIU_CLOUD_DISPLAY_NAME = 'Qiniu Cloud';
export const QINIU_CLOUD_AFFILIATE_URL = 'https://s.qiniu.com/miI73q';
export const QINIU_CLOUD_DOMESTIC_BASE_URL = 'https://api.qnaigc.com';
export const QINIU_CLOUD_OVERSEAS_BASE_URL = 'https://api.modelink.ai';

const openAIBaseUrl = (baseUrl: string): string => `${baseUrl}/v1`;

export const QINIU_CLOUD_BASE_URL_OPTIONS = [
  {
    id: 'domestic',
    descriptionKey: 'domestic',
    baseUrl: QINIU_CLOUD_DOMESTIC_BASE_URL,
    openaiBaseUrl: openAIBaseUrl(QINIU_CLOUD_DOMESTIC_BASE_URL),
    codexBaseUrl: openAIBaseUrl(QINIU_CLOUD_DOMESTIC_BASE_URL),
    anthropicBaseUrl: QINIU_CLOUD_DOMESTIC_BASE_URL,
    geminiBaseUrl: QINIU_CLOUD_DOMESTIC_BASE_URL,
  },
  {
    id: 'overseas',
    descriptionKey: 'overseas',
    baseUrl: QINIU_CLOUD_OVERSEAS_BASE_URL,
    openaiBaseUrl: openAIBaseUrl(QINIU_CLOUD_OVERSEAS_BASE_URL),
    codexBaseUrl: openAIBaseUrl(QINIU_CLOUD_OVERSEAS_BASE_URL),
    anthropicBaseUrl: QINIU_CLOUD_OVERSEAS_BASE_URL,
    geminiBaseUrl: QINIU_CLOUD_OVERSEAS_BASE_URL,
  },
] as const;

export const QINIU_CLOUD_PROTOCOL_LABELS = [
  'openai',
  'anthropic',
  'gemini',
  'codexResponses',
] as const;

const normalizeBaseUrl = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

export const resolveQiniuCloudBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = QINIU_CLOUD_BASE_URL_OPTIONS.find((option) =>
    [
      option.baseUrl,
      option.openaiBaseUrl,
      option.codexBaseUrl,
      option.anthropicBaseUrl,
      option.geminiBaseUrl,
    ].some((candidate) => normalized === normalizeBaseUrl(candidate))
  );
  return matched?.baseUrl ?? QINIU_CLOUD_DOMESTIC_BASE_URL;
};

export const getQiniuCloudProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveQiniuCloudBaseUrl(value);
  const matched =
    QINIU_CLOUD_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? QINIU_CLOUD_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
    gemini: matched.geminiBaseUrl,
  };
};

const matchesOpenAI = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return QINIU_CLOUD_BASE_URL_OPTIONS.some(
    (option) =>
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl)
  );
};

const matchesAnthropic = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return QINIU_CLOUD_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
};

const matchesGemini = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return QINIU_CLOUD_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
};

export const isQiniuCloudOpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => Boolean(config && matchesOpenAI(config.baseUrl));

export const isQiniuCloudClaudeProvider = (config: ProviderKeyConfig | undefined | null): boolean =>
  Boolean(config && matchesAnthropic(config.baseUrl));

export const isQiniuCloudCodexProvider = (config: ProviderKeyConfig | undefined | null): boolean =>
  Boolean(config && matchesOpenAI(config.baseUrl));

export const isQiniuCloudGeminiProvider = (config: GeminiKeyConfig | undefined | null): boolean =>
  Boolean(config && matchesGemini(config.baseUrl));

export const buildQiniuCloudRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index: item.sourceIndex ?? index }))
    .filter((item) => isQiniuCloudOpenAIProvider(item.config)),
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isQiniuCloudClaudeProvider(item.config)),
  codex: (config?.codexApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isQiniuCloudCodexProvider(item.config)),
  gemini: (config?.geminiApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isQiniuCloudGeminiProvider(item.config)),
});
