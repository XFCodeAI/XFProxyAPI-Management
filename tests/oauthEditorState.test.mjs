import assert from 'node:assert/strict';
import {
  getEffectiveOAuthExcludedRules,
  getModelAliasDraftSignature,
  getStringSetSignature,
  hasOAuthExcludedRule,
  isOAuthEditorDirty,
  updateOAuthExcludedRule,
} from '../src/features/authFiles/oauthEditorState.ts';
import {
  normalizeOauthModelAliasEntries,
  serializeOauthModelAliases,
} from '../src/services/api/oauthModelAlias.ts';

assert.equal(getStringSetSignature(['b', 'a']), getStringSetSignature(['a', 'b']));
assert.equal(
  getModelAliasDraftSignature([{ id: 'one', name: '', alias: '', fork: true }]),
  getModelAliasDraftSignature([])
);
assert.notEqual(
  getModelAliasDraftSignature([{ id: 'one', name: 'partial', alias: '', fork: true }]),
  getModelAliasDraftSignature([])
);
assert.equal(isOAuthEditorDirty('codex', 'codex', 'same', 'same'), false);
assert.equal(isOAuthEditorDirty('codex', 'claude', 'same', 'same'), true);

const rules = getEffectiveOAuthExcludedRules(['gpt-5', 'GPT-5'], 'gpt-*');
assert.deepEqual(rules, ['gpt-5', 'gpt-*']);
assert.equal(hasOAuthExcludedRule(rules, 'GPT-5'), true);
assert.deepEqual(updateOAuthExcludedRule(rules, 'GPT-5', false), ['gpt-*']);

const normalizedAliases = normalizeOauthModelAliasEntries([
  {
    name: 'gpt-5.6',
    alias: 'primary',
    fork: true,
    'display-name': 'Primary model',
    'force-mapping': false,
  },
]);
assert.deepEqual(normalizedAliases, [
  {
    name: 'gpt-5.6',
    alias: 'primary',
    fork: true,
    displayName: 'Primary model',
    forceMapping: false,
  },
]);
assert.deepEqual(serializeOauthModelAliases(normalizedAliases), [
  {
    name: 'gpt-5.6',
    alias: 'primary',
    fork: true,
    'display-name': 'Primary model',
    'force-mapping': false,
  },
]);
