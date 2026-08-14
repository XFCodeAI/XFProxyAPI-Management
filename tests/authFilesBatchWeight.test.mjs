import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const credential = (index, overrides = {}) => ({
  name: `codex-${index}@example.com.json`,
  credential_id: `credential-${index}`,
  auth_index: `codex:${index}`,
  credential_generation: 7,
  ...overrides,
});

const responseFor = (target, weight, revision) => ({
  inventory_id: 'inventory-a',
  revision,
  files: [
    credential(target.name.match(/codex-(\d+)/)?.[1] ?? '0', {
      name: target.name,
      credential_id: target.credentialId,
      auth_index: target.authIndex,
      credential_generation: target.credentialGeneration,
      ...(weight === null ? {} : { weight }),
    }),
  ],
});

try {
  const {
    AUTH_FILES_BATCH_WEIGHT_CONCURRENCY,
    applyAuthFilesBatchWeight,
    createAuthFilesBatchWeightPlan,
  } = await server.ssrLoadModule('/src/features/authFiles/authFilesBatchWeight.ts');

  test('batch weight applies successfully with identity-fenced targets', async () => {
    const inventory = {
      files: [credential(1), credential(2)],
      inventoryId: 'inventory-a',
      revision: 10,
    };
    const plan = createAuthFilesBatchWeightPlan(
      inventory,
      inventory.files.map((file) => file.name)
    );
    const calls = [];
    let revision = 10;

    const result = await applyAuthFilesBatchWeight({
      plan,
      weight: 8,
      getInventory: () => inventory,
      patch: async (target, fields) => {
        calls.push({ target, fields });
        revision += 1;
        return responseFor(target, fields.weight, revision);
      },
    });

    assert.equal(result.successCount, 2);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(
      calls.map(({ target, fields }) => ({
        credentialId: target.credentialId,
        authIndex: target.authIndex,
        credentialGeneration: target.credentialGeneration,
        weight: fields.weight,
      })),
      [
        {
          credentialId: 'credential-1',
          authIndex: 'codex:1',
          credentialGeneration: 7,
          weight: 8,
        },
        {
          credentialId: 'credential-2',
          authIndex: 'codex:2',
          credentialGeneration: 7,
          weight: 8,
        },
      ]
    );
    assert.deepEqual(
      result.versions.map((version) => version.revision),
      [11, 12]
    );
  });

  test('batch weight reports partial failures without discarding successful versions', async () => {
    const inventory = {
      files: [credential(1), credential(2), credential(3)],
      inventoryId: 'inventory-a',
      revision: 20,
    };
    const plan = createAuthFilesBatchWeightPlan(
      inventory,
      inventory.files.map((file) => file.name)
    );

    const result = await applyAuthFilesBatchWeight({
      plan,
      weight: 3,
      getInventory: () => inventory,
      patch: async (target, fields) => {
        if (target.credentialId === 'credential-2') throw new Error('write failed');
        const index = target.credentialId === 'credential-1' ? 21 : 23;
        return responseFor(target, fields.weight, index);
      },
    });

    assert.equal(result.successCount, 2);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].target.credentialId, 'credential-2');
    assert.equal(result.failed[0].reason, 'patch_failed');
    assert.deepEqual(
      result.versions.map((version) => version.revision),
      [21, 23]
    );
  });

  test('backend identity conflicts are classified as stale identities', async () => {
    const inventory = {
      files: [credential(1)],
      inventoryId: 'inventory-a',
      revision: 25,
    };
    const plan = createAuthFilesBatchWeightPlan(inventory, [inventory.files[0].name]);
    const identityConflict = Object.assign(new Error('credential changed'), {
      status: 409,
      code: 'auth_identity_changed',
    });

    const result = await applyAuthFilesBatchWeight({
      plan,
      weight: 4,
      getInventory: () => inventory,
      patch: async () => {
        throw identityConflict;
      },
    });

    assert.equal(result.successCount, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].reason, 'stale_identity');
    assert.equal(result.failed[0].error, identityConflict);
  });

  test('batch weight clear sends null and confirms the explicit weight was removed', async () => {
    const inventory = {
      files: [credential(1, { weight: 9 })],
      inventoryId: 'inventory-a',
      revision: 30,
    };
    const plan = createAuthFilesBatchWeightPlan(inventory, [inventory.files[0].name]);
    const fieldsSeen = [];

    const result = await applyAuthFilesBatchWeight({
      plan,
      weight: null,
      getInventory: () => inventory,
      patch: async (target, fields) => {
        fieldsSeen.push(fields);
        return responseFor(target, fields.weight, 31);
      },
    });

    assert.equal(result.successCount, 1);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(fieldsSeen, [{ weight: null }]);
    assert.equal('weight' in result.versions[0].files[0], false);
  });

  test('stale inventory and credential generation are rejected before PATCH', async () => {
    const original = credential(1);
    let inventory = {
      files: [original],
      inventoryId: 'inventory-a',
      revision: 40,
    };
    const plan = createAuthFilesBatchWeightPlan(inventory, [original.name]);
    let patchCount = 0;

    inventory = {
      files: [credential(1, { credential_generation: 8 })],
      inventoryId: 'inventory-a',
      revision: 41,
    };
    const staleGeneration = await applyAuthFilesBatchWeight({
      plan,
      weight: 2,
      getInventory: () => inventory,
      patch: async () => {
        patchCount += 1;
        return {};
      },
    });
    assert.equal(staleGeneration.successCount, 0);
    assert.equal(staleGeneration.failed[0].reason, 'stale_identity');

    inventory = {
      files: [original],
      inventoryId: 'inventory-b',
      revision: 1,
    };
    const staleInventory = await applyAuthFilesBatchWeight({
      plan,
      weight: 2,
      getInventory: () => inventory,
      patch: async () => {
        patchCount += 1;
        return {};
      },
    });
    assert.equal(staleInventory.successCount, 0);
    assert.equal(staleInventory.failed[0].reason, 'stale_inventory');
    assert.equal(patchCount, 0);
  });

  test('batch weight bounds concurrent PATCH requests', async () => {
    const files = Array.from({ length: 19 }, (_, index) => credential(index + 1));
    const inventory = {
      files,
      inventoryId: 'inventory-a',
      revision: 50,
    };
    const plan = createAuthFilesBatchWeightPlan(
      inventory,
      files.map((file) => file.name)
    );
    let active = 0;
    let maximumActive = 0;
    let revision = 50;

    const result = await applyAuthFilesBatchWeight({
      plan,
      weight: 5,
      getInventory: () => inventory,
      patch: async (target, fields) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        revision += 1;
        return responseFor(target, fields.weight, revision);
      },
    });

    assert.equal(result.successCount, files.length);
    assert.equal(result.failed.length, 0);
    assert.equal(maximumActive, AUTH_FILES_BATCH_WEIGHT_CONCURRENCY);
    assert.ok(maximumActive < files.length);
  });
} finally {
  await server.close();
}

console.log('auth files batch weight tests passed');
