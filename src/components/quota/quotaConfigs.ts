/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
  CodexRateLimitInfo,
  CodexRateLimitResetCredit,
  CodexQuotaAccountEvidence,
  CodexQuotaLimit,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  KimiQuotaRow,
  KimiQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';
import {
  antigravitySubscriptionApi,
  apiCallApi,
  authFilesApi,
  codexQuotaApi,
  getApiCallErrorMessage,
  type AntigravitySubscriptionSummary,
} from '@/services/api';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_API_REQUEST_HEADERS,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_PAID_HEALTH_MODEL,
  XAI_REQUEST_HEADERS,
  normalizeNumberValue,
  normalizeStringValue,
  parseAntigravityPayload,
  parseClaudeUsagePayload,
  parseKimiUsagePayload,
  parseXaiBillingPayload,
  formatCodexResetLabel,
  formatQuotaResetTime,
  formatKimiResetHint,
  buildAntigravityQuotaGroups,
  buildKimiQuotaRows,
  buildXaiBillingSummary,
  buildXaiPaidHealthSummary,
  mergeXaiBillingSummaries,
  createStatusError,
  formatShanghaiDateTime,
  getStatusFromError,
  isAntigravityFile,
  isClaudeFile,
  isCodexFile,
  isKimiFile,
  isPaidXaiAuthFile,
  isXaiFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { readAuthFileCredentialIdentity } from '@/features/authFiles/credentialIdentity';
import { formatDateTimeValue } from '@/utils/format';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'claude' | 'codex' | 'kimi' | 'xai';

type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs: number | null;
};

type CodexQuotaData = {
  credentialId: string;
  authIndex: string;
  credentialGeneration: number;
  account: CodexQuotaAccountEvidence;
  observedAt: string;
  observationStale: boolean;
  subscriptionActiveUntil: string | number | null;
  rateLimitResetCreditsAvailableCount: number | null;
  rateLimitResetCredits: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError: string;
  limits: CodexQuotaLimit[];
};

const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;
const CODEX_QUOTA_STALE_AFTER_MS = 5 * 60 * 1000;
const XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS = 15000;

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction, previousState?: TState) => Promise<TData>;
  resetQuota?: (file: AuthFileItem, t: TFunction, previousState?: TState) => Promise<TData>;
  canResetQuota?: (quota: TState) => boolean;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: (file?: AuthFileItem, previousState?: TState) => TState;
  buildSuccessState: (data: TData, file?: AuthFileItem) => TState;
  buildErrorState: (
    message: string,
    status?: number,
    file?: AuthFileItem,
    previousState?: TState
  ) => TState;
  cardClassName: string;
  controlsClassName: string;
  controlClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  const directProjectId = normalizeStringValue(file.project_id ?? file.projectId);
  if (directProjectId) return directProjectId;

  const metadata =
    file.metadata && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const metadataProjectId = metadata
    ? normalizeStringValue(metadata.project_id ?? metadata.projectId)
    : null;
  if (metadataProjectId) return metadataProjectId;

  const attributes =
    file.attributes && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const attributesProjectId = attributes
    ? normalizeStringValue(
        attributes.project_id ?? attributes.projectId ?? attributes.gemini_virtual_project
      )
    : null;
  if (attributesProjectId) return attributesProjectId;

  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return '';

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return '';
  }

  return '';
};

