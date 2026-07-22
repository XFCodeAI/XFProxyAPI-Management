import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForCredentialGroupsCatalog } from '../src/hooks/credentialGroupsCatalogPolling.ts';

test('catalog retries transient failures and resolves existing groups without overlap', async () => {
  const controller = new AbortController();
  const delays = [];
  const failures = [];
  let calls = 0;
  let active = 0;
  let maxActive = 0;

  const result = await waitForCredentialGroupsCatalog({
    signal: controller.signal,
    isCurrent: () => true,
    retry: true,
    random: () => 0.5,
    load: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (calls <= 3) throw new Error(`failure-${calls}`);
        return ['plus', 'k12'];
      } finally {
        active -= 1;
      }
    },
    onFailure: (error) => failures.push(error.message),
    sleep: async (delay) => {
      delays.push(delay);
    },
  });

  assert.deepEqual(result, { status: 'ready', groups: ['plus', 'k12'] });
  assert.equal(maxActive, 1);
  assert.deepEqual(delays, [1_000, 2_000, 4_000]);
  assert.deepEqual(failures, ['failure-1', 'failure-2', 'failure-3']);
});

test('catalog cancellation does not publish a stale result', async () => {
  const controller = new AbortController();
  let current = true;
  const result = await waitForCredentialGroupsCatalog({
    signal: controller.signal,
    isCurrent: () => current,
    retry: true,
    load: async () => {
      throw new Error('offline');
    },
    sleep: async () => {
      current = false;
    },
  });

  assert.deepEqual(result, { status: 'cancelled' });
});

test('non-retrying consumers preserve the existing one-shot behavior', async () => {
  const controller = new AbortController();
  const error = new Error('unavailable');
  const result = await waitForCredentialGroupsCatalog({
    signal: controller.signal,
    isCurrent: () => true,
    retry: false,
    load: async () => {
      throw error;
    },
  });

  assert.deepEqual(result, { status: 'failed', error });
});
