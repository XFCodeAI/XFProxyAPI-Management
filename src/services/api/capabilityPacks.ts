import { apiClient } from './client';
import type {
  CapabilityPack,
  CapabilityPackActivationBlueprint,
  CapabilityPackActivationResponse,
  CapabilityBinding,
  CapabilityBindingTarget,
  CapabilityPackCapability,
  CapabilityPackCatalog,
  CapabilityPackImportPlan,
  CapabilityPackLicense,
  CapabilityPackResource,
  CapabilityPackStatus,
  CapabilityPackSimulationResult,
} from '@/types';

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};

const stringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

const numberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const booleanValue = (value: unknown, fallback = false) =>
  typeof value === 'boolean' ? value : fallback;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const alias = (record: RecordValue, snake: string, camel: string) =>
  Object.prototype.hasOwnProperty.call(record, snake) ? record[snake] : record[camel];

const normalizeLicense = (value: unknown): CapabilityPackLicense => {
  const record = asRecord(value);
  return {
    name: stringValue(record.name),
    spdx: stringValue(record.spdx) || undefined,
    resourceID: stringValue(alias(record, 'resource_id', 'resourceID')),
    sha256: stringValue(record.sha256),
    attribution: stringValue(record.attribution),
    scope: stringValue(record.scope),
    distribution: stringValue(record.distribution),
    conditions: stringList(record.conditions),
  };
};

const normalizeResource = (value: unknown): CapabilityPackResource => {
  const record = asRecord(value);
  return {
    id: stringValue(record.id),
    path: stringValue(record.path),
    kind: stringValue(record.kind),
    applicability: stringValue(record.applicability),
    bytes: numberValue(record.bytes),
    newlineCount: numberValue(alias(record, 'newline_count', 'newlineCount')),
    lineEndings: stringValue(alias(record, 'line_endings', 'lineEndings')),
    sha256: stringValue(record.sha256),
    generatedFrom: stringList(alias(record, 'generated_from', 'generatedFrom')),
    distribution: stringValue(record.distribution),
    previewable: booleanValue(record.previewable),
    exportable: booleanValue(record.exportable),
    localOnly: booleanValue(alias(record, 'local_only', 'localOnly')),
  };
};

const normalizeCapability = (value: unknown): CapabilityPackCapability => {
  const record = asRecord(value);
  return {
    id: stringValue(record.id),
    name: stringValue(record.name),
    kind: stringValue(record.kind),
    resourceIDs: stringList(alias(record, 'resource_ids', 'resourceIDs')),
    runtimeRef: stringValue(alias(record, 'runtime_ref', 'runtimeRef')) || undefined,
    includes: stringList(record.includes),
    carriers: stringList(record.carriers),
    modes: stringList(record.modes),
    activatable: booleanValue(record.activatable),
    consent: stringValue(record.consent) || undefined,
  };
};

const normalizeBlueprint = (value: unknown): CapabilityPackActivationBlueprint => {
  const record = asRecord(value);
  return {
    id: stringValue(record.id),
    name: stringValue(record.name),
    capabilities: stringList(record.capabilities),
    recommendedMode: stringValue(alias(record, 'recommended_mode', 'recommendedMode'), 'append'),
  };
};

const normalizePack = (value: unknown): CapabilityPack => {
  const record = asRecord(value);
  return {
    schemaVersion: numberValue(alias(record, 'schema_version', 'schemaVersion')),
    id: stringValue(record.id),
    project: stringValue(record.project),
    name: stringValue(record.name),
    version: stringValue(record.version),
    source: stringValue(record.source),
    sourceRevision: stringValue(alias(record, 'source_revision', 'sourceRevision')),
    archiveFilename: stringValue(
      alias(record, 'archive_filename', 'archiveFilename'),
      'capability-pack.zip'
    ),
    readOnly: booleanValue(alias(record, 'read_only', 'readOnly')),
    license: normalizeLicense(record.license),
    resources: Array.isArray(record.resources) ? record.resources.map(normalizeResource) : [],
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.map(normalizeCapability)
      : [],
    activationBlueprints: Array.isArray(record.activation_blueprints)
      ? record.activation_blueprints.map(normalizeBlueprint)
      : Array.isArray(record.activationBlueprints)
        ? record.activationBlueprints.map(normalizeBlueprint)
        : [],
  };
};

