import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const plugins = await server.ssrLoadModule('/src/services/api/plugins.ts');
  const releases = await server.ssrLoadModule('/src/features/plugins/pluginReleaseVersions.ts');
  const resources = await server.ssrLoadModule('/src/features/plugins/pluginResources.ts');
  const drafts = await server.ssrLoadModule('/src/features/plugins/pluginConfigDraft.ts');
  const polling = await server.ssrLoadModule('/src/features/plugins/pluginPolling.ts');

  const response = plugins.normalizeStoreList({
    plugins_enabled: true,
    plugins_dir: 'extensions',
    sources: [{ id: 'official', name: 'Official', url: 'https://store.example/registry.json' }],
    source_errors: [
      {
        source_id: 'private',
        source_name: 'Private',
        source_url: 'https://private.example/registry.json',
        message: '401 Unauthorized',
      },
    ],
    plugins: [
      {
        store_id: 'official/example',
        source_id: 'official',
        id: 'example',
        install_type: 'github-release',
        auth_required: true,
        auth_configured: false,
        platforms: [{ goos: 'linux', goarch: 'amd64' }, null],
        installed_source_id: 'official',
        install_source_status: 'matched',
      },
    ],
  });
  assert.deepEqual(response.sources, [
    { id: 'official', name: 'Official', url: 'https://store.example/registry.json' },
  ]);
  assert.deepEqual(response.sourceErrors, [
    {
      sourceId: 'private',
      sourceName: 'Private',
      sourceUrl: 'https://private.example/registry.json',
      message: '401 Unauthorized',
    },
  ]);
  assert.deepEqual(response.plugins[0].platforms, [{ goos: 'linux', goarch: 'amd64' }]);
  assert.equal(response.plugins[0].installType, 'github-release');
  assert.equal(response.plugins[0].authRequired, true);
  assert.equal(response.plugins[0].authConfigured, false);
  assert.equal(response.plugins[0].installedSourceId, 'official');
  assert.equal(response.plugins[0].installSourceStatus, 'matched');

  assert.deepEqual(
    plugins.buildPluginStoreInstallRequest('example/plugin', {
      sourceId: ' private ',
      version: ' v1.2.3 ',
    }),
    {
      url: '/plugin-store/example%2Fplugin/install?source=private&version=v1.2.3',
      body: { version: 'v1.2.3' },
    }
  );
  assert.equal(
    plugins.normalizeInstallResult({ install_type: 'direct', version: '2.0.0' }).installType,
    'direct'
  );

  assert.equal(releases.supportsPluginVersionSelection(' GitHub-Release '), true);
  assert.equal(releases.supportsPluginVersionSelection('direct'), false);
  assert.equal(releases.getGitHubRepositorySlug('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(releases.getGitHubRepositorySlug('https://github.com.evil.test/owner/repo'), '');
  assert.equal(releases.isValidManualReleaseTag('v1.2.3-rc.1'), true);
  assert.equal(releases.isValidManualReleaseTag('release/1.2.3'), false);
  assert.deepEqual(
    releases.normalizePluginReleaseVersions([
      {
        tag_name: 'v1.2.3',
        name: 'Stable',
        published_at: '2026-07-01T00:00:00Z',
        prerelease: false,
        html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
        assets: [{ name: 'plugin_linux_amd64.so' }, { invalid: true }],
      },
      { name: 'missing tag' },
    ]),
    [
      {
        tagName: 'v1.2.3',
        name: 'Stable',
        publishedAt: '2026-07-01T00:00:00Z',
        prerelease: false,
        htmlUrl: 'https://github.com/owner/repo/releases/tag/v1.2.3',
        assetNames: ['plugin_linux_amd64.so'],
      },
    ]
  );

  const pluginEntry = (sourceId, repository) => ({ sourceId, repository });
  assert.equal(resources.isOfficialPlugin(pluginEntry('official', 'router-for-me/example')), true);
  assert.equal(
    resources.isOfficialPlugin(pluginEntry('lookalike-official', 'router-for-me/example')),
    false
  );
  assert.equal(
    resources.isOfficialPlugin(
      pluginEntry('official', 'https://github.com.evil.test/router-for-me/example')
    ),
    false
  );
  assert.equal(
    resources.isOfficialPlugin(pluginEntry('official', 'https://github.com/router-for-me/../evil')),
    false
  );
  assert.equal(
    resources.isPluginManagementNavVisible({ supportsPlugin: true, pluginsEnabled: true }),
    true
  );
  assert.equal(
    resources.isPluginManagementNavVisible({ supportsPlugin: true, pluginsEnabled: false }),
    false
  );
  assert.equal(resources.isPluginManagementNavVisible({ supportsPlugin: true }), true);
  assert.equal(
    resources.isPluginManagementNavVisible({ supportsPlugin: false, pluginsEnabled: true }),
    false
  );

  const fields = [
    { name: 'mixed', type: 'array', enumValues: [], description: '' },
    { name: 'settings', type: 'object', enumValues: [], description: '' },
    { name: 'label', type: 'string', enumValues: [], description: '' },
  ];
  const draft = drafts.buildPluginConfigDraft(
    { enabled: true, configFields: fields },
    {
      priority: 3,
      mixed: [1, false, { keep: true }],
      settings: { nested: ['old'] },
      futureField: { preservedByPatch: true },
    }
  );
  assert.equal(draft.values.mixed, '[\n  1,\n  false,\n  {\n    "keep": true\n  }\n]');
  draft.values.mixed = '[2, true, {"next": 1}]';
  draft.touchedFields.mixed = true;
  draft.values.settings = '{"nested":[1,false],"keep":{"value":2}}';
  draft.touchedFields.settings = true;
  draft.values.label = '';
  draft.touchedFields.label = true;
  const patch = drafts.buildPluginConfigPatch(draft, fields, (key) => key);
  assert.deepEqual(patch, {
    patch: {
      mixed: [2, true, { next: 1 }],
      settings: { nested: [1, false], keep: { value: 2 } },
      label: null,
    },
    errors: {},
  });
  assert.equal(Object.hasOwn(patch.patch, 'priority'), false);
  assert.equal(Object.hasOwn(patch.patch, 'futureField'), false);

  const readyPlugin = {
    installed: true,
    configured: true,
    installedVersion: '1.2.3',
    installedSourceId: 'official',
    installSourceStatus: 'matched',
  };
  assert.equal(polling.isRequestedPluginStoreInstallReady(readyPlugin, 'official', 'v1.2.3'), true);
  assert.equal(
    polling.isRequestedPluginStoreInstallReady(readyPlugin, 'official', 'v1.2.2'),
    false
  );
  assert.equal(polling.isRequestedPluginStoreInstallReady(readyPlugin, 'other', 'v1.2.3'), false);
} finally {
  await server.close();
}

console.log('Plugin store contract tests passed');
