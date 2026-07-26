import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { createLatestRequestCoordinator } = await server.ssrLoadModule(
    '/src/hooks/useLatestAsyncSection.ts'
  );

  const coordinator = createLatestRequestCoordinator();
  let executions = 0;
  let resolveEqual;
  const equalTask = () =>
    new Promise((resolve) => {
      executions++;
      resolveEqual = resolve;
    });
  const first = coordinator.run('same', equalTask);
  const second = coordinator.run('same', equalTask);
  assert.equal(first, second);
  assert.equal(executions, 1);
  resolveEqual('value');
  assert.deepEqual(await first, { applied: true, value: 'value' });

  let resolveOld;
  const old = coordinator.run(
    'old',
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  const latest = coordinator.run('latest', async () => 'latest-value');
  resolveOld('old-value');
  assert.deepEqual(await old, { applied: false, value: 'old-value' });
  assert.deepEqual(await latest, { applied: true, value: 'latest-value' });

  let canceled = false;
  const pending = coordinator.run(
    'cancel',
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          canceled = true;
          resolve('ignored');
        });
      })
  );
  coordinator.cancel();
  assert.deepEqual(await pending, { applied: false, value: 'ignored' });
  assert.equal(canceled, true);
} finally {
  await server.close();
}
