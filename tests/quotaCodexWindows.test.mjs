import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
const styles = new Proxy({}, { get: (_target, key) => String(key) });
const helpers = {
  styles,
  QuotaProgressBar: ({ percent }) =>
    React.createElement('span', { 'data-progress-percent': percent ?? 'unknown' }),
};

const accountEvidence = (overrides = {}) => ({
  selectedAccountFingerprint: 'selected123456',
  upstreamAccountFingerprint: 'upstream12345',
  tokenClaimAccountFingerprint: 'claim12345678',
  credentialPlanType: 'team',
  upstreamPlanType: 'team',
  fedRAMP: false,
  fedRAMPKnown: true,
  accountMatchesUpstream: true,
  tokenClaimsPresent: true,
  tokenClaimMismatch: false,
  ...overrides,
});

const emptyResetCredits = {
  availableCount: null,
  credits: [],
  error: '',
  upstreamStatus: null,
};

const hiddenCredentialCardFacts = [
  'codex_quota.upstream_plan_label',
  'codex_quota.credential_plan_label',
  'codex_quota.reset_credits_label',
  'codex_quota.selected_workspace_label',
  'codex_quota.upstream_workspace_label',
  'codex_quota.workspace_match_label',
  'codex_quota.workspace_match_yes',
  'codex_quota.workspace_match_no',
  'codex_quota.token_claim_workspace_label',
  'codex_quota.token_claim_context_label',
  'codex_quota.token_claim_match',
  'codex_quota.token_claim_mismatch',
  'codex_quota.fedramp_label',
  'codex_quota.observed_at_label',
  'codex_quota.observed_at_stale',
];