const resolveResponseServerTimeOffsetMs = (
  header: Record<string, string[]> | undefined
): number | null => {
  if (!header) return null;
  const dateEntry = Object.entries(header).find(([key]) => key.toLowerCase() === 'date');
  const rawDate = dateEntry?.[1]?.[0];
  if (!rawDate) return null;
  const serverTime = new Date(rawDate).getTime();
  if (Number.isNaN(serverTime)) return null;
  return serverTime - Date.now();
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  if (!projectId) {
    throw new Error(t('antigravity_quota.missing_project_id'));
  }
  const requestBody = JSON.stringify({ project: projectId });
  const subscriptionPromise = antigravitySubscriptionApi
    .get(authIndex)
    .then(toAntigravityQuotaSubscription)
    .catch(() => null);

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(
        result.body ?? result.bodyText
      ) as AntigravityQuotaSummaryPayload | null;
      if (!payload || !Array.isArray(payload.groups)) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(payload);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return {
        groups,
        subscription: await subscriptionPromise,
        serverTimeOffsetMs: resolveResponseServerTimeOffsetMs(result.header),
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      if (status) {
        lastStatus = status;
        if (status === 403 || status === 404) {
          priorityStatus ??= status;
        }
      }
    }
  }

  if (hadSuccess) {
    return { groups: [], subscription: await subscriptionPromise, serverTimeOffsetMs: null };
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const toAntigravityQuotaSubscription = (
  summary: AntigravitySubscriptionSummary | null
): AntigravityQuotaSubscription | null => {
  if (!summary) return null;
  return {
    plan: summary.plan,
    tierName: summary.tierName,
    tierId: summary.tierId,
  };
};

type CodexClassifiedWindow = {
  source: 'primary' | 'secondary';
  window: CodexUsageWindow;
};

const buildCodexQuotaLimits = (payload: CodexUsagePayload, t: TFunction): CodexQuotaLimit[] => {
  const FIVE_HOUR_SECONDS = 18000;
  const WEEK_SECONDS = 604800;
  const MIN_MONTH_SECONDS = 28 * 24 * 60 * 60;
  const MAX_MONTH_SECONDS = 31 * 24 * 60 * 60;
  const WINDOW_META = {
    codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
    codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
    codeMonthly: { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' },
    codeReviewFiveHour: {
      id: 'code-review-five-hour',
      labelKey: 'codex_quota.code_review_primary_window',
    },
    codeReviewWeekly: {
      id: 'code-review-weekly',
      labelKey: 'codex_quota.code_review_secondary_window',
    },
    codeReviewMonthly: {
      id: 'code-review-monthly',
      labelKey: 'codex_quota.code_review_team_secondary_window',
    },
  } as const;

  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
  const limits: CodexQuotaLimit[] = [];

  const getWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
    if (!window) return null;
    return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
  };

  const isMonthlyWindow = (window?: CodexUsageWindow | null): boolean => {
    const seconds = getWindowSeconds(window);
    return seconds !== null && seconds >= MIN_MONTH_SECONDS && seconds <= MAX_MONTH_SECONDS;
  };

  const addWindow = (
    windows: CodexQuotaWindow[],
    id: string,
    label: string,
    labelKey: string | undefined,
    labelParams: Record<string, string | number> | undefined,
    classified?: CodexClassifiedWindow | null
  ) => {
    if (!classified) return;
    const { source, window } = classified;
    const resetLabel = formatCodexResetLabel(window);
    const usedPercent = normalizeNumberValue(window.used_percent ?? window.usedPercent);
    windows.push({
      id,
      label,
      labelKey,
      labelParams,
      source,
      usedPercent,
      limitWindowSeconds: getWindowSeconds(window),
      resetLabel,
    });
  };

  const selectSecondaryWindowMeta = <
    TWeekly extends { id: string; labelKey: string },
    TMonthly extends { id: string; labelKey: string },
  >(
    window: CodexClassifiedWindow | null | undefined,
    weeklyMeta: TWeekly,
    monthlyMeta: TMonthly
  ): TWeekly | TMonthly => (isMonthlyWindow(window?.window) ? monthlyMeta : weeklyMeta);

  const pickClassifiedWindows = (
    limitInfo?: CodexRateLimitInfo | null,
    options?: { allowOrderFallback?: boolean }
  ): {
    fiveHourWindow: CodexClassifiedWindow | null;
    weeklyWindow: CodexClassifiedWindow | null;
  } => {
    const allowOrderFallback = options?.allowOrderFallback ?? true;
    const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
    const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
    const rawWindows: CodexClassifiedWindow[] = [];
    if (primaryWindow) rawWindows.push({ source: 'primary', window: primaryWindow });
    if (secondaryWindow) rawWindows.push({ source: 'secondary', window: secondaryWindow });

    let fiveHourWindow: CodexClassifiedWindow | null = null;
    let weeklyWindow: CodexClassifiedWindow | null = null;

    for (const classified of rawWindows) {
      const seconds = getWindowSeconds(classified.window);
      if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
        fiveHourWindow = classified;
      } else if (
        (seconds === WEEK_SECONDS || isMonthlyWindow(classified.window)) &&
        !weeklyWindow
      ) {
        weeklyWindow = classified;
      }
    }

    if (allowOrderFallback) {
      if (!fiveHourWindow && primaryWindow && primaryWindow !== weeklyWindow?.window) {
        fiveHourWindow = { source: 'primary', window: primaryWindow };
      }
      if (!weeklyWindow && secondaryWindow && secondaryWindow !== fiveHourWindow?.window) {
        weeklyWindow = { source: 'secondary', window: secondaryWindow };
      }
    }

    return { fiveHourWindow, weeklyWindow };
  };

  const normalizeWindowId = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const buildLimit = (
    id: string,
    labelKey: string,
    labelParams: Record<string, string | number> | undefined,
    rateInfo: CodexRateLimitInfo | null | undefined,
    primaryMeta: { id: string; labelKey: string },
    weeklyMeta: { id: string; labelKey: string },
    monthlyMeta: { id: string; labelKey: string },
    meteredFeature?: string | null
  ): CodexQuotaLimit => {
    const windows: CodexQuotaWindow[] = [];
    const classified = pickClassifiedWindows(rateInfo);
    const limitReached = rateInfo?.limit_reached ?? rateInfo?.limitReached;
    const allowed = rateInfo?.allowed;
    addWindow(
      windows,
      primaryMeta.id,
      t(primaryMeta.labelKey, labelParams),
      primaryMeta.labelKey,
      labelParams,
      classified.fiveHourWindow
    );
    const secondaryMeta = selectSecondaryWindowMeta(
      classified.weeklyWindow,
      weeklyMeta,
      monthlyMeta
    );
    addWindow(
      windows,
      secondaryMeta.id,
      t(secondaryMeta.labelKey, labelParams),
      secondaryMeta.labelKey,
      labelParams,
      classified.weeklyWindow
    );
    return {
      id,
      label: t(labelKey, labelParams),
      labelKey,
      labelParams,
      meteredFeature: meteredFeature ?? null,
      allowed: typeof allowed === 'boolean' ? allowed : null,
      limitReached: typeof limitReached === 'boolean' ? limitReached : null,
      windows,
    };
  };

  if (rateLimit) {
    limits.push(
      buildLimit(
        'main',
        'codex_quota.main_limit',
        undefined,
        rateLimit,
        WINDOW_META.codeFiveHour,
        WINDOW_META.codeWeekly,
        WINDOW_META.codeMonthly
      )
    );
  }

  if (codeReviewLimit) {
    limits.push(
      buildLimit(
        'code-review',
        'codex_quota.code_review_limit',
        undefined,
        codeReviewLimit,
        WINDOW_META.codeReviewFiveHour,
        WINDOW_META.codeReviewWeekly,
        WINDOW_META.codeReviewMonthly
      )
    );
  }

  if (Array.isArray(additionalRateLimits)) {
    additionalRateLimits.forEach((limitItem, index) => {
      const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
      const limitName =
        normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
        normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
        `additional-${index + 1}`;
      const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
      const labelParams = { name: limitName };
      limits.push(
        buildLimit(
          `additional-${idPrefix}-${index}`,
          'codex_quota.additional_limit',
          labelParams,
          rateInfo,
          {
            id: `${idPrefix}-five-hour-${index}`,
            labelKey: 'codex_quota.additional_primary_window',
          },
          {
            id: `${idPrefix}-weekly-${index}`,
            labelKey: 'codex_quota.additional_secondary_window',
          },
          {
            id: `${idPrefix}-monthly-${index}`,
            labelKey: 'codex_quota.additional_team_secondary_window',
          },
          normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature)
        )
      );
    });
  }

  return limits;
};

