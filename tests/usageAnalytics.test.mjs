import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const metrics = (overrides = {}) => ({
  calls: 4,
  successes: 3,
  failures: 1,
  input_tokens: 100,
  output_tokens: 40,
  reasoning_tokens: 10,
  cached_tokens: 20,
  cache_read_tokens: 20,
  cache_creation_tokens: 0,
  total_tokens: 150,
  cache_hits: 2,
  cache_hit_rate: 0.5,
  average_latency_ms: 250,
  p95_latency_ms: 500,
  average_ttft_ms: 80,
  p95_ttft_ms: 120,
  cost: {
    amount: '0.0125',
    currency: 'USD',
    complete_calls: 3,
    partial_calls: 0,
    unpriced_calls: 1,
    free_calls: 0,
    coverage_rate: 0.75,
    missing_dimensions: { output: 1 },
  },
  ...overrides,
});

const reportWire = {
  available: true,
  view: 'models',
  generated_at: '2026-07-23T04:00:00Z',
  snapshot_at: '2026-07-23T04:00:00Z',
  from: '2026-07-22T04:00:00Z',
  to: '2026-07-23T04:00:00Z',
  comparison_from: '2026-07-21T04:00:00Z',
  comparison_to: '2026-07-22T04:00:00Z',
  granularity: 'hour',
  timezone: 'Asia/Shanghai',
  data_source: 'mixed',
  fallback_reason: '',
  catalog_version: 9,
  summary: null,
  comparison: null,
  series: [],
  comparison_series: [],
  rankings: [
    {
      identity: {
        recorded_id: 'codex\u001fgpt-5.6\u001fgpt-5.6',
        display_name: 'gpt-5.6',
        provider: 'codex',
        resolved_model: 'gpt-5.6',
        requested_model: 'gpt-5.6',
        current: false,
        current_id: '',
      },
      metrics: metrics(),
      comparison: metrics({ calls: 2, successes: 2, failures: 0 }),
    },
  ],
  heatmap: [],
  anomalies: [],
};

try {
  const api = await server.ssrLoadModule('/src/services/api/usageAnalytics.ts');
  const client = await server.ssrLoadModule('/src/services/api/client.ts');
  const viewModel = await server.ssrLoadModule('/src/features/usageAnalytics/viewModel.ts');
  const monitoringViewModel = await server.ssrLoadModule(
    '/src/features/requestMonitoring/viewModel.ts'
  );

  const normalized = api.normalizeAnalyticsReport(reportWire);
  assert.equal(normalized.view, 'models');
  assert.equal(normalized.rankings[0].metrics.cost.coverageRate, 0.75);
  assert.deepEqual(normalized.series, []);
  assert.equal(normalized.summary, null);

  assert.throws(
    () => api.normalizeAnalyticsReport({ ...reportWire, series: null }),
    /usage_analytics_invalid_response:analytics.series/
  );
  assert.throws(
    () =>
      api.normalizeAnalyticsReport({
        ...reportWire,
        rankings: [
          {
            ...reportWire.rankings[0],
            metrics: metrics({ cache_hit_rate: 1.2 }),
          },
        ],
      }),
    /usage_analytics_invalid_response:analytics.rankings\[0\].metrics.cache_hit_rate/
  );

  const query = new URLSearchParams(
    api.buildAnalyticsQuery({
      from: reportWire.from,
      to: reportWire.to,
      provider: 'codex',
      credentialGroupId: 'plus',
      granularity: 'day',
      timezone: 'Asia/Shanghai',
      limit: 25,
    })
  );
  assert.equal(query.get('provider'), 'codex');
  assert.equal(query.get('credential_group_id'), 'plus');
  assert.equal(query.get('granularity'), 'day');
  assert.equal(query.get('timezone'), 'Asia/Shanghai');
  assert.equal(query.get('limit'), '25');

  const calls = [];
  const originalGet = client.apiClient.get;
  try {
    client.apiClient.get = async (url) => {
      calls.push(url);
      return reportWire;
    };
    const response = await api.usageAnalyticsApi.get('models', {
      from: reportWire.from,
      to: reportWire.to,
      granularity: 'hour',
      timezone: 'UTC',
    });
    assert.equal(response.rankings.length, 1);
    assert.match(calls[0], /^\/usage-analytics\/reports\/models\?/);
  } finally {
    client.apiClient.get = originalGet;
  }

  const filters = {
    ...monitoringViewModel.EMPTY_MONITORING_FILTERS,
    provider: 'codex',
    cache: 'hit',
  };
  const analyticsQuery = viewModel.buildAnalyticsRequestQuery(
    { from: reportWire.from, to: reportWire.to },
    filters,
    'hour',
    'UTC'
  );
  assert.equal(analyticsQuery.provider, 'codex');
  assert.equal(analyticsQuery.cache, 'hit');
  assert.equal(analyticsQuery.cursor, undefined);
  assert.equal(analyticsQuery.limit, 25);

  assert.equal(viewModel.analyticsViewForTab('groups', 'api-key-groups'), 'api-key-groups');
  assert.deepEqual(viewModel.analyticsRankingFilters('models', normalized.rankings[0].identity), {
    provider: 'codex',
    resolvedModel: 'gpt-5.6',
    requestedModel: 'gpt-5.6',
  });
  assert.deepEqual(viewModel.analyticsAnomalyRange('2026-07-23T00:00:00Z', 'hour'), {
    from: '2026-07-23T00:00:00.000Z',
    to: '2026-07-23T01:00:00.000Z',
  });
  assert.equal(viewModel.analyticsAnomalyRange('invalid', 'hour'), null);
  assert.equal(viewModel.analyticsSuccessRate(normalized.rankings[0].metrics), 0.75);
  assert.equal(viewModel.analyticsDelta(4, 2), 1);
  assert.equal(viewModel.analyticsDelta(4, 0), null);
  assert.equal(viewModel.analyticsMetricValue(normalized.rankings[0].metrics, 'cost'), 0.0125);
  assert.equal(api.isAnalyticsCapabilityUnavailable({ status: 501 }), true);
  assert.equal(api.isAnalyticsCapabilityUnavailable({ status: 500 }), false);
} finally {
  await server.close();
}
