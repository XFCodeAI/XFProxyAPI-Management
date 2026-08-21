import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const providerSections: Record<string, unknown[]> = {
  'gemini-api-key': [],
  'codex-api-key': [
    {
      name: 'Fallback Codex Supplier',
      'api-key': 'sk-provider-demo',
      'base-url': 'https://supplier.example/v1',
      fallback: true,
      'disable-cooling': true,
      models: [{ name: 'gpt-5.6' }],
      'auth-index': 'supplier-auth-1',
      'runtime-status': {
        connectivity: 'reachable',
        scheduling: 'ready',
        ready: true,
      },
    },
  ],
  'xai-api-key': [],
  'claude-api-key': [],
  'vertex-api-key': [],
  'openai-compatibility': [],
};

const installMockAPI = async (page: Page) => {
  let revision = 1;
  let credential: Record<string, unknown> = {
    id: 'credential-1',
    name: 'codex-user@example.com.json',
    type: 'codex',
    provider: 'codex',
    auth_index: 'credential-auth-1',
    groups: ['fallback-group'],
    fallback: true,
    disable_cooling: false,
    disabled: false,
    unavailable: true,
    status: 'error',
    status_message: 'upstream quota exhausted',
    size: 512,
    modtime: '2026-08-01T08:00:00Z',
    success: 7,
    failed: 2,
  };

  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v0/management/auth-files/events')) {
        return Promise.resolve(
          new Response(new ReadableStream({ start() {} }), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        );
      }
      return nativeFetch(input, init);
    };
  });

  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204 });
    }
    if (path === '/config') {
      return routeJSON(route, {
        ...providerSections,
        'credential-groups': [{ name: 'fallback-group' }],
      });
    }
    if (path === '/auth-files/download') {
      const disableCooling = Object.prototype.hasOwnProperty.call(credential, 'disable_cooling')
        ? { disable_cooling: credential.disable_cooling }
        : {};
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'codex',
          email: 'user@example.com',
          groups: ['fallback-group'],
          fallback: true,
          ...disableCooling,
        }),
      });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    }
    if (path === '/auth-files/fields' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      credential = { ...credential };
      if (Object.prototype.hasOwnProperty.call(body, 'disable_cooling')) {
        if (body.disable_cooling === null) {
          delete credential.disable_cooling;
        } else {
          credential.disable_cooling = body.disable_cooling;
        }
      }
      revision += 1;
      return routeJSON(route, {
        status: 'ok',
        files: [credential],
        revision,
        inventory_id: 'inventory-e2e',
      });
    }
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [credential],
        total: 1,
        revision,
        inventory_id: 'inventory-e2e',
      });
    }
    const section = path.slice(1);
    if (section in providerSections) {
      return routeJSON(route, { [section]: providerSections[section] });
    }
    if (path === '/plugins') return routeJSON(route, { plugins: [] });
    if (path === '/api-key-usage') return routeJSON(route, {});
    return routeJSON(route, {});
  });
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('credential and supplier cooling controls preserve live state and fit the viewport', async ({
  page,
}, testInfo) => {
  await installMockAPI(page);
  await login(page);

  await page.evaluate(() => {
    window.location.hash = '/quota';
  });
  await expect(page.getByRole('heading', { name: /凭证管理|Credential Management/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('codex-user@example.com.json')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('upstream quota exhausted')).toBeVisible();

  await page
    .getByRole('button', { name: /认证文件详情 \/ 编辑|Credential details \/ edit/i })
    .click();
  const dialog = page.getByRole('dialog');
  const fallbackSwitch = dialog.getByRole('switch', {
    name: /设为兜底凭证|Fallback credential/i,
  });
  const coolingSelect = dialog.getByRole('combobox', {
    name: /冷却策略|Cooling policy/i,
  });
  await expect(fallbackSwitch).toBeChecked();
  await expect(coolingSelect).toHaveText(/启用冷却|Enable cooling/i);

  const fallbackBox = await fallbackSwitch.boundingBox();
  const coolingBox = await coolingSelect.boundingBox();
  expect(fallbackBox).not.toBeNull();
  expect(coolingBox).not.toBeNull();
  expect(coolingBox!.y).toBeGreaterThan(fallbackBox!.y);
  expect(coolingBox!.x).toBeGreaterThanOrEqual(0);
  expect(coolingBox!.x + coolingBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await coolingSelect.click();
  await page.getByRole('option', { name: /禁用冷却|Disable cooling/i }).click();
  await expect(dialog.locator('textarea[readonly]').last()).toHaveValue(/"disable_cooling": true/);
  await page.screenshot({
    path: testInfo.outputPath('credential-cooling-editor.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('upstream quota exhausted')).toBeVisible();

  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'codex', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });
  const statusBadge = page.getByText(/调度：就绪|Scheduling: ready/i);
  await expect(statusBadge).toBeVisible();
  await expect(page.getByText(/连接：可达|Connectivity: reachable/i)).toHaveCount(0);
  const viewport = page.viewportSize();
  const badgeBox = await statusBadge.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(badgeBox!.x).toBeLessThan(viewport!.width);
  expect(badgeBox!.x + badgeBox!.width).toBeGreaterThan(0);
  await page.screenshot({
    path: testInfo.outputPath('provider-runtime-status.png'),
    fullPage: true,
  });

  await page
    .getByRole('button', { name: /^(编辑|Edit)$/ })
    .first()
    .click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', {
      name: /冷却策略|Cooling policy/i,
    })
  ).toHaveText(/禁用冷却|Disable cooling/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
