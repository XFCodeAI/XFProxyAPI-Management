import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CredentialGroupsField } from '@/components/credentialGroups/CredentialGroupsField';
import { CredentialWeightInput } from '@/components/providers/CredentialWeightInput';
import {
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPlus,
  IconX,
} from '@/components/ui/icons';
import { Collapsible } from '@/components/ui/Collapsible';
import { ConcurrencySettingField } from '@/components/concurrency/ConcurrencySettingField';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { inputClass, textareaClass } from '@/components/ui/formStyles';
import { hasDisableAllModelsRule } from '@/components/providers/utils';
import { cn } from '@/lib/utils';
import type {
  GeminiKeyConfig,
  InteractionsKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import { isValidMaxConcurrency, normalizeConcurrencySetting } from '@/utils/maxConcurrency';
import { getCredentialWeightError } from '@/utils/credentialWeight';
import type { ModelInfo } from '@/utils/models';
import { PROVIDER_DESCRIPTORS } from '../../descriptors';
import {
  buildCodexImageRouteSupplierCatalog,
  formatCodexImageRouteModel,
  getCodexImageRouteModelChoices,
  getSelectableCodexImageRouteSuppliers,
  inspectCodexImageRoute,
} from '../../codexImageRoute';
import type {
  ApiKeyEntryInput,
  ModelEntryInput,
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
} from '../../types';
import { useConnectivityTest, type ConnectivityErrorMessages } from './useConnectivityTest';
import { useModelDiscovery } from './useModelDiscovery';
import { ModelDiscoveryPanel } from './ModelDiscoveryPanel';
import { ApiKeyEntriesEditor } from './ApiKeyEntriesEditor';
import { ConnectivityStatusIcon } from './ConnectivityStatusIcon';
import { ModelEntriesEditor } from './ModelEntriesEditor';
import styles from './sharedForm.module.scss';

export interface BaseProviderFormHandle {
  submit: () => Promise<void>;
}

interface BaseProviderFormProps {
  brand: ProviderBrand;
  resource: ProviderResource | null;
  imageRouteResources?: readonly ProviderResource[];
  credentialGroupOptions: string[];
  mode: 'create' | 'edit';
  mutating: boolean;
  formId: string;
  onSubmit: (input: ProviderEntryFormInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

const XAI_API_BASE_URL = 'https://api.x.ai/v1';

const emptyHeader = () => ({ key: '', value: '' });
const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });
const emptyApiKeyEntry = (): ApiKeyEntryInput => ({
  name: '',
  apiKey: '',
  weight: undefined,
  groups: [],
  proxyUrl: '',
  concurrencyMode: 'inherit',
  maxConcurrency: 0,
});

type PrimaryField =
  | 'name'
  | 'apiKey'
  | 'baseUrl'
  | 'authMode'
  | 'protocolMode'
  | 'retryOwner'
  | 'requestRetry'
  | 'proxyUrl'
  | 'routing'
  | 'maxConcurrency'
  | 'testModel';
type ToggleField = 'websockets' | 'fallback' | 'disabled' | 'disableCooling';
type AdvancedSection = 'apiKeyEntries' | 'headers' | 'models' | 'excludedModels' | 'cloak';
type ModelEntryMode = 'standard' | 'openai';

interface ProviderFormLayout {
  primaryFields: PrimaryField[];
  toggleFields: ToggleField[];
  advancedSections: AdvancedSection[];
  modelEntryMode: ModelEntryMode;
}

const PROVIDER_FORM_LAYOUTS: Record<ProviderBrand, ProviderFormLayout> = {
  gemini: {
    primaryFields: [
      'name',
      'apiKey',
      'baseUrl',
      'proxyUrl',
      'routing',
      'maxConcurrency',
      'testModel',
    ],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  interactions: {
    primaryFields: [
      'name',
      'apiKey',
      'baseUrl',
      'proxyUrl',
      'routing',
      'maxConcurrency',
      'requestRetry',
    ],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  codex: {
    primaryFields: [
      'name',
      'apiKey',
      'baseUrl',
      'proxyUrl',
      'routing',
      'maxConcurrency',
      'testModel',
    ],
    toggleFields: ['websockets', 'fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  xai: {
    primaryFields: [
      'name',
      'apiKey',
      'baseUrl',
      'proxyUrl',
      'routing',
      'maxConcurrency',
      'testModel',
    ],
    toggleFields: ['websockets', 'fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  claude: {
    primaryFields: [
      'name',
      'apiKey',
      'baseUrl',
      'authMode',
      'proxyUrl',
      'routing',
      'maxConcurrency',
      'testModel',
    ],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels', 'cloak'],
    modelEntryMode: 'standard',
  },
  vertex: {
    primaryFields: [
      'name',
      'apiKey',
      'baseUrl',
      'proxyUrl',
      'routing',
      'maxConcurrency',
      'testModel',
    ],
    toggleFields: ['fallback', 'disabled'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  openaiCompatibility: {
    primaryFields: [
      'name',
      'baseUrl',
      'protocolMode',
      'retryOwner',
      'routing',
      'maxConcurrency',
      'testModel',
    ],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['apiKeyEntries', 'headers', 'models'],
    modelEntryMode: 'openai',
  },
  kimi: {
    primaryFields: [],
    toggleFields: [],
    advancedSections: [],
    modelEntryMode: 'standard',
  },
};

const stripDisableAllRule = (list?: string[]): string[] =>
  (list ?? []).filter((s) => s.trim() !== '*');

const formatJsonObject = (value?: Record<string, unknown>): string => {
  if (!value || Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
};

const isClaudeLikeBrand = (brand: ProviderBrand): boolean => brand === 'claude';

function buildInitialForm(
  brand: ProviderBrand,
  resource: ProviderResource | null,
  mode: 'create' | 'edit'
): ProviderEntryFormInput {
  if (mode === 'create' || !resource) {
    return {
      apiKey: '',
      name: '',
      groups: [],
      baseUrl: brand === 'xai' ? XAI_API_BASE_URL : '',
      authMode: brand === 'claude' ? 'x-api-key' : undefined,
      protocolMode: brand === 'openaiCompatibility' ? 'chat-completions' : undefined,
      retryOwner: brand === 'openaiCompatibility' ? 'xfpa' : undefined,
      requestRetry: undefined,
      proxyUrl: '',
      prefix: '',
      disabled: false,
      disableCooling: false,
      fallback: false,
      priority: undefined,
      weight: undefined,
      concurrencyMode: 'inherit',
      maxConcurrency: 0,
      models: [emptyModel()],
      headers: [emptyHeader()],
      excludedModelsText: '',
      websockets: brand === 'codex' || brand === 'xai' ? false : undefined,
      cloak: isClaudeLikeBrand(brand)
        ? { mode: '', strictMode: false, sensitiveWordsText: '', cacheUserId: false }
        : undefined,
      experimentalCchSigning: isClaudeLikeBrand(brand) ? false : undefined,
      testModel:
        brand === 'openaiCompatibility' ||
        brand === 'codex' ||
        brand === 'xai' ||
        isClaudeLikeBrand(brand) ||
        brand === 'gemini' ||
        brand === 'vertex'
          ? ''
          : undefined,
      codexImageRoute:
        brand === 'openaiCompatibility'
          ? { enabled: false, targetSupplier: '', targetModel: '' }
          : undefined,
      apiKeyEntries: brand === 'openaiCompatibility' ? [emptyApiKeyEntry()] : undefined,
    };
  }

  const raw = resource.raw;
  if (brand === 'openaiCompatibility') {
    const cfg = raw as OpenAIProviderConfig;
    const concurrency = normalizeConcurrencySetting(cfg.concurrencyMode, cfg.maxConcurrency);
    return {
      apiKey: '',
      name: cfg.name ?? '',
      baseUrl: cfg.baseUrl ?? '',
      protocolMode: cfg.protocolMode ?? 'chat-completions',
      retryOwner: cfg.retryOwner ?? 'xfpa',
      proxyUrl: '',
      prefix: cfg.prefix ?? '',
      disabled: cfg.disabled === true,
      disableCooling: cfg.disableCooling === true,
      fallback: cfg.fallback === true,
      priority: cfg.priority,
      concurrencyMode: concurrency.mode,
      maxConcurrency: concurrency.maxConcurrency,
      models: cfg.models?.length
        ? cfg.models.map((m) => ({
            name: m.name,
            alias: m.alias ?? '',
            priority: m.priority,
            testModel: m.testModel,
            image: m.image === true,
            thinkingJson: formatJsonObject(m.thinking),
          }))
        : [emptyModel()],
      headers: cfg.headers
        ? Object.entries(cfg.headers).map(([k, v]) => ({ key: k, value: String(v) }))
        : [emptyHeader()],
      excludedModelsText: '',
      testModel: cfg.testModel ?? '',
      codexImageRoute: cfg.codexImageRoute
        ? {
            enabled: cfg.codexImageRoute.enabled,
            targetSupplier: cfg.codexImageRoute.targetSupplier,
            targetModel: cfg.codexImageRoute.targetModel,
          }
        : { enabled: false, targetSupplier: '', targetModel: '' },
      apiKeyEntries: cfg.apiKeyEntries?.length
        ? cfg.apiKeyEntries.map((entry) => {
            const entryConcurrency = normalizeConcurrencySetting(
              entry.concurrencyMode,
              entry.maxConcurrency
            );
            return {
              name: entry.name ?? '',
              apiKey: '',
              existingApiKey: entry.apiKey,
              weight: entry.weight,
              groups: entry.groups ?? [],
              proxyUrl: entry.proxyUrl ?? '',
              authIndex: entry.authIndex,
              concurrencyMode: entryConcurrency.mode,
              maxConcurrency: entryConcurrency.maxConcurrency,
            };
          })
        : [emptyApiKeyEntry()],
    };
  }

  const cfg = raw as GeminiKeyConfig & InteractionsKeyConfig & ProviderKeyConfig;
  const concurrency = normalizeConcurrencySetting(cfg.concurrencyMode, cfg.maxConcurrency);
  const disabled = hasDisableAllModelsRule(cfg.excludedModels);
  const excludedList = stripDisableAllRule(cfg.excludedModels);
  return {
    // Keep the API key blank in edit mode. Pre-filling the real key makes this
    // password field a browser-autofill target (the saved management key can
    // overwrite it) and defeats the "leave empty = keep unchanged" contract; an
    // empty field is preserved on save via buildProviderKeyConfig's existing fallback.
    apiKey: '',
    name: cfg.name ?? '',
    groups: cfg.groups ?? [],
    baseUrl: cfg.baseUrl ?? '',
    authMode: brand === 'claude' ? (cfg.authMode ?? '') : undefined,
    proxyUrl: cfg.proxyUrl ?? '',
    prefix: cfg.prefix ?? '',
    disabled,
    disableCooling: cfg.disableCooling === true,
    fallback: cfg.fallback === true,
    priority: cfg.priority,
    requestRetry: brand === 'interactions' ? cfg.requestRetry : undefined,
    weight: cfg.weight,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    models: cfg.models?.length
      ? cfg.models.map((m) => ({
          name: m.name,
          alias: m.alias ?? '',
          priority: m.priority,
          testModel: m.testModel,
        }))
      : [emptyModel()],
    headers: cfg.headers
      ? Object.entries(cfg.headers).map(([k, v]) => ({ key: k, value: String(v) }))
      : [emptyHeader()],
    excludedModelsText: excludedList.join('\n'),
    websockets:
      brand === 'codex' || brand === 'xai'
        ? (cfg as ProviderKeyConfig).websockets === true
        : undefined,
    cloak: isClaudeLikeBrand(brand)
      ? {
          mode: (cfg as ProviderKeyConfig).cloak?.mode ?? '',
          strictMode: (cfg as ProviderKeyConfig).cloak?.strictMode === true,
          sensitiveWordsText: (cfg as ProviderKeyConfig).cloak?.sensitiveWords?.join('\n') ?? '',
          cacheUserId: (cfg as ProviderKeyConfig).cloak?.cacheUserId === true,
        }
      : undefined,
    experimentalCchSigning: isClaudeLikeBrand(brand)
      ? (cfg as ProviderKeyConfig).experimentalCchSigning === true
      : undefined,
    testModel:
      brand === 'codex' ||
      brand === 'xai' ||
      isClaudeLikeBrand(brand) ||
      brand === 'gemini' ||
      brand === 'vertex'
        ? ''
        : undefined,
  };
}

export function BaseProviderForm({
  brand,
  resource,
  imageRouteResources = [],
  credentialGroupOptions,
  mode,
  mutating,
  formId,
  onSubmit,
  onDirtyChange,
}: BaseProviderFormProps) {
  const { t } = useTranslation();
  const descriptor = PROVIDER_DESCRIPTORS[brand];
  const layout = PROVIDER_FORM_LAYOUTS[brand];
  const isProviderNameRequired = brand === 'openaiCompatibility';
  const aliasLabel = t('providersPage.form.alias', { defaultValue: '别名' });
  const aliasHint = t('providersPage.form.aliasHint', {
    defaultValue: '用于展示和兼容旧的 allow 引用，可留空。',
  });
  const nameFieldLabel = isProviderNameRequired ? t('providersPage.form.name') : aliasLabel;
  const nameFieldHint = isProviderNameRequired ? '' : aliasHint;
  const hasPrimaryField = (field: PrimaryField) => layout.primaryFields.includes(field);
  const hasToggleField = (field: ToggleField) => layout.toggleFields.includes(field);
  const hasAdvancedSection = (section: AdvancedSection) =>
    layout.advancedSections.includes(section);
  const fid = useId();
  const [form, setForm] = useState<ProviderEntryFormInput>(() =>
    buildInitialForm(brand, resource, mode)
  );
  const [imageRouteTargetsSelf, setImageRouteTargetsSelf] = useState(() => {
    if (brand !== 'openaiCompatibility') return false;
    const initial = buildInitialForm(brand, resource, mode);
    return (
      Boolean(initial.name.trim()) &&
      initial.codexImageRoute?.targetSupplier.trim().toLowerCase() ===
        initial.name.trim().toLowerCase()
    );
  });
  const [initialFormSignature] = useState<string>(() =>
    JSON.stringify(buildInitialForm(brand, resource, mode))
  );
  const [error, setError] = useState<string | null>(null);
  const [showSingleApiKey, setShowSingleApiKey] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== initialFormSignature,
    [form, initialFormSignature]
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const fallbackApiKey = useMemo(() => {
    if (mode !== 'edit' || !resource) return '';
    if (brand === 'openaiCompatibility') return '';
    return (resource.raw as { apiKey?: string } | undefined)?.apiKey ?? '';
  }, [brand, mode, resource]);

  const fallbackAuthIndex = useMemo(() => {
    if (mode !== 'edit' || !resource) return '';
    return (resource.raw as { authIndex?: string } | undefined)?.authIndex ?? '';
  }, [mode, resource]);

  const connectivityMessages = useMemo<ConnectivityErrorMessages>(
    () => ({
      baseUrlRequired: t('providersPage.connectivity.baseUrlRequired'),
      endpointInvalid: t('providersPage.connectivity.endpointInvalid'),
      apiKeyRequired: t('providersPage.connectivity.apiKeyRequired'),
      modelRequired: t('providersPage.connectivity.modelRequired'),
      timeout: (seconds: number) => t('providersPage.connectivity.timeout', { seconds }),
      requestFailed: t('providersPage.connectivity.requestFailed'),
      authFailed: (status: number, detail: string) =>
        t('providersPage.connectivity.authFailed', { status, detail }),
      routeUnsupported: (status: number, detail: string) =>
        t('providersPage.connectivity.routeUnsupported', { status, detail }),
      rateLimited: (status: number, detail: string) =>
        t('providersPage.connectivity.rateLimited', { status, detail }),
      serverFailed: (status: number, detail: string) =>
        t('providersPage.connectivity.serverFailed', { status, detail }),
      protocolFailed: (status: number, detail: string) =>
        t('providersPage.connectivity.protocolFailed', { status, detail }),
    }),
    [t]
  );

  const connectivity = useConnectivityTest(
    {
      brand,
      baseUrl: form.baseUrl,
      testModel: form.testModel,
      models: form.models,
      formHeaders: form.headers,
      apiKeyEntries: form.apiKeyEntries,
      apiKey: form.apiKey,
      fallbackApiKey,
      authIndex: fallbackAuthIndex,
      proxyUrl: form.proxyUrl,
      authMode: form.authMode,
      protocolMode: form.protocolMode,
    },
    connectivityMessages
  );

  const discovery = useModelDiscovery({
    brand,
    baseUrl: form.baseUrl,
    formHeaders: form.headers,
    apiKeyEntries: form.apiKeyEntries,
    apiKey: form.apiKey,
    fallbackApiKey,
    authIndex: fallbackAuthIndex,
  });
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  const imageRouteDraftId = resource?.id ?? '__new-openai-compatible-supplier__';
  const imageRouteSuppliers = useMemo(() => {
    if (brand !== 'openaiCompatibility') return [];
    return buildCodexImageRouteSupplierCatalog(imageRouteResources, {
      id: imageRouteDraftId,
      replaceResourceId: resource?.id,
      name: form.name,
      disabled: form.disabled,
      credentialCount: (form.apiKeyEntries ?? []).filter(
        (entry) => entry.apiKey.trim() || entry.existingApiKey?.trim()
      ).length,
      runtimeStatus: resource?.runtimeStatus,
      models: form.models,
    });
  }, [
    brand,
    form.apiKeyEntries,
    form.disabled,
    form.models,
    form.name,
    imageRouteDraftId,
    imageRouteResources,
    resource?.id,
    resource?.runtimeStatus,
  ]);
  const selectableImageRouteSuppliers = useMemo(
    () => getSelectableCodexImageRouteSuppliers(imageRouteSuppliers),
    [imageRouteSuppliers]
  );
  const imageRouteInspection = useMemo(
    () => inspectCodexImageRoute(form.codexImageRoute, imageRouteSuppliers),
    [form.codexImageRoute, imageRouteSuppliers]
  );
  const selectedImageRouteSupplier =
    imageRouteInspection.supplier ??
    selectableImageRouteSuppliers.find(
      (supplier) =>
        supplier.name.toLowerCase() ===
        (form.codexImageRoute?.targetSupplier ?? '').trim().toLowerCase()
    ) ??
    null;
  const imageRouteModelChoices = useMemo(
    () => getCodexImageRouteModelChoices(selectedImageRouteSupplier),
    [selectedImageRouteSupplier]
  );
  const configuredImageRouteSupplier = (form.codexImageRoute?.targetSupplier ?? '').trim();
  const matchedImageRouteSupplier = selectableImageRouteSuppliers.find(
    (supplier) => supplier.name.toLowerCase() === configuredImageRouteSupplier.toLowerCase()
  );
  const selectedImageRouteSupplierValue =
    matchedImageRouteSupplier?.name ?? configuredImageRouteSupplier;
  const imageRouteSupplierOptions = useMemo(() => {
    const options = selectableImageRouteSuppliers.map((supplier) => ({
      value: supplier.name,
      label: supplier.name,
    }));
    if (
      configuredImageRouteSupplier &&
      !options.some(
        (option) => option.value.toLowerCase() === configuredImageRouteSupplier.toLowerCase()
      )
    ) {
      options.push({
        value: configuredImageRouteSupplier,
        label: configuredImageRouteSupplier,
      });
    }
    return options;
  }, [configuredImageRouteSupplier, selectableImageRouteSuppliers]);
  const configuredImageRouteModel = (form.codexImageRoute?.targetModel ?? '').trim();
  const matchedImageRouteModel = imageRouteModelChoices.find(
    (model) => model.routeName.toLowerCase() === configuredImageRouteModel.toLowerCase()
  );
  const selectedImageRouteModelValue =
    matchedImageRouteModel?.routeName ?? configuredImageRouteModel;
  const imageRouteModelOptions = useMemo(() => {
    const options = imageRouteModelChoices.map((model) => ({
      value: model.routeName,
      label: formatCodexImageRouteModel(model),
    }));
    if (
      configuredImageRouteModel &&
      !options.some(
        (option) => option.value.toLowerCase() === configuredImageRouteModel.toLowerCase()
      )
    ) {
      options.push({
        value: configuredImageRouteModel,
        label: configuredImageRouteModel,
      });
    }
    return options;
  }, [configuredImageRouteModel, imageRouteModelChoices]);

  const existingModelNames = useMemo(() => {
    const set = new Set<string>();
    form.models.forEach((m) => {
      const name = (m.name ?? '').trim();
      if (name) set.add(name);
    });
    return set;
  }, [form.models]);

  const testModelOptions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    form.models.forEach((m) => {
      const name = (m.name ?? '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
    const firstName = names[0];
    const autoLabel = firstName
      ? t('providersPage.form.testModelAutoWith', { name: firstName })
      : t('providersPage.form.testModelAutoEmpty');
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: autoLabel }];
    names.forEach((n) => opts.push({ value: n, label: n }));
    const tm = (form.testModel ?? '').trim();
    if (tm && !seen.has(tm)) {
      opts.push({
        value: tm,
        label: t('providersPage.form.testModelCustom', { name: tm }),
      });
    }
    return opts;
  }, [form.models, form.testModel, t]);

  const openDiscovery = () => {
    setDiscoveryOpen(true);
    if (!discovery.loading && !discovery.hasFetched) {
      void discovery.fetch();
    }
  };

  const closeDiscovery = () => {
    setDiscoveryOpen(false);
  };

  const applyDiscoveredModels = (incoming: ModelInfo[]) => {
    if (!incoming.length) return;
    setForm((prev) => {
      const seen = new Set<string>();
      const next: ModelEntryInput[] = [];
      prev.models.forEach((entry) => {
        const trimmed = (entry.name ?? '').trim();
        if (trimmed) {
          if (seen.has(trimmed)) return;
          seen.add(trimmed);
        }
        next.push(entry);
      });
      // If the existing list is just an empty placeholder row, drop it.
      const placeholderIdx = next.findIndex(
        (it) => !(it.name ?? '').trim() && !(it.alias ?? '').trim()
      );
      if (placeholderIdx !== -1) {
        next.splice(placeholderIdx, 1);
      }
      incoming.forEach((info) => {
        const trimmed = info.name.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        next.push({
          name: trimmed,
          alias: (info.alias ?? '').trim(),
        });
      });
      return { ...prev, models: next };
    });
  };

  const updateField = <K extends keyof ProviderEntryFormInput>(
    key: K,
    value: ProviderEntryFormInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateProviderName = (value: string) => {
    setForm((prev) => ({
      ...prev,
      name: value,
      codexImageRoute:
        imageRouteTargetsSelf && prev.codexImageRoute
          ? { ...prev.codexImageRoute, targetSupplier: value.trim() }
          : prev.codexImageRoute,
    }));
  };

  const imageRouteIssueMessage = (): string => {
    switch (imageRouteInspection.issue) {
      case 'target_supplier_required':
        return t('providersPage.imageRoute.issues.targetSupplierRequired');
      case 'target_model_required':
        return t('providersPage.imageRoute.issues.targetModelRequired');
      case 'supplier_missing':
        return t('providersPage.imageRoute.issues.supplierMissing', {
          supplier: imageRouteInspection.targetSupplier,
        });
      case 'supplier_ambiguous':
        return t('providersPage.imageRoute.issues.supplierAmbiguous', {
          supplier: imageRouteInspection.targetSupplier,
        });
      case 'model_missing':
        return t('providersPage.imageRoute.issues.modelMissing', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
          model: imageRouteInspection.targetModel,
        });
      case 'model_ambiguous':
        return t('providersPage.imageRoute.issues.modelAmbiguous', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
          model: imageRouteInspection.targetModel,
        });
      case 'model_not_image':
        return t('providersPage.imageRoute.issues.modelNotImage', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
          model: imageRouteInspection.targetModel,
        });
      case 'supplier_disabled':
        return t('providersPage.imageRoute.issues.supplierDisabled', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
        });
      case 'supplier_no_credentials':
        return t('providersPage.imageRoute.issues.supplierNoCredentials', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
        });
      case 'supplier_not_ready':
        return t('providersPage.imageRoute.issues.supplierNotReady', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
        });
      default:
        return '';
    }
  };

  const updateCloak = <K extends keyof NonNullable<ProviderEntryFormInput['cloak']>>(
    key: K,
    value: NonNullable<ProviderEntryFormInput['cloak']>[K]
  ) => {
    setForm((prev) => ({
      ...prev,
      cloak: {
        ...(prev.cloak ?? {
          mode: '',
          strictMode: false,
          sensitiveWordsText: '',
          cacheUserId: false,
        }),
        [key]: value,
      },
    }));
  };

  const validate = (): string | null => {
    if (hasPrimaryField('name') && isProviderNameRequired && !form.name.trim()) {
      return t('providersPage.form.validation.nameRequired');
    }
    if (hasPrimaryField('apiKey') && mode === 'create' && !form.apiKey.trim()) {
      return t('providersPage.form.validation.apiKeyRequired');
    }
    if (descriptor.baseUrlRequired && !form.baseUrl.trim()) {
      return t('providersPage.form.validation.baseUrlRequired');
    }
    if (form.maxConcurrency !== undefined && !isValidMaxConcurrency(form.maxConcurrency)) {
      return t('providersPage.form.validation.maxConcurrency');
    }
    if (getCredentialWeightError(form.weight)) {
      return t('credential_weight.validation');
    }
    if (
      form.apiKeyEntries?.some(
        (entry) =>
          entry.maxConcurrency !== undefined && !isValidMaxConcurrency(entry.maxConcurrency)
      )
    ) {
      return t('providersPage.form.validation.maxConcurrency');
    }
    if (form.apiKeyEntries?.some((entry) => getCredentialWeightError(entry.weight))) {
      return t('credential_weight.validation');
    }
    if (form.requestRetry !== undefined && !Number.isInteger(form.requestRetry)) {
      return t('providersPage.form.requestRetryInteger', {
        defaultValue: 'Request retry count must be an integer.',
      });
    }
    if (form.codexImageRoute?.enabled && imageRouteInspection.status === 'invalid') {
      return imageRouteIssueMessage();
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    try {
      setError(null);
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /* ------------------ entries helpers ------------------ */

  const headersList = useMemo(
    () => (form.headers.length ? form.headers : [emptyHeader()]),
    [form.headers]
  );
  const modelsList = useMemo(
    () => (form.models.length ? form.models : [emptyModel()]),
    [form.models]
  );
  const apiKeyEntries = useMemo(
    () =>
      form.apiKeyEntries && form.apiKeyEntries.length ? form.apiKeyEntries : [emptyApiKeyEntry()],
    [form.apiKeyEntries]
  );
  const actualApiKeyEntries = form.apiKeyEntries ?? [];
  const supportsOpenAIModelOptions = layout.modelEntryMode === 'openai';
  const credentialGroupsLabel = t('providersPage.form.credentialGroups', {
    defaultValue: '凭证分组',
  });
  const credentialGroupsHint = t('providersPage.form.credentialGroupsHint', {
    defaultValue: '可多选，供下游 API Key 按分组绑定使用。',
  });
  const credentialGroupsEmpty = t('providersPage.form.credentialGroupsEmpty', {
    defaultValue: '暂无可选分组，请先到配置面板的账号管理中创建。',
  });
  const modelsSectionLabel = t(`providersPage.form.modelsSectionByBrand.${brand}`, {
    defaultValue: t('providersPage.form.modelsSection'),
  });
  const singleConnectivity =
    brand === 'codex' || brand === 'xai'
      ? { status: connectivity.codexStatus, run: connectivity.runCodex }
      : brand === 'gemini'
        ? { status: connectivity.geminiStatus, run: connectivity.runGemini }
        : brand === 'vertex'
          ? { status: connectivity.vertexStatus, run: connectivity.runVertex }
          : isClaudeLikeBrand(brand)
            ? { status: connectivity.claudeStatus, run: connectivity.runClaude }
            : null;

  const updateModelEntry = (idx: number, patch: Partial<ModelEntryInput>) => {
    updateField(
      'models',
      modelsList.map((it, i) => (i === idx ? { ...it, ...patch } : it))
    );
  };

  const removeModelEntry = (idx: number) => {
    updateField(
      'models',
      modelsList.filter((_, i) => i !== idx)
    );
  };

  return (
    <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
      {/* Basic fields */}
      <div className={`${styles.section} ${styles.primarySection}`}>
        {hasPrimaryField('name') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-name`}>
              {nameFieldLabel}
              {nameFieldHint ? <span className={styles.labelHint}> · {nameFieldHint}</span> : null}
            </label>
            <input
              id={`${fid}-name`}
              className={inputClass}
              value={form.name}
              onChange={(e) => updateProviderName(e.target.value)}
              disabled={mutating}
            />
          </div>
        ) : null}

        {hasPrimaryField('apiKey') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-apiKey`}>
              {t('providersPage.form.apiKey')}
            </label>
            <div className={styles.passwordField}>
              <input
                id={`${fid}-apiKey`}
                className={cn(inputClass, styles.passwordInput)}
                type={showSingleApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => updateField('apiKey', e.target.value)}
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                placeholder={
                  mode === 'edit'
                    ? t('providersPage.form.apiKeyEditPlaceholder')
                    : t('providersPage.form.apiKeyCreatePlaceholder')
                }
                disabled={mutating}
              />
              <TooltipIconButton
                className={styles.passwordToggle}
                onClick={() => setShowSingleApiKey((v) => !v)}
                disabled={mutating}
                label={
                  showSingleApiKey
                    ? t('providersPage.form.hideApiKey')
                    : t('providersPage.form.showApiKey')
                }
              >
                {showSingleApiKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </TooltipIconButton>
            </div>
          </div>
        ) : null}

        {hasPrimaryField('baseUrl') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-baseUrl`}>
              {t('providersPage.form.baseUrl')}
              {descriptor.baseUrlRequired ? (
                <span className={styles.labelHint}>
                  {' '}
                  · {t('providersPage.form.baseUrlRequiredHint')}
                </span>
              ) : null}
            </label>
            <input
              id={`${fid}-baseUrl`}
              className={inputClass}
              value={form.baseUrl}
              onChange={(e) => updateField('baseUrl', e.target.value)}
              placeholder="https://api.example.com"
              disabled={mutating}
            />
          </div>
        ) : null}

        {hasPrimaryField('authMode') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-authMode`}>
              {t('providersPage.form.authMode')}
            </label>
            <Select
              id={`${fid}-authMode`}
              value={form.authMode ?? ''}
              options={[
                { value: '', label: t('providersPage.form.authModeLegacy') },
                { value: 'x-api-key', label: t('providersPage.form.authModeXAPIKey') },
                { value: 'bearer', label: t('providersPage.form.authModeBearer') },
              ]}
              onChange={(value) =>
                updateField('authMode', value === 'x-api-key' || value === 'bearer' ? value : '')
              }
              disabled={mutating}
              ariaLabel={t('providersPage.form.authMode')}
            />
          </div>
        ) : null}

        {hasPrimaryField('protocolMode') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-protocolMode`}>
              {t('providersPage.form.protocolMode')}
            </label>
            <Select
              id={`${fid}-protocolMode`}
              value={form.protocolMode ?? 'chat-completions'}
              options={[
                {
                  value: 'chat-completions',
                  label: t('providersPage.form.protocolModeChatCompletions'),
                },
                {
                  value: 'preserve-openai',
                  label: t('providersPage.form.protocolModePreserveOpenAI'),
                },
                {
                  value: 'auto',
                  label: t('providersPage.form.protocolModeAuto'),
                },
              ]}
              onChange={(value) =>
                updateField(
                  'protocolMode',
                  value === 'preserve-openai' || value === 'auto' ? value : 'chat-completions'
                )
              }
              disabled={mutating}
              ariaLabel={t('providersPage.form.protocolMode')}
            />
          </div>
        ) : null}

        {hasPrimaryField('retryOwner') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-retryOwner`}>
              {t('providersPage.form.retryOwner')}
            </label>
            <Select
              id={`${fid}-retryOwner`}
              value={form.retryOwner ?? 'xfpa'}
              options={[
                {
                  value: 'xfpa',
                  label: t('providersPage.form.retryOwnerXFPA'),
                },
                {
                  value: 'upstream',
                  label: t('providersPage.form.retryOwnerUpstream'),
                },
              ]}
              onChange={(value) =>
                updateField('retryOwner', value === 'upstream' ? 'upstream' : 'xfpa')
              }
              disabled={mutating}
              ariaLabel={t('providersPage.form.retryOwner')}
            />
          </div>
        ) : null}

        {hasPrimaryField('proxyUrl') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-proxy`}>
              {t('providersPage.form.proxyUrl')}
            </label>
            <input
              id={`${fid}-proxy`}
              className={inputClass}
              value={form.proxyUrl}
              onChange={(e) => updateField('proxyUrl', e.target.value)}
              placeholder="http://127.0.0.1:7890"
              disabled={mutating}
            />
          </div>
        ) : null}

        {hasPrimaryField('routing') ? (
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fid}-prefix`}>
                {t('providersPage.form.prefix')}
              </label>
              <input
                id={`${fid}-prefix`}
                className={inputClass}
                value={form.prefix}
                onChange={(e) => updateField('prefix', e.target.value)}
                disabled={mutating}
              />
            </div>
            {descriptor.supportsPriority ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fid}-prio`}>
                  {t('providersPage.form.priority')}
                </label>
                <input
                  id={`${fid}-prio`}
                  type="number"
                  className={inputClass}
                  value={form.priority ?? ''}
                  onChange={(e) =>
                    updateField(
                      'priority',
                      e.target.value === '' ? undefined : Number(e.target.value)
                    )
                  }
                  disabled={mutating}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {hasPrimaryField('maxConcurrency') ? (
          <ConcurrencySettingField
            id={`${fid}-concurrency`}
            className={styles.concurrencyField}
            label={t(
              brand === 'openaiCompatibility'
                ? 'providersPage.form.supplierMaxConcurrency'
                : 'providersPage.form.maxConcurrency'
            )}
            mode={form.concurrencyMode ?? 'inherit'}
            maxConcurrency={form.maxConcurrency ?? 0}
            disabled={mutating}
            onModeChange={(value) => updateField('concurrencyMode', value)}
            onMaxConcurrencyChange={(value) =>
              updateField('maxConcurrency', value === '' ? 0 : Number(value))
            }
          />
        ) : null}

        {hasPrimaryField('requestRetry') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-requestRetry`}>
              {t('config_management.visual.sections.network.request_retry', {
                defaultValue: 'Request Retry Count',
              })}
            </label>
            <input
              id={`${fid}-requestRetry`}
              type="number"
              step="1"
              className={inputClass}
              value={form.requestRetry ?? ''}
              onChange={(event) =>
                updateField(
                  'requestRetry',
                  event.target.value === '' ? undefined : Number(event.target.value)
                )
              }
              disabled={mutating}
            />
          </div>
        ) : null}

        {brand !== 'openaiCompatibility' ? (
          <CredentialWeightInput
            value={form.weight}
            disabled={mutating}
            onChange={(value) => updateField('weight', value)}
          />
        ) : null}

        {hasPrimaryField('testModel') ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-testModel`}>
              {t('providersPage.form.testModel')}
              {brand === 'codex' ||
              brand === 'xai' ||
              isClaudeLikeBrand(brand) ||
              brand === 'gemini' ? (
                <span className={styles.labelHint}>
                  {' '}
                  · {t('providersPage.form.testModelClaudeHint')}
                </span>
              ) : null}
            </label>
            <Select
              id={`${fid}-testModel`}
              value={form.testModel ?? ''}
              options={testModelOptions}
              onChange={(value) => updateField('testModel', value)}
              disabled={mutating}
              ariaLabel={t('providersPage.form.testModel')}
            />
            {singleConnectivity ? (
              <div className={styles.connectivityRow}>
                <button
                  type="button"
                  className={styles.connectivityBtn}
                  disabled={mutating || connectivity.isTestingAny}
                  onClick={() => void singleConnectivity.run()}
                >
                  {singleConnectivity.status.state === 'loading' ? (
                    <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                      <IconLoader2 size={14} />
                    </span>
                  ) : null}
                  <span>{t('providersPage.connectivity.test')}</span>
                </button>
                <ConnectivityStatusIcon state={singleConnectivity.status.state} />
                {singleConnectivity.status.state === 'success' ? (
                  <span className={styles.connectivityHintSuccess}>
                    {t('providersPage.connectivity.success')}
                  </span>
                ) : null}
              </div>
            ) : null}
            {singleConnectivity?.status.state === 'error' ? (
              <div className={styles.connectivityError}>{singleConnectivity.status.message}</div>
            ) : null}
          </div>
        ) : null}

        {brand !== 'openaiCompatibility' ? (
          <CredentialGroupsField
            label={credentialGroupsLabel}
            hint={credentialGroupsHint}
            options={credentialGroupOptions}
            selected={form.groups ?? []}
            onChange={(next) => updateField('groups', next)}
            disabled={mutating}
            emptyText={credentialGroupsEmpty}
          />
        ) : null}

        {hasToggleField('websockets') ? (
          <SelectionCheckbox
            checked={form.websockets ?? false}
            disabled={mutating}
            onChange={(checked) => updateField('websockets', checked)}
            className={styles.checkboxRow}
            labelClassName={styles.checkboxText}
            label={
              <>
                <span>{t('providersPage.form.websockets')}</span>
              </>
            }
          />
        ) : null}

        {hasToggleField('disabled') ? (
          <SelectionCheckbox
            checked={form.disabled}
            disabled={mutating}
            onChange={(checked) => updateField('disabled', checked)}
            className={styles.checkboxRow}
            labelClassName={styles.checkboxText}
            label={
              <>
                <span>{t('providersPage.form.disabled')}</span>
                <small>{t('providersPage.form.disabledHint')}</small>
              </>
            }
          />
        ) : null}

        {hasToggleField('fallback') ? (
          <SelectionCheckbox
            checked={form.fallback}
            disabled={mutating}
            onChange={(checked) => updateField('fallback', checked)}
            className={styles.checkboxRow}
            labelClassName={styles.checkboxText}
            label={
              <>
                <span>{t('providersPage.form.fallback')}</span>
                <small>{t('providersPage.form.fallbackHint')}</small>
              </>
            }
          />
        ) : null}

        {hasToggleField('disableCooling') ? (
          <SelectionCheckbox
            checked={form.disableCooling ?? false}
            disabled={mutating}
            onChange={(checked) => updateField('disableCooling', checked)}
            className={styles.checkboxRow}
            labelClassName={styles.checkboxText}
            label={
              <>
                <span>{t('providersPage.form.disableCooling')}</span>
                <small>{t('providersPage.form.disableCoolingHint')}</small>
              </>
            }
          />
        ) : null}

        {brand === 'openaiCompatibility' && form.codexImageRoute ? (
          <div className={styles.imageRouteSection}>
            <SelectionCheckbox
              checked={form.codexImageRoute.enabled}
              disabled={mutating}
              onChange={(checked) => {
                setImageRouteTargetsSelf(false);
                updateField('codexImageRoute', {
                  enabled: checked,
                  targetSupplier: '',
                  targetModel: '',
                });
              }}
              className={styles.checkboxRow}
              labelClassName={styles.checkboxText}
              label={
                <>
                  <span>{t('providersPage.imageRoute.toggle')}</span>
                  <small>{t('providersPage.imageRoute.hint')}</small>
                </>
              }
            />
            {form.codexImageRoute.enabled ? (
              <div className={styles.imageRouteFields}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${fid}-image-route-supplier`}>
                    {t('providersPage.imageRoute.targetSupplier')}
                  </label>
                  <Select
                    id={`${fid}-image-route-supplier`}
                    value={selectedImageRouteSupplierValue}
                    options={imageRouteSupplierOptions}
                    placeholder={t('providersPage.imageRoute.selectSupplier')}
                    onChange={(value) => {
                      const supplier = selectableImageRouteSuppliers.find(
                        (candidate) => candidate.name === value
                      );
                      setImageRouteTargetsSelf(supplier?.id === imageRouteDraftId);
                      updateField('codexImageRoute', {
                        enabled: true,
                        targetSupplier: value,
                        targetModel: '',
                      });
                    }}
                    disabled={mutating || selectableImageRouteSuppliers.length === 0}
                    ariaLabel={t('providersPage.imageRoute.targetSupplier')}
                    ariaDescribedBy={`${fid}-image-route-status`}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${fid}-image-route-model`}>
                    {t('providersPage.imageRoute.targetModel')}
                  </label>
                  <Select
                    id={`${fid}-image-route-model`}
                    value={selectedImageRouteModelValue}
                    options={imageRouteModelOptions}
                    placeholder={t('providersPage.imageRoute.selectModel')}
                    onChange={(value) =>
                      updateField('codexImageRoute', {
                        ...form.codexImageRoute!,
                        targetModel: value,
                      })
                    }
                    disabled={
                      mutating || !selectedImageRouteSupplier || imageRouteModelChoices.length === 0
                    }
                    ariaLabel={t('providersPage.imageRoute.targetModel')}
                    ariaDescribedBy={`${fid}-image-route-status`}
                  />
                </div>
                <div
                  id={`${fid}-image-route-status`}
                  className={`${styles.imageRouteStatus} ${styles[`imageRouteStatus_${imageRouteInspection.status}`]}`}
                  aria-live="polite"
                >
                  {imageRouteInspection.status === 'configured'
                    ? t('providersPage.imageRoute.configuredSummary', {
                        supplier: imageRouteInspection.supplier?.name,
                        model: imageRouteInspection.model
                          ? formatCodexImageRouteModel(imageRouteInspection.model)
                          : imageRouteInspection.targetModel,
                      })
                    : imageRouteIssueMessage()}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Advanced collapsible section */}
      {hasAdvancedSection('apiKeyEntries') && form.apiKeyEntries ? (
        <Collapsible
          className={styles.formCollapsible}
          label={
            <span className={styles.collapsibleLabelRow}>
              <span>{t('providersPage.form.apiKeyEntriesSection')}</span>
              <span className={styles.collapsibleCountBadge}>
                {apiKeyEntries.filter((e) => e.apiKey.trim() || e.existingApiKey?.trim()).length}
              </span>
            </span>
          }
          defaultOpen
        >
          <ApiKeyEntriesEditor
            entries={apiKeyEntries}
            credentialGroupOptions={credentialGroupOptions}
            credentialGroupsLabel={credentialGroupsLabel}
            credentialGroupsHint={credentialGroupsHint}
            credentialGroupsEmpty={credentialGroupsEmpty}
            aliasLabel={aliasLabel}
            aliasHint={aliasHint}
            removeDisabled={actualApiKeyEntries.length === 0}
            mutating={mutating}
            statuses={connectivity.openaiStatuses}
            isTestingAny={connectivity.isTestingAny}
            onUpdate={(idx, patch) =>
              updateField(
                'apiKeyEntries',
                apiKeyEntries.map((it, i) => (i === idx ? { ...it, ...patch } : it))
              )
            }
            onAdd={() => {
              const next = [...actualApiKeyEntries, emptyApiKeyEntry()];
              updateField('apiKeyEntries', next);
              return next.length - 1;
            }}
            onRemove={(idx) =>
              updateField(
                'apiKeyEntries',
                actualApiKeyEntries.filter((_, i) => i !== idx)
              )
            }
            onTest={(idx) => void connectivity.runOpenAIKey(idx)}
            onTestAll={() => void connectivity.runOpenAIAllKeys()}
          />
        </Collapsible>
      ) : null}

      {hasAdvancedSection('headers') ? (
        <Collapsible
          className={styles.formCollapsible}
          label={t('providersPage.form.headersSection')}
        >
          <div className={styles.entriesList}>
            {headersList.map((entry, idx) => (
              <div key={idx} className={styles.modelAliasRow}>
                <input
                  className={inputClass}
                  placeholder="X-Custom-Header"
                  value={entry.key}
                  onChange={(e) =>
                    updateField(
                      'headers',
                      headersList.map((it, i) => (i === idx ? { ...it, key: e.target.value } : it))
                    )
                  }
                  disabled={mutating}
                />
                <input
                  className={inputClass}
                  placeholder="value"
                  value={entry.value}
                  onChange={(e) =>
                    updateField(
                      'headers',
                      headersList.map((it, i) =>
                        i === idx ? { ...it, value: e.target.value } : it
                      )
                    )
                  }
                  disabled={mutating}
                />
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || headersList.length <= 1}
                  onClick={() =>
                    updateField(
                      'headers',
                      headersList.filter((_, i) => i !== idx)
                    )
                  }
                >
                  <IconX size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addBtn}
              disabled={mutating}
              onClick={() => updateField('headers', [...headersList, emptyHeader()])}
            >
              <IconPlus size={12} />
              <span>{t('providersPage.form.addHeader')}</span>
            </button>
          </div>
        </Collapsible>
      ) : null}

      {hasAdvancedSection('models') ? (
        <Collapsible className={styles.formCollapsible} label={modelsSectionLabel}>
          <div className={styles.entriesList}>
            {discovery.available ? (
              <div className={styles.entriesToolbar}>
                <button
                  type="button"
                  className={styles.connectivityBtn}
                  onClick={openDiscovery}
                  disabled={mutating}
                >
                  <IconDownload size={14} />
                  <span>{t('providersPage.discovery.openButton')}</span>
                </button>
              </div>
            ) : null}
            {discovery.available && discoveryOpen ? (
              <ModelDiscoveryPanel
                loading={discovery.loading}
                error={discovery.error}
                models={discovery.models}
                hasFetched={discovery.hasFetched}
                existingNames={existingModelNames}
                mutating={mutating}
                onApply={(names) => {
                  applyDiscoveredModels(names);
                }}
                onReload={() => void discovery.fetch()}
                onClose={closeDiscovery}
              />
            ) : null}
            <ModelEntriesEditor
              models={modelsList}
              extendedOptions={supportsOpenAIModelOptions}
              mutating={mutating}
              removeDisabled={modelsList.length <= 1}
              onUpdate={updateModelEntry}
              onAdd={() => updateField('models', [...modelsList, emptyModel()])}
              onRemove={removeModelEntry}
            />
          </div>
        </Collapsible>
      ) : null}

      {hasAdvancedSection('excludedModels') ? (
        <Collapsible
          className={styles.formCollapsible}
          label={t('providersPage.form.excludedSection')}
        >
          <div className={styles.field}>
            <span className={styles.labelHint}>{t('providersPage.form.excludedHint')}</span>
            <textarea
              className={cn(textareaClass, styles.textarea)}
              rows={4}
              value={form.excludedModelsText}
              onChange={(e) => updateField('excludedModelsText', e.target.value)}
              disabled={mutating}
              placeholder="model-1&#10;model-2"
            />
          </div>
        </Collapsible>
      ) : null}

      {hasAdvancedSection('cloak') && form.cloak ? (
        <Collapsible
          className={styles.formCollapsible}
          label={t('providersPage.form.cloakSection')}
        >
          <div className={styles.section}>
            <div className={styles.field}>
              <label className={styles.label}>{t('providersPage.form.cloakMode')}</label>
              <input
                className={inputClass}
                value={form.cloak.mode}
                onChange={(e) => updateCloak('mode', e.target.value)}
                placeholder="auto / always / never"
                disabled={mutating}
              />
            </div>
            <SelectionCheckbox
              checked={form.cloak.strictMode}
              disabled={mutating}
              onChange={(checked) => updateCloak('strictMode', checked)}
              className={styles.checkboxRow}
              labelClassName={styles.checkboxText}
              label={
                <>
                  <span>{t('providersPage.form.cloakStrict')}</span>
                </>
              }
            />
            <SelectionCheckbox
              checked={form.cloak.cacheUserId}
              disabled={mutating}
              onChange={(checked) => updateCloak('cacheUserId', checked)}
              className={styles.checkboxRow}
              labelClassName={styles.checkboxText}
              label={
                <>
                  <span>{t('providersPage.form.cloakCacheUserId')}</span>
                  <small>{t('providersPage.form.cloakCacheUserIdHint')}</small>
                </>
              }
            />
            <SelectionCheckbox
              checked={form.experimentalCchSigning ?? false}
              disabled={mutating}
              onChange={(checked) => updateField('experimentalCchSigning', checked)}
              className={styles.checkboxRow}
              labelClassName={styles.checkboxText}
              label={
                <>
                  <span>{t('providersPage.form.experimentalCchSigning')}</span>
                  <small>{t('providersPage.form.experimentalCchSigningHint')}</small>
                </>
              }
            />
            <div className={styles.field}>
              <label className={styles.label}>{t('providersPage.form.cloakSensitiveWords')}</label>
              <textarea
                className={cn(textareaClass, styles.textarea)}
                rows={3}
                value={form.cloak.sensitiveWordsText}
                onChange={(e) => updateCloak('sensitiveWordsText', e.target.value)}
                disabled={mutating}
              />
            </div>
          </div>
        </Collapsible>
      ) : null}

      {error ? <div className={styles.errorBox}>{error}</div> : null}
    </form>
  );
}
