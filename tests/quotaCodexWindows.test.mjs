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

try {
  const { CODEX_CONFIG } = await server.ssrLoadModule('/src/components/quota/quotaConfigs.ts');
  const { apiCallApi } = await server.ssrLoadModule('/src/services/api/index.ts');
  const { CODEX_RATE_LIMIT_RESET_CREDITS_URL, CODEX_USAGE_URL } = await server.ssrLoadModule(
    '/src/utils/quota/index.ts'
  );
  const originalRequest = apiCallApi.request;
  const requests = [];

  try {
    apiCallApi.request = async (payload) => {
      requests.push(payload);
      if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL) {
        return result(404, { error: 'Not available' });
      }
      assert.equal(payload.url, CODEX_USAGE_URL);
      return result(200, {
        additional_rate_limits: [
          {
            limit_name: 'Spark',
            rate_limit: {
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
      });
    };

    const quota = await CODEX_CONFIG.fetchQuota(
      { name: 'codex.json', type: 'codex', auth_index: 'codex:1' },
      (key) => key
    );

    assert.deepEqual(
      quota.windows.map(({ id, usedPercent }) => ({ id, usedPercent })),
      [
        { id: 'spark-five-hour-0', usedPercent: 10 },
        { id: 'spark-weekly-0', usedPercent: 80 },
        { id: 'team-five-hour-1', usedPercent: 20 },
        { id: 'team-monthly-1', usedPercent: 60 },
      ]
    );
    assert.equal(
      requests.every(({ authIndex }) => authIndex === 'codex:1'),
      true
    );
  } finally {
    apiCallApi.request = originalRequest;
  }
} finally {
  await server.close();
}

console.log('Codex quota window tests passed');
