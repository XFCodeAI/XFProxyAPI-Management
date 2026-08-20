import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const api = await server.ssrLoadModule('/src/services/api/promptRewrite.ts');
  const model = await server.ssrLoadModule('/src/features/promptRewrite/model.ts');
  const config = api.normalizePromptRewriteConfig({
    enabled: true,
    'allow-replace': true,
    evaluation: 'layered',
    'builtin-overrides': [
      {
        asset: 'builtin:nerv/bridge',
        content: 'Local override',
        'license-status': 'local',
      },
    ],
    'remote-sources': [
      {
        asset: 'builtin:nerv/bridge',
        content: 'Remote snapshot',
        'source-url': 'https://example.test/prompt.md',
        'imported-at': '2026-08-18T00:00:00Z',
        'source-revision': '826a142fc040920a5c23c3dafabbfc8d21655478',
        'license-status': 'approved',
      },
    ],
    assets: [
      {
        id: 'base',
        content: 'Follow the contract.',
        enabled: true,
        'preserve-whitespace': true,
      },
    ],
    profiles: [{ id: 'builder', assets: ['base'] }],
    rules: [
      {
        name: 'codex-builder',
        priority: 10,
        target: { type: 'provider', value: 'codex' },
        mode: 'append',
        profile: 'builder',
        match: { 'request-paths': ['/backend-api/codex/responses'] },
      },
    ],
  });
  assert.equal(config.allowReplace, true);
  assert.equal(config.evaluation, 'layered');
  assert.equal(config.builtinOverrides[0].licenseStatus, 'local');
  assert.equal(config.remoteSources[0].sourceRevision, '826a142fc040920a5c23c3dafabbfc8d21655478');
  assert.equal(config.assets[0].preserveWhitespace, true);
  assert.deepEqual(config.rules[0].match.requestPaths, ['/backend-api/codex/responses']);

  const serialized = api.serializePromptRewriteConfig(config);
  assert.equal(serialized['allow-replace'], true);
  assert.equal(serialized['builtin-overrides'][0]['license-status'], 'local');
  assert.equal(serialized['remote-sources'][0]['source-url'], 'https://example.test/prompt.md');
  assert.equal(serialized.assets[0]['preserve-whitespace'], true);
  assert.deepEqual(serialized.rules[0].match['request-paths'], ['/backend-api/codex/responses']);
  assert.equal(serialized.rules[0].target.value, 'codex');

  assert.throws(
    () => api.normalizePromptRewriteConfig({ enabled: 'yes', assets: [], profiles: [], rules: [] }),
    (error) => error?.code === 'prompt_rewrite_invalid_response'
  );
  assert.throws(
    () => api.normalizePromptRewriteConfig({ enabled: true, evaluation: 'unknown' }),
    (error) => error?.code === 'prompt_rewrite_invalid_response'
  );

  const catalog = api.normalizePromptRewriteCatalog({
    builtin_assets: [
      {
        id: 'builtin:nerv/bridge',
        content: 'Pinned built-in content',
        version: 'commit-1',
        source: 'https://example.test/upstream',
        source_path: 'bridge.md',
        source_revision: 'commit-1',
        project: 'nerv',
        template_id: 'bridge',
        filename: 'bridge.md',
        source_layer: 'bundled',
        digest: 'sha256:abc',
        bundled_digest: 'sha256:abc',
        bundled_source: 'https://example.test/upstream',
        bundled_source_revision: 'commit-1',
        license: 'MIT',
        license_status: 'approved',
        license_text: 'MIT License text',
        attribution: 'Upstream authors',
        read_only: true,
      },
    ],
    builtin_packs: [
      {
        id: 'pack:nerv',
        project: 'nerv',
        name: 'NERV-BREAK-5.6',
        version: 'commit-1',
        source: 'https://example.test/upstream',
        license: 'MIT',
        license_spdx: 'MIT',
        license_sha256: 'license-sha256',
        attribution: 'Upstream authors',
        distribution: 'bundled',
        archive_filename: 'nerv.zip',
        read_only: true,
        execution_supported: false,
        resources: [
          {
            id: 'pack:nerv/resource/bridge.md',
            path: 'bridge.md',
            kind: 'prompt',
            applicability: 'request-prompt',
            bytes: 6166,
            newline_count: 172,
            line_endings: 'lf',
            sha256: 'resource-sha256',
            prompt_bindable: true,
            previewable: true,
            exportable: true,
            execution_supported: false,
          },
        ],
      },
    ],
    credentials: [
      {
        id: 'auth-1',
        displayName: 'Codex account',
        provider: 'codex',
        groups: ['primary'],
        carrierSupported: true,
        carrierFormat: 'codex',
      },
    ],
    providers: [{ id: 'codex', carrier_supported: true, carrier_format: 'codex' }],
    credentialGroups: ['primary'],
    revision: 'revision-1',
    activeGeneration: 2,
    inventoryId: 'inventory-1',
    inventoryRevision: 3,
  });
  assert.equal(catalog.credentials[0].carrierSupported, true);
  assert.deepEqual(catalog.credentialGroups, ['primary']);
  assert.equal(catalog.builtinAssets[0].sourceRevision, 'commit-1');
  assert.equal(catalog.builtinAssets[0].licenseText, 'MIT License text');
  assert.equal(catalog.builtinAssets[0].sourceLayer, 'bundled');
  assert.equal(catalog.builtinPacks[0].archiveFilename, 'nerv.zip');
  assert.equal(catalog.builtinPacks[0].resources.length, 1);
  assert.equal(catalog.builtinPacks[0].resources[0].promptBindable, true);
  assert.equal(catalog.builtinPacks[0].executionSupported, false);

  const legacyCatalog = api.normalizePromptRewriteCatalog({
    credentials: [],
    providers: [],
    credential_groups: [],
    revision: 'legacy-revision',
    active_generation: 1,
    inventory_id: 'legacy-inventory',
    inventory_revision: 1,
  });
  assert.deepEqual(legacyCatalog.builtinAssets, []);
  assert.deepEqual(legacyCatalog.builtinPacks, []);

  const builtinConfig = api.normalizePromptRewriteConfig({
    enabled: true,
    profiles: [{ id: 'builtins', assets: ['builtin:nerv/bridge'] }],
    rules: [{ name: 'built-in', mode: 'append', profile: 'builtins' }],
  });
  assert.deepEqual(model.validatePromptRewriteDraft(builtinConfig, catalog.builtinAssets), []);
  const builtinRebase = model.rebasePromptRewriteConfig(
    api.normalizePromptRewriteConfig({ enabled: false }),
    builtinConfig,
    api.normalizePromptRewriteConfig({
      enabled: false,
      assets: [{ id: 'server-managed', content: 'Concurrent server asset' }],
    })
  );
  assert.equal(builtinRebase.config.rules[0].profile, 'builtins');
  assert.equal(builtinRebase.config.assets[0].id, 'server-managed');
  assert.deepEqual(
    model.validatePromptRewriteDraft(builtinRebase.config, catalog.builtinAssets),
    []
  );
  assert.equal(
    model.createManagedAssetFromBuiltin(catalog.builtinAssets[0], ['nerv-bridge']).id,
    'nerv-bridge-2'
  );
  const shadowConfig = api.normalizePromptRewriteConfig({
    enabled: false,
    assets: [{ id: 'BUILTIN:shadow', content: 'managed' }],
  });
  assert.match(
    model.validatePromptRewriteDraft(shadowConfig, catalog.builtinAssets)[0].message,
    /reserved/i
  );

  const mutation = api.normalizePromptRewriteMutation({
    promptRewrite: serialized,
    revision: 'revision-2',
    inventoryId: 'inventory-1',
    inventoryRevision: 4,
  });
  assert.equal(mutation.promptRewrite.evaluation, 'layered');

  const preview = api.normalizePromptRewritePreview({
    changed: true,
    matchedRules: ['codex-builder'],
    suppressedRules: [],
    assetIds: ['base'],
    suppressedAssets: [],
    mode: 'append',
    evaluation: 'layered',
    addedBytes: 10,
    instructions: 'Follow the contract.',
    body: { instructions: 'Follow the contract.' },
  });
  assert.equal(preview.addedBytes, 10);

  const mergeBase = api.normalizePromptRewriteConfig({
    enabled: false,
    evaluation: 'first-match',
    assets: [{ id: 'base', content: 'Original', source: 'managed' }],
  });
  const mergeDraft = structuredClone(mergeBase);
  mergeDraft.assets[0].content = 'Local content';
  const mergeLatest = structuredClone(mergeBase);
  mergeLatest.assets[0].attribution = 'Remote attribution';
  const independentMerge = model.rebasePromptRewriteConfig(mergeBase, mergeDraft, mergeLatest);
  assert.equal(independentMerge.config.assets[0].content, 'Local content');
  assert.equal(independentMerge.config.assets[0].attribution, 'Remote attribution');
  assert.deepEqual(independentMerge.conflicts, []);

  mergeLatest.assets[0].content = 'Remote content';
  const overlappingMerge = model.rebasePromptRewriteConfig(mergeBase, mergeDraft, mergeLatest);
  assert.equal(overlappingMerge.config.assets[0].content, 'Local content');
  assert.deepEqual(overlappingMerge.conflicts, ['assets[base].content']);

  const emptyMergeBase = api.normalizePromptRewriteConfig({ enabled: false });
  const concurrentAdditions = model.rebasePromptRewriteConfig(
    emptyMergeBase,
    api.normalizePromptRewriteConfig({
      enabled: false,
      assets: [{ id: 'local', content: 'Local' }],
    }),
    api.normalizePromptRewriteConfig({
      enabled: false,
      assets: [{ id: 'remote', content: 'Remote' }],
    })
  );
  assert.deepEqual(concurrentAdditions.config.assets.map((asset) => asset.id).sort(), [
    'local',
    'remote',
  ]);
  assert.deepEqual(concurrentAdditions.conflicts, ['assets.order']);

  const invalidResponses = [
    () =>
      api.normalizePromptRewriteConfig({
        enabled: true,
        assets: [{ id: 'base', content: 'ok', enabled: 'yes' }],
      }),
    () =>
      api.normalizePromptRewriteConfig({
        enabled: true,
        rules: [{ name: 'rule', mode: 'append', prompt: 'ok', target: 42 }],
      }),
    () =>
      api.normalizePromptRewriteCatalog({
        credentials: [
          {
            id: 'auth-1',
            display_name: 'Auth',
            provider: 'codex',
            groups: [42],
            carrier_supported: true,
          },
        ],
        providers: [],
        credential_groups: [],
        revision: 'revision',
        active_generation: 1,
        inventory_id: 'inventory',
        inventory_revision: 1,
      }),
    () =>
      api.normalizePromptRewriteCatalog({
        builtin_packs: [
          {
            id: 'builtin-pack:unsafe',
            project: 'unsafe',
            name: 'Unsafe',
            version: 'revision',
            source: 'source',
            license: 'MIT',
            license_sha256: 'digest',
            attribution: 'authors',
            distribution: 'bundled',
            read_only: true,
            execution_supported: true,
            resources: [],
          },
        ],
        credentials: [],
        providers: [],
        credential_groups: [],
        revision: 'revision',
        active_generation: 1,
        inventory_id: 'inventory',
        inventory_revision: 1,
      }),
    () =>
      api.normalizePromptRewriteCatalog({
        builtin_assets: [
          {
            id: 'builtin:mutable',
            content: 'content',
            version: 'v1',
            source: 'source',
            source_path: 'prompt.md',
            source_revision: 'revision',
            digest: 'sha256:digest',
            license: 'MIT',
            license_text: 'notice',
            attribution: 'authors',
            read_only: false,
          },
        ],
        credentials: [],
        providers: [],
        credential_groups: [],
        revision: 'revision',
        active_generation: 1,
        inventory_id: 'inventory',
        inventory_revision: 1,
      }),
    () =>
      api.normalizePromptRewriteCatalog({
        credentials: [],
        providers: [{ id: 'codex', carrier_supported: 'yes' }],
        credential_groups: [],
        revision: 'revision',
        active_generation: 1,
        inventory_id: 'inventory',
        inventory_revision: 1,
      }),
    () =>
      api.normalizePromptRewriteMutation({
        'prompt-rewrite': { enabled: false, rules: [] },
        revision: '',
        inventory_revision: 1,
      }),
    () =>
      api.normalizePromptRewritePreview({
        changed: true,
        body: {},
        evaluation: 'invalid',
        added_bytes: 0,
      }),
    () =>
      api.normalizePromptRewritePreview({
        changed: true,
        body: {},
        evaluation: 'first-match',
        added_bytes: 'many',
      }),
  ];
  for (const normalize of invalidResponses) {
    assert.throws(normalize, (error) => error?.code === 'prompt_rewrite_invalid_response');
  }
} finally {
  await server.close();
}

console.log('prompt rewrite API contract tests passed');
