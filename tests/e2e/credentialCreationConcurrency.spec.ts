import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const installMockAPI = async (page: Page) => {
  let oauthConcurrencyMode: string | null = null;
  let oauthMaxConcurrency: string | null = null;
  let uploadConcurrencyModeDefault: string | null = null;
  let uploadMaxConcurrencyDefault: string | null = null;

  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config') {
      return routeJSON(route, {
        'gemini-api-key': [],
        'codex-api-key': [],
        'xai-api-key': [],
        'claude-api-key': [],
        'vertex-api-key': [],
        'openai-compatibility': [],
      });
    }
    if (path === '/credential-concurrency') {
      return routeJSON(route, { 'default-max-concurrency': 9 });
    }
    if (path === '/plugins') return routeJSON(route, { plugins: [] });
    if (path === '/auth-files/events' || path === '/runtime-observations/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    }
    if (path === '/auth-files' && request.method() === 'GET') {
      return routeJSON(route, {
        files: [],
        total: 0,
        revision: 1,
        inventory_id: 'creation-concurrency',
      });
    }
    if (path === '/auth-files' && request.method() === 'POST') {
      const body = request.postData() ?? '';
      uploadConcurrencyModeDefault =
        body.match(/name="concurrency_mode_default"\r\n\r\n([^\r\n]+)/)?.[1] ?? null;
      uploadMaxConcurrencyDefault =
        body.match(/name="max_concurrency_default"\r\n\r\n([^\r\n]+)/)?.[1] ?? null;
      return routeJSON(route, {
        status: 'ok',
        uploaded: 1,
        files: ['codex-import@example.com.json'],
        failed: [],
      });
    }
    if (path === '/proxy-pools') {
      return routeJSON(route, {
        pools: [
          {
            id: 'proxy-1',
            name: 'main',
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 8080,
            checked: true,
            available: true,
          },
        ],
        assignable_resources: [],
      });
    }
    if (path === '/codex-auth-url') {
      oauthConcurrencyMode = url.searchParams.get('concurrency_mode');
      oauthMaxConcurrency = url.searchParams.get('max_concurrency');
      return routeJSON(route, {
        status: 'ok',
        url: 'https://auth.example/authorize',
        state: 'oauth-state-1',
      });
    }
    if (path === '/get-auth-status') return routeJSON(route, { status: 'wait' });
    if (path === '/oauth-cancel') return routeJSON(route, { status: 'ok', canceled: true });
    if (path === '/runtime-observations') {
      return routeJSON(route, {
        observation_id: 'creation-concurrency',
        revision: 1,
        observed_at: '2026-08-03T12:00:00Z',
        admission_scope: 'process-local',
        resources: [],
        queue: { waiting: 0, maximum: 128, closed: false },
      });
    }
    if (path === '/api-key-usage') return routeJSON(route, {});
    if (path === '/supplier-billing-probes') {
      return routeJSON(route, { provider_name: '', entries: [] });
    }
    return routeJSON(route, {});
  });

  return {
    oauthConcurrencyMode: () => oauthConcurrencyMode,
    oauthMaxConcurrency: () => oauthMaxConcurrency,
    uploadConcurrencyModeDefault: () => uploadConcurrencyModeDefault,
    uploadMaxConcurrencyDefault: () => uploadMaxConcurrencyDefault,
  };
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('OAuth and JSON import submit creation-time concurrency controls', async ({
  page,
}, testInfo) => {
  const captured = await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/quota';
  });

  await page.locator('button[title="Codex"]').click();
  await page.getByRole('button', { name: /Codex OAuth 登录|Codex OAuth Login/i }).click();
  const oauthDialog = page.getByRole('dialog');
  const oauthConcurrency = oauthDialog.locator('#oauth-credential-concurrency-value');
  await expect(oauthDialog.getByRole('button', { name: /跟随全局|Follow global/i })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(oauthConcurrency).toBeDisabled();
  await oauthDialog.getByRole('button', { name: /独立限制|Independent/i }).click();
  await oauthConcurrency.fill('4');
  await oauthDialog.getByRole('button', { name: /^(登录|Login)$/ }).click();
  await expect.poll(captured.oauthConcurrencyMode).toBe('independent');
  await expect.poll(captured.oauthMaxConcurrency).toBe('4');
  await oauthDialog
    .getByRole('button', { name: /^(关闭|Close)$/ })
    .last()
    .click();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'codex-import@example.com.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'codex',
        auth_kind: 'oauth',
        access_token: 'test-token',
        email: 'import@example.com',
        account_id: 'workspace-import',
      })
    ),
  });
  const uploadDialog = page.getByRole('dialog');
  const uploadConcurrency = uploadDialog.locator('#quota-import-concurrency-value');
  await expect(
    uploadDialog.getByRole('button', { name: /跟随全局|Follow global/i })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(uploadConcurrency).toBeDisabled();
  await uploadDialog.getByRole('button', { name: /独立限制|Independent/i }).click();
  await uploadConcurrency.fill('6');
  await page.screenshot({
    path: testInfo.outputPath(`credential-creation-concurrency-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await uploadDialog.getByRole('button', { name: /^(确认|Confirm)$/ }).click();
  await expect.poll(captured.uploadConcurrencyModeDefault).toBe('independent');
  await expect.poll(captured.uploadMaxConcurrencyDefault).toBe('6');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
