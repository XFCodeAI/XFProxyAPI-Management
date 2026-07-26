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
  const types = await server.ssrLoadModule('/src/types/visualConfig.ts');

  assert.equal(visual.parseDisableImageGenerationMode('passthrough'), 'passthrough');
  const values = structuredClone(types.DEFAULT_VISUAL_VALUES);
  values.redisUsageQueueRetentionSeconds = '0';
  assert.equal(
    visual.getVisualConfigValidationErrors(values).redisUsageQueueRetentionSeconds,
    'integer_range_1_3600'
  );
  values.redisUsageQueueRetentionSeconds = '3600';
  assert.equal(
    visual.getVisualConfigValidationErrors(values).redisUsageQueueRetentionSeconds,
    undefined
  );

  function Harness() {
    const visualConfig = visual.useVisualConfig();
    const [phase, setPhase] = useState(0);

    if (phase === 0) {
      visualConfig.loadVisualValuesFromYaml(
        'debug: false\nproxy-url: http://old-proxy.example\ndisable-image-generation: false\n'
      );
      setPhase(1);
    } else if (phase === 1) {
      visualConfig.setVisualValues({
        proxyUrl: 'http://localhost:8080',
        disableImageGeneration: 'passthrough',
      });
      setPhase(2);
    } else {
      return createElement(
        'pre',
        null,
        visualConfig.applyVisualChangesToYaml(
          'debug: true\nproxy-url: http://old-proxy.example\ndisable-image-generation: false\n'
        )
      );
    }

    return null;
  }

  const markup = renderToStaticMarkup(createElement(Harness));
  const merged = parseYaml(markup.slice('<pre>'.length, -'</pre>'.length));
  assert.deepEqual(merged, {
    debug: true,
    'proxy-url': 'http://localhost:8080',
    'disable-image-generation': 'passthrough',
  });
} finally {
  await server.close();
}
