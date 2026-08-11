import { expect, test, type Page, type Route } from '@playwright/test';

const routeJSON = (
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });

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

const runtimeIdentity = (supplierId: string, entryId: string) => ({
  supplier_id: supplierId,
  entry_id: entryId,
  auth_id: `${entryId}-auth`,
  credential_generation: 1,
  availability_revision: 1,
  availability_state: 'ready',
});

const entries = [
  {
    target_id: 'supplier:codex',
    supplier_id: 'supplier-codex-0',
    entry_id: 'codex-primary',
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
    runtime: runtimeIdentity('supplier-codex-0', 'codex-primary'),
  },
  {
    target_id: 'supplier:openai-a',
    supplier_id: 'supplier-openai-0',
    entry_id: 'openai-primary',
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
    runtime: runtimeIdentity('supplier-openai-0', 'openai-primary'),
  },
  {
    target_id: 'supplier:openai-b',
    supplier_id: 'supplier-openai-0',
    entry_id: 'openai-backup',
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
    runtime: runtimeIdentity('supplier-openai-0', 'openai-backup'),
  },
  {
    target_id: 'supplier:xai',
    supplier_id: 'supplier-xai-0',
    entry_id: 'xai-primary',
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
    runtime: runtimeIdentity('supplier-xai-0', 'xai-primary'),
  },
  {
    target_id: 'supplier:claude',
    supplier_id: 'supplier-claude-0',
    entry_id: 'claude-primary',
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
    runtime: runtimeIdentity('supplier-claude-0', 'claude-primary'),
  },
  {
    target_id: 'supplier:kimi-openai',
    supplier_id: 'supplier-kimi-openai',
    entry_id: 'kimi-openai-primary',
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
    runtime: runtimeIdentity('supplier-kimi-openai', 'kimi-openai-primary'),
  },
  {
    target_id: 'supplier:kimi-claude',
    supplier_id: 'supplier-kimi-claude',
    entry_id: 'kimi-claude-primary',
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
    runtime: runtimeIdentity('supplier-kimi-claude', 'kimi-claude-primary'),
  },
  {
    target_id: 'supplier:kimi-name-collision',
    supplier_id: 'supplier-kimi-collision',
    entry_id: 'kimi-collision-primary',
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
    runtime: runtimeIdentity('supplier-kimi-collision', 'kimi-collision-primary'),
  },
];

