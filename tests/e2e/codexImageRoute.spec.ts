import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const readyStatus = { connectivity: 'reachable', scheduling: 'ready', ready: true };

const sourceSupplier = {
  name: 'Codex gateway',
  'base-url': 'https://codex-gateway.example/v1',
  'api-key-entries': [{ name: 'primary', 'api-key': 'sk-source' }],
  models: [
    { name: 'gpt-5.6', alias: 'chat', image: false },
    { name: 'self-image-actual', alias: 'self-image', image: true },
  ],
  'runtime-status': readyStatus,
  'codex-image-route': {
    enabled: true,
    'target-supplier': 'Image supplier',
    'target-model': 'image-pro',
  },
};

const imageSupplier = {
  name: 'Image supplier',
  'base-url': 'https://images.example/v1',
  'api-key-entries': [{ name: 'image-key', 'api-key': 'sk-image' }],
  models: [
    { name: 'gpt-image-2', alias: 'image-pro', image: true },
    { name: 'gpt-5.6', alias: 'chat-only', image: false },
  ],
  'runtime-status': readyStatus,
};

const installMockAPI = async (page: Page) => {
  const openAIProviders: Array<Record<string, unknown>> = [
    structuredClone(sourceSupplier),
    structuredClone(imageSupplier),
  ];
  const state = {
    config: {
      'gemini-api-key': [],
      'codex-api-key': [],
      'xai-api-key': [],
      'claude-api-key': [],
      'vertex-api-key': [],
      'openai-compatibility': openAIProviders,
    },
    openAIPuts: [] as unknown[][],
  };

  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (
        url.includes('/v0/management/auth-files/events') ||
        url.includes('/v0/management/supplier-billing-probes/events')
      ) {
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
    const path = new URL(request.url()).pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config' && request.method() === 'GET') {
      return routeJSON(route, structuredClone(state.config));
    }
    const section = path.slice(1) as keyof typeof state.config;
    if (request.method() === 'GET' && section in state.config) {
      return routeJSON(route, { [section]: structuredClone(state.config[section]) });
    }
    if (path === '/openai-compatibility' && request.method() === 'PUT') {
      const next = request.postDataJSON() as unknown[];
      state.openAIPuts.push(structuredClone(next));
      state.config['openai-compatibility'] = structuredClone(
        next as Array<Record<string, unknown>>
      );
      return routeJSON(route, { status: 'ok' });
    }
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [],
        total: 0,
        revision: 1,
        inventory_id: 'codex-image-route-e2e',
      });
    }
    if (path === '/auth-files/events' || path === '/supplier-billing-probes/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    }
    if (path === '/supplier-billing-probes') {
      return routeJSON(route, { entries: [], snapshot_id: 'route-e2e', revision: 1 });
    }
    if (path === '/credential-groups') return routeJSON(route, { groups: [] });
    if (path === '/api-key-usage') return routeJSON(route, {});
    return routeJSON(route, {});
  });

  return state;
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

const openOpenAIProviders = async (page: Page) => {
  await page.evaluate(() => {
    window.location.hash = '/ai-providers';
  });
  await expect(page.getByRole('heading', { name: /AI 提供商|AI Providers/i })).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByRole('button', { name: /OpenAI 兼容|OpenAI Compatible/i })
    .last()
    .click();
  await expect(page.getByRole('link', { name: 'Codex gateway', exact: true })).toBeVisible();
};

const selectOption = async (page: Page, dialog: Locator, label: RegExp, option: string) => {
  await dialog.getByLabel(label).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

const triggerProviderRefresh = async (page: Page) => {
  const refreshButton = page
    .locator('main button')
    .filter({ hasText: /^(刷新|Refresh)$/i })
    .first();
  await expect(refreshButton).toBeEnabled();
  const refreshed = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return response.request().method() === 'GET' && path.endsWith('/openai-compatibility');
  });
  await refreshButton.evaluate((button: HTMLButtonElement) => button.click());
  await refreshed;
  await expect(refreshButton).toBeEnabled();
};

