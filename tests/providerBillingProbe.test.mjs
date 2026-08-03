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
  const { supplierBillingProbeApi } = await server.ssrLoadModule(
    '/src/services/api/supplierBillingProbe.ts'
  );
  const { apiClient } = await server.ssrLoadModule('/src/services/api/client.ts');
  const billing = await server.ssrLoadModule('/src/features/providers/useSupplierBillingProbes.ts');
  const { ProviderResourceTable } = await server.ssrLoadModule(
    '/src/features/providers/components/ProviderResourceTable.tsx'
  );
  const { ResourceDetailView } = await server.ssrLoadModule(
    '/src/features/providers/sheets/ResourceDetailView.tsx'
  );

  const multiplier = (value) => ({
    schema_version: 2,
    billing_scope: 'token',
    group_rate_multiplier: Number(value),
    group_rate_multiplier_text: String(value),
    resolved_rate_multiplier: Number(value),
    resolved_rate_multiplier_text: String(value),
    peak_rate_enabled: false,
    effective_rate_multiplier: Number(value),
    effective_rate_multiplier_text: String(value),
    observed_at: '2026-08-02T10:00:00Z',
  });
  const usage = (remaining = 25, overrides = {}) => ({
    status: 'ok',
    is_valid: true,
    remaining,
    unit: 'USD',
    stale: false,
    received_at: '2026-08-02T10:00:00Z',
    next_probe_at: '2026-08-02T10:01:00Z',
    ...overrides,
  });
  const probeEntry = (overrides) => ({
    target_id: 'supplier:target',
    provider_brand: 'codex',
    provider_name: 'Codex supplier',
    provider_index: 0,
    api_key_index: 0,
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('0.8'),
    next_probe_at: '2026-08-02T10:30:00Z',
    usage: usage(),
    ...overrides,
  });
  const entries = [
    probeEntry({ target_id: 'supplier:codex', provider_brand: 'codex' }),
    probeEntry({
      target_id: 'supplier:openai-a',
      provider_brand: 'openaiCompatibility',
      provider_name: 'Shared upstream',
      provider_index: 2,
      api_key_index: 0,
      alias: 'primary',
      multiplier: multiplier('1.25'),
      usage: usage(100),
    }),
    probeEntry({
      target_id: 'supplier:openai-b',
      provider_brand: 'openaiCompatibility',
      provider_name: 'Shared upstream',
      provider_index: 2,
      api_key_index: 1,
      alias: 'backup',
      multiplier: multiplier('2'),
      usage: usage(61.5, { unit: 'CNY' }),
    }),
    probeEntry({
      target_id: 'supplier:claude',
      provider_brand: 'claude',
      provider_name: 'Claude direct',
      provider_index: 0,
      alias: 'Claude direct',
      multiplier: multiplier('0.6'),
    }),
    probeEntry({
      target_id: 'supplier:xai',
      provider_brand: 'xai',
      provider_name: 'xAI direct',
      provider_index: 0,
      alias: 'xAI direct',
      multiplier: multiplier('0.7'),
    }),
    probeEntry({
      target_id: 'supplier:kimi-openai',
      provider_brand: 'openaiCompatibility',
      provider_name: 'kimi',
      provider_index: 4,
      alias: 'primary',
      multiplier: multiplier('0.3'),
    }),
    probeEntry({
      target_id: 'supplier:kimi-claude',
      provider_brand: 'claude',
      provider_name: 'Kimi Claude',
      provider_index: 3,
      alias: 'secondary',
      multiplier: multiplier('0.4'),
    }),
    probeEntry({
      target_id: 'supplier:unrelated-kimi-name',
      provider_brand: 'openaiCompatibility',
      provider_name: 'kimi',
      provider_index: 9,
      alias: 'intruder',
      multiplier: multiplier('9'),
    }),
  ];

  const originalGet = apiClient.get;
  let listRequest = null;
  apiClient.get = async (url, config) => {
    listRequest = { url, config };
    return { provider_name: '', entries: [] };
  };
  try {
    await supplierBillingProbeApi.list(['xai:2', 'codex:0', 'xai:2']);
  } finally {
    apiClient.get = originalGet;
  }
  assert.equal(listRequest.url, '/supplier-billing-probes');
  assert.equal(listRequest.config.params.resource_keys, 'codex:0,xai:2');

  let listCalls = 0;
  let probeCalls = 0;
  const originalList = supplierBillingProbeApi.list;
  const originalProbe = supplierBillingProbeApi.probe;
  let listedResourceKeys = null;
  supplierBillingProbeApi.list = async (resourceKeys) => {
    listCalls += 1;
    listedResourceKeys = resourceKeys;
    return { provider_name: '', entries };
  };
  supplierBillingProbeApi.probe = async () => {
    probeCalls += 1;
    return entries[0];
  };
  try {
    const loaded = await billing.loadSupplierBillingProbeEntries(
      new Set(['codex:0', 'openaiCompatibility:2'])
    );
    assert.equal(listCalls, 1, 'active supplier resources must share one batch GET');
    assert.equal(probeCalls, 0, 'batch loading must never POST per row');
    assert.equal(loaded.length, 3);
    assert.deepEqual(listedResourceKeys, ['codex:0', 'openaiCompatibility:2']);
  } finally {
    supplierBillingProbeApi.list = originalList;
    supplierBillingProbeApi.probe = originalProbe;
  }

  const grouped = billing.groupSupplierBillingProbeEntries(entries);
  assert.deepEqual(
    grouped['openaiCompatibility:2'].map((entry) => entry.alias),
    ['primary', 'backup']
  );
  assert.equal(
    billing.shouldPollSupplierBillingProbes([
      probeEntry({ status: 'not_checked', probing: false }),
    ]),
    true
  );
  assert.equal(
    billing.shouldPollSupplierBillingProbes([
      probeEntry({ status: 'unsupported', probing: false }),
    ]),
    false
  );
  assert.equal(
    billing.shouldPollSupplierBillingProbes([
      probeEntry({ usage: usage(undefined, { status: 'not_checked' }) }),
    ]),
    true,
    'initial usage state must use one-second completion polling'
  );
  const scheduleNow = Date.parse('2026-08-02T10:00:00Z');
  assert.equal(
    billing.supplierBillingProbeRefreshDelay(
      [
        probeEntry({
          next_probe_at: '2026-08-02T10:30:00Z',
          usage: usage(25, { next_probe_at: '2026-08-02T10:01:00Z' }),
        }),
      ],
      scheduleNow
    ),
    60_000,
    'nearest independent usage due time must drive the next batch read'
  );

  const codexRaw = {
    name: 'Codex supplier',
    apiKey: 'sk-codex-secret',
    baseUrl: 'https://codex.example/v1',
    models: [{ name: 'gpt-5.6' }],
    headers: { 'X-Test': 'value' },
  };
  const codexResource = {
    id: 'codex:0',
    brand: 'codex',
    originalIndex: 0,
    name: 'Codex supplier',
    groups: ['paid'],
    identifier: 'Codex supplier',
    apiKeyPreview: 'sk-c...cret',
    apiKey: 'sk-codex-secret',
    authIndex: null,
    baseUrl: 'https://codex.example/v1',
    proxyUrl: null,
    prefix: 'team',
    modelCount: 1,
    models: ['gpt-5.6'],
    priority: 0,
    fallback: false,
    headerCount: 1,
    excludedModelCount: 0,
    apiKeyEntryCount: 0,
    disabled: false,
    runtimeStatus: { connectivity: 'reachable', scheduling: 'ready', ready: true },
    flags: {},
    selector: { brand: 'codex', apiKey: 'sk-codex-secret', index: 0 },
    raw: codexRaw,
  };
  const openAIRaw = {
    name: 'Shared upstream',
    baseUrl: 'https://shared.example/v1',
    apiKeyEntries: [
      { name: 'primary', apiKey: 'sk-primary' },
      { name: 'backup', apiKey: 'sk-backup' },
    ],
    models: [],
  };
  const openAIResource = {
    ...codexResource,
    id: 'openaiCompatibility:2',
    brand: 'openaiCompatibility',
    originalIndex: 2,
    name: 'Shared upstream',
    identifier: 'Shared upstream',
    apiKeyPreview: 'sk-p...mary',
    apiKey: null,
    baseUrl: 'https://shared.example/v1',
    prefix: null,
    modelCount: 0,
    models: [],
    headerCount: 0,
    apiKeyEntryCount: 2,
    selector: { brand: 'openaiCompatibility', name: 'Shared upstream', index: 2 },
    raw: openAIRaw,
  };
  const claudeResource = {
    ...codexResource,
    id: 'claude:0',
    brand: 'claude',
    originalIndex: 0,
    name: 'Claude direct',
    identifier: 'Claude direct',
    apiKeyPreview: 'sk-c...aude',
    apiKey: 'sk-claude-secret',
    baseUrl: 'https://claude.example',
    selector: {
      brand: 'claude',
      apiKey: 'sk-claude-secret',
      baseUrl: 'https://claude.example',
      index: 0,
    },
    raw: {
      name: 'Claude direct',
      apiKey: 'sk-claude-secret',
      baseUrl: 'https://claude.example',
    },
  };
  const xaiResource = {
    ...codexResource,
    id: 'xai:0',
    brand: 'xai',
    originalIndex: 0,
    name: 'xAI direct',
    identifier: 'xAI direct',
    apiKeyPreview: 'sk-x...cret',
    apiKey: 'sk-xai-secret',
    baseUrl: 'https://xai.example/v1',
    selector: {
      brand: 'xai',
      apiKey: 'sk-xai-secret',
      baseUrl: 'https://xai.example/v1',
      index: 0,
    },
    raw: {
      name: 'xAI direct',
      apiKey: 'sk-xai-secret',
      baseUrl: 'https://xai.example/v1',
    },
  };
  const kimiRaw = {
    openai: [
      {
        index: 4,
        config: {
          name: 'kimi',
          baseUrl: 'https://api.moonshot.cn/v1',
          apiKeyEntries: [{ name: 'primary', apiKey: 'sk-kimi-openai' }],
        },
      },
    ],
    claude: [
      {
        index: 3,
        config: {
          name: 'secondary',
          apiKey: 'sk-kimi-claude',
          baseUrl: 'https://api.moonshot.cn/anthropic',
        },
      },
    ],
  };
  const kimiResource = {
    ...codexResource,
    id: 'kimi:0',
    brand: 'kimi',
    originalIndex: 0,
    name: 'Kimi',
    identifier: 'Kimi',
    apiKeyPreview: 'sk-k...enai',
    apiKey: 'sk-kimi-openai',
    baseUrl: 'https://api.moonshot.cn/v1 / https://api.moonshot.cn/anthropic',
    modelCount: 0,
    models: [],
    headerCount: 0,
    apiKeyEntryCount: 2,
    flags: { protocols: ['openai', 'anthropic'] },
    selector: { brand: 'kimi', openaiIndices: [4], claudeIndices: [3] },
    raw: kimiRaw,
  };
  assert.deepEqual(billing.supplierBillingSourceKeys(kimiResource), [
    'openaiCompatibility:4',
    'claude:3',
  ]);
  const mapped = billing.mapSupplierBillingProbeEntriesToResources(entries, [
    codexResource,
    openAIResource,
    claudeResource,
    xaiResource,
    kimiResource,
  ]);
  assert.deepEqual(
    mapped['kimi:0'].map((entry) => [entry.alias, entry.multiplier.effective_rate_multiplier_text]),
    [
      ['OpenAI / primary', '0.3'],
      ['Claude / secondary', '0.4'],
    ],
    'Kimi must map only typed source indices and keep both protocol entries'
  );
  assert.equal(
    mapped['kimi:0'].some((entry) => entry.target_id === 'supplier:unrelated-kimi-name'),
    false,
    'same-name providers outside the selector must not leak into Kimi'
  );
  const usageByProvider = new Map([
    [
      'codex',
      new Map([
        [
          'https://codex.example/v1|sk-codex-secret',
          {
            success: 12,
            failed: 3,
            authIndexes: [],
            recentRequests: [
              { success: 3, failed: 0 },
              { success: 0, failed: 1 },
            ],
          },
        ],
      ]),
    ],
    [
      'shared upstream',
      new Map([
        [
          'https://shared.example/v1|sk-primary',
          {
            success: 7,
            failed: 1,
            authIndexes: [],
            recentRequests: [{ success: 2, failed: 0 }],
          },
        ],
        [
          'https://shared.example/v1|sk-backup',
          {
            success: 5,
            failed: 2,
            authIndexes: [],
            recentRequests: [{ success: 1, failed: 1 }],
          },
        ],
      ]),
    ],
  ]);
  const renderTable = (probeEntriesByResource, resources = [codexResource, openAIResource]) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        { delayDuration: 0 },
        createElement(ProviderResourceTable, {
          resources,
          usageByProvider,
          billingProbeEntriesByResource: probeEntriesByResource,
          onRefreshBillingProbe: async () => {},
          onView: () => {},
          onEdit: () => {},
          onDelete: () => {},
        })
      )
    );
  const tableMarkup = renderTable(mapped);
  assert.equal((tableMarkup.match(/<th(?:\s|>)/g) ?? []).length, 5);
  for (const expected of [
    'Supplier',
    'Status',
    'Multiplier / Balance',
    'Service address',
    'Actions',
  ]) {
    assert.equal(tableMarkup.includes(expected), true, `missing table header ${expected}`);
  }
  for (const removed of ['Models/Headers', '>Prefix<']) {
    assert.equal(tableMarkup.includes(removed), false, `legacy list content remains: ${removed}`);
  }
  for (const expected of ['Success: 12', 'Failure: 3', '75%']) {
    assert.equal(
      tableMarkup.includes(expected),
      true,
      `missing restored request health ${expected}`
    );
  }
  assert.equal(
    (tableMarkup.match(/aria-label="Recent request success rate\./g) ?? []).length,
    2,
    'each supplier row must retain its recent request status buckets'
  );
  for (const expected of [
    '0.8x',
    '25 USD',
    'primary',
    '1.25x',
    '100 USD',
    'backup',
    '2x',
    '61.5 CNY',
  ]) {
    assert.equal(tableMarkup.includes(expected), true, `missing independent rate ${expected}`);
  }
  const probingGrouped = billing.groupSupplierBillingProbeEntries([
    ...entries.slice(1),
    probeEntry({ target_id: 'supplier:codex', provider_brand: 'codex', probing: true }),
  ]);
  const probingMarkup = renderTable(probingGrouped);
  for (const expected of ['Probing', 'Success: 12', 'Failure: 3', '75%']) {
    assert.equal(
      probingMarkup.includes(expected),
      true,
      `billing refresh cleared request health: ${expected}`
    );
  }
  const extendedMarkup = renderTable(mapped, [claudeResource, xaiResource, kimiResource]);
  for (const expected of [
    '0.6x',
    '0.7x',
    'OpenAI / primary',
    '0.3x',
    'Claude / secondary',
    '0.4x',
  ]) {
    assert.equal(extendedMarkup.includes(expected), true, `missing provider rate ${expected}`);
  }
  assert.equal(extendedMarkup.includes('intruder'), false, 'Kimi rendered unrelated provider data');
  assert.equal(extendedMarkup.includes('9x'), false, 'Kimi rendered unrelated provider rate');

  const unsupportedMapped = billing.mapSupplierBillingProbeEntriesToResources(
    [
      probeEntry({
        target_id: 'supplier:xai-unsupported',
        provider_brand: 'xai',
        provider_name: 'xAI direct',
        provider_index: 0,
        alias: 'xAI direct',
        status: 'unsupported',
        multiplier: undefined,
        usage: usage(undefined, {
          status: 'unsupported',
          is_valid: undefined,
          remaining: undefined,
          unit: undefined,
          received_at: undefined,
        }),
      }),
    ],
    [xaiResource]
  );
  const unsupportedMarkup = renderTable(unsupportedMapped, [xaiResource]);
  assert.equal(unsupportedMarkup.includes('Unsupported'), true);
  assert.equal(unsupportedMarkup.includes('1x'), false, 'unsupported target fabricated a rate');

  const retainedFailedUsage = billing.mapSupplierBillingProbeEntriesToResources(
    [
      probeEntry({
        target_id: 'supplier:xai-usage-failed',
        provider_brand: 'xai',
        provider_name: 'xAI direct',
        provider_index: 0,
        alias: 'xAI direct',
        usage: usage(18, { status: 'failed', last_error: 'http_error' }),
      }),
    ],
    [xaiResource]
  );
  const retainedFailedUsageMarkup = renderTable(retainedFailedUsage, [xaiResource]);
  assert.equal(retainedFailedUsageMarkup.includes('18 USD'), true);
  assert.equal(retainedFailedUsageMarkup.includes('Probe failed'), true);

  const renderDetail = (resource, probeEntries) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        { delayDuration: 0 },
        createElement(ResourceDetailView, {
          resource,
          billingProbeEntries: probeEntries,
          onRefreshBillingProbe: async () => {},
        })
      )
    );
  const codexDetail = renderDetail(codexResource, grouped['codex:0']);
  const openAIDetail = renderDetail(openAIResource, grouped['openaiCompatibility:2']);
  const claudeDetail = renderDetail(claudeResource, mapped['claude:0']);
  const xaiDetail = renderDetail(xaiResource, mapped['xai:0']);
  const kimiDetail = renderDetail(kimiResource, mapped['kimi:0']);
  assert.equal(codexDetail.includes('0.8x'), true, 'Codex detail must show its multiplier');
  assert.equal(codexDetail.includes('25 USD'), true, 'Codex detail must show its balance');
  assert.equal(openAIDetail.includes('1.25x'), true, 'OpenAI detail must show key rate');
  assert.equal(openAIDetail.includes('2x'), true, 'OpenAI detail must show every key rate');
  assert.equal(claudeDetail.includes('0.6x'), true, 'Claude detail must show its multiplier');
  assert.equal(xaiDetail.includes('0.7x'), true, 'xAI detail must show its multiplier');
  for (const expected of ['OpenAI / primary', '0.3x', 'Claude / secondary', '0.4x']) {
    assert.equal(kimiDetail.includes(expected), true, `Kimi detail missing ${expected}`);
  }
  for (const retainedDetail of ['Prefix', 'Models', 'Headers']) {
    assert.equal(codexDetail.includes(retainedDetail), true, `detail lost ${retainedDetail}`);
  }
} finally {
  await server.close();
}

console.log('provider billing probe tests passed');
