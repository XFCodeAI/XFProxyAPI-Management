import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { TooltipButton } from '@/components/ui/TooltipControls';
import { inputClass } from '@/components/ui/formStyles';
import { IconInfo, IconX } from '@/components/ui/icons';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthInventoryStore, useAuthStore, useNotificationStore } from '@/stores';
import { cn } from '@/lib/utils';
import { authFilesApi } from '@/services/api';
import {
  buildOAuthProviderOptions,
  getTypeLabel,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import {
  getModelAliasDraftSignature,
  isOAuthEditorDirty,
} from '@/features/authFiles/oauthEditorState';
import type { OAuthModelAliasEntry } from '@/types';
import { generateId, getErrorMessage } from '@/utils/helpers';
import styles from './AuthFilesOAuthModelAliasEditPage.module.scss';

type AuthFileModelItem = { id: string; display_name?: string; type?: string; owned_by?: string };

type LocationState = { fromAuthFiles?: boolean } | null;

type OAuthModelAliasDraftEntry = OAuthModelAliasEntry & {
  displayName?: string;
  forceMapping?: boolean;
};

type OAuthModelMappingFormEntry = OAuthModelAliasDraftEntry & { id: string };

const buildEmptyMappingEntry = (): OAuthModelMappingFormEntry => ({
  id: generateId(),
  name: '',
  alias: '',
  fork: true,
});

const normalizeMappingEntries = (
  entries?: OAuthModelAliasEntry[]
): OAuthModelMappingFormEntry[] => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [buildEmptyMappingEntry()];
  }
  return entries.map((entry) => {
    const draft = entry as OAuthModelAliasDraftEntry;
    return {
      id: generateId(),
      name: entry.name ?? '',
      alias: entry.alias ?? '',
      fork: Boolean(entry.fork),
      displayName: draft.displayName,
      forceMapping: draft.forceMapping,
    };
  });
};

export type AuthFilesOAuthModelAliasEditPageProps = {
  embedded?: boolean;
  initialProvider?: string;
  onClose?: () => void;
  onSaved?: () => void;
};

