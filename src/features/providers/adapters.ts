import type {
  GeminiKeyConfig,
  InteractionsKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
  ProviderRuntimeStatus,
} from '@/types';
import { hasDisableAllModelsRule, stripDisableAllModelsRule } from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import { normalizeConcurrencySetting } from '@/utils/maxConcurrency';
import {
  KIMI_DISPLAY_NAME,
  KIMI_PROTOCOL_LABELS,
  getKimiProtocolUrls,
  resolveKimiBaseUrl,
} from './kimi';
import type {
  ProviderBrand,
  ProviderResource,
  ProviderResourceSelector,
  SponsorProviderBrand,
  SponsorProviderRaw,
} from './types';

const countHeaders = (headers?: Record<string, string>): number =>
  headers ? Object.keys(headers).length : 0;

const collectCredentialGroups = (groups?: string[]): string[] => {
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

  return normalized;
};

const collectModelNames = (models?: Array<{ name?: string }>): string[] => {
  const seen = new Set<string>();
  (models ?? []).forEach((model) => {
    const name = (model?.name ?? '').trim();
    if (name) seen.add(name);
  });
  return Array.from(seen);
};

const normalizePriority = (priority?: number): number =>
  typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;

const aggregateSupplierMaxConcurrency = (limits: Array<number | undefined>): number => {
  if (limits.length === 0) return 0;
  let total = 0;
  for (const limit of limits) {
    if (!limit || limit <= 0) return 0;
    total += limit;
  }
  return total;
};

const SCHEDULING_REASON_PRIORITY: ProviderRuntimeStatus['scheduling'][] = [
  'cooling',
  'unavailable',
  'not_registered',
  'no_effective_model',
  'disabled_by_wildcard',
  'disabled',
];

export const aggregateProviderRuntimeStatuses = (
  statuses: Array<ProviderRuntimeStatus | undefined>
): ProviderRuntimeStatus | null => {
  const available = statuses.filter(Boolean) as ProviderRuntimeStatus[];
  if (available.length === 0) return null;

  const connectivity = available.some((status) => status.connectivity === 'reachable')
    ? 'reachable'
    : available.some((status) => status.connectivity === 'unreachable')
      ? 'unreachable'
      : 'unknown';
  if (available.some((status) => status.ready)) {
    return { connectivity, scheduling: 'ready', ready: true };
  }

  const scheduling =
    SCHEDULING_REASON_PRIORITY.find((reason) =>
      available.some((status) => status.scheduling === reason)
    ) ?? 'unavailable';
  const nextRetryAfter = available
    .map((status) => status.nextRetryAfter)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  return {
    connectivity,
    scheduling,
    ready: false,
    ...(scheduling === 'cooling' && nextRetryAfter ? { nextRetryAfter } : {}),
  };
};

const buildId = (brand: ProviderBrand, index: number, fragment: string) =>
  `${brand}:${index}:${fragment || 'item'}`;

const truncateForId = (value: string | undefined | null): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 8);
};

function providerKeyToResource(
  brand: 'gemini' | 'interactions' | 'codex' | 'xai' | 'claude' | 'vertex',
  config: GeminiKeyConfig | InteractionsKeyConfig | ProviderKeyConfig,
  index: number
): ProviderResource {
  const apiKey = config.apiKey ?? '';
  const disabled = hasDisableAllModelsRule(config.excludedModels);
  const concurrency = normalizeConcurrencySetting(config.concurrencyMode, config.maxConcurrency);
  const flags: ProviderResource['flags'] = {};
  if (brand === 'codex' || brand === 'xai') {
    flags.websockets = (config as ProviderKeyConfig).websockets === true;
  }
  if (brand === 'claude') {
    const cloak = (config as ProviderKeyConfig).cloak;
    flags.cloakEnabled = Boolean(cloak?.mode?.trim());
  }

  const selector: ProviderResourceSelector = {
    brand,
    apiKey,
    baseUrl: config.baseUrl,
    index,
  } as ProviderResourceSelector;

  return {
    id: buildId(brand, index, truncateForId(apiKey)),
    brand,
    originalIndex: index,
    name: config.name?.trim() || null,
    groups: collectCredentialGroups(config.groups),
    identifier: maskApiKey(apiKey) || `#${index + 1}`,
    apiKeyPreview: apiKey ? maskApiKey(apiKey) : null,
    apiKey: apiKey || null,
    authIndex: config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: config.proxyUrl ?? null,
    prefix: config.prefix ?? null,
    modelCount: config.models?.length ?? 0,
    models: collectModelNames(config.models),
    priority: normalizePriority(config.priority),
    weight: config.weight ?? null,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    fallback: config.fallback === true,
    headerCount: countHeaders(config.headers),
    excludedModelCount: stripDisableAllModelsRule(config.excludedModels).length,
    apiKeyEntryCount: 0,
    disabled,
    runtimeStatus: config.runtimeStatus ?? null,
    flags,
    selector,
    raw: config,
  };
}

