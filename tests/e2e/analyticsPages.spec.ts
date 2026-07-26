import { expect, test, type Page, type Route } from '@playwright/test';

const sectionMeta = {
  available: true,
  generated_at: '2026-07-27T04:00:00Z',
  snapshot_at: '2026-07-27T04:00:00Z',
  filter_digest: 'filter-1',
};

const summary = {
  requests: 2,
  successes: 1,
  failures: 1,
  input_tokens: 100,
  output_tokens: 50,
  reasoning_tokens: 10,
  cache_read_tokens: 20,
  cache_creation_tokens: 0,
  total_tokens: 160,
  average_latency_ms: 240,
  p95_latency_ms: 420,
  average_ttft_ms: 80,
  cache_hits: 1,
};

const monitoringCost = {
  amount: '0.0125',
  currency: 'USD',
  complete_calls: 2,
  partial_calls: 0,
  unpriced_calls: 0,
  free_calls: 0,
  missing_dimensions: {},
  catalog_version: 9,
  truncated: false,
};

const identity = (overrides = {}) => ({
  recorded_id: '',
  display_name: '',
  current_id: '',
  current: false,
  ...overrides,
});

const monitoringRequest = (id: string, minute: string) => ({
  id,
  request_id: `request-${id}`,
  requested_at: `2026-07-27T03:${minute}:00Z`,
  ingested_at: `2026-07-27T03:${minute}:01Z`,
  provider: 'codex',
  executor_type: 'codex',
  resolved_model: 'gpt-5.6',
  requested_model: 'gpt-5.6',
  auth_type: 'oauth',
  auth_index: 'auth-1',
  reasoning_effort: 'high',
  service_tier: '',
  response_service_tier: '',
  generate: false,
  tokens: {
    input: 60,
    output: 30,
    reasoning: 10,
    cached: 20,
    cache_read: 20,
    cache_creation: 0,
    total: 100,
  },
  latency_ms: 240,
  ttft_ms: 80,
  result: id === 'event-2' ? 'failure' : 'success',
  status_code: id === 'event-2' ? 429 : 200,
  failure_category: id === 'event-2' ? 'quota' : '',
  response_headers: { 'x-request-id': [`request-${id}`] },
  identities: {
    credential: identity({
      recorded_id: 'auth-1',
      display_name: 'codex-user@example.com',
      current_id: 'auth-1',
      current: true,
    }),
    api_key: identity(),
    credential_groups: [],
    api_key_groups: [],
    plugin: identity(),
    source: identity(),
    proxy_pool: identity(),
  },
  cost: {
    estimate: true,
    currency: 'USD',
    amount: '0.00625',
    coverage: 'complete',
    missing_dimensions: [],
    rule_id: 'price-1',
    rule_source: 'manual',
    catalog_version: 9,
  },
  has_details: true,
});

const metrics = (calls = 2) => ({
  calls,
  successes: Math.max(0, calls - 1),
  failures: calls ? 1 : 0,
  input_tokens: 100,
  output_tokens: 50,
  reasoning_tokens: 10,
  cached_tokens: 20,
  cache_read_tokens: 20,
  cache_creation_tokens: 0,
  total_tokens: 160,
  cache_hits: 1,
  cache_hit_rate: 0.5,
  average_latency_ms: 240,
  p95_latency_ms: 420,
  average_ttft_ms: 80,
  p95_ttft_ms: 120,
  cost: {
    amount: '0.0125',
    currency: 'USD',
    complete_calls: calls,
    partial_calls: 0,
    unpriced_calls: 0,
    free_calls: 0,
    coverage_rate: 1,
    missing_dimensions: {},
    state: 'ready',
    catalog_version: 9,
  },
});

