import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { normalizeConfigResponse } = await server.ssrLoadModule(
    '/src/services/api/transformers.ts'
  );
  const { apiKeyFunToResource, code0ToResource, openaiToResource } = await server.ssrLoadModule(
    '/src/features/providers/adapters.ts'
  );
  const { APIKEY_FUN_OPENAI_BASE_URL, APIKEY_FUN_PROVIDER_NAME, buildApiKeyFunRaw } =
    await server.ssrLoadModule('/src/features/providers/sponsor.ts');
  const { CODE0_OPENAI_BASE_URL, buildCode0Raw } = await server.ssrLoadModule(
    '/src/features/providers/code0.ts'
  );
  const { FENNO_AI_CODEX_BASE_URL, FENNO_AI_PROVIDER_NAME, buildFennoAIRaw } =
    await server.ssrLoadModule('/src/features/providers/fennoAI.ts');
  const { KIMI_DOMESTIC_OPENAI_BASE_URL, KIMI_OPENAI_BASE_URL, buildKimiRaw, getKimiProtocolUrls } =
    await server.ssrLoadModule('/src/features/providers/kimi.ts');
  const { getSponsorAggregationConflict, getSponsorProviderDefinition } =
    await server.ssrLoadModule('/src/features/providers/sponsorDefinitions.ts');
  const { isSponsorPartialMutationError, runSponsorMutationWithRecovery } =
    await server.ssrLoadModule('/src/features/providers/sponsorMutationRecovery.ts');

  assert.deepEqual(getSponsorProviderDefinition('code0').protocols, [
    'openai',
    'claude',
    'gemini',
    'codex',
  ]);
  assert.deepEqual(getSponsorProviderDefinition('fennoAI').protocols, ['codex', 'claude']);
  assert.deepEqual(getSponsorProviderDefinition('kimi').protocols, ['openai', 'claude']);

  const customApiKeyFun = buildApiKeyFunRaw({
    openaiCompatibility: [
      {
        name: APIKEY_FUN_PROVIDER_NAME,
        baseUrl: 'https://gateway.example.com/v1',
        apiKeyEntries: [{ apiKey: 'custom' }],
      },
    ],
  });
  assert.deepEqual(customApiKeyFun.openai, []);

  const normalized = normalizeConfigResponse({
    'openai-compatibility': [
      { 'base-url': 'https://invalid.example.com/v1' },
      {
        name: APIKEY_FUN_PROVIDER_NAME,
        'base-url': APIKEY_FUN_OPENAI_BASE_URL,
        'api-key-entries': [{ 'api-key': 'official' }],
      },
      {
        name: APIKEY_FUN_PROVIDER_NAME,
        'base-url': 'https://gateway.example.com/v1',
        'api-key-entries': [{ 'api-key': 'custom' }],
      },
    ],
  });
  assert.deepEqual(
    normalized.openaiCompatibility.map((item) => item.sourceIndex),
    [1, 2]
  );
  assert.deepEqual(
    buildApiKeyFunRaw(normalized).openai.map((item) => item.index),
    [1]
  );
  assert.equal(openaiToResource(normalized.openaiCompatibility[1], 1).originalIndex, 2);

  const code0Raw = buildCode0Raw({
    openaiCompatibility: [
      {
        name: 'code0',
        baseUrl: CODE0_OPENAI_BASE_URL,
        fallback: true,
        apiKeyEntries: [{ apiKey: 'openai', groups: ['paid'] }],
      },
    ],
    codexApiKeys: [
      {
        apiKey: 'codex',
        baseUrl: CODE0_OPENAI_BASE_URL,
        groups: ['team'],
        fallback: true,
      },
    ],
  });
  const code0Resource = code0ToResource(code0Raw);
  assert.ok(code0Resource);
  assert.deepEqual(code0Resource.groups, ['paid', 'team']);
  assert.equal(code0Resource.fallback, true);
  assert.deepEqual(code0Resource.flags.protocols, [
    'openai',
    'anthropic',
    'gemini',
    'codexResponses',
  ]);

  const apiKeyFunResource = apiKeyFunToResource(buildApiKeyFunRaw(normalized));
  assert.ok(apiKeyFunResource);
  assert.equal(apiKeyFunResource.selector.openaiIndices[0], 1);

  const conflictRaw = {
    openai: [
      {
        index: 0,
        config: {
          name: 'sponsor',
          baseUrl: 'https://example.com/v1',
          apiKeyEntries: [{ apiKey: 'first' }, { apiKey: 'second' }],
        },
      },
    ],
    claude: [],
    codex: [],
    gemini: [],
  };
  assert.equal(getSponsorAggregationConflict(conflictRaw), 'multiple-openai-keys');
  conflictRaw.openai = [];
  conflictRaw.codex = [
    { index: 0, config: { apiKey: 'first' } },
    { index: 1, config: { apiKey: 'second' } },
  ];
  assert.equal(getSponsorAggregationConflict(conflictRaw), 'multiple-configs');

  const fennoRaw = buildFennoAIRaw({
    openaiCompatibility: [
      {
        name: FENNO_AI_PROVIDER_NAME,
        baseUrl: FENNO_AI_CODEX_BASE_URL,
        apiKeyEntries: [{ apiKey: 'must-stay-generic' }],
      },
    ],
    codexApiKeys: [{ apiKey: 'codex', baseUrl: FENNO_AI_CODEX_BASE_URL }],
  });
  assert.deepEqual(fennoRaw.openai, []);
  assert.deepEqual(
    fennoRaw.codex.map((item) => item.index),
    [0]
  );

  assert.deepEqual(getKimiProtocolUrls(undefined), {
    openai: KIMI_DOMESTIC_OPENAI_BASE_URL,
    anthropic: 'https://api.moonshot.cn/anthropic',
    codex: '',
    gemini: '',
  });
  const kimiRaw = buildKimiRaw({
    openaiCompatibility: [
      { name: 'kimi', baseUrl: KIMI_OPENAI_BASE_URL },
      { name: 'custom', baseUrl: 'https://gateway.example.com/v1' },
    ],
  });
  assert.deepEqual(
    kimiRaw.openai.map((item) => item.index),
    [0]
  );

  const originalError = new Error('partial mutation');
  let refreshCount = 0;
  await assert.rejects(
    runSponsorMutationWithRecovery(
      async () => {
        throw originalError;
      },
      async () => {
        refreshCount += 1;
      }
    ),
    (error) => isSponsorPartialMutationError(error) && error.cause === originalError
  );
  assert.equal(refreshCount, 1);
} finally {
  await server.close();
}

console.log('sponsor provider lifecycle tests passed');
