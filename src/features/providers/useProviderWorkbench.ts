import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providersApi } from '@/services/api';
import { invalidateProviderRecentRequests } from '@/services/providerRecentRequests';
import { getErrorMessage } from '@/utils/helpers';
import { normalizeConcurrencySetting } from '@/utils/maxConcurrency';
import { useAuthInventoryStore, useAuthStore, useConfigStore } from '@/stores';
import {
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import type {
  Config,
  GeminiKeyConfig,
  ModelAlias,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import {
  claudeToResource,
  codexToResource,
  geminiToResource,
  kimiToResource,
  openaiToResource,
  vertexToResource,
  xaiToResource,
} from './adapters';
import { PROVIDER_BRAND_ORDER } from './descriptors';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderGroup,
  ProviderResource,
  ProviderSnapshot,
  SponsorKeyEntryInput,
  SponsorProviderBrand,
  SponsorProviderRaw,
} from './types';
import { buildKimiRaw, isKimiClaudeProvider, isKimiOpenAIProvider } from './kimi';
import { getSponsorProviderDefinition, type SponsorProtocolUrls } from './sponsorDefinitions';
import { runSponsorMutationWithRecovery } from './sponsorMutationRecovery';

export interface UseProviderWorkbenchResult {
  connected: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  snapshot: ProviderSnapshot | null;
  refetch: () => Promise<void>;

  createProvider: (brand: ProviderBrand, input: ProviderEntryFormInput) => Promise<void>;
  updateProvider: (resource: ProviderResource, input: ProviderEntryFormInput) => Promise<void>;
  deleteProvider: (resource: ProviderResource) => Promise<void>;
  toggleDisabled: (resource: ProviderResource, disabled: boolean) => Promise<void>;
  mutating: boolean;
  refreshSnapshot: () => void;
}

const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeCredentialGroups = (groups: string[] | undefined): string[] | undefined => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  (groups ?? []).forEach((group) => {
    const trimmed = String(group ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized.length > 0 ? normalized : undefined;
};

const headersFromEntries = (
  entries: Array<{ key: string; value: string }>
): Record<string, string> => {
  const out: Record<string, string> = {};
  entries.forEach((entry) => {
    const key = entry.key.trim();
    if (!key) return;
    out[key] = entry.value;
  });
  return out;
};

const parseThinkingJson = (value: string | undefined): Record<string, unknown> | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Thinking config must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const buildExcludedModels = (
  textValue: string,
  disabled: boolean,
  brand: ProviderBrand
): string[] | undefined => {
  const list = parseTextList(textValue);
  const filtered = list.filter((v) => v !== '*');
  if (brand === 'openaiCompatibility') {
    return filtered.length ? filtered : undefined;
  }
  if (disabled) {
    return withDisableAllModelsRule(filtered);
  }
  return filtered.length ? filtered : undefined;
};

const buildModelAliases = (
  models: ProviderEntryFormInput['models'] | undefined,
  includeOpenAIFields = false
): ModelAlias[] =>
  (models ?? [])
    .map((m) => {
      const entry: ModelAlias = {
        name: m.name.trim(),
        alias: m.alias?.trim() || undefined,
        priority: m.priority,
        testModel: m.testModel,
      };
      if (includeOpenAIFields) {
        entry.image = m.image === true;
        entry.thinking = parseThinkingJson(m.thinkingJson);
      }
      return entry;
    })
    .filter((m) => m.name);

const buildVertexModelAliases = (
  models: ProviderEntryFormInput['models'] | undefined
): ModelAlias[] =>
  (models ?? [])
    .map((m) => ({
      name: m.name.trim(),
      alias: m.alias?.trim() || undefined,
    }))
    .filter((m) => m.name);

const buildProviderKeyConfig = (
  brand: 'gemini' | 'codex' | 'xai' | 'claude' | 'vertex',
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | GeminiKeyConfig | null
): ProviderKeyConfig | GeminiKeyConfig => {
  const headers = headersFromEntries(input.headers);
  const models =
    brand === 'vertex' ? buildVertexModelAliases(input.models) : buildModelAliases(input.models);
  const excluded = buildExcludedModels(input.excludedModelsText, input.disabled, brand);
  const apiKeyChanged = input.apiKey.trim().length > 0;
  const concurrency = normalizeConcurrencySetting(input.concurrencyMode, input.maxConcurrency);
  const next: ProviderKeyConfig = {
    name: input.name.trim() || undefined,
    apiKey: apiKeyChanged ? input.apiKey.trim() : (existing?.apiKey ?? ''),
    groups: normalizeCredentialGroups(input.groups),
    priority: input.priority,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    prefix: input.prefix.trim() || undefined,
    baseUrl: input.baseUrl.trim() || undefined,
    proxyUrl: input.proxyUrl.trim() || undefined,
    fallback: input.fallback,
    models: models.length ? models : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    excludedModels: excluded,
    authIndex: existing?.authIndex,
    runtimeStatus: existing?.runtimeStatus,
  };
  if (brand !== 'vertex') {
    next.disableCooling = input.disableCooling === true;
  }
  if ((brand === 'codex' || brand === 'xai') && input.websockets !== undefined) {
    next.websockets = input.websockets;
  }
  if (brand === 'claude' && input.cloak) {
    next.cloak = {
      mode: input.cloak.mode.trim() || undefined,
      strictMode: input.cloak.strictMode,
      sensitiveWords: parseTextList(input.cloak.sensitiveWordsText),
      cacheUserId: input.cloak.cacheUserId === true,
    };
  }
  if (brand === 'claude') {
    next.authMode = input.authMode || undefined;
    next.experimentalCchSigning = input.experimentalCchSigning === true;
  }
  return next;
};

const buildOpenAIConfig = (
  input: ProviderEntryFormInput,
  existing?: OpenAIProviderConfig | null
): OpenAIProviderConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models, true);
  const concurrency = normalizeConcurrencySetting(input.concurrencyMode, input.maxConcurrency);
  const apiKeyEntries =
    input.apiKeyEntries
      ?.map((entry, index) => {
        const fallbackApiKey =
          entry.existingApiKey?.trim() || existing?.apiKeyEntries?.[index]?.apiKey?.trim() || '';
        const entryConcurrency = normalizeConcurrencySetting(
          entry.concurrencyMode,
          entry.maxConcurrency
        );
        return {
          name: entry.name?.trim() || undefined,
          apiKey: entry.apiKey.trim() || fallbackApiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
          authIndex: entry.authIndex?.trim() || undefined,
          groups: normalizeCredentialGroups(entry.groups),
          concurrencyMode: entryConcurrency.mode,
          maxConcurrency: entryConcurrency.maxConcurrency,
        };
      })
      .filter((entry) => entry.apiKey) ?? [];

  return {
    ...(existing ?? {}),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    protocolMode: input.protocolMode ?? 'chat-completions',
    retryOwner: input.retryOwner ?? 'xfpa',
    prefix: input.prefix.trim() || undefined,
    apiKeyEntries,
    disabled: input.disabled,
    disableCooling: input.disableCooling === true,
    fallback: input.fallback,
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    priority: input.priority,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    testModel: input.testModel?.trim() || undefined,
    codexImageRoute: input.codexImageRoute?.enabled
      ? {
          enabled: true,
          targetSupplier: input.codexImageRoute.targetSupplier.trim(),
          targetModel: input.codexImageRoute.targetModel.trim(),
        }
      : undefined,
  };
};

const sponsorEntryApiKey = (entry: SponsorKeyEntryInput): string =>
  entry.apiKey.trim() || entry.existingApiKey?.trim() || '';

export const buildSponsorOpenAIConfig = (
  entry: SponsorKeyEntryInput,
  providerName: string,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: OpenAIProviderConfig
): OpenAIProviderConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models, true);
  const apiKey = sponsorEntryApiKey(entry);
  const concurrency = normalizeConcurrencySetting(entry.concurrencyMode, entry.maxConcurrency);
  const apiKeyConcurrency = normalizeConcurrencySetting(
    entry.apiKeyConcurrencyMode,
    entry.apiKeyMaxConcurrency
  );
  const firstExistingEntry = existing?.apiKeyEntries?.[0];
  const apiKeyEntries = apiKey
    ? [
        {
          ...(firstExistingEntry ?? {}),
          apiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
          concurrencyMode: apiKeyConcurrency.mode,
          maxConcurrency: apiKeyConcurrency.maxConcurrency,
        },
      ]
    : [];

  return {
    ...(existing ?? {}),
    name: providerName,
    baseUrl: urls.openai,
    prefix: entry.prefix.trim() || undefined,
    disabled: entry.disabled,
    disableCooling: entry.disableCooling === true,
    fallback: entry.fallback === true,
    priority: entry.priority,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    apiKeyEntries,
    models: models.length ? models : undefined,
  };
};

