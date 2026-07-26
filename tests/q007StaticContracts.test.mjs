import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const quotaConstants = await server.ssrLoadModule('/src/utils/quota/constants.ts');
  const configSearch = await server.ssrLoadModule('/src/components/config/configSearchIndex.ts');

  const antigravityHeaderNames = Object.keys(quotaConstants.ANTIGRAVITY_REQUEST_HEADERS).map(
    (name) => name.toLowerCase()
  );
  assert.equal(antigravityHeaderNames.includes('user-agent'), false);

  const identityConfuse = configSearch.CONFIG_FIELD_SEARCH_INDEX.find(
    (entry) => entry.fieldId === 'codexIdentityConfuse'
  );
  assert.ok(identityConfuse);
  assert.deepEqual(identityConfuse.yamlKeys, ['codex', 'identity-confuse']);
} finally {
  await server.close();
}
