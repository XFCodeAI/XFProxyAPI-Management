import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const usageEntry = (overrides) => ({
  success: 0,
  failed: 0,
  recent_requests: [],
  auth_indexes: [],
  recent_failure_count: 0,
  ...overrides,
});

const resource = (overrides) => ({
  id: 'resource',
  brand: 'codex',
  originalIndex: 0,
  name: null,
  groups: [],
  identifier: 'resource',
  apiKeyPreview: null,
  apiKey: null,
  authIndex: null,
  baseUrl: null,
  proxyUrl: null,
  prefix: null,
  modelCount: 0,
  models: [],
  priority: 0,
  fallback: false,
  headerCount: 0,
  excludedModelCount: 0,
  apiKeyEntryCount: 0,
  disabled: false,
  runtimeStatus: null,
  flags: {},
  selector: { brand: 'codex', apiKey: '', index: 0 },
  raw: {},
  ...overrides,
});

try {
  const recentRequests = await server.ssrLoadModule('/src/utils/recentRequests.ts');
  const providerRecentRequests = await server.ssrLoadModule(
    '/src/services/providerRecentRequests.ts'
  );
  const providerUsage = await server.ssrLoadModule('/src/features/providers/providerUsage.ts');

  const history = recentRequests.normalizeApiKeyFailureHistory({
    auth_index: 'auth-index-1',
    auth_id: 'auth-id-1',
    provider: 'codex',
    alias: 'primary',
    key_preview: 'sk-...demo',
    monitoring_available: true,
    failures: [
      {
        timestamp: '2026-08-03T10:00:00Z',
        status_code: 429,
        code: 'rate_limit',
        message: 'upstream rate limited',
        model: 'gpt-test',
        request_id: 'request-1',
        scope: 'upstream',
        retryable: true,
        retry_after_seconds: 30,
        next_retry_at: '2026-08-03T10:00:30Z',
      },
    ],
  });
  assert.equal(history.authId, 'auth-id-1');
  assert.equal(history.monitoringAvailable, true);
  assert.deepEqual(history.failures[0], {
    timestamp: '2026-08-03T10:00:00Z',
    statusCode: 429,
    code: 'rate_limit',
    message: 'upstream rate limited',
    model: 'gpt-test',
    requestId: 'request-1',
    scope: 'upstream',
    retryable: true,
    retryAfterSeconds: 30,
    nextRetryAt: '2026-08-03T10:00:30Z',
  });

  const usage = providerRecentRequests.normalizeProviderRecentRequests({
    codex: {
      'https://codex.example/v1|sk-native': usageEntry({
        success: 2,
        failed: 1,
        recent_requests: [{ success: 1, failed: 1 }],
        auth_indexes: ['native-index'],
        recent_failure_count: 1,
        latest_failure: {
          timestamp: '2026-08-03T09:00:00Z',
          status_code: 500,
          message: 'native failed',
          scope: 'upstream',
        },
      }),
    },
    shared: {
      'https://shared.example/v1|sk-one': usageEntry({
        success: 3,
        failed: 1,
        recent_requests: [{ success: 3, failed: 1 }],
        auth_indexes: ['shared-one'],
        recent_failure_count: 1,
        latest_failure: {
          timestamp: '2026-08-03T10:00:00Z',
          message: 'shared one failed',
          scope: 'transport',
        },
      }),
      'https://shared.example/v1|sk-two': usageEntry({
        success: 2,
        failed: 2,
        recent_requests: [{ success: 1, failed: 2 }],
        auth_indexes: ['shared-two'],
        recent_failure_count: 2,
        latest_failure: {
          timestamp: '2026-08-03T11:00:00Z',
          message: 'shared two failed',
          scope: 'upstream',
        },
      }),
    },
    kimi: {
      'https://api.moonshot.cn/v1|sk-kimi-openai': usageEntry({
        success: 5,
        failed: 1,
        recent_requests: [{ success: 5, failed: 1 }],
        auth_indexes: ['kimi-openai'],
        recent_failure_count: 1,
        latest_failure: {
          timestamp: '2026-08-03T12:00:00Z',
          message: 'kimi openai failed',
          scope: 'upstream',
        },
      }),
    },
    claude: {
      'https://api.moonshot.cn/anthropic|sk-kimi-claude': usageEntry({
        success: 6,
        failed: 2,
        recent_requests: [{ success: 4, failed: 2 }],
        auth_indexes: ['kimi-claude'],
        recent_failure_count: 2,
        latest_failure: {
          timestamp: '2026-08-03T13:00:00Z',
          message: 'kimi claude failed',
          scope: 'transport',
        },
      }),
    },
  });

  const native = providerUsage.getProviderResourceUsage(
    resource({
      apiKey: 'sk-native',
      baseUrl: 'https://codex.example/v1',
    }),
    usage
  );
  assert.equal(native.success, 2);
  assert.equal(native.latestFailure.message, 'native failed');

  const openAIConfig = {
    name: 'Shared',
    baseUrl: 'https://shared.example/v1',
    apiKeyEntries: [{ apiKey: 'sk-one' }, { apiKey: 'sk-two' }, { apiKey: 'sk-one' }],
  };
  const openAI = providerUsage.getProviderResourceUsage(
    resource({
      brand: 'openaiCompatibility',
      raw: openAIConfig,
      usageRaw: openAIConfig,
    }),
    usage
  );
  assert.deepEqual(
    { success: openAI.success, failed: openAI.failed, count: openAI.recentFailureCount },
    { success: 5, failed: 3, count: 3 }
  );
  assert.deepEqual(openAI.authIndexes, ['shared-one', 'shared-two']);
  assert.equal(openAI.latestFailure.message, 'shared two failed');

  const kimiRaw = {
    openai: [
      {
        index: 0,
        config: {
          name: 'kimi',
          baseUrl: 'https://api.moonshot.cn/v1',
          apiKeyEntries: [{ apiKey: 'sk-kimi-openai' }],
        },
      },
    ],
    claude: [
      {
        index: 0,
        config: {
          apiKey: 'sk-kimi-claude',
          baseUrl: 'https://api.moonshot.cn/anthropic',
        },
      },
    ],
  };
  const kimi = providerUsage.getProviderResourceUsage(
    resource({ brand: 'kimi', raw: kimiRaw }),
    usage
  );
  assert.deepEqual(
    { success: kimi.success, failed: kimi.failed, count: kimi.recentFailureCount },
    { success: 11, failed: 3, count: 3 }
  );
  assert.deepEqual(kimi.authIndexes, ['kimi-openai', 'kimi-claude']);
  assert.equal(kimi.latestFailure.message, 'kimi claude failed');
} finally {
  await server.close();
}
