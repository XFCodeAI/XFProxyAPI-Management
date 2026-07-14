import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProxySelectionControl } from '@/components/proxy/ProxySelectionControl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { getStatusBadgeClass } from '@/components/ui/statusStyles';
import { supportsOAuthCallback, type OAuthProviderState } from '@/hooks/useOAuthProviderFlow';
import { IconExternalLink } from '@/components/ui/icons';
import { isProxyPoolSmartAssignable, proxyPoolsApi } from '@/services/api';
import type { ProxyPoolStatusEntry, ProxySelection } from '@/types';
import styles from './QuotaOAuthDialog.module.scss';

interface QuotaOAuthDialogProps {
  open: boolean;
  providerLabel: string;
  oauthProviderId: string;
  pluginProvider?: boolean;
  state: OAuthProviderState;
  onClose: () => void;
  onStart: (selection?: ProxySelection) => void;
  onCopyLink: (url?: string) => void;
  onSubmitCallback: () => void;
  onCallbackUrlChange: (value: string) => void;
}

export function QuotaOAuthDialog({
  open,
  providerLabel,
  oauthProviderId,
  pluginProvider = false,
  state,
  onClose,
  onStart,
  onCopyLink,
  onSubmitCallback,
  onCallbackUrlChange,
}: QuotaOAuthDialogProps) {
  const { t } = useTranslation();
  const [proxySelection, setProxySelection] = useState<ProxySelection>({ mode: 'smart' });
  const [proxyPools, setProxyPools] = useState<ProxyPoolStatusEntry[]>([]);
  const [proxyPoolsLoading, setProxyPoolsLoading] = useState(false);
  const title = t('quota_management.oauth_login', { provider: providerLabel });
  const getProviderText = (suffix: string) => {
    if (pluginProvider) return t(`auth_login.plugin_${suffix}`, { name: providerLabel });
    const key = `auth_login.${oauthProviderId}_${suffix}`;
    const translated = t(key);
    return translated === key
      ? t(`auth_login.plugin_${suffix}`, { name: providerLabel })
      : translated;
  };
  const canSubmitCallback =
    supportsOAuthCallback(oauthProviderId, pluginProvider) && Boolean(state.url);
  const statusBadgeClass = getStatusBadgeClass(
    state.status === 'success' || state.status === 'error' ? state.status : undefined,
    styles.statusBanner
  );
  const startLabel =
    state.status === 'success' ? t('auth_login.login_another_account') : t('common.login');
  const statusText =
    state.status && state.status !== 'idle'
      ? state.status === 'success'
        ? getProviderText('oauth_status_success')
        : state.status === 'error'
          ? `${getProviderText('oauth_status_error')} ${state.error || ''}`
          : getProviderText('oauth_status_waiting')
      : '';
  const startDisabled = Boolean(state.url) || (!pluginProvider && proxyPoolsLoading);

  const loadProxyPools = useCallback(async () => {
    if (pluginProvider) return;
    setProxyPoolsLoading(true);
    try {
      const nextPools = await proxyPoolsApi.loadStatus();
      setProxyPools(nextPools);
      if (!nextPools.some(isProxyPoolSmartAssignable)) {
        setProxySelection((current) => (current.mode === 'smart' ? { mode: 'direct' } : current));
      }
    } catch {
      setProxyPools([]);
      setProxySelection((current) => (current.mode === 'smart' ? { mode: 'direct' } : current));
    } finally {
      setProxyPoolsLoading(false);
    }
  }, [pluginProvider]);

  useEffect(() => {
    if (!open) return;
    setProxySelection({ mode: 'smart' });
    void loadProxyPools();
  }, [loadProxyPools, open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={640}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            onClick={() => onStart(pluginProvider ? undefined : proxySelection)}
            loading={state.polling}
            disabled={startDisabled}
          >
            {startLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.hint}>{getProviderText('oauth_hint')}</p>
        </div>

        {statusText ? <div className={statusBadgeClass}>{statusText}</div> : null}

        {!pluginProvider && !state.url ? (
          <ProxySelectionControl
            value={proxySelection}
            pools={proxyPools}
            loading={proxyPoolsLoading}
            disabled={state.polling}
            onChange={setProxySelection}
            onRefresh={() => void loadProxyPools()}
          />
        ) : null}

        {state.url ? (
          <div className={styles.authUrlBox}>
            <div className={styles.sectionHeader}>
              <div className={styles.authUrlLabel}>{getProviderText('oauth_url_label')}</div>
            </div>
            <div className={styles.authUrlValue}>{state.url}</div>
            <div className={styles.authUrlActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')}
              >
                <IconExternalLink size={14} />
                {getProviderText('open_link')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onCopyLink(state.url)}>
                {getProviderText('copy_link')}
              </Button>
            </div>
          </div>
        ) : null}

        {canSubmitCallback ? (
          <div className={styles.callbackSection}>
            <div className={styles.sectionHeader}>
              <div className={styles.authUrlLabel}>
                {t(
                  oauthProviderId === 'xai'
                    ? 'auth_login.xai_callback_label'
                    : 'auth_login.oauth_callback_label'
                )}
              </div>
            </div>
            <Input
              hint={t(
                oauthProviderId === 'xai'
                  ? 'auth_login.xai_callback_hint'
                  : 'auth_login.oauth_callback_hint'
              )}
              value={state.callbackUrl || ''}
              onChange={(event) => onCallbackUrlChange(event.target.value)}
              placeholder={t(
                oauthProviderId === 'xai'
                  ? 'auth_login.xai_callback_placeholder'
                  : 'auth_login.oauth_callback_placeholder'
              )}
            />
            <div className={styles.callbackActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={onSubmitCallback}
                loading={state.callbackSubmitting}
              >
                {t('auth_login.oauth_callback_button')}
              </Button>
            </div>
            {state.callbackStatus === 'success' && state.status === 'waiting' ? (
              <div className={getStatusBadgeClass('success', styles.status)}>
                {t('auth_login.oauth_callback_status_success')}
              </div>
            ) : null}
            {state.callbackStatus === 'error' ? (
              <div className={getStatusBadgeClass('error', styles.status)}>
                {t('auth_login.oauth_callback_status_error')} {state.callbackError || ''}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
