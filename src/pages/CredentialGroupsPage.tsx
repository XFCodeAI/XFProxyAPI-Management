import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, FileKey2, KeyRound, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  apiKeysApi,
  authFilesApi,
  credentialGroupsApi,
  pluginsApi,
  providersApi,
} from '@/services/api';
import { getPluginTitle } from '@/features/plugins/pluginResources';
import { useConfigStore, useNotificationStore } from '@/stores';
import type {
  ApiError,
  AuthFileItem,
  Config,
  GeminiKeyConfig,
  PluginListEntry,
  ProviderKeyConfig,
} from '@/types';
import type { ManagedApiKeyEntry } from '@/services/api';
import { maskApiKey } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import styles from './CredentialGroupsPage.module.scss';

const normalizeGroupName = (value: string) => value.trim();
const ACTIVE_GROUP_STORAGE_KEY = 'credential-groups:active';
const ACTIVE_PROVIDER_STORAGE_KEY = 'credential-groups:active-provider';
const ALL_PROVIDERS_KEY = 'all';

type ProviderBindingBrand = 'gemini' | 'codex' | 'claude' | 'vertex' | 'openaiCompatibility';
type BindingFilter = 'all' | 'bound' | 'unbound';

interface ProviderBindingItem {
  id: string;
  brand: ProviderBindingBrand;
  index: number;
  entryIndex?: number;
  providerKey: string;
  providerLabel: string;
  title: string;
  subtitle: string;
  groups: string[];
}

interface AuthFileBindingItem {
  file: AuthFileItem;
  providerKey: string;
  providerLabel: string;
}

type ProviderCatalog = Map<string, string>;

interface UsageSummary {
  authFiles: number;
  providers: number;
  apiKeys: number;
}

interface ProviderFacet extends UsageSummary {
  key: string;
  label: string;
  total: number;
}

const emptyUsage = (): UsageSummary => ({ authFiles: 0, providers: 0, apiKeys: 0 });

