import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const result = (statusCode, body = null) => ({
  statusCode,
  header: {},
  bodyText: body === null ? '' : JSON.stringify(body),
  body,
});

const t = (key) => key;

try {
  const { XAI_CONFIG } = await server.ssrLoadModule('/src/components/quota/quotaConfigs.ts');
  const { apiCallApi } = await server.ssrLoadModule('/src/services/api/index.ts');
  const { XAI_API_CHAT_URL, XAI_API_ME_URL, XAI_BILLING_MONTHLY_URL, XAI_BILLING_WEEKLY_URL } =
    await server.ssrLoadModule('/src/utils/quota/index.ts');
  const originalRequest = apiCallApi.request;

  try {
    const paidRequests = [];
    apiCallApi.request = async (payload) => {
      paidRequests.push(payload);
      if (payload.url === XAI_API_ME_URL) {
        return result(200, { user_id: 'paid-user', team_id: 'paid-team' });
      }
      return result(200, { choices: [] });
    };

    const paidSummary = await XAI_CONFIG.fetchQuota(
      {
        name: 'paid.json',
        type: 'xai',
        auth_index: 'xai:paid',
        using_api: true,
        prefix: 'paid',
      },
      t
    );

    assert.deepEqual(
      paidRequests.map(({ url }) => url),
      [XAI_API_ME_URL, XAI_API_CHAT_URL]
    );
    assert.equal(
      paidRequests.every(({ authIndex }) => authIndex === 'xai:paid'),
      true
    );
    assert.deepEqual(JSON.parse(paidRequests[1].data), {
      model: 'grok-4.5',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    });
    assert.deepEqual(
      {
        mode: paidSummary.mode,
        source: paidSummary.source,
        planType: paidSummary.planType,
        healthStatus: paidSummary.healthStatus,
        userId: paidSummary.userId,
        teamId: paidSummary.teamId,
      },
      {
        mode: 'paid-health',
        source: 'api.x.ai-fallback',
        planType: 'paid',
        healthStatus: 'chat-ok',
        userId: 'paid-user',
        teamId: 'paid-team',
      }
    );

    const unifiedRequests = [];
    apiCallApi.request = async (payload) => {
      unifiedRequests.push(payload);
      if (payload.url === XAI_BILLING_WEEKLY_URL) {
        return result(200, {
          config: {
            current_period: {
              type: 'weekly',
              start: '2026-08-13T00:00:00Z',
              end: '2026-08-20T00:00:00Z',
            },
            credit_usage_percent: 3,
          },
        });
      }
      if (payload.url === XAI_BILLING_MONTHLY_URL) {
        return result(402, { error: 'Deprecated endpoint limit' });
      }
      throw new Error(`unexpected xAI request: ${payload.url}`);
    };

    const unifiedSummary = await XAI_CONFIG.fetchQuota(
      { name: 'unified.json', type: 'xai', auth_index: 'xai:unified' },
      t
    );
    assert.deepEqual(
      unifiedRequests.map(({ url }) => url),
      [XAI_BILLING_WEEKLY_URL, XAI_BILLING_MONTHLY_URL]
    );
    assert.deepEqual(
      {
        mode: unifiedSummary.mode,
        periodType: unifiedSummary.periodType,
        usagePercent: unifiedSummary.usagePercent,
      },
      { mode: 'billing', periodType: 'weekly', usagePercent: 3 }
    );

    const legacyRequests = [];
    apiCallApi.request = async (payload) => {
      legacyRequests.push(payload);
      if (payload.url === XAI_BILLING_WEEKLY_URL) {
        return result(503, { error: 'Unified billing unavailable' });
      }
      if (payload.url === XAI_BILLING_MONTHLY_URL) {
        return result(200, { config: { monthly_limit: 20_000, used: 5_000 } });
      }
      throw new Error(`unexpected xAI request: ${payload.url}`);
    };

    const legacySummary = await XAI_CONFIG.fetchQuota(
      { name: 'legacy.json', type: 'xai', auth_index: 'xai:legacy' },
      t
    );
    assert.deepEqual(
      legacyRequests.map(({ url }) => url),
      [XAI_BILLING_WEEKLY_URL, XAI_BILLING_MONTHLY_URL]
    );
    assert.deepEqual(
      {
        periodType: legacySummary.periodType,
        monthlyLimitCents: legacySummary.monthlyLimitCents,
        usedCents: legacySummary.usedCents,
        usedPercent: legacySummary.usedPercent,
      },
      { periodType: 'monthly', monthlyLimitCents: 20_000, usedCents: 5_000, usedPercent: 25 }
    );

    const fallbackRequests = [];
    apiCallApi.request = async (payload) => {
      fallbackRequests.push(payload);
      if (payload.url === XAI_BILLING_WEEKLY_URL || payload.url === XAI_BILLING_MONTHLY_URL) {
        return result(403, { error: 'Access denied' });
      }
      if (payload.url === XAI_API_ME_URL) return result(500, { error: 'Profile unavailable' });
      return result(200, { choices: [] });
    };

    const fallbackSummary = await XAI_CONFIG.fetchQuota(
      { name: 'unknown.json', type: 'xai', auth_index: 'xai:fallback' },
      t
    );

    assert.deepEqual(
      fallbackRequests.map(({ url }) => url),
      [XAI_BILLING_WEEKLY_URL, XAI_BILLING_MONTHLY_URL, XAI_API_ME_URL, XAI_API_CHAT_URL]
    );
    assert.equal(
      fallbackRequests.every(({ authIndex }) => authIndex === 'xai:fallback'),
      true
    );
    assert.equal(fallbackSummary.mode, 'paid-health');
    assert.equal(fallbackSummary.userId, undefined);

    apiCallApi.request = async (payload) => {
      if (payload.url === XAI_API_CHAT_URL) return result(401, { error: 'Invalid token' });
      return result(403, { error: 'Access denied' });
    };

    await assert.rejects(
      XAI_CONFIG.fetchQuota({ name: 'invalid.json', type: 'xai', auth_index: 'xai:invalid' }, t),
      (error) => error?.status === 403
    );
  } finally {
    apiCallApi.request = originalRequest;
  }
} finally {
  await server.close();
}

console.log('xAI quota fallback tests passed');
