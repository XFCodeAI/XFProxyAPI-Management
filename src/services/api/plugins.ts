import { apiClient } from './client';
import { configFileApi } from './configFile';
import { isRecord } from '@/utils/helpers';
import { isMap, parse as parseYaml, parseDocument } from 'yaml';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';
import type {
  PluginConfigField,
  PluginConfigObject,
  PluginDeleteResult,
  PluginListEntry,
  PluginListResponse,
  PluginMetadata,
  PluginMenu,
  PluginStoreEntry,
  PluginStoreInstallResult,
  PluginStorePlatform,
  PluginStoreResponse,
  PluginStoreSource,
  PluginStoreSourceError,
  PluginUploadResult,
} from '@/types';

type YamlDocument = ReturnType<typeof parseDocument>;

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const asBoolean = (value: unknown): boolean => value === true;

const normalizePluginOAuthProvider = (value: unknown): string | undefined => {
  const provider = normalizeManagementOAuthProviderKey(asString(value));
  return isManagementOAuthProviderKey(provider) ? provider : undefined;
};

const hasOwn = (source: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(source, key);

const normalizePluginSourceURL = (value: string): string => {
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid_plugin_source_url');
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('invalid_plugin_source_url');
  }
  return url;
};

const readPluginStoreSourcesFromYaml = (yamlContent: string): string[] => {
  const parsed = parseYaml(yamlContent);
  if (!isRecord(parsed)) return [];
  const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
  const sources = plugins['store-sources'];
  if (!Array.isArray(sources)) return [];
  return sources.map((item) => asString(item).trim()).filter(Boolean);
};

const ensureMapInDoc = (doc: YamlDocument, path: string[]): void => {
  const current = doc.getIn(path, true);
  if (isMap(current)) return;
  doc.setIn(path, doc.createNode({}));
};

const normalizeConfigField = (value: unknown): PluginConfigField | null => {
  if (!isRecord(value)) return null;
  const name = asString(value.name).trim();
  if (!name) return null;
  const enumValues = Array.isArray(value.enum_values)
    ? value.enum_values.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    name,
    type: asString(value.type).trim() || 'string',
    enumValues,
    description: asString(value.description).trim(),
  };
};

const normalizeConfigFields = (value: unknown): PluginConfigField[] =>
  Array.isArray(value)
    ? (value.map((item) => normalizeConfigField(item)).filter(Boolean) as PluginConfigField[])
    : [];

const normalizeMetadata = (value: unknown): PluginMetadata | null => {
  if (!isRecord(value)) return null;
  const name = asString(value.name).trim();
  const version = asString(value.version).trim();
  const author = asString(value.author).trim();
  const githubRepository = asString(value.github_repository).trim();
  const logo = asString(value.logo).trim();
  const configFields = normalizeConfigFields(value.config_fields);

  if (!name && !version && !author && !githubRepository && !logo && configFields.length === 0) {
    return null;
  }

  return {
    name,
    version,
    author,
    githubRepository,
    logo,
    configFields,
  };
};

const normalizeMenu = (value: unknown): PluginMenu | null => {
  if (!isRecord(value)) return null;
  const path = asString(value.path).trim();
  const menu = asString(value.menu).trim();
  if (!path && !menu) return null;
  return {
    path,
    menu,
    description: asString(value.description).trim(),
  };
};

const normalizeMenus = (value: unknown): PluginMenu[] =>
  Array.isArray(value)
    ? (value.map((item) => normalizeMenu(item)).filter(Boolean) as PluginMenu[])
    : [];

const normalizePluginEntry = (value: unknown): PluginListEntry | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  if (!id) return null;

  const metadata = normalizeMetadata(value.metadata);
  const configFields = normalizeConfigFields(value.config_fields);
  const supportsOAuth = asBoolean(value.supports_oauth);
  const oauthProvider = normalizePluginOAuthProvider(value.oauth_provider);
  const legacyOAuthProvider =
    supportsOAuth && !hasOwn(value, 'oauth_provider')
      ? normalizePluginOAuthProvider(id)
      : undefined;

  return {
    id,
    path: asString(value.path).trim(),
    configured: asBoolean(value.configured),
    registered: asBoolean(value.registered),
    enabled: value.enabled !== false,
    effectiveEnabled: asBoolean(value.effective_enabled),
    supportsOAuth,
    oauthProvider: oauthProvider ?? legacyOAuthProvider,
    logo: asString(value.logo || metadata?.logo).trim(),
    configFields: configFields.length > 0 ? configFields : (metadata?.configFields ?? []),
    menus: normalizeMenus(value.menus),
    metadata,
    ownedAuthFiles: Math.max(0, Math.floor(Number(value.owned_auth_files) || 0)),
    missingBinary: asBoolean(value.missing_binary),
    status: asString(value.status).trim(),
  };
};

