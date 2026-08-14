import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const runtime = (availabilityState, availabilityUpdatedAt = '') => ({
  availabilityState,
  availabilityUpdatedAt,
});

try {
  const { resolveAuthFileStatusWarning } = await server.ssrLoadModule(
    '/src/features/authFiles/statusWarning.ts'
  );

  for (const file of [
    { name: 'healthy.json', status_message: 'ready' },
    { name: 'cancelled.json', status_code: 499, status_message: 'context canceled' },
    { name: 'bad-request.json', status_code: 400, status_message: 'invalid request' },
    { name: 'transient.json', status_code: 503, status_message: 'upstream unavailable' },
  ]) {
    assert.deepEqual(resolveAuthFileStatusWarning(file), {
      message: file.status_message,
      hasProblem: false,
      hasRawWarning: false,
    });
  }

  for (const file of [
    { name: 'unauthorized.json', status_code: 401, status_message: 'unauthorized' },
    { name: 'billing.json', status_code: 402, status_message: 'payment required' },
    { name: 'limited.json', status_code: 429, status_message: 'too many requests' },
    {
      name: 'auth-via-503.json',
      status_code: 503,
      status_message: 'authentication_error: invalid token',
    },
    { name: 'usage.json', status_message: 'usage limit reached' },
  ]) {
    const result = resolveAuthFileStatusWarning(file);
    assert.equal(result.hasProblem, true, file.name);
    assert.equal(result.hasRawWarning, true, file.name);
  }

  assert.deepEqual(
    resolveAuthFileStatusWarning(
      {
        name: 'recovered.json',
        status_code: 401,
        status_message: 'unauthorized',
        updated_at: '2026-08-14T01:00:00Z',
      },
      runtime('ready', '2026-08-14T01:00:01Z')
    ),
    { message: 'unauthorized', hasProblem: false, hasRawWarning: false }
  );

  assert.equal(
    resolveAuthFileStatusWarning(
      {
        name: 'unknown-time.json',
        status_code: 401,
        status_message: 'unauthorized',
      },
      runtime('ready', '2026-08-14T01:00:01Z')
    ).hasProblem,
    true,
    'a recovery without comparable credential evidence must not hide a 401'
  );

  const usageWait = resolveAuthFileStatusWarning(
    { name: 'waiting.json', status_message: '' },
    runtime('usage_wait', '2026-08-14T01:00:01Z')
  );
  assert.equal(usageWait.hasProblem, true);
  assert.equal(usageWait.hasRawWarning, false);

  const excluded = resolveAuthFileStatusWarning(
    { name: 'excluded.json', status_message: 'upstream unavailable', status_code: 503 },
    runtime('excluded', '2026-08-14T01:00:01Z')
  );
  assert.equal(excluded.hasProblem, true);
  assert.equal(excluded.hasRawWarning, false);
} finally {
  await server.close();
}

console.log('auth file status warning tests passed');
