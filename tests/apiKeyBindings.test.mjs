import assert from 'node:assert/strict';
import {
  normalizeCredentialGroupNames,
  resolveApiKeyEntries,
  resolveApiKeysText,
  resolveApiKeyCredentialGroups,
  resolveCredentialGroupOptions,
  serializeApiKeyEntriesForYaml,
} from '../src/hooks/apiKeyBindings.ts';

function testParsesScalarAndGroupedEntries() {
  const parsed = {
    'api-keys': [
      'plain-key',
      { key: 'tenant-a', allow: ['codex', 'claude:work'], groups: ['paid', 'team-a'] },
    ],
  };
  const entries = resolveApiKeyEntries(parsed);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { key: 'plain-key', groups: [] });
  assert.deepEqual(entries[1], {
    key: 'tenant-a',
    groups: ['paid', 'team-a'],
  });

  assert.equal(resolveApiKeysText(parsed), 'plain-key\ntenant-a');
  assert.deepEqual(resolveApiKeyCredentialGroups(parsed), { 'tenant-a': ['paid', 'team-a'] });
}

function testUnboundDeploymentHasEmptyGroups() {
  const parsed = { 'api-keys': ['k1', 'k2'] };
  assert.deepEqual(resolveApiKeyCredentialGroups(parsed), {});
  assert.equal(resolveApiKeysText(parsed), 'k1\nk2');
}

function testLegacyConfigApiKeyProviderFallbackIgnoresAllow() {
  const parsed = {
    auth: {
      providers: {
        'config-api-key': {
          'api-key-entries': [{ key: 'tenant-b', allow: ['gemini'], groups: ['shared'] }],
        },
      },
    },
  };
  assert.deepEqual(resolveApiKeyEntries(parsed), [{ key: 'tenant-b', groups: ['shared'] }]);
  assert.deepEqual(resolveApiKeyCredentialGroups(parsed), { 'tenant-b': ['shared'] });
}

function testNormalizeCredentialGroupsTrimsDedupsPreservesOrder() {
  assert.deepEqual(normalizeCredentialGroupNames([' paid ', 'Paid', '', 'team-a']), [
    'paid',
    'team-a',
  ]);
  assert.deepEqual(normalizeCredentialGroupNames('not-array'), []);
}

function testSerializeEmitsScalarForAllCredentialsAndObjectForGroups() {
  const out = serializeApiKeyEntriesForYaml('plain-key\ntenant-a', {
    'tenant-a': ['paid', 'team-a'],
  });
  assert.deepEqual(out, ['plain-key', { key: 'tenant-a', groups: ['paid', 'team-a'] }]);
}

function testSerializeDropsGroupsForRemovedKey() {
  const out = serializeApiKeyEntriesForYaml('plain-key', { 'tenant-a': ['paid'] });
  assert.deepEqual(out, ['plain-key']);
}

function testSerializeMovesGroupsOnRename() {
  const out = serializeApiKeyEntriesForYaml('tenant-z', { 'tenant-z': ['paid'] });
  assert.deepEqual(out, [{ key: 'tenant-z', groups: ['paid'] }]);
}

function testRoundTripDropsLegacyAllow() {
  const parsed = {
    'api-keys': [
      { key: 'tenant-a', allow: ['codex', 'claude:work'], groups: ['paid', 'team-a'] },
      'plain',
    ],
  };
  const text = resolveApiKeysText(parsed);
  const groups = resolveApiKeyCredentialGroups(parsed);
  const out = serializeApiKeyEntriesForYaml(text, groups);
  assert.deepEqual(out, [{ key: 'tenant-a', groups: ['paid', 'team-a'] }, 'plain']);
}

function testResolveCredentialGroupOptions() {
  const parsed = {
    'credential-groups': ['Paid', 'team-a'],
    'api-keys': [{ key: 'tenant-a', groups: ['shared'] }],
    'codex-api-key': [{ groups: ['plus', 'TEAM-A'] }],
    'openai-compatibility': [
      {
        name: 'chatgpt',
        'api-key-entries': [{ groups: ['vip'] }, { groups: ['shared'] }],
      },
    ],
  };
  assert.deepEqual(resolveCredentialGroupOptions(parsed), [
    'Paid',
    'team-a',
    'shared',
    'plus',
    'vip',
  ]);
}

const tests = [
  testParsesScalarAndGroupedEntries,
  testUnboundDeploymentHasEmptyGroups,
  testLegacyConfigApiKeyProviderFallbackIgnoresAllow,
  testNormalizeCredentialGroupsTrimsDedupsPreservesOrder,
  testSerializeEmitsScalarForAllCredentialsAndObjectForGroups,
  testSerializeDropsGroupsForRemovedKey,
  testSerializeMovesGroupsOnRename,
  testRoundTripDropsLegacyAllow,
  testResolveCredentialGroupOptions,
];

let failed = 0;
for (const test of tests) {
  try {
    test();
    console.log(`ok - ${test.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL - ${test.name}`);
    console.error(err);
  }
}

if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}

console.log(`All ${tests.length} apiKeyBindings tests passed`);
