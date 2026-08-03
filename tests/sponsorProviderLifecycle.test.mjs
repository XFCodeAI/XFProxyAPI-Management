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
  const { normalizeConfigResponse } = await server.ssrLoadModule(
    '/src/services/api/transformers.ts'
  );
  const { PROVIDER_BRAND_ORDER, PROVIDER_DESCRIPTORS } = await server.ssrLoadModule(
    '/src/features/providers/descriptors.ts'
  );
  const { buildProviderGroups } = await server.ssrLoadModule(
    '/src/features/providers/useProviderWorkbench.ts'
  );
  const { getSponsorAggregationConflict, getSponsorProviderDefinition } =
    await server.ssrLoadModule('/src/features/providers/sponsorDefinitions.ts');
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );
  const { isSponsorPartialMutationError, runSponsorMutationWithRecovery } =
    await server.ssrLoadModule('/src/features/providers/sponsorMutationRecovery.ts');

  const retiredBrands = ['apikeyFun', 'claudeApi', 'code0', 'fennoAI', 'qiniuCloud'];
  for (const brand of retiredBrands) {
    assert.equal(PROVIDER_BRAND_ORDER.includes(brand), false);
    assert.equal(Object.hasOwn(PROVIDER_DESCRIPTORS, brand), false);
  }
  assert.deepEqual(getSponsorProviderDefinition('kimi').protocols, ['openai', 'claude']);

  const normalized = normalizeConfigResponse({
    'gemini-api-key': [
      { 'api-key': 'gemini-code0', 'base-url': 'https://code0.ai' },
      { 'api-key': 'gemini-qiniu', 'base-url': 'https://api.qnaigc.com' },
    ],
    'codex-api-key': [
      { 'api-key': 'codex-apikey-fun', 'base-url': 'https://api.apikey.fun/v1' },
      { 'api-key': 'codex-code0', 'base-url': 'https://code0.ai/v1' },
      { 'api-key': 'codex-fenno', 'base-url': 'https://api.fenno.ai/v1' },
      { 'api-key': 'codex-qiniu', 'base-url': 'https://api.modelink.ai/v1' },
    ],
    'claude-api-key': [
      { 'api-key': 'claude-apikey-fun', 'base-url': 'https://api.apikey.fun' },
      { 'api-key': 'claude-api', 'base-url': 'https://gw.apito.ai' },
      { 'api-key': 'claude-code0', 'base-url': 'https://code0.ai' },
      { 'api-key': 'claude-fenno', 'base-url': 'https://api.fenno.ai' },
      { 'api-key': 'claude-qiniu', 'base-url': 'https://api.qnaigc.com' },
      { 'api-key': 'claude-kimi', 'base-url': 'https://api.moonshot.cn/anthropic' },
    ],
    'openai-compatibility': [
      {
        name: 'legacy-apikey-fun',
        'base-url': 'https://api.apikey.fun/v1',
        'api-key-entries': [{ 'api-key': 'openai-apikey-fun' }],
      },
      {
        name: 'legacy-code0',
        'base-url': 'https://code0.ai/v1',
        'api-key-entries': [{ 'api-key': 'openai-code0' }],
      },
      {
        name: 'legacy-qiniu',
        'base-url': 'https://api.modelink.ai/v1',
        'api-key-entries': [{ 'api-key': 'openai-qiniu' }],
      },
      {
        name: 'kimi',
        'base-url': 'https://api.moonshot.cn/v1',
        'api-key-entries': [{ 'api-key': 'openai-kimi' }],
      },
    ],
  });

  const groups = buildProviderGroups(normalized);
  assert.deepEqual(
    groups.map((group) => group.id),
    PROVIDER_BRAND_ORDER
  );
  const byBrand = Object.fromEntries(groups.map((group) => [group.id, group.resources]));
  assert.equal(byBrand.gemini.length, 2);
  assert.equal(byBrand.codex.length, 4);
  assert.equal(byBrand.claude.length, 5);
  assert.equal(byBrand.openaiCompatibility.length, 3);
  assert.equal(byBrand.kimi.length, 1);
  assert.equal(
    byBrand.claude.some((resource) => resource.baseUrl === 'https://gw.apito.ai'),
    true
  );
  assert.equal(
    byBrand.openaiCompatibility.some(
      (resource) => resource.baseUrl === 'https://api.apikey.fun/v1'
    ),
    true
  );
  assert.equal(
    byBrand.codex.some((resource) => resource.baseUrl === 'https://api.fenno.ai/v1'),
    true
  );
  assert.equal(
    byBrand.gemini.some((resource) => resource.baseUrl === 'https://api.qnaigc.com'),
    true
  );

  for (const brand of ['gemini', 'codex', 'claude', 'openaiCompatibility']) {
    const resource = byBrand[brand][0];
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        { delayDuration: 0 },
        createElement(BaseProviderForm, {
          brand,
          resource,
          credentialGroupOptions: [],
          mode: 'edit',
          mutating: false,
          formId: `${brand}-legacy-edit`,
          onSubmit: async () => {},
        })
      )
    );
    assert.equal(markup.includes(resource.baseUrl), true, `${brand} legacy URL is not editable`);
  }

  const conflictRaw = {
    openai: [
      {
        index: 0,
        config: {
          name: 'kimi',
          baseUrl: 'https://api.moonshot.cn/v1',
          apiKeyEntries: [{ apiKey: 'first' }, { apiKey: 'second' }],
        },
      },
    ],
    claude: [],
  };
  assert.equal(getSponsorAggregationConflict(conflictRaw), 'multiple-openai-keys');
  conflictRaw.openai = [];
  conflictRaw.claude = [
    { index: 0, config: { apiKey: 'first' } },
    { index: 1, config: { apiKey: 'second' } },
  ];
  assert.equal(getSponsorAggregationConflict(conflictRaw), 'multiple-configs');

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

console.log('provider category lifecycle tests passed');