const normalizeCredentialGroups = (groups: unknown): string[] => {
  if (!Array.isArray(groups)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  groups.forEach((group) => {
    const value = String(group ?? '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(value);
  });
  return normalized;
};

const groupKey = (group: string) => group.trim().toLowerCase();

const hasGroup = (groups: unknown, group: string): boolean => {
  const key = groupKey(group);
  if (!key) return false;
  return normalizeCredentialGroups(groups).some((item) => groupKey(item) === key);
};

const withGroup = (groups: unknown, group: string): string[] => {
  const normalized = normalizeCredentialGroups(groups);
  if (hasGroup(normalized, group)) return normalized;
  return [...normalized, group.trim()].filter(Boolean);
};

const withoutGroup = (groups: unknown, group: string): string[] => {
  const key = groupKey(group);
  return normalizeCredentialGroups(groups).filter((item) => groupKey(item) !== key);
};

const compactText = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ');

const providerLabels: Record<ProviderBindingBrand, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  vertex: 'Vertex',
  openaiCompatibility: 'OpenAI-compatible',
};

const builtinProviderLabels: Record<string, string> = {
  aistudio: 'AIStudio',
  anthropic: 'Claude',
  antigravity: 'Antigravity',
  claude: 'Claude',
  codex: 'Codex',
  empty: '空文件',
  gemini: 'Gemini',
  grok: 'Grok / xAI',
  iflow: 'iFlow',
  kimi: 'Kimi',
  openai: 'OpenAI',
  qwen: 'Qwen',
  unknown: '其他',
  vertex: 'Vertex',
  xai: 'Grok / xAI',
};

const normalizeProviderCatalogKey = (value: unknown): string =>
  normalizeOAuthProviderKey(String(value ?? '')).trim();

const humanizeProviderKey = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '-';
  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

const addProviderCatalogEntry = (
  catalog: ProviderCatalog,
  key: unknown,
  label: unknown,
  overwrite = false
) => {
  const normalizedKey = normalizeProviderCatalogKey(key);
  const normalizedLabel = String(label ?? '').trim();
  if (!normalizedKey || !normalizedLabel) return;
  if (!overwrite && catalog.has(normalizedKey)) return;
  catalog.set(normalizedKey, normalizedLabel);
};

const buildProviderCatalog = (
  config: Config | null,
  plugins: PluginListEntry[]
): ProviderCatalog => {
  const catalog: ProviderCatalog = new Map();
  Object.entries(builtinProviderLabels).forEach(([key, label]) => {
    addProviderCatalogEntry(catalog, key, label, true);
  });

  (config?.openaiCompatibility ?? []).forEach((provider) => {
    addProviderCatalogEntry(catalog, provider.name, provider.name);
  });

  plugins.forEach((plugin) => {
    if (!plugin.registered || !plugin.effectiveEnabled) return;
    const label = getPluginTitle(plugin);
    addProviderCatalogEntry(catalog, plugin.id, label, true);
    if (plugin.oauthProvider) {
      addProviderCatalogEntry(catalog, plugin.oauthProvider, label, true);
    }
  });

  return catalog;
};

const resolveProviderLabel = (catalog: ProviderCatalog, value: unknown): string => {
  const key = normalizeProviderCatalogKey(value);
  if (!key) return '-';
  return catalog.get(key) ?? humanizeProviderKey(String(value ?? key));
};

const resolveAuthFileProviderKey = (file: AuthFileItem): string =>
  normalizeProviderCatalogKey(file.provider ?? file.type ?? '');

const buildAuthFileBindingItems = (
  files: AuthFileItem[],
  catalog: ProviderCatalog
): AuthFileBindingItem[] =>
  files.map((file) => {
    const providerKey = resolveAuthFileProviderKey(file);
    return {
      file,
      providerKey,
      providerLabel: resolveProviderLabel(catalog, providerKey || file.provider || file.type),
    };
  });

const providerKeyTitle = (
  brand: ProviderBindingBrand,
  config: GeminiKeyConfig | ProviderKeyConfig,
  index: number
): string => config.name?.trim() || `${providerLabels[brand]} #${index + 1}`;

const providerKeySubtitle = (config: GeminiKeyConfig | ProviderKeyConfig): string =>
  compactText(maskApiKey(config.apiKey), config.baseUrl, config.proxyUrl);

const buildProviderBindingItems = (
  config: Config | null,
  catalog: ProviderCatalog
): ProviderBindingItem[] => {
  if (!config) return [];
  const items: ProviderBindingItem[] = [];
  const appendProviderKeys = (
    brand: Exclude<ProviderBindingBrand, 'openaiCompatibility'>,
    list: Array<GeminiKeyConfig | ProviderKeyConfig> | undefined
  ) => {
    (list ?? []).forEach((entry, index) => {
      const providerKey = normalizeProviderCatalogKey(brand);
      const providerLabel = resolveProviderLabel(catalog, brand);
      items.push({
        id: `${brand}:${index}`,
        brand,
        index,
        providerKey,
        providerLabel,
        title: providerKeyTitle(brand, entry, index),
        subtitle: providerKeySubtitle(entry),
        groups: normalizeCredentialGroups(entry.groups),
      });
    });
  };

  appendProviderKeys('gemini', config.geminiApiKeys);
  appendProviderKeys('codex', config.codexApiKeys);
  appendProviderKeys('claude', config.claudeApiKeys);
  appendProviderKeys('vertex', config.vertexApiKeys);

  (config.openaiCompatibility ?? []).forEach((provider, providerIndex) => {
    (provider.apiKeyEntries ?? []).forEach((entry, entryIndex) => {
      const providerKey = normalizeProviderCatalogKey(provider.name || 'openai');
      const providerLabel = resolveProviderLabel(catalog, providerKey || provider.name || 'openai');
      const title = compactText(
        provider.name,
        entry.name?.trim() || `${providerLabels.openaiCompatibility} #${entryIndex + 1}`
      );
      items.push({
        id: `openaiCompatibility:${providerIndex}:${entryIndex}`,
        brand: 'openaiCompatibility',
        index: providerIndex,
        entryIndex,
        providerKey,
        providerLabel,
        title,
        subtitle: compactText(maskApiKey(entry.apiKey), provider.baseUrl, entry.proxyUrl),
        groups: normalizeCredentialGroups(entry.groups),
      });
    });
  });

  return items;
};

const getOrCreateProviderFacet = (
  map: Map<string, ProviderFacet>,
  key: string,
  label: string
): ProviderFacet => {
  const current = map.get(key);
  if (current) return current;
  const created: ProviderFacet = {
    key,
    label,
    authFiles: 0,
    providers: 0,
    apiKeys: 0,
    total: 0,
  };
  map.set(key, created);
  return created;
};

const finishProviderFacet = (facet: ProviderFacet): ProviderFacet => ({
  ...facet,
  total: facet.authFiles + facet.providers + facet.apiKeys,
});

const buildProviderFacets = (
  authFileItems: AuthFileBindingItem[],
  providerItems: ProviderBindingItem[],
  apiKeyEntries: ManagedApiKeyEntry[],
  plugins: PluginListEntry[],
  catalog: ProviderCatalog
): ProviderFacet[] => {
  const map = new Map<string, ProviderFacet>();

  plugins.forEach((plugin) => {
    if (!plugin.registered || !plugin.effectiveEnabled) return;
    if (!plugin.supportsOAuth && !plugin.oauthProvider) return;
    const key = normalizeProviderCatalogKey(plugin.oauthProvider || plugin.id);
    if (!key) return;
    getOrCreateProviderFacet(map, key, resolveProviderLabel(catalog, key));
  });

  authFileItems.forEach((item) => {
    const key = item.providerKey || normalizeProviderCatalogKey('unknown');
    const facet = getOrCreateProviderFacet(map, key, item.providerLabel);
    facet.authFiles += 1;
  });

  providerItems.forEach((item) => {
    const key = item.providerKey || normalizeProviderCatalogKey(item.brand);
    const facet = getOrCreateProviderFacet(map, key, item.providerLabel);
    facet.providers += 1;
  });

  const providerFacets = Array.from(map.values())
    .map(finishProviderFacet)
    .filter((facet) => facet.total > 0 || catalog.has(facet.key))
    .sort((left, right) => {
      const totalDiff = right.total - left.total;
      if (totalDiff !== 0) return totalDiff;
      return left.label.localeCompare(right.label);
    });

  const allFacet: ProviderFacet = {
    key: ALL_PROVIDERS_KEY,
    label: '全部',
    authFiles: authFileItems.length,
    providers: providerItems.length,
    apiKeys: apiKeyEntries.length,
    total: authFileItems.length + providerItems.length + apiKeyEntries.length,
  };

  return [allFacet, ...providerFacets];
};

const matchesQuery = (query: string, ...values: unknown[]): boolean => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(normalized)
  );
};

