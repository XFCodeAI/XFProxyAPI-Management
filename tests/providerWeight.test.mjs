import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const baseForm = (weight) => ({
  apiKey: 'provider-key',
  name: 'provider',
  groups: [],
  baseUrl: 'https://provider.example/v1',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  fallback: false,
  priority: undefined,
  weight,
  concurrencyMode: 'inherit',
  maxConcurrency: 0,
  models: [],
  headers: [],
  excludedModelsText: '',
});

try {
  const { initializeI18n, changeI18nLanguage } = await server.ssrLoadModule('/src/i18n/index.ts');
  await initializeI18n();
  await changeI18nLanguage('en');

  const {
    DEFAULT_CREDENTIAL_WEIGHT,
    MAX_CREDENTIAL_WEIGHT,
    getCredentialWeightError,
    normalizeCredentialWeight,
    resolveEffectiveCredentialWeight,
  } = await server.ssrLoadModule('/src/utils/credentialWeight.ts');
  const {
    mergeClaudeProviderPayload,
    mergeOpenAIProviderPayload,
    providersApi,
    serializeGeminiKey,
    serializeOpenAIProvider,
    serializeProviderKey,
    serializeVertexKey,
    serializeXAIKey,
  } = await server.ssrLoadModule('/src/services/api/providers.ts');
  const { normalizeGeminiKeyConfig, normalizeOpenAIProvider, normalizeProviderKeyConfig } =
    await server.ssrLoadModule('/src/services/api/transformers.ts');
  const { apiClient } = await server.ssrLoadModule('/src/services/api/client.ts');
  const {
    buildOpenAIConfig,
    buildProviderKeyConfig,
    buildSponsorClaudeConfig,
    buildSponsorOpenAIConfig,
  } = await server.ssrLoadModule('/src/features/providers/useProviderWorkbench.ts');
  const { buildAuthFileFieldsPatch, buildPrefixProxyUpdatedText } = await server.ssrLoadModule(
    '/src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts'
  );
  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { CredentialWeightInput } = await server.ssrLoadModule(
    '/src/components/providers/CredentialWeightInput.tsx'
  );
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );
  const { SponsorProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/SponsorProviderForm.tsx'
  );
  const { ResourceDetailView } = await server.ssrLoadModule(
    '/src/features/providers/sheets/ResourceDetailView.tsx'
  );
  const { ProviderResourceTable } = await server.ssrLoadModule(
    '/src/features/providers/components/ProviderResourceTable.tsx'
  );
  const { AuthFileCard } = await server.ssrLoadModule(
    '/src/features/authFiles/components/AuthFileCard.tsx'
  );
  const {
    codexToResource,
    kimiToResource,
    openaiToResource,
  } = await server.ssrLoadModule('/src/features/providers/adapters.ts');

  const renderWithTooltips = (element) =>
    renderToStaticMarkup(createElement(TooltipProvider, { delayDuration: 0 }, element));

  assert.equal(DEFAULT_CREDENTIAL_WEIGHT, 1);
  assert.equal(MAX_CREDENTIAL_WEIGHT, 1_000_000);
  assert.equal(resolveEffectiveCredentialWeight(undefined), 1);
  assert.equal(resolveEffectiveCredentialWeight(null), 1);
  assert.equal(resolveEffectiveCredentialWeight(0), 0);
  assert.equal(resolveEffectiveCredentialWeight(-1), 0);
  assert.equal(normalizeCredentialWeight('0'), 0);
  assert.equal(normalizeCredentialWeight('-1'), -1);
  assert.equal(normalizeCredentialWeight('1000000'), 1_000_000);
  assert.equal(getCredentialWeightError('-1'), undefined);
  assert.equal(getCredentialWeightError('1.5'), 'integer');
  assert.equal(getCredentialWeightError('1e2'), 'integer');
  assert.equal(getCredentialWeightError('1000001'), 'maximum');
  assert.equal(getCredentialWeightError(Number.MAX_SAFE_INTEGER + 1), 'integer');
  assert.equal(getCredentialWeightError(''), undefined);

  const emptyInputMarkup = renderWithTooltips(
    createElement(CredentialWeightInput, { value: undefined, onChange: () => {} })
  );
  assert.equal(emptyInputMarkup.includes('Routing weight'), true);
  assert.equal(emptyInputMarkup.includes('value=""'), true);
  assert.equal(emptyInputMarkup.includes('default weight 1'), true);
  const zeroInputMarkup = renderWithTooltips(
    createElement(CredentialWeightInput, { value: 0, onChange: () => {} })
  );
  assert.equal(zeroInputMarkup.includes('value="0"'), true);

  for (const brand of ['gemini', 'codex', 'xai', 'claude', 'vertex']) {
    const formMarkup = renderWithTooltips(
      createElement(BaseProviderForm, {
        brand,
        resource: null,
        credentialGroupOptions: [],
        mode: 'create',
        mutating: false,
        formId: `${brand}-weight-form`,
        onSubmit: async () => {},
      })
    );
    assert.equal(
      (formMarkup.match(/Routing weight/g) ?? []).length,
      1,
      `${brand} create form must render one credential weight input`
    );
  }

  const openAIFormMarkup = renderWithTooltips(
    createElement(BaseProviderForm, {
      brand: 'openaiCompatibility',
      resource: null,
      credentialGroupOptions: [],
      mode: 'create',
      mutating: false,
      formId: 'openai-weight-form',
      onSubmit: async () => {},
    })
  );
  assert.equal((openAIFormMarkup.match(/Routing weight/g) ?? []).length, 1);

  const kimiFormMarkup = renderWithTooltips(
    createElement(SponsorProviderForm, {
      brand: 'kimi',
      resource: null,
      mode: 'create',
      mutating: false,
      formId: 'kimi-weight-form',
      onSubmit: async () => {},
    })
  );
  assert.equal((kimiFormMarkup.match(/Routing weight/g) ?? []).length, 1);

  const nativeSerializers = {
    gemini: (config) => serializeGeminiKey(config),
    codex: (config) => serializeProviderKey(config),
    xai: (config) => serializeXAIKey(config),
    claude: (config) => serializeProviderKey(config),
    vertex: (config) => serializeVertexKey(config),
  };

  for (const [brand, serialize] of Object.entries(nativeSerializers)) {
    const zeroConfig = buildProviderKeyConfig(brand, baseForm('0'));
    const zeroPayload = serialize(zeroConfig);
    assert.equal(zeroConfig.weight, 0, `${brand} form must preserve zero`);
    assert.equal(zeroPayload.weight, 0, `${brand} payload must preserve zero`);

    const inheritedConfig = buildProviderKeyConfig(brand, baseForm(undefined), {
      apiKey: 'provider-key',
      weight: 7,
    });
    const inheritedPayload = serialize(inheritedConfig);
    assert.equal(inheritedConfig.weight, undefined, `${brand} blank must clear the value`);
    assert.equal('weight' in inheritedPayload, false, `${brand} blank payload must omit weight`);
  }

  assert.equal(normalizeGeminiKeyConfig({ 'api-key': 'gemini', weight: 0 }).weight, 0);
  assert.equal(normalizeProviderKeyConfig({ 'api-key': 'native', weight: 0 }).weight, 0);
  assert.equal(normalizeProviderKeyConfig({ 'api-key': 'native', weight: -1 }).weight, -1);

  const openAIForm = {
    ...baseForm(undefined),
    name: 'gateway',
    apiKey: '',
    apiKeyEntries: [
      {
        apiKey: 'openai-key',
        existingApiKey: '',
        weight: '0',
        proxyUrl: '',
        groups: [],
        concurrencyMode: 'inherit',
        maxConcurrency: 0,
      },
    ],
  };
  const openAIConfig = buildOpenAIConfig(openAIForm);
  const openAIPayload = serializeOpenAIProvider(openAIConfig);
  assert.equal(openAIConfig.apiKeyEntries[0].weight, 0);
  assert.equal(openAIPayload['api-key-entries'][0].weight, 0);
  assert.equal(normalizeOpenAIProvider(openAIPayload).apiKeyEntries[0].weight, 0);

  const clearedOpenAI = buildOpenAIConfig(
    {
      ...openAIForm,
      apiKeyEntries: [{ ...openAIForm.apiKeyEntries[0], weight: undefined }],
    },
    { ...openAIConfig, apiKeyEntries: [{ apiKey: 'openai-key', weight: 7 }] }
  );
  const clearedOpenAIPayload = serializeOpenAIProvider(clearedOpenAI);
  assert.equal('weight' in clearedOpenAIPayload['api-key-entries'][0], false);
  assert.equal(
    'weight' in
      mergeOpenAIProviderPayload(
        { 'api-key-entries': [{ 'api-key': 'openai-key', weight: 7 }] },
        clearedOpenAIPayload
      )['api-key-entries'][0],
    false
  );

  const getProtocolUrls = () => ({
    anthropic: 'https://api.moonshot.cn/anthropic',
    openai: 'https://api.moonshot.cn/v1',
  });
  const sponsorBase = {
    protocol: 'openai',
    apiKey: 'kimi-key',
    baseUrl: 'https://api.moonshot.cn/v1',
    proxyUrl: '',
    prefix: '',
    disabled: false,
    weight: '0',
    concurrencyMode: 'inherit',
    maxConcurrency: 0,
    apiKeyConcurrencyMode: 'inherit',
    apiKeyMaxConcurrency: 0,
    models: [],
  };
  const kimiOpenAI = buildSponsorOpenAIConfig(sponsorBase, 'kimi', getProtocolUrls);
  const kimiClaude = buildSponsorClaudeConfig(
    { ...sponsorBase, protocol: 'claude' },
    getProtocolUrls
  );
  assert.equal(kimiOpenAI.apiKeyEntries[0].weight, 0);
  assert.equal(kimiClaude.weight, 0);

  const clearedNativePayload = serializeProviderKey(
    buildProviderKeyConfig('claude', baseForm(undefined), {
      apiKey: 'provider-key',
      weight: 7,
    })
  );
  assert.equal(
    'weight' in
      mergeClaudeProviderPayload({ 'api-key': 'provider-key', weight: 7 }, clearedNativePayload),
    false
  );

  const originalClientMethods = {
    get: apiClient.get,
    put: apiClient.put,
    patch: apiClient.patch,
  };
  const apiCalls = [];
  const latestBySection = new Map();
  apiClient.get = async (url) => {
    apiCalls.push({ method: 'GET', url });
    if (url === '/config') {
      return Object.fromEntries(latestBySection.entries());
    }
    const section = url.slice(1);
    return { [section]: structuredClone(latestBySection.get(section) ?? []) };
  };
  apiClient.put = async (url, data) => {
    apiCalls.push({ method: 'PUT', url, data });
    return {};
  };
  apiClient.patch = async (url, data) => {
    apiCalls.push({ method: 'PATCH', url, data });
    return {};
  };

  try {
    const nativeApiCases = [
      {
        section: 'gemini-api-key',
        create: providersApi.createGeminiKey,
        update: providersApi.updateGeminiKey,
      },
      {
        section: 'codex-api-key',
        create: providersApi.createCodexConfig,
        update: providersApi.updateCodexConfig,
      },
      {
        section: 'xai-api-key',
        create: providersApi.createXAIConfig,
        update: providersApi.updateXAIConfig,
      },
      {
        section: 'claude-api-key',
        create: providersApi.createClaudeConfig,
        update: providersApi.updateClaudeConfig,
      },
      {
        section: 'vertex-api-key',
        create: providersApi.createVertexConfig,
        update: providersApi.updateVertexConfig,
      },
    ];

    for (const testCase of nativeApiCases) {
      apiCalls.length = 0;
      latestBySection.clear();
      latestBySection.set(testCase.section, []);
      await testCase.create({ apiKey: 'provider-key', weight: 0 });
      const createCall = apiCalls.find((call) => call.method === 'PUT');
      assert.ok(createCall, `${testCase.section} create must write a payload`);
      assert.equal(createCall.data.at(-1).weight, 0, `${testCase.section} create must preserve zero`);

      apiCalls.length = 0;
      latestBySection.set(testCase.section, [
        { 'api-key': 'provider-key', weight: 7, 'future-field': 'keep' },
      ]);
      await testCase.update('provider-key', undefined, { apiKey: 'provider-key' });
      const updateCall = apiCalls.find(
        (call) => call.method === (testCase.section === 'xai-api-key' ? 'PATCH' : 'PUT')
      );
      assert.ok(updateCall, `${testCase.section} update must write a payload`);
      const updatedRecord =
        testCase.section === 'xai-api-key' ? updateCall.data.value : updateCall.data[0];
      assert.equal(
        'weight' in updatedRecord,
        false,
        `${testCase.section} blank update must clear weight`
      );
      assert.equal(updatedRecord['future-field'], 'keep');
    }

    apiCalls.length = 0;
    latestBySection.clear();
    latestBySection.set('openai-compatibility', []);
    await providersApi.createOpenAIProvider(openAIConfig);
    const openAICreate = apiCalls.find((call) => call.method === 'PUT');
    assert.equal(openAICreate.data[0]['api-key-entries'][0].weight, 0);

    apiCalls.length = 0;
    latestBySection.set('openai-compatibility', [
      {
        name: 'gateway',
        'base-url': 'https://provider.example/v1',
        'api-key-entries': [
          { 'api-key': 'openai-key', weight: 7, 'future-entry-field': 'keep' },
        ],
      },
    ]);
    await providersApi.updateOpenAIProvider('gateway', 0, clearedOpenAI);
    const openAIUpdate = apiCalls.find((call) => call.method === 'PUT');
    const updatedEntry = openAIUpdate.data[0]['api-key-entries'][0];
    assert.equal('weight' in updatedEntry, false);
    assert.equal(updatedEntry['future-entry-field'], 'keep');
  } finally {
    apiClient.get = originalClientMethods.get;
    apiClient.put = originalClientMethods.put;
    apiClient.patch = originalClientMethods.patch;
  }

  const authEditor = {
    fileName: 'weighted.json',
    credentialIdentity: { name: 'weighted.json' },
    fileInfoText: '',
    loading: false,
    saving: false,
    error: null,
    originalText: '',
    rawText: '',
    invalidContentPreview: '',
    json: { type: 'codex', weight: 7 },
    providerKey: 'codex',
    groups: [],
    prefix: '',
    proxyUrl: '',
    priority: '',
    weight: '',
    weightTouched: true,
    weightError: null,
    concurrencyMode: 'inherit',
    maxConcurrency: '0',
    maxConcurrencyError: null,
    fallback: false,
    disableCooling: undefined,
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
    buildAuthFileFieldsPatch(authEditor, (key) => key),
    { weight: null }
  );
  assert.deepEqual(
    buildAuthFileFieldsPatch({ ...authEditor, weight: '0' }, (key) => key),
    { weight: 0 }
  );
  assert.deepEqual(
    buildAuthFileFieldsPatch({ ...authEditor, weight: '-3' }, (key) => key),
    { weight: 0 }
  );
  assert.equal(JSON.parse(buildPrefixProxyUpdatedText(authEditor, (key) => key)).weight, undefined);
  assert.throws(
    () => buildAuthFileFieldsPatch({ ...authEditor, weight: '1.5' }, (key) => key),
    /AUTH_FILE_WEIGHT_INVALID/
  );

  const defaultResource = codexToResource({ apiKey: 'codex-default' }, 0);
  const zeroResource = codexToResource({ apiKey: 'codex-zero', weight: 0 }, 1);
  const negativeResource = codexToResource({ apiKey: 'codex-negative', weight: -2 }, 2);
  const defaultDetailMarkup = renderWithTooltips(
    createElement(ResourceDetailView, { resource: defaultResource })
  );
  const zeroDetailMarkup = renderWithTooltips(
    createElement(ResourceDetailView, { resource: zeroResource })
  );
  assert.equal(defaultDetailMarkup.includes('Routing weight</dt><dd'), true);
  assert.equal(defaultDetailMarkup.includes('1 (default)'), true);
  assert.equal(zeroDetailMarkup.includes('0 (routing disabled)'), true);
  const negativeDetailMarkup = renderWithTooltips(
    createElement(ResourceDetailView, { resource: negativeResource })
  );
  assert.equal(negativeDetailMarkup.includes('0 (routing disabled)'), true);

  const providerTableMarkup = renderWithTooltips(
    createElement(ProviderResourceTable, {
      resources: [defaultResource, zeroResource, negativeResource],
      onView: () => {},
      onViewFailures: () => {},
      onEdit: () => {},
      onDelete: () => {},
    })
  );
  assert.equal(providerTableMarkup.includes('Weight 1'), true);
  assert.equal(
    (providerTableMarkup.match(/Weight 0 \(routing disabled\)/g) ?? []).length,
    2
  );

  const openAIResource = openaiToResource(
    {
      name: 'weighted-gateway',
      baseUrl: 'https://gateway.example/v1',
      apiKeyEntries: [
        { name: 'zero', apiKey: 'openai-zero', weight: 0 },
        { name: 'default', apiKey: 'openai-default' },
      ],
    },
    0
  );
  const openAIDetailMarkup = renderWithTooltips(
    createElement(ResourceDetailView, { resource: openAIResource })
  );
  assert.equal(openAIDetailMarkup.includes('Configured per API key'), true);
  assert.match(openAIDetailMarkup, /API key entries(?:<!-- -->)?: (?:<!-- -->)?2/);
  assert.equal(openAIDetailMarkup.includes('0 (routing disabled)'), true);
  assert.equal(openAIDetailMarkup.includes('1 (default)'), true);

  const kimiResource = kimiToResource({
    openai: [
      {
        index: 0,
        config: {
          name: 'kimi',
          baseUrl: 'https://api.moonshot.cn/v1',
          apiKeyEntries: [{ name: 'openai-zero', apiKey: 'kimi-openai', weight: 0 }],
        },
      },
    ],
    claude: [
      {
        index: 0,
        config: {
          name: 'claude-default',
          apiKey: 'kimi-claude',
          baseUrl: 'https://api.moonshot.cn/anthropic',
        },
      },
    ],
  });
  assert.ok(kimiResource);
  const kimiDetailMarkup = renderWithTooltips(
    createElement(ResourceDetailView, { resource: kimiResource })
  );
  assert.equal(kimiDetailMarkup.includes('Configured per API key'), true);
  assert.match(kimiDetailMarkup, /API key entries(?:<!-- -->)?: (?:<!-- -->)?2/);
  assert.equal(kimiDetailMarkup.includes('0 (routing disabled)'), true);
  assert.equal(kimiDetailMarkup.includes('1 (default)'), true);

  const authCardProps = (weight) => ({
    file: { name: `codex-${weight ?? 'default'}.json`, type: 'codex', weight },
    compact: false,
    selected: false,
    resolvedTheme: 'light',
    disableControls: false,
    deleting: null,
    statusUpdating: {},
    manualRefreshing: {},
    quotaFilterType: null,
    statusBarCache: new Map(),
    onShowModels: () => {},
    onDownload: () => {},
    onManualRefresh: () => {},
    onOpenPrefixProxyEditor: () => {},
    onDelete: () => {},
    onToggleStatus: () => {},
    onToggleSelect: () => {},
  });
  const defaultAuthCardMarkup = renderWithTooltips(
    createElement(AuthFileCard, authCardProps(undefined))
  );
  const zeroAuthCardMarkup = renderWithTooltips(createElement(AuthFileCard, authCardProps(0)));
  assert.equal(defaultAuthCardMarkup.includes('Routing weight'), true);
  assert.equal(defaultAuthCardMarkup.includes('>1</span>'), true);
  assert.equal(zeroAuthCardMarkup.includes('0 (routing disabled)'), true);
} finally {
  await server.close();
}

console.log('provider weight tests passed');
