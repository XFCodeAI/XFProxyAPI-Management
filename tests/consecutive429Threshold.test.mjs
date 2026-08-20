import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const thresholdModule = await server.ssrLoadModule('/src/utils/consecutive429Threshold.ts');
  const workbenchModule = await server.ssrLoadModule(
    '/src/features/providers/useProviderWorkbench.ts'
  );
  const providersModule = await server.ssrLoadModule('/src/services/api/providers.ts');
  const transformersModule = await server.ssrLoadModule('/src/services/api/transformers.ts');

  assert.equal(thresholdModule.normalizeConsecutive429Threshold(undefined), 3);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(1), true);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(100), true);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(0), false);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(101), false);
  assert.equal(thresholdModule.isValidConsecutive429Threshold(1.5), false);

  const baseInput = {
    apiKey: '',
    name: 'gateway',
    baseUrl: 'https://gateway.example/v1',
    proxyUrl: '',
    prefix: '',
    disabled: false,
    disableCooling: false,
    fallback: false,
    concurrencyMode: 'inherit',
    maxConcurrency: 0,
    models: [],
    headers: [],
    excludedModelsText: '',
    apiKeyEntries: [
      {
        apiKey: 'secret',
        proxyUrl: '',
        concurrencyMode: 'inherit',
        maxConcurrency: 0,
      },
    ],
  };

  const defaultConfig = workbenchModule.buildOpenAIConfig(baseInput);
  assert.equal(defaultConfig.consecutive429Threshold, 3);
  const defaultPayload = providersModule.serializeOpenAIProvider(defaultConfig);
  assert.equal('consecutive-429-threshold' in defaultPayload, false);
  assert.equal(
    transformersModule.normalizeOpenAIProvider(defaultPayload).consecutive429Threshold,
    3
  );

  for (const threshold of [1, 7, 100]) {
    const config = workbenchModule.buildOpenAIConfig({
      ...baseInput,
      disableCooling: true,
      consecutive429Threshold: threshold,
    });
    assert.equal(config.consecutive429Threshold, threshold);
    assert.equal(config.disableCooling, true);
    const payload = providersModule.serializeOpenAIProvider(config);
    assert.equal(payload['disable-cooling'], true);
    assert.equal(payload['consecutive-429-threshold'], threshold);
    assert.equal(
      transformersModule.normalizeOpenAIProvider(payload).consecutive429Threshold,
      threshold
    );
  }

  const mergedDefault = providersModule.mergeOpenAIProviderPayload(
    {
      name: 'gateway',
      'base-url': 'https://gateway.example/v1',
      'consecutive-429-threshold': 9,
      'backend-only': { preserved: true },
    },
    defaultPayload
  );
  assert.equal('consecutive-429-threshold' in mergedDefault, false);
  assert.deepEqual(mergedDefault['backend-only'], { preserved: true });

  const invalidConfig = workbenchModule.buildOpenAIConfig({
    ...baseInput,
    consecutive429Threshold: 101,
  });
  assert.equal(invalidConfig.consecutive429Threshold, 3);

  const formSource = await readFile(
    new URL('../src/features/providers/sheets/forms/BaseProviderForm.tsx', import.meta.url),
    'utf8'
  );
  assert.match(formSource, /disabled=\{mutating \|\| form\.disableCooling === true\}/);
  assert.match(formSource, /isValidConsecutive429Threshold\(form\.consecutive429Threshold\)/);
} finally {
  await server.close();
}

console.log('consecutive 429 threshold tests passed');