const normalizeStatus = (value: unknown): CapabilityPackStatus => {
  const record = asRecord(value);
  return {
    pack: normalizePack(record.pack),
    installed: booleanValue(record.installed),
    bundled: booleanValue(record.bundled),
    importedAt: stringValue(alias(record, 'imported_at', 'importedAt')) || undefined,
    archiveSHA256: stringValue(alias(record, 'archive_sha256', 'archiveSHA256')) || undefined,
    archiveBytes: numberValue(alias(record, 'archive_bytes', 'archiveBytes')) || undefined,
    licenseAccepted: booleanValue(alias(record, 'license_accepted', 'licenseAccepted')),
    permissionConfirmed: booleanValue(alias(record, 'permission_confirmed', 'permissionConfirmed')),
    nonCommercialConfirmed: booleanValue(
      alias(record, 'non_commercial_confirmed', 'nonCommercialConfirmed')
    ),
    activeBindings: stringList(alias(record, 'active_bindings', 'activeBindings')),
    bindingInventory: Array.isArray(alias(record, 'bindings', 'bindingInventory'))
      ? (alias(record, 'bindings', 'bindingInventory') as unknown[]).map(normalizeBinding)
      : [],
  };
};

const normalizeTarget = (value: unknown): CapabilityBindingTarget => {
  const record = asRecord(value);
  return {
    type: stringValue(record.type, 'global'),
    value: stringValue(record.value) || undefined,
  };
};

const normalizeBinding = (value: unknown): CapabilityBinding => {
  const record = asRecord(value);
  return {
    id: stringValue(record.id),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
    state: stringValue(record.state, 'active'),
    packID: stringValue(alias(record, 'pack-id', 'packID')) || undefined,
    capabilityID: stringValue(alias(record, 'capability-id', 'capabilityID')) || undefined,
    capabilityIDs: stringList(alias(record, 'capability-ids', 'capabilityIDs')),
    resourceIDs: stringList(alias(record, 'resource-ids', 'resourceIDs')),
    operation: stringValue(record.operation),
    targets: Array.isArray(record.targets) ? record.targets.map(normalizeTarget) : [],
    mode: stringValue(record.mode) || undefined,
    priority: numberValue(record.priority),
    promptReplaceConsent: booleanValue(
      alias(record, 'prompt-replace-consent', 'promptReplaceConsent')
    ),
    responseModificationConsent: booleanValue(
      alias(record, 'response-modification-consent', 'responseModificationConsent')
    ),
    source: stringValue(record.source) || undefined,
    packRevision: stringValue(alias(record, 'pack-revision', 'packRevision')) || undefined,
    planFingerprint: stringValue(alias(record, 'plan-fingerprint', 'planFingerprint')) || undefined,
    promptRuleIDs: stringList(alias(record, 'prompt-rule-ids', 'promptRuleIDs')),
    responseRuleIDs: stringList(alias(record, 'response-rule-ids', 'responseRuleIDs')),
  };
};

