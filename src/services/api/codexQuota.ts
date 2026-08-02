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

const normalizeCredit = (
  credit: CodexQuotaResetCreditResponse,
  index: number
): CodexRateLimitResetCredit => ({
  id: `${credit.expires_at ?? 'credit'}-${index}`,
  status: credit.status ?? '',
  grantedAt: credit.granted_at ?? '',
  expiresAt: credit.expires_at ?? '',
});

const normalizeSnapshot = (response: CodexQuotaResponse): CodexQuotaSnapshot => ({
  authIndex: response.auth_index,
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
  async get(authIndex: string): Promise<CodexQuotaSnapshot> {
    const response = await apiClient.get<CodexQuotaResponse>('/codex/quota', {
      params: { auth_index: authIndex },
      timeout: CODEX_QUOTA_TIMEOUT_MS,
    });
    return normalizeSnapshot(response);
  },

  consumeResetCredit(authIndex: string): Promise<unknown> {
    return apiClient.post(
      '/codex/quota/reset-credit',
      { auth_index: authIndex },
      { timeout: CODEX_QUOTA_TIMEOUT_MS }
    );
  },
};