const matchesBindingFilter = (
  groups: unknown,
  activeGroup: string,
  filter: BindingFilter
): boolean => {
  if (filter === 'all') return true;
  const bound = hasGroup(groups, activeGroup);
  return filter === 'bound' ? bound : !bound;
};

function GroupChips({ groups, emptyText }: { groups: string[]; emptyText: string }) {
  if (groups.length === 0) {
    return <span className={styles.emptyGroupText}>{emptyText}</span>;
  }
  return (
    <div className={styles.groupChips}>
      {groups.map((group) => (
        <span className={styles.groupChip} key={group}>
          {group}
        </span>
      ))}
    </div>
  );
}

function BindingFilterControl({
  value,
  onChange,
  labels,
}: {
  value: BindingFilter;
  onChange: (next: BindingFilter) => void;
  labels: Record<BindingFilter, string>;
}) {
  const options: BindingFilter[] = ['all', 'bound', 'unbound'];
  return (
    <div className={styles.bindingFilter} role="group">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={`${styles.bindingFilterButton} ${
            value === option ? styles.bindingFilterButtonActive : ''
          }`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

export function CredentialGroupsPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const [groups, setGroups] = useState<string[]>([]);
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [apiKeyEntries, setApiKeyEntries] = useState<ManagedApiKeyEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)?.trim() ?? '';
  });
  const [activeProviderKey, setActiveProviderKey] = useState<string>(() => {
    if (typeof window === 'undefined') return ALL_PROVIDERS_KEY;
    return window.localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY)?.trim() || ALL_PROVIDERS_KEY;
  });
  const [query, setQuery] = useState('');
  const [savingAuthFileName, setSavingAuthFileName] = useState<string | null>(null);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [savingApiKeyIndex, setSavingApiKeyIndex] = useState<number | null>(null);
  const [authFilesFilter, setAuthFilesFilter] = useState<BindingFilter>('all');
  const [providersFilter, setProvidersFilter] = useState<BindingFilter>('all');
  const [apiKeysFilter, setApiKeysFilter] = useState<BindingFilter>('all');

  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => left.localeCompare(right)),
    [groups]
  );
  const existingKeys = useMemo(() => new Set(groups.map((group) => group.toLowerCase())), [groups]);
  const providerCatalog = useMemo(() => buildProviderCatalog(config, plugins), [config, plugins]);
  const authFileItems = useMemo(
    () => buildAuthFileBindingItems(authFiles, providerCatalog),
    [authFiles, providerCatalog]
  );
  const providerItems = useMemo(
    () => buildProviderBindingItems(config, providerCatalog),
    [config, providerCatalog]
  );
  const providerFacets = useMemo(
    () =>
      buildProviderFacets(authFileItems, providerItems, apiKeyEntries, plugins, providerCatalog),
    [apiKeyEntries, authFileItems, plugins, providerCatalog, providerItems]
  );
  const activeProviderExists = useMemo(
    () => providerFacets.some((facet) => facet.key === activeProviderKey),
    [activeProviderKey, providerFacets]
  );
  const resolvedActiveProviderKey = activeProviderExists ? activeProviderKey : ALL_PROVIDERS_KEY;
  const activeGroupExists = useMemo(
    () => sortedGroups.some((group) => groupKey(group) === groupKey(activeGroup)),
    [activeGroup, sortedGroups]
  );
  const resolvedActiveGroup = activeGroupExists ? activeGroup : (sortedGroups[0] ?? '');

  const usageByGroup = useMemo(() => {
    const map = new Map<string, UsageSummary>();
    const ensure = (group: string) => {
      const key = groupKey(group);
      const current = map.get(key);
      if (current) return current;
      const created = emptyUsage();
      map.set(key, created);
      return created;
    };

    authFileItems.forEach((item) => {
      normalizeCredentialGroups(item.file.groups).forEach((group) => {
        ensure(group).authFiles += 1;
      });
    });
    providerItems.forEach((item) => {
      normalizeCredentialGroups(item.groups).forEach((group) => {
        ensure(group).providers += 1;
      });
    });
    apiKeyEntries.forEach((entry) => {
      normalizeCredentialGroups(entry.groups).forEach((group) => {
        ensure(group).apiKeys += 1;
      });
    });

    return map;
  }, [apiKeyEntries, authFileItems, providerItems]);

  const activeUsage = usageByGroup.get(groupKey(resolvedActiveGroup)) ?? emptyUsage();
  const activeUsageTotal = activeUsage.authFiles + activeUsage.providers + activeUsage.apiKeys;
  const bindingFilterLabels = useMemo<Record<BindingFilter, string>>(
    () => ({
      all: t('credential_groups_page.filter_all'),
      bound: t('credential_groups_page.filter_bound'),
      unbound: t('credential_groups_page.filter_unbound'),
    }),
    [t]
  );
  const activeProviderFacet =
    providerFacets.find((facet) => facet.key === resolvedActiveProviderKey) ?? providerFacets[0];

  const filteredAuthFiles = useMemo(
    () =>
      authFileItems
        .filter(
          (item) =>
            resolvedActiveProviderKey === ALL_PROVIDERS_KEY ||
            item.providerKey === resolvedActiveProviderKey
        )
        .filter((item) =>
          matchesQuery(
            query,
            item.file.name,
            item.file.alias,
            item.file.provider,
            item.file.type,
            item.providerKey,
            item.providerLabel,
            item.file.groups?.join(' ')
          )
        )
        .filter((item) =>
          matchesBindingFilter(item.file.groups, resolvedActiveGroup, authFilesFilter)
        ),
    [authFileItems, authFilesFilter, query, resolvedActiveGroup, resolvedActiveProviderKey]
  );
  const filteredProviderItems = useMemo(
    () =>
      providerItems
        .filter(
          (item) =>
            resolvedActiveProviderKey === ALL_PROVIDERS_KEY ||
            item.providerKey === resolvedActiveProviderKey
        )
        .filter((item) =>
          matchesQuery(
            query,
            item.title,
            item.subtitle,
            item.providerLabel,
            providerLabels[item.brand],
            item.groups.join(' ')
          )
        )
        .filter((item) => matchesBindingFilter(item.groups, resolvedActiveGroup, providersFilter)),
    [providerItems, providersFilter, query, resolvedActiveGroup, resolvedActiveProviderKey]
  );
  const filteredApiKeyEntries = useMemo(
    () =>
      apiKeyEntries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) =>
          matchesQuery(
            query,
            entry.key,
            entry.groups.join(' ')
          )
        )
        .filter(({ entry }) =>
          matchesBindingFilter(entry.groups, resolvedActiveGroup, apiKeysFilter)
        ),
    [
      apiKeyEntries,
      apiKeysFilter,
      query,
      resolvedActiveGroup,
    ]
  );

  const loadGroups = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError('');

      try {
        const authFilesResponse = await authFilesApi.list();
        const [nextGroups, nextApiKeyEntries, pluginResponse] = await Promise.all([
          credentialGroupsApi.list(),
          apiKeysApi.listEntries(),
          pluginsApi.list().catch(() => ({ plugins: [] })),
          fetchConfig(undefined, true),
        ]);
        setGroups(nextGroups);
        setAuthFiles(authFilesResponse.files ?? []);
        setApiKeyEntries(nextApiKeyEntries);
        setPlugins(pluginResponse.plugins ?? []);
      } catch (err: unknown) {
        const message = getErrorMessage(err, t('credential_groups_page.load_failed'));
        setLoadError(message);
        if (silent) {
          showNotification(message, 'error');
        }
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [fetchConfig, showNotification, t]
  );

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!resolvedActiveGroup) return;
    if (resolvedActiveGroup === activeGroup) return;
    setActiveGroup(resolvedActiveGroup);
  }, [activeGroup, resolvedActiveGroup]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!resolvedActiveGroup) return;
    window.localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, resolvedActiveGroup);
  }, [resolvedActiveGroup]);

  useEffect(() => {
    if (activeProviderKey === resolvedActiveProviderKey) return;
    setActiveProviderKey(resolvedActiveProviderKey);
  }, [activeProviderKey, resolvedActiveProviderKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, resolvedActiveProviderKey);
  }, [resolvedActiveProviderKey]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizeGroupName(nameInput);
    if (!name) {
      setNameError(t('credential_groups_page.name_required'));
      return;
    }
    if (existingKeys.has(name.toLowerCase())) {
      setNameError(t('credential_groups_page.name_duplicate'));
      return;
    }

    setCreating(true);
    setNameError('');
    try {
      await credentialGroupsApi.create(name);
      setNameInput('');
      const nextGroups = await credentialGroupsApi.list();
      setGroups(nextGroups);
      setActiveGroup(name);
      showNotification(t('credential_groups_page.create_success', { name }), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err, t('credential_groups_page.create_failed'));
      setNameError(message);
    } finally {
      setCreating(false);
    }
  };

  const removeDeletedGroup = (name: string) => {
    const nextGroups = groups.filter((group) => groupKey(group) !== groupKey(name));
    setGroups(nextGroups);
    if (groupKey(activeGroup) === groupKey(name)) {
      setActiveGroup(nextGroups[0] ?? '');
    }
  };

  const confirmDelete = (name: string) => {
    const usage = usageByGroup.get(groupKey(name)) ?? emptyUsage();
    const usageTotal = usage.authFiles + usage.providers + usage.apiKeys;
    if (usageTotal > 0) {
      showNotification(
        t('credential_groups_page.delete_blocked_detail', {
          defaultValue:
            '分组仍被 {{authFiles}} 个认证文件、{{providers}} 个 AI 供应商凭证、{{apiKeys}} 个 API Key 使用，请先解绑。',
          authFiles: usage.authFiles,
          providers: usage.providers,
          apiKeys: usage.apiKeys,
        }),
        'error'
      );
      return;
    }

    showConfirmation({
      title: t('credential_groups_page.delete_title'),
      message: t('credential_groups_page.delete_confirm', { name }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setDeletingName(name);
        try {
          await credentialGroupsApi.delete(name);
          removeDeletedGroup(name);
          showNotification(t('credential_groups_page.delete_success', { name }), 'success');
        } catch (err: unknown) {
          const status = (err as ApiError).status;
          const message =
            status === 409
              ? t('credential_groups_page.delete_blocked')
              : getErrorMessage(err, t('credential_groups_page.delete_failed'));
          showNotification(message, 'error');
        } finally {
          setDeletingName(null);
        }
      },
    });
  };

  const updateAuthFileGroup = async (file: AuthFileItem, checked: boolean) => {
    if (!resolvedActiveGroup) return;
    const nextGroups = checked
      ? withGroup(file.groups, resolvedActiveGroup)
      : withoutGroup(file.groups, resolvedActiveGroup);
    setSavingAuthFileName(file.name);
    try {
      await authFilesApi.patchFields(file.name, { groups: nextGroups });
      setAuthFiles((current) =>
        current.map((item) => (item.name === file.name ? { ...item, groups: nextGroups } : item))
      );
    } catch (err: unknown) {
      showNotification(
        getErrorMessage(
          err,
          t('credential_groups_page.bind_failed', { defaultValue: '分组绑定失败' })
        ),
        'error'
      );
    } finally {
      setSavingAuthFileName(null);
    }
  };

  const updateProviderGroup = async (item: ProviderBindingItem, checked: boolean) => {
    if (!resolvedActiveGroup || !config) return;
    const nextGroups = checked
      ? withGroup(item.groups, resolvedActiveGroup)
      : withoutGroup(item.groups, resolvedActiveGroup);
    const normalizedGroups = nextGroups.length > 0 ? nextGroups : undefined;
    setSavingProviderId(item.id);
    try {
      if (item.brand === 'gemini') {
        const next = [...(config.geminiApiKeys ?? [])];
        const current = next[item.index];
        if (!current) return;
        next[item.index] = { ...current, groups: normalizedGroups };
        await providersApi.saveGeminiKeys(next);
        updateConfigValue('gemini-api-key', next);
      } else if (item.brand === 'codex') {
        const next = [...(config.codexApiKeys ?? [])];
        const current = next[item.index];
        if (!current) return;
        next[item.index] = { ...current, groups: normalizedGroups };
        await providersApi.saveCodexConfigs(next);
        updateConfigValue('codex-api-key', next);
      } else if (item.brand === 'claude') {
        const next = [...(config.claudeApiKeys ?? [])];
        const current = next[item.index];
        if (!current) return;
        next[item.index] = { ...current, groups: normalizedGroups };
        await providersApi.saveClaudeConfigs(next);
        updateConfigValue('claude-api-key', next);
      } else if (item.brand === 'vertex') {
        const next = [...(config.vertexApiKeys ?? [])];
        const current = next[item.index];
        if (!current) return;
        next[item.index] = { ...current, groups: normalizedGroups };
        await providersApi.saveVertexConfigs(next);
        updateConfigValue('vertex-api-key', next);
      } else {
        const next = [...(config.openaiCompatibility ?? [])];
        const provider = next[item.index];
        const entryIndex = item.entryIndex ?? -1;
        const entry = provider?.apiKeyEntries?.[entryIndex];
        if (!provider || !entry) return;
        const entries = [...(provider.apiKeyEntries ?? [])];
        entries[entryIndex] = { ...entry, groups: normalizedGroups };
        next[item.index] = { ...provider, apiKeyEntries: entries };
        await providersApi.saveOpenAIProviders(next);
        updateConfigValue('openai-compatibility', next);
      }
    } catch (err: unknown) {
      showNotification(
        getErrorMessage(
          err,
          t('credential_groups_page.bind_failed', { defaultValue: '分组绑定失败' })
        ),
        'error'
      );
    } finally {
      setSavingProviderId(null);
    }
  };

  const updateApiKeyGroup = async (index: number, checked: boolean) => {
    if (!resolvedActiveGroup) return;
    const currentEntry = apiKeyEntries[index];
    if (!currentEntry) return;
    const nextGroups = checked
      ? withGroup(currentEntry.groups, resolvedActiveGroup)
      : withoutGroup(currentEntry.groups, resolvedActiveGroup);
    const nextEntries = apiKeyEntries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, groups: nextGroups } : entry
    );
    setSavingApiKeyIndex(index);
    try {
      await apiKeysApi.replaceEntries(nextEntries);
      setApiKeyEntries(nextEntries);
      await fetchConfig(undefined, true);
    } catch (err: unknown) {
      showNotification(
        getErrorMessage(
          err,
          t('credential_groups_page.bind_failed', { defaultValue: '分组绑定失败' })
        ),
        'error'
      );
    } finally {
      setSavingApiKeyIndex(null);
    }
  };

  const renderSectionEmpty = (message: string) => (
    <div className={styles.sectionEmpty}>{message}</div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <h1 className={styles.pageTitle}>{t('credential_groups_page.title')}</h1>
          <span className={styles.countBadge}>
            {t('credential_groups_page.count', { count: groups.length })}
          </span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void loadGroups(true)}
          loading={refreshing}
        >
          <RefreshCw />
          {t('common.refresh')}
        </Button>
      </div>

      {loading ? (
        <Card className={styles.listCard}>
          <div className={styles.stateBox}>
            <LoadingSpinner size={24} />
            <span>{t('common.loading')}</span>
          </div>
        </Card>
      ) : loadError ? (
        <Card className={styles.listCard}>
          <div className={styles.errorBox}>{loadError}</div>
        </Card>
      ) : (
        <div className={styles.workbench}>
          <aside className={styles.sidebar}>
            <Card className={styles.createCard}>
              <form className={styles.createForm} onSubmit={(event) => void handleCreate(event)}>
                <Input
                  label={t('credential_groups_page.name_label')}
                  value={nameInput}
                  onChange={(event) => {
                    setNameInput(event.target.value);
                    if (nameError) setNameError('');
                  }}
                  placeholder={t('credential_groups_page.name_placeholder')}
                  error={nameError}
                  autoComplete="off"
                />
                <Button type="submit" loading={creating} disabled={!nameInput.trim()}>
                  <Plus />
                  {t('credential_groups_page.create')}
                </Button>
              </form>
            </Card>

            <Card className={styles.listCard}>
              {sortedGroups.length === 0 ? (
                <EmptyState
                  title={t('credential_groups_page.empty_title')}
                  description={t('credential_groups_page.empty_desc')}
                />
              ) : (
                <div className={styles.groupList}>
                  {sortedGroups.map((name) => {
                    const usage = usageByGroup.get(groupKey(name)) ?? emptyUsage();
                    const selected = groupKey(name) === groupKey(resolvedActiveGroup);
                    return (
                      <button
                        type="button"
                        className={`${styles.groupRow} ${selected ? styles.groupRowActive : ''}`}
                        key={name}
                        onClick={() => setActiveGroup(name)}
                      >
                        <span className={styles.groupName}>{name}</span>
                        <span className={styles.groupUsage}>
                          {usage.authFiles + usage.providers + usage.apiKeys}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </aside>

          <main className={styles.detailPane}>
            {!resolvedActiveGroup ? (
              <Card className={styles.listCard}>
                <EmptyState
                  title={t('credential_groups_page.empty_title')}
                  description={t('credential_groups_page.empty_desc')}
                />
              </Card>
            ) : (
              <>
                <Card className={styles.detailHeaderCard}>
                  <div className={styles.detailHeader}>
                    <div className={styles.detailTitleBlock}>
                      <span className={styles.detailEyebrow}>
                        {t('credential_groups_page.detail_label', {
                          defaultValue: '当前分组',
                        })}
                      </span>
                      <h2 className={styles.detailTitle}>{resolvedActiveGroup}</h2>
                    </div>
                    <div className={styles.detailActions}>
                      <div className={styles.usagePills}>
                        <span>
                          {t('credential_groups_page.auth_files_count', {
                            defaultValue: '认证文件 {{count}}',
                            count: activeUsage.authFiles,
                          })}
                        </span>
                        <span>
                          {t('credential_groups_page.providers_count', {
                            defaultValue: 'AI 供应商 {{count}}',
                            count: activeUsage.providers,
                          })}
                        </span>
                        <span>
                          {t('credential_groups_page.api_keys_count', {
                            defaultValue: 'API Key {{count}}',
                            count: activeUsage.apiKeys,
                          })}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => confirmDelete(resolvedActiveGroup)}
                        loading={deletingName === resolvedActiveGroup}
                      >
                        <Trash2 />
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                </Card>

                <div
                  className={styles.providerRail}
                  aria-label={t('credential_groups_page.provider_filter', {
                    defaultValue: '供应商过滤',
                  })}
                >
                  <div className={styles.providerRailHeader}>
                    <span>
                      {t('credential_groups_page.provider_filter', {
                        defaultValue: '供应商过滤',
                      })}
                    </span>
                    <span>
                      {t('credential_groups_page.active_provider', {
                        defaultValue: '当前：{{name}}',
                        name:
                          activeProviderFacet?.key === ALL_PROVIDERS_KEY
                            ? t('credential_groups_page.provider_all', {
                                defaultValue: '全部供应商',
                              })
                            : activeProviderFacet?.label,
                      })}
                    </span>
                  </div>
                  <div className={styles.providerList} role="group">
                    {providerFacets.map((facet) => {
                      const selected = facet.key === resolvedActiveProviderKey;
                      const label =
                        facet.key === ALL_PROVIDERS_KEY
                          ? t('credential_groups_page.provider_all', {
                              defaultValue: '全部供应商',
                            })
                          : facet.label;
                      return (
                        <button
                          type="button"
                          key={facet.key}
                          className={`${styles.providerTab} ${
                            selected ? styles.providerTabActive : ''
                          }`}
                          aria-pressed={selected}
                          onClick={() => setActiveProviderKey(facet.key)}
                        >
                          <span className={styles.providerTabMain}>
                            <span className={styles.providerTabLabel}>{label}</span>
                            <span className={styles.providerTabCount}>{facet.total}</span>
                          </span>
                          <span className={styles.providerTabMeta}>
                            {compactText(
                              t('credential_groups_page.provider_auth_count', {
                                defaultValue: '认证 {{count}}',
                                count: facet.authFiles,
                              }),
                              t('credential_groups_page.provider_config_count', {
                                defaultValue: '供应商 {{count}}',
                                count: facet.providers,
                              }),
                              t('credential_groups_page.provider_api_key_count', {
                                defaultValue: 'API {{count}}',
                                count: facet.apiKeys,
                              })
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.searchBar}>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('credential_groups_page.search_placeholder', {
                      defaultValue: '搜索凭证、供应商、API Key',
                    })}
                    rightElement={<Search size={16} />}
                    autoComplete="off"
                  />
                </div>

                <Card
                  className={styles.bindingCard}
                  title={
                    <span className={styles.cardTitle}>
                      <FileKey2 />
                      {t('credential_groups_page.auth_files_section', {
                        defaultValue: '认证文件',
                      })}
                    </span>
                  }
                  extra={
                    <div className={styles.sectionHeaderControls}>
                      <BindingFilterControl
                        value={authFilesFilter}
                        onChange={setAuthFilesFilter}
                        labels={bindingFilterLabels}
                      />
                      <span className={styles.sectionCount}>{filteredAuthFiles.length}</span>
                    </div>
                  }
                >
                  <div className={styles.bindingList}>
                    {filteredAuthFiles.length === 0
                      ? renderSectionEmpty(
                          t('credential_groups_page.no_auth_files', {
                            defaultValue: '没有匹配的认证文件',
                          })
                        )
                      : filteredAuthFiles.map((item) => {
                          const file = item.file;
                          const checked = hasGroup(file.groups, resolvedActiveGroup);
                          const fileGroups = normalizeCredentialGroups(file.groups);
                          return (
                            <div className={styles.bindingRow} key={file.name}>
                              <SelectionCheckbox
                                checked={checked}
                                disabled={savingAuthFileName === file.name}
                                onChange={(next) => void updateAuthFileGroup(file, next)}
                                ariaLabel={t('credential_groups_page.toggle_auth_file', {
                                  defaultValue: '切换认证文件分组绑定',
                                })}
                              />
                              <div className={styles.bindingMeta}>
                                <div className={styles.bindingTitle}>{file.name}</div>
                                <div className={styles.bindingSubtitle}>
                                  {compactText(
                                    file.alias,
                                    item.providerLabel,
                                    item.providerKey &&
                                      item.providerLabel.toLowerCase() !==
                                        item.providerKey.toLowerCase()
                                      ? item.providerKey
                                      : '',
                                    file.disabled
                                      ? t('common.disabled', { defaultValue: '已停用' })
                                      : ''
                                  )}
                                </div>
                                <GroupChips
                                  groups={fileGroups}
                                  emptyText={t('credential_groups_page.no_groups', {
                                    defaultValue: '未分组',
                                  })}
                                />
                              </div>
                            </div>
                          );
                        })}
                  </div>
                </Card>

                <Card
                  className={styles.bindingCard}
                  title={
                    <span className={styles.cardTitle}>
                      <Bot />
                      {t('credential_groups_page.providers_section', {
                        defaultValue: 'AI 供应商凭证',
                      })}
                    </span>
                  }
                  extra={
                    <div className={styles.sectionHeaderControls}>
                      <BindingFilterControl
                        value={providersFilter}
                        onChange={setProvidersFilter}
                        labels={bindingFilterLabels}
                      />
                      <span className={styles.sectionCount}>{filteredProviderItems.length}</span>
                    </div>
                  }
                >
                  <div className={styles.bindingList}>
                    {filteredProviderItems.length === 0
                      ? renderSectionEmpty(
                          t('credential_groups_page.no_providers', {
                            defaultValue: '没有匹配的 AI 供应商凭证',
                          })
                        )
                      : filteredProviderItems.map((item) => {
                          const checked = hasGroup(item.groups, resolvedActiveGroup);
                          return (
                            <div className={styles.bindingRow} key={item.id}>
                              <SelectionCheckbox
                                checked={checked}
                                disabled={savingProviderId === item.id}
                                onChange={(next) => void updateProviderGroup(item, next)}
                                ariaLabel={t('credential_groups_page.toggle_provider', {
                                  defaultValue: '切换 AI 供应商分组绑定',
                                })}
                              />
                              <div className={styles.bindingMeta}>
                                <div className={styles.bindingTitle}>{item.title}</div>
                                <div className={styles.bindingSubtitle}>
                                  {compactText(item.providerLabel, item.subtitle)}
                                </div>
                                <GroupChips
                                  groups={item.groups}
                                  emptyText={t('credential_groups_page.no_groups', {
                                    defaultValue: '未分组',
                                  })}
                                />
                              </div>
                            </div>
                          );
                        })}
                  </div>
                </Card>

                <Card
                  className={styles.bindingCard}
                  title={
                    <span className={styles.cardTitle}>
                      <KeyRound />
                      {t('credential_groups_page.api_keys_section', {
                        defaultValue: '下游 API Key',
                      })}
                    </span>
                  }
                  extra={
                    <div className={styles.sectionHeaderControls}>
                      <BindingFilterControl
                        value={apiKeysFilter}
                        onChange={setApiKeysFilter}
                        labels={bindingFilterLabels}
                      />
                      <span className={styles.sectionCount}>{filteredApiKeyEntries.length}</span>
                    </div>
                  }
                >
                  <div className={styles.bindingList}>
                    {filteredApiKeyEntries.length === 0
                      ? renderSectionEmpty(
                          t('credential_groups_page.no_api_keys', {
                            defaultValue: '没有匹配的 API Key',
                          })
                        )
                      : filteredApiKeyEntries.map(({ entry, index }) => {
                          const checked = hasGroup(entry.groups, resolvedActiveGroup);
                          return (
                            <div className={styles.bindingRow} key={`${entry.key}-${index}`}>
                              <SelectionCheckbox
                                checked={checked}
                                disabled={savingApiKeyIndex === index}
                                onChange={(next) => void updateApiKeyGroup(index, next)}
                                ariaLabel={t('credential_groups_page.toggle_api_key', {
                                  defaultValue: '切换 API Key 分组绑定',
                                })}
                              />
                              <div className={styles.bindingMeta}>
                                <div className={styles.bindingTitle}>{maskApiKey(entry.key)}</div>
                                <div className={styles.bindingSubtitle}>
                                  {entry.groups.length > 0
                                    ? t('credential_groups_page.api_key_group_limited', {
                                        defaultValue: '指定分组',
                                      })
                                    : t('credential_groups_page.api_key_all_credentials', {
                                        defaultValue: '全部凭证',
                                      })}
                                </div>
                                <GroupChips
                                  groups={entry.groups}
                                  emptyText={t('credential_groups_page.no_groups', {
                                    defaultValue: '全部凭证',
                                  })}
                                />
                              </div>
                            </div>
                          );
                        })}
                  </div>
                </Card>

                {activeUsageTotal === 0 ? null : (
                  <div className={styles.deleteHint}>
                    {t('credential_groups_page.delete_usage_hint', {
                      defaultValue: '删除分组前需要先解除所有绑定。',
                    })}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
