import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parse as parseYaml } from 'yaml';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const visual = await server.ssrLoadModule('/src/hooks/useVisualConfig.ts');
  const parsedRules = visual.parsePluginStoreAuthRules([
    {
      match: 'https://private.example/',
      type: 'bearer',
      'token-env': 'PLUGIN_TOKEN',
      token: 'must-not-enter-visual-state',
      future: { secret: 'also-hidden' },
    },
  ]);
  assert.equal(parsedRules.length, 1);
  assert.equal(JSON.stringify(parsedRules).includes('must-not-enter-visual-state'), false);
  assert.equal(JSON.stringify(parsedRules).includes('also-hidden'), false);

  const baseline = `plugins:
  store-sources:
    - https://initial.example/registry.json
  future-plugin-option: keep
  store-auth:
    - match: https://private.example/
      apply-to: [registry]
      type: bearer
      token-env: OLD_PLUGIN_TOKEN
      future-rule-option: keep
top-level-unknown: keep
`;
  const latest = baseline.replace(
    'https://initial.example/registry.json',
    'https://concurrent.example/registry.json'
  );

  function Harness() {
    const config = visual.useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) {
      config.loadVisualValuesFromYaml(baseline);
      setPhase(1);
      return null;
    }
    if (phase === 1) {
      config.setVisualValues({
        pluginStoreAuth: [
          {
            ...config.visualValues.pluginStoreAuth[0],
            tokenEnv: 'NEW_PLUGIN_TOKEN',
          },
        ],
      });
      setPhase(2);
      return null;
    }
    return createElement('pre', null, config.applyVisualChangesToYaml(latest));
  }

  const markup = renderToStaticMarkup(createElement(Harness));
  const merged = parseYaml(markup.slice('<pre>'.length, -'</pre>'.length));
  assert.deepEqual(merged.plugins['store-sources'], ['https://concurrent.example/registry.json']);
  assert.equal(merged.plugins['future-plugin-option'], 'keep');
  assert.equal(merged.plugins['store-auth'][0]['token-env'], 'NEW_PLUGIN_TOKEN');
  assert.equal(merged.plugins['store-auth'][0]['future-rule-option'], 'keep');
  assert.equal(merged['top-level-unknown'], 'keep');
} finally {
  await server.close();
}

console.log('Plugin store auth YAML tests passed');