export function geminiToResource(config: GeminiKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('gemini', config, index);
}

export function interactionsToResource(
  config: InteractionsKeyConfig,
  index: number
): ProviderResource {
  return providerKeyToResource('interactions', config, index);
}

export function codexToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('codex', config, index);
}

export function xaiToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('xai', config, index);
}

export function claudeToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('claude', config, index);
}

export function vertexToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('vertex', config, index);
}

export function openaiToResource(config: OpenAIProviderConfig, index: number): ProviderResource {
  const sourceIndex = config.sourceIndex ?? index;
  const name = (config.name ?? '').trim();
  const firstEntry = config.apiKeyEntries?.[0];
  const previewApiKey = firstEntry?.apiKey ? maskApiKey(firstEntry.apiKey) : null;
  const groups = collectCredentialGroups(
    (config.apiKeyEntries ?? []).flatMap((entry) => entry.groups ?? [])
  );
  const concurrency = normalizeConcurrencySetting(config.concurrencyMode, config.maxConcurrency);
  return {
    id: buildId('openaiCompatibility', sourceIndex, truncateForId(name) || `#${sourceIndex}`),
    brand: 'openaiCompatibility',
    originalIndex: sourceIndex,
    name: name || null,
    groups,
    identifier: name || `#${sourceIndex + 1}`,
    apiKeyPreview: previewApiKey,
    apiKey: null,
    authIndex: config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: null,
    prefix: config.prefix ?? null,
    modelCount: config.models?.length ?? 0,
    models: collectModelNames(config.models),
    priority: normalizePriority(config.priority),
    weight: config.apiKeyEntries?.length === 1 ? (config.apiKeyEntries[0]?.weight ?? null) : null,
    concurrencyMode: concurrency.mode,
    maxConcurrency: concurrency.maxConcurrency,
    fallback: config.fallback === true,
    headerCount: countHeaders(config.headers),
    excludedModelCount: 0,
    apiKeyEntryCount: config.apiKeyEntries?.length ?? 0,
    disabled: config.disabled === true,
    runtimeStatus: config.runtimeStatus ?? null,
    flags: {},
    selector: { brand: 'openaiCompatibility', name, index: sourceIndex },
    raw: config,
  };
}

interface SponsorResourceOptions {
  displayName: string;
  protocolLabels: readonly string[];
  resolveBaseUrl: (value: string | undefined | null) => string;
  getProtocolUrls: (value: string | undefined | null) => {
    anthropic: string;
    openai: string;
  };
}