const analyticsReport = (view: string) => ({
  available: true,
  view,
  generated_at: '2026-07-27T04:00:00Z',
  snapshot_at: '2026-07-27T04:00:00Z',
  from: '2026-07-26T04:00:00Z',
  to: '2026-07-27T04:00:00Z',
  comparison_from: '2026-07-25T04:00:00Z',
  comparison_to: '2026-07-26T04:00:00Z',
  granularity: 'hour',
  timezone: 'Asia/Shanghai',
  data_source: 'mixed',
  fallback_reason: '',
  catalog_version: 9,
  rollup: {
    watermark: '2026-07-27T03:00:00Z',
    last_success_at: '2026-07-27T04:00:00Z',
    lag: 0,
    dirty_hours: 0,
    catalog_version: 9,
    worker: true,
    backfill_complete: true,
    degraded: false,
  },
  percentiles: { method: 'histogram', distribution_version: 1, approximate: true },
  credential_catalog: [],
  credential_inventory_id: 'inventory-1',
  credential_revision: 1,
  summary: view === 'overview' ? metrics() : null,
  comparison: view === 'overview' ? metrics(1) : null,
  series: view === 'trends' ? [{ start: '2026-07-27T03:00:00Z', metrics: metrics() }] : [],
  comparison_series:
    view === 'trends' ? [{ start: '2026-07-26T03:00:00Z', metrics: metrics(1) }] : [],
  rankings: [
    'models',
    'providers',
    'credentials',
    'api-keys',
    'credential-groups',
    'api-key-groups',
  ].includes(view)
    ? [
        {
          identity: {
            recorded_id: 'codex\u001fgpt-5.6',
            display_name: 'gpt-5.6',
            provider: 'codex',
            resolved_model: 'gpt-5.6',
            requested_model: 'gpt-5.6',
            current: false,
            current_id: '',
          },
          metrics: metrics(),
          comparison: metrics(1),
        },
      ]
    : [],
  heatmap:
    view === 'heatmap'
      ? [{ iso_weekday: 1, hour: 3, metrics: metrics(), comparison: metrics(1) }]
      : [],
  anomalies: [],
});

