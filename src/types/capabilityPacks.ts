export type CapabilityKind =
  'request-instruction' | 'response-transform' | 'profile' | 'local-resource' | string;

export interface CapabilityPackLicense {
  name: string;
  spdx?: string;
  resourceID: string;
  sha256: string;
  attribution: string;
  scope: string;
  distribution: string;
  conditions: string[];
}

export interface CapabilityPackResource {
  id: string;
  path: string;
  kind: string;
  applicability: string;
  bytes: number;
  newlineCount: number;
  lineEndings: string;
  sha256: string;
  generatedFrom: string[];
  distribution: string;
  previewable: boolean;
  exportable: boolean;
  localOnly: boolean;
}

export interface CapabilityPackCapability {
  id: string;
  name: string;
  kind: CapabilityKind;
  resourceIDs: string[];
  runtimeRef?: string;
  includes: string[];
  carriers: string[];
  modes: string[];
  activatable: boolean;
  consent?: string;
}

export interface CapabilityPackActivationBlueprint {
  id: string;
  name: string;
  capabilities: string[];
  recommendedMode: string;
}

export interface CapabilityPack {
  schemaVersion: number;
  id: string;
  project: string;
  name: string;
  version: string;
  source: string;
  sourceRevision: string;
  archiveFilename: string;
  readOnly: boolean;
  license: CapabilityPackLicense;
  resources: CapabilityPackResource[];
  capabilities: CapabilityPackCapability[];
  activationBlueprints: CapabilityPackActivationBlueprint[];
}

export interface CapabilityPackStatus {
  pack: CapabilityPack;
  installed: boolean;
  bundled: boolean;
  importedAt?: string;
  archiveSHA256?: string;
  archiveBytes?: number;
  licenseAccepted: boolean;
  permissionConfirmed: boolean;
  nonCommercialConfirmed: boolean;
  activeBindings: string[];
  bindingInventory: CapabilityBinding[];
}

export interface CapabilityBindingTarget {
  type: 'global' | 'provider' | 'credential-group' | 'credential' | string;
  value?: string;
}

export interface CapabilityBinding {
  id: string;
  enabled?: boolean;
  state: string;
  packID?: string;
  capabilityID?: string;
  capabilityIDs: string[];
  resourceIDs: string[];
  operation: string;
  targets: CapabilityBindingTarget[];
  mode?: string;
  priority: number;
  promptReplaceConsent: boolean;
  responseModificationConsent: boolean;
  source?: string;
  packRevision?: string;
  planFingerprint?: string;
  promptRuleIDs: string[];
  responseRuleIDs: string[];
}

export interface CapabilityPackCatalog {
  revision: string;
  importSupported: boolean;
  packs: CapabilityPackStatus[];
}

export interface CapabilityPackImportPlan {
  schemaVersion: number;
  adapterID: string;
  probeConfidence: number;
  probeEvidence: string[];
  sourceArchiveSHA256: string;
  sourceArchiveBytes: number;
  pack: CapabilityPack;
  warnings: string[];
  unsupportedCapabilities: string[];
  requiredConsents: string[];
  activationReady: boolean;
  fingerprint: string;
  importable: boolean;
  alreadyInstalled: boolean;
  replaceRequired: boolean;
  licenseAcceptanceRequired: boolean;
  permissionConfirmationRequired: boolean;
  nonCommercialConfirmationRequired: boolean;
  blockedReason?: string;
}

export interface CapabilityPackActivationPlan {
  fingerprint: string;
  packID: string;
  packRevision: string;
  promptChanged: boolean;
  responseChanged: boolean;
  responseConsentRequired: boolean;
  requiredConsents: string[];
  managedPromptRuleID?: string;
  managedResponseRuleIDs: string[];
  promptRevisionBefore: string;
  responseRevisionBefore: string;
  promptRewrite: Record<string, unknown>;
  responseTamper: Record<string, unknown>;
  capabilityIDs: string[];
  resourceIDs: string[];
  targets: CapabilityBindingTarget[];
  replacedBindingIDs: string[];
  replacedPromptRuleIDs: string[];
  replacedResponseRuleIDs: string[];
  simulation?: CapabilityPackSimulationResult;
  simulationFingerprint?: string;
  rollbackPromptRewrite: Record<string, unknown>;
  rollbackResponseTamper: Record<string, unknown>;
  rollbackCapabilityBindings: CapabilityBinding[];
}

export interface CapabilityPackSimulationResult {
  kind: string;
  carrier: string;
  changed: boolean;
  before?: unknown;
  after?: unknown;
  beforeEvents: unknown[];
  afterEvents: unknown[];
  matchedTargets: string[];
  runtimeRuleIDs: string[];
  resourceIDs: string[];
  resourceDigests: string[];
  consentRequirements: string[];
  warnings: string[];
  outcome?: string;
  addedBytes: number;
  inputBytes: number;
  outputBytes: number;
  matchTextBytes: number;
  programID?: string;
  programRuleIndex?: number;
}

export interface CapabilityPackActivationResponse {
  status: string;
  plan: CapabilityPackActivationPlan;
  packRevision?: string;
  promptRevision?: string;
  responseRevision?: string;
  inventoryID?: string;
  inventoryRevision?: number;
  simulationFingerprint?: string;
  simulation?: CapabilityPackSimulationResult;
}
