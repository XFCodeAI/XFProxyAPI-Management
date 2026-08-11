import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const TOTAL_CREDENTIALS = 3000;

const credentialName = (index: number) => `codex-user-${String(index).padStart(5, '0')}.json`;

const installMockAPI = async (page: Page) => {
  let revision = 1;
  const disabled = new Set<number>();
  const deleted = new Set<number>();
  for (let index = 0; index < TOTAL_CREDENTIALS; index += 10) disabled.add(index);

  const credential = (index: number) => ({
    id: `credential-${index}`,
    name: credentialName(index),
    type: 'codex',
    provider: 'codex',
    auth_index: `codex:${index}`,
    disabled: disabled.has(index),
    groups: index % 2 === 0 ? ['team'] : [],
    size: 512,
    success: 0,
    failed: 0,
  });

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
    if (path === '/auth-files' && request.method() === 'GET') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const status = url.searchParams.get('status') ?? '';
      const cursor = Number(url.searchParams.get('cursor')?.replace('offset-', '') ?? 0);
      const matches = Array.from({ length: TOTAL_CREDENTIALS }, (_, index) => index).filter(
        (index) => {
          if (deleted.has(index)) return false;
          if (search && !credentialName(index).includes(search)) return false;
          if (status === 'disabled' && !disabled.has(index)) return false;
          if (status === 'enabled' && disabled.has(index)) return false;
          return true;
        }
      );
      const pageIndexes = matches.slice(cursor, cursor + limit);
      const nextOffset = cursor + pageIndexes.length;
      return routeJSON(route, {
        files: pageIndexes.map(credential),
        total: matches.length,
        limit,
        has_more: nextOffset < matches.length,
        next_cursor: nextOffset < matches.length ? `offset-${nextOffset}` : '',
        provider_totals: { codex: TOTAL_CREDENTIALS - deleted.size },
        group_totals: { team: 1500 },
        revision,
        inventory_id: 'credential-pagination-e2e',
      });
    }
    if (path === '/auth-files/status' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { name: string; disabled: boolean };
      const index = Number(body.name.match(/(\d+)\.json$/)?.[1] ?? -1);
      if (body.disabled) disabled.add(index);
      else disabled.delete(index);
      revision += 1;
      return routeJSON(route, {
        status: 'ok',
        disabled: body.disabled,
        files: [credential(index)],
        revision,
        inventory_id: 'credential-pagination-e2e',
      });
    }
    if (path === '/auth-files' && request.method() === 'DELETE') {
      const body = request.postDataJSON() as { names?: string[] };
      const names = body.names ?? [];
      names.forEach((name) => {
        const index = Number(name.match(/(\d+)\.json$/)?.[1] ?? -1);
        if (index >= 0) deleted.add(index);
      });
      revision += 1;
      return routeJSON(route, {
        status: 'ok',
        deleted: names.length,
        files: names,
        pending: [],
        conflicts: [],
        failed: [],
        revision,
        inventory_id: 'credential-pagination-e2e',
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

test('large credential inventory remains page bounded across management actions', async ({
  page,
}) => {
  await installMockAPI(page);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/quota';
  });

  const cards = page.locator('[data-auth-id]');
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  expect(await cards.count()).toBeLessThanOrEqual(25);

  const nextRequest = page.waitForRequest(
    (request) =>
      request.method() === 'GET' &&
      request.url().includes('/v0/management/auth-files?') &&
      new URL(request.url()).searchParams.has('cursor')
  );
  await page.getByRole('button', { name: '下一页' }).last().click();
  const requestedNextPage = await nextRequest;
  const pageOffset = Number(
    new URL(requestedNextPage.url()).searchParams.get('cursor')?.replace('offset-', '') ?? 0
  );
  await expect(page.getByText(credentialName(pageOffset), { exact: true })).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(25);

  await page.getByRole('button', { name: '上一页' }).last().click();
  await expect(page.getByText(credentialName(0), { exact: true })).toBeVisible();

  const search = page.getByRole('searchbox');
  await search.fill('codex-user-02999');
  await expect(page.getByText(credentialName(2999), { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(1);
  await search.clear();

  const disabledRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get('status') === 'disabled'
  );
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await disabledRequest;
  await expect(page.getByText(credentialName(0), { exact: true })).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(25);

  const allRequest = page.waitForResponse((response) => {
    const request = response.request();
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/v0/management/auth-files') &&
      !url.searchParams.has('status') &&
      response.status() === 200
    );
  });
  await page
    .getByRole('group', { name: '状态筛选' })
    .getByRole('button', { name: '全部', exact: true })
    .click();
  await allRequest;
  const selectedName = credentialName(1);
  const firstEnabledCard = cards.filter({ hasText: selectedName });
  await expect(firstEnabledCard.getByText(selectedName, { exact: true })).toBeVisible();
  await firstEnabledCard.getByRole('checkbox').click();
  await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '禁用', exact: true }).click();
  await expect(page.getByText('已成功更新 1 个文件', { exact: true })).toBeVisible();

  const disabledCard = cards.filter({ hasText: selectedName });
  await expect(disabledCard.getByText('已停用', { exact: true })).toBeVisible();
  await disabledCard.getByRole('checkbox').click();
  await expect(page.getByText('已选 1 项', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '删除', exact: true }).last().click();
  const confirmation = page.getByRole('dialog');
  await expect(confirmation.getByText('删除选中文件', { exact: true })).toBeVisible();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText(selectedName, { exact: true })).toHaveCount(0);
  expect(await cards.count()).toBeLessThanOrEqual(25);
});
