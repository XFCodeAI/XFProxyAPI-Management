import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const configYaml = `proxy-pools:
  - name: main
    enabled: true
    protocol: http
    host: 127.0.0.1
    port: 8080
  - name: backup
    enabled: true
    protocol: http
    host: 127.0.0.2
    port: 8080
codex-api-key: []
openai-compatibility:
  - name: Shared upstream
    base-url: https://shared.example/v1
    api-key-entries:
      - name: primary
        api-key: sk-primary-secret
      - name: backup
        api-key: sk-backup-secret
`;

const providerConfig = {
  'gemini-api-key': [],
  'codex-api-key': [],
  'xai-api-key': [],
  'claude-api-key': [],
  'vertex-api-key': [],
  'openai-compatibility': [
    {
      name: 'Shared upstream',
      'base-url': 'https://shared.example/v1',
      'api-key-entries': [
        { name: 'primary', 'api-key': 'sk-primary-secret' },
        { name: 'backup', 'api-key': 'sk-backup-secret' },
      ],
    },
  ],
};

const resources = [
  {
    resource_id: 'credential-resource',
    kind: 'credential',
    provider: 'codex',
    label: 'codex-user@example.com.json',
    masked_identity: 'codex-user@example.com',
    proxy_supported: true,
    proxy_support_status: 'supported',
  },
  {
    resource_id: 'provider-primary',
    kind: 'provider_api_key',
    provider: 'openai-compatibility',
    supplier_id: 'supplier-shared',
    supplier_alias: 'Shared upstream',
    key_alias: 'primary',
    label: 'primary',
    masked_identity: 'sk-p...cret',
    proxy_supported: true,
    proxy_support_status: 'supported',
  },
  {
    resource_id: 'provider-backup',
    kind: 'provider_api_key',
    provider: 'openai-compatibility',
    supplier_id: 'supplier-shared',
    supplier_alias: 'Shared upstream',
    key_alias: 'backup',
    label: 'backup',
    masked_identity: 'sk-b...cret',
    proxy_supported: true,
    proxy_support_status: 'supported',
  },
];

const installMockAPI = async (page: Page) => {
  let revision = 'assignment-1';
  let selected = new Set(['credential-resource']);
  let assignmentBody: { resource_ids: string[]; revision: string } | null = null;

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

  const snapshot = () => {
    const currentResources = resources.map((resource) => ({
      ...resource,
      current_pool_id: selected.has(resource.resource_id) ? 'pool-main' : undefined,
    }));
    const assigned = currentResources
      .filter((resource) => resource.current_pool_id === 'pool-main')
      .map((resource) => ({
        id: resource.kind === 'credential' ? 'codex-user@example.com.json' : resource.resource_id,
        ...resource,
      }));
    return {
      assignment_revision: revision,
      assignable_resource_count: currentResources.length,
      credential_count: 1,
      assignable_resources: currentResources,
      pools: [
        {
          id: 'pool-main',
          name: 'main',
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 8080,
          redacted_url: 'http://127.0.0.1:8080',
          checked: true,
          available: true,
          assigned_count: assigned.length,
          assigned_to: assigned,
          unsupported_assigned_count: 0,
          unsupported_assigned_to: [],
        },
        {
          id: 'pool-backup',
          name: 'backup',
          enabled: true,
          protocol: 'http',
          host: '127.0.0.2',
          port: 8080,
          redacted_url: 'http://127.0.0.2:8080',
          checked: true,
          available: true,
          assigned_count: 0,
          assigned_to: [],
          unsupported_assigned_count: 0,
          unsupported_assigned_to: [],
        },
      ],
    };
  };

  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config.yaml') {
      return route.fulfill({ status: 200, contentType: 'text/yaml', body: configYaml });
    }
    if (path === '/config') return routeJSON(route, providerConfig);
    if (path === '/proxy-pools' && request.method() === 'GET') {
      return routeJSON(route, snapshot());
    }
    if (path === '/proxy-pools/pool-main/assign' && request.method() === 'POST') {
      assignmentBody = request.postDataJSON() as { resource_ids: string[]; revision: string };
      selected = new Set(assignmentBody.resource_ids);
      revision = 'assignment-2';
      return routeJSON(route, { ...snapshot(), status: 'ok', updated: 1, failed: 0, failures: [] });
    }
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [
          {
            id: 'codex-user@example.com.json',
            name: 'codex-user@example.com.json',
            provider: 'codex',
            assignable: true,
            proxy_supported: true,
          },
        ],
        revision: 1,
        inventory_id: 'inventory-e2e',
      });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    if (path === '/plugins') return routeJSON(route, { plugins: [] });
    return routeJSON(route, {});
  });

  return { assignment: () => assignmentBody };
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('proxy pool binds credentials and independently selected provider keys', async ({
  page,
}, testInfo) => {
  const calls = await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/proxy-pools';
  });

  await expect(page.getByRole('heading', { name: /代理池|Proxy pools/i })).toBeVisible();
  await page
    .getByRole('button', { name: /绑定资源|Bind resources/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Shared upstream', { exact: true })).toBeVisible();
  await expect(dialog.getByText('sk-p...cret', { exact: true })).toBeVisible();
  await expect(dialog.getByText('sk-primary-secret', { exact: true })).toHaveCount(0);

  await dialog.getByRole('checkbox', { name: 'Shared upstream' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'primary' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'backup' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'backup' }).click();
  await expect(dialog.getByText(/已选 2 项|2 selected/)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({
    path: testInfo.outputPath('proxy-provider-bindings.png'),
    fullPage: true,
  });

  await dialog.getByRole('button', { name: /保存|Save/i }).click();
  await expect(dialog).toBeHidden();
  expect(calls.assignment()).toEqual({
    resource_ids: ['credential-resource', 'provider-primary'],
    revision: 'assignment-1',
  });
  await page
    .getByRole('button', { name: /绑定资源|Bind resources/i })
    .first()
    .click();
  await expect(dialog.getByRole('checkbox', { name: 'primary' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'backup' })).not.toBeChecked();
  await expect(dialog.getByText(/当前：main|Current: main/)).toHaveCount(2);
});
