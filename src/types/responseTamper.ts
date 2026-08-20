export type ResponseTamperTrigger = 'official-refusal' | 'text-regex' | 'nerv';
export type ResponseTamperProgramMode = 'nerv-direct' | 'nerv-relay';
export type ResponseTamperTargetType = 'global' | 'provider' | 'credential-group' | 'credential';

export interface ResponseTamperTarget {
  type: ResponseTamperTargetType;
  value?: string;
}

export interface ResponseTamperAsset {
  id: string;
  enabled?: boolean;
  content: string;
  version?: string;
  source?: string;
  attribution?: string;
  digest?: string;
}

export interface ResponseTamperRule {
  id: string;
  enabled?: boolean;
  priority: number;
  target?: ResponseTamperTarget;
  models: string[];
  trigger: ResponseTamperTrigger;
  pattern?: string;
  asset?: string;
  program?: string;
}

export interface ResponseTamperProgram {
  id: string;
  mode: ResponseTamperProgramMode;
  source?: string;
  sourcePath?: string;
  sourceRevision?: string;
  sourceSha256?: string;
  patterns: string[];
  replacementTemplate: string;
  minTextRunes: number;
}

export interface ResponseTamperConfig {
  enabled: boolean;
  allowReplacement: boolean;
  maxBufferBytes: number;
  assets: ResponseTamperAsset[];
  rules: ResponseTamperRule[];
  programs: ResponseTamperProgram[];
}

export interface ResponseTamperMutationEnvelope {
  responseTamper: ResponseTamperConfig;
  revision: string;
  inventoryId: string;
  inventoryRevision: number;
}

export interface ResponseTamperCredentialCatalogEntry {
  id: string;
  displayName: string;
  provider: string;
  groups: string[];
  status?: string;
}

export interface ResponseTamperBuiltinProgram {
  id: string;
  name: string;
  mode: ResponseTamperProgramMode;
  source: string;
  sourcePath: string;
  sourceRevision: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceNewlineCount: number;
  license: string;
  licenseSha256: string;
  attribution: string;
  patternCount: number;
  patterns: string[];
  replacementTemplate: string;
  readOnly: boolean;
  executionSupported: boolean;
}

export interface ResponseTamperCatalog {
  builtinPrograms: ResponseTamperBuiltinProgram[];
  credentials: ResponseTamperCredentialCatalogEntry[];
  providers: string[];
  credentialGroups: string[];
  revision: string;
  activeGeneration: number;
  inventoryId: string;
  inventoryRevision: number;
  codexClientOnly: boolean;
  responseFormat: string;
}

export interface ResponseTamperPreviewRequest {
  responseTamper?: ResponseTamperConfig;
  body?: unknown;
  events?: unknown[];
  model?: string;
  authId?: string;
  provider?: string;
  groups?: string[];
}

export interface ResponseTamperPreviewResult {
  changed: boolean;
  outcome: string;
  matchedRule?: string;
  assetId?: string;
  trigger?: ResponseTamperTrigger;
  inputBytes: number;
  outputBytes: number;
  matchTextBytes: number;
  programId?: string;
  programRuleIndex?: number;
  body?: unknown;
  events?: unknown[];
}
