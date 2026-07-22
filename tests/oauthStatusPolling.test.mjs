import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForOAuthStatus } from '../src/hooks/oauthStatusPolling.ts';

test('status polling retries transient failures without overlapping requests', async () => {
  const controller = new AbortController();
  const delays = [];
  let calls = 0;
  let active = 0;
  let maxActive = 0;

  const result = await waitForOAuthStatus({
    signal: controller.signal,
    isCurrent: () => true,
    random: () => 0.5,
    request: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (calls === 1) throw new Error('offline');
        if (calls < 4) return { status: 'wait' };
        return { status: 'ok', credential: {} };
      } finally {
        active -= 1;
      }
    },
    sleep: async (delay) => {
      delays.push(delay);
    },
  });

  assert.equal(result?.status, 'ok');
  assert.equal(maxActive, 1);
  assert.deepEqual(delays, [1_000, 3_000, 3_000]);
});

test('status polling stops when its attempt is superseded', async () => {
  const controller = new AbortController();
  let current = true;
  const result = await waitForOAuthStatus({
    signal: controller.signal,
    isCurrent: () => current,
    request: async () => ({ status: 'wait' }),
    sleep: async () => {
      current = false;
    },
  });

  assert.equal(result, null);
});
