import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const api = await server.ssrLoadModule('/src/services/api/responseTamper.ts');
  const model = await server.ssrLoadModule('/src/features/promptRewrite/responseTamperModel.ts');

  const config = api.normalizeResponseTamperConfig({
    enabled: true,
    'allow-replacement': true,
    'max-buffer-bytes': 131072,
    assets: [{ id: 'managed', content: 'Managed response', enabled: true }],
    rules: [
      {
        id: 'refusal',
        priority: 10,
        target: { type: 'credential-group', value: 'primary' },
        models: ['gpt-*'],
        trigger: 'official-refusal',
        asset: 'managed',
      },
    ],
  });
  assert.equal(config.allowReplacement, true);
  assert.equal(config.maxBufferBytes, 131072);
  assert.equal(config.rules[0].target.value, 'primary');

  const serialized = api.serializeResponseTamperConfig(config);
  assert.equal(serialized['allow-replacement'], true);
  assert.equal(serialized['max-buffer-bytes'], 131072);
  assert.equal(serialized.rules[0].target.type, 'credential-group');

  const nervDirectConfig = api.normalizeResponseTamperConfig({
    enabled: true,
    'allow-replacement': true,
    programs: [{
      id: 'builtin:nerv/direct',
      mode: 'nerv-direct',
      patterns: ['flagged'],
      'replacement-template': 'NERV:{}',
    }],
    rules: [{ id: 'nerv-direct', trigger: 'nerv', program: 'builtin:nerv/direct' }],
  });
  assert.equal(nervDirectConfig.rules[0].asset, undefined);
  const serializedNervDirect = api.serializeResponseTamperConfig(nervDirectConfig);
  assert.equal(serializedNervDirect.rules[0].trigger, 'nerv');
  assert.equal(serializedNervDirect.rules[0].program, 'builtin:nerv/direct');
  assert.equal(serializedNervDirect.programs[0].mode, 'nerv-direct');
  assert.deepEqual(model.validateResponseTamperDraft(nervDirectConfig), []);
  const invalidNerv = structuredClone(nervDirectConfig);
  invalidNerv.rules[0].asset = 'managed';
  invalidNerv.rules[0].pattern = 'refusal';
  assert.deepEqual(
    model.validateResponseTamperDraft(invalidNerv).map((issue) => issue.message),
    [
      'NERV rules must not define a replacement asset.',
      'NERV rules must not define a regex pattern.',
    ]
  );

  const nervConfig = api.normalizeResponseTamperConfig({
    enabled: true,
    'allow-replacement': true,
    programs: [
      {
        id: 'xfpack-program:nerv',
        mode: 'nerv-relay',
        source: 'https://example.test/nerv',
        'source-path': 'direct_setup.py,proxy_relay.py',
        'source-revision': '4fac65fa452d96c98d96e2d9759f31cd1683441d',
        'source-sha256': 'a'.repeat(64),
        patterns: ['cannot help'],
        'replacement-template': 'override:{}',
        'min-text-runes': 21,
      },
    ],
    rules: [
      {
        id: 'xfpack-rule:nerv',
        trigger: 'nerv',
        program: 'xfpack-program:nerv',
      },
    ],
  });
  assert.equal(nervConfig.rules[0].program, 'xfpack-program:nerv');
  assert.equal(nervConfig.programs[0].minTextRunes, 21);
  assert.deepEqual(model.validateResponseTamperDraft(nervConfig), []);
  const serializedNerv = api.serializeResponseTamperConfig(nervConfig);
  assert.equal(serializedNerv.rules[0].trigger, 'nerv');
  assert.equal(serializedNerv.rules[0].program, 'xfpack-program:nerv');
  assert.equal(serializedNerv.programs[0]['source-path'], 'direct_setup.py,proxy_relay.py');
  assert.equal(serializedNerv.programs[0]['replacement-template'], 'override:{}');

  const mutation = api.normalizeResponseTamperMutation({
    responseTamper: serialized,
    revision: 'revision-2',
    inventoryId: 'inventory-1',
    inventoryRevision: 4,
  });
  assert.equal(mutation.responseTamper.rules[0].id, 'refusal');
  assert.equal(mutation.inventoryRevision, 4);

  const catalog = api.normalizeResponseTamperCatalog({
    builtin_programs: [
      {
        id: 'builtin:nerv/direct',
        name: 'NERV Direct',
        mode: 'nerv-direct',
        source: 'https://example.test/nerv',
        source_path: 'direct_setup.py',
        source_revision: '4fac65fa452d96c98d96e2d9759f31cd1683441d',
        source_sha256: 'a'.repeat(64),
        source_bytes: 7037,
        source_newline_count: 114,
        license: 'NERV runtime subset',
        license_sha256: 'b'.repeat(64),
        attribution: 'NERV runtime authors',
        pattern_count: 2,
        patterns: ['first', 'second'],
        replacement_template: 'NERV:{}',
        read_only: true,
        execution_supported: false,
      },
    ],
    credentials: [
      {
        id: 'auth-1',
        displayName: 'Codex account',
        provider: 'codex',
        groups: ['primary'],
      },
    ],
    providers: ['codex'],
    credentialGroups: ['primary'],
    revision: 'revision-2',
    activeGeneration: 2,
    inventoryId: 'inventory-1',
    inventoryRevision: 4,
    codexClientOnly: true,
    responseFormat: 'openai-response',
  });
  assert.equal(catalog.codexClientOnly, true);
  assert.deepEqual(catalog.credentialGroups, ['primary']);
  assert.equal(catalog.builtinPrograms[0].patternCount, 2);
  assert.equal(catalog.builtinPrograms[0].sourceBytes, 7037);

  const legacyCatalog = api.normalizeResponseTamperCatalog({
    credentials: [],
    providers: [],
    credential_groups: [],
    revision: 'legacy-revision',
    active_generation: 1,
    inventory_id: 'legacy-inventory',
    inventory_revision: 1,
    codex_client_only: true,
    response_format: 'openai-response',
  });
  assert.deepEqual(legacyCatalog.builtinPrograms, []);

  const preview = api.normalizeResponseTamperPreview({
    changed: true,
    outcome: 'replaced',
    matchedRule: 'refusal',
    assetId: 'managed',
    trigger: 'official-refusal',
    inputBytes: 100,
    outputBytes: 80,
    matchTextBytes: 16,
    program_id: 'builtin:nerv/direct',
    program_rule_index: 0,
    events: [{ type: 'response.done', response: { output: [] } }],
  });
  assert.equal(preview.matchedRule, 'refusal');
  assert.equal(preview.events.length, 1);
  assert.equal(preview.programId, 'builtin:nerv/direct');
  assert.equal(preview.programRuleIndex, 0);

  const mergeBase = api.normalizeResponseTamperConfig({
    enabled: false,
    assets: [{ id: 'managed', content: 'Original' }],
  });
  const mergeDraft = structuredClone(mergeBase);
  mergeDraft.assets[0].content = 'Local content';
  const mergeLatest = structuredClone(mergeBase);
  mergeLatest.assets[0].attribution = 'Remote attribution';
  const independentMerge = model.rebaseResponseTamperConfig(mergeBase, mergeDraft, mergeLatest);
  assert.equal(independentMerge.config.assets[0].content, 'Local content');
  assert.equal(independentMerge.config.assets[0].attribution, 'Remote attribution');
  assert.deepEqual(independentMerge.conflicts, []);

  mergeLatest.assets[0].content = 'Remote content';
  const overlappingMerge = model.rebaseResponseTamperConfig(mergeBase, mergeDraft, mergeLatest);
  assert.equal(overlappingMerge.config.assets[0].content, 'Local content');
  assert.deepEqual(overlappingMerge.conflicts, ['assets[managed].content']);

  const emptyMergeBase = api.normalizeResponseTamperConfig({ enabled: false });
  const concurrentAdditions = model.rebaseResponseTamperConfig(
    emptyMergeBase,
    api.normalizeResponseTamperConfig({
      enabled: false,
      assets: [{ id: 'local', content: 'Local' }],
    }),
    api.normalizeResponseTamperConfig({
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
    () => api.normalizeResponseTamperConfig({ enabled: 'yes', assets: [], rules: [] }),
    () =>
      api.normalizeResponseTamperConfig({
        enabled: false,
        rules: [{ id: 'bad', trigger: 'unknown', asset: 'missing' }],
      }),
    () =>
      api.normalizeResponseTamperMutation({
        'response-tamper': { enabled: false },
        revision: '',
      }),
    () =>
      api.normalizeResponseTamperCatalog({
        credentials: [{ id: 'auth', display_name: 'Auth', provider: 'codex', groups: [42] }],
        providers: ['codex'],
        credential_groups: [],
        revision: 'revision',
        active_generation: 1,
        inventory_id: 'inventory',
        inventory_revision: 1,
        codex_client_only: true,
        response_format: 'openai-response',
      }),
    () =>
      api.normalizeResponseTamperCatalog({
        builtin_programs: [
          {
            id: 'builtin:bad',
            name: 'Bad',
            source: 'https://example.test',
            source_path: 'bad.rs',
            source_revision: 'revision',
            source_sha256: 'digest',
            source_bytes: 1,
            source_newline_count: 1,
            license: 'MIT',
            license_sha256: 'license-digest',
            attribution: 'test',
            pattern_count: 2,
            patterns: ['only-one'],
            replacement_template: '{}',
            read_only: true,
            execution_supported: false,
          },
        ],
        credentials: [],
        providers: [],
        credential_groups: [],
        revision: 'revision',
        active_generation: 1,
        inventory_id: 'inventory',
        inventory_revision: 1,
        codex_client_only: true,
        response_format: 'openai-response',
      }),
    () =>
      api.normalizeResponseTamperPreview({
        changed: false,
        outcome: 'no-match',
        input_bytes: 10,
        output_bytes: 10,
        match_text_bytes: 0,
        events: { type: 'response.done' },
      }),
  ];
  for (const normalize of invalidResponses) {
    assert.throws(normalize, (error) => error?.code === 'response_tamper_invalid_response');
  }
} finally {
  await server.close();
}

console.log('response tamper API contract tests passed');