try {
  const { CODEX_CONFIG } = await server.ssrLoadModule('/src/components/quota/quotaConfigs.ts');
  const { codexQuotaApi } = await server.ssrLoadModule('/src/services/api/index.ts');
  const originalGet = codexQuotaApi.get;
  const requests = [];

  try {
    codexQuotaApi.get = async (authIndex) => {
      requests.push(authIndex);
      return {
        authIndex,
        account: accountEvidence(),
        observedAt: new Date().toISOString(),
        subscriptionActiveUntil: null,
        usage: {
          additional_rate_limits: [
            {
              limit_name: 'Spark',
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  limit_window_seconds: 604800,
                  used_percent: 80,
                  reset_at: 1_800_000_000,
                },
                secondary_window: {
                  limit_window_seconds: 18000,
                  used_percent: 10,
                  reset_at: 1_800_000_000,
                },
              },
            },
            {
              limit_name: 'Team',
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  limit_window_seconds: 2592000,
                  used_percent: 60,
                  reset_at: 1_800_000_000,
                },
                secondary_window: {
                  limit_window_seconds: 18000,
                  used_percent: 20,
                  reset_at: 1_800_000_000,
                },
              },
            },
          ],
        },
        resetCredits: emptyResetCredits,
      };
    };

    const classified = await CODEX_CONFIG.fetchQuota(
      { name: 'codex.json', type: 'codex', auth_index: 'codex:1' },
      t
    );

    assert.deepEqual(
      classified.limits.flatMap((limit) =>
        limit.windows.map(({ id, source, usedPercent }) => ({ id, source, usedPercent }))
      ),
      [
        { id: 'spark-five-hour-0', source: 'secondary', usedPercent: 10 },
        { id: 'spark-weekly-0', source: 'primary', usedPercent: 80 },
        { id: 'team-five-hour-1', source: 'secondary', usedPercent: 20 },
        { id: 'team-monthly-1', source: 'primary', usedPercent: 60 },
      ]
    );
    assert.equal(classified.observationStale, false);
    const classifiedHtml = renderToStaticMarkup(
      CODEX_CONFIG.renderQuotaItems(CODEX_CONFIG.buildSuccessState(classified), t, helpers)
    );
    for (const hiddenFact of hiddenCredentialCardFacts) {
      assert.equal(classifiedHtml.includes(hiddenFact), false);
    }
    for (const fingerprint of ['selected123456', 'upstream12345', 'claim12345678']) {
      assert.equal(classifiedHtml.includes(fingerprint), false);
    }
    assert.equal(
      requests.every((authIndex) => authIndex === 'codex:1'),
      true
    );

    codexQuotaApi.get = async (authIndex) => ({
      authIndex,
      account: accountEvidence({
        credentialPlanType: 'plus',
        upstreamPlanType: 'team',
        accountMatchesUpstream: false,
        tokenClaimMismatch: true,
      }),
      observedAt: '2000-01-01T00:00:00Z',
      subscriptionActiveUntil: '2030-01-01T00:00:00Z',
      usage: {
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            limit_window_seconds: 18000,
            used_percent: 25,
            reset_at: 1_800_000_000,
          },
          secondary_window: {
            limit_window_seconds: 604800,
            used_percent: 40,
            reset_at: 1_800_000_000,
          },
        },
        code_review_rate_limit: {
          allowed: false,
          limit_reached: true,
          primary_window: {
            limit_window_seconds: 18000,
            reset_at: 1_800_000_000,
          },
          secondary_window: null,
        },
        additional_rate_limits: [
          {
            limit_name: 'codex_feature',
            metered_feature: 'codex_feature',
            rate_limit: {
              allowed: false,
              limit_reached: true,
              primary_window: null,
              secondary_window: null,
            },
          },
          {
            limit_name: 'unknown_feature',
            metered_feature: 'unknown_feature',
            rate_limit: null,
          },
        ],
      },
      resetCredits: {
        availableCount: 1,
        credits: [
          {
            id: 'sanitized-credit',
            status: 'available',
            grantedAt: '2029-01-01T00:00:00Z',
            expiresAt: '2030-01-01T00:00:00Z',
          },
        ],
        error: '',
        upstreamStatus: null,
      },
    });

    const facts = await CODEX_CONFIG.fetchQuota(
      { name: 'codex.json', type: 'codex', auth_index: 'codex:2' },
      t
    );
    assert.equal(facts.observationStale, true);
    assert.equal(facts.account.accountMatchesUpstream, false);
    assert.equal(facts.account.credentialPlanType, 'plus');
    assert.equal(facts.account.upstreamPlanType, 'team');
    assert.equal(facts.rateLimitResetCreditsAvailableCount, 1);
    assert.deepEqual(
      facts.limits.map(({ id, allowed, limitReached, windows }) => ({
        id,
        allowed,
        limitReached,
        windowCount: windows.length,
      })),
      [
        { id: 'main', allowed: true, limitReached: false, windowCount: 2 },
        { id: 'code-review', allowed: false, limitReached: true, windowCount: 1 },
        {
          id: 'additional-codex-feature-0',
          allowed: false,
          limitReached: true,
          windowCount: 0,
        },
        {
          id: 'additional-unknown-feature-1',
          allowed: null,
          limitReached: null,
          windowCount: 0,
        },
      ]
    );
    assert.equal(
      facts.limits.find((limit) => limit.id === 'code-review').windows[0].usedPercent,
      null
    );

    const successState = CODEX_CONFIG.buildSuccessState(facts);
    const html = renderToStaticMarkup(CODEX_CONFIG.renderQuotaItems(successState, t, helpers));
    for (const expected of [
      'codex_quota.expires_label',
      'codex_quota.allowed_label',
      'codex_quota.limit_reached_label',
      'codex_quota.no_windows_for_limit',
      'codex_quota.used_percent',
      'codex_quota.used_percent_unknown',
      'codex_quota.remaining_percent',
      'codex_quota.window_source',
      'codex_quota.window_duration',
      'codex_quota.reset_credits_expiry_label',
    ]) {
      assert.match(html, new RegExp(expected.replaceAll('.', '\\.')));
    }
    for (const hiddenFact of hiddenCredentialCardFacts) {
      assert.equal(html.includes(hiddenFact), false);
    }
    for (const fingerprint of ['selected123456', 'upstream12345', 'claim12345678']) {
      assert.equal(html.includes(fingerprint), false);
    }
    for (const forbidden of ['$60', '$100', 'team balance', 'team allowance']) {
      assert.equal(html.toLowerCase().includes(forbidden), false);
    }

    const loadingState = CODEX_CONFIG.buildLoadingState();
    assert.equal(loadingState.status, 'loading');
    assert.deepEqual(loadingState.limits, []);
    const errorState = CODEX_CONFIG.buildErrorState('upstream failed', 502);
    assert.equal(errorState.status, 'error');
    assert.equal(errorState.error, 'upstream failed');
    assert.equal(errorState.errorStatus, 502);
  } finally {
    codexQuotaApi.get = originalGet;
  }
} finally {
  await server.close();
}

console.log('Codex quota window tests passed');
