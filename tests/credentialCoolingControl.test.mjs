import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const editorModule = await server.ssrLoadModule(
    '/src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts'
  );
  const providersModule = await server.ssrLoadModule('/src/services/api/providers.ts');
  const transformersModule = await server.ssrLoadModule('/src/services/api/transformers.ts');
  const adaptersModule = await server.ssrLoadModule('/src/features/providers/adapters.ts');

  assert.equal(editorModule.readAuthFileDisableCooling({ disable_cooling: true }), true);
  assert.equal(editorModule.readAuthFileDisableCooling({ 'disable-cooling': '1' }), true);
  assert.equal(
    editorModule.readAuthFileDisableCooling({
      disable_cooling: 'invalid',
      'disable-cooling': false,
    }),
    false
  );

  const makeEditor = (json, overrides = {}) => ({
    fileName: 'credential.json',
    fileInfoText: '',
    loading: false,
    saving: false,
    error: null,
    originalText: JSON.stringify(json),
    rawText: JSON.stringify(json),
    invalidContentPreview: '',
    json,
    providerKey: 'codex',
    groups: [],
    prefix: '',
    proxyUrl: '',
    priority: '',
    fallback: false,
    disableCooling: editorModule.readAuthFileDisableCooling(json),
    websockets: false,
    websocketsTouched: false,
    usingApi: false,
    usingApiTouched: false,
    note: '',
    noteTouched: false,
    headersText: '',
    headersTouched: false,
    headersError: null,
    ...overrides,
  });

  const legacyEditor = makeEditor({ type: 'codex', 'disable-cooling': true });
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(legacyEditor, (key) => key),
    {}
  );

  const disabledEditor = { ...legacyEditor, disableCooling: false };
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(disabledEditor, (key) => key),
    {
      disable_cooling: false,
    }
  );
  const disabledPreview = JSON.parse(
    editorModule.buildPrefixProxyUpdatedText(disabledEditor, (key) => key)
  );
  assert.equal('disable_cooling' in disabledPreview, false);
  assert.equal('disable-cooling' in disabledPreview, false);

  const fallbackEditor = makeEditor({ type: 'codex', fallback: false }, { fallback: true });
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(fallbackEditor, (key) => key),
    {
      fallback: true,
    }
  );

  const runtimeStatus = {
    connectivity: 'reachable',
    scheduling: 'cooling',
    ready: false,
    'next-retry-after': '2026-08-01T12:00:00Z',
  };
  const normalizedProvider = transformersModule.normalizeProviderKeyConfig({
    'api-key': 'provider-key',
    'disable-cooling': true,
    'runtime-status': runtimeStatus,
  });
  assert.equal(normalizedProvider.disableCooling, true);
  assert.deepEqual(normalizedProvider.runtimeStatus, {
    connectivity: 'reachable',
    scheduling: 'cooling',
    ready: false,
    nextRetryAfter: '2026-08-01T12:00:00Z',
  });
  assert.equal(
    adaptersModule.codexToResource(normalizedProvider, 0).runtimeStatus.scheduling,
    'cooling'
  );

  const aggregatedReady = adaptersModule.aggregateProviderRuntimeStatuses([
    normalizedProvider.runtimeStatus,
    { connectivity: 'unknown', scheduling: 'ready', ready: true },
  ]);
  assert.deepEqual(aggregatedReady, {
    connectivity: 'reachable',
    scheduling: 'ready',
    ready: true,
  });

  const providerConfig = {
    apiKey: 'provider-key',
    disableCooling: true,
    runtimeStatus: normalizedProvider.runtimeStatus,
  };
  const serializedProvider = providersModule.serializeProviderKey(providerConfig);
  const serializedGemini = providersModule.serializeGeminiKey(providerConfig);
  const serializedXAI = providersModule.serializeXAIKey(providerConfig);
  const serializedOpenAI = providersModule.serializeOpenAIProvider({
    name: 'provider',
    baseUrl: 'https://example.com',
    apiKeyEntries: [providerConfig],
    disableCooling: true,
    runtimeStatus: normalizedProvider.runtimeStatus,
  });
  for (const serialized of [
    serializedProvider,
    serializedGemini,
    serializedXAI,
    serializedOpenAI,
  ]) {
    assert.equal(serialized['disable-cooling'], true);
    assert.equal('runtime-status' in serialized, false);
  }
  assert.equal('runtime-status' in serializedOpenAI['api-key-entries'][0], false);
} finally {
  await server.close();
}