test('Codex image route survives create, stale refresh, self-route edit, and disable', async ({
  page,
}) => {
  const state = await installMockAPI(page);
  await login(page);
  await openOpenAIProviders(page);

  await page
    .getByRole('button', { name: /新建|New/i })
    .first()
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/名称|Name/i, { exact: true }).fill('New Codex source');
  await dialog.getByLabel(/服务地址|Base URL/i, { exact: true }).fill('https://new.example/v1');
  await dialog.getByLabel(/API 密钥|API key/i, { exact: true }).fill('sk-new-source');
  await dialog.getByRole('checkbox', { name: /Codex 生图路由|Codex image route/i }).check();
  await selectOption(page, dialog, /目标供应商|Target supplier/i, 'Image supplier');
  await selectOption(page, dialog, /目标生图模型|Target image model/i, 'image-pro (gpt-image-2)');
  await expect(dialog.getByText(/Image supplier \/ image-pro \(gpt-image-2\)/i)).toBeVisible();
  await dialog.getByRole('button', { name: /创建|Create/i }).click();
  await expect(dialog).toBeHidden();

  let created = state.config['openai-compatibility'].find(
    (provider) => provider.name === 'New Codex source'
  );
  expect(created?.['codex-image-route']).toEqual({
    enabled: true,
    'target-supplier': 'Image supplier',
    'target-model': 'image-pro',
  });
  const createdRow = page.getByRole('row').filter({ hasText: 'New Codex source' });
  await expect(
    createdRow.getByText('Image supplier / image-pro (gpt-image-2)', { exact: true })
  ).toBeVisible();
  await createdRow.getByRole('button', { name: /编辑|Edit/i }).click();
  dialog = page.getByRole('dialog');
  const prefixInput = dialog.getByLabel(/前缀|Prefix/i, { exact: true });
  await prefixInput.fill('draft-preserved');
  const targetIndex = state.config['openai-compatibility'].findIndex(
    (provider) => provider.name === 'Image supplier'
  );
  const [removedTarget] = state.config['openai-compatibility'].splice(targetIndex, 1);
  await triggerProviderRefresh(page);
  await expect(prefixInput).toHaveValue('draft-preserved');
  await expect(dialog.getByText(/已不存在|no longer exists/i)).toBeVisible();
  const putsBeforeInvalidSave = state.openAIPuts.length;
  await dialog.getByRole('button', { name: /保存|Save/i }).click();
  await expect(dialog.getByText(/已不存在|no longer exists/i).first()).toBeVisible();
  expect(state.openAIPuts.length).toBe(putsBeforeInvalidSave);

  state.config['openai-compatibility'].splice(targetIndex, 0, removedTarget);
  await triggerProviderRefresh(page);
  await expect(prefixInput).toHaveValue('draft-preserved');
  await expect(dialog.getByText(/路由到|Routes to/i)).toBeVisible();
  await dialog.getByRole('button', { name: /保存|Save/i }).click();
  await expect(dialog).toBeHidden();
  created = state.config['openai-compatibility'].find(
    (provider) => provider.name === 'New Codex source'
  );
  expect(created?.prefix).toBe('draft-preserved');

  const sourceRow = page.getByRole('row').filter({ hasText: 'Codex gateway' });
  await sourceRow.getByRole('button', { name: /编辑|Edit/i }).click();
  dialog = page.getByRole('dialog');
  await selectOption(page, dialog, /目标供应商|Target supplier/i, 'Codex gateway');
  await selectOption(
    page,
    dialog,
    /目标生图模型|Target image model/i,
    'self-image (self-image-actual)'
  );
  await dialog.getByRole('button', { name: /保存|Save/i }).click();
  await expect(dialog).toBeHidden();
  let source = state.config['openai-compatibility'].find(
    (provider) => provider.name === 'Codex gateway'
  );
  expect(source?.['codex-image-route']).toEqual({
    enabled: true,
    'target-supplier': 'Codex gateway',
    'target-model': 'self-image',
  });

  await page
    .getByRole('row')
    .filter({ hasText: 'Codex gateway' })
    .getByRole('button', { name: /编辑|Edit/i })
    .click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(/Codex gateway \/ self-image \(self-image-actual\)/i)
  ).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Codex 生图路由|Codex image route/i }).uncheck();
  await dialog.getByRole('button', { name: /保存|Save/i }).click();
  await expect(dialog).toBeHidden();
  source = state.config['openai-compatibility'].find(
    (provider) => provider.name === 'Codex gateway'
  );
  expect(source?.['codex-image-route']).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