export const buildSponsorClaudeConfig = (
  entry: SponsorKeyEntryInput,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: ProviderKeyConfig
): ProviderKeyConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models);
  const apiKey = sponsorEntryApiKey(entry);
  const concurrency = normalizeConcurrencySetting(entry.concurrencyMode, entry.maxConcurrency);
  const excluded = entry.disabled
    ? withDisableAllModelsRule(stripDisableAllModelsRule(existing?.excludedModels))
    : withoutDisableAllModelsRule(existing?.excludedModels);

  return {
    ...(existing ?? {}),
    apiKey,
    authMode: 'bearer',
    baseUrl: urls.anthropic,
    proxyUrl: entry.proxyUrl.trim() || undefined,
    prefix: entry.prefix.trim() || undefined,
    priority: entry.priority,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    fallback: entry.fallback === true,
    disableCooling: entry.disableCooling === true,
    excludedModels: excluded,
    models: models.length ? models : undefined,
  };
};

const normalizeSponsorKeyEntries = (
  entries: SponsorKeyEntryInput[] | undefined
): SponsorKeyEntryInput[] => (entries ?? []).filter((entry) => sponsorEntryApiKey(entry));

const toggleSponsorConfig = async (raw: SponsorProviderRaw, disabled: boolean) => {
  for (const item of raw.claude) {
    const excludedModels = disabled
      ? withDisableAllModelsRule(item.config.excludedModels)
      : withoutDisableAllModelsRule(item.config.excludedModels);
    await providersApi.updateClaudeConfig(item.config.apiKey, item.config.baseUrl, {
      ...item.config,
      excludedModels,
    });
  }
  for (const item of raw.openai) {
    await providersApi.updateOpenAIProviderDisabled(item.index, disabled);
  }
};