function sponsorRawToResource(
  brand: SponsorProviderBrand,
  raw: SponsorProviderRaw,
  options: SponsorResourceOptions
): ProviderResource | null {
  if (raw.openai.length === 0 && raw.claude.length === 0) {
    return null;
  }
  const openaiKeyCount = raw.openai.reduce(
    (count, item) => count + (item.config.apiKeyEntries?.length ?? 0),
    0
  );
  const firstOpenAIEntry = raw.openai
    .flatMap((item) => item.config.apiKeyEntries ?? [])
    .find((entry) => entry.apiKey?.trim());
  const firstClaude = raw.claude.find((item) => item.config.apiKey?.trim());
  const apiKey = firstOpenAIEntry?.apiKey ?? firstClaude?.config.apiKey ?? '';
  const openaiDisabled =
    raw.openai.length > 0 && raw.openai.every((item) => item.config.disabled === true);
  const claudeDisabled =
    raw.claude.length > 0 &&
    raw.claude.every((item) => hasDisableAllModelsRule(item.config.excludedModels));
  const enabledCount =
    (raw.openai.length > 0 && !openaiDisabled ? 1 : 0) +
    (raw.claude.length > 0 && !claudeDisabled ? 1 : 0);
  const allResourcesConfigured = raw.openai.length > 0 || raw.claude.length > 0;
  const disabled = allResourcesConfigured && enabledCount === 0;
  const models = [
    ...raw.openai.flatMap((item) => collectModelNames(item.config.models)),
    ...raw.claude.flatMap((item) => collectModelNames(item.config.models)),
  ];
  const uniqueModels = Array.from(new Set(models));
  const headerCount =
    raw.openai.reduce((count, item) => count + countHeaders(item.config.headers), 0) +
    raw.claude.reduce((count, item) => count + countHeaders(item.config.headers), 0);
  const priority = Math.max(
    0,
    ...raw.openai.map((item) => normalizePriority(item.config.priority)),
    ...raw.claude.map((item) => normalizePriority(item.config.priority))
  );
  const fallbackStates = [
    ...raw.openai.map((item) => item.config.fallback === true),
    ...raw.claude.map((item) => item.config.fallback === true),
  ];
  const baseUrl = options.resolveBaseUrl(
    raw.openai[0]?.config.baseUrl ?? raw.claude[0]?.config.baseUrl
  );
  const protocolUrls = options.getProtocolUrls(baseUrl);
  const groups = collectCredentialGroups([
    ...raw.openai.flatMap(
      (item) => item.config.apiKeyEntries?.flatMap((entry) => entry.groups ?? []) ?? []
    ),
    ...raw.claude.flatMap((item) => item.config.groups ?? []),
  ]);
  const renderedBaseUrls = Array.from(
    new Set([protocolUrls.openai, protocolUrls.anthropic].filter(Boolean))
  );
  const runtimeStatus = aggregateProviderRuntimeStatuses([
    ...raw.openai.map((item) => item.config.runtimeStatus),
    ...raw.claude.map((item) => item.config.runtimeStatus),
  ]);
  const maxConcurrency = aggregateSupplierMaxConcurrency([
    ...raw.openai.map((item) => item.config.maxConcurrency),
    ...raw.claude.map((item) => item.config.maxConcurrency),
  ]);
  const weights = [
    ...raw.openai.flatMap((item) => item.config.apiKeyEntries?.map((entry) => entry.weight) ?? []),
    ...raw.claude.map((item) => item.config.weight),
  ];

  return {
    id: buildId(brand, 0, 'sponsor'),
    brand,
    originalIndex: 0,
    name: options.displayName,
    groups,
    identifier: options.displayName,
    apiKeyPreview: apiKey ? maskApiKey(apiKey) : null,
    apiKey: apiKey || null,
    authIndex: null,
    baseUrl: renderedBaseUrls.join(' / '),
    proxyUrl:
      firstOpenAIEntry?.proxyUrl ??
      raw.claude.find((item) => item.config.proxyUrl)?.config.proxyUrl ??
      null,
    prefix: raw.openai[0]?.config.prefix ?? raw.claude[0]?.config.prefix ?? null,
    modelCount: uniqueModels.length,
    models: uniqueModels,
    priority,
    weight: weights.length === 1 ? (weights[0] ?? null) : null,
    concurrencyMode: null,
    maxConcurrency,
    fallback: fallbackStates.length > 0 && fallbackStates.every(Boolean),
    headerCount,
    excludedModelCount: raw.claude.reduce(
      (count, item) => count + stripDisableAllModelsRule(item.config.excludedModels).length,
      0
    ),
    apiKeyEntryCount: openaiKeyCount + raw.claude.length,
    disabled,
    runtimeStatus,
    flags: {
      protocols: [...options.protocolLabels],
    },
    selector: {
      brand,
      openaiIndices: raw.openai.map((item) => item.index),
      claudeIndices: raw.claude.map((item) => item.index),
    } as ProviderResourceSelector,
    raw,
  };
}

export function kimiToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('kimi', raw, {
    displayName: KIMI_DISPLAY_NAME,
    protocolLabels: KIMI_PROTOCOL_LABELS,
    resolveBaseUrl: resolveKimiBaseUrl,
    getProtocolUrls: getKimiProtocolUrls,
  });
}