const normalizePluginList = (value: unknown): PluginListResponse => {
  const source = isRecord(value) ? value : {};
  const plugins = Array.isArray(source.plugins)
    ? (source.plugins
        .map((item) => normalizePluginEntry(item))
        .filter(Boolean) as PluginListEntry[])
    : [];

  return {
    pluginsEnabled: asBoolean(source.plugins_enabled),
    pluginsDir: asString(source.plugins_dir).trim() || 'plugins',
    pluginsDirPath: asString(source.plugins_dir_path).trim(),
    pluginsDirExists: asBoolean(source.plugins_dir_exists),
    ownershipRecords: Math.max(0, Math.floor(Number(source.ownership_records) || 0)),
    plugins,
  };
};

const normalizePluginConfig = (value: unknown): PluginConfigObject =>
  isRecord(value) ? { ...value } : {};

const normalizeDeleteResult = (value: unknown): PluginDeleteResult => {
  const source = isRecord(value) ? value : {};
  return {
    status: asString(source.status).trim(),
    id: asString(source.id).trim(),
    path: asString(source.path).trim(),
    fileDeleted: asBoolean(source.file_deleted),
    configuredRemoved: asBoolean(source.configured_removed),
    restartRequired: asBoolean(source.restart_required),
  };
};

const normalizeUploadResult = (value: unknown): PluginUploadResult => {
  const source = isRecord(value) ? value : {};
  return {
    status: asString(source.status).trim(),
    id: asString(source.id).trim(),
    version: asString(source.version).trim(),
    path: asString(source.path).trim(),
    bytes: Number.isFinite(Number(source.bytes)) ? Number(source.bytes) : 0,
    overwritten: asBoolean(source.overwritten),
    pluginsEnabled: asBoolean(source.plugins_enabled),
    restartRequired: asBoolean(source.restart_required),
  };
};

export const normalizeStoreEntry = (value: unknown): PluginStoreEntry | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  if (!id) return null;
  const sourceId = asString(value.source_id).trim();
  const storeId = asString(value.store_id).trim() || (sourceId ? `${sourceId}/${id}` : id);

  const tags = Array.isArray(value.tags)
    ? value.tags.map((item) => asString(item).trim()).filter(Boolean)
    : [];
  const platforms = Array.isArray(value.platforms)
    ? (value.platforms
        .map((item): PluginStorePlatform | null => {
          if (!isRecord(item)) return null;
          const goos = asString(item.goos).trim();
          const goarch = asString(item.goarch).trim();
          return goos || goarch ? { goos, goarch } : null;
        })
        .filter(Boolean) as PluginStorePlatform[])
    : [];

  return {
    storeId,
    sourceId,
    sourceName: asString(value.source_name).trim(),
    sourceUrl: asString(value.source_url).trim(),
    id,
    name: asString(value.name).trim(),
    description: asString(value.description).trim(),
    author: asString(value.author).trim(),
    version: asString(value.version).trim(),
    repository: asString(value.repository).trim(),
    installType: asString(value.install_type).trim(),
    authRequired: asBoolean(value.auth_required),
    authConfigured: asBoolean(value.auth_configured),
    platforms,
    logo: asString(value.logo).trim(),
    homepage: asString(value.homepage).trim(),
    license: asString(value.license).trim(),
    tags,
    installed: asBoolean(value.installed),
    installedVersion: asString(value.installed_version).trim(),
    installedSourceId: asString(value.installed_source_id).trim(),
    installSourceStatus: asString(value.install_source_status).trim(),
    path: asString(value.path).trim(),
    configured: asBoolean(value.configured),
    registered: asBoolean(value.registered),
    enabled: asBoolean(value.enabled),
    effectiveEnabled: asBoolean(value.effective_enabled),
    updateAvailable: asBoolean(value.update_available),
  };
};

const normalizeStoreSourceError = (value: unknown): PluginStoreSourceError | null => {
  if (!isRecord(value)) return null;
  const sourceId = asString(value.source_id).trim();
  const sourceUrl = asString(value.source_url).trim();
  const message = asString(value.message).trim();
  if (!sourceId && !sourceUrl && !message) return null;
  return {
    sourceId,
    sourceName: asString(value.source_name).trim(),
    sourceUrl,
    message,
  };
};

const normalizeStoreSource = (value: unknown): PluginStoreSource | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  const url = asString(value.url).trim();
  if (!id && !url) return null;
  return {
    id,
    name: asString(value.name).trim(),
    url,
  };
};