export const buildProviderGroups = (config: Config): ProviderGroup[] =>
  PROVIDER_BRAND_ORDER.map((brand) => {
    let resources: ProviderResource[] = [];
    switch (brand) {
      case 'gemini':
        resources = (config.geminiApiKeys ?? []).map((item, index) =>
          geminiToResource(item, index)
        );
        break;
      case 'codex':
        resources = (config.codexApiKeys ?? []).map((item, index) => codexToResource(item, index));
        break;
      case 'xai':
        resources = (config.xaiApiKeys ?? []).map((item, index) => xaiToResource(item, index));
        break;
      case 'claude':
        resources = (config.claudeApiKeys ?? []).reduce<ProviderResource[]>((out, item, index) => {
          if (!isKimiClaudeProvider(item)) {
            out.push(claudeToResource(item, index));
          }
          return out;
        }, []);
        break;
      case 'vertex':
        resources = (config.vertexApiKeys ?? []).map((item, index) =>
          vertexToResource(item, index)
        );
        break;
      case 'openaiCompatibility':
        resources = (config.openaiCompatibility ?? []).reduce<ProviderResource[]>(
          (out, item, index) => {
            if (!isKimiOpenAIProvider(item)) {
              out.push(openaiToResource(item, index));
            }
            return out;
          },
          []
        );
        break;
      case 'kimi': {
        const sponsorResource = kimiToResource(buildKimiRaw(config));
        resources = sponsorResource ? [sponsorResource] : [];
        break;
      }
    }
    return { id: brand, resources };
  });