const isCodexQuotaObservationStale = (observedAt: string, nowMs = Date.now()): boolean => {
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return true;
  return observedMs > nowMs + 60_000 || nowMs - observedMs > CODEX_QUOTA_STALE_AFTER_MS;
};

const buildCodexQuotaIdentityTarget = (file: AuthFileItem, previousState?: CodexQuotaState) => {
  const identity = readAuthFileCredentialIdentity(file);
  const authIndex = normalizeAuthIndex(identity.authIndex);
  const previousMatches =
    (!previousState?.credentialId || previousState.credentialId === identity.credentialId) &&
    (!previousState?.authIndex || previousState.authIndex === authIndex);
  return {
    credentialId: identity.credentialId,
    authIndex: authIndex ?? '',
    credentialGeneration:
      identity.credentialGeneration ??
      (previousMatches ? previousState?.credentialGeneration : null),
  };
};

const buildCodexQuotaData = (
  snapshot: Awaited<ReturnType<typeof codexQuotaApi.get>>,
  t: TFunction
): CodexQuotaData => {
  const payload = snapshot.usage;
  if (!payload || typeof payload !== 'object') {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const resetCreditsCountFromDetails =
    snapshot.resetCredits.credits.length > 0 ? snapshot.resetCredits.credits.length : null;
  const rateLimitResetCreditsAvailableCount =
    snapshot.resetCredits.availableCount ?? resetCreditsCountFromDetails;
  const observedAt = normalizeStringValue(snapshot.observedAt) ?? '';
  return {
    credentialId: snapshot.credentialId,
    authIndex: snapshot.authIndex,
    credentialGeneration: snapshot.credentialGeneration,
    account: snapshot.account,
    observedAt,
    observationStale: isCodexQuotaObservationStale(observedAt),
    subscriptionActiveUntil: snapshot.subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: snapshot.resetCredits.credits,
    rateLimitResetCreditsError: snapshot.resetCredits.error,
    limits: buildCodexQuotaLimits(payload, t),
  };
};

const fetchCodexQuota = async (
  file: AuthFileItem,
  t: TFunction,
  previousState?: CodexQuotaState
): Promise<CodexQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  return buildCodexQuotaData(
    await codexQuotaApi.get(buildCodexQuotaIdentityTarget(file, previousState)),
    t
  );
};

const consumeCodexRateLimitResetCredit = async (
  file: AuthFileItem,
  t: TFunction,
  previousState?: CodexQuotaState
) => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  return codexQuotaApi.consumeResetCredit(buildCodexQuotaIdentityTarget(file, previousState));
};

const resetCodexQuota = async (
  file: AuthFileItem,
  t: TFunction,
  previousState?: CodexQuotaState
): Promise<CodexQuotaData> => {
  const reset = await consumeCodexRateLimitResetCredit(file, t, previousState);
  const snapshot = await codexQuotaApi.get({
    credentialId: reset.credentialId,
    authIndex: reset.authIndex,
    credentialGeneration: reset.credentialGeneration,
  });
  return buildCodexQuotaData(snapshot, t);
};

