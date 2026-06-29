/**
 * Quota constants for API URLs, headers, and theme colors.
 */

import type { TypeColorSet } from '@/types';

// Theme colors for type badges, kept aligned with authFiles/constants.ts.
export const TYPE_COLORS: Record<string, TypeColorSet> = {
  qwen: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 10%, var(--card))',
      text: 'var(--primary)',
    },
  },
  aistudio: {
    light: { bg: 'var(--secondary)', text: 'var(--secondary-foreground)' },
  },
  claude: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 6%, var(--secondary))',
      text: 'var(--foreground)',
    },
  },
  codex: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 14%, var(--card))',
      text: 'var(--primary)',
    },
  },
  gemini: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 12%, var(--card))',
      text: 'var(--primary)',
    },
  },
  kimi: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 8%, var(--secondary))',
      text: 'var(--primary)',
    },
  },
  antigravity: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 10%, var(--muted))',
      text: 'var(--primary)',
    },
  },
  xai: {
    light: {
      bg: 'var(--secondary)',
      text: 'var(--foreground)',
      border: '1px solid var(--border)',
    },
  },
  iflow: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 9%, var(--card))',
      text: 'var(--primary)',
    },
  },
  vertex: {
    light: {
      bg: 'color-mix(in srgb, var(--primary) 7%, var(--secondary))',
      text: 'var(--primary)',
    },
  },
  empty: {
    light: { bg: 'var(--secondary)', text: 'var(--muted-foreground)' },
  },
  unknown: {
    light: {
      bg: 'var(--secondary)',
      text: 'var(--muted-foreground)',
      border: '1px dashed var(--border)',
    },
  },
};

// Antigravity API configuration
export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
];

export const ANTIGRAVITY_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'antigravity/cli/1.0.8 darwin/arm64',
};

// Claude API configuration
export const CLAUDE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export const CLAUDE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
};

export const CLAUDE_USAGE_WINDOW_KEYS = [
  { key: 'five_hour', id: 'five-hour', labelKey: 'claude_quota.five_hour' },
  { key: 'seven_day', id: 'seven-day', labelKey: 'claude_quota.seven_day' },
  {
    key: 'seven_day_oauth_apps',
    id: 'seven-day-oauth-apps',
    labelKey: 'claude_quota.seven_day_oauth_apps',
  },
  { key: 'seven_day_opus', id: 'seven-day-opus', labelKey: 'claude_quota.seven_day_opus' },
  { key: 'seven_day_sonnet', id: 'seven-day-sonnet', labelKey: 'claude_quota.seven_day_sonnet' },
  { key: 'seven_day_cowork', id: 'seven-day-cowork', labelKey: 'claude_quota.seven_day_cowork' },
  { key: 'iguana_necktie', id: 'iguana-necktie', labelKey: 'claude_quota.iguana_necktie' },
] as const;

// Codex API configuration
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
export const CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';

export const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
};

// Kimi API configuration
export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

export const KIMI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
};

// xAI/Grok API configuration
export const XAI_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing';

export const XAI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
};
