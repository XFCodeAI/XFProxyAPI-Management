import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const sessionWire = (overrides = {}) => ({
  id: '0123456789abcdef0123456789abcdef',
  filename: 'history.jsonl',
  status: 'receiving',
  size_bytes: 10,
  received_bytes: 0,
  chunk_size_bytes: 4,
  created_at: '2026-08-11T00:00:00Z',
  updated_at: '2026-08-11T00:00:00Z',
  expires_at: '2026-08-12T00:00:00Z',
  retryable: true,
  ...overrides,
});

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

try {
  const api = await server.ssrLoadModule('/src/services/api/requestMonitoring.ts');
  const clientModule = await server.ssrLoadModule('/src/services/api/client.ts');
  const importer = await server.ssrLoadModule('/src/features/requestMonitoring/importSession.ts');
  const tabLoader = await server.ssrLoadModule(
    '/src/features/requestMonitoring/loadMonitoringTabSections.ts'
  );

  const completed = api.normalizeMonitoringImportSession(
    sessionWire({
      status: 'completed',
      received_bytes: 10,
      retryable: false,
      result: { added: 8, skipped: 2, failed: 0 },
    })
  );
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result, { added: 8, skipped: 2, failed: 0 });
  assert.throws(
    () => api.normalizeMonitoringImportSession(sessionWire({ status: 'completed' })),
    /request_monitoring_invalid_response:import_session.result/
  );
  assert.equal(api.isMonitoringImportSessionsUnavailable({ status: 404 }), true);
  assert.equal(
    api.isMonitoringImportSessionsUnavailable({ status: 503, code: 'unavailable' }),
    true
  );
  assert.equal(
    api.isMonitoringImportSessionsUnavailable({ status: 503, code: 'limit_exceeded' }),
    false
  );

  const sectionCalls = [];
  const loaders = {
    summary: async () => sectionCalls.push('summary'),
    facets: async () => sectionCalls.push('facets'),
    identities: async () => sectionCalls.push('identities'),
    requests: async () => sectionCalls.push('requests'),
  };
  await tabLoader.loadMonitoringTabSections('requests', loaders);
  assert.deepEqual(sectionCalls.sort(), ['facets', 'requests', 'summary']);
  sectionCalls.length = 0;
  await tabLoader.loadMonitoringTabSections('credentials', loaders);
  assert.deepEqual(sectionCalls.sort(), ['facets', 'identities', 'summary']);
  sectionCalls.length = 0;
  await tabLoader.loadMonitoringTabSections('api_keys', loaders);
  assert.deepEqual(sectionCalls.sort(), ['facets', 'identities', 'summary']);

  const apiCalls = [];
  const originalPost = clientModule.apiClient.post;
  const originalGet = clientModule.apiClient.get;
  const originalPut = clientModule.apiClient.put;
  const originalDelete = clientModule.apiClient.delete;
  try {
    clientModule.apiClient.post = async (url, body, config) => {
      apiCalls.push({ method: 'POST', url, body, config });
      if (url.endsWith('/complete')) {
        return sessionWire({
          status: 'completed',
          received_bytes: 10,
          retryable: false,
          result: { added: 8, skipped: 2, failed: 0 },
        });
      }
      return sessionWire();
    };
    clientModule.apiClient.get = async (url, config) => {
      apiCalls.push({ method: 'GET', url, config });
      return sessionWire();
    };
    clientModule.apiClient.put = async (url, body, config) => {
      apiCalls.push({ method: 'PUT', url, body, config });
      return sessionWire({ received_bytes: 4 });
    };
    clientModule.apiClient.delete = async (url, config) => {
      apiCalls.push({ method: 'DELETE', url, config });
      return sessionWire({ status: 'cancelled', retryable: false });
    };

    const signal = new AbortController().signal;
    await api.requestMonitoringApi.createImportSession(
      'history.jsonl',
      10,
      'abcdefabcdefabcdefabcdefabcdefab',
      signal
    );
    await api.requestMonitoringApi.getImportSession(sessionWire().id, signal);
    await api.requestMonitoringApi.uploadImportSessionChunk(
      sessionWire().id,
      0,
      new Blob(['data']),
      signal
    );
    await api.requestMonitoringApi.completeImportSession(sessionWire().id, signal);
    await api.requestMonitoringApi.cancelImportSession(sessionWire().id);
  } finally {
    clientModule.apiClient.post = originalPost;
    clientModule.apiClient.get = originalGet;
    clientModule.apiClient.put = originalPut;
    clientModule.apiClient.delete = originalDelete;
  }
  assert.equal(apiCalls[0].url, '/usage-analytics/monitoring/import-sessions');
  assert.equal(apiCalls[0].body.resume_key, 'abcdefabcdefabcdefabcdefabcdefab');
  assert.match(apiCalls[1].url, /\/import-sessions\/0123456789abcdef0123456789abcdef$/);
  assert.match(apiCalls[2].url, /\/chunk\?offset=0$/);
  assert.equal(apiCalls[2].config.headers['Content-Type'], 'application/octet-stream');
  assert.match(apiCalls[3].url, /\/complete$/);
  assert.equal(apiCalls[4].method, 'DELETE');

  let session = completed;
  session = {
    ...session,
    status: 'receiving',
    receivedBytes: 0,
    retryable: true,
    result: null,
  };
  const offsets = [];
  let createCalls = 0;
  const importClient = {
    createImportSession: async (filename, sizeBytes) => {
      createCalls += 1;
      session = { ...session, filename, sizeBytes };
      return { ...session };
    },
    getImportSession: async () => ({ ...session }),
    uploadImportSessionChunk: async (_id, offset, chunk) => {
      offsets.push(offset);
      session = { ...session, receivedBytes: offset + chunk.size };
      return { ...session };
    },
    completeImportSession: async () => {
      session = {
        ...session,
        status: 'completed',
        retryable: false,
        result: { added: 8, skipped: 2, failed: 0 },
      };
      return { ...session };
    },
    cancelImportSession: async () => {
      session = { ...session, status: 'cancelled', retryable: false, result: null };
      return { ...session };
    },
  };
  const storage = new MemoryStorage();
  const file = new File(['0123456789'], 'history.jsonl', { lastModified: 123 });

  const unavailableStorage = new MemoryStorage();
  await assert.rejects(
    importer.uploadMonitoringImportFile({
      scope: 'https://legacy-xfpa.example.test',
      file,
      storage: unavailableStorage,
      client: {
        ...importClient,
        createImportSession: async () => {
          throw Object.assign(new Error('not found'), { status: 404 });
        },
      },
    }),
    (error) => error?.status === 404
  );
  assert.equal(unavailableStorage.values.size, 0);

  const controller = new AbortController();
  await assert.rejects(
    importer.uploadMonitoringImportFile({
      scope: 'https://xfpa.example.test',
      file,
      client: importClient,
      storage,
      signal: controller.signal,
      pollIntervalMs: 0,
      onProgress: (progress) => {
        if (progress.phase === 'uploading' && progress.uploadedBytes === 4) controller.abort();
      },
    }),
    importer.MonitoringImportPausedError
  );
  assert.deepEqual(offsets, [0]);
  assert.equal(storage.values.size, 1);

  const result = await importer.uploadMonitoringImportFile({
    scope: 'https://xfpa.example.test',
    file,
    client: importClient,
    storage,
    pollIntervalMs: 0,
  });
  assert.equal(createCalls, 1);
  assert.deepEqual(offsets, [0, 4, 8]);
  assert.deepEqual(result, { added: 8, skipped: 2, failed: 0 });
  assert.equal(storage.values.size, 0);
} finally {
  await server.close();
}

console.log('requestMonitoringImport tests passed');
