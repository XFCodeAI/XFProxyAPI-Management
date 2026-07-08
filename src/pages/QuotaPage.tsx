import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { TooltipButton } from '@/components/ui/TooltipControls';
import { IconRefreshCw, IconSettings, IconSidebarOauth } from '@/components/ui/icons';
import { QuotaAuthSettingsDialog } from '@/components/quota/QuotaAuthSettingsDialog';
import { QuotaOAuthDialog } from '@/components/quota/QuotaOAuthDialog';
import { ProxySelectionModal } from '@/components/proxy/ProxySelectionModal';
import {
  QuotaCard,
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesGroupAssignmentModal } from '@/features/authFiles/components/AuthFilesGroupAssignmentModal';
import { AuthImportModal } from '@/features/authFiles/components/AuthImportModal';
import { AuthSessionImportResultModal } from '@/features/authFiles/components/AuthSessionImportResultModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';
import { getPluginTitle } from '@/features/plugins/pluginResources';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useOAuthProviderFlow } from '@/hooks/useOAuthProviderFlow';
import { authFilesApi, pluginsApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { AuthFileItem, PluginListEntry, ProxySelection } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { parseTimestampMs } from '@/utils/timestamp';
import { readNavigationPreference, writeNavigationPreference } from '@/utils/navigationPreference';
import { resolveAuthProvider } from '@/utils/quota';
import styles from './QuotaPage.module.scss';

type BuiltInQuotaProviderId = 'claude' | 'antigravity' | 'codex' | 'xai' | 'kimi';

interface BaseQuotaProviderDefinition {
  id: string;
  oauthProviderId: string;
  config: {
    filterFn: (file: AuthFileItem) => boolean;
  };
}

interface BuiltInQuotaProviderDefinition extends BaseQuotaProviderDefinition {
  kind: 'builtin';
  id: BuiltInQuotaProviderId;
  labelKey: string;
}

interface PluginQuotaProviderDefinition extends BaseQuotaProviderDefinition {
  kind: 'plugin';
  label: string;
  pluginId: string;
}

type QuotaProviderDefinition = BuiltInQuotaProviderDefinition | PluginQuotaProviderDefinition;

type QuotaProviderSummary = QuotaProviderDefinition & {
  credentialCount: number;
};

const EMPTY_AUTH_FILE_ITEMS: AuthFileItem[] = [];
const QUOTA_ACTIVE_PROVIDER_STORAGE_KEY = 'quotaPage.activeProvider';

const createProviderFilter = (providerId: string) => (file: AuthFileItem) =>
  resolveAuthProvider(file) === providerId;

const createPluginProviderId = (providerId: string) => `plugin:${providerId}`;

const readAuthFileTime = (file: AuthFileItem): number => {
  const candidates = [file.modified, file.modtime, file.updated_at, file.lastRefresh];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate < 1e12 ? candidate * 1000 : candidate;
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric < 1e12 ? numeric * 1000 : numeric;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const buildOAuthCredentialSignature = (file: AuthFileItem): string =>
  JSON.stringify({
    authIndex: file.authIndex ?? file.auth_index ?? null,
    disabled: file.disabled ?? null,
    modified: readAuthFileTime(file),
    size: file.size ?? null,
    status: file.status ?? null,
    statusMessage: file.statusMessage ?? null,
    unavailable: file.unavailable ?? null,
  });

const resolveOAuthGroupAssignmentTargets = (
  provider: QuotaProviderDefinition,
  beforeFiles: AuthFileItem[],
  afterFiles: AuthFileItem[]
): AuthFileItem[] => {
  const beforeProviderFiles = beforeFiles.filter(provider.config.filterFn);
  const afterProviderFiles = afterFiles
    .filter(provider.config.filterFn)
    .filter((file) => !isRuntimeOnlyAuthFile(file));
  const beforeSignatures = new Map(
    beforeProviderFiles.map((file) => [file.name, buildOAuthCredentialSignature(file)])
  );
  const changedFiles = afterProviderFiles.filter(
    (file) => beforeSignatures.get(file.name) !== buildOAuthCredentialSignature(file)
  );

  if (changedFiles.length > 0) return changedFiles;
  if (afterProviderFiles.length <= 1) return afterProviderFiles;

  const [latest] = [...afterProviderFiles].sort(
    (left, right) => readAuthFileTime(right) - readAuthFileTime(left)
  );
  return latest ? [latest] : [];
};

const QUOTA_PROVIDERS: BuiltInQuotaProviderDefinition[] = [
  {
    kind: 'builtin',
    id: 'claude',
    labelKey: 'quota_management.providers.claude',
    oauthProviderId: 'anthropic',
    config: CLAUDE_CONFIG,
  },
  {
    kind: 'builtin',
    id: 'antigravity',
    labelKey: 'quota_management.providers.antigravity',
    oauthProviderId: 'antigravity',
    config: ANTIGRAVITY_CONFIG,
  },
  {
    kind: 'builtin',
    id: 'codex',
    labelKey: 'quota_management.providers.codex',
    oauthProviderId: 'codex',
    config: CODEX_CONFIG,
  },
  {
    kind: 'builtin',
    id: 'xai',
    labelKey: 'quota_management.providers.xai',
    oauthProviderId: 'xai',
    config: XAI_CONFIG,
  },
  {
    kind: 'builtin',
    id: 'kimi',
    labelKey: 'quota_management.providers.kimi',
    oauthProviderId: 'kimi',
    config: KIMI_CONFIG,
  },
];

const BUILTIN_OAUTH_PROVIDER_IDS = new Set(
  QUOTA_PROVIDERS.map((provider) => provider.oauthProviderId)
);

const buildPluginQuotaProviders = (plugins: PluginListEntry[]): PluginQuotaProviderDefinition[] => {
  const seenProviders = new Set(BUILTIN_OAUTH_PROVIDER_IDS);
  return plugins.flatMap((plugin) => {
    const oauthProviderId = plugin.oauthProvider;
    if (
      !plugin.supportsOAuth ||
      !plugin.effectiveEnabled ||
      !oauthProviderId ||
      seenProviders.has(oauthProviderId)
    ) {
      return [];
    }

    seenProviders.add(oauthProviderId);
    return [
      {
        kind: 'plugin' as const,
        id: createPluginProviderId(oauthProviderId),
        label: getPluginTitle(plugin),
        oauthProviderId,
        pluginId: plugin.id,
        config: {
          filterFn: createProviderFilter(oauthProviderId),
        },
      },
    ];
  });
};

const isPluginProvider = (
  provider: QuotaProviderDefinition
): provider is PluginQuotaProviderDefinition => provider.kind === 'plugin';

interface QuotaPageProps {
  embedded?: boolean;
}

export function QuotaPage({ embedded = false }: QuotaPageProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    statusUpdating,
    uploadProxyDialogOpen,
    uploadProxySelection,
    uploadProxyPools,
    uploadProxyPoolsLoading,
    uploadProxyInspection,
    sessionImportResult,
    groupAssignment,
    groupAssigning,
    groupAssignmentError,
    fileInputRef,
    loadFiles,
    beginFileImport,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
    batchStatusUpdating,
    setUploadProxySelection,
    refreshUploadProxyPools,
    confirmUploadProxySelection,
    cancelUploadProxySelection,
    clearSessionImportResult,
    openCredentialGroupAssignment,
    closeCredentialGroupAssignment,
    confirmCredentialGroupAssignment,
  } = useAuthFilesData();
  const [pluginProviders, setPluginProviders] = useState<PluginQuotaProviderDefinition[]>([]);
  const [pluginProvidersLoaded, setPluginProvidersLoaded] = useState(false);
  const [excludedModels, setExcludedModels] = useState<Record<string, string[]>>({});
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(() =>
    readNavigationPreference(QUOTA_ACTIVE_PROVIDER_STORAGE_KEY)
  );
  const [oauthDialogProviderId, setOauthDialogProviderId] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [authSettingsOpen, setAuthSettingsOpen] = useState(false);
  const [visibleQuotaCredentials, setVisibleQuotaCredentials] = useState<{
    providerId: string;
    files: AuthFileItem[];
  }>({ providerId: '', files: EMPTY_AUTH_FILE_ITEMS });
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const oauthCredentialSnapshotRef = useRef<Record<string, AuthFileItem[]>>({});

  const disableControls = connectionStatus !== 'connected';
  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();
  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({ disableControls, loadFiles });

  const quotaProviders = useMemo<QuotaProviderDefinition[]>(
    () => [...QUOTA_PROVIDERS, ...pluginProviders],
    [pluginProviders]
  );

  const providerSummaries = useMemo<QuotaProviderSummary[]>(
    () =>
      quotaProviders.map((provider) => ({
        ...provider,
        credentialCount: files.filter(provider.config.filterFn).length,
      })),
    [files, quotaProviders]
  );

  const defaultProviderId =
    providerSummaries.find((provider) => provider.credentialCount > 0)?.id ??
    providerSummaries[0].id;
  const activeProviderId = selectedProviderId ?? defaultProviderId;
  const activeProvider =
    providerSummaries.find((provider) => provider.id === activeProviderId) ?? providerSummaries[0];
  const activeProviderCredentials = useMemo(
    () => files.filter(activeProvider.config.filterFn),
    [activeProvider, files]
  );
  const visibleCredentialFiles =
    activeProvider.kind === 'plugin'
      ? activeProviderCredentials
      : visibleQuotaCredentials.providerId === activeProvider.id
        ? visibleQuotaCredentials.files
        : EMPTY_AUTH_FILE_ITEMS;
  const selectableVisibleCredentialFiles = useMemo(
    () => visibleCredentialFiles.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [visibleCredentialFiles]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const getProviderLabel = useCallback(
    (provider: QuotaProviderDefinition) =>
      provider.kind === 'plugin' ? provider.label : t(provider.labelKey),
    [t]
  );

  const loadPluginProviders = useCallback(async () => {
    setPluginProvidersLoaded(false);
    if (connectionStatus !== 'connected' || !supportsPlugin) {
      setPluginProviders([]);
      setPluginProvidersLoaded(true);
      return;
    }

    try {
      const response = await pluginsApi.list();
      setPluginProviders(buildPluginQuotaProviders(response.plugins));
    } catch {
      setPluginProviders([]);
    } finally {
      setPluginProvidersLoaded(true);
    }
  }, [connectionStatus, supportsPlugin]);

  const loadExcludedModels = useCallback(async () => {
    try {
      const excluded = await authFilesApi.getOauthExcludedModels();
      setExcludedModels(excluded || {});
    } catch {
      setExcludedModels({});
    }
  }, []);

  const refreshQuotaPage = useCallback(async () => {
    const [nextFiles] = await Promise.all([
      loadFiles(),
      loadPluginProviders(),
      loadExcludedModels(),
    ]);
    return nextFiles;
  }, [loadFiles, loadPluginProviders, loadExcludedModels]);

  const showCredentialModels = useCallback(
    (item: AuthFileItem) => {
      void showModels(item);
    },
    [showModels]
  );

  const openCredentialSettings = useCallback(
    (item: AuthFileItem) => {
      void openPrefixProxyEditor(item);
    },
    [openPrefixProxyEditor]
  );

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const oauthProviderDetails = useMemo(() => {
    const details = new Map<string, { label: string; pluginProvider: boolean }>();
    providerSummaries.forEach((provider) => {
      details.set(provider.oauthProviderId, {
        label: getProviderLabel(provider),
        pluginProvider: isPluginProvider(provider),
      });
    });
    return details;
  }, [getProviderLabel, providerSummaries]);

  const getOAuthText = useCallback(
    (provider: string, suffix: string) => {
      const details = oauthProviderDetails.get(provider);
      if (details?.pluginProvider) {
        return t(`auth_login.plugin_${suffix}`, { name: details.label });
      }
      const key = `auth_login.${provider}_${suffix}`;
      const translated = t(key);
      return translated === key
        ? t(`auth_login.plugin_${suffix}`, { name: details?.label ?? provider })
        : translated;
    },
    [oauthProviderDetails, t]
  );

  const handleOAuthSuccess = useCallback(
    async (providerId: string) => {
      const quotaProvider = providerSummaries.find(
        (provider) => provider.oauthProviderId === providerId
      );
      const beforeFiles = oauthCredentialSnapshotRef.current[providerId] ?? files;
      const nextFiles = await refreshQuotaPage();
      delete oauthCredentialSnapshotRef.current[providerId];

      if (!quotaProvider) return;
      const targets = resolveOAuthGroupAssignmentTargets(quotaProvider, beforeFiles, nextFiles);
      if (targets.length > 0) {
        openCredentialGroupAssignment(targets, 'oauth');
      }
    },
    [files, openCredentialGroupAssignment, providerSummaries, refreshQuotaPage]
  );

  const handleVisibleQuotaCredentialsChange = useCallback(
    (items: AuthFileItem[]) => {
      setVisibleQuotaCredentials({ providerId: activeProvider.id, files: items });
    },
    [activeProvider.id]
  );

  const selectQuotaProvider = useCallback((providerId: string) => {
    setSelectedProviderId(providerId);
    writeNavigationPreference(QUOTA_ACTIVE_PROVIDER_STORAGE_KEY, providerId);
  }, []);

  const oauthFlow = useOAuthProviderFlow({
    getProviderText: getOAuthText,
    onSuccess: handleOAuthSuccess,
  });

  useActionBarHeightVar(floatingBatchActionsRef, '--quota-action-bar-height', selectionCount > 0);

  const handleHeaderRefresh = useCallback(async () => {
    await refreshQuotaPage();
  }, [refreshQuotaPage]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    void refreshQuotaPage();
  }, [refreshQuotaPage]);

  useEffect(() => {
    if (!pluginProvidersLoaded || !selectedProviderId) return;
    if (providerSummaries.some((provider) => provider.id === selectedProviderId)) return;
    setSelectedProviderId(defaultProviderId);
    writeNavigationPreference(QUOTA_ACTIVE_PROVIDER_STORAGE_KEY, defaultProviderId);
  }, [defaultProviderId, pluginProvidersLoaded, providerSummaries, selectedProviderId]);

  const oauthDialogProvider = oauthDialogProviderId
    ? (providerSummaries.find((provider) => provider.id === oauthDialogProviderId) ?? null)
    : null;

  const closeOAuthDialog = () => {
    if (oauthDialogProvider) {
      oauthFlow.cancelAuth(oauthDialogProvider.oauthProviderId);
    }
    setOauthDialogProviderId(null);
  };

  const openProviderOAuth = (provider: QuotaProviderSummary) => {
    if (disableControls) return;
    selectQuotaProvider(provider.id);
    oauthFlow.resetProviderAttempt(provider.oauthProviderId);
    setOauthDialogProviderId(provider.id);
  };

  const startProviderOAuth = (provider: QuotaProviderSummary, selection?: ProxySelection) => {
    oauthCredentialSnapshotRef.current[provider.oauthProviderId] = files.filter(
      provider.config.filterFn
    );
    void oauthFlow.startAuth(provider.oauthProviderId, selection);
  };

  const openAuthSettings = () => {
    setAuthSettingsOpen(true);
  };

  const closeAuthSettings = () => {
    setAuthSettingsOpen(false);
    void refreshQuotaPage();
  };

  const openImportModal = () => {
    if (disableControls || uploading) return;
    setImportModalOpen(true);
  };

  const closeImportModal = () => {
    if (uploading) return;
    setImportModalOpen(false);
  };

  const pickImportFiles = () => {
    handleUploadClick();
  };

  const importGeneratedFiles = (generatedFiles: File[]) => {
    beginFileImport(generatedFiles, { source: 'session' });
  };

  const renderOAuthAction = (provider: QuotaProviderSummary) => {
    const oauthState = oauthFlow.states[provider.oauthProviderId] || {};
    const providerLabel = getProviderLabel(provider);
    return (
      <TooltipButton
        variant="secondary"
        size="sm"
        className={styles.quotaHeaderOAuthButton}
        label={t('quota_management.oauth_login', { provider: providerLabel })}
        disabled={disableControls || oauthState.polling}
        loading={oauthState.polling}
        onClick={() => openProviderOAuth(provider)}
      >
        {!oauthState.polling && <IconSidebarOauth size={14} />}
        <span className={styles.quotaHeaderOAuthText}>{t('common.login')}</span>
      </TooltipButton>
    );
  };

  const sectionProps = {
    files,
    loading,
    disabled: disableControls,
    credentialActionDisabled: disableControls,
    selectedCredentialNames: selectedFiles,
    deletingCredentialName: deleting,
    credentialStatusUpdating: statusUpdating,
    onDownloadCredential: handleDownload,
    onShowCredentialModels: showCredentialModels,
    onOpenCredentialSettings: openCredentialSettings,
    onDeleteCredential: handleDelete,
    onToggleCredentialStatus: handleStatusToggle,
    onToggleCredentialSelect: toggleSelect,
    onVisibleCredentialsChange: handleVisibleQuotaCredentialsChange,
    headerActionAfterRefresh: renderOAuthAction(activeProvider),
  };

  const renderPluginPanel = (provider: QuotaProviderSummary & PluginQuotaProviderDefinition) => {
    const providerLabel = getProviderLabel(provider);
    const credentialFiles = files.filter(provider.config.filterFn);

    return (
      <Card
        title={t('auth_login.plugin_oauth_title', { name: providerLabel })}
        extra={
          <div className={styles.pluginHeaderActions}>
            <TooltipButton
              variant="secondary"
              size="sm"
              className={styles.refreshAllButton}
              onClick={() => void refreshQuotaPage()}
              disabled={disableControls || loading}
              loading={loading}
              label={t('quota_management.refresh_files')}
            >
              {!loading && <IconRefreshCw size={16} />}
            </TooltipButton>
            {renderOAuthAction(provider)}
          </div>
        }
      >
        {credentialFiles.length === 0 ? (
          <EmptyState
            title={t('auth_login.plugin_oauth_title', { name: providerLabel })}
            description={t('auth_login.plugin_oauth_hint', { name: providerLabel })}
          />
        ) : (
          <div className={styles.pluginCredentialGrid}>
            {credentialFiles.map((file) => (
              <QuotaCard
                key={file.name}
                item={file}
                i18nPrefix="quota_management"
                cardClassName={styles.pluginCredentialCard}
                defaultType={provider.oauthProviderId}
                actionDisabled={disableControls}
                selected={selectedFiles.has(file.name)}
                deletingCredentialName={deleting}
                credentialStatusUpdating={statusUpdating}
                onDownload={handleDownload}
                onShowModels={showCredentialModels}
                onOpenSettings={openCredentialSettings}
                onDelete={handleDelete}
                onToggleStatus={handleStatusToggle}
                onToggleSelect={toggleSelect}
                hideQuotaSection
                renderQuotaItems={() => null}
              />
            ))}
          </div>
        )}
      </Card>
    );
  };

  const activeQuotaSection = (() => {
    if (activeProvider.kind === 'plugin') {
      return renderPluginPanel(activeProvider);
    }

    switch (activeProvider.id) {
      case 'claude':
        return <QuotaSection key="claude" config={CLAUDE_CONFIG} {...sectionProps} />;
      case 'antigravity':
        return <QuotaSection key="antigravity" config={ANTIGRAVITY_CONFIG} {...sectionProps} />;
      case 'codex':
        return <QuotaSection key="codex" config={CODEX_CONFIG} {...sectionProps} />;
      case 'xai':
        return <QuotaSection key="xai" config={XAI_CONFIG} {...sectionProps} />;
      case 'kimi':
        return <QuotaSection key="kimi" config={KIMI_CONFIG} {...sectionProps} />;
    }
  })();

  return (
    <div className={`${styles.container} ${embedded ? styles.embeddedContainer : ''}`}>
      {!embedded && (
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.providerToolbar}>
        <div className={styles.providerTabs} aria-label={t('quota_management.providers_label')}>
          {providerSummaries.map((provider) => {
            const active = provider.id === activeProvider.id;
            const itemClassName = `${styles.providerTab} ${active ? styles.providerTabActive : ''}`;
            const providerLabel = getProviderLabel(provider);

            return (
              <button
                key={provider.id}
                type="button"
                className={itemClassName}
                onClick={() => selectQuotaProvider(provider.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={`${providerLabel}, ${t('quota_management.provider_credentials', {
                  count: provider.credentialCount,
                })}`}
              >
                <span>{providerLabel}</span>
                <span className={styles.providerCount}>{provider.credentialCount}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className={styles.uploadButton}
          onClick={openImportModal}
          disabled={disableControls || uploading}
          loading={uploading}
        >
          {!uploading && <Upload size={16} aria-hidden="true" />}
          <span>{t('auth_files.import_button', { defaultValue: '导入' })}</span>
        </Button>
        <TooltipButton
          variant="secondary"
          size="sm"
          className={styles.authSettingsButton}
          onClick={openAuthSettings}
          label={t('quota_management.auth_settings')}
        >
          <IconSettings size={16} />
        </TooltipButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          className={styles.hiddenFileInput}
          onChange={handleFileChange}
        />
      </div>

      <div className={styles.providerPanel}>{activeQuotaSection}</div>

      {selectionCount > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.credentialBatchBar} ref={floatingBatchActionsRef}>
              <span className={styles.credentialBatchText}>
                {t('auth_files.batch_selected', { count: selectionCount })}
              </span>
              <div className={styles.credentialBatchActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => selectAllVisible(visibleCredentialFiles)}
                  disabled={selectableVisibleCredentialFiles.length === 0}
                >
                  {t('auth_files.batch_select_page')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void batchDownload(selectedNames)}
                  disabled={disableControls || selectedNames.length === 0}
                >
                  {t('auth_files.batch_download')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => batchSetStatus(selectedNames, true)}
                  disabled={batchStatusButtonsDisabled}
                >
                  {t('auth_files.batch_enable')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => batchSetStatus(selectedNames, false)}
                  disabled={batchStatusButtonsDisabled}
                >
                  {t('auth_files.batch_disable')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => batchDelete(selectedNames)}
                  disabled={disableControls || selectedNames.length === 0}
                >
                  {t('common.delete')}
                </Button>
                <Button variant="ghost" size="sm" onClick={deselectAll}>
                  {t('auth_files.batch_deselect')}
                </Button>
              </div>
            </div>,
            document.body
          )
        : null}

      {oauthDialogProvider ? (
        <QuotaOAuthDialog
          open={Boolean(oauthDialogProvider)}
          providerLabel={getProviderLabel(oauthDialogProvider)}
          oauthProviderId={oauthDialogProvider.oauthProviderId}
          pluginProvider={isPluginProvider(oauthDialogProvider)}
          state={oauthFlow.states[oauthDialogProvider.oauthProviderId] || {}}
          onClose={closeOAuthDialog}
          onStart={(selection) => startProviderOAuth(oauthDialogProvider, selection)}
          onCopyLink={(url) => void oauthFlow.copyLink(url)}
          onSubmitCallback={() =>
            void oauthFlow.submitCallback(oauthDialogProvider.oauthProviderId)
          }
          onCallbackUrlChange={(value) =>
            oauthFlow.updateProviderState(oauthDialogProvider.oauthProviderId, {
              callbackUrl: value,
              callbackStatus: undefined,
              callbackError: undefined,
            })
          }
        />
      ) : null}
      <AuthImportModal
        open={importModalOpen}
        importing={uploading}
        onClose={closeImportModal}
        onPickFiles={pickImportFiles}
        onImportFiles={importGeneratedFiles}
      />
      <AuthSessionImportResultModal
        open={Boolean(sessionImportResult)}
        result={sessionImportResult}
        onClose={clearSessionImportResult}
      />
      <AuthFilesGroupAssignmentModal
        assignment={groupAssignment}
        open={Boolean(groupAssignment) && !sessionImportResult}
        saving={groupAssigning}
        error={groupAssignmentError}
        onClose={closeCredentialGroupAssignment}
        onConfirm={confirmCredentialGroupAssignment}
      />
      <ProxySelectionModal
        open={uploadProxyDialogOpen}
        title={t('proxy_selection.upload_title', { defaultValue: '选择认证文件代理' })}
        value={uploadProxySelection}
        pools={uploadProxyPools}
        loading={uploadProxyPoolsLoading}
        confirming={uploading}
        inspection={uploadProxyInspection}
        allowFileMode
        onChange={setUploadProxySelection}
        onRefresh={() => void refreshUploadProxyPools()}
        onCancel={cancelUploadProxySelection}
        onConfirm={() => void confirmUploadProxySelection()}
      />
      <QuotaAuthSettingsDialog open={authSettingsOpen} onClose={closeAuthSettings} />
      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excludedModels}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />
      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />
    </div>
  );
}
