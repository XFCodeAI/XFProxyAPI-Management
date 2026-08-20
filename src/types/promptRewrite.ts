/** Prompt rewrite management contracts exposed by the management API. */

export type PromptRewriteMode = 'preserve' | 'prepend' | 'append' | 'replace';
export type PromptRewriteEvaluation = 'first-match' | 'layered';
export type PromptRewriteTargetType = 'global' | 'provider' | 'credential-group' | 'credential';
export type PromptRewriteSourceLayer = 'override' | 'remote' | 'cache' | 'bundled';
export type PromptRewriteLicenseStatus = 'local' | 'approved' | 'rejected';

export interface PromptRewriteTarget {
  type: PromptRewriteTargetType;
  value?: string;
}

export interface PromptRewriteAsset {
  id: string;
  enabled?: boolean;
  content: string;
  preserveWhitespace?: boolean;
  version?: string;
  source?: string;
  attribution?: string;
  digest?: string;
}

export interface PromptRewriteBuiltinSource {
  asset: string;
  content: string;
  sourceURL?: string;
  importedAt?: string;
  sourceRevision?: string;
  etag?: string;
  digest?: string;
  license?: string;
  licenseStatus?: PromptRewriteLicenseStatus;
  attribution?: string;
}

export interface PromptRewriteBuiltinAsset {
  id: string;
  project: string;
  templateID: string;
  filename: string;
  content: string;
  version: string;
  source: string;
  sourcePath: string;
  sourceRevision: string;
  sourceLayer: PromptRewriteSourceLayer;
  importedAt?: string;
  etag?: string;
  digest: string;
  bundledDigest: string;
  bundledSource: string;
  bundledSourceRevision: string;
  license: string;
  licenseStatus: PromptRewriteLicenseStatus;
  licenseText: string;
  attribution: string;
  readOnly: true;
}

export interface PromptRewriteProfile {
  id: string;
  enabled?: boolean;
  assets: string[];
}

export interface PromptRewriteInputMatch {
  exact: string[];
  contains: string[];
  suffixes: string[];
}

export interface PromptRewriteMatch {
  models: string[];
  requestedModels: string[];
  requestPaths: string[];
  input: PromptRewriteInputMatch;
}

export interface PromptRewriteRule {
  name: string;
  enabled?: boolean;
  priority: number;
  target?: PromptRewriteTarget;
  mode: PromptRewriteMode;
  prompt?: string;
  asset?: string;
  profile?: string;
  route?: string;
  match: PromptRewriteMatch;
}

export interface PromptRewriteConfig {
  enabled: boolean;
  allowReplace: boolean;
  evaluation: PromptRewriteEvaluation;
  builtinOverrides: PromptRewriteBuiltinSource[];
  remoteSources: PromptRewriteBuiltinSource[];
  builtinCache: PromptRewriteBuiltinSource[];
  assets: PromptRewriteAsset[];
  profiles: PromptRewriteProfile[];
  rules: PromptRewriteRule[];
}

export interface PromptRewriteMutationEnvelope {
  promptRewrite: PromptRewriteConfig;
  revision: string;
  inventoryId: string;
  inventoryRevision: number;
}

export interface PromptRewriteCredentialCatalogEntry {
  id: string;
  displayName: string;
  provider: string;
  groups: string[];
  status?: string;
  carrierSupported: boolean;
  carrierFormat?: string;
}

export interface PromptRewriteProviderCatalogEntry {
  id: string;
  carrierSupported: boolean;
  carrierFormat?: string;
}

export interface PromptRewriteBuiltinPackResource {
  id: string;
  path: string;
  kind: string;
  applicability: string;
  bytes: number;
  newlineCount: number;
  lineEndings: string;
  sha256: string;
  promptBindable: boolean;
  previewable: boolean;
  exportable: boolean;
  executionSupported: false;
}

export interface PromptRewriteBuiltinPack {
  id: string;
  project: string;
  name: string;
  version: string;
  source: string;
  license: string;
  licenseSPDX?: string;
  licenseSHA256: string;
  attribution: string;
  distribution: string;
  archiveFilename: string;
  readOnly: true;
  executionSupported: false;
  resources: PromptRewriteBuiltinPackResource[];
}

export interface PromptRewriteCatalog {
  builtinAssets: PromptRewriteBuiltinAsset[];
  builtinPacks: PromptRewriteBuiltinPack[];
  credentials: PromptRewriteCredentialCatalogEntry[];
  providers: PromptRewriteProviderCatalogEntry[];
  credentialGroups: string[];
  revision: string;
  activeGeneration: number;
  inventoryId: string;
  inventoryRevision: number;
}

export interface PromptRewritePreviewRequest {
  promptRewrite?: PromptRewriteConfig;
  body?: unknown;
  instructions?: string;
  input?: unknown;
  sourceFormat?: string;
  targetFormat?: string;
  requestPath?: string;
  model?: string;
  requestedModel?: string;
  codexClient?: boolean;
  authId?: string;
  provider?: string;
  groups?: string[];
}

export interface PromptRewritePreviewResult {
  changed: boolean;
  matchedRules: string[];
  suppressedRules: string[];
  assetIds: string[];
  suppressedAssets: string[];
  mode?: PromptRewriteMode;
  evaluation: PromptRewriteEvaluation;
  addedBytes: number;
  instructions?: unknown;
  body: unknown;
  error?: string;
}
