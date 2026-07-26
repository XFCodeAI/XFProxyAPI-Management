import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const {
    captureQuotaCacheGeneration,
    commitIfQuotaCacheCurrent,
    getQuotaCredentialCacheKey,
    useQuotaStore,
  } = await server.ssrLoadModule('/src/stores/useQuotaStore.ts');

  useQuotaStore.getState().clearQuotaCache();
  const firstKey = getQuotaCredentialCacheKey({ name: 'shared.json', auth_index: 'auth:1' });
  const secondKey = getQuotaCredentialCacheKey({ name: 'shared.json', auth_index: 'auth:2' });
  const idKey = getQuotaCredentialCacheKey({ name: 'shared.json', id: 'credential-id' });
  assert.notEqual(firstKey, secondKey);
  assert.notEqual(firstKey, idKey);

  useQuotaStore.getState().setKimiQuota({
    [firstKey]: { status: 'success', rows: [{ id: 'first', used: 1, limit: 2 }] },
    [secondKey]: { status: 'success', rows: [{ id: 'second', used: 2, limit: 3 }] },
  });
  assert.equal(useQuotaStore.getState().kimiQuota[firstKey].rows[0].id, 'first');
  assert.equal(useQuotaStore.getState().kimiQuota[secondKey].rows[0].id, 'second');

  const previousConnection = captureQuotaCacheGeneration();
  useQuotaStore.getState().clearQuotaCache();
  let committed = false;
  assert.equal(
    commitIfQuotaCacheCurrent(previousConnection, () => {
      committed = true;
    }),
    false
  );
  assert.equal(committed, false);
  assert.deepEqual(useQuotaStore.getState().kimiQuota, {});

  const currentConnection = captureQuotaCacheGeneration();
  assert.equal(
    commitIfQuotaCacheCurrent(
      currentConnection,
      () => {
        committed = true;
      },
      () => false
    ),
    false
  );
  assert.equal(committed, false);
  assert.equal(
    commitIfQuotaCacheCurrent(currentConnection, () => {
      committed = true;
    }),
    true
  );
  assert.equal(committed, true);
} finally {
  await server.close();
}

console.log('Quota cache and session isolation tests passed');