export const normalizeStoreList = (value: unknown): PluginStoreResponse => {
  const source = isRecord(value) ? value : {};
  const plugins = Array.isArray(source.plugins)
    ? (source.plugins
        .map((item) => normalizeStoreEntry(item))
        .filter(Boolean) as PluginStoreEntry[])
    : [];
  const sources = Array.isArray(source.sources)
    ? (source.sources
        .map((item) => normalizeStoreSource(item))
        .filter(Boolean) as PluginStoreSource[])
    : [];
  const sourceErrors = Array.isArray(source.source_errors)
    ? (source.source_errors
        .map((item) => normalizeStoreSourceError(item))
        .filter(Boolean) as PluginStoreSourceError[])
    : [];

  return {
    pluginsEnabled: asBoolean(source.plugins_enabled),
    pluginsDir: asString(source.plugins_dir).trim() || 'plugins',
    sources,
    sourceErrors,
    plugins,
  };
};

export const normalizeInstallResult = (value: unknown): PluginStoreInstallResult => {
  const source = isRecord(value) ? value : {};
  return {
    status: asString(source.status).trim(),
    sourceId: asString(source.source_id).trim(),
    sourceName: asString(source.source_name).trim(),
    sourceUrl: asString(source.source_url).trim(),
    id: asString(source.id).trim(),
    version: asString(source.version).trim(),
    installType: asString(source.install_type).trim(),
    path: asString(source.path).trim(),
    pluginsEnabled: asBoolean(source.plugins_enabled),
    restartRequired: asBoolean(source.restart_required),
  };
};

export interface PluginStoreInstallOptions {
  sourceId?: string;
  version?: string;
}

export const buildPluginStoreInstallRequest = (
  id: string,
  options: PluginStoreInstallOptions = {}
): { url: string; body: { version: string } | undefined } => {
  const path = `/plugin-store/${encodeURIComponent(id)}/install`;
  const params = new URLSearchParams();
  const sourceId = options.sourceId?.trim();
  const version = options.version?.trim();
  if (sourceId) params.set('source', sourceId);
  if (version) params.set('version', version);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return {
    url: `${path}${query}`,
    body: version ? { version } : undefined,
  };
};

export const pluginsApi = {
  async list(): Promise<PluginListResponse> {
    const data = await apiClient.get('/plugins');
    return normalizePluginList(data);
  },

  updateEnabled: (id: string, enabled: boolean) =>
    apiClient.patch(`/plugins/${encodeURIComponent(id)}/enabled`, { enabled }),

  async deletePlugin(id: string): Promise<PluginDeleteResult> {
    const data = await apiClient.delete(`/plugins/${encodeURIComponent(id)}`);
    return normalizeDeleteResult(data);
  },

  async uploadPlugin(
    file: File,
    options: { overwrite?: boolean } = {}
  ): Promise<PluginUploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    if (options.overwrite) {
      formData.append('overwrite', 'true');
    }
    const data = await apiClient.postForm('/plugins/upload', formData);
    return normalizeUploadResult(data);
  },

  async getConfig(id: string): Promise<PluginConfigObject> {
    const data = await apiClient.get(`/plugins/${encodeURIComponent(id)}/config`);
    return normalizePluginConfig(data);
  },

  patchConfig: (id: string, patch: PluginConfigObject) =>
    apiClient.patch(`/plugins/${encodeURIComponent(id)}/config`, patch),
};

export const pluginStoreApi = {
  async list(): Promise<PluginStoreResponse> {
    const data = await apiClient.get('/plugin-store');
    return normalizeStoreList(data);
  },

  async install(
    id: string,
    options: PluginStoreInstallOptions = {}
  ): Promise<PluginStoreInstallResult> {
    const request = buildPluginStoreInstallRequest(id, options);
    const data = await apiClient.post(request.url, request.body);
    return normalizeInstallResult(data);
  },

  async addSource(url: string): Promise<{ url: string; added: boolean }> {
    const normalizedURL = normalizePluginSourceURL(url);
    const yamlContent = await configFileApi.fetchConfigYaml();
    const currentSources = readPluginStoreSourcesFromYaml(yamlContent);
    if (currentSources.some((source) => source.trim() === normalizedURL)) {
      return { url: normalizedURL, added: false };
    }

    const doc = parseDocument(yamlContent);
    if (doc.errors.length > 0) {
      throw new Error(doc.errors[0]?.message || 'invalid_yaml');
    }
    if (!isMap(doc.contents)) {
      doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
    }

    ensureMapInDoc(doc, ['plugins']);
    doc.setIn(['plugins', 'store-sources'], [...currentSources, normalizedURL]);
    await configFileApi.saveConfigYaml(
      doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 })
    );
    return { url: normalizedURL, added: true };
  },
};
