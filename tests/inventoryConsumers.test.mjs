import assert from 'node:assert/strict';
import { createServer } from 'vite';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const usagePayload = (provider, compositeKey, success) => ({
  [provider]: {
    [compositeKey]: {
      success,
      failed: 0,
      recent_requests: [],
    },
  },
});

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const recentRequestsModule = await server.ssrLoadModule(
    '/src/services/providerRecentRequests.ts'
  );
  const pageActivityModule = await server.ssrLoadModule('/src/hooks/usePageActivityRefresh.ts');

  const first = deferred();
  const second = deferred();
  let loads = 0;
  const cache = recentRequestsModule.createProviderRecentRequestsCache(() => {
    loads += 1;
    return loads === 1 ? first.promise : second.promise;
  });

  const staleLoad = cache.load();
  cache.invalidate();
  const currentLoad = cache.load();
  first.resolve(usagePayload('codex', 'https://old.example|old', 1));
  second.resolve(usagePayload('codex', 'https://new.example|new', 2));
  const [staleResult, currentResult] = await Promise.all([staleLoad, currentLoad]);
  assert.equal(loads, 2);
  assert.equal(staleResult.get('codex').has('https://old.example|old'), false);
  assert.equal(staleResult.get('codex').get('https://new.example|new').success, 2);
  assert.equal(currentResult.get('codex').get('https://new.example|new').success, 2);

  let now = 1_000;
  let manualLoads = 0;
  const manualCache = recentRequestsModule.createProviderRecentRequestsCache(
    async () => {
      manualLoads += 1;
      return usagePayload('claude', 'https://provider.example|key', manualLoads);
    },
    () => now,
    10_000
  );
  await manualCache.load();
  await manualCache.load();
  assert.equal(manualLoads, 1);
  await manualCache.load({ force: true });
  assert.equal(manualLoads, 2);
  now += 10_001;
  await manualCache.load();
  assert.equal(manualLoads, 3);

  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  let visibilityState = 'hidden';
  let activityRefreshes = 0;
  const unsubscribe = pageActivityModule.subscribePageActivityRefresh(
    () => {
      activityRefreshes += 1;
    },
    {
      windowTarget,
      documentTarget,
      visibilityState: () => visibilityState,
    }
  );
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(activityRefreshes, 0);
  visibilityState = 'visible';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  windowTarget.dispatchEvent(new Event('focus'));
  assert.equal(activityRefreshes, 2);
  unsubscribe();
  windowTarget.dispatchEvent(new Event('focus'));
  assert.equal(activityRefreshes, 2);
} finally {
  await server.close();
}
