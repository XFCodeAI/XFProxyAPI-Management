import { expect, test, type Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const pack = {
  id: 'pack:nerv',
  project: 'nerv',
  name: 'NERV-BREAK-5.6',
  version: 'fixture',
  source: 'fixture',
  source_revision: 'fixture',
  archive_filename: 'nerv-runtime.zip',
  read_only: true,
  license: {
    name: 'MIT',
    sha256: 'license',
    attribution: 'fixture',
    scope: 'runtime',
    distribution: 'bundled',
    conditions: [],
  },
  resources: [
    {
      id: 'bridge',
      path: 'bridge.md',
      kind: 'prompt',
      applicability: 'request-prompt',
      bytes: 8,
      newline_count: 1,
      line_endings: 'lf',
      sha256: 'bridge',
      previewable: true,
      exportable: true,
      local_only: false,
    },
    {
      id: 'tamper',
      path: 'tamper.rs',
      kind: 'response',
      applicability: 'response',
      bytes: 8,
      newline_count: 1,
      line_endings: 'lf',
      sha256: 'tamper',
      previewable: true,
      exportable: true,
      local_only: false,
    },
  ],
  capabilities: [
    {
      id: 'bridge-capability',
      name: 'NERV bridge instructions',
      kind: 'request-instruction',
      resource_ids: ['bridge'],
      carriers: ['openai-codex-responses'],
      modes: ['replace'],
      activatable: true,
    },
    {
      id: 'response-direct-capability',
      name: 'NERV direct response',
      kind: 'response-transform',
      resource_ids: ['tamper'],
      runtime_ref: 'external:nerv/response-direct',
      carriers: ['openai-codex-responses'],
      activatable: true,
      consent: 'response-modification',
    },
    {
      id: 'response-relay-capability',
      name: 'NERV relay response',
      kind: 'response-transform',
      resource_ids: ['tamper'],
      runtime_ref: 'external:nerv/response-relay',
      carriers: ['openai-codex-responses'],
      activatable: true,
      consent: 'response-modification',
    },
  ],
  activation_blueprints: [
    {
      id: 'bridge-blueprint',
      name: 'Replace NERV bridge instructions',
      capabilities: ['bridge-capability'],
      recommended_mode: 'replace',
    },
  ],
};

test('quick NERV binding keeps the target choice explicit', async ({ page }) => {
  const state: {
    activation?: Record<string, unknown>;
    rollback?: Record<string, unknown>;
  } = {};
  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config' || path === '/nodes' || path === '/plugins') return json(route, {});
    if (path === '/auth-files/events')
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 60000\n\n',
      });
    if (path === '/auth-files')
      return json(route, { files: [], total: 0, revision: 1, inventory_id: 'inventory-1' });
    if (path === '/prompt-rewrite' && request.method() === 'GET')
      return json(route, {
        'prompt-rewrite': {
          enabled: false,
          evaluation: 'first-match',
          assets: [],
          profiles: [],
          rules: [],
        },
        revision: 'prompt-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
      });
    if (path === '/prompt-rewrite/catalog')
      return json(route, {
        credentials: [
          {
            id: 'auth-1',
            display_name: 'Codex account',
            provider: 'codex',
            groups: ['builders'],
            carrier_supported: true,
          },
          {
            id: 'auth-2',
            display_name: 'Codex reviewer',
            provider: 'codex',
            groups: ['reviewers'],
            carrier_supported: true,
          },
        ],
        providers: [{ id: 'codex', carrier_supported: true, carrier_format: 'codex' }],
        credential_groups: ['builders', 'reviewers'],
        revision: 'prompt-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
        builtin_assets: [],
        builtin_packs: [],
      });
    if (path === '/response-tamper' && request.method() === 'GET')
      return json(route, {
        'response-tamper': { enabled: false, 'allow-replacement': false, assets: [], rules: [] },
        revision: 'response-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
      });
    if (path === '/capability-packs' && request.method() === 'GET')
      return json(route, {
        revision: 'packs-1',
        import_supported: true,
        packs: [
          { pack, bundled: false, installed: true, active_bindings: [], bindings: [] },
        ],
      });
    if (path.endsWith('/activation/simulate'))
      return json(route, {
        status: 'planned',
        plan: {
          fingerprint: 'plan-1',
          pack_id: pack.id,
          prompt_changed: true,
          response_changed: true,
          response_consent_required: true,
          required_consents: [],
          prompt_revision_before: 'prompt-1',
          response_revision_before: 'response-1',
          capability_ids: ['bridge-capability', 'response-direct-capability'],
          resource_ids: ['bridge', 'tamper'],
          targets: [{ type: 'credential-group', value: 'builders' }],
          replaced_binding_ids: [],
          simulation_fingerprint: 'sim-1',
        },
        simulation_fingerprint: 'sim-1',
        simulation: {
          kind: 'request',
          carrier: 'openai-response-json',
          changed: true,
          warnings: [],
        },
      });
    if (path.endsWith('/activate')) {
      state.activation = request.postDataJSON() as Record<string, unknown>;
      return json(route, {
        status: 'activated',
        plan: { fingerprint: 'plan-1', prompt_changed: true, response_changed: true },
        simulation_fingerprint: 'sim-1',
      });
    }
    if (path.endsWith('/activation/rollback')) {
      state.rollback = request.postDataJSON() as Record<string, unknown>;
      return json(route, { status: 'rolled_back', plan_fingerprint: 'plan-1' });
    }
    return json(route, {});
  });
  await page.goto('/#/login');
  await page.locator('input[name="cpa-management-key"]').fill('e2e-management-key');
  await page.locator('form').getByRole('button').last().click();
  await expect(page).not.toHaveURL(/#\/login$/);
  await page.evaluate(() => {
    window.location.hash = '/prompt-rewrite?advanced=1&tab=packs&target=credential-group&value=builders';
  });
  await expect(
    page.getByRole('heading', {
      name: /Codex 提示词|Codex prompts/i,
    })
  ).toBeVisible();
  await expect(page.getByText(/^(已连接|Connected)$/i)).toHaveCount(0);
  const initialTitleBox = await page
    .getByRole('heading', { name: /Codex 提示词|Codex prompts/i })
    .boundingBox();
  expect(initialTitleBox).not.toBeNull();
  for (const selector of ['.main-header .header-actions', '.main-header .mobile-sidebar-actions']) {
    const controlsBox = await page.locator(selector).boundingBox();
    if (controlsBox && initialTitleBox) {
      expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(initialTitleBox.y);
    }
  }
  await expect(page.getByText(/NERV-BREAK-5\.6/i).first()).toBeVisible();
  await expect(page.getByText(/固定版本|Pinned revision/i)).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: /NERV profile/i })).toBeVisible();
  await expect(
    page.getByRole('switch', { name: /允许覆盖现有提示词|Allow replacing existing prompts/i })
  ).toBeVisible();
  const activateButton = page.getByRole('button', { name: /激活|Activate/i });
  await expect(activateButton).toBeDisabled();
  await page
    .getByRole('switch', { name: /允许覆盖现有提示词|Allow replacing existing prompts/i })
    .click();
  await expect(page.getByRole('checkbox', { name: /^builders/i })).toBeChecked();
  await page.getByRole('checkbox', { name: /^reviewers/i }).click();
  await page.getByRole('radio', { name: /NERV Direct/i }).click();
  await page.getByRole('switch', { name: /允许响应改写|Allow response rewriting/i }).click();
  await page.getByRole('button', { name: /模拟|Simulate/i }).click();
  await expect(activateButton).toBeEnabled();
  await activateButton.click();
  await expect
    .poll(() => state.activation?.targets)
    .toEqual([
      { type: 'credential-group', value: 'builders' },
      { type: 'credential-group', value: 'reviewers' },
    ]);
  expect(state.activation?.mode).toBe('replace');
  expect(state.activation?.prompt_replace_consent).toBe(true);
  expect(state.activation?.replace_binding_ids ?? []).toEqual([]);
  expect(state.activation?.capability_ids).toContain('response-direct-capability');
  expect(state.activation?.capability_ids).not.toContain('response-relay-capability');
  await expect(page.getByText(/NERV Profile 已激活|NERV profile activated/i)).toBeVisible();
  await expect(
    page.getByText(/^(资产|Assets|来源层|Prompt content|Source layers|Profiles)$/i)
  ).toHaveCount(0);
  await page.getByRole('button', { name: /回滚|Rollback/i }).click();
  await expect.poll(() => state.rollback?.plan_fingerprint).toBe('plan-1');
  expect(state.rollback).not.toHaveProperty('plan');
  if ((page.viewportSize()?.width ?? 0) <= 768) {
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect
      .poll(() =>
        page.locator('.main-header').evaluate((element) => element.getBoundingClientRect().bottom)
      )
      .toBeLessThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.evaluate(() => document.querySelector('.content')?.scrollTo({ top: 0, left: 0 }));
  await page.screenshot({
    path: test.info().outputPath('quick-codex-binding.png'),
    fullPage: true,
  });
});
