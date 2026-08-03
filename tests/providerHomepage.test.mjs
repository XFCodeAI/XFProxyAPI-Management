import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { getProviderHomepageUrl } = await server.ssrLoadModule(
    '/src/features/providers/providerHomepage.ts'
  );

  assert.equal(
    getProviderHomepageUrl('https://relay.example.com/v1/chat/completions?model=test#result'),
    'https://relay.example.com'
  );
  assert.equal(
    getProviderHomepageUrl(' http://relay.example.com:8317/anthropic '),
    'http://relay.example.com:8317'
  );
  assert.equal(
    getProviderHomepageUrl('https://user:secret@relay.example.com/v1'),
    'https://relay.example.com'
  );
  assert.equal(getProviderHomepageUrl('relay.example.com/v1'), '');
  assert.equal(getProviderHomepageUrl('javascript:alert(1)'), '');
  assert.equal(getProviderHomepageUrl('ftp://relay.example.com/v1'), '');
  assert.equal(getProviderHomepageUrl('https://'), '');
  assert.equal(getProviderHomepageUrl(null), '');
} finally {
  await server.close();
}

console.log('Provider homepage tests passed');
