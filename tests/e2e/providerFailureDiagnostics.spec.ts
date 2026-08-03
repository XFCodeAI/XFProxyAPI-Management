import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const config = {
  'gemini-api-key': [],
  'codex-api-key': [
    {
      name: 'Codex upstream',
      'api-key': 'sk-codex-failure',
      'base-url': 'https://codex.example/v1',
      models: [{ name: 'gpt-5.6' }],
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
  ],
  'xai-api-key': [],
  'claude-api-key': [],
  'vertex-api-key': [],
  'openai-compatibility': [],
};

const installMockAPI = async (page: Page) => {
  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config') return routeJSON(route, config);
    if (path === '/api-key-usage/failures') {
      expect(url.searchParams.get('auth_index')).toBe('codex-failure-index');
      return routeJSON(route, {
        auth_index: 'codex-failure-index',
        auth_id: 'codex-failure-auth',
        provider: 'codex',
        alias: 'Codex upstream',
        key_preview: 'sk-c...lure',
        monitoring_available: true,
        failures: [
          {
            timestamp: '2026-08-03T10:00:00Z',
            status_code: 503,
            code: 'upstream_overloaded',
            message: 'The upstream service is overloaded',
            model: 'gpt-5.6',
            request_id: 'request-e2e-failure',
            scope: 'upstream',
            retryable: true,
            retry_after_seconds: 45,
            next_retry_at: '2026-08-03T10:00:45Z',
          },
        ],
      });
    }
    if (path === '/api-key-usage') {
      return routeJSON(route, {
        codex: {
          'https://codex.example/v1|sk-codex-failure': {
            success: 8,
            failed: 3,
            recent_requests: [{ success: 4, failed: 1 }],
            auth_indexes: ['codex-failure-index'],
            recent_failure_count: 1,
            latest_failure: {
              timestamp: '2026-08-03T10:00:00Z',
              status_code: 503,
              code: 'upstream_overloaded',
              message: 'The upstream service is overloaded',
              model: 'gpt-5.6',
              request_id: 'request-e2e-failure',
              scope: 'upstream',
              retryable: true,
            },
          },
        },
      });
    }
    if (path === '/supplier-billing-probes') {
      return routeJSON(route, { provider_name: '', entries: [] });
    }
    if (path === '/auth-files') {
      return routeJSON(route, { files: [], revision: 1, inventory_id: 'inventory-failure-e2e' });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    const section = path.slice(1) as keyof typeof config;
    if (section in config) return routeJSON(route, { [section]: config[section] });
    return routeJSON(route, {});
  });
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('provider failures are visible and drill into redacted diagnostics', async ({
  page,
}, testInfo) => {
  await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'codex', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });

  await expect(page.getByText('The upstream service is overloaded', { exact: true })).toBeVisible();
  const failureButton = page.getByRole('button', {
    name: /查看最近 1 条失败详情|View 1 recent failure record/,
  });
  await expect(failureButton).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('provider-failure-list.png'),
    fullPage: true,
  });
  await failureButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/最近失败|Recent failures/)).toBeVisible();
  await expect(dialog.getByText('request-e2e-failure', { exact: true })).toBeVisible();
  await expect(dialog.getByText('upstream_overloaded', { exact: true })).toBeVisible();
  await expect(dialog.getByText('HTTP 503', { exact: true })).toBeVisible();
  await expect(dialog.getByText('45 秒', { exact: true })).toBeVisible();
  const monitoringLink = dialog.getByRole('link', { name: /打开请求监控|Open request monitoring/ });
  await expect(monitoringLink).toHaveAttribute(
    'href',
    /#\/monitoring\?.*auth_id=codex-failure-auth.*request_id=request-e2e-failure/
  );
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-labelledby') ?? ''))
    .toBe('provider-failure-history-title');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );

  await page.screenshot({
    path: testInfo.outputPath('provider-failure-diagnostics.png'),
    fullPage: true,
  });
});
