import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { initializeI18n, changeI18nLanguage } = await server.ssrLoadModule('/src/i18n/index.ts');
  await initializeI18n();
  await changeI18nLanguage('en');

  const { AuthFileQuotaSection } = await server.ssrLoadModule(
    '/src/features/authFiles/components/AuthFileQuotaSection.tsx'
  );
  const { AuthFileCard } = await server.ssrLoadModule(
    '/src/features/authFiles/components/AuthFileCard.tsx'
  );
  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { buildModelIdentityDisplay, normalizeAnalyticsModel } = await server.ssrLoadModule(
    '/src/utils/modelIdentity.ts'
  );

  const markup = renderToStaticMarkup(
    createElement(AuthFileQuotaSection, {
      file: {
        name: 'disabled-codex.json',
        type: 'codex',
        auth_index: 'codex:disabled',
        disabled: true,
      },
      quotaType: 'codex',
      disableControls: false,
    })
  );
  assert.match(markup, /quotaMessageAction/);
  assert.equal(markup.includes('disabled=""'), false);

  const cardMarkup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      { delayDuration: 0 },
      createElement(AuthFileCard, {
        file: { name: 'disabled-codex.json', type: 'codex', disabled: true },
        compact: false,
        selected: false,
        resolvedTheme: 'light',
        disableControls: false,
        deleting: null,
        statusUpdating: {},
        manualRefreshing: {},
        quotaFilterType: null,
        statusBarCache: new Map(),
        onShowModels: () => {},
        onDownload: () => {},
        onManualRefresh: () => {},
        onOpenPrefixProxyEditor: () => {},
        onDelete: () => {},
        onToggleStatus: () => {},
        onToggleSelect: () => {},
      })
    )
  );
  const editButton = cardMarkup.match(
    /<button[^>]*aria-label="Auth File Details \/ Edit"[^>]*>/
  )?.[0];
  assert.ok(editButton);
  assert.equal(editButton.includes('disabled'), false);
  assert.match(cardMarkup, /role="switch"[^>]*aria-checked="false"/);

  assert.equal(normalizeAnalyticsModel('gpt-5.6(max)'), 'gpt-5.6');
  assert.equal(normalizeAnalyticsModel('custom(model)(HIGH)'), 'custom(model)');
  assert.equal(normalizeAnalyticsModel('custom-model(region-us)'), 'custom-model(region-us)');
  assert.equal(
    normalizeAnalyticsModel('custom-model(9223372036854775808)'),
    'custom-model(9223372036854775808)'
  );
  assert.equal(normalizeAnalyticsModel(' custom-model(max) '), ' custom-model(max) ');
  assert.deepEqual(
    buildModelIdentityDisplay(
      {
        requestedModel: 'gpt-5.6(max)',
        analyticsModel: 'gpt-5.6',
        resolvedModel: 'gpt-5.6-upstream',
      },
      'requested'
    ),
    [
      { role: 'requested', value: 'gpt-5.6(max)' },
      { role: 'analytics', value: 'gpt-5.6' },
      { role: 'resolved', value: 'gpt-5.6-upstream' },
    ]
  );
} finally {
  await server.close();
}

console.log('Q-005 management panel tests passed');