const formatAntigravityDuration = (t: TFunction, deltaMs: number): string => {
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('antigravity_quota.duration_day_hour', {
      days,
      hours,
    });
  }
  if (hours > 0) {
    return t('antigravity_quota.duration_hour_minute', {
      hours,
      minutes,
    });
  }
  if (minutes > 0) {
    return t('antigravity_quota.duration_minute', {
      minutes,
    });
  }
  return t('antigravity_quota.duration_less_than_minute');
};

const formatAntigravityResetLabel = (
  resetTime: string | undefined,
  t: TFunction,
  nowMs: number
): string => {
  if (!resetTime) return '-';
  const resetMs = new Date(resetTime).getTime();
  if (Number.isNaN(resetMs)) return '-';
  const deltaMs = resetMs - nowMs;
  if (deltaMs <= 0) return t('antigravity_quota.refresh_available');
  return t('antigravity_quota.refreshes_in', {
    duration: formatAntigravityDuration(t, deltaMs),
  });
};

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const normalizeAntigravityQuotaText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const translateAntigravityQuotaLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(normalizeAntigravityQuotaText(value));
  return key ? t(`antigravity_quota.${key}`) : value;
};

const translateAntigravityQuotaDescription = (
  value: string | undefined,
  t: TFunction
): string | undefined => {
  if (!value) return undefined;
  const modelsMatch = value.match(/^models within this group:\s*(.+)$/i);
  if (modelsMatch) {
    return t('antigravity_quota.group_models_description', {
      models: modelsMatch[1].trim(),
    });
  }
  return value;
};