const normalizeSimulation = (value: unknown): CapabilityPackSimulationResult | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = asRecord(value);
  return {
    kind: stringValue(record.kind),
    carrier: stringValue(record.carrier),
    changed: booleanValue(record.changed),
    before: record.before,
    after: record.after,
    beforeEvents: Array.isArray(alias(record, 'before_events', 'beforeEvents'))
      ? (alias(record, 'before_events', 'beforeEvents') as unknown[])
      : [],
    afterEvents: Array.isArray(alias(record, 'after_events', 'afterEvents'))
      ? (alias(record, 'after_events', 'afterEvents') as unknown[])
      : [],
    matchedTargets: stringList(alias(record, 'matched_targets', 'matchedTargets')),
    runtimeRuleIDs: stringList(alias(record, 'runtime_rule_ids', 'runtimeRuleIDs')),
    resourceIDs: stringList(alias(record, 'resource_ids', 'resourceIDs')),
    resourceDigests: stringList(alias(record, 'resource_digests', 'resourceDigests')),
    consentRequirements: stringList(alias(record, 'consent_requirements', 'consentRequirements')),
    warnings: stringList(record.warnings),
    outcome: stringValue(record.outcome) || undefined,
    addedBytes: numberValue(alias(record, 'added_bytes', 'addedBytes')),
    inputBytes: numberValue(alias(record, 'input_bytes', 'inputBytes')),
    outputBytes: numberValue(alias(record, 'output_bytes', 'outputBytes')),
    matchTextBytes: numberValue(alias(record, 'match_text_bytes', 'matchTextBytes')),
    programID: stringValue(alias(record, 'program_id', 'programID')) || undefined,
    programRuleIndex: numberValue(alias(record, 'program_rule_index', 'programRuleIndex')),
  };
};

export const normalizeCapabilityPackCatalog = (value: unknown): CapabilityPackCatalog => {
  const record = asRecord(value);
  return {
    revision: stringValue(record.revision),
    importSupported: booleanValue(alias(record, 'import_supported', 'importSupported')),
    packs: Array.isArray(record.packs) ? record.packs.map(normalizeStatus) : [],
  };
};

export const normalizeCapabilityPackImportPlan = (value: unknown): CapabilityPackImportPlan => {
  const record = asRecord(value);
  const plan = asRecord(record.plan);
  const pack = Object.keys(plan).length > 0 ? plan.pack : record.capability_pack;
  return {
    schemaVersion: numberValue(alias(plan, 'schema_version', 'schemaVersion')),
    adapterID: stringValue(alias(record, 'adapter_id', 'adapterID')),
    probeConfidence: numberValue(alias(plan, 'probe_confidence', 'probeConfidence')),
    probeEvidence: stringList(alias(plan, 'probe_evidence', 'probeEvidence')),
    sourceArchiveSHA256: stringValue(
      alias(record, 'archive_sha256', 'sourceArchiveSHA256') ??
        alias(plan, 'source_archive_sha256', 'sourceArchiveSHA256')
    ),
    sourceArchiveBytes: numberValue(
      alias(record, 'archive_bytes', 'sourceArchiveBytes') ??
        alias(plan, 'source_archive_bytes', 'sourceArchiveBytes')
    ),
    pack: normalizePack(pack),
    warnings: stringList(plan.warnings),
    unsupportedCapabilities: stringList(
      alias(plan, 'unsupported_capabilities', 'unsupportedCapabilities')
    ),
    requiredConsents: stringList(alias(plan, 'required_consents', 'requiredConsents')),
    activationReady: booleanValue(alias(plan, 'activation_ready', 'activationReady')),
    fingerprint: stringValue(record.fingerprint || plan.fingerprint),
    importable: booleanValue(record.importable, true),
    alreadyInstalled: booleanValue(alias(record, 'already_installed', 'alreadyInstalled')),
    replaceRequired: booleanValue(alias(record, 'replace_required', 'replaceRequired')),
    licenseAcceptanceRequired: booleanValue(
      alias(record, 'license_acceptance_required', 'licenseAcceptanceRequired'),
      true
    ),
    permissionConfirmationRequired: booleanValue(
      alias(record, 'permission_confirmation_required', 'permissionConfirmationRequired')
    ),
    nonCommercialConfirmationRequired: booleanValue(
      alias(record, 'non_commercial_confirmation_required', 'nonCommercialConfirmationRequired')
    ),
    blockedReason: stringValue(alias(record, 'blocked_reason', 'blockedReason')) || undefined,
  };
};

