import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const credentialName = 'codex-k12@example.com.json';

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
    if (path === '/auth-files') {
      return routeJSON(route, {
        files: [
          {
            id: 'credential-k12',
            name: credentialName,
            type: 'codex',
            provider: 'codex',
            auth_index: 'codex:k12',
            disabled: false,
            size: 512,
            modtime: '2026-08-02T12:00:00Z',
            success: 8,
            failed: 1,
          },
        ],
        total: 1,
        revision: 1,
        inventory_id: 'quota-card-e2e',
      });
    }
    if (path === '/codex/quota') {
      return routeJSON(route, {
        credential_id: 'credential-k12',
        credential_generation: 1,
        auth_index: 'codex:k12',
        account: {
          selected_account_fingerprint: '64dfd1aa5048',
          upstream_account_fingerprint: '64dfd1aa5048',
          token_claim_account_fingerprint: '64dfd1aa5048',
          credential_plan_type: 'team',
          upstream_plan_type: 'team',
          fedramp: false,
          fedramp_known: false,
          account_matches_upstream: true,
          token_claims_present: true,
          token_claim_mismatch: false,
        },
        observed_at: '2000-01-01T00:00:00Z',
        subscription_active_until: '2030-01-01T00:00:00Z',
        usage: {
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              limit_window_seconds: 18000,
              used_percent: 25,
              reset_at: 1_900_000_000,
            },
            secondary_window: {
              limit_window_seconds: 604800,
              used_percent: 40,
              reset_at: 1_900_000_000,
            },
          },
        },
        reset_credits: {
          available_count: 1,
          credits: [
            {
              status: 'available',
              granted_at: '2029-01-01T00:00:00Z',
              expires_at: '2030-01-01T00:00:00Z',
            },
          ],
          error: '',
          upstream_status: 200,
        },
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

test('Codex credential card omits diagnostics and keeps actionable quota data', async ({
  page,
}, testInfo) => {
  await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/quota';
  });

  await expect(page.getByText(credentialName, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '点击此处刷新额度' }).click();
  await expect(page.getByText('Codex 用量')).toBeVisible();

  for (const hiddenText of [
    '上游返回套餐',
    '凭证记录套餐',
    '主动重置次数',
    '选中 Workspace',
    '上游返回 Workspace',
    'Workspace 对比',
    'Token Claim Workspace',
    '凭证与 Token 上下文',
    'FedRAMP',
    '观测时间',
    '64dfd1aa5048',
  ]) {
    await expect(page.getByText(hiddenText, { exact: true })).toHaveCount(0);
  }

  await expect(page.getByText('续期时间')).toBeVisible();
  await expect(page.getByText('主动重置过期时间（GMT+8）')).toBeVisible();
  await expect(page.getByText('允许请求')).toBeVisible();
  await expect(page.getByText('已触及限制')).toBeVisible();
  await expect(page.getByRole('button', { name: '重置额度' })).toBeVisible();

  const card = page
    .getByText(credentialName, { exact: true })
    .locator('xpath=ancestor::*[contains(@class,"fileCard")][1]');
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath('credential-quota-card.png') });
});
