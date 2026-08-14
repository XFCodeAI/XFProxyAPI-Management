import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { normalizeRoutingStrategy, ROUTING_STRATEGIES } = await server.ssrLoadModule(
    '/src/utils/routingStrategy.ts'
  );
  const visual = await server.ssrLoadModule('/src/hooks/useVisualConfig.ts');

  const aliases = new Map([
    ['round-robin', 'round-robin'],
    ['roundrobin', 'round-robin'],
    ['rr', 'round-robin'],
    ['weighted-round-robin', 'weighted-round-robin'],
    ['weightedroundrobin', 'weighted-round-robin'],
    ['wrr', 'weighted-round-robin'],
    ['fill-first', 'fill-first'],
    ['fillfirst', 'fill-first'],
    ['ff', 'fill-first'],
  ]);

  for (const [alias, canonical] of aliases) {
    assert.equal(normalizeRoutingStrategy(alias), canonical);
    assert.equal(normalizeRoutingStrategy(`  ${alias.toUpperCase()}  `), canonical);
  }
  assert.equal(normalizeRoutingStrategy('custom'), undefined);
  assert.equal(normalizeRoutingStrategy(''), undefined);
  assert.equal(normalizeRoutingStrategy(null), undefined);
  assert.deepEqual([...ROUTING_STRATEGIES], [
    'round-robin',
    'weighted-round-robin',
    'fill-first',
  ]);

  const readVisualStrategy = (inputStrategy) => {
    let result;

    function Harness() {
      const visualConfig = visual.useVisualConfig();
      const [loaded, setLoaded] = useState(false);
      if (!loaded) {
        assert.equal(
          visualConfig.loadVisualValuesFromYaml(`routing:\n  strategy: ${inputStrategy}\n`).ok,
          true
        );
        setLoaded(true);
      } else {
        result = visualConfig.visualValues.routingStrategy;
      }
      return null;
    }

    renderToStaticMarkup(createElement(Harness));
    return result;
  };

  for (const [alias, canonical] of aliases) {
    assert.equal(readVisualStrategy(alias), canonical);
  }

  function WriteHarness({ inputStrategy, outputStrategy }) {
    const visualConfig = visual.useVisualConfig();
    const [phase, setPhase] = useState(0);
    const yaml = `routing:\n  strategy: ${inputStrategy}\n`;

    if (phase === 0) {
      visualConfig.loadVisualValuesFromYaml(yaml);
      setPhase(1);
      return null;
    }
    if (phase === 1) {
      visualConfig.setVisualValues({ routingStrategy: outputStrategy });
      setPhase(2);
      return null;
    }
    return createElement('output', null, visualConfig.applyVisualChangesToYaml(yaml));
  }

  for (const [inputStrategy, outputStrategy] of [
    ['fill-first', 'round-robin'],
    ['round-robin', 'weighted-round-robin'],
    ['round-robin', 'fill-first'],
  ]) {
    const markup = renderToStaticMarkup(
      createElement(WriteHarness, { inputStrategy, outputStrategy })
    );
    assert.equal(markup.includes(`strategy: ${outputStrategy}`), true);
  }

} finally {
  await server.close();
}
