import type { Config, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const FENNO_AI_PROVIDER_NAME = 'fennoAI';
export const FENNO_AI_DISPLAY_NAME = 'FennoAI';
export const FENNO_AI_AFFILIATE_URL = 'https://api.fenno.ai/register?aff=DQFAMNB6CBLY';
export const FENNO_AI_BASE_URL = 'https://api.fenno.ai';
export const FENNO_AI_CODEX_BASE_URL = `${FENNO_AI_BASE_URL}/v1`;
export const FENNO_AI_ANTHROPIC_BASE_URL = FENNO_AI_BASE_URL;
export const FENNO_AI_OPENAI_BASE_URL = FENNO_AI_CODEX_BASE_URL;
export const FENNO_AI_GEMINI_BASE_URL = FENNO_AI_BASE_URL;

export const FENNO_AI_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: FENNO_AI_BASE_URL,
    openaiBaseUrl: FENNO_AI_OPENAI_BASE_URL,
    codexBaseUrl: FENNO_AI_CODEX_BASE_URL,
    anthropicBaseUrl: FENNO_AI_ANTHROPIC_BASE_URL,
    geminiBaseUrl: FENNO_AI_GEMINI_BASE_URL,
  },
] as const;

export const FENNO_AI_PROTOCOL_LABELS = ['codexResponses', 'anthropic'] as const;

const normalizeBaseUrl = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

export const resolveFennoAIBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = FENNO_AI_BASE_URL_OPTIONS.find((option) =>
    [
      option.baseUrl,
      option.openaiBaseUrl,
      option.codexBaseUrl,
      option.anthropicBaseUrl,
      option.geminiBaseUrl,
    ].some((candidate) => normalized === normalizeBaseUrl(candidate))
  );
  return matched?.baseUrl ?? FENNO_AI_BASE_URL;
};

export const getFennoAIProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveFennoAIBaseUrl(value);
  const matched =
    FENNO_AI_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? FENNO_AI_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
    gemini: matched.geminiBaseUrl,
  };
};

export const isFennoAIClaudeProvider = (config: ProviderKeyConfig | undefined | null): boolean =>
  Boolean(
    config &&
    FENNO_AI_BASE_URL_OPTIONS.some(
      (option) => normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(option.anthropicBaseUrl)
    )
  );

export const isFennoAICodexProvider = (config: ProviderKeyConfig | undefined | null): boolean =>
  Boolean(
    config &&
    FENNO_AI_BASE_URL_OPTIONS.some(
      (option) => normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(option.codexBaseUrl)
    )
  );

export const buildFennoAIRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: [],
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isFennoAIClaudeProvider(item.config)),
  codex: (config?.codexApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isFennoAICodexProvider(item.config)),
  gemini: [],
});
