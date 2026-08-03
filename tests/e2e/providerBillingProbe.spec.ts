import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const config = {
  'gemini-api-key': [],
  'codex-api-key': [
    {
      name: 'Codex direct',
      'api-key': 'sk-codex-demo',
      'base-url': 'https://codex.example/v1',
      models: [{ name: 'gpt-5.6' }],
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
  ],
  'xai-api-key': [
    {
      name: 'xAI direct',
      'api-key': 'sk-xai-demo',
      'base-url': 'https://xai.example/v1',
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
  ],
  'claude-api-key': [
    {
      name: 'Claude direct',
      'api-key': 'sk-claude-demo',
      'base-url': 'https://claude.example',
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
    {
      name: 'secondary',
      'api-key': 'sk-kimi-claude',
      'base-url': 'https://api.moonshot.cn/anthropic',
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
  ],
  'vertex-api-key': [],
  'openai-compatibility': [
    {
      name: 'Shared upstream',
      'base-url': 'https://shared.example/v1',
      'api-key-entries': [
        { name: 'primary', 'api-key': 'sk-primary' },
        { name: 'backup', 'api-key': 'sk-backup' },
      ],
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
    {
      name: 'kimi',
      'base-url': 'https://api.moonshot.cn/v1',
      'api-key-entries': [{ name: 'primary', 'api-key': 'sk-kimi-openai' }],
      'runtime-status': { connectivity: 'reachable', scheduling: 'ready', ready: true },
    },
  ],
};

const multiplier = (value: string) => ({
  schema_version: 2,
  billing_scope: 'token',
  group_rate_multiplier: Number(value),
  group_rate_multiplier_text: value,
  resolved_rate_multiplier: Number(value),
  resolved_rate_multiplier_text: value,
  peak_rate_enabled: false,
  effective_rate_multiplier: Number(value),
  effective_rate_multiplier_text: value,
  observed_at: '2026-08-02T10:00:00Z',
});

const usage = (remaining: number, unit = 'USD') => ({
  status: 'ok',
  is_valid: true,
  remaining,
  unit,
  stale: false,
  received_at: '2026-08-02T10:00:00Z',
});

const entries = [
  {
    target_id: 'supplier:codex',
    provider_brand: 'codex',
    provider_name: 'Codex direct',
    provider_index: 0,
    api_key_index: 0,
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('0.8'),
    usage: usage(25),
  },
  {
    target_id: 'supplier:openai-a',
    provider_brand: 'openaiCompatibility',
    provider_name: 'Shared upstream',
    provider_index: 0,
    api_key_index: 0,
    alias: 'primary',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('1.25'),
    usage: usage(100),
  },
  {
    target_id: 'supplier:openai-b',
    provider_brand: 'openaiCompatibility',
    provider_name: 'Shared upstream',
    provider_index: 0,
    api_key_index: 1,
    alias: 'backup',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('2'),
    usage: usage(61.5, 'CNY'),
  },
  {
    target_id: 'supplier:xai',
    provider_brand: 'xai',
    provider_name: 'xAI direct',
    provider_index: 0,
    api_key_index: 0,
    alias: 'xAI direct',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('0.7'),
    usage: usage(70),
  },
  {
    target_id: 'supplier:claude',
    provider_brand: 'claude',
    provider_name: 'Claude direct',
    provider_index: 0,
    api_key_index: 0,
    alias: 'Claude direct',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('0.6'),
    usage: usage(60),
  },
  {
    target_id: 'supplier:kimi-openai',
    provider_brand: 'openaiCompatibility',
    provider_name: 'kimi',
    provider_index: 1,
    api_key_index: 0,
    alias: 'primary',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('0.3'),
    usage: usage(30),
  },
  {
    target_id: 'supplier:kimi-claude',
    provider_brand: 'claude',
    provider_name: 'secondary',
    provider_index: 1,
    api_key_index: 0,
    alias: 'secondary',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('0.4'),
    usage: usage(40),
  },
  {
    target_id: 'supplier:kimi-name-collision',
    provider_brand: 'openaiCompatibility',
    provider_name: 'kimi',
    provider_index: 9,
    api_key_index: 0,
    alias: 'intruder',
    eligible: true,
    probing: false,
    stale: false,
    status: 'ok',
    multiplier: multiplier('9'),
    usage: usage(900),
  },
];

const installMockAPI = async (page: Page) => {
  const calls = {
    list: 0,
    listResourceScopes: [] as string[],
    probe: 0,
    probeTargets: [] as string[],
  };
  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config') return routeJSON(route, config);
    if (path === '/supplier-billing-probes') {
      if (request.method() === 'POST') {
        calls.probe += 1;
        const targetId = (request.postDataJSON() as { target_id: string }).target_id;
        calls.probeTargets.push(targetId);
        return routeJSON(
          route,
          entries.find((entry) => entry.target_id === targetId)
        );
      }
      calls.list += 1;
      calls.listResourceScopes.push(url.searchParams.get('resource_keys') ?? '');
      return routeJSON(route, { provider_name: '', entries });
    }
    if (path === '/api-key-usage') {
      return routeJSON(route, {
        'shared upstream': {
          'https://shared.example/v1|sk-primary': {
            success: 7,
            failed: 1,
            recent_requests: [{ success: 2, failed: 0 }],
          },
          'https://shared.example/v1|sk-backup': {
            success: 5,
            failed: 2,
            recent_requests: [{ success: 1, failed: 1 }],
          },
        },
        xai: {
          'https://xai.example/v1|sk-xai-demo': {
            success: 4,
            failed: 0,
            recent_requests: [{ success: 2, failed: 0 }],
          },
        },
        claude: {
          'https://claude.example|sk-claude-demo': {
            success: 5,
            failed: 1,
            recent_requests: [{ success: 3, failed: 1 }],
          },
        },
      });
    }
    const section = path.slice(1) as keyof typeof config;
    if (section in config) return routeJSON(route, { [section]: config[section] });
    if (path === '/auth-files') {
      return routeJSON(route, { files: [], revision: 1, inventory_id: 'inventory-e2e' });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    return routeJSON(route, {});
  });
  return calls;
};

const login = async (page: Page) => {
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
};

test('provider list shows independent shared billing rates without automatic POST fan-out', async ({
  page,
}, testInfo) => {
  const calls = await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'openaiCompatibility', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });

  if (testInfo.project.name === 'mobile') {
    await expect(page.getByTestId('provider-rate-label')).toHaveText(/倍率|Multiplier/);
  } else {
    await expect(page.getByRole('columnheader')).toHaveCount(5);
    await expect(page.getByRole('columnheader', { name: /倍率|Multiplier/ })).toBeVisible();
  }
  const providerHomepageLink = page.getByRole('link', { name: 'Shared upstream' });
  await expect(providerHomepageLink).toHaveAttribute('href', 'https://shared.example');
  await expect(providerHomepageLink).toHaveAttribute('target', '_blank');
  await expect(page.getByText('primary', { exact: true })).toBeVisible();
  await expect(page.getByText('1.25x', { exact: true })).toBeVisible();
  await expect(page.getByText('100 USD', { exact: true })).toBeVisible();
  await expect(page.getByText('backup', { exact: true })).toBeVisible();
  await expect(page.getByText('2x', { exact: true })).toBeVisible();
  await expect(page.getByText('61.5 CNY', { exact: true })).toBeVisible();
  await expect(page.getByText(/(?:成功|Success): 12/)).toBeVisible();
  await expect(page.getByText(/(?:失败|Failure): 3/)).toBeVisible();
  await expect(page.getByText('75%', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/最近请求成功率|Recent request success rate/)).toBeVisible();
  for (const value of ['1.25x', '2x']) {
    const box = await page.getByText(value, { exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  expect(calls.list).toBe(1);
  expect(calls.listResourceScopes[0]).toBe('openaiCompatibility:0');
  expect(calls.probe).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );

  await page.getByRole('button', { name: /^xAI/ }).click();
  await expect(page.getByText('0.7x', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Claude/ }).click();
  await expect(page.getByText('0.6x', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Kimi/ }).click();
  await expect(page.getByText('OpenAI / primary', { exact: true })).toBeVisible();
  await expect(page.getByText('0.3x', { exact: true })).toBeVisible();
  await expect(page.getByText('Claude / secondary', { exact: true })).toBeVisible();
  await expect(page.getByText('0.4x', { exact: true })).toBeVisible();
  await expect(page.getByText('intruder', { exact: true })).toHaveCount(0);
  await expect(page.getByText('9x', { exact: true })).toHaveCount(0);
  expect(calls.probe).toBe(0);
  expect(calls.list).toBeGreaterThanOrEqual(4);

  const refreshButtons = page.getByRole('button', {
    name: /刷新倍率与额度|Refresh multiplier and balance/,
  });
  await refreshButtons.nth(0).click();
  await expect.poll(() => calls.probe).toBe(1);
  await refreshButtons.nth(1).click();
  await expect.poll(() => calls.probe).toBe(2);
  expect(calls.probeTargets).toEqual(['supplier:kimi-openai', 'supplier:kimi-claude']);

  await page.screenshot({
    path: testInfo.outputPath('provider-billing-list.png'),
    fullPage: true,
  });
});
