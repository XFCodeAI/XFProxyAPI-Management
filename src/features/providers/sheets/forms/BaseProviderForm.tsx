import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CredentialGroupsField } from '@/components/credentialGroups/CredentialGroupsField';
import {
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPlus,
  IconX,
} from '@/components/ui/icons';
import { Collapsible } from '@/components/ui/Collapsible';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { inputClass, textareaClass } from '@/components/ui/formStyles';
import { hasDisableAllModelsRule } from '@/components/providers/utils';
import { cn } from '@/lib/utils';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { ModelInfo } from '@/utils/models';
import { CLAUDE_API_BASE_URL } from '../../claudeApi';
import { PROVIDER_DESCRIPTORS } from '../../descriptors';
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
  groups: [],
  proxyUrl: '',
});

type PrimaryField =
  | 'name'
  | 'apiKey'
  | 'baseUrl'
  | 'protocolMode'
  | 'retryOwner'
  | 'proxyUrl'
  | 'routing'
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
    primaryFields: ['name', 'apiKey', 'baseUrl', 'proxyUrl', 'routing', 'testModel'],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  codex: {
    primaryFields: ['name', 'apiKey', 'baseUrl', 'proxyUrl', 'routing', 'testModel'],
    toggleFields: ['websockets', 'fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  xai: {
    primaryFields: ['name', 'apiKey', 'baseUrl', 'proxyUrl', 'routing', 'testModel'],
    toggleFields: ['websockets', 'fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  claude: {
    primaryFields: ['name', 'apiKey', 'baseUrl', 'proxyUrl', 'routing', 'testModel'],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels', 'cloak'],
    modelEntryMode: 'standard',
  },
  claudeApi: {
    primaryFields: ['apiKey', 'proxyUrl', 'routing', 'testModel'],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['headers', 'models', 'excludedModels', 'cloak'],
    modelEntryMode: 'standard',
  },
  vertex: {
    primaryFields: ['name', 'apiKey', 'baseUrl', 'proxyUrl', 'routing'],
    toggleFields: ['fallback', 'disabled'],
    advancedSections: ['headers', 'models', 'excludedModels'],
    modelEntryMode: 'standard',
  },
  openaiCompatibility: {
    primaryFields: ['name', 'baseUrl', 'protocolMode', 'retryOwner', 'routing', 'testModel'],
    toggleFields: ['fallback', 'disabled', 'disableCooling'],
    advancedSections: ['apiKeyEntries', 'headers', 'models'],
    modelEntryMode: 'openai',
  },
  apikeyFun: {
    primaryFields: [],
    toggleFields: [],
    advancedSections: [],
    modelEntryMode: 'standard',
  },
  code0: {
    primaryFields: [],
    toggleFields: [],
    advancedSections: [],
    modelEntryMode: 'standard',
  },
  fennoAI: {
    primaryFields: [],
    toggleFields: [],
    advancedSections: [],
    modelEntryMode: 'standard',
  },
  qiniuCloud: {
    primaryFields: [],
    toggleFields: [],
    advancedSections: [],
    modelEntryMode: 'standard',
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

const isClaudeLikeBrand = (brand: ProviderBrand): boolean =>
  brand === 'claude' || brand === 'claudeApi';

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
      baseUrl:
        brand === 'claudeApi' ? CLAUDE_API_BASE_URL : brand === 'xai' ? XAI_API_BASE_URL : '',
      protocolMode: brand === 'openaiCompatibility' ? 'chat-completions' : undefined,
      retryOwner: brand === 'openaiCompatibility' ? 'xfpa' : undefined,
      proxyUrl: '',
      prefix: '',
      disabled: false,
      disableCooling: false,
      fallback: false,
      priority: undefined,
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
        brand === 'gemini'
          ? ''
          : undefined,
      apiKeyEntries: brand === 'openaiCompatibility' ? [emptyApiKeyEntry()] : undefined,
    };
  }

  const raw = resource.raw;
  if (brand === 'openaiCompatibility') {
    const cfg = raw as OpenAIProviderConfig;
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
      apiKeyEntries: cfg.apiKeyEntries?.length
        ? cfg.apiKeyEntries.map((entry) => ({
            name: entry.name ?? '',
            apiKey: '',
            existingApiKey: entry.apiKey,
            groups: entry.groups ?? [],
            proxyUrl: entry.proxyUrl ?? '',
            authIndex: entry.authIndex,
          }))
        : [emptyApiKeyEntry()],
    };
  }

  const cfg = raw as GeminiKeyConfig & ProviderKeyConfig;
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
    proxyUrl: cfg.proxyUrl ?? '',
    prefix: cfg.prefix ?? '',
    disabled,
    disableCooling: cfg.disableCooling === true,
    fallback: cfg.fallback === true,
    priority: cfg.priority,
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
      brand === 'codex' || brand === 'xai' || isClaudeLikeBrand(brand) || brand === 'gemini'
        ? ''
        : undefined,
  };
}

export function BaseProviderForm({
  brand,
  resource,
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
              onChange={(e) => updateField('name', e.target.value)}
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
              ]}
              onChange={(value) =>
                updateField(
                  'protocolMode',
                  value === 'preserve-openai' ? 'preserve-openai' : 'chat-completions'
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
