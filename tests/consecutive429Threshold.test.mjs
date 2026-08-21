import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { initializeI18n, changeI18nLanguage } = await server.ssrLoadModule('/src/i18n/index.ts');
  await initializeI18n();
  await changeI18nLanguage('en');

  const thresholdModule = await server.ssrLoadModule('/src/utils/consecutive429Threshold.ts');
  const workbenchModule = await server.ssrLoadModule(
    '/src/features/providers/useProviderWorkbench.ts'
  );
  const providersModule = await server.ssrLoadModule('/src/services/api/providers.ts');
  const transformersModule = await server.ssrLoadModule('/src/services/api/transformers.ts');
  const { apiClient } = await server.ssrLoadModule('/src/services/api/client.ts');
  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );
  const { SponsorProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/SponsorProviderForm.tsx'
  );
  const { getSponsorProviderDefinition } = await server.ssrLoadModule(
    '/src/features/providers/sponsorDefinitions.ts'
  );

  assert.equal(thresholdModule.normalizeConsecutive429Threshold(undefined), 3);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(1), true);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(100), true);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(0), false);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(101), false);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(1.5), false);

  const baseInput = {
    apiKey: '',
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
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
    apiKeyEntries: [
      {
        apiKey: 'secret',
        proxyUrl: '',
        concurrencyMode: 'inherit',
        maxConcurrency: 0,
      },
    ],
  };

  const defaultConfig = workbenchModule.buildOpenAIConfig(baseInput);
  assert.equal(defaultConfig.consecutive429Threshold, 3);
  const defaultPayload = providersModule.serializeOpenAIProvider(defaultConfig);
  assert.equal('consecutive-429-threshold' in defaultPayload, false);
  assert.equal(
    transformersModule.normalizeOpenAIProvider(defaultPayload).consecutive429Threshold,
    3
  );

  for (const threshold of [1, 7, 100]) {
    const config = workbenchModule.buildOpenAIConfig({
      ...baseInput,
      disableCooling: true,
      consecutive429Threshold: threshold,
    });
    assert.equal(config.consecutive429Threshold, threshold);
    assert.equal(config.disableCooling, true);
    const payload = providersModule.serializeOpenAIProvider(config);
    assert.equal(payload['disable-cooling'], true);
    assert.equal(payload['consecutive-429-threshold'], threshold);
    assert.equal(
      transformersModule.normalizeOpenAIProvider(payload).consecutive429Threshold,
      threshold
    );
  }

  const mergedDefault = providersModule.mergeOpenAIProviderPayload(
    {
      name: 'gateway',
      'base-url': 'https://gateway.example/v1',
      'consecutive-429-threshold': 9,
      'backend-only': { preserved: true },
    },
    defaultPayload
  );
  assert.equal('consecutive-429-threshold' in mergedDefault, false);
  assert.deepEqual(mergedDefault['backend-only'], { preserved: true });

  const invalidConfig = workbenchModule.buildOpenAIConfig({
    ...baseInput,
    consecutive429Threshold: 101,
  });
  assert.equal(invalidConfig.consecutive429Threshold, 3);

  const providerInput = {
    ...baseInput,
    apiKey: 'provider-secret',
    apiKeyEntries: undefined,
  };
  const providerCases = [
    {
      brand: 'gemini',
      serialize: providersModule.serializeGeminiKey,
      normalize: transformersModule.normalizeGeminiKeyConfig,
    },
    {
      brand: 'interactions',
      serialize: providersModule.serializeInteractionsKey,
      normalize: transformersModule.normalizeInteractionsKeyConfig,
    },
    {
      brand: 'codex',
      serialize: providersModule.serializeProviderKey,
      normalize: transformersModule.normalizeProviderKeyConfig,
    },
    {
      brand: 'xai',
      serialize: providersModule.serializeXAIKey,
      normalize: transformersModule.normalizeProviderKeyConfig,
    },
    {
      brand: 'claude',
      serialize: providersModule.serializeProviderKey,
      normalize: transformersModule.normalizeProviderKeyConfig,
    },
    {
      brand: 'vertex',
      serialize: providersModule.serializeVertexKey,
      normalize: transformersModule.normalizeProviderKeyConfig,
    },
  ];

  for (const providerCase of providerCases) {
    const defaultProviderConfig = workbenchModule.buildProviderKeyConfig(providerCase.brand, {
      ...providerInput,
      consecutive429Threshold: 3,
    });
    assert.equal(defaultProviderConfig.consecutive429Threshold, 3);
    assert.equal(
      'consecutive-429-threshold' in providerCase.serialize(defaultProviderConfig),
      false,
      `${providerCase.brand} should omit the default threshold`
    );

    for (const threshold of [1, 7, 100]) {
      const config = workbenchModule.buildProviderKeyConfig(providerCase.brand, {
        ...providerInput,
        consecutive429Threshold: threshold,
      });
      const payload = providerCase.serialize(config);
      assert.equal(payload['consecutive-429-threshold'], threshold, providerCase.brand);
      assert.equal(
        providerCase.normalize(payload).consecutive429Threshold,
        threshold,
        `${providerCase.brand} should round-trip its threshold`
      );
    }
  }

  const mergedClaudeDefault = providersModule.mergeClaudeProviderPayload(
    {
      'api-key': 'provider-secret',
      'consecutive-429-threshold': 9,
      'backend-only': { preserved: true },
    },
    providersModule.serializeProviderKey({
      apiKey: 'provider-secret',
      consecutive429Threshold: 3,
    })
  );
  assert.equal('consecutive-429-threshold' in mergedClaudeDefault, false);
  assert.deepEqual(mergedClaudeDefault['backend-only'], { preserved: true });

  const originalGet = apiClient.get;
  const originalPut = apiClient.put;
  let vertexSavedPayload;
  apiClient.get = async (url) => {
    assert.equal(url, '/config');
    return {
      'vertex-api-key': [
        {
          'api-key': 'vertex-secret',
          'base-url': 'https://vertex.example',
          'consecutive-429-threshold': 9,
          'backend-only': { preserved: true },
        },
      ],
    };
  };
  apiClient.put = async (url, payload) => {
    assert.equal(url, '/vertex-api-key');
    vertexSavedPayload = payload;
    return {};
  };
  try {
    await providersModule.providersApi.saveVertexConfigs([
      {
        apiKey: 'vertex-secret',
        baseUrl: 'https://vertex.example',
        consecutive429Threshold: 3,
      },
    ]);
  } finally {
    apiClient.get = originalGet;
    apiClient.put = originalPut;
  }
  assert.equal('consecutive-429-threshold' in vertexSavedPayload[0], false);
  assert.deepEqual(vertexSavedPayload[0]['backend-only'], { preserved: true });

  const kimiDefinition = getSponsorProviderDefinition('kimi');
  const sponsorInput = {
    apiKey: 'kimi-secret',
    baseUrl: kimiDefinition.baseUrlOptions[0].baseUrl,
    proxyUrl: '',
    prefix: '',
    disabled: false,
    disableCooling: true,
    fallback: false,
    concurrencyMode: 'inherit',
    maxConcurrency: 0,
    models: [],
  };
  const kimiOpenAI = workbenchModule.buildSponsorOpenAIConfig(
    { ...sponsorInput, protocol: 'openai', consecutive429Threshold: 8 },
    kimiDefinition.providerName,
    kimiDefinition.getProtocolUrls
  );
  const kimiClaude = workbenchModule.buildSponsorClaudeConfig(
    { ...sponsorInput, protocol: 'claude', consecutive429Threshold: 11 },
    kimiDefinition.getProtocolUrls
  );
  assert.equal(providersModule.serializeOpenAIProvider(kimiOpenAI)['consecutive-429-threshold'], 8);
  assert.equal(providersModule.serializeProviderKey(kimiClaude)['consecutive-429-threshold'], 11);
  assert.equal(kimiOpenAI.disableCooling, true);
  assert.equal(kimiClaude.disableCooling, true);

  const renderWithTooltips = (element) =>
    renderToStaticMarkup(createElement(TooltipProvider, { delayDuration: 0 }, element));
  for (const brand of [
    ...providerCases.map((providerCase) => providerCase.brand),
    'openaiCompatibility',
  ]) {
    const markup = renderWithTooltips(
      createElement(BaseProviderForm, {
        brand,
        resource: null,
        credentialGroupOptions: [],
        mode: 'create',
        mutating: false,
        formId: `${brand}-threshold`,
        onSubmit: async () => {},
      })
    );
    assert.equal(markup.includes('Consecutive 429 threshold'), true, brand);
    assert.match(markup, /min="1" max="100" step="1"/);
  }

  for (const providerCase of providerCases) {
    const raw = providerCase.normalize({
      'api-key': `${providerCase.brand}-secret`,
      'base-url': 'https://provider.example',
      'consecutive-429-threshold': 7,
    });
    const markup = renderWithTooltips(
      createElement(BaseProviderForm, {
        brand: providerCase.brand,
        resource: { id: `${providerCase.brand}-resource`, brand: providerCase.brand, raw },
        credentialGroupOptions: [],
        mode: 'edit',
        mutating: false,
        formId: `${providerCase.brand}-threshold-edit`,
        onSubmit: async () => {},
      })
    );
    assert.match(markup, /consecutive429Threshold"[^>]*value="7"/, providerCase.brand);
  }

  const openAIEditMarkup = renderWithTooltips(
    createElement(BaseProviderForm, {
      brand: 'openaiCompatibility',
      resource: {
        id: 'openai-threshold-resource',
        brand: 'openaiCompatibility',
        raw: transformersModule.normalizeOpenAIProvider({
          name: 'threshold-gateway',
          'base-url': 'https://gateway.example/v1',
          'api-key-entries': [{ 'api-key': 'secret' }],
          'consecutive-429-threshold': 7,
        }),
      },
      credentialGroupOptions: [],
      mode: 'edit',
      mutating: false,
      formId: 'openai-threshold-edit',
      onSubmit: async () => {},
    })
  );
  assert.match(openAIEditMarkup, /consecutive429Threshold"[^>]*value="7"/);

  const kimiMarkup = renderWithTooltips(
    createElement(SponsorProviderForm, {
      brand: 'kimi',
      resource: null,
      mode: 'create',
      mutating: false,
      formId: 'kimi-threshold',
      onSubmit: async () => {},
    })
  );
  assert.equal(kimiMarkup.includes('Consecutive 429 threshold'), true);
  assert.match(kimiMarkup, /min="1" max="100" step="1"/);

  const formSource = await readFile(
    new URL('../src/features/providers/sheets/forms/BaseProviderForm.tsx', import.meta.url),
    'utf8'
  );
  assert.match(formSource, /disabled=\{mutating \|\| form\.disableCooling === true\}/);
  assert.match(formSource, /isValidConsecutive429Threshold\(form\.consecutive429Threshold\)/);
  const sponsorFormSource = await readFile(
    new URL('../src/features/providers/sheets/forms/SponsorProviderForm.tsx', import.meta.url),
    'utf8'
  );
  assert.match(sponsorFormSource, /disabled=\{mutating \|\| entry\.disableCooling === true\}/);
  assert.match(
    sponsorFormSource,
    /isValidConsecutive429Threshold\(entry\.consecutive429Threshold\)/
  );

  const resourceDetailSource = await readFile(
    new URL('../src/features/providers/sheets/ResourceDetailView.tsx', import.meta.url),
    'utf8'
  );
  assert.equal((resourceDetailSource.match(/<Consecutive429Status value=/g) ?? []).length, 3);
} finally {
  await server.close();
}

console.log('consecutive 429 threshold tests passed');
