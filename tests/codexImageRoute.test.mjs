import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const resource = ({
  id,
  name,
  models,
  route,
  disabled = false,
  apiKeyEntries = [{ apiKey: `sk-${id}` }],
  runtimeStatus = null,
}) => ({
  id,
  brand: 'openaiCompatibility',
  originalIndex: 0,
  name,
  groups: [],
  identifier: name,
  apiKeyPreview: null,
  apiKey: null,
  authIndex: null,
  baseUrl: `https://${id}.example/v1`,
  proxyUrl: null,
  prefix: null,
  modelCount: models.length,
  models: models.map((model) => model.alias || model.name),
  priority: 0,
  concurrencyMode: 'inherit',
  maxConcurrency: 0,
  fallback: false,
  headerCount: 0,
  excludedModelCount: 0,
  apiKeyEntryCount: apiKeyEntries.length,
  disabled,
  runtimeStatus,
  flags: {},
  selector: { brand: 'openaiCompatibility', name, index: 0 },
  raw: {
    name,
    baseUrl: `https://${id}.example/v1`,
    apiKeyEntries,
    disabled,
    models,
    codexImageRoute: route,
  },
});

try {
  const { initializeI18n, changeI18nLanguage } = await server.ssrLoadModule('/src/i18n/index.ts');
  await initializeI18n();
  await changeI18nLanguage('en');
  const imageRoute = await server.ssrLoadModule('/src/features/providers/codexImageRoute.ts');

  const imageSupplier = resource({
    id: 'images',
    name: 'Image supplier',
    models: [
      { name: 'gpt-image-2', alias: 'image-pro', image: true },
      { name: 'gpt-5.6', alias: 'chat-pro', image: false },
      { name: 'duplicate-a', alias: 'duplicate-image', image: true },
      { name: 'duplicate-b', alias: 'duplicate-image', image: true },
    ],
  });
  const source = resource({
    id: 'source',
    name: 'Codex gateway',
    models: [{ name: 'gpt-5.6', alias: 'gpt-5.6', image: false }],
    route: {
      enabled: true,
      targetSupplier: 'image supplier',
      targetModel: 'IMAGE-PRO',
    },
  });
  const catalog = imageRoute.buildCodexImageRouteSupplierCatalog([source, imageSupplier]);
  const target = catalog.find((supplier) => supplier.name === 'Image supplier');
  assert.ok(target);
  assert.deepEqual(imageRoute.getCodexImageRouteModelChoices(target), [
    { routeName: 'image-pro', alias: 'image-pro', actualName: 'gpt-image-2' },
  ]);
  assert.deepEqual(
    imageRoute.getSelectableCodexImageRouteSuppliers(catalog).map((supplier) => supplier.name),
    ['Image supplier']
  );

  const configured = imageRoute.inspectCodexImageRoute(source.raw.codexImageRoute, catalog);
  assert.equal(configured.status, 'configured');
  assert.equal(configured.supplier?.name, 'Image supplier');
  assert.equal(configured.model?.alias, 'image-pro');
  assert.equal(configured.model?.actualName, 'gpt-image-2');
  assert.equal(imageRoute.formatCodexImageRouteModel(configured.model), 'image-pro (gpt-image-2)');

  const staleSupplier = imageRoute.inspectCodexImageRoute(
    { enabled: true, targetSupplier: 'deleted', targetModel: 'image-pro' },
    catalog
  );
  assert.equal(staleSupplier.status, 'invalid');
  assert.equal(staleSupplier.issue, 'supplier_missing');

  const staleModel = imageRoute.inspectCodexImageRoute(
    { enabled: true, targetSupplier: 'Image supplier', targetModel: 'deleted-model' },
    catalog
  );
  assert.equal(staleModel.status, 'invalid');
  assert.equal(staleModel.issue, 'model_missing');

  const textModel = imageRoute.inspectCodexImageRoute(
    { enabled: true, targetSupplier: 'Image supplier', targetModel: 'chat-pro' },
    catalog
  );
  assert.equal(textModel.status, 'invalid');
  assert.equal(textModel.issue, 'model_not_image');

  const duplicateModel = imageRoute.inspectCodexImageRoute(
    { enabled: true, targetSupplier: 'Image supplier', targetModel: 'duplicate-image' },
    catalog
  );
  assert.equal(duplicateModel.status, 'invalid');
  assert.equal(duplicateModel.issue, 'model_ambiguous');

  const unavailableCatalog = imageRoute.buildCodexImageRouteSupplierCatalog([
    source,
    resource({
      id: 'images-disabled',
      name: 'Image supplier',
      disabled: true,
      models: [{ name: 'gpt-image-2', alias: 'image-pro', image: true }],
    }),
  ]);
  const unavailable = imageRoute.inspectCodexImageRoute(
    source.raw.codexImageRoute,
    unavailableCatalog
  );
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.issue, 'supplier_disabled');

  const selfCatalog = imageRoute.buildCodexImageRouteSupplierCatalog([source, imageSupplier], {
    id: source.id,
    replaceResourceId: source.id,
    name: 'Renamed gateway',
    disabled: false,
    credentialCount: 1,
    models: [{ name: 'self-image-actual', alias: 'self-image', image: true }],
  });
  assert.equal(
    selfCatalog.some((supplier) => supplier.name === 'Codex gateway'),
    false
  );
  assert.equal(
    imageRoute
      .getSelectableCodexImageRouteSuppliers(selfCatalog)
      .some((supplier) => supplier.name === 'Renamed gateway'),
    true
  );
  const selfRoute = imageRoute.inspectCodexImageRoute(
    { enabled: true, targetSupplier: 'Renamed gateway', targetModel: 'self-image' },
    selfCatalog
  );
  assert.equal(selfRoute.status, 'configured');
  assert.equal(selfRoute.model?.actualName, 'self-image-actual');

  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');
  const { BaseProviderForm } = await server.ssrLoadModule(
    '/src/features/providers/sheets/forms/BaseProviderForm.tsx'
  );
  const { ResourceDetailView } = await server.ssrLoadModule(
    '/src/features/providers/sheets/ResourceDetailView.tsx'
  );
  const { ProviderResourceTable } = await server.ssrLoadModule(
    '/src/features/providers/components/ProviderResourceTable.tsx'
  );
  const renderWithTooltips = (element) =>
    renderToStaticMarkup(createElement(TooltipProvider, { delayDuration: 0 }, element));

  const formMarkup = renderWithTooltips(
    createElement(BaseProviderForm, {
      brand: 'openaiCompatibility',
      resource: source,
      imageRouteResources: [source, imageSupplier],
      credentialGroupOptions: [],
      mode: 'edit',
      mutating: false,
      formId: 'codex-image-route-form',
      onSubmit: async () => {},
      onDirtyChange: () => {},
    })
  );
  for (const expected of [
    'Enable Codex image route',
    'Target supplier',
    'Target image model',
    'Routes to Image supplier / image-pro (gpt-image-2)',
  ]) {
    assert.equal(formMarkup.includes(expected), true, `form is missing ${expected}`);
  }

  const detailMarkup = renderWithTooltips(
    createElement(ResourceDetailView, {
      resource: source,
      imageRouteResources: [source, imageSupplier],
    })
  );
  for (const expected of ['Codex image route', 'Configured', 'Image supplier', 'image-pro']) {
    assert.equal(detailMarkup.includes(expected), true, `detail is missing ${expected}`);
  }

  const tableMarkup = renderWithTooltips(
    createElement(ProviderResourceTable, {
      resources: [source],
      imageRouteResources: [source, imageSupplier],
      onView: () => {},
      onViewFailures: () => {},
      onEdit: () => {},
      onDelete: () => {},
    })
  );
  assert.equal(tableMarkup.includes('Image supplier / image-pro (gpt-image-2)'), true);
  assert.equal(tableMarkup.includes('sk-images'), false, 'route identity leaked an API key');
} finally {
  await server.close();
}

console.log('codex image route tests passed');
