import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: status === 304 ? undefined : JSON.stringify(body),
  });

const providerSections: Record<string, unknown[]> = {
  'gemini-api-key': [],
  'codex-api-key': [],
  'xai-api-key': [],
  'claude-api-key': [
    {
      name: 'Kimi Anthropic',
      'api-key': 'sk-kimi-claude',
      'base-url': 'https://api.moonshot.cn/anthropic',
      'concurrency-mode': 'independent',
      'max-concurrency': 7,
    },
  ],
  'vertex-api-key': [],
  'openai-compatibility': [
    {
      name: 'Shared Gateway',
      'base-url': 'https://gateway.example/v1',
      'concurrency-mode': 'independent',
      'max-concurrency': 8,
      'api-key-entries': [
        {
          name: 'primary',
          'api-key': 'sk-provider-demo',
          'auth-index': 'runtime-auth-index',
          'concurrency-mode': 'independent',
          'max-concurrency': 5,
        },
      ],
      models: [{ name: 'gpt-5.6' }],
      'runtime-status': {
        connectivity: 'reachable',
        scheduling: 'ready',
        ready: true,
      },
    },
    {
      name: 'kimi',
      'base-url': 'https://api.moonshot.cn/v1',
      'concurrency-mode': 'independent',
      'max-concurrency': 30,
      'api-key-entries': [
        {
          name: 'Kimi OpenAI',
          'api-key': 'sk-kimi-openai',
          'concurrency-mode': 'independent',
          'max-concurrency': 4,
        },
      ],
    },
  ],
};

