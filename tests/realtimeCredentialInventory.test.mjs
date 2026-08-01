import assert from 'node:assert/strict';
import { createServer } from 'vite';

const browserWindow = new EventTarget();
browserWindow.setTimeout = setTimeout;
browserWindow.clearTimeout = clearTimeout;
globalThis.window = browserWindow;

const waitForInventoryRefresh = () => new Promise((resolve) => setTimeout(resolve, 120));

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const catalogModule = await server.ssrLoadModule(
    '/src/features/authFiles/credentialIdentityCatalog.ts'
  );
  const monitoringViewModel = await server.ssrLoadModule(
    '/src/features/requestMonitoring/viewModel.ts'
  );
  const analyticsViewModel = await server.ssrLoadModule(
    '/src/features/usageAnalytics/viewModel.ts'
  );
  const coalescedModule = await server.ssrLoadModule('/src/hooks/useCoalescedAsyncTask.ts');
  const authFilesApiModule = await server.ssrLoadModule('/src/services/api/authFiles.ts');
  const inventoryStoreModule = await server.ssrLoadModule('/src/stores/useAuthInventoryStore.ts');

  const staleCatalog = [
    {
      recordedId: 'used-deleted',
      displayName: 'historical-name.json',
      provider: 'codex',
      currentId: 'used-deleted',
      current: true,
      hasUsage: true,
    },
    {
      recordedId: 'zero-deleted',
      displayName: 'zero-deleted.json',
      provider: 'codex',
      currentId: 'zero-deleted',
      current: true,
      hasUsage: false,
    },
  ];
  const currentFiles = [
    { id: 'new-current', name: 'new-current.json', provider: 'codex', groups: ['Primary'] },
  ];
  const reconciled = catalogModule.reconcileCredentialIdentityCatalog(staleCatalog, currentFiles);
  assert.deepEqual(
    reconciled.map((entry) => [entry.recordedId, entry.current, entry.hasUsage]),
    [
      ['used-deleted', false, true],
      ['new-current', true, false],
    ]
  );
  assert.equal(reconciled[0].displayName, 'historical-name.json');

  const filters = { ...monitoringViewModel.EMPTY_MONITORING_FILTERS };
  const monitoringRows = monitoringViewModel.mergeMonitoringCredentialRows(
    [
      {
        recordedId: 'used-deleted',
        displayName: 'historical-name.json',
        provider: 'codex',
        requests: 4,
        failures: 1,
        totalTokens: 20,
        averageLatencyMs: 100,
        lastRequestAt: '2026-07-26T00:00:00Z',
        currentId: 'used-deleted',
        current: true,
      },
    ],
    reconciled,
    filters
  );
  assert.deepEqual(
    monitoringRows.map((entry) => [entry.recordedId, entry.requests, entry.current]),
    [
      ['used-deleted', 4, false],
      ['new-current', 0, true],
    ]
  );

  const zeroCost = {
    amount: '0',
    currency: 'USD',
    completeCalls: 0,
    partialCalls: 0,
    unpricedCalls: 0,
    freeCalls: 0,
    coverageRate: 1,
    missingDimensions: {},
  };
  const metrics = {
    calls: 4,
    successes: 3,
    failures: 1,
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 15,
    cacheHits: 0,
    cacheHitRate: 0,
    averageLatencyMs: 100,
    p95LatencyMs: 100,
    averageTtftMs: 20,
    p95TtftMs: 20,
    cost: zeroCost,
  };
  const rankings = analyticsViewModel.mergeAnalyticsCredentialRankings(
    [
      {
        identity: {
          recordedId: 'used-deleted',
          displayName: 'historical-name.json',
          provider: 'codex',
          resolvedModel: '',
          requestedModel: '',
          current: true,
          currentId: 'used-deleted',
        },
        metrics,
        comparison: metrics,
      },
    ],
    reconciled,
    filters,
    'USD'
  );
  assert.deepEqual(
    rankings.map((entry) => [
      entry.identity.recordedId,
      entry.metrics.calls,
      entry.identity.current,
    ]),
    [
      ['used-deleted', 4, false],
      ['new-current', 0, true],
    ]
  );
  assert.equal(
    rankings.reduce((total, entry) => total + entry.metrics.calls, 0),
    4
  );

  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const runner = coalescedModule.createCoalescedAsyncTask(async () => {
    calls += 1;
    if (calls === 1) await firstBlocked;
  });
  const firstRun = runner.run();
  void runner.run();
  void runner.run();
  assert.equal(calls, 1);
  releaseFirst();
  await firstRun;
  assert.equal(calls, 2);

  const originalList = authFilesApiModule.authFilesApi.list;
  let resolveStaleInventory;
  authFilesApiModule.authFilesApi.list = () =>
    new Promise((resolve) => {
      resolveStaleInventory = resolve;
    });
  const inventoryStore = inventoryStoreModule.useAuthInventoryStore;
  inventoryStore.setState({
    files: [{ id: 'before-sse', name: 'before-sse.json', provider: 'codex' }],
    inventoryId: 'inventory-race',
    revision: 4,
    loading: false,
    error: '',
  });
  const staleRefresh = inventoryStore.getState().refresh(true);
  inventoryStore.setState({
    files: [{ id: 'after-sse', name: 'after-sse.json', provider: 'codex' }],
    inventoryId: 'inventory-race',
    revision: 5,
  });
  resolveStaleInventory({
    files: [{ id: 'stale-http', name: 'stale-http.json', provider: 'codex' }],
    inventory_id: 'inventory-race',
    revision: 4,
  });
  const acceptedSnapshot = await staleRefresh;
  assert.equal(inventoryStore.getState().files[0].id, 'after-sse');
  assert.equal(inventoryStore.getState().revision, 5);
  assert.equal(acceptedSnapshot.files[0].id, 'after-sse');
  assert.equal(acceptedSnapshot.revision, 5);

  const survivor = {
    id: 'auth-b',
    name: 'auth-b.json',
    provider: 'codex',
    status: 'error',
    statusMessage: 'quota exhausted',
    unavailable: true,
  };
  let inventoryLoads = 0;
  authFilesApiModule.authFilesApi.list = async () => {
    inventoryLoads += 1;
    return {
      files: [survivor],
      inventory_id: 'inventory-targeted',
      revision: 15,
    };
  };
  inventoryStore.setState({
    files: [{ id: 'auth-a', name: 'auth-a.json', provider: 'codex', disabled: false }, survivor],
    inventoryId: 'inventory-targeted',
    revision: 10,
    loading: false,
    error: '',
  });
  inventoryStoreModule.applyInventoryEvent({
    inventoryId: 'inventory-targeted',
    revision: 11,
    action: 'updated',
    ids: ['auth-a'],
    files: [{ id: 'auth-a', name: 'auth-a.json', provider: 'codex', disabled: true }],
  });
  assert.equal(inventoryStore.getState().files[0].disabled, true);
  assert.deepEqual(inventoryStore.getState().files[1], survivor);
  inventoryStoreModule.applyInventoryEvent({
    inventoryId: 'inventory-targeted',
    revision: 12,
    action: 'deleted',
    ids: ['auth-a'],
    files: [],
  });
  assert.deepEqual(inventoryStore.getState().files, [survivor]);
  inventoryStoreModule.applyInventoryEvent({
    inventoryId: 'inventory-targeted',
    revision: 11,
    action: 'updated',
    ids: ['auth-b'],
    files: [{ ...survivor, statusMessage: '' }],
  });
  await waitForInventoryRefresh();
  assert.equal(inventoryLoads, 0);
  assert.deepEqual(inventoryStore.getState().files, [survivor]);

  inventoryStore
    .getState()
    .setFiles((current) =>
      current.map((file) => (file.id === 'auth-b' ? { ...file, disabled: true } : file))
    );
  inventoryStore
    .getState()
    .commitMutationVersion('inventory-targeted', 13, [
      { ...survivor, disabled: true, disable_cooling: true },
    ]);
  await waitForInventoryRefresh();
  assert.equal(inventoryLoads, 0);
  assert.equal(inventoryStore.getState().revision, 13);
  assert.equal(inventoryStore.getState().files[0].statusMessage, 'quota exhausted');
  assert.equal(inventoryStore.getState().files[0].disable_cooling, true);

  inventoryStoreModule.applyInventoryEvent({
    inventoryId: 'inventory-targeted',
    revision: 15,
    action: 'updated',
    ids: ['auth-b'],
    files: [{ ...survivor, statusMessage: 'newer error' }],
  });
  await waitForInventoryRefresh();
  assert.equal(inventoryLoads, 1);
  assert.equal(inventoryStore.getState().revision, 15);
  assert.deepEqual(inventoryStore.getState().files, [survivor]);

  authFilesApiModule.authFilesApi.list = async () => {
    inventoryLoads += 1;
    return {
      files: [{ id: 'replacement', name: 'replacement.json', provider: 'claude' }],
      inventory_id: 'inventory-replacement',
      revision: 1,
    };
  };
  inventoryStoreModule.applyInventoryEvent({
    inventoryId: 'inventory-replacement',
    revision: 1,
    action: 'reconciled',
    ids: [],
    files: [],
  });
  await waitForInventoryRefresh();
  assert.equal(inventoryLoads, 2);
  assert.equal(inventoryStore.getState().inventoryId, 'inventory-replacement');
  assert.equal(inventoryStore.getState().files[0].id, 'replacement');

  authFilesApiModule.authFilesApi.list = async () => {
    inventoryLoads += 1;
    return {
      files: [{ id: 'replacement', name: 'replacement.json', provider: 'claude', disabled: true }],
      inventory_id: 'inventory-replacement',
      revision: 2,
    };
  };
  inventoryStoreModule.applyInventoryEvent({
    inventoryId: 'inventory-replacement',
    revision: 2,
    action: 'reconciled',
    ids: [],
    files: [],
  });
  await waitForInventoryRefresh();
  assert.equal(inventoryLoads, 3);
  assert.equal(inventoryStore.getState().files[0].disabled, true);
  authFilesApiModule.authFilesApi.list = originalList;
} finally {
  await server.close();
}