export function AuthFilesOAuthModelAliasEditPage({
  embedded = false,
  initialProvider,
  onClose,
  onSaved,
}: AuthFilesOAuthModelAliasEditPageProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showConfirmation, showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const [searchParams, setSearchParams] = useSearchParams();
  const providerFromParams = embedded
    ? (initialProvider ?? '')
    : (searchParams.get('provider') ?? '');
  const [initialProviderKey] = useState(() => normalizeProviderKey(providerFromParams));

  const [provider, setProvider] = useState(providerFromParams);
  const files = useAuthInventoryStore((state) => state.files);
  const refreshAuthFiles = useAuthInventoryStore((state) => state.refresh);
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [baselineReady, setBaselineReady] = useState(false);
  const [modelAliasUnsupported, setModelAliasUnsupported] = useState(false);
  const loadRequestRef = useRef(0);

  const [mappings, setMappings] = useState<OAuthModelMappingFormEntry[]>([
    buildEmptyMappingEntry(),
  ]);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<'unsupported' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProvider(providerFromParams);
  }, [providerFromParams]);

  const providerOptions = useMemo(() => {
    const extraProviders = new Set<string>();
    Object.keys(excluded).forEach((value) => extraProviders.add(value));
    Object.keys(modelAlias).forEach((value) => extraProviders.add(value));
    files.forEach((file) => {
      if (typeof file.type === 'string') {
        extraProviders.add(file.type);
      }
      if (typeof file.provider === 'string') {
        extraProviders.add(file.provider);
      }
    });

    return buildOAuthProviderOptions(extraProviders);
  }, [excluded, files, modelAlias]);

  const resolvedProviderKey = useMemo(() => normalizeProviderKey(provider), [provider]);
  const isEditing = useMemo(() => {
    if (!resolvedProviderKey) return false;
    return Object.prototype.hasOwnProperty.call(modelAlias, resolvedProviderKey);
  }, [modelAlias, resolvedProviderKey]);
  const baselineMappingsSignature = useMemo(
    () => getModelAliasDraftSignature(modelAlias[resolvedProviderKey] ?? []),
    [modelAlias, resolvedProviderKey]
  );
  const mappingsSignature = useMemo(() => getModelAliasDraftSignature(mappings), [mappings]);
  const contentDirty = baselineMappingsSignature !== mappingsSignature;
  const isDirty = isOAuthEditorDirty(
    initialProviderKey,
    resolvedProviderKey,
    baselineMappingsSignature,
    mappingsSignature
  );
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
    }),
    [t]
  );
  const { allowNextNavigation } = useUnsavedChangesGuard({
    shouldBlock: isDirty,
    dialog: unsavedChangesDialog,
  });
  const title = useMemo(() => {
    if (isEditing) {
      return t('oauth_model_alias.edit_title', {
        provider: provider.trim() || resolvedProviderKey,
      });
    }
    return t('oauth_model_alias.add_title');
  }, [isEditing, provider, resolvedProviderKey, t]);
  const headerHint = useMemo(() => {
    if (!provider.trim()) {
      return t('oauth_model_alias.provider_hint');
    }
    if (modelsLoading) {
      return t('oauth_model_alias.model_source_loading');
    }
    if (modelsError === 'unsupported') {
      return t('oauth_model_alias.model_source_unsupported');
    }
    return t('oauth_model_alias.model_source_loaded', { count: modelsList.length });
  }, [modelsError, modelsList.length, modelsLoading, provider, t]);

  const leaveEditor = useCallback(() => {
    if (embedded) {
      onClose?.();
      return;
    }
    const state = location.state as LocationState;
    if (state?.fromAuthFiles) {
      navigate(-1);
      return;
    }
    navigate('/quota', { replace: true });
  }, [embedded, location.state, navigate, onClose]);

  const handleBack = useCallback(() => {
    if (!isDirty) {
      leaveEditor();
      return;
    }
    showConfirmation({
      ...unsavedChangesDialog,
      variant: 'danger',
      onConfirm: () => {
        allowNextNavigation();
        leaveEditor();
      },
    });
  }, [allowNextNavigation, isDirty, leaveEditor, showConfirmation, unsavedChangesDialog]);

  const swipeRef = useEdgeSwipeBack({ enabled: !embedded, onBack: handleBack });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const loadInitialData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setInitialLoading(true);
    setInitialLoadError(null);
    setBaselineReady(false);
    setModelAliasUnsupported(false);

    try {
      const [, excludedResult, aliasResult] = await Promise.allSettled([
        refreshAuthFiles(),
        authFilesApi.getOauthExcludedModels(),
        authFilesApi.getOauthModelAlias(),
      ]);

      if (requestId !== loadRequestRef.current) return;

      if (excludedResult.status === 'fulfilled') {
        setExcluded(excludedResult.value ?? {});
      }

      if (aliasResult.status === 'fulfilled') {
        setModelAlias(aliasResult.value ?? {});
        setBaselineReady(true);
        return;
      }

      const err = aliasResult.reason;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setModelAliasUnsupported(true);
        return;
      }
      setInitialLoadError(getErrorMessage(err, t('notification.refresh_failed')));
    } catch (err: unknown) {
      if (requestId === loadRequestRef.current) {
        setInitialLoadError(getErrorMessage(err, t('notification.refresh_failed')));
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setInitialLoading(false);
      }
    }
  }, [refreshAuthFiles, t]);

  useEffect(() => {
    void loadInitialData();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadInitialData]);

  useEffect(() => {
    if (!resolvedProviderKey) {
      setMappings([buildEmptyMappingEntry()]);
      return;
    }
    const existing = modelAlias[resolvedProviderKey] ?? [];
    setMappings(normalizeMappingEntries(existing));
  }, [modelAlias, resolvedProviderKey]);

  useEffect(() => {
    if (!resolvedProviderKey || modelAliasUnsupported) {
      setModelsList([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);

    authFilesApi
      .getModelDefinitions(resolvedProviderKey)
      .then((models) => {
        if (cancelled) return;
        setModelsList(models);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;

        if (status === 400 || status === 404) {
          setModelsList([]);
          setModelsError('unsupported');
          return;
        }

        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
      })
      .finally(() => {
        if (cancelled) return;
        setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modelAliasUnsupported, resolvedProviderKey, showNotification, t]);

  const applyProviderChange = useCallback(
    (value: string) => {
      setProvider(value);
      if (embedded) return;
      const next = new URLSearchParams(searchParams);
      const trimmed = value.trim();
      if (trimmed) {
        next.set('provider', trimmed);
      } else {
        next.delete('provider');
      }
      allowNextNavigation();
      setSearchParams(next, { replace: true });
    },
    [allowNextNavigation, embedded, searchParams, setSearchParams]
  );

  const updateProvider = useCallback(
    (value: string) => {
      if (!contentDirty || normalizeProviderKey(value) === resolvedProviderKey) {
        applyProviderChange(value);
        return;
      }
      showConfirmation({
        ...unsavedChangesDialog,
        variant: 'danger',
        onConfirm: () => applyProviderChange(value),
      });
    },
    [applyProviderChange, contentDirty, resolvedProviderKey, showConfirmation, unsavedChangesDialog]
  );

  const updateMappingEntry = useCallback(
    (index: number, field: 'name' | 'alias' | 'fork', value: string | boolean) => {
      setMappings((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry))
      );
    },
    []
  );

  const addMappingEntry = useCallback(() => {
    setMappings((prev) => [...prev, buildEmptyMappingEntry()]);
  }, []);

  const removeMappingEntry = useCallback((index: number) => {
    setMappings((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [buildEmptyMappingEntry()];
    });
  }, []);

  const handleSave = useCallback(async () => {
    const channel = normalizeProviderKey(provider);
    if (!channel) {
      showNotification(t('oauth_model_alias.provider_required'), 'error');
      return;
    }

    const seenAlias = new Set<string>();
    let hasDuplicateAlias = false;
    const normalized = mappings
      .map((entry) => {
        const name = String(entry.name ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const aliasKey = alias.toLowerCase();
        if (seenAlias.has(aliasKey)) {
          hasDuplicateAlias = true;
          return null;
        }
        seenAlias.add(aliasKey);
        const normalizedEntry: OAuthModelAliasDraftEntry = { name, alias };
        if (entry.fork) normalizedEntry.fork = true;
        const displayName = entry.displayName?.trim();
        if (displayName) normalizedEntry.displayName = displayName;
        if (typeof entry.forceMapping === 'boolean') {
          normalizedEntry.forceMapping = entry.forceMapping;
        }
        return normalizedEntry;
      })
      .filter(Boolean) as OAuthModelAliasEntry[];

    if (hasDuplicateAlias) {
      showNotification(t('oauth_model_alias.duplicate_alias'), 'error');
      return;
    }

    setSaving(true);
    try {
      if (normalized.length) {
        await authFilesApi.saveOauthModelAlias(channel, normalized);
      } else if (isEditing) {
        await authFilesApi.deleteOauthModelAlias(channel);
      }
      showNotification(t('oauth_model_alias.save_success'), 'success');
      onSaved?.();
      allowNextNavigation();
      leaveEditor();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowNextNavigation,
    isEditing,
    leaveEditor,
    mappings,
    onSaved,
    provider,
    showNotification,
    t,
  ]);

  const canSave =
    !disableControls &&
    !saving &&
    baselineReady &&
    !modelAliasUnsupported &&
    initialLoadError === null;
  const shellClassName = embedded ? styles.embeddedShell : undefined;
  const contentClassName = embedded
    ? `${styles.pageContent} ${styles.embeddedPageContent}`
    : styles.pageContent;

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      className={shellClassName}
      contentClassName={contentClassName}
      rightAction={
        <Button size="sm" onClick={handleSave} loading={saving} disabled={!canSave}>
          {t('oauth_model_alias.save')}
        </Button>
      }
      isLoading={initialLoading}
      loadingLabel={t('common.loading')}
    >
      {modelAliasUnsupported ? (
        <Card>
          <EmptyState
            title={t('oauth_model_alias.upgrade_required_title')}
            description={t('oauth_model_alias.upgrade_required_desc')}
          />
        </Card>
      ) : initialLoadError !== null ? (
        <Card>
          <EmptyState
            title={t('notification.refresh_failed')}
            description={initialLoadError}
            action={
              <Button variant="secondary" size="sm" onClick={() => void loadInitialData()}>
                {t('common.refresh')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className={styles.settingsCard}>
            <div className={styles.settingsHeader}>
              <div className={styles.settingsHeaderTitle}>
                <IconInfo size={16} />
                <span>{t('oauth_model_alias.title')}</span>
              </div>
              <div className={styles.settingsHeaderHint}>{headerHint}</div>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsRow}>
                <div className={styles.settingsInfo}>
                  <div className={styles.settingsLabel}>
                    {t('oauth_model_alias.provider_label')}
                  </div>
                  <div className={styles.settingsDesc}>{t('oauth_model_alias.provider_hint')}</div>
                </div>
                <div className={styles.settingsControl}>
                  <AutocompleteInput
                    id="oauth-model-alias-provider"
                    placeholder={t('oauth_model_alias.provider_placeholder')}
                    value={provider}
                    onChange={updateProvider}
                    options={providerOptions}
                    disabled={disableControls || saving}
                    wrapperStyle={{ marginBottom: 0 }}
                  />
                </div>
              </div>

              {providerOptions.length > 0 && (
                <div className={styles.tagList}>
                  {providerOptions.map((option) => {
                    const isActive =
                      normalizeProviderKey(provider) === normalizeProviderKey(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`${styles.tag} ${isActive ? styles.tagActive : ''}`}
                        onClick={() => updateProvider(option)}
                        disabled={disableControls || saving}
                      >
                        {getTypeLabel(t, option)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card className={styles.settingsCard}>
            <div className={styles.mappingsHeader}>
              <div className={styles.mappingsTitle}>{t('oauth_model_alias.alias_label')}</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={addMappingEntry}
                disabled={disableControls || saving || modelAliasUnsupported}
              >
                {t('oauth_model_alias.add_alias')}
              </Button>
            </div>

            <div className={styles.mappingsBody}>
              {mappings.map((entry, index) => (
                <div key={entry.id} className={styles.mappingRow}>
                  <AutocompleteInput
                    wrapperStyle={{ flex: 1, marginBottom: 0 }}
                    placeholder={t('oauth_model_alias.alias_name_placeholder')}
                    value={entry.name}
                    onChange={(val) => updateMappingEntry(index, 'name', val)}
                    disabled={disableControls || saving}
                    options={modelsList.map((model) => ({
                      value: model.id,
                      label:
                        model.display_name && model.display_name !== model.id
                          ? model.display_name
                          : undefined,
                    }))}
                  />
                  <span className={styles.mappingSeparator}>→</span>
                  <input
                    className={cn(inputClass, styles.mappingAliasInput)}
                    placeholder={t('oauth_model_alias.alias_placeholder')}
                    value={entry.alias}
                    onChange={(e) => updateMappingEntry(index, 'alias', e.target.value)}
                    disabled={disableControls || saving}
                  />
                  <div className={styles.mappingFork}>
                    <ToggleSwitch
                      label={t('oauth_model_alias.alias_fork_label')}
                      labelPosition="left"
                      checked={Boolean(entry.fork)}
                      onChange={(value) => updateMappingEntry(index, 'fork', value)}
                      disabled={disableControls || saving}
                    />
                  </div>
                  <TooltipButton
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMappingEntry(index)}
                    disabled={disableControls || saving || mappings.length <= 1}
                    label={t('common.delete')}
                  >
                    <IconX size={14} />
                  </TooltipButton>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </SecondaryScreenShell>
  );
}
