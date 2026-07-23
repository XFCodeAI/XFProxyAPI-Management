import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const inputWire = {
  provider: 'openai',
  model: 'gpt-5',
  service_tier: null,
  context_min_tokens: 0,
  context_max_tokens: 200000,
  prices: {
    input_per_million: '0',
    output_per_million: '12.50',
    reasoning_per_million: null,
    cache_read_per_million: '0.125',
    cache_creation_per_million: null,
    fixed_request: null,
  },
  multipliers: {
    input: '2',
    output: '1.5',
    reasoning: null,
    cache_read: '1',
    cache_creation: null,
    fixed_request: null,
  },
};

const ruleWire = {
  id: 'rule-1',
  ...inputWire,
  source: {
    kind: 'litellm',
    manual_override: false,
    model: 'openai/gpt-5',
    provider: 'openai',
    url: 'https://example.test/prices',
    fetched_at: '2026-07-22T00:00:00Z',
    sync_id: 'sync-1',
    version: 'upstream-7',
  },
  version: 4,
  catalog_version: 8,
  created_at: '2026-07-22T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
  coverage: 'partial',
  missing_dimensions: ['reasoning'],
  used: true,
  request_count: 14,
  estimated_cost: '3.25',
};

const variantWire = {
  ...ruleWire,
  id: 'rule-priority',
  service_tier: 'priority',
  context_min_tokens: 200001,
  context_max_tokens: null,
  prices: {
    ...ruleWire.prices,
    input_per_million: '2.50',
    output_per_million: '15',
  },
  version: 2,
};

const syncRuleWire = ({
  model,
  provider = 'codex',
  serviceTier = null,
  contextMinTokens = null,
  contextMaxTokens = null,
  prices = {},
}) => ({
  provider,
  model,
  service_tier: serviceTier,
  context_min_tokens: contextMinTokens,
  context_max_tokens: contextMaxTokens,
  prices: {
    input_per_million: null,
    output_per_million: null,
    reasoning_per_million: null,
    cache_read_per_million: null,
    cache_creation_per_million: null,
    fixed_request: null,
    ...prices,
  },
  multipliers: {
    input: null,
    output: null,
    reasoning: null,
    cache_read: null,
    cache_creation: null,
    fixed_request: null,
  },
});

