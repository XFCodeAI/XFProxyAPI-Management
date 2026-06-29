import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw } from '@/components/ui/icons';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { authFilesApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import styles from './QuotaAuthSettingsPanel.module.scss';

type ViewMode = 'diagram' | 'list';

type AuthSettingsEditor =
  | { kind: 'excluded'; provider?: string }
  | { kind: 'modelAlias'; provider?: string };

interface QuotaAuthSettingsPanelProps {
  onHeaderActionChange?: (action: ReactNode | null) => void;
}

export function QuotaAuthSettingsPanel({ onHeaderActionChange }: QuotaAuthSettingsPanelProps) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editor, setEditor] = useState<AuthSettingsEditor | null>(null);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const disableControls = connectionStatus !== 'connected';

  const refreshSettings = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [filesResult] = await Promise.allSettled([
        authFilesApi.list(),
        loadExcluded(),
        loadModelAlias(),
      ]);

      if (filesResult.status === 'fulfilled') {
        setFiles(filesResult.value?.files ?? []);
        return;
      }

      const errorMessage =
        filesResult.reason instanceof Error
          ? filesResult.reason.message
          : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [connectionStatus, loadExcluded, loadModelAlias, t]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const closeEditor = useCallback(() => {
    setEditor(null);
  }, []);

  const handleEditorSaved = useCallback(() => {
    void refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    if (!onHeaderActionChange) return;

    if (editor) {
      onHeaderActionChange(null);
      return;
    }

    onHeaderActionChange(
      <div className={styles.headerAction}>
        {loading ? (
          <div className={styles.loadingState}>
            <LoadingSpinner size={14} />
            <span>{t('common.loading')}</span>
          </div>
        ) : null}
        {!loading ? (
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshButton}
            onClick={() => void refreshSettings()}
            disabled={disableControls}
            aria-label={t('common.refresh')}
          >
            <IconRefreshCw size={14} />
            <span>{t('common.refresh')}</span>
          </Button>
        ) : null}
      </div>
    );

    return () => onHeaderActionChange(null);
  }, [disableControls, editor, loading, onHeaderActionChange, refreshSettings, t]);

  if (editor?.kind === 'excluded') {
    return (
      <AuthFilesOAuthExcludedEditPage
        key={`excluded:${editor.provider ?? ''}`}
        embedded
        initialProvider={editor.provider}
        onClose={closeEditor}
        onSaved={handleEditorSaved}
      />
    );
  }

  if (editor?.kind === 'modelAlias') {
    return (
      <AuthFilesOAuthModelAliasEditPage
        key={`modelAlias:${editor.provider ?? ''}`}
        embedded
        initialProvider={editor.provider}
        onClose={closeEditor}
        onSaved={handleEditorSaved}
      />
    );
  }

  return (
    <div className={styles.panel}>
      {error ? <div className={styles.errorBox}>{error}</div> : null}

      <div className={styles.settingsGrid}>
        <OAuthExcludedCard
          disableControls={disableControls || loading}
          excludedError={excludedError}
          excluded={excluded}
          onAdd={() => setEditor({ kind: 'excluded' })}
          onEdit={(provider) => setEditor({ kind: 'excluded', provider })}
          onDelete={deleteExcluded}
        />

        <OAuthModelAliasCard
          disableControls={disableControls || loading}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onAdd={() => setEditor({ kind: 'modelAlias' })}
          onEditProvider={(provider) => setEditor({ kind: 'modelAlias', provider })}
          onDeleteProvider={deleteModelAlias}
          modelAliasError={modelAliasError}
          modelAlias={modelAlias}
          allProviderModels={allProviderModels}
          onUpdate={handleMappingUpdate}
          onDeleteLink={handleDeleteLink}
          onToggleFork={handleToggleFork}
          onRenameAlias={handleRenameAlias}
          onDeleteAlias={handleDeleteAlias}
        />
      </div>
    </div>
  );
}
