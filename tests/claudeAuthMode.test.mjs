import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { normalizeProviderKeyConfig } = await server.ssrLoadModule(
    '/src/services/api/transformers.ts'
  );
  const { mergeClaudeProviderPayload, serializeProviderKey } = await server.ssrLoadModule(
    '/src/services/api/providers.ts'
  );

  assert.equal(
    normalizeProviderKeyConfig({ 'api-key': 'x-key', 'auth-mode': 'x-api-key' })?.authMode,
    'x-api-key'
  );
  assert.equal(
    normalizeProviderKeyConfig({ 'api-key': 'bearer-key', 'auth-mode': 'bearer' })?.authMode,
    'bearer'
  );
  assert.equal(normalizeProviderKeyConfig({ 'api-key': 'legacy-key' })?.authMode, undefined);

  assert.equal(
    serializeProviderKey({ apiKey: 'x-key', authMode: 'x-api-key' })['auth-mode'],
    'x-api-key'
  );
  assert.equal(
    serializeProviderKey({ apiKey: 'bearer-key', authMode: 'bearer' })['auth-mode'],
    'bearer'
  );
  assert.equal(serializeProviderKey({ apiKey: 'legacy-key' })['auth-mode'], undefined);

  const merged = mergeClaudeProviderPayload(
    {
      'api-key': 'legacy-key',
      'auth-mode': 'bearer',
      'future-provider-field': { retained: true },
      models: [{ name: 'claude-test', 'future-model-field': 'retained' }],
      cloak: { mode: 'auto', 'future-cloak-field': 'retained' },
    },
    serializeProviderKey({
      apiKey: 'legacy-key',
      authMode: 'x-api-key',
      models: [{ name: 'claude-test', alias: 'claude-alias' }],
      cloak: { mode: 'off', strictMode: true },
    })
  );
  assert.equal(merged['auth-mode'], 'x-api-key');
  assert.deepEqual(merged['future-provider-field'], { retained: true });
  assert.equal(merged.models[0]['future-model-field'], 'retained');
  assert.equal(merged.cloak['future-cloak-field'], 'retained');
} finally {
  await server.close();
}

console.log('Claude authentication mode tests passed');
