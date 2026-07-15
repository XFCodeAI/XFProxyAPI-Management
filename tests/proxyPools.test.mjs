import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const proxyPools = await server.ssrLoadModule('/src/services/api/proxyPools.ts');
  const authFiles = await server.ssrLoadModule('/src/services/api/authFiles.ts');
  const statusRefresh = await server.ssrLoadModule('/src/features/proxyPools/statusRefresh.ts');

  const reconciliation = authFiles.normalizeAuthFileReconciliationResult({
    status: 'completed',
    inventory_id: 'inventory-1',
    revision: 7,
    scanned: { credentials: 3, proxy_bindings: 2 },
    removed: { credentials: 1, proxy_bindings: 1, group_bindings: 2 },
    repaired: { cleanup_entries: 1 },
    pending: { cleanup_entries: 0 },
    failed: {},
  });
  assert.equal(reconciliation.status, 'completed');
  assert.equal(reconciliation.inventoryId, 'inventory-1');
  assert.equal(reconciliation.revision, 7);
  assert.equal(reconciliation.scanned.credentials, 3);
  assert.equal(reconciliation.removed.groupBindings, 2);
  assert.equal(reconciliation.repaired.cleanupEntries, 1);
  assert.equal(reconciliation.pending.cleanupEntries, 0);

  const malformedReconciliation = authFiles.normalizeAuthFileReconciliationResult({
    status: 'unexpected',
    revision: -1,
    failed: { cleanup_entries: '2' },
  });
  assert.equal(malformedReconciliation.status, 'partial');
  assert.equal(malformedReconciliation.revision, 0);
  assert.equal(malformedReconciliation.failed.cleanupEntries, 2);

  const legacy = proxyPools.parseConfigSnapshot(`
proxy-pools:
  - name: main
    enabled: true
    protocol: http
    host: 127.0.0.1
    port: 7890
`);
  assert.equal(legacy.pools[0].excludeFromSmartAssignment, false);

  const manualOnly = proxyPools.parseConfigSnapshot(`
proxy-pools:
  - name: main
    enabled: true
    exclude-from-smart-assignment: true
    protocol: http
    host: 127.0.0.2
    port: 7890
`);
  assert.equal(manualOnly.pools[0].excludeFromSmartAssignment, true);

  const serializedManualOnly = proxyPools.serializeProxyPool(manualOnly.pools[0]);
  assert.equal(serializedManualOnly['exclude-from-smart-assignment'], true);
  const serializedLegacy = proxyPools.serializeProxyPool(legacy.pools[0]);
  assert.equal(Object.hasOwn(serializedLegacy, 'exclude-from-smart-assignment'), false);

  const [status] = proxyPools.normalizeStatusResponse({
    pools: [
      {
        id: 'manual-only',
        name: 'main',
        enabled: true,
        exclude_from_smart_assignment: true,
        protocol: 'http',
        host: '127.0.0.2',
        port: 7890,
        assigned_count: 2,
        assigned_to: [],
      },
    ],
  });
  assert.equal(status.excludeFromSmartAssignment, true);
  assert.equal(proxyPools.isProxyPoolSelectable(status), true);
  assert.equal(proxyPools.isProxyPoolSmartAssignable(status), false);
  assert.equal(status.assignedCount, 0);
  assert.deepEqual(status.assignedTo, []);

  const [explicitZero] = proxyPools.normalizeStatusResponse({
    pools: [
      {
        id: 'explicit-zero',
        assigned_count: 0,
        assigned_to: [{ id: 'deleted-auth', provider: 'codex' }],
      },
    ],
  });
  assert.equal(explicitZero.assignedCount, 0);
  assert.deepEqual(explicitZero.assignedTo, []);

  const [missingCount] = proxyPools.normalizeStatusResponse({
    pools: [
      {
        id: 'missing-count',
        assigned_to: [{ id: 'auth-1', provider: 'codex' }],
      },
    ],
  });
  assert.equal(missingCount.assignedCount, 1);

  const [inconsistentCount] = proxyPools.normalizeStatusResponse({
    pools: [
      {
        id: 'inconsistent-count',
        assigned_count: 9,
        assigned_to: [{ id: 'auth-1', provider: 'codex' }],
      },
    ],
  });
  assert.equal(inconsistentCount.assignedCount, 1);

  const [emptyCount] = proxyPools.normalizeStatusResponse({
    pools: [
      {
        id: 'empty-count',
        assigned_count: '',
        assigned_to: [{ id: 'auth-1', provider: 'codex' }],
      },
    ],
  });
  assert.equal(emptyCount.assignedCount, 1);

  assert.equal(
    proxyPools.parseProxyPoolURL('http://127.0.0.1:7890').excludeFromSmartAssignment,
    false
  );

  const preview = proxyPools.normalizeProxyPoolRebalancePreview({
    eligible: true,
    worthwhile: false,
    reason: 'already_balanced',
    max_difference: 0,
    maxDifference: 9,
    current_difference: 0,
    currentDifference: 8,
    move_count: 0,
    moveCount: 7,
    total_bindings: 0,
    totalBindings: 6,
    revision: 'revision-1',
    pools: [
      {
        id: 'proxy-a',
        name: 'main',
        redacted_url: 'http://proxy-a.example:8080',
        eligible: true,
        current_count: 0,
        currentCount: 5,
        target_count: 0,
        targetCount: 4,
        credential_count: 0,
        credentialCount: 3,
        provider_api_key_count: 0,
        providerApiKeyCount: 2,
      },
    ],
  });
  assert.equal(preview.maxDifference, 0);
  assert.equal(preview.currentDifference, 0);
  assert.equal(preview.moveCount, 0);
  assert.equal(preview.totalBindings, 0);
  assert.equal(preview.pools[0].currentCount, 0);
  assert.equal(preview.pools[0].targetCount, 0);
  assert.equal(preview.pools[0].credentialCount, 0);
  assert.equal(preview.pools[0].providerApiKeyCount, 0);

  const stale = proxyPools.normalizeProxyPoolRebalanceResult({
    status: 'stale',
    moved: 0,
    preview: {
      reason: 'within_threshold',
      revision: 'revision-2',
    },
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.preview.revision, 'revision-2');

  const partial = proxyPools.normalizeProxyPoolRebalanceResult({
    status: 'partial',
    moved: 1,
    skipped: 2,
    failed: 1,
    failures: [
      {
        resource_id: 'auth-1',
        kind: 'credential',
        error: 'rollback failed',
      },
    ],
    preview: { revision: 'revision-3' },
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.moved, 1);
  assert.equal(partial.skipped, 2);
  assert.equal(partial.failed, 1);
  assert.deepEqual(partial.failures, [
    {
      resourceId: 'auth-1',
      kind: 'credential',
      error: 'rollback failed',
    },
  ]);

  let resolveStaleRequest;
  let loadCount = 0;
  const snapshots = [];
  const coordinator = statusRefresh.createStatusSnapshotCoordinator({
    load: () => {
      loadCount += 1;
      return new Promise((resolve) => {
        resolveStaleRequest = resolve;
      });
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  const firstRequest = coordinator.refresh();
  assert.equal(coordinator.refresh(), firstRequest);
  assert.equal(loadCount, 1);
  coordinator.publish([]);
  resolveStaleRequest([{ id: 'stale' }]);
  await firstRequest;
  assert.deepEqual(snapshots, [[]]);

  const deferred = [];
  let activeLoads = 0;
  let maxActiveLoads = 0;
  const latestSnapshots = [];
  const latestCoordinator = statusRefresh.createStatusSnapshotCoordinator({
    load: () => {
      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      return new Promise((resolve) => {
        deferred.push((value) => {
          activeLoads -= 1;
          resolve(value);
        });
      });
    },
    onSnapshot: (snapshot) => latestSnapshots.push(snapshot),
  });
  const oldRequest = latestCoordinator.refresh();
  const latestRequest = latestCoordinator.refreshLatest();
  assert.equal(deferred.length, 1);
  deferred.shift()([{ id: 'old' }]);
  await oldRequest;
  await Promise.resolve();
  assert.equal(deferred.length, 1);
  deferred.shift()([]);
  await latestRequest;
  assert.equal(maxActiveLoads, 1);
  assert.deepEqual(latestSnapshots, [[]]);

  const selectedBindings = new Set(['removed-auth', 'new-unsaved-auth']);
  const reconciledBindings = statusRefresh.reconcileBindingSelection(
    selectedBindings,
    ['removed-auth', 'still-assigned-auth'],
    ['still-assigned-auth']
  );
  assert.deepEqual(Array.from(reconciledBindings), ['new-unsaved-auth']);

  let intervalDelay = 0;

  let visibility = 'visible';
  let online = true;
  let intervalCallback = null;
  let cleared = false;
  const windowListeners = new Map();
  let visibilityListener = null;
  let refreshCount = 0;
  const stopPolling = statusRefresh.startStatusPolling({
    refresh: async () => {
      refreshCount += 1;
    },
    environment: {
      visibilityState: () => visibility,
      isOnline: () => online,
      setInterval: (callback, delay) => {
        intervalCallback = callback;
        intervalDelay = delay;
        return 1;
      },
      clearInterval: () => {
        cleared = true;
      },
      addWindowListener: (type, listener) => windowListeners.set(type, listener),
      removeWindowListener: (type) => windowListeners.delete(type),
      addVisibilityListener: (listener) => {
        visibilityListener = listener;
      },
      removeVisibilityListener: () => {
        visibilityListener = null;
      },
    },
  });
  assert.equal(refreshCount, 1);
  assert.equal(intervalDelay, statusRefresh.PROXY_POOL_STATUS_POLL_INTERVAL_MS);
  intervalCallback();
  assert.equal(refreshCount, 2);
  visibility = 'hidden';
  intervalCallback();
  assert.equal(refreshCount, 2);
  visibility = 'visible';
  visibilityListener();
  assert.equal(refreshCount, 3);
  online = false;
  windowListeners.get('focus')();
  intervalCallback();
  assert.equal(refreshCount, 3);
  online = true;
  windowListeners.get('online')();
  assert.equal(refreshCount, 4);
  stopPolling();
  intervalCallback();
  assert.equal(refreshCount, 4);
  assert.equal(cleared, true);
  assert.equal(windowListeners.size, 0);
  assert.equal(visibilityListener, null);
} finally {
  await server.close();
}

console.log('proxyPools tests passed');