const installMockAPI = async (page: Page) => {
  const calls = {
    list: 0,
    listResourceScopes: [] as string[],
    probe: 0,
    probeTargets: [] as string[],
    recovery: 0,
    recoverySupplierIds: [] as string[],
    eventNetwork: 0,
  };
  const snapshotId = 'supplier-snapshot-e2e';
  let snapshotRevision = 1;
  let snapshotEntries = entries.map((entry) => ({ ...entry }));
  let recoveryResponse: unknown = null;
  let recoveryGate: Promise<void> | null = null;
  let releaseRecoveryGate: (() => void) | null = null;
  const snapshotHeaders = () => ({
    ETag: `W/"supplier-billing-${snapshotId}-${snapshotRevision}"`,
    'X-Supplier-Billing-Snapshot-ID': snapshotId,
    'X-Supplier-Billing-Revision': String(snapshotRevision),
  });
  await page.addInitScript(() => {
    const eventState = {
      connections: 0,
      requests: [] as Array<{ since: string; lastEventId: string }>,
      controller: null as ReadableStreamDefaultController<Uint8Array> | null,
      emit: (events: Array<{ revision: number; target_ids?: string[] }>) => {
        const controller = eventState.controller;
        if (!controller) return;
        const body = events
          .map(
            (event) =>
              `id: ${event.revision}\nevent: supplier-billing-probe\ndata: ${JSON.stringify({
                snapshot_id: 'supplier-snapshot-e2e',
                revision: event.revision,
                server_time: '2026-08-06T00:00:00Z',
                target_ids: event.target_ids ?? [],
              })}\n\n`
          )
          .join('');
        try {
          controller.enqueue(new TextEncoder().encode(body));
        } catch {
          eventState.controller = null;
        }
      },
      disconnect: () => {
        const controller = eventState.controller;
        eventState.controller = null;
        try {
          controller?.error(new Error('supplier billing stream disconnected'));
        } catch {
          // The stream may already be closed by an abort.
        }
      },
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const requestURL = new URL(request?.url ?? String(input), window.location.href);
      if (!requestURL.pathname.endsWith('/v0/management/supplier-billing-probes/events')) {
        return originalFetch(input, init);
      }
      const headers = new Headers(init?.headers ?? request?.headers);
      eventState.connections += 1;
      eventState.requests.push({
        since: requestURL.searchParams.get('since') ?? '',
        lastEventId: headers.get('Last-Event-ID') ?? '',
      });
      const signal = init?.signal ?? request?.signal;
      const response = new Response(
        new ReadableStream({
          start(controller) {
            eventState.controller = controller;
            const close = () => {
              if (eventState.controller !== controller) return;
              eventState.controller = null;
              try {
                controller.close();
              } catch {
                // The stream may already be closed.
              }
            };
            if (signal?.aborted) {
              close();
            } else {
              signal?.addEventListener('abort', close, { once: true });
            }
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
      return response;
    };
    (
      window as Window & { __supplierBillingEventState?: typeof eventState }
    ).__supplierBillingEventState = eventState;
  });
  await page.route('**/v0/management/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/v0\/management/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path === '/config') return routeJSON(route, config);
    if (path === '/supplier-billing-probes/events') {
      calls.eventNetwork += 1;
      return routeJSON(
        route,
        { error: 'event stream should be handled by the browser harness' },
        500
      );
    }
    if (path === '/supplier-billing-probes/availability/reprobe' && request.method() === 'POST') {
      calls.recovery += 1;
      const supplierId = (request.postDataJSON() as { supplier_id: string }).supplier_id;
      calls.recoverySupplierIds.push(supplierId);
      if (recoveryGate) await recoveryGate;
      const supplierEntries = snapshotEntries.filter((entry) => entry.supplier_id === supplierId);
      return routeJSON(
        route,
        recoveryResponse ?? {
          status: 'accepted',
          supplier_id: supplierId,
          requested: supplierEntries.length,
          eligible: supplierEntries.length,
          queued: supplierEntries.length,
          already_probing: 0,
          skipped: {},
          maximum_parallel: 4,
          entries: supplierEntries.map((entry) => ({
            supplier_id: entry.supplier_id,
            entry_id: entry.entry_id,
            status: 'queued',
            runtime: { ...entry.runtime, availability_state: 'probing' },
          })),
        },
        202
      );
    }
    if (path === '/supplier-billing-probes') {
      if (request.method() === 'POST') {
        calls.probe += 1;
        const targetId = (request.postDataJSON() as { target_id: string }).target_id;
        calls.probeTargets.push(targetId);
        const entry = snapshotEntries.find((candidate) => candidate.target_id === targetId);
        if (!entry) return routeJSON(route, { error: 'target not found' }, 404);
        return routeJSON(route, { ...entry, queued: true }, 202, snapshotHeaders());
      }
      calls.list += 1;
      calls.listResourceScopes.push(url.searchParams.get('resource_keys') ?? '');
      const headers = snapshotHeaders();
      if (request.headers()['if-none-match'] === headers.ETag) {
        return route.fulfill({ status: 304, headers });
      }
      return routeJSON(
        route,
        {
          provider_name: '',
          snapshot_id: snapshotId,
          revision: snapshotRevision,
          server_time: '2026-08-06T00:00:00Z',
          entries: snapshotEntries,
        },
        200,
        headers
      );
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
  return {
    calls,
    setSnapshot: (nextEntries: typeof entries, revision = snapshotRevision + 1) => {
      snapshotEntries = nextEntries.map((entry) => ({ ...entry }));
      snapshotRevision = revision;
    },
    setRecoveryResponse: (response: unknown) => {
      recoveryResponse = response;
    },
    holdRecovery: () => {
      recoveryGate = new Promise<void>((resolve) => {
        releaseRecoveryGate = resolve;
      });
    },
    releaseRecovery: () => {
      releaseRecoveryGate?.();
      releaseRecoveryGate = null;
      recoveryGate = null;
    },
    emitEvents: async (events: Array<{ revision: number; target_ids?: string[] }>) => {
      await page.evaluate((nextEvents) => {
        const state = (
          window as Window & {
            __supplierBillingEventState?: {
              emit: (events: Array<{ revision: number; target_ids?: string[] }>) => void;
            };
          }
        ).__supplierBillingEventState;
        state?.emit(nextEvents);
      }, events);
    },
    disconnectStream: async () => {
      await page.evaluate(() => {
        const state = (
          window as Window & {
            __supplierBillingEventState?: { disconnect: () => void };
          }
        ).__supplierBillingEventState;
        state?.disconnect();
      });
    },
    streamState: async () =>
      page.evaluate(() => {
        const state = (
          window as Window & {
            __supplierBillingEventState?: {
              connections: number;
              requests: Array<{ since: string; lastEventId: string }>;
            };
          }
        ).__supplierBillingEventState;
        return { connections: state?.connections ?? 0, requests: state?.requests ?? [] };
      }),
  };
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
  const mock = await installMockAPI(page);
  const { calls } = mock;
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
  expect(calls.listResourceScopes[0]).toBe('');
  expect(calls.probe).toBe(0);
  expect(calls.eventNetwork).toBe(0);
  expect((await mock.streamState()).connections).toBe(1);
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
  expect(calls.list).toBe(1);
  expect((await mock.streamState()).connections).toBe(1);

  const refreshButtons = page.getByRole('button', {
    name: /刷新倍率与额度|Refresh multiplier and balance/,
  });
  await refreshButtons.nth(0).click();
  await expect.poll(() => calls.probe).toBe(1);
  await expect(refreshButtons.nth(0)).toBeDisabled();
  await refreshButtons.nth(1).click();
  await expect.poll(() => calls.probe).toBe(2);
  expect(calls.probeTargets).toEqual(['supplier:kimi-openai', 'supplier:kimi-claude']);
  mock.setSnapshot(entries, 2);
  await mock.emitEvents([
    { revision: 2, target_ids: ['supplier:kimi-openai', 'supplier:kimi-claude'] },
  ]);
  await expect.poll(() => calls.list).toBe(2);
  await expect(refreshButtons.nth(0)).toBeEnabled();
  await expect(refreshButtons.nth(1)).toBeEnabled();
  expect((await mock.streamState()).connections).toBe(1);

  await page.screenshot({
    path: testInfo.outputPath('provider-billing-list.png'),
    fullPage: true,
  });
});

test('supplier recovery is live, deduplicated, and preserves filters and editor drafts', async ({
  page,
}) => {
  const waitingEntries = entries.map((entry) => {
    if (entry.entry_id !== 'openai-primary') return entry;
    return {
      ...entry,
      usage: {
        ...usage(12),
        status: 'failed',
        last_error: 'preserve existing usage error',
      },
      runtime: {
        ...entry.runtime,
        availability_state: 'usage_wait',
        availability_deadline: '2026-08-02T11:00:00Z',
        availability_reason: 'usage_exhausted',
        provider_code: 'verified_zero_balance',
      },
    };
  });
  const primary = waitingEntries.find((entry) => entry.entry_id === 'openai-primary')!;
  const mock = await installMockAPI(page);
  mock.setSnapshot(waitingEntries, 2);
  mock.setRecoveryResponse({
    status: 'accepted',
    supplier_id: 'supplier-openai-0',
    requested: 2,
    eligible: 1,
    queued: 1,
    already_probing: 0,
    skipped: { missing_runtime: 1 },
    maximum_parallel: 4,
    entries: [
      {
        supplier_id: 'supplier-openai-0',
        entry_id: 'openai-primary',
        status: 'queued',
        runtime: { ...primary.runtime, availability_state: 'probing' },
      },
      {
        supplier_id: 'supplier-openai-0',
        entry_id: 'openai-backup',
        status: 'skipped',
        reason: 'missing_runtime',
      },
    ],
  });
  mock.holdRecovery();
  await login(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'openaiCompatibility', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });

  const filterInput = page.locator('input[type="search"]').first();
  await filterInput.fill('Shared upstream');
  await expect(page.getByText(/额度等待：余额已耗尽|Usage wait: Balance exhausted/)).toBeVisible();
  await expect(page.getByText('12 USD', { exact: true })).toBeVisible();
  await expect(page.getByText(/Next probe|下次探测/)).toBeVisible();
  await page
    .getByRole('button', { name: /编辑|Edit/ })
    .first()
    .click();
  const draftInput = page.getByRole('textbox', { name: /名称|Name/ }).first();
  await draftInput.fill('Shared upstream unsaved draft');
  await page.evaluate(() => {
    (window as Window & { __supplierRecoveryNoReload?: string }).__supplierRecoveryNoReload =
      'preserved';
  });

  const recoveryButton = page
    .locator(
      'button[aria-label="验证并恢复供应商调度"], button[aria-label="Validate and recover supplier availability"], button[aria-label="正在恢复供应商可用性"], button[aria-label="Supplier availability recovery in progress"]'
    )
    .first();
  await recoveryButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => mock.calls.recovery).toBe(1);
  expect(mock.calls.recoverySupplierIds).toEqual(['supplier-openai-0']);
  await expect(recoveryButton).toBeDisabled();
  await expect(draftInput).toHaveValue('Shared upstream unsaved draft');
  await expect(filterInput).toHaveValue('Shared upstream');

  mock.releaseRecovery();
  await expect(page.getByText(/已排队 1 个.*跳过 1 个|Queued 1.*skipped 1/)).toBeVisible();
  await expect(
    page.getByText(/backup：运行时 API Key 不可用|backup: Runtime API key is unavailable/)
  ).toBeVisible();
  await expect(draftInput).toHaveValue('Shared upstream unsaved draft');
  await expect(filterInput).toHaveValue('Shared upstream');
  await expect(page.locator('body')).toContainText(/探测失败|Probe failed/);
  expect(
    await page.evaluate(
      () => (window as Window & { __supplierRecoveryNoReload?: string }).__supplierRecoveryNoReload
    )
  ).toBe('preserved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test('slow manual billing refresh keeps its terminal result after an intermediate probing read', async ({
  page,
}) => {
  const refreshedEntry = {
    ...entries[1],
    multiplier: multiplier('1.5'),
    usage: usage(99),
  };
  const mock = await installMockAPI(page);
  const { calls } = mock;
  await login(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'openaiCompatibility', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });

  await expect(page.getByText('1.25x', { exact: true })).toBeVisible();
  const refreshButtons = page.getByRole('button', {
    name: /刷新倍率与额度|Refresh multiplier and balance/,
  });
  await refreshButtons.nth(0).click();
  await expect.poll(() => calls.probe).toBe(1);
  await expect(page.getByText('1.25x', { exact: true })).toBeVisible();
  expect(calls.list).toBe(1);
  mock.setSnapshot([refreshedEntry, ...entries.slice(2)], 2);
  await mock.emitEvents([{ revision: 2, target_ids: [refreshedEntry.target_id] }]);
  await expect(page.getByText('1.5x', { exact: true })).toBeVisible({ timeout: 7_000 });
  await expect(page.getByText('99 USD', { exact: true })).toBeVisible();
  await expect(page.getByText(/正在探测|Probing/)).toHaveCount(0);
  expect(calls.list).toBe(2);
  expect((await mock.streamState()).connections).toBe(1);
});

test('billing burst events coalesce and stream disconnect falls back before reconnecting', async ({
  page,
}) => {
  const terminalEntries = entries.map((entry) =>
    entry === entries[1] ? { ...entry, multiplier: multiplier('1.6'), usage: usage(88) } : entry
  );
  const mock = await installMockAPI(page);
  const { calls } = mock;
  await login(page);
  await page.evaluate(() => {
    window.localStorage.setItem(
      'providersPage.uiState',
      JSON.stringify({ activeBrand: 'openaiCompatibility', filtersByBrand: {} })
    );
    window.location.hash = '/ai-providers';
  });

  mock.setSnapshot(terminalEntries, 3);
  await mock.emitEvents([
    { revision: 2, target_ids: [entries[1].target_id] },
    { revision: 3, target_ids: [entries[1].target_id] },
  ]);
  await expect(page.getByText('1.6x', { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('88 USD', { exact: true })).toBeVisible();
  expect(calls.list).toBe(2);
  await mock.disconnectStream();
  await expect.poll(() => calls.list).toBe(3);
  await expect
    .poll(async () => (await mock.streamState()).connections)
    .toBe(2, {
      timeout: 7_000,
    });
  const streamState = await mock.streamState();
  expect(streamState.requests.at(-1)).toEqual({ since: '3', lastEventId: '3' });
  expect(calls.eventNetwork).toBe(0);
});
