import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { ApiKeyEntriesEditor } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/ApiKeyEntriesEditor.tsx'
  );
  const { ModelEntriesEditor } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/ModelEntriesEditor.tsx'
  );
  const { ConnectivityStatusIcon } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/ConnectivityStatusIcon.tsx'
  );
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );

  const renderWithTooltips = (element) =>
    renderToStaticMarkup(createElement(TooltipProvider, { delayDuration: 0 }, element));
  const idleStatuses = Array.from({ length: 12 }, () => ({ state: 'idle', message: '' }));
  const apiEntries = Array.from({ length: 12 }, (_, idx) => ({
    name: `account-${idx + 1}`,
    apiKey: `sk-entry-${String(idx + 1).padStart(4, '0')}`,
    groups: idx === 11 ? ['paid'] : [],
    proxyUrl: `http://proxy-${idx + 1}.example`,
  }));
  const sharedApiProps = {
    credentialGroupOptions: ['paid', 'fallback'],
    credentialGroupsLabel: 'Credential groups',
    credentialGroupsHint: 'Routing groups',
    credentialGroupsEmpty: 'No groups',
    aliasLabel: 'Alias',
    aliasHint: 'Optional display alias',
    removeDisabled: false,
    mutating: false,
    isTestingAny: false,
    onUpdate: () => {},
    onAdd: () => 12,
    onRemove: () => {},
    onTest: () => {},
    onTestAll: () => {},
  };

  const collapsedApiMarkup = renderWithTooltips(
    createElement(ApiKeyEntriesEditor, {
      ...sharedApiProps,
      entries: apiEntries,
      statuses: idleStatuses,
    })
  );
  assert.equal((collapsedApiMarkup.match(/Key #/g) ?? []).length, 10);
  assert.equal(collapsedApiMarkup.includes('Key #12'), true);
  assert.equal(collapsedApiMarkup.includes('Key #3'), true);
  assert.equal(collapsedApiMarkup.includes('Key #2<'), false);
  assert.equal(collapsedApiMarkup.includes('http://proxy-12.example'), true);
  assert.equal(collapsedApiMarkup.includes('http://proxy-2.example'), false);
  assert.equal(collapsedApiMarkup.includes('type="password"'), false);
  assert.equal(collapsedApiMarkup.includes('Show all (12)'), true);
  assert.equal((collapsedApiMarkup.match(/>Proxy</g) ?? []).length, 10);

  const expandedApiMarkup = renderWithTooltips(
    createElement(ApiKeyEntriesEditor, {
      ...sharedApiProps,
      entries: [
        {
          name: 'xf-entry-alias',
          apiKey: '',
          groups: ['paid'],
          proxyUrl: 'http://xf-entry-proxy.example',
        },
      ],
      statuses: [{ state: 'idle', message: '' }],
      removeDisabled: true,
      onAdd: () => 1,
    })
  );
  assert.equal(expandedApiMarkup.includes('type="password"'), true);
  assert.equal(expandedApiMarkup.includes('xf-entry-alias'), true);
  assert.equal(expandedApiMarkup.includes('paid'), true);
  assert.equal(expandedApiMarkup.includes('http://xf-entry-proxy.example'), true);

  const models = Array.from({ length: 12 }, (_, idx) => ({
    name: `model-${idx + 1}`,
    alias: `alias-${idx + 1}`,
    image: idx === 0,
    thinkingJson: idx === 0 ? '{"levels":["high"]}' : '',
  }));
  const modelMarkup = renderWithTooltips(
    createElement(ModelEntriesEditor, {
      models,
      extendedOptions: true,
      mutating: false,
      removeDisabled: false,
      onUpdate: () => {},
      onAdd: () => {},
      onRemove: () => {},
    })
  );
  assert.equal((modelMarkup.match(/placeholder="model-name"/g) ?? []).length, 10);
  assert.equal(modelMarkup.includes('value="model-10"'), true);
  assert.equal(modelMarkup.includes('value="model-11"'), false);
  assert.equal(modelMarkup.includes('>Image<'), true);
  assert.equal(modelMarkup.includes('>Thinking<'), true);
  assert.equal(modelMarkup.includes('{&quot;levels&quot;'), false);
  assert.equal(modelMarkup.includes('Show all (12)'), true);

  const idleIcon = renderToStaticMarkup(createElement(ConnectivityStatusIcon, { state: 'idle' }));
  const loadingIcon = renderToStaticMarkup(
    createElement(ConnectivityStatusIcon, { state: 'loading' })
  );
  const successIcon = renderToStaticMarkup(
    createElement(ConnectivityStatusIcon, { state: 'success' })
  );
  const errorIcon = renderToStaticMarkup(createElement(ConnectivityStatusIcon, { state: 'error' }));
  assert.equal(idleIcon, '');
  assert.equal(loadingIcon.includes('<svg'), true);
  assert.equal(successIcon.includes('<svg'), true);
  assert.equal(errorIcon.includes('<svg'), true);
  assert.notEqual(loadingIcon, successIcon);
  assert.notEqual(successIcon, errorIcon);

  const baseFormMarkup = renderWithTooltips(
    createElement(BaseProviderForm, {
      brand: 'xai',
      resource: null,
      credentialGroupOptions: ['paid'],
      mode: 'create',
      mutating: false,
      formId: 'provider-editor-contract',
      onSubmit: async () => {},
      onDirtyChange: () => {},
    })
  );
  assert.equal(baseFormMarkup.includes('<form id="provider-editor-contract"'), true);
  assert.equal(baseFormMarkup.includes('https://api.x.ai/v1'), true);

  const baseSource = await readFile(
    new URL('../src/features/providers/sheets/forms/BaseProviderForm.tsx', import.meta.url),
    'utf8'
  );
  assert.match(baseSource, /onDirtyChange\?\.\(isDirty\)/);
  assert.match(baseSource, /i === idx \? \{ \.\.\.it, \.\.\.patch \} : it/);
  assert.match(baseSource, /brand === 'codex' \|\| brand === 'xai'/);
  assert.match(baseSource, /experimentalCchSigning/);
  assert.match(baseSource, /fallback: cfg\.fallback === true/);
} finally {
  await server.close();
}

console.log('provider form editor tests passed');
