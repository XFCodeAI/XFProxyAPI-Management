import { expect, test, type Page, type Route } from '@playwright/test';

const relayGroup = 'Team / 研发';
const oauthOnlyGroup = 'OAuth only';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const providerSections: Record<string, unknown[]> = {
  'gemini-api-key': [],
  'codex-api-key': [
    {
      name: 'Team Codex relay',
      'api-key': 'sk-team-codex',
      'base-url': 'https://codex-team.example/v1',
      groups: [relayGroup],
      models: [{ name: 'gpt-test' }],
    },
    {
      name: 'Unrelated Codex relay',
      'api-key': 'sk-other-codex',
      'base-url': 'https://codex-other.example/v1',
      groups: ['other'],
      models: [{ name: 'gpt-test' }],
    },
  ],
  'xai-api-key': [],
  'claude-api-key': [],
  'vertex-api-key': [],
  'openai-compatibility': [
    {
      name: 'Mixed OpenAI relay',
      'base-url': 'https://openai-relay.example/v1',
      'api-key-entries': [
        { name: 'hidden', 'api-key': 'sk-other-hide', groups: ['other'] },
        { name: 'visible', 'api-key': 'sk-team-match', groups: [relayGroup] },
      ],
      models: [{ name: 'gpt-test' }],
    },
  ],
};

const installMockAPI = async (page: Page) => {
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
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config') {
      return routeJSON(route, {
        ...providerSections,
        'credential-groups': [relayGroup, oauthOnlyGroup],
      });
    }
    if (path === '/credential-groups') {
      return routeJSON(route, { 'credential-groups': [relayGroup, oauthOnlyGroup] });
    }
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [
          {
            id: 'codex-oauth-only.json',
            name: 'codex-oauth-only.json',
            provider: 'codex',
            groups: [oauthOnlyGroup],
          },
        ],
        total: 1,
        revision: 1,
        inventory_id: 'group-navigation-inventory',
      });
    }
    if (path === '/auth-files/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    }
    if (path === '/api-keys') return routeJSON(route, { 'api-keys': [] });
    if (path === '/plugins') return routeJSON(route, { plugins: [] });
    if (path === '/supplier-billing-probes') {
      return routeJSON(route, { provider_name: '', entries: [] });
    }
    const section = path.slice(1);
    if (section in providerSections) {
      return routeJSON(route, { [section]: providerSections[section] });
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

test('credential group link filters provider relays and preserves history', async ({
  page,
}, testInfo) => {
  await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/credential-groups';
  });

  const relayLink = page.getByRole('link', { name: relayGroup, exact: true });
  await expect(relayLink).toBeVisible();
  await relayLink.click();
  await expect(page).toHaveURL(/#\/ai-providers\?credential-group=/);
  expect(
    await page.evaluate(() => {
      const query = window.location.hash.split('?')[1] ?? '';
      const params = new URLSearchParams(query);
      return {
        value: params.get('credential-group'),
        count: params.getAll('credential-group').length,
      };
    })
  ).toEqual({ value: relayGroup, count: 1 });

  const activeNotice = page.locator('[data-state="active"]');
  await expect(activeNotice).toContainText(relayGroup);
  await expect(page.getByText('Team Codex relay', { exact: true })).toBeVisible();
  await expect(page.getByText('Unrelated Codex relay', { exact: true })).toHaveCount(0);

  await page
    .getByRole('button', { name: /OpenAI/i })
    .first()
    .click();
  await expect(page.getByText('Mixed OpenAI relay', { exact: true })).toBeVisible();
  await expect(page.getByText('sk******ch', { exact: false })).toBeVisible();
  await expect(page.getByText('sk******de', { exact: false })).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({
    path: testInfo.outputPath('provider-credential-group-filter.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: /清除分组筛选|Clear group filter/i }).click();
  await expect(page).not.toHaveURL(/credential-group=/);
  await page.goBack();
  await expect(page).toHaveURL(/credential-group=/);
  await expect(page.locator('[data-state="active"]')).toContainText(relayGroup);
  await page.goForward();
  await expect(page).not.toHaveURL(/credential-group=/);

  await page.evaluate((group) => {
    const params = new URLSearchParams({ 'credential-group': group });
    window.location.hash = `/ai-providers?${params.toString()}`;
  }, oauthOnlyGroup);
  await expect(page.locator('[data-state="oauth-only"]')).toContainText(oauthOnlyGroup);

  await page.evaluate(() => {
    window.location.hash = '/ai-providers?credential-group=deleted-group';
  });
  await expect(page.locator('[data-state="stale"]')).toContainText('deleted-group');
});
