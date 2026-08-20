import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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
    const path = new URL(request.url()).pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config' || path === '/nodes' || path === '/plugins') return routeJSON(route, {});
    if (path === '/auth-files/events') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    }
    if (path === '/auth-files') {
      return routeJSON(route, { files: [], total: 0, revision: 1, inventory_id: 'inventory-1' });
    }
    if (path === '/prompt-rewrite' && request.method() === 'GET') {
      return routeJSON(route, {
        'prompt-rewrite': { enabled: false, evaluation: 'first-match', assets: [], profiles: [], rules: [] },
        revision: 'prompt-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
      });
    }
    if (path === '/prompt-rewrite/catalog') {
      return routeJSON(route, {
        credentials: [],
        providers: [],
        credential_groups: [],
        revision: 'prompt-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
        builtin_assets: [],
        builtin_packs: [],
      });
    }
    if (path === '/capability-packs' && request.method() === 'GET') {
      return routeJSON(route, { error: 'capability catalog is unavailable' }, 404);
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

test('unavailable capability catalog keeps the page NERV-only', async ({ page }) => {
  await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/prompt-rewrite?advanced=1&tab=packs';
  });

  await expect(page.getByText(/NERV runtime is unavailable|NERV 运行时暂不可用/i)).toBeVisible();
  await expect(page.getByText(/manage presets|管理内置方案|Source packs|来源包/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Prompt Management|提示词管理/i })).toHaveCount(0);
});