interface MockState {
  calls: Record<string, number>;
  failFacets: boolean;
  staleRollup: boolean;
}

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const installMockAPI = async (page: Page, state: MockState) => {
  await page.route('**/v0/management/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    state.calls[path] = (state.calls[path] ?? 0) + 1;
    if (path === '/config') return routeJSON(route, {});
    if (path === '/nodes') return routeJSON(route, { error: 'not found' }, 404);
    if (path === '/auth-files') {
      return routeJSON(route, { files: [], revision: 1, inventory_id: 'inventory-1' });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    if (path === '/usage-analytics/monitoring/summary') {
      return routeJSON(route, { ...sectionMeta, summary, cost: monitoringCost });
    }
    if (path === '/usage-analytics/monitoring/facets') {
      if (state.failFacets) return routeJSON(route, { error: 'facet failure' }, 500);
      return routeJSON(route, {
        ...sectionMeta,
        facets: {
          providers: [{ value: 'codex', count: 2 }],
          resolved_models: [{ value: 'gpt-5.6', count: 2 }],
          requested_models: [{ value: 'gpt-5.6', count: 2 }],
          failure_categories: [{ value: 'quota', count: 1 }],
        },
      });
    }
    if (path === '/usage-analytics/monitoring/identities') {
      return routeJSON(route, {
        ...sectionMeta,
        credentials: [],
        credential_catalog: [],
        credential_inventory_id: 'inventory-1',
        credential_revision: 1,
        api_keys: [],
      });
    }
    if (path === '/usage-analytics/monitoring/requests') {
      const cursor = url.searchParams.get('cursor');
      return routeJSON(route, {
        ...sectionMeta,
        requests: cursor
          ? [monitoringRequest('event-2', '58')]
          : [monitoringRequest('event-1', '59')],
        next_cursor: cursor ? '' : 'cursor-2',
      });
    }
    if (path.startsWith('/usage-analytics/monitoring/requests/')) {
      const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
      return routeJSON(route, { available: true, request: monitoringRequest(id, '59') });
    }
    if (path.startsWith('/usage-analytics/reports/')) {
      return routeJSON(route, analyticsReport(path.slice(path.lastIndexOf('/') + 1)));
    }
    if (path === '/usage-analytics/health') {
      return routeJSON(route, {
        available: true,
        degraded: state.staleRollup,
        stale: false,
        schema_ready: true,
        rollup: {
          ...analyticsReport('overview').rollup,
          dirty_hours: state.staleRollup ? 2 : 0,
          degraded: state.staleRollup,
        },
      });
    }
    return routeJSON(route, {});
  });
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('request monitoring isolates sections, paging, polling, and partial failures', async ({
  page,
}, testInfo) => {
  const state: MockState = { calls: {}, failFacets: false, staleRollup: false };
  await installMockAPI(page, state);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/monitoring';
  });
  await expect(page.getByRole('heading', { name: /请求监控|Request Monitoring/ })).toBeVisible();
  await expect(page.getByText('gpt-5.6').first()).toBeVisible();

  await page.waitForTimeout(500);
  const beforeRapid = state.calls['/usage-analytics/monitoring/summary'];
  const search = page.locator(
    'input[placeholder*="搜索请求"], input[placeholder*="Search request"]'
  );
  await search.fill('g');
  await search.fill('gpt');
  await search.fill('gpt-5.6');
  await expect.poll(() => state.calls['/usage-analytics/monitoring/summary']).toBe(beforeRapid + 1);
  await page.waitForTimeout(750);

  const beforePaging = {
    summary: state.calls['/usage-analytics/monitoring/summary'],
    facets: state.calls['/usage-analytics/monitoring/facets'],
    identities: state.calls['/usage-analytics/monitoring/identities'],
    requests: state.calls['/usage-analytics/monitoring/requests'],
  };
  await page.getByRole('button', { name: /加载更多|Load more/ }).click();
  await expect
    .poll(() => state.calls['/usage-analytics/monitoring/requests'])
    .toBe(beforePaging.requests + 1);
  expect(state.calls['/usage-analytics/monitoring/summary']).toBe(beforePaging.summary);
  expect(state.calls['/usage-analytics/monitoring/facets']).toBe(beforePaging.facets);
  expect(state.calls['/usage-analytics/monitoring/identities']).toBe(beforePaging.identities);

  state.failFacets = true;
  await page
    .getByRole('button', { name: /^(刷新|Refresh)$/ })
    .first()
    .click();
  await expect(page.getByText(/facet failure/)).toBeVisible();

  await page.clock.install();
  const autoRefresh = page.getByRole('combobox', { name: /自动刷新间隔|Auto refresh interval/ });
  await autoRefresh.click();
  await page.getByRole('option', { name: /每 10 秒|Every 10 seconds/ }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenCount = state.calls['/usage-analytics/monitoring/summary'];
  await page.clock.fastForward(20_000);
  expect(state.calls['/usage-analytics/monitoring/summary']).toBe(hiddenCount);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(10_000);
  await expect
    .poll(() => state.calls['/usage-analytics/monitoring/summary'])
    .toBeGreaterThan(hiddenCount);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: testInfo.outputPath('request-monitoring.png'), fullPage: true });
});

test('usage analytics keeps overview independent and exposes stale rollups', async ({
  page,
}, testInfo) => {
  const state: MockState = { calls: {}, failFacets: false, staleRollup: true };
  await installMockAPI(page, state);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/usage-analytics';
  });
  await expect(
    page.getByRole('heading', { name: /用量与成本分析|Usage & Cost Analytics/ })
  ).toBeVisible();
  await expect(
    page.getByText(/小时汇总正在追赶进度|Hourly aggregates are catching up/)
  ).toBeVisible();

  const overviewCalls = state.calls['/usage-analytics/reports/overview'];
  await page.getByRole('button', { name: /模型|Models/ }).click();
  await expect(page.getByText('gpt-5.6').first()).toBeVisible();
  expect(state.calls['/usage-analytics/reports/overview']).toBe(overviewCalls);
  await page.getByRole('button', { name: /7 天|7 days/ }).click();
  await expect
    .poll(() => state.calls['/usage-analytics/reports/overview'])
    .toBeGreaterThan(overviewCalls);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: testInfo.outputPath('usage-analytics.png'), fullPage: true });
});
