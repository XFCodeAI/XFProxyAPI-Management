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
  const { initializeI18n, changeI18nLanguage } = await server.ssrLoadModule(
    '/src/i18n/index.ts'
  );
  await initializeI18n();
  await changeI18nLanguage('en');

  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { apiClient } = await server.ssrLoadModule('/src/services/api/client.ts');
  const { providersApi, serializeInteractionsKey } = await server.ssrLoadModule(
    '/src/services/api/providers.ts'
  );
  const { normalizeConfigResponse, normalizeInteractionsKeyConfig } =
    await server.ssrLoadModule('/src/services/api/transformers.ts');
  const { interactionsToResource } = await server.ssrLoadModule(
    '/src/features/providers/adapters.ts'
  );
  const { PROVIDER_BRAND_ORDER, PROVIDER_DESCRIPTORS } = await server.ssrLoadModule(
    '/src/features/providers/descriptors.ts'
  );
  const { buildProviderGroups, buildProviderKeyConfig } = await server.ssrLoadModule(
    '/src/features/providers/useProviderWorkbench.ts'
  );
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );

  const runtimeStatus = {
    connectivity: 'reachable',
    scheduling: 'ready',
    ready: true,
  };
  const rawEntry = {
    name: ' Native Interactions ',
    'api-key': ' interactions-secret ',
    groups: [' k12 ', 'k12', 'team'],
    fallback: true,
    priority: '7',
    weight: 0,
    'concurrency-mode': 'independent',
    'max-concurrency': 23,
    prefix: ' native ',
    'base-url': 'https://generativelanguage.googleapis.com',
    'proxy-url': 'http://proxy.example:7890',
    models: [
      {
        name: 'gemini-3.1-pro',
        alias: 'gemini-pro',
        'display-name': 'Gemini 3.1 Pro',
        'force-mapping': true,
        'is-compat': true,
        thinking: { budgets: [1024] },
      },
    ],
    headers: { 'X-Route': 'interactions' },
    'excluded-models': ['gemini-old'],
    'disable-cooling': true,
    'request-retry': 0,
    'auth-index': ' live-interactions ',
    'runtime-status': runtimeStatus,
    'future-field': { keep: true },
  };

  const normalizedEntry = normalizeInteractionsKeyConfig(rawEntry);
  assert.deepEqual(normalizedEntry, {
    name: 'Native Interactions',
    apiKey: 'interactions-secret',
    groups: ['k12', 'team'],
    priority: 7,
    weight: 0,
    fallback: true,
    concurrencyMode: 'independent',
    maxConcurrency: 23,
    prefix: 'native',
    baseUrl: 'https://generativelanguage.googleapis.com',
    proxyUrl: 'http://proxy.example:7890',
    disableCooling: true,
    models: [
      {
        name: 'gemini-3.1-pro',
        alias: 'gemini-pro',
        thinking: { budgets: [1024] },
      },
    ],
    headers: { 'X-Route': 'interactions' },
    excludedModels: ['gemini-old'],
    authIndex: 'live-interactions',
    runtimeStatus,
    requestRetry: 0,
  });

  const normalizedConfig = normalizeConfigResponse({ 'interactions-api-key': [rawEntry] });
  assert.equal(normalizedConfig.interactionsApiKeys.length, 1);
  assert.equal(normalizedConfig.raw['interactions-api-key'][0]['future-field'].keep, true);

  const resource = interactionsToResource(normalizedEntry, 0);
  assert.equal(resource.brand, 'interactions');
  assert.equal(resource.name, 'Native Interactions');
  assert.deepEqual(resource.groups, ['k12', 'team']);
  assert.equal(resource.weight, 0);
  assert.equal(resource.maxConcurrency, 23);
  assert.equal(resource.proxyUrl, 'http://proxy.example:7890');
  assert.equal(resource.fallback, true);
  assert.equal(resource.authIndex, 'live-interactions');
  assert.deepEqual(resource.selector, {
    brand: 'interactions',
    apiKey: 'interactions-secret',
    baseUrl: 'https://generativelanguage.googleapis.com',
    index: 0,
  });

  const interactionsGroup = buildProviderGroups(normalizedConfig).find(
    (group) => group.id === 'interactions'
  );
  assert.equal(interactionsGroup.resources.length, 1);
  assert.equal(PROVIDER_DESCRIPTORS.interactions.displayName, 'Interactions');
  assert.equal(PROVIDER_DESCRIPTORS.interactions.supportsApiKey, true);
  assert.equal(PROVIDER_DESCRIPTORS.interactions.supportsModels, true);
  assert.equal(PROVIDER_BRAND_ORDER.includes('interactions'), true);

  const renderForm = (mode, formResource) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        { delayDuration: 0 },
        createElement(BaseProviderForm, {
          brand: 'interactions',
          resource: formResource,
          credentialGroupOptions: ['k12', 'team'],
          mode,
          mutating: false,
          formId: `interactions-${mode}`,
          onSubmit: async () => {},
        })
      )
    );

  const createFormMarkup = renderForm('create', null);
  for (const fieldId of [
    '-name',
    '-apiKey',
    '-baseUrl',
    '-proxy',
    '-prefix',
    '-prio',
    '-concurrency-value',
    '-requestRetry',
  ]) {
    assert.equal(
      createFormMarkup.includes(fieldId),
      true,
      `missing Interactions form field ${fieldId}`
    );
  }
  assert.equal(createFormMarkup.includes('Routing weight'), true);
  assert.equal(createFormMarkup.includes('凭证分组'), true);
  assert.equal(createFormMarkup.includes('Request Retry Count'), true);

  const editFormMarkup = renderForm('edit', resource);
  assert.equal(editFormMarkup.includes('value="23"'), true);
  assert.equal(editFormMarkup.includes('value="0"'), true);
  assert.equal(editFormMarkup.includes('http://proxy.example:7890'), true);

  const formInput = {
    apiKey: 'new-interactions-key',
    name: 'Interactions primary',
    groups: ['k12', 'team'],
    baseUrl: 'https://generativelanguage.googleapis.com',
    proxyUrl: 'http://proxy.example:7890',
    prefix: 'native',
    disabled: false,
    disableCooling: true,
    fallback: true,
    priority: 8,
    weight: '0',
    concurrencyMode: 'independent',
    maxConcurrency: 17,
    requestRetry: 0,
    models: [
      {
        name: 'gemini-3.1-pro',
        alias: 'gemini-pro',
        priority: undefined,
        testModel: undefined,
      },
    ],
    headers: [{ key: 'X-Route', value: 'interactions' }],
    excludedModelsText: 'gemini-old',
  };
  const builtConfig = buildProviderKeyConfig('interactions', formInput);
  assert.deepEqual(builtConfig, {
    name: 'Interactions primary',
    apiKey: 'new-interactions-key',
    groups: ['k12', 'team'],
    priority: 8,
    weight: 0,
    concurrencyMode: 'independent',
    maxConcurrency: 17,
    prefix: 'native',
    baseUrl: 'https://generativelanguage.googleapis.com',
    proxyUrl: 'http://proxy.example:7890',
    fallback: true,
    models: [
      {
        name: 'gemini-3.1-pro',
        alias: 'gemini-pro',
        priority: undefined,
        testModel: undefined,
      },
    ],
    headers: { 'X-Route': 'interactions' },
    excludedModels: ['gemini-old'],
    authIndex: undefined,
    runtimeStatus: undefined,
    requestRetry: 0,
    disableCooling: true,
  });
  assert.deepEqual(serializeInteractionsKey(builtConfig), {
    'api-key': 'new-interactions-key',
    'concurrency-mode': 'independent',
    'max-concurrency': 17,
    name: 'Interactions primary',
    groups: ['k12', 'team'],
    priority: 8,
    weight: 0,
    fallback: true,
    prefix: 'native',
    'base-url': 'https://generativelanguage.googleapis.com',
    'proxy-url': 'http://proxy.example:7890',
    'disable-cooling': true,
    headers: { 'X-Route': 'interactions' },
    models: [{ name: 'gemini-3.1-pro', alias: 'gemini-pro' }],
    'excluded-models': ['gemini-old'],
    'request-retry': 0,
  });

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
    assert.equal(url, '/interactions-api-key');
    return { 'interactions-api-key': structuredClone(latestItems) };
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
    latestItems = [rawEntry];
    const fetched = await providersApi.getInteractionsKeys();
    assert.equal(fetched[0].requestRetry, 0);
    assert.deepEqual(calls, [{ method: 'GET', url: '/interactions-api-key' }]);

    calls.length = 0;
    latestItems = [rawEntry];
    await providersApi.createInteractionsKey(builtConfig);
    assert.deepEqual(
      calls.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/interactions-api-key' },
        { method: 'PUT', url: '/interactions-api-key' },
      ]
    );
    assert.equal(calls[1].data.length, 2);
    assert.equal(calls[1].data[0]['future-field'].keep, true);
    assert.equal('auth-index' in calls[1].data[0], false);
    assert.equal('runtime-status' in calls[1].data[0], false);
    assert.equal(calls[1].data[1]['request-retry'], 0);

    calls.length = 0;
    latestItems = [
      {
        'api-key': 'concurrent-key',
        'base-url': 'https://concurrent.example',
        concurrent: true,
      },
      rawEntry,
    ];
    await providersApi.updateInteractionsKey(
      'interactions-secret',
      'https://generativelanguage.googleapis.com',
      {
        ...builtConfig,
        apiKey: 'updated-interactions-key',
        excludedModels: ['*', 'gemini-old'],
        requestRetry: 2,
      }
    );
    assert.deepEqual(
      calls.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/interactions-api-key' },
        { method: 'PUT', url: '/interactions-api-key' },
      ]
    );
    assert.equal(calls.some((call) => call.method === 'PATCH'), false);
    assert.equal(calls[1].data[0].concurrent, true);
    const updated = calls[1].data[1];
    assert.equal(updated['api-key'], 'updated-interactions-key');
    assert.equal(updated['future-field'].keep, true);
    assert.equal(updated['request-retry'], 2);
    assert.deepEqual(updated['excluded-models'], ['*', 'gemini-old']);
    assert.equal(updated.models[0]['display-name'], 'Gemini 3.1 Pro');
    assert.equal(updated.models[0]['force-mapping'], true);
    assert.equal(updated.models[0]['is-compat'], true);
    assert.deepEqual(updated.models[0].thinking, { budgets: [1024] });
    assert.equal('auth-index' in updated, false);
    assert.equal('runtime-status' in updated, false);

    calls.length = 0;
    latestItems = [
      { 'api-key': 'other', 'base-url': 'https://other.example' },
      rawEntry,
    ];
    await providersApi.deleteInteractionsKey(
      'interactions-secret',
      'https://generativelanguage.googleapis.com'
    );
    assert.deepEqual(calls, [
      { method: 'GET', url: '/interactions-api-key' },
      {
        method: 'DELETE',
        url:
          '/interactions-api-key?api-key=interactions-secret&base-url=https%3A%2F%2Fgenerativelanguage.googleapis.com',
      },
    ]);

    calls.length = 0;
    latestItems = [{ 'api-key': 'other', 'base-url': 'https://other.example' }];
    await assert.rejects(
      providersApi.updateInteractionsKey('missing', undefined, builtConfig),
      /configuration changed/
    );
    assert.deepEqual(calls, [{ method: 'GET', url: '/interactions-api-key' }]);
  } finally {
    apiClient.get = originalClientMethods.get;
    apiClient.put = originalClientMethods.put;
    apiClient.patch = originalClientMethods.patch;
    apiClient.delete = originalClientMethods.delete;
  }
} finally {
  await server.close();
}

console.log('Interactions provider workbench tests passed');
