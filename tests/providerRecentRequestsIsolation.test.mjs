import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const service = await server.ssrLoadModule('/src/services/providerRecentRequests.ts');
  let resolveFirst;
  let requestCount = 0;
  const loadUsage = () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve({ 'provider-b': {} });
  };
  const controller = service.createProviderRecentRequestsCacheController(() =>
    service.createProviderRecentRequestsCache(loadUsage)
  );

  const firstScope = controller.forScope('https://server-a.example/', 'key-a');
  assert.equal(
    controller.forScope('https://server-a.example', 'key-a'),
    firstScope,
    'normalized identical connections must reuse their cache'
  );
  const firstLoad = firstScope.load();

  const secondScope = controller.forScope('https://server-b.example', 'key-b');
  assert.notEqual(secondScope, firstScope);
  assert.equal(secondScope.current().size, 0);
  assert.equal(controller.current(), secondScope);

  resolveFirst({ 'provider-a': {} });
  await firstLoad;
  assert.equal(firstScope.current().has('provider-a'), true);
  assert.equal(secondScope.current().size, 0, 'a late prior-scope response must stay isolated');

  await secondScope.load();
  assert.equal(secondScope.current().has('provider-b'), true);

  const changedKeyScope = controller.forScope('https://server-b.example', 'key-c');
  assert.notEqual(changedKeyScope, secondScope);
  assert.equal(changedKeyScope.current().size, 0);
} finally {
  await server.close();
}
