import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const installMockAPI = async (page: Page, onReprobe: () => void) => {
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
    const path = new URL(request.url()).pathname.replace(/^\/v0\/management/, '');

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
    if (path === '/auth-files/events') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    }
    if (path === '/auth-files/availability/reprobe' && request.method() === 'POST') {
      onReprobe();
      return routeJSON(route, {
        status: 'accepted',
        requested: 1,
        eligible: 1,
        queued: 1,
        already_probing: 0,
        skipped: {},
        maximum_parallel: 4,
      });
    }
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [
          {
            id: 'credential-1',
            name: 'codex-user@example.com.json',
            type: 'codex',
            provider: 'codex',
            auth_index: 'codex:user',
            disabled: false,
            size: 512,
            modtime: '2026-08-06T00:00:00Z',
          },
        ],
        total: 1,
        revision: 1,
        inventory_id: 'availability-reprobe-e2e',
      });
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

test('quota page exposes and submits the credential quota reprobe action', async ({ page }) => {
  let reprobeRequests = 0;
  await installMockAPI(page, () => {
    reprobeRequests += 1;
  });
  await login(page);

  await page.evaluate(() => {
    window.location.hash = '/quota';
  });

  await expect(page.getByRole('heading', { name: /凭证管理|Credential Management/i })).toBeVisible({
    timeout: 20_000,
  });
  const reprobeButton = page.getByRole('button', { name: /重探额度|Reprobe quota/i });
  await expect(reprobeButton).toBeVisible();

  await reprobeButton.click();

  await expect.poll(() => reprobeRequests).toBe(1);
  await expect(
    page.getByText(/已分批提交 1 个凭证|Queued 1 credential quota probe/i)
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
