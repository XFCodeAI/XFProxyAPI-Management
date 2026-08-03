import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const {
    appendLatestProviderRecord,
    replaceLatestProviderRecord,
    serializeOpenAIProvider,
    serializeProviderKey,
  } = await server.ssrLoadModule('/src/services/api/providers.ts');
  const { normalizeOpenAIProvider, normalizeProviderKeyConfig } = await server.ssrLoadModule(
    '/src/services/api/transformers.ts'
  );
  const { kimiToResource } = await server.ssrLoadModule('/src/features/providers/adapters.ts');
  const { buildSponsorClaudeConfig, buildSponsorOpenAIConfig } = await server.ssrLoadModule(
    '/src/features/providers/useProviderWorkbench.ts'
  );
  const { buildAuthFileFieldsPatch } = await server.ssrLoadModule(
    '/src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts'
  );
  const mergeRecord = (raw, payload) => ({ ...raw, ...payload });
  const latest = [
    { 'api-key': 'existing', custom: 'keep' },
    { 'api-key': 'concurrent', custom: 'also-keep' },
  ];

  assert.deepEqual(appendLatestProviderRecord(latest, { 'api-key': 'created' }, mergeRecord), [
    { 'api-key': 'existing', custom: 'keep' },
    { 'api-key': 'concurrent', custom: 'also-keep' },
    { 'api-key': 'created' },
  ]);

  assert.deepEqual(
    replaceLatestProviderRecord(
      latest,
      (record) => record['api-key'] === 'existing',
      { 'api-key': 'updated' },
      mergeRecord
    ),
    [
      { 'api-key': 'updated', custom: 'keep' },
      { 'api-key': 'concurrent', custom: 'also-keep' },
    ]
  );

  assert.throws(
    () =>
      replaceLatestProviderRecord(
        latest,
        (record) => record['api-key'] === 'missing',
        { 'api-key': 'updated' },
        mergeRecord
      ),
    /configuration changed/
  );

  const inheritedNative = serializeProviderKey({ apiKey: 'native-key', maxConcurrency: 0 });
  assert.equal(inheritedNative['concurrency-mode'], 'inherit');
  assert.equal(inheritedNative['max-concurrency'], 0);
  const normalizedLegacyNative = normalizeProviderKeyConfig({
    'api-key': 'native-key',
    'max-concurrency': 7,
  });
  assert.equal(normalizedLegacyNative.concurrencyMode, 'independent');
  assert.equal(normalizedLegacyNative.maxConcurrency, 7);

  const openAI = serializeOpenAIProvider({
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    concurrencyMode: 'independent',
    maxConcurrency: 30,
    apiKeyEntries: [
      {
        name: 'primary',
        apiKey: 'key-one',
        concurrencyMode: 'independent',
        maxConcurrency: 4,
      },
      {
        name: 'unlimited',
        apiKey: 'key-two',
        concurrencyMode: 'independent',
        maxConcurrency: 0,
      },
    ],
  });
  assert.equal(openAI['max-concurrency'], 30);
  assert.equal(openAI['concurrency-mode'], 'independent');
  assert.deepEqual(
    openAI['api-key-entries'].map((entry) => entry['concurrency-mode']),
    ['independent', 'independent']
  );
  assert.deepEqual(
    openAI['api-key-entries'].map((entry) => entry['max-concurrency']),
    [4, 0]
  );
  const normalizedOpenAI = normalizeOpenAIProvider(openAI, 0);
  assert.equal(normalizedOpenAI.maxConcurrency, 30);
  assert.equal(normalizedOpenAI.concurrencyMode, 'independent');
  assert.deepEqual(
    normalizedOpenAI.apiKeyEntries.map((entry) => entry.maxConcurrency),
    [4, 0]
  );

  const getProtocolUrls = () => ({
    anthropic: 'https://api.moonshot.cn/anthropic',
    openai: 'https://api.moonshot.cn/v1',
  });
  const sponsorOpenAI = buildSponsorOpenAIConfig(
    {
      protocol: 'openai',
      apiKey: 'kimi-openai-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      proxyUrl: '',
      prefix: '',
      disabled: false,
      concurrencyMode: 'independent',
      maxConcurrency: 30,
      apiKeyConcurrencyMode: 'independent',
      apiKeyMaxConcurrency: 4,
      models: [],
    },
    'kimi',
    getProtocolUrls
  );
  const sponsorClaude = buildSponsorClaudeConfig(
    {
      protocol: 'claude',
      apiKey: 'kimi-claude-key',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      proxyUrl: '',
      prefix: '',
      disabled: false,
      concurrencyMode: 'independent',
      maxConcurrency: 7,
      models: [],
    },
    getProtocolUrls
  );
  assert.equal(sponsorOpenAI.maxConcurrency, 30);
  assert.equal(sponsorOpenAI.concurrencyMode, 'independent');
  assert.equal(sponsorOpenAI.apiKeyEntries[0].maxConcurrency, 4);
  assert.equal(sponsorOpenAI.apiKeyEntries[0].concurrencyMode, 'independent');
  assert.equal(sponsorClaude.maxConcurrency, 7);

  const sponsorRaw = {
    openai: [{ index: 0, config: sponsorOpenAI }],
    claude: [{ index: 0, config: sponsorClaude }],
  };
  assert.equal(kimiToResource(sponsorRaw).maxConcurrency, 37);
  assert.equal(
    kimiToResource({
      ...sponsorRaw,
      claude: [{ index: 0, config: { ...sponsorClaude, maxConcurrency: 0 } }],
    }).maxConcurrency,
    0
  );

  const editor = {
    fileName: 'codex-user.json',
    fileInfoText: '',
    loading: false,
    saving: false,
    error: null,
    originalText: '',
    rawText: '',
    invalidContentPreview: '',
    json: { type: 'codex', 'max-concurrency': 3 },
    providerKey: 'codex',
    groups: [],
    prefix: '',
    proxyUrl: '',
    priority: '',
    concurrencyMode: 'independent',
    maxConcurrency: '8',
    maxConcurrencyError: null,
    fallback: false,
    disableCooling: false,
    websockets: false,
    websocketsTouched: false,
    usingApi: false,
    usingApiTouched: false,
    note: '',
    noteTouched: false,
    headersText: '',
    headersTouched: false,
    headersError: null,
  };
  assert.deepEqual(
    buildAuthFileFieldsPatch(editor, (key) => key),
    {
      concurrency_mode: 'independent',
      max_concurrency: 8,
    }
  );
  assert.deepEqual(
    buildAuthFileFieldsPatch({ ...editor, maxConcurrency: '0' }, (key) => key),
    { concurrency_mode: 'independent', max_concurrency: 0 }
  );
  assert.deepEqual(
    buildAuthFileFieldsPatch(
      { ...editor, concurrencyMode: 'inherit', maxConcurrency: '0' },
      (key) => key
    ),
    { concurrency_mode: 'inherit', max_concurrency: 0 }
  );
  assert.throws(
    () => buildAuthFileFieldsPatch({ ...editor, maxConcurrency: '-1' }, (key) => key),
    /AUTH_FILE_MAX_CONCURRENCY_INVALID/
  );
} finally {
  await server.close();
}
