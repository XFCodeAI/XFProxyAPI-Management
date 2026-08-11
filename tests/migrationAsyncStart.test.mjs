import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { REQUEST_TIMEOUT_MS } from '../src/utils/constants.ts';
import {
  clearMigrationTransferID,
  readMigrationTransferID,
  shouldPersistMigrationTransfer,
  writeMigrationTransferID,
} from '../src/features/migration/transferSession.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('migration transfer session persists only a valid non-sensitive job id', () => {
  const storage = memoryStorage();
  const id = '0123456789abcdef0123456789abcdef';

  writeMigrationTransferID(storage, id);
  assert.equal(readMigrationTransferID(storage), id);

  writeMigrationTransferID(storage, 'invalid id');
  assert.equal(readMigrationTransferID(storage), id);

  clearMigrationTransferID(storage);
  assert.equal(readMigrationTransferID(storage), null);
});

test('active and failed jobs survive refresh while final jobs are cleared', () => {
  for (const status of ['preparing', 'staging', 'staged', 'applying', 'failed']) {
    assert.equal(shouldPersistMigrationTransfer(status), true, status);
  }
  assert.equal(shouldPersistMigrationTransfer('completed'), false);
  assert.equal(shouldPersistMigrationTransfer('canceled'), false);
});

test('migration page accepts preparing and resolves start failures inside confirmation', async () => {
  const source = await readFile(new URL('../src/pages/MigrationPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /case 'preparing':/);
  assert.match(source, /setSourceManagementKey\(''\)/);
  assert.match(source, /writeActiveMigrationTransferID\(response\.job\.id\)/);
  assert.match(source, /setTransfer\(response\.job\)/);
  assert.match(source, /migrationApi\.getTransfer\(id\)/);
  assert.match(source, /void poll\(\);/);
  assert.match(source, /pollTimer = window\.setTimeout/);
  assert.match(source, /return fallback;/);
  assert.doesNotMatch(source, /throw startError/);
  assert.doesNotMatch(source, /setInterval\(\(\) => void poll\(\), 1_500\)/);
  assert.equal(REQUEST_TIMEOUT_MS, 30_000);
});
