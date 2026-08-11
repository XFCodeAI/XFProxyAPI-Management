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
  importSessionStatus?: 'receiving' | 'processing' | 'cancelled';
  syncSources?: string[];
}

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const monitoringImportSession = (status: 'receiving' | 'processing' | 'cancelled') => ({
  id: '0123456789abcdef0123456789abcdef',
  filename: 'history.jsonl',
  status,
  size_bytes: 10,
  received_bytes: 10,
  chunk_size_bytes: 4,
  created_at: '2026-08-11T00:00:00Z',
  updated_at: '2026-08-11T00:00:01Z',
  expires_at: '2026-08-12T00:00:00Z',
  retryable: status === 'receiving',
  error_code: '',
  error: '',
  result: null,
});

const emptyModelPriceCatalog = {
  available: true,
  generated_at: '2026-08-11T00:00:00Z',
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
};

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
    if (path === '/usage-analytics/model-prices') {
      return routeJSON(route, emptyModelPriceCatalog);
    }
    if (path === '/usage-analytics/model-prices/sync/preview') {
      const payload = route.request().postDataJSON() as { sources?: unknown };
      state.syncSources = Array.isArray(payload.sources)
        ? payload.sources.map((source) => String(source))
        : [];
      return routeJSON(route, {
        preview_id: 'preview-models-dev',
        stale: false,
        expires_at: '2026-08-11T01:00:00Z',
        source_results: [
          {
            source: 'models.dev',
            status: 'ok',
            fetched_count: 0,
            candidate_count: 0,
            rejected_count: 0,
            error: null,
          },
        ],
        candidates: [],
        coverage: [],
        rejected: [],
      });
    }
    if (path === '/usage-analytics/monitoring/import-sessions') {
      state.importSessionStatus = 'receiving';
      return routeJSON(route, monitoringImportSession(state.importSessionStatus));
    }
    if (
      path ===
      '/usage-analytics/monitoring/import-sessions/0123456789abcdef0123456789abcdef/complete'
    ) {
      state.importSessionStatus = 'processing';
      return routeJSON(route, monitoringImportSession(state.importSessionStatus));
    }
    if (path === '/usage-analytics/monitoring/import-sessions/0123456789abcdef0123456789abcdef') {
      if (route.request().method() === 'DELETE') state.importSessionStatus = 'cancelled';
      return routeJSON(route, monitoringImportSession(state.importSessionStatus ?? 'processing'));
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
  expect(state.calls['/usage-analytics/monitoring/identities'] ?? 0).toBe(0);

  const requestsBeforeIdentityTab = state.calls['/usage-analytics/monitoring/requests'];
  await page.getByRole('tab', { name: /凭证|Credentials/ }).click();
  await expect
    .poll(() => state.calls['/usage-analytics/monitoring/identities'] ?? 0)
    .toBeGreaterThan(0);
  expect(state.calls['/usage-analytics/monitoring/requests']).toBe(requestsBeforeIdentityTab);
  await page.getByRole('tab', { name: /请求|Requests/ }).click();
  await expect
    .poll(() => state.calls['/usage-analytics/monitoring/requests'])
    .toBeGreaterThan(requestsBeforeIdentityTab);

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

test('monitoring import pauses, resumes, and cancels a server session', async ({ page }) => {
  const state: MockState = { calls: {}, failFacets: false, staleRollup: false };
  await installMockAPI(page, state);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/monitoring';
  });
  await expect(page.getByRole('heading', { name: /请求监控|Request Monitoring/ })).toBeVisible();

  await page.locator('input[type="file"][accept*=".jsonl"]').setInputFiles({
    name: 'history.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('0123456789'),
  });
  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toContainText(/导入监控记录|Import monitoring records/i);
  await confirmation.getByRole('button', { name: /导入 JSONL|Import JSONL/i }).click();

  const progress = page.getByRole('dialog');
  await expect(progress).toContainText(/监控记录导入进度|Monitoring import progress/i);
  await expect(progress.getByRole('button', { name: /暂停|Pause/i })).toBeVisible();
  await progress.getByRole('button', { name: /暂停|Pause/i }).click();
  await expect(progress).toContainText(/导入已暂停|Import paused/i);

  await progress.getByRole('button', { name: /继续|Resume/i }).click();
  await expect(progress).toContainText(/正在写入记录|Processing/i);
  await progress.getByRole('button', { name: /暂停|Pause/i }).click();
  await expect(progress).toContainText(/导入已暂停|Import paused/i);
  await progress.getByRole('button', { name: /取消导入|Cancel import/i }).click();
  await expect(progress).toContainText(/导入已取消|Import cancelled/i);
  expect(state.importSessionStatus).toBe('cancelled');
  expect(
    await page.evaluate(() => localStorage.getItem('xfproxyapi:monitoring-import-sessions:v1'))
  ).toBeNull();
});

test('model price sync sends models.dev first from the existing XF page', async ({
  page,
}, testInfo) => {
  const state: MockState = { calls: {}, failFacets: false, staleRollup: false };
  await installMockAPI(page, state);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/model-prices';
  });
  await expect(page.getByRole('heading', { name: /模型价格|Model Prices/i })).toBeVisible();

  await page.getByRole('button', { name: /同步来源|Sync sources/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('models.dev')).toBeChecked();
  await dialog.getByRole('button', { name: /生成预览|Generate preview/i }).click();
  await expect(dialog).toContainText('preview-models-dev');
  expect(state.syncSources).toEqual(['models.dev', 'litellm', 'openrouter']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: testInfo.outputPath('model-price-sync.png'), fullPage: true });
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
