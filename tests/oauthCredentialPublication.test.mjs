import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolvePublishedOAuthCredential,
  waitForOAuthCredentialPublication,
} from '../src/features/authFiles/oauthCredentialPublication.ts';

const receipt = {
  provider: 'codex',
  id: 'codex-new@example.com.json',
  name: 'codex-new@example.com.json',
  disposition: 'created',
  inventory_id: 'inventory-a',
  revision: 12,
};

const target = {
  provider: receipt.provider,
  id: receipt.id,
  name: receipt.name,
};

test('same inventory waits for the receipt revision', () => {
  assert.equal(
    resolvePublishedOAuthCredential(receipt, {
      inventory_id: receipt.inventory_id,
      revision: receipt.revision - 1,
      files: [target],
    }),
    null
  );
  assert.equal(
    resolvePublishedOAuthCredential(receipt, {
      inventory_id: receipt.inventory_id,
      revision: receipt.revision,
      files: [target],
    }),
    target
  );
});

test('fresh snapshot from a different inventory may satisfy the exact receipt', () => {
  assert.equal(
    resolvePublishedOAuthCredential(receipt, {
      inventory_id: 'inventory-after-restart',
      revision: 1,
      files: [target],
    }),
    target
  );
});

test('waits indefinitely through a simulated 30 second publication delay', async () => {
  const controller = new AbortController();
  let elapsed = 0;
  let refreshCount = 0;
  const result = await waitForOAuthCredentialPublication({
    credential: receipt,
    signal: controller.signal,
    isCurrent: () => true,
    refresh: async () => {
      refreshCount += 1;
      return {
        inventory_id: receipt.inventory_id,
        revision: receipt.revision,
        files: elapsed >= 30_000 ? [target] : [],
      };
    },
    sleep: async (delay) => {
      elapsed += delay;
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.credential, target);
  assert.equal(elapsed, 30_000);
  assert.equal(refreshCount, 31);
});

test('retries transient refresh failures with bounded backoff', async () => {
  const controller = new AbortController();
  const delays = [];
  let refreshCount = 0;
  const result = await waitForOAuthCredentialPublication({
    credential: receipt,
    signal: controller.signal,
    isCurrent: () => true,
    random: () => 0.5,
    refresh: async () => {
      refreshCount += 1;
      if (refreshCount <= 3) throw new Error('offline');
      return {
        inventory_id: receipt.inventory_id,
        revision: receipt.revision,
        files: [target],
      };
    },
    sleep: async (delay) => {
      delays.push(delay);
    },
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(delays, [1_000, 2_000, 4_000]);
});

test('cancels without publishing a stale credential', async () => {
  const controller = new AbortController();
  let current = true;
  const result = await waitForOAuthCredentialPublication({
    credential: receipt,
    signal: controller.signal,
    isCurrent: () => current,
    refresh: async () => ({
      inventory_id: receipt.inventory_id,
      revision: receipt.revision,
      files: [],
    }),
    sleep: async () => {
      current = false;
    },
  });

  assert.deepEqual(result, { status: 'cancelled' });
});
