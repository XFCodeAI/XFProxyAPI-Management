import assert from 'node:assert/strict';
import { createServer } from 'vite';

const browserWindow = new EventTarget();
browserWindow.setTimeout = setTimeout;
browserWindow.clearTimeout = clearTimeout;
globalThis.window = browserWindow;

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const authFilesModule = await server.ssrLoadModule('/src/services/api/authFiles.ts');
  const clientModule = await server.ssrLoadModule('/src/services/api/client.ts');
  const originalPostForm = clientModule.apiClient.postForm;

  const sizeOnlyFiles = [
    { name: 'large-a.json', size: 10 * 1024 * 1024 },
    { name: 'large-b.json', size: 10 * 1024 * 1024 },
    { name: 'small.json', size: 1024 },
  ];
  assert.deepEqual(
    authFilesModule.chunkAuthFilesForUpload(sizeOnlyFiles).map((chunk) => chunk.length),
    [1, 2]
  );

  const files = Array.from(
    { length: 250 },
    (_, index) =>
      new File([`{"index":${index}}`], `credential-${index}.json`, { type: 'application/json' })
  );
  const submitted = [];
  let calls = 0;
  let cancelRequested = false;
  clientModule.apiClient.postForm = async (_url, formData) => {
    calls += 1;
    const chunk = formData.getAll('file');
    assert.ok(chunk.length <= 100);
    assert.equal(formData.get('proxy_mode'), 'proxy');
    assert.equal(formData.get('proxy_id'), 'proxy-a');
    assert.equal(formData.get('concurrency_mode_default'), 'independent');
    assert.equal(formData.get('max_concurrency_default'), '7');
    const names = chunk.map((file) => file.name);
    submitted.push(...names);
    if (calls === 2) {
      return {
        status: 'partial',
        uploaded: names.length - 1,
        files: names.slice(1),
        failed: [{ name: names[0], error: 'invalid credential' }],
      };
    }
    return { status: 'ok', uploaded: names.length, files: names, failed: [] };
  };

  const progress = [];
  const first = await authFilesModule.authFilesApi.uploadFilesInChunks(
    files,
    { mode: 'proxy', proxyId: 'proxy-a' },
    { mode: 'independent', maxConcurrency: 7 },
    {
      shouldCancel: () => cancelRequested,
      onProgress: (value) => {
        progress.push(value);
        if (value.completedChunks === 2) cancelRequested = true;
      },
    }
  );
  assert.equal(calls, 2);
  assert.equal(first.cancelled, true);
  assert.equal(first.uploaded, 199);
  assert.equal(first.failed.length, 1);
  assert.equal(first.remainingFiles.length, 51);
  assert.equal(first.remainingFiles[0].name, 'credential-100.json');
  assert.equal(first.remainingFiles.at(-1).name, 'credential-249.json');
  assert.equal(progress.at(-1).phase, 'cancelled');
  assert.equal(progress.at(-1).rejectedFiles, 1);
  assert.equal(progress.at(-1).remainingFiles, 51);

  cancelRequested = false;
  const retry = await authFilesModule.authFilesApi.uploadFilesInChunks(
    first.remainingFiles,
    { mode: 'proxy', proxyId: 'proxy-a' },
    { mode: 'independent', maxConcurrency: 7 }
  );
  assert.equal(retry.cancelled, false);
  assert.equal(retry.uploaded, 51);
  assert.equal(retry.remainingFiles.length, 0);
  const submissionCounts = new Map();
  submitted.forEach((name) => submissionCounts.set(name, (submissionCounts.get(name) ?? 0) + 1));
  assert.equal(submissionCounts.get('credential-0.json'), 1);
  assert.equal(submissionCounts.get('credential-100.json'), 2);
  assert.equal(submissionCounts.get('credential-249.json'), 1);

  calls = 0;
  const renamedFiles = [
    new File(['{}'], 'selected-success.json', { type: 'application/json' }),
    new File(['{}'], 'selected-failure.json', { type: 'application/json' }),
  ];
  clientModule.apiClient.postForm = async () => {
    calls += 1;
    return {
      status: 'partial',
      uploaded: 1,
      files: ['codex-success@example.com.json'],
      failed: [
        {
          name: 'selected-failure.json',
          credential_name: 'codex-failure@example.com.json',
          error: 'invalid credential',
        },
      ],
    };
  };
  const renamed = await authFilesModule.authFilesApi.uploadFilesInChunks(renamedFiles);
  assert.equal(calls, 1);
  assert.deepEqual(renamed.files, ['codex-success@example.com.json']);
  assert.deepEqual(
    renamed.remainingFiles.map((file) => file.name),
    ['selected-failure.json']
  );

  calls = 0;
  const duplicateA = new File(['{}'], 'duplicate.json', { type: 'application/json' });
  const duplicateB = new File(['{"other":true}'], 'duplicate.json', {
    type: 'application/json',
  });
  const oversized = {
    name: 'oversized.json',
    size: authFilesModule.AUTH_FILE_UPLOAD_CHUNK_BYTES + 1,
  };
  const unique = new File(['{}'], 'unique.json', { type: 'application/json' });
  assert.throws(
    () => authFilesModule.chunkAuthFilesForUpload([oversized]),
    /exceeds the upload chunk byte limit/
  );
  clientModule.apiClient.postForm = async (_url, formData) => {
    calls += 1;
    assert.deepEqual(
      formData.getAll('file').map((file) => file.name),
      ['unique.json']
    );
    return { status: 'ok', uploaded: 1, files: ['unique.json'], failed: [] };
  };
  const preflight = await authFilesModule.authFilesApi.uploadFilesInChunks([
    duplicateA,
    duplicateB,
    oversized,
    unique,
  ]);
  assert.equal(calls, 1);
  assert.equal(preflight.uploaded, 1);
  assert.equal(preflight.failed.length, 3);
  assert.deepEqual(
    preflight.remainingFiles.map((file) => file.name),
    ['duplicate.json', 'duplicate.json', 'oversized.json']
  );

  calls = 0;
  const scaleFiles = Array.from(
    { length: 3000 },
    (_, index) => new File(['{}'], `scale-${index}.json`, { type: 'application/json' })
  );
  clientModule.apiClient.postForm = async (_url, formData) => {
    calls += 1;
    const names = formData.getAll('file').map((file) => file.name);
    return { status: 'ok', uploaded: names.length, files: names, failed: [] };
  };
  const scale = await authFilesModule.authFilesApi.uploadFilesInChunks(scaleFiles);
  assert.equal(calls, 30);
  assert.equal(scale.uploaded, 3000);
  assert.equal(scale.remainingFiles.length, 0);

  clientModule.apiClient.postForm = originalPostForm;
} finally {
  await server.close();
}