const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const groups = quota.groups ?? [];
  const nodes: ReactNode[] = [];
  const planLabel = getAntigravityPlanLabel(quota.subscription, t);
  const normalizedPlan = quota.subscription?.plan?.toLowerCase() ?? '';
  const isPremiumPlan = normalizedPlan === 'ultra' || normalizedPlan === 'ultra-lite';

  if (planLabel) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h(
          'span',
          { className: styleMap.codexPlanItem },
          h('span', { className: styleMap.codexPlanLabel }, t('antigravity_quota.plan_label')),
          h(
            'span',
            { className: isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            planLabel
          )
        )
      )
    );
  }

  if (groups.length === 0) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: styleMap.quotaMessage },
        t('antigravity_quota.empty_models')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  const nowMs = Date.now() + (quota.serverTimeOffsetMs ?? 0);

  nodes.push(
    ...groups.map((group) => {
      const groupLabel = translateAntigravityQuotaLabel(
        group.label,
        ANTIGRAVITY_GROUP_LABEL_KEYS,
        t
      );
      const groupDescription = translateAntigravityQuotaDescription(group.description, t);

      return h(
        'div',
        { key: group.id, className: styleMap.antigravityQuotaGroup },
        h(
          'div',
          { className: styleMap.antigravityQuotaGroupHeader },
          h('span', { className: styleMap.antigravityQuotaGroupTitle }, groupLabel),
          groupDescription
            ? h('span', { className: styleMap.antigravityQuotaGroupDescription }, groupDescription)
            : null
        ),
        ...group.buckets.map((bucket) => {
          const clamped = Math.max(0, Math.min(1, bucket.remainingFraction));
          const percent = clamped * 100;
          const percentLabel =
            bucket.remainingFraction === 1
              ? t('antigravity_quota.quota_available')
              : t('antigravity_quota.remaining_percent', {
                  percent: Math.round(percent),
                });
          const resetLabel = formatAntigravityResetLabel(bucket.resetTime, t, nowMs);
          const bucketLabel = translateAntigravityQuotaLabel(
            bucket.label,
            ANTIGRAVITY_BUCKET_LABEL_KEYS,
            t
          );
          const bucketDescription = translateAntigravityQuotaDescription(bucket.description, t);

          return h(
            'div',
            { key: bucket.id, className: styleMap.quotaRow },
            h(
              'div',
              { className: styleMap.quotaRowHeader },
              h('span', { className: styleMap.quotaModel, title: bucketDescription }, bucketLabel),
              h(
                'div',
                { className: styleMap.quotaMeta },
                h('span', { className: styleMap.quotaPercent }, percentLabel),
                h('span', { className: styleMap.quotaReset }, resetLabel)
              )
            ),
            h(QuotaProgressBar, {
              percent,
              highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
              mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
            })
          );
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const formatCodexWindowDuration = (seconds: number | null, t: TFunction): string => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return t('codex_quota.value_unknown');
  }
  if (seconds % 86400 === 0) {
    return t('codex_quota.duration_days', { count: seconds / 86400 });
  }
  if (seconds % 3600 === 0) {
    return t('codex_quota.duration_hours', { count: seconds / 3600 });
  }
  if (seconds % 60 === 0) {
    return t('codex_quota.duration_minutes', { count: seconds / 60 });
  }
  return t('codex_quota.duration_seconds', { count: seconds });
};

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const limits = quota.limits ?? [];
  const subscriptionActiveUntil = quota.subscriptionActiveUntil ?? null;
  const rateLimitResetCredits = quota.rateLimitResetCredits ?? [];
  const rateLimitResetCreditsError = quota.rateLimitResetCreditsError ?? '';
  const expiryLabel = subscriptionActiveUntil ? formatDateTimeValue(subscriptionActiveUntil) : '';
  const nodes: ReactNode[] = [];

  if (expiryLabel) {
    nodes.push(
      h(
        'div',
        { key: 'subscription-expiry', className: styleMap.codexPlan },
        h(
          'span',
          { className: styleMap.codexPlanItem },
          h('span', { className: styleMap.codexPlanLabel }, t('codex_quota.expires_label')),
          h('span', { className: styleMap.codexPlanValue }, expiryLabel)
        )
      )
    );
  }

  if (rateLimitResetCredits.length > 0) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiries', className: styleMap.codexResetCredits },
        h(
          'div',
          { className: styleMap.codexResetCreditsTitle },
          t('codex_quota.reset_credits_expiry_label')
        ),
        ...rateLimitResetCredits.map((credit, index) =>
          h(
            'div',
            {
              key: credit.id || `${credit.expiresAt}-${index}`,
              className: styleMap.codexResetCreditRow,
            },
            h(
              'span',
              { className: styleMap.codexResetCreditLabel },
              t('codex_quota.reset_credit_number', { index: index + 1 })
            ),
            h(
              'span',
              { className: styleMap.codexResetCreditTime },
              formatShanghaiDateTime(credit.expiresAt) || credit.expiresAt
            )
          )
        )
      )
    );
  } else if (rateLimitResetCreditsError) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiry-error', className: styleMap.codexResetCreditsError },
        t('codex_quota.reset_credits_expiry_failed', {
          message: rateLimitResetCreditsError,
        })
      )
    );
  }

  if (limits.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('codex_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  const booleanFact = (
    value: boolean | null,
    trueKey: string,
    falseKey: string,
    trueTone: 'ok' | 'warning',
    falseTone: 'ok' | 'warning'
  ) => ({
    value: value === null ? t('codex_quota.value_unknown') : value ? t(trueKey) : t(falseKey),
    tone: value === null ? 'muted' : value ? trueTone : falseTone,
  });

  nodes.push(
    ...limits.map((limit) => {
      const limitLabel = limit.labelKey
        ? t(limit.labelKey, limit.labelParams as Record<string, string | number>)
        : limit.label;
      const allowed = booleanFact(
        limit.allowed,
        'codex_quota.allowed_yes',
        'codex_quota.allowed_no',
        'ok',
        'warning'
      );
      const reached = booleanFact(
        limit.limitReached,
        'codex_quota.limit_reached_yes',
        'codex_quota.limit_reached_no',
        'warning',
        'ok'
      );

      const limitChildren: ReactNode[] = [
        h(
          'div',
          { key: 'header', className: styleMap.codexLimitHeader },
          h(
            'div',
            { className: styleMap.codexLimitTitleGroup },
            h('span', { className: styleMap.codexLimitTitle }, limitLabel),
            limit.meteredFeature
              ? h(
                  'span',
                  { className: styleMap.codexMeteredFeature },
                  t('codex_quota.metered_feature', { feature: limit.meteredFeature })
                )
              : null
          ),
          h(
            'div',
            { className: styleMap.codexLimitFacts },
            h(
              'span',
              { className: styleMap.codexLimitFact },
              h(
                'span',
                { className: styleMap.codexLimitFactLabel },
                t('codex_quota.allowed_label')
              ),
              h(
                'span',
                {
                  className: `${styleMap.codexLimitFactValue} ${
                    allowed.tone === 'ok'
                      ? styleMap.codexEvidenceValueOk
                      : allowed.tone === 'warning'
                        ? styleMap.codexEvidenceValueWarning
                        : styleMap.codexEvidenceValueMuted
                  }`,
                },
                allowed.value
              )
            ),
            h(
              'span',
              { className: styleMap.codexLimitFact },
              h(
                'span',
                { className: styleMap.codexLimitFactLabel },
                t('codex_quota.limit_reached_label')
              ),
              h(
                'span',
                {
                  className: `${styleMap.codexLimitFactValue} ${
                    reached.tone === 'ok'
                      ? styleMap.codexEvidenceValueOk
                      : reached.tone === 'warning'
                        ? styleMap.codexEvidenceValueWarning
                        : styleMap.codexEvidenceValueMuted
                  }`,
                },
                reached.value
              )
            )
          )
        ),
      ];

      if (limit.windows.length === 0) {
        limitChildren.push(
          h(
            'div',
            { key: 'empty', className: styleMap.codexLimitEmpty },
            t('codex_quota.no_windows_for_limit')
          )
        );
      } else {
        limitChildren.push(
          ...limit.windows.map((window) => {
            const used = window.usedPercent;
            const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
            const remaining =
              clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
            const windowLabel = window.labelKey
              ? t(window.labelKey, window.labelParams as Record<string, string | number>)
              : window.label;
            const resetLabel =
              window.resetLabel === '-'
                ? t('codex_quota.reset_unknown')
                : t('codex_quota.reset_at', { time: window.resetLabel });

            return h(
              'div',
              { key: window.id, className: styleMap.quotaRow },
              h(
                'div',
                { className: styleMap.quotaRowHeader },
                h('span', { className: styleMap.quotaModel }, windowLabel),
                h(
                  'div',
                  { className: styleMap.quotaMeta },
                  h(
                    'span',
                    { className: styleMap.quotaPercent },
                    used === null
                      ? t('codex_quota.used_percent_unknown')
                      : t('codex_quota.used_percent', { percent: Math.round(used) })
                  ),
                  h(
                    'span',
                    { className: styleMap.quotaAmount },
                    remaining === null
                      ? t('codex_quota.remaining_percent_unknown')
                      : t('codex_quota.remaining_percent', { percent: Math.round(remaining) })
                  ),
                  h(
                    'span',
                    { className: styleMap.quotaAmount },
                    t('codex_quota.window_source', {
                      source: t(
                        window.source === 'primary'
                          ? 'codex_quota.window_source_primary'
                          : 'codex_quota.window_source_secondary'
                      ),
                    })
                  ),
                  h(
                    'span',
                    { className: styleMap.quotaAmount },
                    t('codex_quota.window_duration', {
                      duration: formatCodexWindowDuration(window.limitWindowSeconds, t),
                    })
                  ),
                  h('span', { className: styleMap.quotaReset }, resetLabel)
                )
              ),
              h(QuotaProgressBar, {
                percent: remaining,
                highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
                mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
              })
            );
          })
        );
      }

      return h(
        'section',
        { key: limit.id, className: styleMap.codexLimit, 'data-limit-id': limit.id },
        ...limitChildren
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
    });
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const fetchClaudeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return { windows, extraUsage: payload.extra_usage, planType };
};

const renderClaudeItems = (
  quota: ClaudeQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const nodes: ReactNode[] = [];

  if (planType) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, t(`claude_quota.${planType}`))
      )
    );
  }

  if (extraUsage && extraUsage.is_enabled) {
    const usedLabel = `$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`;
    nodes.push(
      h(
        'div',
        { key: 'extra', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.extra_usage_label')),
        h('span', { className: styleMap.codexPlanValue }, usedLabel)
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('claude_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: styleMap.quotaReset }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

export const CLAUDE_CONFIG: QuotaConfig<
  ClaudeQuotaState,
  { windows: ClaudeQuotaWindow[]; extraUsage?: ClaudeExtraUsage | null; planType?: string | null }
> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: isClaudeFile,
  fetchQuota: fetchClaudeQuota,
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.claudeCard,
  controlsClassName: styles.claudeControls,
  controlClassName: styles.claudeControl,
  gridClassName: styles.claudeGrid,
  renderQuotaItems: renderClaudeItems,
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaData> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: isAntigravityFile,
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({
    status: 'loading',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    groups: data.groups,
    subscription: data.subscription,
    serverTimeOffsetMs: data.serverTimeOffsetMs,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems,
};

export const CODEX_CONFIG: QuotaConfig<CodexQuotaState, CodexQuotaData> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: isCodexFile,
  fetchQuota: fetchCodexQuota,
  resetQuota: resetCodexQuota,
  canResetQuota: (quota) => (quota.rateLimitResetCreditsAvailableCount ?? 0) > 0,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  buildLoadingState: (file, previousState) => {
    const identity = file ? buildCodexQuotaIdentityTarget(file, previousState) : null;
    return {
      status: 'loading',
      credentialId: identity?.credentialId ?? null,
      authIndex: identity?.authIndex ?? null,
      credentialGeneration: identity?.credentialGeneration ?? null,
      planType: null,
      limits: [],
      account: null,
      observedAt: null,
      observationStale: false,
      rateLimitResetCredits: [],
      rateLimitResetCreditsError: '',
    };
  },
  buildSuccessState: (data) => ({
    status: 'success',
    credentialId: data.credentialId,
    authIndex: data.authIndex,
    credentialGeneration: data.credentialGeneration,
    planType: data.account.upstreamPlanType ?? data.account.credentialPlanType,
    limits: data.limits,
    account: data.account,
    observedAt: data.observedAt,
    observationStale: data.observationStale,
    subscriptionActiveUntil: data.subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount: data.rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: data.rateLimitResetCredits,
    rateLimitResetCreditsError: data.rateLimitResetCreditsError,
  }),
  buildErrorState: (message, status, file, previousState) => {
    const identity = file ? buildCodexQuotaIdentityTarget(file, previousState) : null;
    return {
      status: 'error',
      credentialId: identity?.credentialId ?? null,
      authIndex: identity?.authIndex ?? null,
      credentialGeneration: identity?.credentialGeneration ?? null,
      planType: null,
      limits: [],
      account: null,
      observedAt: null,
      observationStale: false,
      rateLimitResetCredits: [],
      rateLimitResetCreditsError: '',
      error: message,
      errorStatus: status,
    };
  },
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems,
};

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

const renderKimiItems = (
  quota: KimiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('kimi_quota.empty_data'));
  }

  return rows.map((row) => {
    const limit = row.limit;
    const used = row.used;
    const remaining =
      limit > 0
        ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
        : used > 0
          ? 0
          : null;
    const percentLabel = remaining === null ? '--' : `${remaining}%`;
    const rowLabel = row.labelKey
      ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
      : (row.label ?? '');
    const resetLabel = formatKimiResetHint(t, row.resetHint);

    return h(
      'div',
      { key: row.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, rowLabel),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          limit > 0 ? h('span', { className: styleMap.quotaAmount }, `${used} / ${limit}`) : null,
          resetLabel ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
        )
      ),
      h(QuotaProgressBar, {
        percent: remaining,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    );
  });
};

const toXaiRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const resolveXaiUserId = (file: AuthFileItem): string | null => {
  const metadata = toXaiRecord(file.metadata);
  const attributes = toXaiRecord(file.attributes);
  const oauth = toXaiRecord(file.oauth ?? metadata?.oauth ?? attributes?.oauth);
  const user = toXaiRecord(file.user ?? metadata?.user ?? attributes?.user);
  const candidates = [
    file.sub,
    file.subject,
    file.user_id,
    file.userId,
    metadata?.sub,
    metadata?.subject,
    metadata?.user_id,
    metadata?.userId,
    attributes?.sub,
    attributes?.subject,
    attributes?.user_id,
    attributes?.userId,
    oauth?.sub,
    oauth?.subject,
    user?.sub,
    user?.id,
  ];

  for (const candidate of candidates) {
    const userId = normalizeStringValue(candidate);
    if (userId) return userId;
  }

  return null;
};

const buildXaiRequestHeaders = (file: AuthFileItem): Record<string, string> => {
  const headers: Record<string, string> = { ...XAI_REQUEST_HEADERS };
  const userId = resolveXaiUserId(file);
  if (userId) {
    headers['x-userid'] = userId;
  }
  return headers;
};

const requestXaiBilling = async (
  authIndex: string,
  url: string,
  header: Record<string, string>
): Promise<XaiBillingSummary | null> => {
  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url,
    header,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
  return buildXaiBillingSummary(payload?.config ?? payload);
};

const requestXaiPaidHealth = async (authIndex: string): Promise<XaiBillingSummary> => {
  const [profileRequest, chatRequest] = await Promise.allSettled([
    apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: XAI_API_ME_URL,
        header: { ...XAI_API_REQUEST_HEADERS },
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
    apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url: XAI_API_CHAT_URL,
        header: {
          ...XAI_API_REQUEST_HEADERS,
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({
          model: XAI_PAID_HEALTH_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
  ]);

  if (chatRequest.status === 'rejected') throw chatRequest.reason;
  if (chatRequest.value.statusCode < 200 || chatRequest.value.statusCode >= 300) {
    throw createStatusError(
      getApiCallErrorMessage(chatRequest.value),
      chatRequest.value.statusCode
    );
  }

  const profile =
    profileRequest.status === 'fulfilled' &&
    profileRequest.value.statusCode >= 200 &&
    profileRequest.value.statusCode < 300
      ? profileRequest.value.body
      : null;
  return buildXaiPaidHealthSummary(profile);
};

const fetchXaiQuota = async (file: AuthFileItem, t: TFunction): Promise<XaiBillingSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  if (isPaidXaiAuthFile(file)) {
    return requestXaiPaidHealth(authIndex);
  }

  const requestHeader = buildXaiRequestHeaders(file);
  const [weeklyResult, monthlyResult] = await Promise.allSettled([
    requestXaiBilling(authIndex, XAI_BILLING_WEEKLY_URL, requestHeader),
    requestXaiBilling(authIndex, XAI_BILLING_MONTHLY_URL, requestHeader),
  ]);
  const weeklySummary = weeklyResult.status === 'fulfilled' ? weeklyResult.value : null;
  const monthlySummary = monthlyResult.status === 'fulfilled' ? monthlyResult.value : null;
  const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);
  if (summary) return summary;

  const billingError =
    weeklyResult.status === 'rejected'
      ? weeklyResult.reason
      : monthlyResult.status === 'rejected'
        ? monthlyResult.reason
        : new Error(t('xai_quota.empty_data'));

  try {
    return await requestXaiPaidHealth(authIndex);
  } catch {
    throw billingError;
  }
};

const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatXaiRemainingAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.monthlyLimitCents !== null && billing.includedUsedCents !== null
      ? Math.max(0, billing.monthlyLimitCents - billing.includedUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const limit = formatUsdFromCents(billing.monthlyLimitCents);
  if (billing.monthlyLimitCents === null) return remaining;
  return `${remaining} / ${limit}`;
};

const formatXaiOnDemandAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.onDemandCapCents !== null && billing.onDemandUsedCents !== null
      ? Math.max(0, billing.onDemandCapCents - billing.onDemandUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const cap = formatUsdFromCents(billing.onDemandCapCents);
  if (billing.onDemandCapCents === null) return remaining;
  return `${remaining} / ${cap}`;
};

const formatXaiPercent = (value: number | null): string => {
  if (value === null) return '--';
  return `${Math.round(value)}%`;
};

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};

const renderXaiItems = (
  quota: XaiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const billing = quota.billing;

  if (!billing) {
    return h('div', { className: styleMap.quotaMessage }, t('xai_quota.empty_data'));
  }

  if (billing.mode === 'paid-health') {
    return h(
      Fragment,
      null,
      h(
        'div',
        { className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
        h(
          'span',
          { className: styleMap.premiumPlanValue },
          t('xai_quota.plan_paid', { defaultValue: 'Paid' })
        )
      ),
      h(
        'div',
        { className: styleMap.quotaMessage },
        t('xai_quota.paid_health', { defaultValue: 'API access is healthy' })
      )
    );
  }

  const clampedUsed =
    billing.usedPercent === null ? null : Math.max(0, Math.min(100, billing.usedPercent));
  const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
  const percentLabel = formatXaiPercent(remaining);
  const amountLabel = formatXaiRemainingAmount(billing);
  const resetLabel = formatQuotaResetTime(billing.billingPeriodEnd);
  const onDemandCap = billing.onDemandCapCents ?? 0;
  const clampedOnDemandUsed =
    billing.onDemandUsedPercent === null
      ? null
      : Math.max(0, Math.min(100, billing.onDemandUsedPercent));
  const onDemandRemaining =
    clampedOnDemandUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedOnDemandUsed));
  const onDemandPercentLabel = formatXaiPercent(onDemandRemaining);
  const onDemandAmountLabel = formatXaiOnDemandAmount(billing);
  const plan = resolveXaiPlan(billing.monthlyLimitCents);
  const weeklyUsed =
    billing.periodType === 'weekly' && billing.usagePercent !== null
      ? Math.max(0, Math.min(100, billing.usagePercent))
      : null;
  const weeklyRemaining = weeklyUsed === null ? null : Math.max(0, Math.min(100, 100 - weeklyUsed));
  const weeklyResetLabel = formatQuotaResetTime(billing.periodEnd);
  const hasWeeklyData =
    billing.periodType === 'weekly' &&
    (weeklyUsed !== null || Boolean(billing.periodEnd) || billing.productUsage.length > 0);
  const hasMonthlyData = billing.usedPercent !== null || billing.monthlyLimitCents !== null;

  return h(
    Fragment,
    null,
    plan
      ? h(
          'div',
          { key: 'plan', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
          h(
            'span',
            { className: plan.premium ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            t(`xai_quota.${plan.labelKey}`)
          )
        )
      : null,
    hasWeeklyData
      ? h(
          'div',
          { key: 'weekly-limit', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.weekly_limit')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h(
                'span',
                { className: styleMap.quotaPercent },
                t('xai_quota.used_percent', {
                  defaultValue: 'Used {{percent}}',
                  percent: formatXaiPercent(weeklyUsed),
                })
              ),
              weeklyResetLabel !== '-'
                ? h(
                    'span',
                    { className: styleMap.quotaReset },
                    t('xai_quota.reset_at', {
                      defaultValue: 'Resets {{time}}',
                      time: weeklyResetLabel,
                    })
                  )
                : null
            )
          ),
          h(QuotaProgressBar, {
            percent: weeklyRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : null,
    ...billing.productUsage.map((item) => {
      const used =
        item.usagePercent === null ? null : Math.max(0, Math.min(100, item.usagePercent));
      const productRemaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));
      return h(
        'div',
        { key: `product-${item.product}`, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, item.product),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h(
              'span',
              { className: styleMap.quotaPercent },
              t('xai_quota.used_percent', {
                defaultValue: 'Used {{percent}}',
                percent: formatXaiPercent(used),
              })
            )
          )
        ),
        h(QuotaProgressBar, {
          percent: productRemaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    }),
    onDemandCap > 0
      ? h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.pay_as_you_go_label')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, onDemandPercentLabel),
              h('span', { className: styleMap.quotaAmount }, onDemandAmountLabel)
            )
          ),
          h(QuotaProgressBar, {
            percent: onDemandRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.pay_as_you_go_label')),
          h('span', { className: styleMap.codexPlanValue }, t('xai_quota.pay_as_you_go_disabled'))
        ),
    hasMonthlyData
      ? h(
          'div',
          { key: 'monthly-credits', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.monthly_credits')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, percentLabel),
              h('span', { className: styleMap.quotaAmount }, amountLabel),
              resetLabel !== '-' ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
            )
          ),
          h(QuotaProgressBar, {
            percent: remaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : null
  );
};

export const KIMI_CONFIG: QuotaConfig<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: isKimiFile,
  fetchQuota: fetchKimiQuota,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.kimiCard,
  controlsClassName: styles.kimiControls,
  controlClassName: styles.kimiControl,
  gridClassName: styles.kimiGrid,
  renderQuotaItems: renderKimiItems,
};

export const XAI_CONFIG: QuotaConfig<XaiQuotaState, XaiBillingSummary> = {
  type: 'xai',
  i18nPrefix: 'xai_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: isXaiFile,
  fetchQuota: fetchXaiQuota,
  storeSelector: (state) => state.xaiQuota,
  storeSetter: 'setXaiQuota',
  buildLoadingState: () => ({ status: 'loading', billing: null }),
  buildSuccessState: (billing) => ({ status: 'success', billing }),
  buildErrorState: (message, status) => ({
    status: 'error',
    billing: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.xaiCard,
  controlsClassName: styles.xaiControls,
  controlClassName: styles.xaiControl,
  gridClassName: styles.xaiGrid,
  renderQuotaItems: renderXaiItems,
};
