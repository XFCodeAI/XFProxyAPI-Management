import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const nervPack = {
  schema_version: 1,
  id: 'pack:nerv',
  project: 'nerv',
  name: 'NERV-BREAK-5.6',
  version: 'nerv-revision-1',
  source: 'nerv',
  source_revision: 'nerv-revision-1',
  archive_filename: 'nerv-break-5.6-runtime.xfpack.zip',
  read_only: true,
  license: {
    name: 'NERV runtime subset',
    resource_id: 'pack:nerv/license',
    sha256: 'license',
    attribution: 'fixture',
    scope: 'runtime',
    distribution: 'eligible',
    conditions: [],
  },
  resources: [],
  capabilities: [
    {
      id: 'pack:nerv/capability/bridge',
      name: 'NERV bridge instructions',
      kind: 'request-instruction',
      resource_ids: [],
      carriers: ['openai-codex-responses'],
      modes: ['replace'],
      activatable: true,
    },
    {
      id: 'pack:nerv/capability/response-direct',
      name: 'NERV Direct response rules',
      kind: 'response-transform',
      resource_ids: [],
      runtime_ref: 'nerv-direct',
      carriers: ['openai-codex-responses'],
      activatable: true,
      consent: 'response-modification',
    },
    {
      id: 'pack:nerv/capability/response-relay',
      name: 'NERV Relay response rules',
      kind: 'response-transform',
      resource_ids: [],
      runtime_ref: 'nerv-relay',
      carriers: ['openai-codex-responses'],
      activatable: true,
      consent: 'response-modification',
    },
  ],
  activation_blueprints: [
    {
      id: 'pack:nerv/activation/bridge/replace',
      name: 'Replace NERV bridge',
      capabilities: ['pack:nerv/capability/bridge'],
      recommended_mode: 'replace',
    },
  ],
};

interface MockState {
  active: boolean;
  activation?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
  deactivation?: Record<string, unknown>;
}

const installMockAPI = async (page: Page, state: MockState) => {
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
        credentials: [
          {
            id: 'credential-1',
            display_name: 'Codex account',
            provider: 'codex',
            groups: ['builders'],
            carrier_supported: true,
          },
        ],
        providers: [{ id: 'codex', carrier_supported: true, carrier_format: 'codex' }],
        credential_groups: ['builders'],
        revision: 'prompt-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
        builtin_assets: [],
        builtin_packs: [],
      });
    }
    if (path === '/response-tamper' && request.method() === 'GET') {
      return routeJSON(route, {
        'response-tamper': { enabled: false, 'allow-replacement': false, assets: [], rules: [], programs: [] },
        revision: 'response-1',
        active_generation: 1,
        inventory_id: 'inventory-1',
        inventory_revision: 1,
      });
    }
    if (path === '/capability-packs' && request.method() === 'GET') {
      return routeJSON(route, {
        revision: 'packs-1',
        import_supported: false,
        packs: [
          {
            pack: nervPack,
            bundled: true,
            installed: true,
            active_bindings: state.active ? ['rule:nerv-bridge'] : [],
            bindings: state.active
              ? [
                  {
                    id: 'binding-1',
                    state: 'active',
                    operation: 'request-instruction',
                    targets: [{ type: 'credential-group', value: 'builders' }],
                  },
                ]
              : [],
          },
        ],
      });
    }
    if (path.endsWith('/activation/simulate')) {
      return routeJSON(route, {
        status: 'planned',
        plan: {
          fingerprint: 'plan-1',
          prompt_changed: true,
          response_changed: true,
          response_consent_required: true,
          required_consents: [],
          replaced_binding_ids: [],
          replaced_prompt_rule_ids: [],
          replaced_response_rule_ids: [],
          simulation_fingerprint: 'simulation-1',
          simulation: { changed: true, warnings: [] },
        },
        simulation_fingerprint: 'simulation-1',
        simulation: { changed: true, warnings: [] },
      });
    }
    if (path.endsWith('/activate')) {
      state.active = true;
      state.activation = request.postDataJSON() as Record<string, unknown>;
      return routeJSON(route, {
        status: 'activated',
        plan: { fingerprint: 'plan-1', prompt_changed: true, response_changed: true },
        simulation_fingerprint: 'simulation-1',
      });
    }
    if (path.endsWith('/activation/rollback')) {
      state.active = false;
      state.rollback = request.postDataJSON() as Record<string, unknown>;
      return routeJSON(route, { status: 'rolled_back', plan_fingerprint: 'plan-1' });
    }
    if (path.endsWith('/deactivate')) {
      state.active = false;
      state.deactivation = request.postDataJSON() as Record<string, unknown>;
      return routeJSON(route, { status: 'deactivated' });
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

test('legacy management links resolve to the NERV workflow only', async ({ page }) => {
  const state: MockState = { active: false };
  await installMockAPI(page, state);
  await login(page);
  await page.evaluate(() => {
    window.location.hash = '/prompt-rewrite?advanced=1&tab=packs&target=credential-group&value=builders';
  });

  await expect(page.getByRole('heading', { name: /Codex prompts|Codex 提示词/i })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /NERV profile|NERV Profile/i })).toBeVisible();
  await expect(page.getByText('builders', { exact: true }).first()).toBeVisible();

  for (const retiredLabel of ['Assets', 'Source layers', 'Source packs', 'Profiles', 'Bindings', 'Response tamper']) {
    await expect(page.getByText(retiredLabel, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /Advanced management|高级管理/i })).toHaveCount(0);

  await page.getByRole('switch', { name: /Allow replacing existing prompts|允许覆盖现有提示词/i }).click();
  await page.getByRole('radio', { name: /NERV Direct/i }).click();
  await page.getByRole('switch', { name: /Allow response rewriting|允许响应改写/i }).click();
  await page.getByRole('button', { name: /Simulate|模拟/i }).click();
  await page.getByRole('button', { name: /Activate|激活/i }).click();
  await expect.poll(() => state.activation?.targets).toEqual([
    { type: 'credential-group', value: 'builders' },
  ]);
  expect(state.activation?.prompt_replace_consent).toBe(true);
  expect(state.activation?.response_modification_consent).toBe(true);
  await expect(page.getByText(/NERV profile activated|NERV Profile 已激活/i)).toBeVisible();

  await page.getByRole('button', { name: /Rollback|回滚/i }).click();
  await expect.poll(() => state.rollback?.plan_fingerprint).toBe('plan-1');
});
