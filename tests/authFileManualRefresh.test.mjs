import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const authFiles = await server.ssrLoadModule('/src/services/api/authFiles.ts');
  const apiClientModule = await server.ssrLoadModule('/src/services/api/client.ts');
  const constants = await server.ssrLoadModule('/src/features/authFiles/constants.ts');
  const manualRefresh = await server.ssrLoadModule(
    '/src/features/authFiles/authFileManualRefresh.ts'
  );

  await test('builds a manual refresh timestamp exactly 60 seconds in the past', () => {
    const nowMs = Date.parse('2026-07-26T12:34:56.789Z');
    assert.equal(authFiles.buildManualRefreshExpiredAt(nowMs), '2026-07-26T12:33:56.789Z');
  });

  await test('normalizes bounded credential availability reprobe results', () => {
    assert.deepEqual(
      authFiles.normalizeAuthFileAvailabilityReprobeResult({
        status: 'accepted',
        requested: '9',
        eligible: 4,
        queued: '3',
        already_probing: 1,
        maximum_parallel: '4',
        skipped: {
          auth_invalid: 2,
          excluded: '1',
          empty: 0,
          malformed: 'not-a-number',
        },
      }),
      {
        status: 'accepted',
        requested: 9,
        eligible: 4,
        queued: 3,
        alreadyProbing: 1,
        maximumParallel: 4,
        skipped: { auth_invalid: 2, excluded: 1 },
      }
    );
  });

  await test('queues credential availability reprobes through the dedicated endpoint', async () => {
    const originalPost = apiClientModule.apiClient.post;
    const calls = [];
    apiClientModule.apiClient.post = async (url, data) => {
      calls.push({ url, data });
      return {
        status: 'accepted',
        requested: 2,
        eligible: 1,
        queued: 1,
        already_probing: 0,
        maximum_parallel: 4,
        skipped: { auth_invalid: 1 },
      };
    };
    try {
      const result = await authFiles.authFilesApi.reprobeAvailability();
      assert.equal(result.queued, 1);
      assert.deepEqual(result.skipped, { auth_invalid: 1 });
    } finally {
      apiClientModule.apiClient.post = originalPost;
    }
    assert.deepEqual(calls, [
      { url: '/auth-files/availability/reprobe', data: undefined },
    ]);
  });

  await test('patches expired for only the requested credential name', async () => {
    const originalPatch = apiClientModule.apiClient.patch;
    const originalDateNow = Date.now;
    const calls = [];
    const nowMs = Date.parse('2026-07-26T12:34:56.789Z');

    apiClientModule.apiClient.patch = async (url, data) => {
      calls.push({ url, data });
      return { status: 'ok' };
    };
    Date.now = () => nowMs;
    try {
      await authFiles.authFilesApi.requestManualRefresh('xai-selected.json');
    } finally {
      apiClientModule.apiClient.patch = originalPatch;
      Date.now = originalDateNow;
    }

    assert.deepEqual(calls, [
      {
        url: '/auth-files/fields',
        data: {
          name: 'xai-selected.json',
          expired: '2026-07-26T12:33:56.789Z',
        },
      },
    ]);
  });

  await test('supports only the OAuth providers from the v1.19.3 refresh contract', () => {
    assert.deepEqual(Array.from(constants.AUTH_FILE_MANUAL_REFRESH_PROVIDERS), [
      'antigravity',
      'claude',
      'codex',
      'kimi',
      'xai',
    ]);
    assert.equal(constants.supportsAuthFileManualRefresh('grok'), true);
    assert.equal(constants.supportsAuthFileManualRefresh('gemini'), false);
  });

  await test('coalesces duplicate clicks and waits for inventory refresh', async () => {
    const pendingNames = new Set();
    const requestNames = [];
    const pendingChanges = [];
    let releaseRequest;
    let releaseInventory;
    let markInventoryStarted;
    const requestGate = new Promise((resolve) => {
      releaseRequest = resolve;
    });
    const inventoryGate = new Promise((resolve) => {
      releaseInventory = resolve;
    });
    const inventoryStarted = new Promise((resolve) => {
      markInventoryStarted = resolve;
    });
    let inventoryRefreshes = 0;
    let firstSettled = false;

    const options = {
      name: ' codex-selected.json ',
      pendingNames,
      request: async (name) => {
        requestNames.push(name);
        await requestGate;
      },
      refreshInventory: async () => {
        inventoryRefreshes += 1;
        markInventoryStarted();
        await inventoryGate;
      },
      onPendingChange: (name, pending) => pendingChanges.push([name, pending]),
    };

    const first = manualRefresh.runAuthFileManualRefresh(options).then((result) => {
      firstSettled = true;
      return result;
    });
    const duplicate = await manualRefresh.runAuthFileManualRefresh(options);

    assert.equal(duplicate, false);
    assert.deepEqual(requestNames, ['codex-selected.json']);
    assert.deepEqual(pendingChanges, [['codex-selected.json', true]]);

    releaseRequest();
    await inventoryStarted;
    assert.equal(inventoryRefreshes, 1);
    assert.equal(firstSettled, false);

    releaseInventory();
    assert.equal(await first, true);
    assert.equal(firstSettled, true);
    assert.deepEqual(pendingChanges, [
      ['codex-selected.json', true],
      ['codex-selected.json', false],
    ]);
    assert.equal(pendingNames.size, 0);
  });

  await test('propagates inventory refresh failures and always clears pending state', async () => {
    const pendingNames = new Set();
    const pendingChanges = [];

    await assert.rejects(
      manualRefresh.runAuthFileManualRefresh({
        name: 'xai-selected.json',
        pendingNames,
        request: async () => {},
        refreshInventory: async () => {
          throw new Error('inventory unavailable');
        },
        onPendingChange: (name, pending) => pendingChanges.push([name, pending]),
      }),
      /inventory unavailable/
    );

    assert.deepEqual(pendingChanges, [
      ['xai-selected.json', true],
      ['xai-selected.json', false],
    ]);
    assert.equal(pendingNames.size, 0);
  });
} finally {
  await server.close();
}
