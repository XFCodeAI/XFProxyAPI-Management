import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { initializeI18n } = await server.ssrLoadModule('/src/i18n/index.ts');
  await initializeI18n();
  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { apiClient } = await server.ssrLoadModule('/src/services/api/client.ts');
  const { providersApi } = await server.ssrLoadModule('/src/services/api/providers.ts');
  const { normalizeConfigResponse } = await server.ssrLoadModule(
    '/src/services/api/transformers.ts'
  );
  const { xaiToResource } = await server.ssrLoadModule('/src/features/providers/adapters.ts');
  const { PROVIDER_DESCRIPTORS, PROVIDER_BRAND_ORDER } = await server.ssrLoadModule(
    '/src/features/providers/descriptors.ts'
  );
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );

  const rawConfig = {
    'xai-api-key': [
      {
        name: ' primary ',
        'api-key': ' xai-key ',
        groups: [' paid ', 'paid'],
        fallback: true,
        priority: '7',
        prefix: ' grok ',
        'base-url': 'https://api.x.ai/v1',
        websockets: true,
        'proxy-url': 'http://proxy.example',
        models: [{ name: 'grok-4', alias: 'grok-latest' }],
        headers: { 'X-Test': 'value' },
        'excluded-models': ['grok-old'],
        'disable-cooling': true,
        'auth-index': ' auth-live ',
        'future-field': { keep: true },
      },
    ],
  };
  const normalized = normalizeConfigResponse(rawConfig);
  const xaiConfig = normalized.xaiApiKeys[0];
  assert.deepEqual(xaiConfig, {
    name: 'primary',
    apiKey: 'xai-key',
    groups: ['paid'],
    priority: 7,
    fallback: true,
    concurrencyMode: 'inherit',
    maxConcurrency: 0,
    prefix: 'grok',
    baseUrl: 'https://api.x.ai/v1',
    websockets: true,
    proxyUrl: 'http://proxy.example',
    disableCooling: true,
    headers: { 'X-Test': 'value' },
    models: [{ name: 'grok-4', alias: 'grok-latest' }],
    excludedModels: ['grok-old'],
    authIndex: 'auth-live',
  });
  assert.equal(normalized.raw['xai-api-key'][0]['future-field'].keep, true);

  const resource = xaiToResource(xaiConfig, 0);
  assert.equal(resource.brand, 'xai');
  assert.equal(resource.name, 'primary');
  assert.deepEqual(resource.groups, ['paid']);
  assert.equal(resource.fallback, true);
  assert.equal(resource.authIndex, 'auth-live');
  assert.equal(resource.flags.websockets, true);
  assert.deepEqual(resource.selector, {
    brand: 'xai',
    apiKey: 'xai-key',
    baseUrl: 'https://api.x.ai/v1',
    index: 0,
  });

  assert.equal(PROVIDER_DESCRIPTORS.xai.displayName, 'xAI');
  assert.equal(PROVIDER_DESCRIPTORS.xai.supportsName, true);
  assert.equal(PROVIDER_DESCRIPTORS.xai.supportsWebsockets, true);
  assert.equal(PROVIDER_DESCRIPTORS.xai.baseUrlRequired, true);
  assert.equal(PROVIDER_BRAND_ORDER.includes('xai'), true);

  const createFormMarkup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      { delayDuration: 0 },
      createElement(BaseProviderForm, {
        brand: 'xai',
        resource: null,
        credentialGroupOptions: ['paid'],
        mode: 'create',
        mutating: false,
        formId: 'xai-create',
        onSubmit: async () => {},
      })
    )
  );
  for (const fieldId of [
    '-name',
    '-apiKey',
    '-baseUrl',
    '-proxy',
    '-prefix',
    '-prio',
    '-concurrency-value',
  ]) {
    assert.equal(createFormMarkup.includes(fieldId), true, `missing xAI form field ${fieldId}`);
  }
  assert.equal(createFormMarkup.includes('https://api.x.ai/v1'), true);
  assert.equal((createFormMarkup.match(/type="checkbox"/g) ?? []).length >= 4, true);

  const editFormMarkup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      { delayDuration: 0 },
      createElement(BaseProviderForm, {
        brand: 'xai',
        resource,
        credentialGroupOptions: ['paid'],
        mode: 'edit',
        mutating: false,
        formId: 'xai-edit',
        onSubmit: async () => {},
      })
    )
  );
  assert.equal(editFormMarkup.includes('auth-live'), false);

  const originalClientMethods = {
    get: apiClient.get,
    put: apiClient.put,
    patch: apiClient.patch,
    delete: apiClient.delete,
  };
  const calls = [];
  let latestItems = [];
  apiClient.get = async (url) => {
    calls.push({ method: 'GET', url });
    assert.equal(url, '/xai-api-key');
    return { 'xai-api-key': structuredClone(latestItems) };
  };
  apiClient.put = async (url, data) => {
    calls.push({ method: 'PUT', url, data });
    return {};
  };
  apiClient.patch = async (url, data) => {
    calls.push({ method: 'PATCH', url, data });
    return {};
  };
  apiClient.delete = async (url) => {
    calls.push({ method: 'DELETE', url });
    return {};
  };

  try {
    latestItems = [
      {
        'api-key': 'existing',
        'base-url': 'https://existing.example/v1',
        'auth-index': 'runtime-only',
        'future-field': { keep: true },
      },
    ];
    await providersApi.createXAIConfig({
      name: 'primary',
      apiKey: 'created',
      groups: ['paid'],
      fallback: true,
      concurrencyMode: 'inherit',
      maxConcurrency: 0,
      priority: 9,
      prefix: 'team',
      baseUrl: 'https://api.x.ai/v1',
      websockets: true,
      proxyUrl: 'http://proxy.example',
      models: [{ name: 'grok-4', alias: 'grok-latest' }],
      headers: { 'X-Test': 'value' },
      excludedModels: ['grok-old'],
      disableCooling: true,
      authIndex: 'must-not-write',
    });
    assert.deepEqual(
      calls.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/xai-api-key' },
        { method: 'PUT', url: '/xai-api-key' },
      ]
    );
    const createBody = calls[1].data;
    assert.equal(createBody[0]['future-field'].keep, true);
    assert.equal('auth-index' in createBody[0], false);
    assert.deepEqual(createBody[1], {
      name: 'primary',
      'api-key': 'created',
      groups: ['paid'],
      fallback: true,
      'concurrency-mode': 'inherit',
      'max-concurrency': 0,
      priority: 9,
      prefix: 'team',
      'base-url': 'https://api.x.ai/v1',
      websockets: true,
      'proxy-url': 'http://proxy.example',
      models: [{ name: 'grok-4', alias: 'grok-latest' }],
      headers: { 'X-Test': 'value' },
      'excluded-models': ['grok-old'],
      'disable-cooling': true,
    });

    calls.length = 0;
    latestItems = [
      { 'api-key': 'concurrent', 'base-url': 'https://concurrent.example/v1' },
      {
        name: 'old',
        'api-key': 'existing',
        groups: ['old'],
        fallback: true,
        priority: 3,
        prefix: 'old',
        'base-url': 'https://api.x.ai/v1',
        websockets: true,
        'proxy-url': 'http://old-proxy.example',
        models: [
          {
            name: 'grok-4',
            alias: 'old-alias',
            'display-name': 'Grok 4',
            'force-mapping': true,
          },
        ],
        headers: { Old: 'header' },
        'excluded-models': ['old-model'],
        'disable-cooling': true,
        'auth-index': 'runtime-only',
        'future-field': { keep: true },
      },
    ];
    await providersApi.updateXAIConfig('existing', 'https://api.x.ai/v1', {
      apiKey: 'updated',
      baseUrl: 'https://api.x.ai/v1',
      models: [{ name: 'grok-4' }],
    });
    assert.deepEqual(
      calls.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/xai-api-key' },
        { method: 'PATCH', url: '/xai-api-key' },
      ]
    );
    assert.equal(calls[1].data.index, 1);
    assert.deepEqual(calls[1].data.value, {
      'future-field': { keep: true },
      name: '',
      'api-key': 'updated',
      groups: [],
      fallback: false,
      priority: 0,
      'concurrency-mode': 'inherit',
      'max-concurrency': 0,
      prefix: '',
      'base-url': 'https://api.x.ai/v1',
      websockets: false,
      'proxy-url': '',
      models: [{ 'display-name': 'Grok 4', 'force-mapping': true, name: 'grok-4' }],
      headers: {},
      'excluded-models': [],
      'disable-cooling': false,
    });
    assert.equal('auth-index' in calls[1].data.value, false);

    calls.length = 0;
    latestItems = [
      { 'api-key': 'concurrent', 'base-url': 'https://concurrent.example/v1' },
      { 'api-key': 'existing', 'base-url': 'https://api.x.ai/v1', future: true },
    ];
    await providersApi.deleteXAIConfig('existing', 'https://api.x.ai/v1');
    assert.deepEqual(calls, [
      { method: 'GET', url: '/xai-api-key' },
      {
        method: 'DELETE',
        url: '/xai-api-key?api-key=existing&base-url=https%3A%2F%2Fapi.x.ai%2Fv1',
      },
    ]);

    calls.length = 0;
    latestItems = [{ 'api-key': 'other', 'base-url': 'https://api.x.ai/v1' }];
    await assert.rejects(
      providersApi.deleteXAIConfig('missing', 'https://api.x.ai/v1'),
      /configuration changed/
    );
    assert.deepEqual(calls, [{ method: 'GET', url: '/xai-api-key' }]);
  } finally {
    apiClient.get = originalClientMethods.get;
    apiClient.put = originalClientMethods.put;
    apiClient.patch = originalClientMethods.patch;
    apiClient.delete = originalClientMethods.delete;
  }
} finally {
  await server.close();
}

console.log('xAI provider workbench tests passed');
