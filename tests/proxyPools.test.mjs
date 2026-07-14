import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const proxyPools = await server.ssrLoadModule('/src/services/api/proxyPools.ts');

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
} finally {
  await server.close();
}

console.log('proxyPools tests passed');