const installMockAPI = async (page: Page) => {
  const sections: Record<string, unknown[]> = structuredClone(providerSections);
  const writes: Record<string, unknown[]> = {};
  let observationRevision = 1;
  let supplierInFlight = 3;
  let supplierQueued = 2;
  let credentialInFlight = 2;
  let credentialQueued = 1;
  let defaultMaxConcurrency = 9;

  const runtimeSnapshot = () => ({
    observation_id: 'runtime-e2e',
    revision: observationRevision,
    observed_at: '2026-08-03T12:00:00Z',
    admission_scope: 'process-local',
    resources: [
      {
        id: 'supplier-shared',
        scope: 'supplier',
        provider: 'openai-compatibility',
        name: 'Shared Gateway',
        in_flight: supplierInFlight,
        maximum: 8,
        queued: supplierQueued,
        success: 100,
        failed: 20,
        recent_requests: [{ success: 10, failed: 2 }],
      },
      {
        id: 'credential-shared',
        auth_index: 'runtime-auth-index',
        scope: 'credential',
        parent_id: 'supplier-shared',
        supplier_id: 'supplier-shared',
        provider: 'openai-compatibility',
        name: 'primary',
        in_flight: credentialInFlight,
        maximum: 5,
        queued: credentialQueued,
        success: 11,
        failed: 3,
        recent_requests: [{ success: 4, failed: 1 }],
      },
      {
        id: 'credential-oauth',
        scope: 'credential',
        parent_id: 'credential-oauth',
        supplier_id: 'credential-oauth',
        provider: 'codex',
        name: 'codex-user@example.com.json',
        in_flight: credentialInFlight,
        maximum: defaultMaxConcurrency,
        queued: credentialQueued,
        success: 7,
        failed: 2,
        recent_requests: [{ success: 3, failed: 1 }],
      },
    ],
    queue: { waiting: supplierQueued, maximum: 128, closed: false },
    total_providers: 1,
    total_suppliers: 1,
    total_credentials: 2,
    truncated: false,
  });

  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config') return routeJSON(route, sections);
    if (path === '/credential-concurrency') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { 'default-max-concurrency'?: number };
        defaultMaxConcurrency = body['default-max-concurrency'] ?? defaultMaxConcurrency;
        observationRevision += 1;
        return routeJSON(route, { status: 'ok' });
      }
      return routeJSON(route, { 'default-max-concurrency': defaultMaxConcurrency });
    }
    if (path === '/runtime-observations') {
      const etag = `"runtime-${observationRevision}"`;
      if (request.headers()['if-none-match'] === etag) {
        return routeJSON(route, null, 304, { ETag: etag });
      }
      return routeJSON(route, runtimeSnapshot(), 200, { ETag: etag });
    }
    if (path === '/runtime-observations/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    }
    if (path === '/auth-files/download') {
      return routeJSON(route, {
        type: 'codex',
        email: 'user@example.com',
        concurrency_mode: 'inherit',
        max_concurrency: 0,
        status_message: 'upstream quota exhausted',
      });
    }
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [
          {
            id: 'credential-oauth',
            name: 'codex-user@example.com.json',
            type: 'codex',
            provider: 'codex',
            auth_index: 'oauth-auth-index',
            concurrency_mode: 'inherit',
            max_concurrency: 0,
            unavailable: true,
            status: 'error',
            status_message: 'upstream quota exhausted',
            success: 1,
            failed: 1,
            size: 512,
            modtime: '2026-08-03T10:00:00Z',
          },
        ],
        total: 1,
        revision: 1,
        inventory_id: 'inventory-runtime-e2e',
      });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    }
    if (path === '/api-key-usage') return routeJSON(route, {});
    if (path === '/supplier-billing-probes') {
      return routeJSON(route, { provider_name: '', entries: [] });
    }
    if (path === '/plugins') return routeJSON(route, { plugins: [] });
    const section = path.slice(1);
    if (section in sections) {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as unknown;
        if (Array.isArray(body)) {
          sections[section] = body;
          writes[section] = body;
        }
        return routeJSON(route, { status: 'ok' });
      }
      return routeJSON(route, { [section]: sections[section] });
    }
    return routeJSON(route, {});
  });

  return {
    releaseCapacity: () => {
      observationRevision += 1;
      supplierInFlight = 1;
      supplierQueued = 0;
      credentialInFlight = 1;
      credentialQueued = 0;
    },
    defaultMaxConcurrency: () => defaultMaxConcurrency,
    writes,
  };
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('live concurrency overlays preserve diagnostics and editor state', async ({
  page,
}, testInfo) => {
  const runtime = await installMockAPI(page);
  await login(page);

  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'openaiCompatibility', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });
  await expect(page.getByText('Shared Gateway', { exact: true })).toBeVisible();
  const globalConcurrencyControl = page.getByRole('region', {
    name: /全局逐资源默认并发|Global per-resource concurrency/i,
  });
  const globalConcurrencyInput = globalConcurrencyControl.getByRole('spinbutton');
  await expect(globalConcurrencyInput).toHaveValue('9');
  await globalConcurrencyInput.fill('10');
  await globalConcurrencyControl.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await expect.poll(runtime.defaultMaxConcurrency).toBe(10);
  await expect(page.getByLabel(/并发占用 3 \/ 8|3 of 8 concurrent requests/i)).toBeVisible();
  await expect(page.getByTitle(/2 个请求排队中|2 requests queued/i)).toBeVisible();

  await page
    .getByRole('button', { name: /^(编辑|Edit)$/ })
    .first()
    .click();
  const providerDialog = page.getByRole('dialog');
  await expect(
    providerDialog.getByRole('button', { name: /独立限制|Independent/i }).first()
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(providerDialog.getByLabel(/独立上限|Independent limit/i).first()).toHaveValue('8');
  await providerDialog
    .getByRole('button', { name: /密钥 #1|Key #1/i })
    .first()
    .click();
  await expect(providerDialog.getByLabel(/独立上限|Independent limit/i).nth(1)).toHaveValue('5');
  await providerDialog.getByRole('button', { name: /^(取消|Cancel)$/ }).click();

  await page.getByRole('button', { name: /^Kimi\b/i }).click();
  await page
    .getByRole('button', { name: /^(编辑|Edit)$/ })
    .first()
    .click();
  const sponsorDialog = page.getByRole('dialog');
  await sponsorDialog
    .getByRole('button', { name: /分组 Key #1|Grouped key #1/i })
    .first()
    .click();
  const supplierLimit = sponsorDialog.getByLabel(/独立上限|Independent limit/i).nth(0);
  const keyLimit = sponsorDialog.getByLabel(/独立上限|Independent limit/i).nth(1);
  await expect(supplierLimit).toHaveValue('30');
  await expect(keyLimit).toHaveValue('4');
  await supplierLimit.fill('31');
  await keyLimit.fill('5');

  await sponsorDialog
    .getByRole('button', { name: /分组 Key #2|Grouped key #2/i })
    .first()
    .click();
  const claudeLimit = sponsorDialog.locator(
    'input[id$="-group-1-supplier-concurrency-value"]'
  );
  await expect(claudeLimit).toHaveValue('7');
  await claudeLimit.fill('8');
  await page.screenshot({
    path: testInfo.outputPath(`supplier-concurrency-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await sponsorDialog.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await expect.poll(() => runtime.writes['openai-compatibility']?.length ?? 0).toBeGreaterThan(0);
  await expect.poll(() => runtime.writes['claude-api-key']?.length ?? 0).toBeGreaterThan(0);
  const writtenOpenAI = runtime.writes['openai-compatibility'].find(
    (entry) => (entry as { name?: string }).name === 'kimi'
  ) as {
    'concurrency-mode': string;
    'max-concurrency': number;
    'api-key-entries': Array<{ 'concurrency-mode': string; 'max-concurrency': number }>;
  };
  const writtenClaude = runtime.writes['claude-api-key'].find(
    (entry) =>
      (entry as { 'base-url'?: string })['base-url'] === 'https://api.moonshot.cn/anthropic'
  ) as { 'concurrency-mode': string; 'max-concurrency': number };
  expect(writtenOpenAI['concurrency-mode']).toBe('independent');
  expect(writtenOpenAI['max-concurrency']).toBe(31);
  expect(writtenOpenAI['api-key-entries'][0]['concurrency-mode']).toBe('independent');
  expect(writtenOpenAI['api-key-entries'][0]['max-concurrency']).toBe(5);
  expect(writtenClaude['concurrency-mode']).toBe('independent');
  expect(writtenClaude['max-concurrency']).toBe(8);

  await page.evaluate(() => {
    window.location.hash = '/quota';
  });
  await expect(page.getByText('codex-user@example.com.json', { exact: true })).toBeVisible();
  await expect(page.getByText('upstream quota exhausted', { exact: true })).toBeVisible();
  await expect(page.locator('[data-auth-id="credential-oauth"]')).toHaveAttribute(
    'data-runtime-id',
    'credential-oauth'
  );
  const credentialCapacity = page.getByLabel(/并发占用 2 \/ 10|2 of 10 concurrent requests/i);
  await expect(credentialCapacity).toBeVisible();
  await expect(credentialCapacity).toHaveAccessibleName(/跟随全局|Global default/i);
  await expect(page.getByTitle(/1 个请求排队中|1 request queued/i)).toBeVisible();

  await page
    .getByRole('button', { name: /认证文件详情 \/ 编辑|Credential details \/ edit/i })
    .click();
  const credentialDialog = page.getByRole('dialog');
  const maxConcurrencyInput = credentialDialog.getByLabel(/独立上限|Independent limit/i);
  await expect(
    credentialDialog.getByRole('button', { name: /跟随全局|Follow global/i })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(maxConcurrencyInput).toBeDisabled();
  await credentialDialog.getByRole('button', { name: /独立限制|Independent/i }).click();
  await maxConcurrencyInput.fill('6');

  runtime.releaseCapacity();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(maxConcurrencyInput).toHaveValue('6');
  await credentialDialog.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
  await expect(page.getByLabel(/并发占用 1 \/ 10|1 of 10 concurrent requests/i)).toBeVisible();
  await expect(page.getByText('upstream quota exhausted', { exact: true })).toBeVisible();
  await expect(page.getByTitle(/请求排队中|requests queued/i)).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({
    path: testInfo.outputPath('runtime-concurrency-credential.png'),
    fullPage: true,
  });
});