export const normalizeCapabilityPackActivation = (
  value: unknown
): CapabilityPackActivationResponse => {
  const record = asRecord(value);
  const rawPlan = asRecord(record.plan);
  return {
    status: stringValue(record.status),
    plan: {
      fingerprint: stringValue(rawPlan.fingerprint),
      packID: stringValue(alias(rawPlan, 'pack_id', 'packID')),
      packRevision: stringValue(record.pack_revision),
      promptChanged: booleanValue(alias(rawPlan, 'prompt_changed', 'promptChanged')),
      responseChanged: booleanValue(alias(rawPlan, 'response_changed', 'responseChanged')),
      responseConsentRequired: booleanValue(
        alias(rawPlan, 'response_consent_required', 'responseConsentRequired')
      ),
      requiredConsents: stringList(alias(rawPlan, 'required_consents', 'requiredConsents')),
      managedPromptRuleID:
        stringValue(alias(rawPlan, 'managed_prompt_rule_id', 'managedPromptRuleID')) || undefined,
      managedResponseRuleIDs: stringList(
        alias(rawPlan, 'managed_response_rule_ids', 'managedResponseRuleIDs')
      ),
      promptRevisionBefore: stringValue(
        alias(rawPlan, 'prompt_revision_before', 'promptRevisionBefore')
      ),
      responseRevisionBefore: stringValue(
        alias(rawPlan, 'response_revision_before', 'responseRevisionBefore')
      ),
      promptRewrite: asRecord(alias(rawPlan, 'prompt_rewrite', 'promptRewrite')),
      responseTamper: asRecord(alias(rawPlan, 'response_tamper', 'responseTamper')),
      capabilityIDs: stringList(alias(rawPlan, 'capability_ids', 'capabilityIDs')),
      resourceIDs: stringList(alias(rawPlan, 'resource_ids', 'resourceIDs')),
      targets: Array.isArray(rawPlan.targets) ? rawPlan.targets.map(normalizeTarget) : [],
      replacedBindingIDs: stringList(alias(rawPlan, 'replaced_binding_ids', 'replacedBindingIDs')),
      replacedPromptRuleIDs: stringList(
        alias(rawPlan, 'replaced_prompt_rule_ids', 'replacedPromptRuleIDs')
      ),
      replacedResponseRuleIDs: stringList(
        alias(rawPlan, 'replaced_response_rule_ids', 'replacedResponseRuleIDs')
      ),
      rollbackPromptRewrite: asRecord(
        alias(rawPlan, 'rollback_prompt_rewrite', 'rollbackPromptRewrite')
      ),
      rollbackResponseTamper: asRecord(
        alias(rawPlan, 'rollback_response_tamper', 'rollbackResponseTamper')
      ),
      rollbackCapabilityBindings: Array.isArray(
        alias(rawPlan, 'rollback_capability_bindings', 'rollbackCapabilityBindings')
      )
        ? (
            alias(
              rawPlan,
              'rollback_capability_bindings',
              'rollbackCapabilityBindings'
            ) as unknown[]
          ).map(normalizeBinding)
        : [],
      simulation: normalizeSimulation(rawPlan.simulation),
      simulationFingerprint:
        stringValue(alias(rawPlan, 'simulation_fingerprint', 'simulationFingerprint')) || undefined,
    },
    packRevision: stringValue(alias(record, 'pack_revision', 'packRevision')) || undefined,
    promptRevision: stringValue(alias(record, 'prompt_revision', 'promptRevision')) || undefined,
    responseRevision:
      stringValue(alias(record, 'response_revision', 'responseRevision')) || undefined,
    inventoryID: stringValue(alias(record, 'inventory_id', 'inventoryID')) || undefined,
    inventoryRevision:
      numberValue(alias(record, 'inventory_revision', 'inventoryRevision')) || undefined,
    simulationFingerprint:
      stringValue(alias(record, 'simulation_fingerprint', 'simulationFingerprint')) || undefined,
    simulation: normalizeSimulation(record.simulation) ?? normalizeSimulation(rawPlan.simulation),
  };
};

