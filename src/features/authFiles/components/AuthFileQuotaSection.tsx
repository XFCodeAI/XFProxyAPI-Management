import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  getQuotaCredentialCacheKey,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { TooltipButton } from '@/components/ui/TooltipControls';
import { IconRefreshCw } from '@/components/ui/icons';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import styles from '@/pages/AuthFilesPage.module.scss';

type QuotaState = { status?: string; error?: string; errorStatus?: number } | undefined;

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

const getQuotaConfig = (type: QuotaProviderType) => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG;
  if (type === 'claude') return CLAUDE_CONFIG;
  if (type === 'codex') return CODEX_CONFIG;
  if (type === 'kimi') return KIMI_CONFIG;
  if (type === 'xai') return XAI_CONFIG;
  return assertNever(type);
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuotaKey, setResettingQuotaKey] = useState<string | null>(null);
  const credentialCacheKey = getQuotaCredentialCacheKey(file);
  const currentCredentialKeyRef = useRef(credentialCacheKey);
  currentCredentialKeyRef.current = credentialCacheKey;
  const resettingQuota = resettingQuotaKey === credentialCacheKey;

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.antigravityQuota[credentialCacheKey] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[credentialCacheKey] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[credentialCacheKey] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[credentialCacheKey] as QuotaState;
    if (quotaType === 'xai') return state.xaiQuota[credentialCacheKey] as QuotaState;
    return assertNever(quotaType);
  });

  const updateQuotaState = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.setAntigravityQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'claude')
      return state.setClaudeQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'xai') return state.setXaiQuota as unknown as (updater: unknown) => void;
    return assertNever(quotaType);
  });

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (quota?.status === 'loading') return;

    const config = getQuotaConfig(quotaType) as unknown as {
      i18nPrefix: string;
      fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildLoadingState: () => unknown;
      buildSuccessState: (data: unknown) => unknown;
      buildErrorState: (message: string, status?: number) => unknown;
      renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
    };
    const requestCredentialKey = credentialCacheKey;
    const cacheGeneration = captureQuotaCacheGeneration();
    const loadingState = config.buildLoadingState();

    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [requestCredentialKey]: loadingState,
    }));

    try {
      const data = await config.fetchQuota(file, t);
      commitIfQuotaCacheCurrent(
        cacheGeneration,
        () => {
          updateQuotaState((prev: Record<string, unknown>) => ({
            ...prev,
            [requestCredentialKey]: config.buildSuccessState(data),
          }));
          showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
        },
        () => currentCredentialKeyRef.current === requestCredentialKey
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      commitIfQuotaCacheCurrent(
        cacheGeneration,
        () => {
          updateQuotaState((prev: Record<string, unknown>) => ({
            ...prev,
            [requestCredentialKey]: config.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', { name: file.name, message }),
            'error'
          );
        },
        () => currentCredentialKeyRef.current === requestCredentialKey
      );
    } finally {
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev: Record<string, unknown>) => {
          if (prev[requestCredentialKey] !== loadingState) return prev;
          const nextState = { ...prev };
          delete nextState[requestCredentialKey];
          return nextState;
        });
      });
    }
  }, [
    credentialCacheKey,
    disableControls,
    file,
    quota?.status,
    quotaType,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const config = getQuotaConfig(quotaType) as unknown as {
      resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildSuccessState: (data: unknown) => unknown;
    };
    const resetQuota = config.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        const requestCredentialKey = credentialCacheKey;
        if (currentCredentialKeyRef.current !== requestCredentialKey) return;
        const cacheGeneration = captureQuotaCacheGeneration();
        setResettingQuotaKey(requestCredentialKey);
        try {
          const data = await resetQuota(file, t);
          commitIfQuotaCacheCurrent(
            cacheGeneration,
            () => {
              updateQuotaState((prev: Record<string, unknown>) => ({
                ...prev,
                [requestCredentialKey]: config.buildSuccessState(data),
              }));
              showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
            },
            () => currentCredentialKeyRef.current === requestCredentialKey
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(
            cacheGeneration,
            () => {
              showNotification(
                t('codex_quota.reset_failed', { name: file.name, message }),
                'error'
              );
            },
            () => currentCredentialKeyRef.current === requestCredentialKey
          );
        } finally {
          setResettingQuotaKey((current) => (current === requestCredentialKey ? null : current));
        }
      },
    });
  }, [
    disableControls,
    credentialCacheKey,
    file,
    quota?.status,
    quotaType,
    resettingQuota,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const config = getQuotaConfig(quotaType) as unknown as {
    i18nPrefix: string;
    resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
    canResetQuota?: (quota: unknown) => boolean;
    renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
  };

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !resettingQuota;
  const canUseResetQuota = canRefreshQuota && !file.disabled && quotaStatus !== 'loading';
  const showResetQuotaAction = quota !== undefined && Boolean(config.canResetQuota?.(quota));
  const resetQuotaAction =
    config.resetQuota && showResetQuotaAction ? (
      <TooltipButton
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={() => resetQuotaForFile()}
        disabled={!canUseResetQuota}
        loading={resettingQuota}
        label={t('codex_quota.reset_button')}
      >
        {!resettingQuota && <IconRefreshCw size={14} />}
        {t('codex_quota.reset_button')}
      </TooltipButton>
    ) : undefined;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${config.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota ? (
        (config.renderQuotaItems(quota, t, {
          styles,
          QuotaProgressBar,
        }) as ReactNode)
      ) : (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>
      )}
      {quotaStatus !== 'idle' && resetQuotaAction && (
        <div className={styles.quotaCardActions}>{resetQuotaAction}</div>
      )}
    </div>
  );
}