export function useProviderWorkbench(): UseProviderWorkbenchResult {
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const authInventoryRevision = useAuthInventoryStore((s) => s.revision);
  const config = useConfigStore((s) => s.config);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const updateConfigValue = useConfigStore((s) => s.updateConfigValue);
  const isCacheValid = useConfigStore((s) => s.isCacheValid);

  const [isPending, setIsPending] = useState<boolean>(() => !isCacheValid());
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mutating, setMutating] = useState<boolean>(false);
  const [fetchedAt, setFetchedAt] = useState<string>(() => new Date().toISOString());

  const hasFetchedRef = useRef(false);
  const observedAuthRevisionRef = useRef(authInventoryRevision);
  const refetchGenerationRef = useRef(0);

  const connected = connectionStatus === 'connected';

  const refetch = useCallback(async () => {
    const generation = ++refetchGenerationRef.current;
    setIsFetching(true);
    setErrorMessage(null);
    try {
      const [
        configResult,
        geminiResult,
        codexResult,
        xaiResult,
        claudeResult,
        vertexResult,
        openaiResult,
      ] = await Promise.allSettled([
        fetchConfig(undefined, true),
        providersApi.getGeminiKeys(),
        providersApi.getCodexConfigs(),
        providersApi.getXAIConfigs(),
        providersApi.getClaudeConfigs(),
        providersApi.getVertexConfigs(),
        providersApi.getOpenAIProviders(),
      ]);
      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }
      if (generation !== refetchGenerationRef.current) return;
      if (geminiResult.status === 'fulfilled') {
        updateConfigValue('gemini-api-key', geminiResult.value || []);
      }
      if (codexResult.status === 'fulfilled') {
        updateConfigValue('codex-api-key', codexResult.value || []);
      }
      if (xaiResult.status === 'fulfilled') {
        updateConfigValue('xai-api-key', xaiResult.value || []);
      }
      if (claudeResult.status === 'fulfilled') {
        updateConfigValue('claude-api-key', claudeResult.value || []);
      }
      if (vertexResult.status === 'fulfilled') {
        updateConfigValue('vertex-api-key', vertexResult.value || []);
      }
      if (openaiResult.status === 'fulfilled') {
        updateConfigValue('openai-compatibility', openaiResult.value || []);
      }
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      if (generation !== refetchGenerationRef.current) return;
      setErrorMessage(getErrorMessage(err) || 'Failed to load providers');
    } finally {
      if (generation === refetchGenerationRef.current) {
        setIsPending(false);
        setIsFetching(false);
      }
    }
  }, [fetchConfig, updateConfigValue]);

  const refreshSnapshot = useCallback(() => {
    setFetchedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    if (!connected) return;
    hasFetchedRef.current = true;
    refetch().catch(() => {});
  }, [connected, refetch]);

  useEffect(() => {
    if (authInventoryRevision <= observedAuthRevisionRef.current) return;
    observedAuthRevisionRef.current = authInventoryRevision;
    if (!connected || !hasFetchedRef.current) return;
    void refetch();
  }, [authInventoryRevision, connected, refetch]);

  const snapshot = useMemo<ProviderSnapshot | null>(() => {
    if (!config) return null;
    return {
      fetchedAt,
      groups: buildProviderGroups(config),
    };
  }, [config, fetchedAt]);

  const persistSponsorConfig = useCallback(
    async (brand: SponsorProviderBrand, input: ProviderEntryFormInput) => {
      const definition = getSponsorProviderDefinition(brand);
      const raw = buildKimiRaw(config);
      const entries = normalizeSponsorKeyEntries(input.sponsorKeyEntries);
      const openaiEntry = entries.find((entry) => entry.protocol === 'openai');
      const claudeEntry = entries.find((entry) => entry.protocol === 'claude');

      const currentClaude = raw.claude[0];
      if (claudeEntry) {
        const next = buildSponsorClaudeConfig(
          claudeEntry,
          definition.getProtocolUrls,
          currentClaude?.config
        );
        if (currentClaude) {
          await providersApi.updateClaudeConfig(
            currentClaude.config.apiKey,
            currentClaude.config.baseUrl,
            next
          );
        } else {
          await providersApi.createClaudeConfig(next);
        }
      } else {
        for (const item of raw.claude) {
          await providersApi.deleteClaudeConfig(item.config.apiKey, item.config.baseUrl);
        }
      }

      const currentOpenAI = raw.openai[0];
      if (openaiEntry) {
        const next = buildSponsorOpenAIConfig(
          openaiEntry,
          definition.providerName,
          definition.getProtocolUrls,
          currentOpenAI?.config
        );
        if (currentOpenAI) {
          await providersApi.updateOpenAIProvider(
            currentOpenAI.config.name,
            currentOpenAI.index,
            next
          );
        } else {
          await providersApi.createOpenAIProvider(next);
        }
      } else if (currentOpenAI) {
        await providersApi.deleteOpenAIProvider(currentOpenAI.index);
      }
    },
    [config]
  );

  const createProvider = useCallback(
    async (brand: ProviderBrand, input: ProviderEntryFormInput) => {
      setMutating(true);
      try {
        if (brand === 'gemini') {
          await providersApi.createGeminiKey(
            buildProviderKeyConfig('gemini', input) as GeminiKeyConfig
          );
        } else if (brand === 'codex') {
          await providersApi.createCodexConfig(
            buildProviderKeyConfig('codex', input) as ProviderKeyConfig
          );
        } else if (brand === 'xai') {
          await providersApi.createXAIConfig(
            buildProviderKeyConfig('xai', input) as ProviderKeyConfig
          );
        } else if (brand === 'claude') {
          await providersApi.createClaudeConfig(
            buildProviderKeyConfig('claude', input) as ProviderKeyConfig
          );
        } else if (brand === 'vertex') {
          await providersApi.createVertexConfig(
            buildProviderKeyConfig('vertex', input) as ProviderKeyConfig
          );
        } else if (brand === 'openaiCompatibility') {
          await providersApi.createOpenAIProvider(buildOpenAIConfig(input));
        } else if (brand === 'kimi') {
          await runSponsorMutationWithRecovery(() => persistSponsorConfig(brand, input), refetch);
        }
        invalidateProviderRecentRequests();
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [persistSponsorConfig, refetch]
  );

  const updateProvider = useCallback(
    async (resource: ProviderResource, input: ProviderEntryFormInput) => {
      setMutating(true);
      try {
        const brand = resource.brand;
        const selector = resource.selector;
        if (brand === 'gemini' && selector.brand === 'gemini') {
          await providersApi.updateGeminiKey(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('gemini', input, resource.raw as GeminiKeyConfig)
          );
        } else if (brand === 'codex' && selector.brand === 'codex') {
          await providersApi.updateCodexConfig(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('codex', input, resource.raw as ProviderKeyConfig)
          );
        } else if (brand === 'xai' && selector.brand === 'xai') {
          await providersApi.updateXAIConfig(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('xai', input, resource.raw as ProviderKeyConfig)
          );
        } else if (brand === 'claude' && selector.brand === 'claude') {
          await providersApi.updateClaudeConfig(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('claude', input, resource.raw as ProviderKeyConfig)
          );
        } else if (brand === 'vertex' && selector.brand === 'vertex') {
          await providersApi.updateVertexConfig(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('vertex', input, resource.raw as ProviderKeyConfig)
          );
        } else if (brand === 'openaiCompatibility' && selector.brand === 'openaiCompatibility') {
          await providersApi.updateOpenAIProvider(
            selector.name,
            selector.index,
            buildOpenAIConfig(input, resource.raw as OpenAIProviderConfig)
          );
        } else if (brand === 'kimi') {
          await runSponsorMutationWithRecovery(() => persistSponsorConfig(brand, input), refetch);
        }
        invalidateProviderRecentRequests();
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [persistSponsorConfig, refetch]
  );

  const deleteProvider = useCallback(
    async (resource: ProviderResource) => {
      setMutating(true);
      try {
        const sel = resource.selector;
        if (sel.brand === 'gemini') {
          await providersApi.deleteGeminiKey(sel.apiKey, sel.baseUrl);
        } else if (sel.brand === 'codex') {
          await providersApi.deleteCodexConfig(sel.apiKey, sel.baseUrl);
        } else if (sel.brand === 'xai') {
          await providersApi.deleteXAIConfig(sel.apiKey, sel.baseUrl);
        } else if (sel.brand === 'claude') {
          await providersApi.deleteClaudeConfig(sel.apiKey, sel.baseUrl);
        } else if (sel.brand === 'vertex') {
          await providersApi.deleteVertexConfig(sel.apiKey, sel.baseUrl);
        } else if (sel.brand === 'openaiCompatibility') {
          await providersApi.deleteOpenAIProvider(sel.index);
        } else if (sel.brand === 'kimi') {
          await runSponsorMutationWithRecovery(async () => {
            const raw = resource.raw as SponsorProviderRaw;
            for (const item of raw.claude) {
              await providersApi.deleteClaudeConfig(item.config.apiKey, item.config.baseUrl);
            }
            const openAIIndices = raw.openai
              .map((item) => item.index)
              .sort((left, right) => right - left);
            for (const index of openAIIndices) {
              await providersApi.deleteOpenAIProvider(index);
            }
          }, refetch);
        }
        invalidateProviderRecentRequests();
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [refetch]
  );

  const toggleDisabled = useCallback(
    async (resource: ProviderResource, disabled: boolean) => {
      setMutating(true);
      try {
        const brand = resource.brand;
        const selector = resource.selector;
        if (brand === 'gemini' && selector.brand === 'gemini') {
          const current = resource.raw as GeminiKeyConfig;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          await providersApi.updateGeminiKey(selector.apiKey, selector.baseUrl, {
            ...current,
            excludedModels: excluded,
          });
        } else if (
          (brand === 'codex' && selector.brand === 'codex') ||
          (brand === 'xai' && selector.brand === 'xai') ||
          (brand === 'claude' && selector.brand === 'claude') ||
          (brand === 'vertex' && selector.brand === 'vertex')
        ) {
          const current = resource.raw as ProviderKeyConfig;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          const next = { ...current, excludedModels: excluded };
          if (selector.brand === 'codex') {
            await providersApi.updateCodexConfig(selector.apiKey, selector.baseUrl, next);
          } else if (selector.brand === 'xai') {
            await providersApi.updateXAIConfig(selector.apiKey, selector.baseUrl, next);
          } else if (selector.brand === 'claude') {
            await providersApi.updateClaudeConfig(selector.apiKey, selector.baseUrl, next);
          } else {
            await providersApi.updateVertexConfig(selector.apiKey, selector.baseUrl, next);
          }
        } else if (brand === 'openaiCompatibility' && selector.brand === 'openaiCompatibility') {
          await providersApi.updateOpenAIProviderDisabled(selector.index, disabled);
        } else if (brand === 'kimi') {
          await runSponsorMutationWithRecovery(
            () => toggleSponsorConfig(resource.raw as SponsorProviderRaw, disabled),
            refetch
          );
        }
        invalidateProviderRecentRequests();
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [refetch]
  );

  return {
    connected,
    isPending,
    isFetching,
    isError: Boolean(errorMessage),
    errorMessage,
    snapshot,
    refetch,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleDisabled,
    mutating,
    refreshSnapshot,
  };
}