const packPath = (packID: string, suffix = '') =>
  `/capability-packs/${encodeURIComponent(packID)}${suffix}`;

const makeForm = (file: File, fields: Record<string, string> = {}) => {
  const form = new FormData();
  form.append('file', file, file.name);
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  return form;
};

export const capabilityPackApi = {
  async catalog(): Promise<CapabilityPackCatalog> {
    return normalizeCapabilityPackCatalog(await apiClient.get('/capability-packs'));
  },

  async detail(packID: string): Promise<CapabilityPackStatus> {
    return normalizeStatus(await apiClient.get(packPath(packID)));
  },

  async plan(file: File): Promise<CapabilityPackImportPlan> {
    return normalizeCapabilityPackImportPlan(
      await apiClient.postForm('/capability-packs/plan', makeForm(file))
    );
  },

  async importPack(
    file: File,
    options: {
      revision: string;
      acceptLicense: boolean;
      confirmPermission: boolean;
      confirmNonCommercial: boolean;
      replace?: boolean;
    }
  ): Promise<{
    revision: string;
    plan: CapabilityPackImportPlan;
    capabilityPack: CapabilityPackStatus;
  }> {
    const response = asRecord(
      await apiClient.postForm(
        '/capability-packs/import',
        makeForm(file, {
          revision: options.revision,
          accept_license: String(options.acceptLicense),
          confirm_permission: String(options.confirmPermission),
          confirm_non_commercial: String(options.confirmNonCommercial),
          replace: String(options.replace ?? false),
        })
      )
    );
    return {
      revision: stringValue(response.revision),
      plan: normalizeCapabilityPackImportPlan(response),
      capabilityPack: normalizeStatus(response.capability_pack),
    };
  },

  async resource(packID: string, resourcePath: string): Promise<string> {
    const encoded = resourcePath.split('/').map(encodeURIComponent).join('/');
    const response = await apiClient.getRaw(`${packPath(packID)}/resources/${encoded}`, {
      responseType: 'blob',
    });
    return (response.data as Blob).text();
  },

  async export(packID: string): Promise<Blob> {
    const response = await apiClient.getRaw(`${packPath(packID)}/export`, { responseType: 'blob' });
    return response.data as Blob;
  },

  async activationPreview(packID: string, request: Record<string, unknown>) {
    return normalizeCapabilityPackActivation(
      await apiClient.post(`${packPath(packID)}/activation/preview`, request)
    );
  },

  async activationSimulate(packID: string, request: Record<string, unknown>) {
    const simulated = normalizeCapabilityPackActivation(
      await apiClient.post(`${packPath(packID)}/activation/simulate`, request)
    );
    // Older management servers may expose the route but return the legacy
    // preview shape. Keep the workbench usable while preferring the explicit
    // simulation route whenever it returns a real plan.
    if (simulated.plan.fingerprint || simulated.simulation || simulated.plan.simulation) {
      return simulated;
    }
    return this.activationPreview(packID, request);
  },

  async activate(packID: string, request: Record<string, unknown>) {
    return normalizeCapabilityPackActivation(
      await apiClient.post(`${packPath(packID)}/activate`, request)
    );
  },

  async rollback(packID: string, request: Record<string, unknown>) {
    return apiClient.post(`${packPath(packID)}/activation/rollback`, request);
  },

  async deactivate(packID: string, request: Record<string, unknown>) {
    return normalizeCapabilityPackActivation(
      await apiClient.post(`${packPath(packID)}/deactivate`, request)
    );
  },

  async remove(packID: string, revision: string) {
    return apiClient.delete(packPath(packID), { headers: { 'If-Match': revision } });
  },
};
