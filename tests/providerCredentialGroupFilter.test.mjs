import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const resource = (brand, raw, groups, overrides = {}) => ({
  id: `${brand}-1`,
  brand,
  originalIndex: 0,
  name: brand,
  groups,
  identifier: brand,
  apiKeyPreview: 'original-preview',
  apiKey: null,
  authIndex: null,
  baseUrl: 'https://gateway.example',
  proxyUrl: null,
  prefix: null,
  modelCount: 1,
  models: ['test-model'],
  priority: 0,
  fallback: false,
  headerCount: 0,
  excludedModelCount: 0,
  apiKeyEntryCount: 0,
  disabled: false,
  runtimeStatus: null,
  flags: {},
  selector: { brand, index: 0 },
  raw,
  ...overrides,
});

try {
  const {
    buildCredentialGroupRelayPath,
    classifyCredentialGroupFilterState,
    clearCredentialGroupFilterParams,
    filterProviderGroupsByCredentialGroup,
    hasExactCredentialGroup,
    readCredentialGroupFilter,
  } = await server.ssrLoadModule('/src/features/providers/credentialGroupFilter.ts');
  const { maskApiKey } = await server.ssrLoadModule('/src/utils/format.ts');
  const { mapSupplierBillingProbeEntriesToResources, supplierBillingResourceKey } =
    await server.ssrLoadModule('/src/features/providers/useSupplierBillingProbes.ts');

  for (const group of ['plus', 'team one', 'team/&?#', '中文 分组']) {
    const path = buildCredentialGroupRelayPath(group);
    const url = new URL(path, 'https://management.example');
    assert.equal(url.pathname, '/ai-providers');
    assert.equal(readCredentialGroupFilter(url.searchParams), group);
    assert.equal(url.searchParams.getAll('credential-group').length, 1);
  }

  const preservedParams = clearCredentialGroupFilterParams(
    new URLSearchParams('credential-group=team+one&view=compact&sort=priority')
  );
  assert.equal(preservedParams.has('credential-group'), false);
  assert.equal(preservedParams.get('view'), 'compact');
  assert.equal(preservedParams.get('sort'), 'priority');

  assert.equal(hasExactCredentialGroup(['Team A'], ' team a '), true);
  assert.equal(hasExactCredentialGroup(['team-alpha'], 'team'), false);

  const openAIRaw = {
    name: 'aggregate',
    baseUrl: 'https://openai.example/v1',
    apiKeyEntries: [
      { apiKey: 'sk-unrelated', groups: ['other'] },
      { apiKey: 'sk-matching', groups: ['Team A'] },
      { apiKey: 'sk-similar', groups: ['team-alpha'] },
    ],
  };
  const sponsorRaw = {
    openai: [
      {
        index: 3,
        config: {
          name: 'kimi',
          baseUrl: 'https://api.moonshot.cn/v1',
          apiKeyEntries: [
            { apiKey: 'kimi-other', groups: ['other'] },
            { apiKey: 'kimi-match', groups: ['team a'] },
          ],
        },
      },
    ],
    claude: [
      {
        index: 4,
        config: {
          apiKey: 'kimi-claude-match',
          baseUrl: 'https://api.moonshot.cn/anthropic',
          groups: ['Team A'],
        },
      },
      {
        index: 5,
        config: {
          apiKey: 'kimi-claude-other',
          baseUrl: 'https://api.moonshot.cn/anthropic',
          groups: ['other'],
        },
      },
    ],
  };
  const groups = [
    {
      id: 'claude',
      resources: [
        resource('claude', { apiKey: 'claude-match' }, ['team a']),
        resource('claude', { apiKey: 'claude-other' }, ['other'], { id: 'claude-2' }),
      ],
    },
    {
      id: 'openaiCompatibility',
      resources: [
        resource('openaiCompatibility', openAIRaw, ['other', 'Team A', 'team-alpha'], {
          apiKeyEntryCount: 3,
        }),
      ],
    },
    {
      id: 'kimi',
      resources: [
        resource('kimi', sponsorRaw, ['other', 'Team A'], {
          apiKeyEntryCount: 4,
          selector: { brand: 'kimi', openaiIndices: [3], claudeIndices: [4, 5] },
        }),
      ],
    },
  ];

  const filtered = filterProviderGroupsByCredentialGroup(groups, 'team a');
  assert.equal(filtered.length, 3);
  assert.equal(filtered[0].resources.length, 1);
  assert.equal(filtered[1].resources.length, 1);
  assert.equal(filtered[1].resources[0].apiKeyEntryCount, 1);
  assert.equal(filtered[1].resources[0].apiKeyPreview, maskApiKey('sk-matching'));
  assert.equal(filtered[1].resources[0].raw, openAIRaw);
  assert.equal(filtered[1].resources[0].usageRaw.apiKeyEntries.length, 1);
  assert.deepEqual(filtered[1].resources[0].billingTargets[0].apiKeyIndexes, [1]);
  assert.equal(filtered[2].resources.length, 1);
  assert.equal(filtered[2].resources[0].apiKeyEntryCount, 2);
  assert.equal(filtered[2].resources[0].apiKeyPreview, maskApiKey('kimi-match'));
  assert.equal(filtered[2].resources[0].raw, sponsorRaw);

  const billingEntries = [
    ['openaiCompatibility', 0, 0, 'openai-unrelated'],
    ['openaiCompatibility', 0, 1, 'openai-matching'],
    ['openaiCompatibility', 3, 0, 'kimi-openai-unrelated'],
    ['openaiCompatibility', 3, 1, 'kimi-openai-matching'],
    ['claude', 4, 0, 'kimi-claude-matching'],
    ['claude', 5, 0, 'kimi-claude-unrelated'],
  ].map(([providerBrand, providerIndex, apiKeyIndex, targetId]) => ({
    target_id: targetId,
    provider_brand: providerBrand,
    provider_name: providerBrand,
    provider_index: providerIndex,
    api_key_index: apiKeyIndex,
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
  }));
  const billingByResource = mapSupplierBillingProbeEntriesToResources(billingEntries, [
    filtered[1].resources[0],
    filtered[2].resources[0],
  ]);
  assert.deepEqual(
    billingByResource[supplierBillingResourceKey('openaiCompatibility', 0)].map(
      (entry) => entry.target_id
    ),
    ['openai-matching']
  );
  assert.deepEqual(
    billingByResource[supplierBillingResourceKey('kimi', 0)].map((entry) => entry.target_id),
    ['kimi-openai-matching', 'kimi-claude-matching']
  );

  assert.equal(
    classifyCredentialGroupFilterState({
      filter: 'team a',
      catalogReady: true,
      catalogGroups: ['Team A'],
      matchingProviderCount: 3,
      matchingOAuthCount: 1,
    }),
    'active'
  );
  assert.equal(
    classifyCredentialGroupFilterState({
      filter: 'oauth',
      catalogReady: true,
      catalogGroups: ['oauth'],
      matchingProviderCount: 0,
      matchingOAuthCount: 2,
    }),
    'oauth-only'
  );
  assert.equal(
    classifyCredentialGroupFilterState({
      filter: 'empty',
      catalogReady: true,
      catalogGroups: ['empty'],
      matchingProviderCount: 0,
      matchingOAuthCount: 0,
    }),
    'empty'
  );
  assert.equal(
    classifyCredentialGroupFilterState({
      filter: 'deleted',
      catalogReady: true,
      catalogGroups: ['active'],
      matchingProviderCount: 0,
      matchingOAuthCount: 0,
    }),
    'stale'
  );
} finally {
  await server.close();
}

console.log('Provider credential group filter tests passed');
