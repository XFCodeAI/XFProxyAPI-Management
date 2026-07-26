import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { appendLatestProviderRecord, replaceLatestProviderRecord } = await server.ssrLoadModule(
    '/src/services/api/providers.ts'
  );
  const mergeRecord = (raw, payload) => ({ ...raw, ...payload });
  const latest = [
    { 'api-key': 'existing', custom: 'keep' },
    { 'api-key': 'concurrent', custom: 'also-keep' },
  ];

  assert.deepEqual(appendLatestProviderRecord(latest, { 'api-key': 'created' }, mergeRecord), [
    { 'api-key': 'existing', custom: 'keep' },
    { 'api-key': 'concurrent', custom: 'also-keep' },
    { 'api-key': 'created' },
  ]);

  assert.deepEqual(
    replaceLatestProviderRecord(
      latest,
      (record) => record['api-key'] === 'existing',
      { 'api-key': 'updated' },
      mergeRecord
    ),
    [
      { 'api-key': 'updated', custom: 'keep' },
      { 'api-key': 'concurrent', custom: 'also-keep' },
    ]
  );

  assert.throws(
    () =>
      replaceLatestProviderRecord(
        latest,
        (record) => record['api-key'] === 'missing',
        { 'api-key': 'updated' },
        mergeRecord
      ),
    /configuration changed/
  );
} finally {
  await server.close();
}
