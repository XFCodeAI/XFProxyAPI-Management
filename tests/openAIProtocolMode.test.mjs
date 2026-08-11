import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { normalizeOpenAIProvider } = await server.ssrLoadModule(
    '/src/services/api/transformers.ts'
  );
  const { mergeOpenAIProviderPayload, serializeOpenAIProvider } = await server.ssrLoadModule(
    '/src/services/api/providers.ts'
  );

  const baseRecord = {
    name: 'gateway',
    'base-url': 'https://gateway.example/v1',
    'api-key-entries': [{ 'api-key': 'supplier-key' }],
  };

  assert.equal(normalizeOpenAIProvider(baseRecord)?.protocolMode, 'chat-completions');
  assert.equal(normalizeOpenAIProvider(baseRecord)?.retryOwner, 'xfpa');
  assert.equal(
    normalizeOpenAIProvider({ ...baseRecord, 'protocol-mode': 'preserve-openai' })?.protocolMode,
    'preserve-openai'
  );
  assert.equal(
    normalizeOpenAIProvider({ ...baseRecord, 'protocol-mode': 'auto' })?.protocolMode,
    'auto'
  );
  assert.equal(
    normalizeOpenAIProvider({ ...baseRecord, 'retry-owner': 'upstream' })?.retryOwner,
    'upstream'
  );

  const preserved = serializeOpenAIProvider({
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    apiKeyEntries: [{ apiKey: 'supplier-key' }],
    protocolMode: 'preserve-openai',
  });
  assert.equal(preserved['protocol-mode'], 'preserve-openai');

  const automatic = serializeOpenAIProvider({
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    apiKeyEntries: [{ apiKey: 'supplier-key' }],
    protocolMode: 'auto',
  });
  assert.equal(automatic['protocol-mode'], 'auto');

  const upstreamOwned = serializeOpenAIProvider({
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    apiKeyEntries: [{ apiKey: 'supplier-key' }],
    retryOwner: 'upstream',
  });
  assert.equal(upstreamOwned['retry-owner'], 'upstream');

  const compatible = serializeOpenAIProvider({
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    apiKeyEntries: [{ apiKey: 'supplier-key' }],
    protocolMode: 'chat-completions',
  });
  assert.equal(compatible['protocol-mode'], undefined);
  assert.equal(compatible['retry-owner'], undefined);
  assert.equal(
    mergeOpenAIProviderPayload(
      { ...baseRecord, 'protocol-mode': 'preserve-openai', custom: 'kept' },
      compatible
    )['protocol-mode'],
    undefined
  );
  assert.equal(
    mergeOpenAIProviderPayload(
      { ...baseRecord, 'protocol-mode': 'preserve-openai', custom: 'kept' },
      compatible
    ).custom,
    'kept'
  );

  const imageRouteRecord = {
    ...baseRecord,
    'codex-image-route': {
      enabled: true,
      'target-supplier': 'images',
      'target-model': 'image-pro',
    },
  };
  assert.deepEqual(normalizeOpenAIProvider(imageRouteRecord)?.codexImageRoute, {
    enabled: true,
    targetSupplier: 'images',
    targetModel: 'image-pro',
  });
  const imageRoutePayload = serializeOpenAIProvider({
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    apiKeyEntries: [{ apiKey: 'supplier-key' }],
    codexImageRoute: {
      enabled: true,
      targetSupplier: ' images ',
      targetModel: ' image-pro ',
    },
  });
  assert.deepEqual(imageRoutePayload['codex-image-route'], {
    enabled: true,
    'target-supplier': 'images',
    'target-model': 'image-pro',
  });
  assert.equal(
    mergeOpenAIProviderPayload(imageRouteRecord, compatible)['codex-image-route'],
    undefined
  );
} finally {
  await server.close();
}
