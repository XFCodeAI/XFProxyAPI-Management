import assert from 'node:assert/strict';
import { createServer } from 'vite';

const waitFor = async (predicate, timeoutMs = 3_500) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for supplier billing state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

class VisibilityDocument extends EventTarget {
  visibilityState = 'hidden';
}

const multiplier = (value) => ({
  schema_version: 2,
  billing_scope: 'token',
  group_rate_multiplier: Number(value),
  group_rate_multiplier_text: String(value),
  resolved_rate_multiplier: Number(value),
  resolved_rate_multiplier_text: String(value),
  peak_rate_enabled: false,
  effective_rate_multiplier: Number(value),
  effective_rate_multiplier_text: String(value),
  observed_at: '2026-08-06T00:00:00Z',
});

const probeEntry = (targetId, value, overrides = {}) => ({
  target_id: targetId,
  provider_brand: 'openaiCompatibility',
  provider_name: 'supplier-a',
  provider_index: targetId.endsWith('other') ? 1 : 0,
  api_key_index: 0,
  alias: targetId,
  eligible: true,
  queued: false,
  probing: false,
  stale: false,
  status: 'ok',
  multiplier: multiplier(value),
  usage: {
    status: 'ok',
    is_valid: true,
    remaining: Number(value) * 10,
    unit: 'USD',
    stale: false,
    received_at: '2026-08-06T00:00:00Z',
  },
  ...overrides,
});

