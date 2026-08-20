import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const api = await server.ssrLoadModule('/src/services/api/capabilityPacks.ts');
  const pack = {
    schema_version: 1,
    id: 'pack:nerv',
    project: 'nerv',
    name: 'NERV-BREAK-5.6',
    version: '4fac65f',
    source: 'https://example.test/nerv',
    source_revision: '4fac65fa452d96c98d96e2d9759f31cd1683441d',
    archive_filename: 'nerv.zip',
    read_only: false,
    license: {
      name: 'No verified license file',
      resource_id: 'pack:nerv/resource/license-status',
      sha256: 'a'.repeat(64),
      attribution: 'Unverified',
      scope: 'Pinned archive',
      distribution: 'external-only',
      conditions: ['do not redistribute without verified permission'],
    },
    resources: [
      {
        id: 'pack:nerv/resource/bridge',
        path: 'bridge.md',
        kind: 'prompt',
        applicability: 'request-prompt',
        bytes: 20,
        newline_count: 1,
        line_endings: 'lf',
        sha256: 'b'.repeat(64),
        distribution: 'external-only',
        previewable: true,
        exportable: true,
        local_only: false,
      },
    ],
    capabilities: [
      {
        id: 'pack:nerv/capability/bridge',
        name: 'Bridge',
        kind: 'request-instruction',
        resource_ids: ['pack:nerv/resource/bridge'],
        runtime_ref: 'external:nerv/bridge',
        carriers: ['openai-codex-responses'],
        modes: ['append'],
        activatable: true,
      },
    ],
    activation_blueprints: [
      {
        id: 'pack:nerv/activation/bridge',
        name: 'Use bridge',
        capabilities: ['pack:nerv/capability/bridge'],
        recommended_mode: 'append',
      },
    ],
  };

  const catalog = api.normalizeCapabilityPackCatalog({
    revision: 'registry-1',
    import_supported: true,
    packs: [
      {
        pack,
        installed: true,
        bundled: false,
        permission_confirmed: true,
        non_commercial_confirmed: false,
        active_bindings: ['rule:nerv-bridge'],
        bindings: [
          {
            id: 'xfpack-binding:request',
            state: 'active',
            'pack-id': 'pack:nerv',
            'capability-ids': ['pack:nerv/capability/bridge'],
            'resource-ids': ['pack:nerv/resource/bridge'],
            operation: 'request-instruction',
            targets: [
              { type: 'credential-group', value: 'builders' },
              { type: 'credential-group', value: 'reviewers' },
            ],
            mode: 'append',
            priority: 12,
            'prompt-rule-ids': ['rule:nerv-bridge'],
          },
        ],
      },
    ],
  });
  assert.equal(catalog.packs[0].pack.sourceRevision, pack.source_revision);
  assert.equal(catalog.packs[0].permissionConfirmed, true);
  assert.deepEqual(catalog.packs[0].activeBindings, ['rule:nerv-bridge']);
  assert.deepEqual(
    catalog.packs[0].bindingInventory[0].targets.map((target) => target.value),
    ['builders', 'reviewers']
  );
  assert.deepEqual(catalog.packs[0].bindingInventory[0].resourceIDs, ['pack:nerv/resource/bridge']);
  assert.equal(catalog.packs[0].pack.resources[0].localOnly, false);

  const plan = api.normalizeCapabilityPackImportPlan({
    adapter_id: 'nerv',
    archive_sha256: 'c'.repeat(64),
    archive_bytes: 100,
    fingerprint: 'fingerprint-1',
    importable: true,
    already_installed: false,
    replace_required: false,
    license_acceptance_required: true,
    permission_confirmation_required: true,
    non_commercial_confirmation_required: false,
    capability_pack: pack,
    plan: {
      schema_version: 1,
      probe_confidence: 100,
      probe_evidence: ['revision-match'],
      pack,
      warnings: ['external-only'],
      required_consents: ['license', 'distribution-permission'],
      activation_ready: true,
    },
  });
  assert.equal(plan.adapterID, 'nerv');
  assert.equal(plan.pack.id, 'pack:nerv');
  assert.deepEqual(plan.requiredConsents, ['license', 'distribution-permission']);
  assert.equal(plan.permissionConfirmationRequired, true);
  assert.equal(plan.nonCommercialConfirmationRequired, false);

  const activation = api.normalizeCapabilityPackActivation({
    status: 'planned',
    pack_revision: 'registry-1',
    inventory_id: 'inventory-1',
    inventory_revision: 7,
    simulation_fingerprint: 'simulation-1',
    simulation: {
      kind: 'request',
      carrier: 'openai-response-json',
      changed: true,
      before: { instructions: 'base' },
      after: { instructions: 'base\nbridge' },
      matched_targets: ['xfpack-rule:nerv'],
      runtime_rule_ids: ['xfpack-rule:nerv'],
      resource_ids: ['pack:nerv/resource/bridge'],
      resource_digests: ['b'.repeat(64)],
      warnings: [],
      added_bytes: 7,
    },
    plan: {
      pack_id: 'pack:nerv',
      fingerprint: 'activation-1',
      prompt_changed: true,
      response_changed: true,
      response_consent_required: true,
      required_consents: ['response-modification'],
      managed_prompt_rule_id: 'rule-1',
      managed_response_rule_ids: ['response-rule-1'],
      prompt_revision_before: 'prompt-1',
      response_revision_before: 'response-1',
      prompt_rewrite: { enabled: true },
      response_tamper: { enabled: true },
      capability_ids: ['pack:nerv/capability/bridge'],
      targets: [{ type: 'credential-group', value: 'builders' }],
      replaced_binding_ids: ['legacy-binding'],
      replaced_prompt_rule_ids: ['legacy-prompt-rule'],
      replaced_response_rule_ids: ['legacy-response-rule'],
      rollback_prompt_rewrite: { enabled: false },
      rollback_response_tamper: { enabled: false },
      rollback_capability_bindings: [],
      simulation_fingerprint: 'simulation-1',
    },
  });
  assert.equal(activation.plan.responseConsentRequired, true);
  assert.equal(activation.inventoryRevision, 7);
  assert.deepEqual(activation.plan.managedResponseRuleIDs, ['response-rule-1']);
  assert.equal(activation.simulationFingerprint, 'simulation-1');
  assert.equal(activation.simulation?.changed, true);
  assert.deepEqual(activation.plan.targets, [{ type: 'credential-group', value: 'builders' }]);
  assert.deepEqual(activation.plan.replacedBindingIDs, ['legacy-binding']);
  assert.deepEqual(activation.plan.replacedPromptRuleIDs, ['legacy-prompt-rule']);
  assert.deepEqual(activation.plan.replacedResponseRuleIDs, ['legacy-response-rule']);
  assert.deepEqual(activation.plan.rollbackCapabilityBindings, []);
} finally {
  await server.close();
}
