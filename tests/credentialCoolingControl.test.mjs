import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  const workbenchModule = await server.ssrLoadModule(
    '/src/features/providers/useProviderWorkbench.ts'
  );
  const coolingPolicyModule = await server.ssrLoadModule('/src/utils/coolingPolicy.ts');

  assert.equal(editorModule.readAuthFileDisableCooling({ disable_cooling: true }), true);
  assert.equal(editorModule.readAuthFileDisableCooling({ disable_cooling: false }), false);
  assert.equal(editorModule.readAuthFileDisableCooling({ disable_cooling: null }), null);
  assert.equal(editorModule.readAuthFileDisableCooling({}), undefined);
  assert.equal(editorModule.readAuthFileDisableCooling({ 'disable-cooling': '1' }), true);
  assert.equal(
    editorModule.readAuthFileDisableCooling({
      disable_cooling: 'invalid',
      'disable-cooling': false,
    }),
    false
  );
  assert.equal(editorModule.authFileDisableCoolingMatchesPatch({}, null), true);
  assert.equal(
    editorModule.authFileDisableCoolingMatchesPatch({ disable_cooling: null }, null),
    true
  );
  assert.equal(
    editorModule.authFileDisableCoolingMatchesPatch({ disable_cooling: false }, false),
    true
  );
  assert.equal(
    editorModule.authFileDisableCoolingMatchesPatch({ disable_cooling: true }, true),
    true
  );
  assert.equal(editorModule.authFileDisableCoolingMatchesPatch({}, false), false);
  assert.equal(
    editorModule.authFileDisableCoolingMatchesPatch({ disable_cooling: true }, false),
    false
  );
  assert.equal(
    editorModule.authFileDisableCoolingMatchesPatch({ disable_cooling: false }, null),
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
    concurrencyMode: 'inherit',
    maxConcurrency: '0',
    maxConcurrencyError: null,
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
  assert.equal(disabledPreview.disable_cooling, false);
  assert.equal('disable-cooling' in disabledPreview, false);

  const inheritedEditor = { ...legacyEditor, disableCooling: undefined };
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(inheritedEditor, (key) => key),
    { disable_cooling: null }
  );
  const inheritedPreview = JSON.parse(
    editorModule.buildPrefixProxyUpdatedText(inheritedEditor, (key) => key)
  );
  assert.equal('disable_cooling' in inheritedPreview, false);
  assert.equal('disable-cooling' in inheritedPreview, false);

  const explicitFalseEditor = makeEditor({ type: 'codex', disable_cooling: false });
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(explicitFalseEditor, (key) => key),
    {}
  );
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(
      { ...explicitFalseEditor, disableCooling: undefined },
      (key) => key
    ),
    { disable_cooling: null }
  );
  const explicitNullEditor = makeEditor({ type: 'codex', disable_cooling: null });
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(explicitNullEditor, (key) => key),
    {}
  );
  const missingToFalseEditor = makeEditor({ type: 'codex' }, { disableCooling: false });
  assert.deepEqual(
    editorModule.buildAuthFileFieldsPatch(missingToFalseEditor, (key) => key),
    { disable_cooling: false }
  );
  assert.equal(
    JSON.parse(editorModule.buildPrefixProxyUpdatedText(missingToFalseEditor, (key) => key))
      .disable_cooling,
    false
  );

  assert.equal(coolingPolicyModule.coolingPolicySelectValue(undefined), 'inherit');
  assert.equal(coolingPolicyModule.coolingPolicySelectValue(null), 'inherit');
  assert.equal(coolingPolicyModule.coolingPolicySelectValue(false), 'enabled');
  assert.equal(coolingPolicyModule.coolingPolicySelectValue(true), 'disabled');
  assert.equal(coolingPolicyModule.coolingOverrideFromPolicySelect('inherit'), undefined);
  assert.equal(coolingPolicyModule.coolingOverrideFromPolicySelect('enabled'), false);
  assert.equal(coolingPolicyModule.coolingOverrideFromPolicySelect('disabled'), true);

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

  const normalizedFalse = transformersModule.normalizeProviderKeyConfig({
    'api-key': 'provider-false',
    'disable-cooling': false,
  });
  const normalizedNull = transformersModule.normalizeProviderKeyConfig({
    'api-key': 'provider-null',
    'disable-cooling': null,
  });
  const normalizedMissing = transformersModule.normalizeProviderKeyConfig({
    'api-key': 'provider-missing',
  });
  assert.equal(normalizedFalse.disableCooling, false);
  assert.equal(normalizedNull.disableCooling, null);
  assert.equal(Object.hasOwn(normalizedMissing, 'disableCooling'), false);

  const providerConfig = {
    apiKey: 'provider-key',
    disableCooling: true,
    runtimeStatus: normalizedProvider.runtimeStatus,
  };
  const serializedProvider = providersModule.serializeProviderKey(providerConfig);
  const serializedGemini = providersModule.serializeGeminiKey(providerConfig);
  const serializedXAI = providersModule.serializeXAIKey(providerConfig);
  const serializedVertex = providersModule.serializeVertexKey(providerConfig);
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
    serializedVertex,
    serializedOpenAI,
  ]) {
    assert.equal(serialized['disable-cooling'], true);
    assert.equal('runtime-status' in serialized, false);
  }
  assert.equal('runtime-status' in serializedOpenAI['api-key-entries'][0], false);

  const serializeProviderStates = (disableCooling) => [
    providersModule.serializeProviderKey({ apiKey: 'native', disableCooling }),
    providersModule.serializeGeminiKey({ apiKey: 'gemini', disableCooling }),
    providersModule.serializeXAIKey({ apiKey: 'xai', disableCooling }),
    providersModule.serializeVertexKey({ apiKey: 'vertex', disableCooling }),
    providersModule.serializeOpenAIProvider({
      name: 'openai',
      baseUrl: 'https://example.com',
      apiKeyEntries: [],
      disableCooling,
    }),
  ];
  for (const serialized of serializeProviderStates(false)) {
    assert.equal(serialized['disable-cooling'], false);
  }
  for (const serialized of serializeProviderStates(null)) {
    assert.equal(serialized['disable-cooling'], null);
  }
  for (const serialized of serializeProviderStates(undefined)) {
    assert.equal(Object.hasOwn(serialized, 'disable-cooling'), false);
  }

  for (const [merge, serialize, config] of [
    [
      providersModule.mergeClaudeProviderPayload,
      providersModule.serializeProviderKey,
      { apiKey: 'claude' },
    ],
    [
      providersModule.mergeVertexProviderPayload,
      providersModule.serializeVertexKey,
      { apiKey: 'vertex' },
    ],
    [
      providersModule.mergeOpenAIProviderPayload,
      providersModule.serializeOpenAIProvider,
      { name: 'openai', baseUrl: 'https://example.com', apiKeyEntries: [] },
    ],
  ]) {
    const raw = { 'disable-cooling': true, 'unknown-field': 'keep' };
    const explicitFalse = merge(raw, serialize({ ...config, disableCooling: false }));
    assert.equal(explicitFalse['disable-cooling'], false);
    assert.equal(explicitFalse['unknown-field'], 'keep');
    const inherited = merge(raw, serialize({ ...config, disableCooling: undefined }));
    assert.equal(Object.hasOwn(inherited, 'disable-cooling'), false);
    assert.equal(inherited['unknown-field'], 'keep');
    const explicitNull = merge(raw, serialize({ ...config, disableCooling: null }));
    assert.equal(explicitNull['disable-cooling'], null);
    assert.equal(explicitNull['unknown-field'], 'keep');
  }

  const baseFormInput = {
    apiKey: 'provider-key',
    name: '',
    groups: [],
    baseUrl: '',
    proxyUrl: '',
    prefix: '',
    disabled: false,
    disableCooling: false,
    fallback: false,
    concurrencyMode: 'inherit',
    maxConcurrency: 0,
    models: [],
    headers: [],
    excludedModelsText: '',
  };
  for (const brand of ['gemini', 'interactions', 'codex', 'xai', 'claude', 'vertex']) {
    assert.equal(
      workbenchModule.buildProviderKeyConfig(brand, baseFormInput).disableCooling,
      false
    );
    assert.equal(
      workbenchModule.buildProviderKeyConfig(brand, {
        ...baseFormInput,
        disableCooling: undefined,
      }).disableCooling,
      undefined
    );
    assert.equal(
      workbenchModule.buildProviderKeyConfig(brand, {
        ...baseFormInput,
        disableCooling: null,
      }).disableCooling,
      null
    );
  }
  assert.equal(workbenchModule.buildOpenAIConfig(baseFormInput).disableCooling, false);
  assert.equal(
    workbenchModule.buildOpenAIConfig({ ...baseFormInput, disableCooling: null }).disableCooling,
    null
  );
  const sponsorEntry = {
    protocol: 'openai',
    apiKey: 'sponsor-key',
    baseUrl: 'https://sponsor.example.com',
    proxyUrl: '',
    prefix: '',
    disabled: false,
    disableCooling: false,
    fallback: false,
    concurrencyMode: 'inherit',
    maxConcurrency: 0,
    apiKeyConcurrencyMode: 'inherit',
    apiKeyMaxConcurrency: 0,
    models: [],
  };
  const sponsorURLs = () => ({
    openai: 'https://sponsor.example.com/v1',
    anthropic: 'https://sponsor.example.com',
  });
  assert.equal(
    workbenchModule.buildSponsorOpenAIConfig(sponsorEntry, 'kimi', sponsorURLs).disableCooling,
    false
  );
  assert.equal(
    workbenchModule.buildSponsorClaudeConfig({ ...sponsorEntry, protocol: 'claude' }, sponsorURLs)
      .disableCooling,
    false
  );

  const baseFormSource = await readFile(
    new URL('../src/features/providers/sheets/forms/BaseProviderForm.tsx', import.meta.url),
    'utf8'
  );
  const sponsorFormSource = await readFile(
    new URL('../src/features/providers/sheets/forms/SponsorProviderForm.tsx', import.meta.url),
    'utf8'
  );
  assert.equal(baseFormSource.includes('cfg.disableCooling === true'), false);
  assert.equal(sponsorFormSource.includes('config.disableCooling === true'), false);
  assert.equal(baseFormSource.match(/toggleFields: \[[^\]]*'disableCooling'[^\]]*\]/g)?.length, 7);
} finally {
  await server.close();
}
