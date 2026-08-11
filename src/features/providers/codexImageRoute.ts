import type { CodexImageRouteConfig, OpenAIProviderConfig, ProviderRuntimeStatus } from '@/types';
import type { ProviderResource } from './types';

export interface CodexImageRouteModelDefinition {
  name?: string;
  alias?: string;
  image?: boolean;
}

export interface CodexImageRouteModelChoice {
  routeName: string;
  alias: string;
  actualName: string;
}

export interface CodexImageRouteSupplier {
  id: string;
  name: string;
  disabled: boolean;
  credentialCount: number;
  runtimeStatus: ProviderRuntimeStatus | null;
  models: readonly CodexImageRouteModelDefinition[];
}

export interface CodexImageRouteSupplierDraft {
  id: string;
  replaceResourceId?: string | null;
  name: string;
  disabled: boolean;
  credentialCount: number;
  runtimeStatus?: ProviderRuntimeStatus | null;
  models: readonly CodexImageRouteModelDefinition[];
}

export type CodexImageRouteStatus = 'disabled' | 'configured' | 'invalid' | 'unavailable';

export type CodexImageRouteIssue =
  | 'target_supplier_required'
  | 'target_model_required'
  | 'supplier_missing'
  | 'supplier_ambiguous'
  | 'model_missing'
  | 'model_ambiguous'
  | 'model_not_image'
  | 'supplier_disabled'
  | 'supplier_no_credentials'
  | 'supplier_not_ready';

export interface CodexImageRouteInspection {
  status: CodexImageRouteStatus;
  issue: CodexImageRouteIssue | null;
  targetSupplier: string;
  targetModel: string;
  supplier: CodexImageRouteSupplier | null;
  model: CodexImageRouteModelChoice | null;
}

const normalizedIdentity = (value: string): string => value.trim().toLowerCase();

export const canonicalCodexImageRouteModel = (model: CodexImageRouteModelDefinition): string =>
  model.alias?.trim() || model.name?.trim() || '';

export const formatCodexImageRouteModel = (model: CodexImageRouteModelChoice): string =>
  model.alias && normalizedIdentity(model.alias) !== normalizedIdentity(model.actualName)
    ? `${model.alias} (${model.actualName})`
    : model.actualName;

export const getCodexImageRouteModelChoices = (
  supplier: CodexImageRouteSupplier | null | undefined
): CodexImageRouteModelChoice[] => {
  if (!supplier) return [];

  const modelsByRouteName = new Map<string, CodexImageRouteModelDefinition[]>();
  supplier.models.forEach((model) => {
    const routeName = canonicalCodexImageRouteModel(model);
    if (!routeName) return;
    const key = normalizedIdentity(routeName);
    const matches = modelsByRouteName.get(key) ?? [];
    matches.push(model);
    modelsByRouteName.set(key, matches);
  });

  return Array.from(modelsByRouteName.values())
    .filter((models) => models.length === 1 && models[0].image === true)
    .map(([model]) => ({
      routeName: canonicalCodexImageRouteModel(model),
      alias: model.alias?.trim() || '',
      actualName: model.name?.trim() || '',
    }))
    .filter((model) => model.routeName && model.actualName)
    .sort((left, right) => left.routeName.localeCompare(right.routeName));
};

export const buildCodexImageRouteSupplierCatalog = (
  resources: readonly ProviderResource[],
  draft?: CodexImageRouteSupplierDraft
): CodexImageRouteSupplier[] => {
  const suppliers: CodexImageRouteSupplier[] = resources
    .filter((resource) => resource.brand === 'openaiCompatibility' && !resource.flags.isPlaceholder)
    .filter((resource) => !draft?.replaceResourceId || resource.id !== draft.replaceResourceId)
    .map((resource) => {
      const config = resource.raw as OpenAIProviderConfig;
      return {
        id: resource.id,
        name: config.name?.trim() || resource.name?.trim() || '',
        disabled: config.disabled === true,
        credentialCount: (config.apiKeyEntries ?? []).filter((entry) => entry.apiKey.trim()).length,
        runtimeStatus: resource.runtimeStatus,
        models: config.models ?? [],
      } satisfies CodexImageRouteSupplier;
    })
    .filter((supplier) => supplier.name);

  if (draft?.name.trim()) {
    suppliers.push({
      id: draft.id,
      name: draft.name.trim(),
      disabled: draft.disabled,
      credentialCount: draft.credentialCount,
      runtimeStatus: draft.runtimeStatus ?? null,
      models: draft.models,
    });
  }

  return suppliers.sort((left, right) => left.name.localeCompare(right.name));
};

export const getSelectableCodexImageRouteSuppliers = (
  suppliers: readonly CodexImageRouteSupplier[]
): CodexImageRouteSupplier[] => {
  const counts = new Map<string, number>();
  suppliers.forEach((supplier) => {
    const key = normalizedIdentity(supplier.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return suppliers.filter(
    (supplier) =>
      counts.get(normalizedIdentity(supplier.name)) === 1 &&
      getCodexImageRouteModelChoices(supplier).length > 0
  );
};

export const inspectCodexImageRoute = (
  route: CodexImageRouteConfig | null | undefined,
  suppliers: readonly CodexImageRouteSupplier[]
): CodexImageRouteInspection => {
  const targetSupplier = route?.targetSupplier.trim() ?? '';
  const targetModel = route?.targetModel.trim() ?? '';
  const base = {
    targetSupplier,
    targetModel,
    supplier: null,
    model: null,
  };

  if (!route?.enabled) {
    return { ...base, status: 'disabled', issue: null };
  }
  if (!targetSupplier) {
    return { ...base, status: 'invalid', issue: 'target_supplier_required' };
  }
  if (!targetModel) {
    return { ...base, status: 'invalid', issue: 'target_model_required' };
  }

  const supplierMatches = suppliers.filter(
    (supplier) => normalizedIdentity(supplier.name) === normalizedIdentity(targetSupplier)
  );
  if (supplierMatches.length === 0) {
    return { ...base, status: 'invalid', issue: 'supplier_missing' };
  }
  if (supplierMatches.length > 1) {
    return { ...base, status: 'invalid', issue: 'supplier_ambiguous' };
  }

  const supplier = supplierMatches[0];
  const modelMatches = supplier.models.filter(
    (model) =>
      normalizedIdentity(canonicalCodexImageRouteModel(model)) === normalizedIdentity(targetModel)
  );
  const withSupplier = { ...base, supplier };
  if (modelMatches.length === 0) {
    return { ...withSupplier, status: 'invalid', issue: 'model_missing' };
  }
  if (modelMatches.length > 1) {
    return { ...withSupplier, status: 'invalid', issue: 'model_ambiguous' };
  }
  if (modelMatches[0].image !== true) {
    return { ...withSupplier, status: 'invalid', issue: 'model_not_image' };
  }

  const matchedModel = modelMatches[0];
  const model = {
    routeName: canonicalCodexImageRouteModel(matchedModel),
    alias: matchedModel.alias?.trim() || '',
    actualName: matchedModel.name?.trim() || '',
  };
  const configured = { ...withSupplier, model };
  if (supplier.disabled) {
    return { ...configured, status: 'unavailable', issue: 'supplier_disabled' };
  }
  if (supplier.credentialCount === 0) {
    return { ...configured, status: 'unavailable', issue: 'supplier_no_credentials' };
  }
  if (supplier.runtimeStatus && !supplier.runtimeStatus.ready) {
    return { ...configured, status: 'unavailable', issue: 'supplier_not_ready' };
  }
  return { ...configured, status: 'configured', issue: null };
};
