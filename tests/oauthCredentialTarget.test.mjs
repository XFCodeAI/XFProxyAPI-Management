import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveOAuthCredentialTarget } from '../src/features/authFiles/oauthCredentialTarget.ts';

const credential = {
  provider: 'codex',
  id: 'codex-annahurst6911@outlook.json',
  name: 'codex-annahurst6911@outlook.json',
};

test('resolves only the exact OAuth credential among existing provider accounts', () => {
  const existing = {
    provider: 'codex',
    id: 'codex-existing@example.com.json',
    name: 'codex-existing@example.com.json',
    authIndex: 9,
    status: 'ready',
    modified: 999999,
  };
  const created = {
    ...credential,
    authIndex: 1,
    status: 'ready',
    modified: 1,
  };

  assert.equal(resolveOAuthCredentialTarget(credential, [existing, created]), created);
});

test('ignores unrelated inventory signature changes', () => {
  const unrelated = {
    provider: 'codex',
    id: 'codex-existing@example.com.json',
    name: 'codex-existing@example.com.json',
    authIndex: 100,
    disabled: true,
    size: 5000,
    status: 'error',
    unavailable: true,
  };

  assert.equal(resolveOAuthCredentialTarget(credential, [unrelated]), null);
});

test('rejects an inventory row whose logical name matches but ID does not', () => {
  const mismatched = { provider: 'codex', id: 'different-id', name: credential.name };
  assert.equal(resolveOAuthCredentialTarget(credential, [mismatched]), null);
});

test('rejects an inventory response that omits the returned credential ID', () => {
  const exact = { provider: 'codex', name: credential.name, groups: ['gpt-plus'] };
  assert.equal(resolveOAuthCredentialTarget(credential, [exact]), null);
});

test('rejects an exact ID and name from another provider', () => {
  const mismatched = { provider: 'claude', id: credential.id, name: credential.name };
  assert.equal(resolveOAuthCredentialTarget(credential, [mismatched]), null);
});

test('matches provider identity using the backend lowercase normalization', () => {
  const exact = { provider: 'Codex', id: credential.id, name: credential.name };
  assert.equal(resolveOAuthCredentialTarget(credential, [exact]), exact);
});
