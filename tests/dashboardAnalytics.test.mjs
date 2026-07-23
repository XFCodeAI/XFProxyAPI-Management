import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const metrics = {
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
};

const zeroMetrics = {
  ...Object.fromEntries(Object.keys(metrics).filter((key) => key !== 'cost').map((key) => [key, 0])),
  cost: {
    amount: '0',
    currency: 'USD',
    complete_calls: 0,
    partial_calls: 0,
    unpriced_calls: 0,
    free_calls: 0,
    coverage_rate: 0,
    missing_dimensions: {},
  },
};

const identity = {
  recorded_id: 'codex\u001fgpt-5.6\u001fgpt-5.6',
  display_name: 'gpt-5.6',
  provider: 'codex',
  resolved_model: 'gpt-5.6',
  requested_model: 'gpt-5.6',
  current: false,
  current_id: '',
};

const dashboardWire = {
  available: true,
  generated_at: '2026-07-23T04:00:00Z',
  snapshot_at: '2026-07-23T04:00:00Z',
  timezone: 'Asia/Shanghai',
  today_from: '2026-07-22T16:00:00Z',
  today: metrics,
  rolling: {
    window_minutes: 15,
    calls: 3,
    tokens: 120,
    rpm: 0.2,
    tpm: 8,
  },
  timeline: [
    {
      start: '2026-07-23T03:00:00Z',
      end: '2026-07-23T04:00:00Z',
      metrics,
    },
  ],
  top_models: [{ identity, metrics, comparison: zeroMetrics }],
  collector: {
    available: true,
    accepted: 4,
    persisted: 4,
    dropped: 0,
    sql_errors: 0,
    depth: 0,
    capacity: 1024,
    lag: 1000,
    last_success_at: '2026-07-23T03:59:59Z',
    last_error_at: '',
    schema_ready: true,
    degraded: false,
    stale: false,
    started: true,
    closed: false,
  },
  recent_failures: [
    {
      id: 'event-1',
      request_id: 'request-1',
      requested_at: '2026-07-23T03:30:00Z',
      provider: 'codex',
      resolved_model: 'gpt-5.6',
      requested_model: 'gpt-5.6',
      status_code: 502,
      failure_category: 'upstream',
      latency_ms: 450,
      identities: {
        credential: { display_name: 'codex-account', recorded_id: 'credential-1' },
      },
      cost: { amount: '0', currency: 'USD', coverage: 'unpriced' },
    },
  ],
};

try {
  const api = await server.ssrLoadModule('/src/services/api/dashboardAnalytics.ts');
  const client = await server.ssrLoadModule('/src/services/api/client.ts');
  const viewModel = await server.ssrLoadModule('/src/features/dashboard/viewModel.ts');

  const normalized = api.normalizeDashboardAnalytics(dashboardWire);
  assert.equal(normalized.today.cost.coverageRate, 0.75);
  assert.equal(normalized.rolling.rpm, 0.2);
  assert.equal(normalized.collector.capacity, 1024);
  assert.equal(normalized.topModels[0].identity.resolvedModel, 'gpt-5.6');
  assert.equal(normalized.recentFailures[0].requestId, 'request-1');

  assert.throws(
    () => api.normalizeDashboardAnalytics({ ...dashboardWire, recent_failures: null }),
    /dashboard_analytics_invalid_response:dashboard.recent_failures/
  );
  assert.throws(
    () => api.normalizeDashboardAnalytics({ ...dashboardWire, rolling: { ...dashboardWire.rolling, rpm: -1 } }),
    /dashboard_analytics_invalid_response:dashboard.rolling.rpm/
  );
  assert.throws(
    () => api.normalizeDashboardAnalytics({ ...dashboardWire, collector: { ...dashboardWire.collector, stale: 'false' } }),
    /dashboard_analytics_invalid_response:dashboard.collector.stale/
  );

  const calls = [];
  const originalGet = client.apiClient.get;
  try {
    client.apiClient.get = async (url) => {
      calls.push(url);
      return dashboardWire;
    };
    const response = await api.dashboardAnalyticsApi.get('Asia/Shanghai');
    assert.equal(response.today.calls, 4);
    assert.equal(calls[0], '/usage-analytics/dashboard?timezone=Asia%2FShanghai');
  } finally {
    client.apiClient.get = originalGet;
  }

  const analyticsHref = new URL(
    viewModel.dashboardAnalyticsHref(normalized, 'models'),
    'http://localhost'
  );
  assert.equal(analyticsHref.pathname, '/usage-analytics');
  assert.equal(analyticsHref.searchParams.get('view'), 'models');
  assert.equal(analyticsHref.searchParams.get('from'), normalized.todayFrom);
  assert.equal(analyticsHref.searchParams.get('timezone'), 'Asia/Shanghai');

  const todayHref = new URL(
    viewModel.dashboardTodayMonitoringHref(normalized, { result: 'failure' }),
    'http://localhost'
  );
  assert.equal(todayHref.pathname, '/monitoring');
  assert.equal(todayHref.searchParams.get('result'), 'failure');
  assert.equal(todayHref.searchParams.get('from'), normalized.todayFrom);

  const rollingHref = new URL(viewModel.dashboardRollingMonitoringHref(normalized), 'http://localhost');
  assert.equal(rollingHref.searchParams.get('from'), '2026-07-23T03:45:00.000Z');
  assert.equal(rollingHref.searchParams.get('to'), '2026-07-23T04:00:00.000Z');

  const modelHref = new URL(
    viewModel.dashboardModelMonitoringHref(normalized, normalized.topModels[0].identity),
    'http://localhost'
  );
  assert.equal(modelHref.searchParams.get('provider'), 'codex');
  assert.equal(modelHref.searchParams.get('resolved_model'), 'gpt-5.6');
  assert.equal(modelHref.searchParams.get('requested_model'), 'gpt-5.6');

  const failureHref = new URL(
    viewModel.dashboardFailureMonitoringHref(normalized.recentFailures[0]),
    'http://localhost'
  );
  assert.equal(failureHref.searchParams.get('request_id'), 'request-1');
  assert.equal(failureHref.searchParams.get('result'), 'failure');
  assert.equal(failureHref.searchParams.get('from'), '2026-07-23T03:29:00.000Z');
  assert.equal(failureHref.searchParams.get('to'), '2026-07-23T03:31:00.000Z');

  assert.equal(api.isDashboardAnalyticsUnavailable({ status: 501 }), true);
  assert.equal(api.isDashboardAnalyticsUnavailable({ status: 503 }), false);
} finally {
  await server.close();
}
