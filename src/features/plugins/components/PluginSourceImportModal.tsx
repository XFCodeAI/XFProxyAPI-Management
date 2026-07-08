import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { PluginStoreSource } from '@/types';
import styles from './PluginSourceImportModal.module.scss';

interface PluginSourceImportModalProps {
  open: boolean;
  sources: PluginStoreSource[];
  adding: boolean;
  onClose: () => void;
  onSubmit: (url: string) => Promise<void>;
}

const normalizeURL = (value: string): string => value.trim();

const isValidSourceURL = (value: string): boolean => {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export function PluginSourceImportModal({
  open,
  sources,
  adding,
  onClose,
  onSubmit,
}: PluginSourceImportModalProps) {
  const { t } = useTranslation();
  const [url, setURL] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setURL('');
    setTouched(false);
  }, [open]);

  const normalizedURL = normalizeURL(url);
  const existingSourceURLs = useMemo(
    () => new Set(sources.map((source) => source.url.trim()).filter(Boolean)),
    [sources]
  );
  const duplicated = normalizedURL ? existingSourceURLs.has(normalizedURL) : false;
  const invalid = touched && normalizedURL ? !isValidSourceURL(normalizedURL) : false;
  const empty = touched && !normalizedURL;
  const error = empty
    ? t('plugin_store.source_url_required')
    : invalid
      ? t('plugin_store.source_url_invalid')
      : duplicated
        ? t('plugin_store.source_already_exists')
        : '';

  const handleSubmit = async () => {
    setTouched(true);
    if (!normalizedURL || !isValidSourceURL(normalizedURL) || duplicated) return;
    await onSubmit(normalizedURL);
  };

  return (
    <Modal
      open={open}
      title={t('plugin_store.source_import_title')}
      onClose={onClose}
      closeDisabled={adding}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={adding}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={adding} disabled={!normalizedURL || duplicated}>
            {t('plugin_store.source_import_action')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.description}>{t('plugin_store.source_import_desc')}</p>
        <Input
          label={t('plugin_store.source_url_label')}
          placeholder={t('plugin_store.source_url_placeholder')}
          value={url}
          onChange={(event) => {
            setURL(event.target.value);
            if (!touched) return;
            setTouched(true);
          }}
          onBlur={() => setTouched(true)}
          error={error}
          disabled={adding}
        />
        {sources.length > 0 ? (
          <div className={styles.sourceList}>
            <div className={styles.sourceListTitle}>{t('plugin_store.source_current')}</div>
            <div className={styles.sourceRows}>
              {sources.map((source) => (
                <div key={`${source.id || source.name}-${source.url}`} className={styles.sourceRow}>
                  <span className={styles.sourceName}>{source.name || source.id}</span>
                  <span className={styles.sourceUrl} title={source.url}>
                    {source.url}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
