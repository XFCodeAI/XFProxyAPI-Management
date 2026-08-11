import type { CodexRateLimitResetCredit, CodexUsagePayload } from '@/types';
import { apiClient } from './client';

const CODEX_QUOTA_TIMEOUT_MS = 20_000;

type CodexQuotaAccountEvidenceResponse = {
  selected_account_fingerprint: string;
  upstream_account_fingerprint?: string;
  token_claim_account_fingerprint?: string;
  credential_plan_type?: string;
  upstream_plan_type?: string;
  fedramp: boolean;
  fedramp_known: boolean;
  account_matches_upstream?: boolean;
  token_claims_present: boolean;
  token_claim_mismatch: boolean;
};

type CodexQuotaResetCreditResponse = {
  status?: string;
  granted_at?: string;
  expires_at?: string;
};

type CodexQuotaResponse = {
  credential_id: string;
  credential_generation: number;
  auth_index: string;
  account: CodexQuotaAccountEvidenceResponse;
  observed_at: string;
  subscription_active_until?: string | number;
  usage: CodexUsagePayload;
  reset_credits: {
    available_count?: number;
    credits: CodexQuotaResetCreditResponse[];
    error?: string;
    upstream_status?: number;
  };
};

export type CodexQuotaSnapshot = {
  credentialId: string;
  credentialGeneration: number;
  authIndex: string;
  account: {
    selectedAccountFingerprint: string;
    upstreamAccountFingerprint: string | null;
    tokenClaimAccountFingerprint: string | null;
    credentialPlanType: string | null;
    upstreamPlanType: string | null;
    fedRAMP: boolean;
    fedRAMPKnown: boolean;
    accountMatchesUpstream: boolean | null;
    tokenClaimsPresent: boolean;
    tokenClaimMismatch: boolean;
  };
  observedAt: string;
  subscriptionActiveUntil: string | number | null;
  usage: CodexUsagePayload;
  resetCredits: {
    availableCount: number | null;
    credits: CodexRateLimitResetCredit[];
    error: string;
    upstreamStatus: number | null;
  };
};

export type CodexQuotaIdentityTarget = {
  credentialId?: string | null;
  authIndex: string;
  credentialGeneration?: number | null;
};

type CodexQuotaResetResponse = {
  credential_id: string;
  credential_generation: number;
  auth_index: string;
  result: unknown;
};

export type CodexQuotaResetSnapshot = {
  credentialId: string;
  credentialGeneration: number;
  authIndex: string;
  result: unknown;
};

type CodexQuotaContextError = Error & {
  status: number;
  code: string;
};

const createCodexQuotaContextChangedError = (): CodexQuotaContextError => {
  const error = new Error(
    'credential context changed while requesting Codex quota'
  ) as CodexQuotaContextError;
  error.name = 'ApiError';
  error.status = 409;
  error.code = 'auth_context_changed';
  return error;
};

export const isCodexQuotaContextChangedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 409 && candidate.code === 'auth_context_changed';
};

const normalizeIdentityTarget = (
  target: string | CodexQuotaIdentityTarget
): CodexQuotaIdentityTarget =>
  typeof target === 'string'
    ? { authIndex: target.trim() }
    : {
        credentialId: String(target.credentialId ?? '').trim() || null,
        authIndex: String(target.authIndex ?? '').trim(),
        credentialGeneration:
          Number.isSafeInteger(target.credentialGeneration) &&
          Number(target.credentialGeneration) >= 0
            ? Number(target.credentialGeneration)
            : null,
      };

const readResponseIdentity = (response: {
  credential_id: string;
  credential_generation: number;
  auth_index: string;
}) => {
  const credentialId = String(response.credential_id ?? '').trim();
  const authIndex = String(response.auth_index ?? '').trim();
  const credentialGeneration = Number(response.credential_generation);
  if (
    !credentialId ||
    !authIndex ||
    !Number.isSafeInteger(credentialGeneration) ||
    credentialGeneration < 1
  ) {
    throw createCodexQuotaContextChangedError();
  }
  return { credentialId, authIndex, credentialGeneration };
};

const assertResponseIdentity = (
  response: {
    credential_id: string;
    credential_generation: number;
    auth_index: string;
  },
  expected: CodexQuotaIdentityTarget
) => {
  const identity = readResponseIdentity(response);
  if (
    identity.authIndex !== expected.authIndex ||
    (expected.credentialId && identity.credentialId !== expected.credentialId) ||
    (expected.credentialGeneration !== null &&
      expected.credentialGeneration !== undefined &&
      identity.credentialGeneration < expected.credentialGeneration)
  ) {
    throw createCodexQuotaContextChangedError();
  }
  return identity;
};

const normalizeCredit = (
  credit: CodexQuotaResetCreditResponse,
  index: number
): CodexRateLimitResetCredit => ({
  id: `${credit.expires_at ?? 'credit'}-${index}`,
  status: credit.status ?? '',
  grantedAt: credit.granted_at ?? '',
  expiresAt: credit.expires_at ?? '',
});

const normalizeSnapshot = (
  response: CodexQuotaResponse,
  expected: CodexQuotaIdentityTarget
): CodexQuotaSnapshot => ({
  ...assertResponseIdentity(response, expected),
  account: {
    selectedAccountFingerprint: response.account.selected_account_fingerprint,
    upstreamAccountFingerprint: response.account.upstream_account_fingerprint ?? null,
    tokenClaimAccountFingerprint: response.account.token_claim_account_fingerprint ?? null,
    credentialPlanType: response.account.credential_plan_type ?? null,
    upstreamPlanType: response.account.upstream_plan_type ?? null,
    fedRAMP: response.account.fedramp,
    fedRAMPKnown: response.account.fedramp_known,
    accountMatchesUpstream: response.account.account_matches_upstream ?? null,
    tokenClaimsPresent: response.account.token_claims_present,
    tokenClaimMismatch: response.account.token_claim_mismatch,
  },
  observedAt: response.observed_at,
  subscriptionActiveUntil: response.subscription_active_until ?? null,
  usage: response.usage,
  resetCredits: {
    availableCount: response.reset_credits.available_count ?? null,
    credits: response.reset_credits.credits.map(normalizeCredit),
    error: response.reset_credits.error ?? '',
    upstreamStatus: response.reset_credits.upstream_status ?? null,
  },
});

export const codexQuotaApi = {
  async get(target: string | CodexQuotaIdentityTarget): Promise<CodexQuotaSnapshot> {
    const identity = normalizeIdentityTarget(target);
    const response = await apiClient.get<CodexQuotaResponse>('/codex/quota', {
      params: { auth_index: identity.authIndex },
      timeout: CODEX_QUOTA_TIMEOUT_MS,
    });
    return normalizeSnapshot(response, identity);
  },

  async consumeResetCredit(
    target: string | CodexQuotaIdentityTarget
  ): Promise<CodexQuotaResetSnapshot> {
    const identity = normalizeIdentityTarget(target);
    const response = await apiClient.post<CodexQuotaResetResponse>(
      '/codex/quota/reset-credit',
      { auth_index: identity.authIndex },
      { timeout: CODEX_QUOTA_TIMEOUT_MS }
    );
    return {
      ...assertResponseIdentity(response, identity),
      result: response.result,
    };
  },
};