const snapshot = (revision, value) => ({
  provider_name: '',
  snapshot_id: 'supplier-snapshot-one',
  revision,
  server_time: `2026-08-06T00:00:0${Math.min(revision, 9)}Z`,
  entries: [probeEntry('supplier:primary', value), probeEntry('supplier:other', '2')],
});

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const apiModule = await server.ssrLoadModule('/src/services/api/supplierBillingProbe.ts');
  const storeModule = await server.ssrLoadModule('/src/stores/useSupplierBillingProbeStore.ts');
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/useAuthStore.ts');

  const normalized = apiModule.normalizeSupplierBillingProbeResponse({
    snapshot_id: 'supplier-snapshot-one',
    revision: '4',
    server_time: '2026-08-06T00:00:04Z',
    entries: [
      {
        ...probeEntry('supplier:primary', '1.25'),
        queued: true,
        usage: { remaining: '12.5', status: 'ok', stale: false, is_valid: true },
      },
      { provider_brand: 'codex' },
    ],
  });
  assert.equal(normalized.snapshot_id, 'supplier-snapshot-one');
  assert.equal(normalized.revision, 4);
  assert.equal(normalized.entries.length, 1);
  assert.equal(normalized.entries[0].queued, true);
  assert.equal(normalized.entries[0].usage.remaining, 12.5);
  assert.strictEqual(
    storeModule.indexSupplierBillingProbeEntries(normalized.entries)['supplier:primary'],
    normalized.entries[0]
  );
  assert.equal(
    storeModule.supplierBillingProbeShouldBeActive('hidden', 'connected', 'x', 'k'),
    false
  );
  assert.equal(
    storeModule.supplierBillingProbeShouldBeActive('visible', 'connected', 'x', 'k'),
    true
  );
  assert.deepEqual(
    [0, 5_000, 10_000, 20_000, 30_000].map(storeModule.nextSupplierBillingProbeRetryDelay),
    [5_000, 10_000, 20_000, 30_000, 30_000]
  );

  const originalFetch = globalThis.fetch;
  let conditionalHeaders;
  try {
    globalThis.fetch = async (_url, options) => {
      conditionalHeaders = options.headers;
      return new Response(null, { status: 304, headers: { ETag: 'W/"supplier-4"' } });
    };
    const notModified = await apiModule.supplierBillingProbeApi.snapshot({
      apiBase: 'https://management.example',
      managementKey: 'management-key',
      signal: new AbortController().signal,
      etag: 'W/"supplier-3"',
    });
    assert.equal(new Headers(conditionalHeaders).get('If-None-Match'), 'W/"supplier-3"');
    assert.deepEqual(notModified, {
      snapshot: null,
      etag: 'W/"supplier-4"',
      notModified: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const visibilityDocument = new VisibilityDocument();
  const windowTarget = new EventTarget();
  const storedValues = new Map();
  const localStorage = {
    getItem: (key) => storedValues.get(key) ?? null,
    setItem: (key, value) => storedValues.set(key, String(value)),
    removeItem: (key) => storedValues.delete(key),
    clear: () => storedValues.clear(),
    key: (index) => Array.from(storedValues.keys())[index] ?? null,
    get length() {
      return storedValues.size;
    },
  };
  Object.defineProperty(windowTarget, 'location', {
    configurable: true,
    value: { host: 'management.example' },
  });
  globalThis.document = visibilityDocument;
  globalThis.window = windowTarget;
  globalThis.localStorage = localStorage;

  const originalSnapshot = apiModule.supplierBillingProbeApi.snapshot;
  const originalEvents = apiModule.supplierBillingProbeApi.events;
  const originalEnqueue = apiModule.supplierBillingProbeApi.enqueue;
  try {
    let snapshotCalls = 0;
    let eventCalls = 0;
    let nextSnapshot = snapshot(1, '1');
    let returnNotModified = false;
    const streamControllers = [];
    const streamSignals = [];
    apiModule.supplierBillingProbeApi.snapshot = async () => {
      snapshotCalls += 1;
      if (returnNotModified) {
        return { snapshot: null, etag: `W/"supplier-${nextSnapshot.revision}"`, notModified: true };
      }
      return {
        snapshot: nextSnapshot,
        etag: `W/"supplier-${nextSnapshot.revision}"`,
        notModified: false,
      };
    };
    apiModule.supplierBillingProbeApi.events = async ({ signal }) => {
      eventCalls += 1;
      streamSignals.push(signal);
      return new Response(
        new ReadableStream({
          start(controller) {
            streamControllers.push(controller);
            signal.addEventListener(
              'abort',
              () => {
                try {
                  controller.close();
                } catch {
                  // The stream may already be errored by the disconnect test.
                }
              },
              { once: true }
            );
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    };
    useAuthStore.setState({
      apiBase: 'https://management.example',
      managementKey: 'management-key',
      connectionStatus: 'connected',
    });

    storeModule.useSupplierBillingProbeStore.getState().stop(true);
    storeModule.useSupplierBillingProbeStore.getState().start();
    assert.equal(storeModule.useSupplierBillingProbeStore.getState().phase, 'paused');
    assert.equal(snapshotCalls, 0);

    visibilityDocument.visibilityState = 'visible';
    visibilityDocument.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => storeModule.useSupplierBillingProbeStore.getState().phase === 'live');
    assert.equal(snapshotCalls, 1);
    assert.equal(eventCalls, 1);

    nextSnapshot = snapshot(3, '1.5');
    const encoder = new TextEncoder();
    streamControllers[0].enqueue(
      encoder.encode(
        'id: 2\nevent: supplier-billing-probe\ndata: {"snapshot_id":"supplier-snapshot-one","revision":2,"target_ids":["supplier:primary"]}\n\n' +
          'id: 3\nevent: supplier-billing-probe\ndata: {"snapshot_id":"supplier-snapshot-one","revision":3,"target_ids":["supplier:primary"]}\n\n'
      )
    );
    await waitFor(() => storeModule.useSupplierBillingProbeStore.getState().revision === 3);
    assert.equal(snapshotCalls, 2, 'burst events must coalesce into one snapshot request');
    assert.equal(
      storeModule.useSupplierBillingProbeStore.getState().entriesByTarget['supplier:primary']
        .multiplier.effective_rate_multiplier_text,
      '1.5'
    );

    const entriesBefore304 = storeModule.useSupplierBillingProbeStore.getState().entries;
    returnNotModified = true;
    await storeModule.useSupplierBillingProbeStore.getState().refresh();
    assert.strictEqual(
      storeModule.useSupplierBillingProbeStore.getState().entries,
      entriesBefore304,
      '304 must retain the existing data reference'
    );

    streamControllers[0].error(new Error('stream disconnected'));
    await waitFor(() => storeModule.useSupplierBillingProbeStore.getState().phase === 'polling');
    await waitFor(() => snapshotCalls >= 4);
    await waitFor(
      () => storeModule.useSupplierBillingProbeStore.getState().phase === 'live' && eventCalls >= 2
    );
    assert.equal(streamSignals[0].aborted, false);

    let resolveEnqueue;
    apiModule.supplierBillingProbeApi.enqueue = () =>
      new Promise((resolve) => {
        resolveEnqueue = resolve;
      });
    returnNotModified = false;
    storeModule.applySupplierBillingProbeSnapshot(snapshot(4, '1.6'));
    const otherBefore =
      storeModule.useSupplierBillingProbeStore.getState().entriesByTarget['supplier:other'];
    const manualRefresh = storeModule.useSupplierBillingProbeStore
      .getState()
      .refreshTarget('supplier:primary');
    assert.equal(
      storeModule.useSupplierBillingProbeStore.getState().entriesByTarget['supplier:primary']
        .queued,
      true
    );
    assert.strictEqual(
      storeModule.useSupplierBillingProbeStore.getState().entriesByTarget['supplier:other'],
      otherBefore,
      'manual refresh must only mutate its target'
    );
    storeModule.applySupplierBillingProbeSnapshot(snapshot(5, '1.8'));
    resolveEnqueue({
      entry: probeEntry('supplier:primary', '0.5', { queued: true }),
      snapshotId: 'supplier-snapshot-one',
      revision: 4,
    });
    await manualRefresh;
    assert.equal(
      storeModule.useSupplierBillingProbeStore.getState().entriesByTarget['supplier:primary']
        .multiplier.effective_rate_multiplier_text,
      '1.8',
      'an older enqueue response must not overwrite a terminal snapshot'
    );

    visibilityDocument.visibilityState = 'hidden';
    visibilityDocument.dispatchEvent(new Event('visibilitychange'));
    assert.equal(storeModule.useSupplierBillingProbeStore.getState().phase, 'paused');
    assert.equal(streamSignals.at(-1).aborted, true);
  } finally {
    storeModule.useSupplierBillingProbeStore.getState().stop(true);
    apiModule.supplierBillingProbeApi.snapshot = originalSnapshot;
    apiModule.supplierBillingProbeApi.events = originalEvents;
    apiModule.supplierBillingProbeApi.enqueue = originalEnqueue;
    useAuthStore.setState({ connectionStatus: 'disconnected', apiBase: '', managementKey: '' });
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
} finally {
  await server.close();
}

console.log('supplier billing live store tests passed');