try {
  const api = await server.ssrLoadModule('/src/services/api/modelPrices.ts');
  const client = await server.ssrLoadModule('/src/services/api/client.ts');
  const viewModel = await server.ssrLoadModule('/src/features/modelPrices/viewModel.ts');

  const catalog = api.normalizeModelPriceCatalogResponse({
    available: true,
    generated_at: '2026-07-23T01:00:00Z',
    last_sync_at: '2026-07-23T00:00:00Z',
    catalog_version: 8,
    summary: {
      model_count: 2,
      used_model_count: 2,
      unpriced_model_count: 1,
      estimated_cost: '3.25',
      currency: 'usd',
      truncated: false,
      future_metric: 9,
    },
    entries: [
      {
        provider: 'openai',
        model: 'gpt-5',
        coverage: 'partial',
        missing_dimensions: ['reasoning'],
        used: true,
        request_count: 14,
        estimated_cost: '3.25',
        requested_models: ['gpt-5-alias'],
        default: { ...ruleWire, future_field: 'ignored' },
        variants: [variantWire],
        conflicts: [],
      },
      {
        model: 'unknown-model',
        provider: 'openai',
        coverage: 'unpriced',
        missing_dimensions: ['price_rule'],
        used: true,
        request_count: 2,
        estimated_cost: null,
        requested_models: ['unknown-alias'],
        default: null,
        variants: [],
        conflicts: [],
      },
    ],
    additive_top_level: true,
  });

  assert.equal(catalog.available, true);
  assert.equal(catalog.catalogVersion, 8);
  assert.equal(catalog.summary.currency, 'USD');
  assert.equal(catalog.summary.truncated, false);
  assert.equal(catalog.summary.modelCount, 2);
  assert.equal(catalog.entries[0].default.prices.inputPerMillion, '0');
  assert.equal(catalog.entries[0].default.prices.reasoningPerMillion, null);
  assert.equal(catalog.entries[0].default.multipliers.output, '1.5');
  assert.equal(catalog.entries[0].default.source.kind, 'litellm');
  assert.equal(catalog.entries[0].default.source.provider, 'openai');
  assert.equal(catalog.entries[0].default.version, 4);
  assert.equal(catalog.entries[0].variants.length, 1);

  const emptyCatalog = api.normalizeModelPriceCatalogResponse({
    available: true,
    generated_at: '2026-07-23T01:00:00Z',
    last_sync_at: null,
    catalog_version: 0,
    summary: {
      model_count: 0,
      used_model_count: 0,
      unpriced_model_count: 0,
      estimated_cost: '0',
      currency: 'USD',
      truncated: false,
    },
    entries: [],
  });
  assert.equal(emptyCatalog.catalogVersion, 0);

  assert.deepEqual(
    api.normalizeModelPriceCatalogResponse({ available: false, reason: 'disabled' }),
    { available: false, reason: 'disabled' }
  );

  assert.throws(
    () =>
      api.normalizeModelPriceCatalogResponse({
        available: true,
        generated_at: '2026-07-23T01:00:00Z',
        last_sync_at: null,
        catalog_version: 1,
        summary: {
          model_count: 0,
          used_model_count: 0,
          unpriced_model_count: 0,
          estimated_cost: 0,
          currency: 'USD',
          truncated: false,
        },
        entries: [],
      }),
    /model_prices_invalid_response:summary.estimated_cost/
  );
  assert.throws(
    () => api.normalizeModelPriceRule({ ...ruleWire, provider: null }),
    /model_prices_invalid_response:rule.provider/
  );
  assert.throws(
    () => api.normalizeModelPriceRule({ ...ruleWire, version: 0 }),
    /model_prices_invalid_response:rule.version/
  );
  assert.throws(
    () => api.normalizeModelPriceRuleResponse({ ok: true }),
    /model_prices_invalid_response:mutation.rule/
  );
  assert.throws(
    () => api.normalizeModelPriceDeleteResponse({ deleted: true, id: 'other' }, 'rule-1'),
    /model_prices_invalid_response:delete.id/
  );

  const previewWire = {
    preview_id: 'preview-1',
    stale: false,
    expires_at: '2026-07-23T02:00:00Z',
    source_results: [
      {
        source: 'openrouter',
        status: 'ok',
        fetched_count: 10,
        candidate_count: 4,
        rejected_count: 1,
        error: null,
      },
    ],
    candidates: [
      {
        id: 'sol-a',
        target_provider: 'codex',
        target_model: 'gpt-5.6-sol',
        status: 'partial',
        reason: 'unsupported_price_field',
        ambiguity_reason: null,
        rejection_reason: null,
        source: 'litellm',
        source_model_id: 'openai/gpt-5.6-sol',
        rules: [
          syncRuleWire({
            model: 'gpt-5.6-sol',
            serviceTier: 'priority',
            prices: { input_per_million: '10', output_per_million: '60' },
          }),
          syncRuleWire({
            model: 'gpt-5.6-sol',
            contextMinTokens: 272001,
            prices: { input_per_million: '10', output_per_million: '45' },
          }),
          syncRuleWire({
            model: 'gpt-5.6-sol',
            prices: {
              input_per_million: '5',
              output_per_million: '30',
              cache_read_per_million: '0.5',
            },
          }),
        ],
      },
      {
        id: 'sol-b',
        target_provider: 'codex',
        target_model: 'gpt-5.6-sol',
        status: 'ready',
        reason: null,
        ambiguity_reason: null,
        rejection_reason: null,
        source: 'litellm',
        source_model_id: 'openai/gpt-5.6-sol-2026-07-01',
        rules: [
          syncRuleWire({
            model: 'gpt-5.6-sol',
            prices: { input_per_million: '5', output_per_million: '30' },
          }),
        ],
      },
      {
        id: 'conditional-only',
        target_provider: 'codex',
        target_model: 'gpt-conditional',
        status: 'ready',
        reason: null,
        ambiguity_reason: null,
        rejection_reason: null,
        source: 'litellm',
        source_model_id: 'openai/gpt-conditional',
        rules: [
          syncRuleWire({
            model: 'gpt-conditional',
            serviceTier: 'flex',
            prices: { input_per_million: '1', output_per_million: '4' },
          }),
        ],
      },
      {
        id: 'free-partial',
        target_provider: 'codex',
        target_model: 'gpt-free',
        status: 'partial',
        reason: 'unsupported_condition',
        ambiguity_reason: null,
        rejection_reason: null,
        source: 'litellm',
        source_model_id: 'openai/gpt-free',
        rules: [
          syncRuleWire({
            model: 'gpt-free',
            prices: { input_per_million: '0', output_per_million: null },
          }),
        ],
      },
    ],
    coverage: [
      {
        source: 'litellm',
        target_provider: 'codex',
        target_model: 'gpt-5.6-sol',
        requested_models: ['gpt-5.6-sol-high'],
        status: 'ambiguous',
        reason: 'model_ambiguous',
        candidate_ids: ['sol-a', 'sol-b'],
      },
      {
        source: 'litellm',
        target_provider: 'codex',
        target_model: 'gpt-conditional',
        status: 'ready',
        reason: null,
        candidate_ids: ['conditional-only'],
      },
      {
        source: 'litellm',
        target_provider: 'codex',
        target_model: 'gpt-free',
        status: 'partial',
        reason: 'unsupported_condition',
        candidate_ids: ['free-partial'],
      },
      {
        source: 'litellm',
        target_provider: 'codex',
        target_model: 'gpt-missing',
        status: 'unmatched',
        reason: 'model_unmatched',
        candidate_ids: [],
      },
      {
        source: 'litellm',
        target_provider: 'codex',
        target_model: 'gpt-incompatible',
        status: 'provider_incompatible',
        reason: 'provider_incompatible',
        candidate_ids: [],
      },
      {
        source: 'litellm',
        target_provider: 'codex',
        target_model: 'gpt-rejected',
        status: 'rejected',
        reason: 'no_supported_price_rule',
        candidate_ids: [],
      },
    ],
    rejected: [
      {
        source: 'litellm',
        source_model_id: 'vendor/unknown',
        target_model: null,
        reason: 'no_supported_pricing',
      },
    ],
  };
  const preview = api.normalizeModelPriceSyncPreviewResponse(previewWire);
  assert.equal(preview.candidates[0].rules.length, 3);
  assert.equal(preview.rejected[0].reason, 'no_supported_pricing');

  const syncRows = viewModel.buildModelPriceSyncTargetRows(preview);
  assert.equal(syncRows.length, 6);
  const solRow = syncRows.find((row) => row.model === 'gpt-5.6-sol');
  assert.ok(solRow);
  assert.equal(solRow.candidates.length, 2);
  assert.deepEqual(solRow.requestedModels, ['gpt-5.6-sol-high']);
  const solDefault = viewModel.getModelPriceSyncDefaultRule(solRow.candidates[0]);
  assert.ok(solDefault);
  assert.equal(solDefault.prices.inputPerMillion, '5');
  assert.equal(solDefault.prices.cacheReadPerMillion, '0.5');
  assert.equal(solDefault.prices.outputPerMillion, '30');
  assert.equal(viewModel.getModelPriceSyncConditionalRules(solRow.candidates[0]).length, 2);
  const conditionalRow = syncRows.find((row) => row.model === 'gpt-conditional');
  assert.equal(viewModel.getModelPriceSyncDefaultRule(conditionalRow.candidates[0]), null);
  const freeRow = syncRows.find((row) => row.model === 'gpt-free');
  const freeDefault = viewModel.getModelPriceSyncDefaultRule(freeRow.candidates[0]);
  assert.equal(viewModel.getDecimalDisplayKind(freeDefault.prices.inputPerMillion), 'free');
  assert.equal(viewModel.getDecimalDisplayKind(freeDefault.prices.outputPerMillion), 'missing');
  assert.equal(freeRow.coverage[0].status, 'partial');
  assert.equal(syncRows.find((row) => row.model === 'gpt-missing').coverage[0].status, 'unmatched');
  assert.equal(
    syncRows.find((row) => row.model === 'gpt-incompatible').coverage[0].status,
    'provider_incompatible'
  );
  assert.equal(syncRows.find((row) => row.model === 'gpt-rejected').coverage[0].status, 'rejected');
  assert.equal(viewModel.canAcceptSyncCandidate(freeRow.candidates[0]), true);

  const missingRulesCandidate = { ...previewWire.candidates[0] };
  delete missingRulesCandidate.rules;
  assert.throws(
    () =>
      api.normalizeModelPriceSyncPreviewResponse({
        ...previewWire,
        candidates: [missingRulesCandidate],
        coverage: [{ ...previewWire.coverage[0], candidate_ids: ['sol-a'] }],
      }),
    /model_prices_invalid_response:preview.candidates\[0\].rules/
  );
  assert.throws(
    () =>
      api.normalizeModelPriceSyncPreviewResponse({
        ...previewWire,
        candidates: [{ ...previewWire.candidates[0], rules: [] }],
        coverage: [{ ...previewWire.coverage[0], candidate_ids: ['sol-a'] }],
      }),
    /model_prices_invalid_response:preview.candidates\[0\].rules/
  );

  const rows = viewModel.buildModelPriceRows(catalog);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, 'openai\0gpt-5');
  assert.equal(rows[0].entry.variants.length, 1);
  assert.equal(
    viewModel.buildModelPriceRows({ ...catalog, entries: [...catalog.entries, catalog.entries[0]] })
      .length,
    2
  );
  assert.equal(viewModel.filterModelPriceRows(rows, 'used', '').length, 2);
  assert.equal(viewModel.filterModelPriceRows(rows, 'unpriced', '').length, 2);
  assert.equal(viewModel.filterModelPriceRows(rows, 'all', 'openrouter').length, 0);
  assert.equal(viewModel.filterModelPriceRows(rows, 'all', 'litellm').length, 1);
  assert.equal(viewModel.filterModelPriceRows(rows, 'all', 'unknown-alias').length, 1);
  assert.equal(viewModel.getDecimalDisplayKind(null), 'missing');
  assert.equal(viewModel.getDecimalDisplayKind('0.000'), 'free');
  assert.equal(viewModel.getDecimalDisplayKind('0.01'), 'value');

  const selectedA = viewModel.toggleAcceptedCandidate(
    new Set(),
    solRow.candidates[0],
    preview.candidates
  );
  assert.deepEqual([...selectedA], ['sol-a']);
  const selectedB = viewModel.toggleAcceptedCandidate(
    selectedA,
    solRow.candidates[1],
    preview.candidates
  );
  assert.deepEqual([...selectedB], ['sol-b']);

  const draft = viewModel.createModelPriceDraft();
  draft.model = 'manual-model';
  draft.provider = 'openai';
  draft.contextMinTokens = '0';
  draft.contextMaxTokens = '200000';
  draft.inputPerMillion = '0';
  draft.inputMultiplier = '2';
  assert.deepEqual(viewModel.validateModelPriceDraft(draft), {});
  const input = viewModel.buildModelPriceRuleInput(draft);
  assert.equal(input.provider, 'openai');
  assert.equal(input.contextMaxTokens, 200000);
  assert.equal(input.prices.inputPerMillion, '0');
  assert.equal(input.prices.outputPerMillion, null);
  assert.equal(input.multipliers.input, '2');

  const invalidDraft = viewModel.createModelPriceDraft();
  invalidDraft.model = 'bad';
  invalidDraft.inputPerMillion = '-1';
  invalidDraft.contextMinTokens = '200001';
  invalidDraft.contextMaxTokens = '200000';
  invalidDraft.outputMultiplier = '2';
  const invalidErrors = viewModel.validateModelPriceDraft(invalidDraft);
  assert.equal(invalidErrors.provider, 'provider_required');
  assert.equal(invalidErrors.inputPerMillion, 'decimal');
  assert.equal(invalidErrors.contextRange, 'context_range');
  assert.equal(invalidErrors.outputMultiplier, 'base_price_required');

  const calls = [];
  const originalPost = client.apiClient.post;
  const originalPut = client.apiClient.put;
  const originalDelete = client.apiClient.delete;
  try {
    client.apiClient.post = async (url, body) => {
      calls.push({ method: 'POST', url, body });
      return { rule: ruleWire };
    };
    client.apiClient.put = async (url, body) => {
      calls.push({ method: 'PUT', url, body });
      return { rule: { ...ruleWire, version: 5 } };
    };
    client.apiClient.delete = async (url) => {
      calls.push({ method: 'DELETE', url });
      if (url.includes('/entry?')) {
        return {
          deleted: true,
          provider: 'openai',
          model: 'gpt/test',
          deleted_rules: 3,
          catalog_version: 6,
        };
      }
      return { deleted: true, id: 'rule/1' };
    };

    await api.modelPricesApi.createRule(input);
    await api.modelPricesApi.updateRule('rule/1', 4, input);
    await api.modelPricesApi.deleteRule('rule/1', 5);
    const deletedEntry = await api.modelPricesApi.deleteEntry('openai', 'gpt/test', 5);
    assert.equal(deletedEntry.deletedRules, 3);
    assert.equal(deletedEntry.catalogVersion, 6);
  } finally {
    client.apiClient.post = originalPost;
    client.apiClient.put = originalPut;
    client.apiClient.delete = originalDelete;
  }

  assert.equal(calls[0].url, '/usage-analytics/model-prices');
  assert.equal(calls[0].body.prices.fixed_request, null);
  assert.equal(calls[0].body.multipliers.input, '2');
  assert.equal(calls[1].url, '/usage-analytics/model-prices/rule%2F1?expected_version=4');
  assert.equal(calls[1].body.expected_version, 4);
  assert.equal(calls[2].url, '/usage-analytics/model-prices/rule%2F1?expected_version=5');
  assert.equal(
    calls[3].url,
    '/usage-analytics/model-prices/entry?provider=openai&model=gpt%2Ftest&expected_catalog_version=5'
  );
} finally {
  await server.close();
}

console.log('modelPrices tests passed');
