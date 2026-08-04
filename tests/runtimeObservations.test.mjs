import assert from 'node:assert/strict';
import { createServer } from 'vite';

const waitFor = async (predicate, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for runtime observation state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

class VisibilityDocument extends EventTarget {
  visibilityState = 'hidden';
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const apiModule = await server.ssrLoadModule('/src/services/api/runtimeObservations.ts');
  const storeModule = await server.ssrLoadModule('/src/stores/useRuntimeObservationStore.ts');
  const selectorModule = await server.ssrLoadModule(
    '/src/features/runtimeObservations/selectors.ts'
  );
  const { openaiToResource } = await server.ssrLoadModule('/src/features/providers/adapters.ts');
  const { useAuthInventoryStore } = await server.ssrLoadModule(
    '/src/stores/useAuthInventoryStore.ts'
  );
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/useAuthStore.ts');

  const snapshot = apiModule.normalizeRuntimeObservationSnapshot({
    observation_id: 'observation-one',
    revision: '4',
    observed_at: '2026-08-03T00:00:00Z',
    admission_scope: 'process-local',
    availability_scope: 'process-local',
    resources: [
      {
        id: 'shared-id',
        auth_index: 'auth-index-one',
        scope: 'credential',
        parent_id: 'shared-id',
        supplier_id: 'shared-id',
        provider: 'openai-compatibility',
        in_flight: '2',
        maximum: 4,
        queued: '1',
        success: '9',
        failed: 2,
        recent_requests: [{ success: '3', failed: 1 }],
        availability_state: 'transient_throttled',
        availability_model: 'gpt-5.6-sol',
        availability_deadline: '2026-08-03T00:05:00Z',
        availability_updated_at: '2026-08-03T00:00:30Z',
        availability_counts: {
          transient_throttled: '1',
          usage_wait: 0,
        },
      },
      {
        id: 'shared-id',
        scope: 'supplier',
        provider: 'openai-compatibility',
        in_flight: 3,
        maximum: 8,
        queued: 2,
        success: 99,
        failed: 88,
        availability_state: 'usage_wait',
        availability_deadline: '2026-08-03T00:10:00Z',
        availability_counts: { transient_throttled: 1, usage_wait: 1 },
      },
      { id: 'ignored', scope: 'unknown' },
    ],
    queue: { waiting: '2', maximum: 64, closed: false },
    total_credentials: 1,
    total_suppliers: 1,
  });
  assert.equal(snapshot.resources.length, 2);
  assert.equal(snapshot.resources[0].authIndex, 'auth-index-one');
  assert.equal(snapshot.resources[0].availabilityState, 'transient_throttled');
  assert.equal(snapshot.resources[0].availabilityModel, 'gpt-5.6-sol');
  assert.equal(snapshot.resources[0].availabilityDeadline, '2026-08-03T00:05:00Z');
  assert.deepEqual(snapshot.resources[0].availabilityCounts, {
    ready: 0,
    transientThrottled: 1,
    usageWait: 0,
    probing: 0,
    halfOpen: 0,
    authInvalid: 0,
    disabled: 0,
  });
  assert.equal(snapshot.resources[1].availabilityState, 'usage_wait');
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.admissionScope, 'process-local');
  assert.equal(snapshot.availabilityScope, 'process-local');
  assert.deepEqual(snapshot.queue, { waiting: 2, maximum: 64, closed: false });

  const indexed = storeModule.indexRuntimeObservationResources(snapshot.resources);
  const credentialsByAuthIndex = storeModule.indexRuntimeObservationCredentialsByAuthIndex(
    snapshot.resources
  );
  assert.equal(indexed['credential:shared-id'].success, 9);
  assert.strictEqual(credentialsByAuthIndex['auth-index-one'], indexed['credential:shared-id']);
  assert.equal(indexed['supplier:shared-id'].maximum, 8);
  assert.notStrictEqual(indexed['credential:shared-id'], indexed['supplier:shared-id']);

  const provider = openaiToResource(
    {
      name: 'gateway-alias',
      baseUrl: 'https://gateway.example/v1',
      apiKeyEntries: [{ apiKey: 'secret', authIndex: 'auth-index-one' }],
    },
    0
  );
  const authFiles = [
    {
      id: 'shared-id',
      name: 'credential.json',
      auth_index: 'auth-index-one',
      status_message: 'preserve this diagnostic',
    },
  ];
  const providerObservation = selectorModule.getProviderRuntimeObservation(
    provider,
    [],
    indexed,
    credentialsByAuthIndex
  );
  assert.equal(providerObservation.inFlight, 3);
  assert.equal(providerObservation.maximum, 8);
  assert.equal(providerObservation.queued, 2);
  assert.equal(providerObservation.success, 9);
  assert.equal(providerObservation.failed, 2);
  assert.equal(providerObservation.availabilityState, 'usage_wait');
  assert.equal(providerObservation.availabilityCounts.transientThrottled, 1);
  assert.equal(providerObservation.availabilityCounts.usageWait, 1);
  const fallbackProviderObservation = selectorModule.getProviderRuntimeObservation(
    provider,
    authFiles,
    indexed,
    {}
  );
  assert.equal(fallbackProviderObservation.inFlight, 3);
  assert.equal(
    selectorModule.getRuntimeCredentialByAuthIndex('gateway-alias', new Map(), indexed),
    null,
    'display aliases must never be used as runtime identity fallbacks'
  );

  useAuthInventoryStore.setState({
    files: authFiles,
    inventoryId: 'inventory-one',
    revision: 7,
    error: 'preserve inventory error',
  });
  storeModule.applyRuntimeObservationSnapshot(snapshot);
  assert.strictEqual(useAuthInventoryStore.getState().files, authFiles);
  assert.equal(useAuthInventoryStore.getState().error, 'preserve inventory error');
  assert.equal(
    useAuthInventoryStore.getState().files[0].status_message,
    'preserve this diagnostic'
  );

  assert.equal(
    storeModule.runtimeObservationShouldBeActive('hidden', 'connected', 'x', 'k'),
    false
  );
  assert.equal(
    storeModule.runtimeObservationShouldBeActive('visible', 'connected', 'x', 'k'),
    true
  );
  assert.equal(storeModule.runtimeObservationShouldBeActive('visible', 'error', 'x', 'k'), false);
  assert.deepEqual(
    [0, 5_000, 10_000, 20_000, 30_000].map(storeModule.nextRuntimeObservationRetryDelay),
    [5_000, 10_000, 20_000, 30_000, 30_000]
  );

  const originalFetch = globalThis.fetch;
  let requestHeaders;
  globalThis.fetch = async (_url, options) => {
    requestHeaders = options.headers;
    return new Response(null, { status: 304, headers: { ETag: '"revision-4"' } });
  };
  const notModified = await apiModule.runtimeObservationsApi.snapshot({
    apiBase: 'https://management.example',
    managementKey: 'management-key',
    signal: new AbortController().signal,
    etag: '"revision-3"',
  });
  assert.equal(new Headers(requestHeaders).get('If-None-Match'), '"revision-3"');
  assert.deepEqual(notModified, {
    snapshot: null,
    etag: '"revision-4"',
    notModified: true,
  });
  globalThis.fetch = originalFetch;

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

  const originalSnapshot = apiModule.runtimeObservationsApi.snapshot;
  const originalEvents = apiModule.runtimeObservationsApi.events;
  let snapshotCalls = 0;
  let eventCalls = 0;
  let streamSignal;
  apiModule.runtimeObservationsApi.snapshot = async () => {
    snapshotCalls += 1;
    return { snapshot, etag: '"revision-4"', notModified: false };
  };
  apiModule.runtimeObservationsApi.events = async ({ signal }) => {
    eventCalls += 1;
    streamSignal = signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.close(), { once: true });
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

  storeModule.useRuntimeObservationStore.getState().stop(true);
  storeModule.useRuntimeObservationStore.getState().start();
  assert.equal(storeModule.useRuntimeObservationStore.getState().phase, 'paused');
  assert.equal(snapshotCalls, 0);

  visibilityDocument.visibilityState = 'visible';
  visibilityDocument.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => storeModule.useRuntimeObservationStore.getState().phase === 'live');
  assert.equal(snapshotCalls, 1);
  assert.equal(eventCalls, 1);

  visibilityDocument.visibilityState = 'hidden';
  visibilityDocument.dispatchEvent(new Event('visibilitychange'));
  assert.equal(storeModule.useRuntimeObservationStore.getState().phase, 'paused');
  assert.equal(streamSignal.aborted, true);
  storeModule.useRuntimeObservationStore.getState().stop(true);

  visibilityDocument.visibilityState = 'visible';
  snapshotCalls = 0;
  apiModule.runtimeObservationsApi.events = async () => {
    throw new Error('stream unavailable');
  };
  storeModule.useRuntimeObservationStore.getState().start();
  await waitFor(() => snapshotCalls >= 2);
  assert.equal(storeModule.useRuntimeObservationStore.getState().phase, 'polling');
  storeModule.useRuntimeObservationStore.getState().stop(true);

  apiModule.runtimeObservationsApi.snapshot = originalSnapshot;
  apiModule.runtimeObservationsApi.events = originalEvents;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.localStorage = originalLocalStorage;
  useAuthInventoryStore.getState().stop(true);
} finally {
  await server.close();
}

console.log('runtime observation tests passed');
