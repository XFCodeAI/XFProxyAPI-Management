import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAuthFilesGroupAssignment } from '../src/features/authFiles/authFilesGroupAssignment.ts';

test('failed assignment can retry with the same normalized selection', async () => {
  const target = { name: 'codex-new@example.com.json' };
  const selectedGroups = ['plus', ' K12 ', 'PLUS'];
  const writes = [];
  let fail = true;
  const patch = async (currentTarget, groups) => {
    writes.push({ target: currentTarget, groups: [...groups] });
    if (fail) throw new Error('temporary write failure');
  };

  const first = await applyAuthFilesGroupAssignment([target], selectedGroups, patch);
  assert.equal(first.successCount, 0);
  assert.equal(first.failed.length, 1);
  assert.deepEqual(first.groups, ['plus', 'K12']);

  fail = false;
  const second = await applyAuthFilesGroupAssignment([target], selectedGroups, patch);
  assert.equal(second.successCount, 1);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(writes, [
    { target, groups: ['plus', 'K12'] },
    { target, groups: ['plus', 'K12'] },
  ]);
});

test('empty selection is passed through as an explicit group clear', async () => {
  const target = { name: 'codex-new@example.com.json' };
  let writtenGroups = null;
  const result = await applyAuthFilesGroupAssignment([target], [], async (_target, groups) => {
    writtenGroups = groups;
  });

  assert.equal(result.successCount, 1);
  assert.deepEqual(writtenGroups, []);
});
