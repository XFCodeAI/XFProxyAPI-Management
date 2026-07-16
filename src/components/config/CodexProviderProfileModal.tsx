import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { codexProviderProfileApi, type CodexProviderProfile } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import styles from './VisualConfigEditor.module.scss';

type CopyTarget = 'apiKey' | 'baseUrl' | 'environmentKey' | 'config' | null;

interface CodexProviderProfileModalProps {
  open: boolean;
  apiKey: string;
  apiBase: string;
  onClose: () => void;
}

export function CodexProviderProfileModal({
  open,
  apiKey,
  apiBase,
  onClose,
}: CodexProviderProfileModalProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const requestVersionRef = useRef(0);
  const copyTimerRef = useRef<number | null>(null);
  const [profile, setProfile] = useState<CodexProviderProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);

  const loadProfile = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    setError('');
    setProfile(null);
    try {
      const nextProfile = await codexProviderProfileApi.create(apiBase);
      if (requestVersion === requestVersionRef.current) {
        setProfile(nextProfile);
      }
    } catch (loadError) {
      if (requestVersion === requestVersionRef.current) {
        setError(
          getErrorMessage(
            loadError,
            t('config_management.visual.api_keys.codex_profile_load_failed')
          )
        );
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
      }
    }
  }, [apiBase, t]);

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1;
      setProfile(null);
      setLoading(false);
      setError('');
      setCopiedTarget(null);
      return;
    }
    void loadProfile();
  }, [loadProfile, open]);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    []
  );

  const copyValue = async (value: string, target: Exclude<CopyTarget, null>) => {
    const copied = await copyToClipboard(value);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
    if (!copied) return;
    setCopiedTarget(target);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopiedTarget(null), 1600);
  };

  const copyIcon = (target: Exclude<CopyTarget, null>) =>
    copiedTarget === target ? <Check size={16} /> : <Copy size={16} />;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('config_management.visual.api_keys.codex_profile_title')}
      width={720}
      bodyClassName={styles.codexProfileModalBody}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            onClick={() => profile && void copyValue(profile.configToml, 'config')}
            disabled={!profile || loading}
          >
            {copyIcon('config')}
            {t('config_management.visual.api_keys.codex_profile_copy_config')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className={styles.codexProfileState}>{t('common.loading')}</div>
      ) : error ? (
        <div className={styles.codexProfileError} role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void loadProfile()}>
            <RefreshCw size={16} />
            {t('config_management.visual.api_keys.codex_profile_retry')}
          </Button>
        </div>
      ) : profile ? (
        <div className={styles.codexProfileContent}>
          <div className={styles.codexProfileFields}>
            <ProfileField
              label={t('config_management.visual.api_keys.codex_profile_api_key')}
              value={maskApiKey(apiKey)}
              copyLabel={t('config_management.visual.api_keys.codex_profile_copy_api_key')}
              icon={copyIcon('apiKey')}
              onCopy={() => void copyValue(apiKey, 'apiKey')}
            />
            <ProfileField
              label={t('config_management.visual.api_keys.codex_profile_base_url')}
              value={profile.baseUrl}
              copyLabel={t('config_management.visual.api_keys.codex_profile_copy_base_url')}
              icon={copyIcon('baseUrl')}
              onCopy={() => void copyValue(profile.baseUrl, 'baseUrl')}
            />
            <ProfileField
              label={t('config_management.visual.api_keys.codex_profile_environment_key')}
              value={profile.environmentKey}
              copyLabel={t('config_management.visual.api_keys.codex_profile_copy_environment_key')}
              icon={copyIcon('environmentKey')}
              onCopy={() => void copyValue(profile.environmentKey, 'environmentKey')}
            />
          </div>

          <div className={styles.codexProfileConfigSection}>
            <div className={styles.codexProfileConfigHeader}>
              <span>{t('config_management.visual.api_keys.codex_profile_config')}</span>
              <TooltipIconButton
                label={t('config_management.visual.api_keys.codex_profile_copy_config')}
                onClick={() => void copyValue(profile.configToml, 'config')}
              >
                {copyIcon('config')}
              </TooltipIconButton>
            </div>
            <pre className={styles.codexProfileCode} tabIndex={0}>
              <code>{profile.configToml}</code>
            </pre>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ProfileField({
  label,
  value,
  copyLabel,
  icon,
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel: string;
  icon: React.ReactNode;
  onCopy: () => void;
}) {
  return (
    <div className={styles.codexProfileField}>
      <span className={styles.codexProfileFieldLabel}>{label}</span>
      <div className={styles.codexProfileFieldValueRow}>
        <code className={styles.codexProfileFieldValue}>{value}</code>
        <TooltipIconButton label={copyLabel} onClick={onCopy}>
          {icon}
        </TooltipIconButton>
      </div>
    </div>
  );
}
