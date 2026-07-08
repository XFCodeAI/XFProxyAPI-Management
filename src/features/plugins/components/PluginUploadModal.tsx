import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconAlertTriangle, IconFileText, IconUpload } from '@/components/ui/icons';
import styles from './PluginUploadModal.module.scss';

interface PluginUploadModalProps {
  open: boolean;
  uploading: boolean;
  onClose: () => void;
  onSubmit: (file: File) => Promise<void>;
}

const PLUGIN_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const pluginExtensions = ['.so', '.dylib', '.dll'];

const hasPluginExtension = (fileName: string): boolean => {
  const lowerName = fileName.trim().toLowerCase();
  return pluginExtensions.some((extension) => lowerName.endsWith(extension));
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export function PluginUploadModal({
  open,
  uploading,
  onClose,
  onSubmit,
}: PluginUploadModalProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [trusted, setTrusted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTouched(false);
    setTrusted(false);
  }, [open]);

  const fileError = useMemo(() => {
    if (!file) return touched ? t('plugin_store.upload_file_required') : '';
    if (!hasPluginExtension(file.name)) return t('plugin_store.upload_invalid_file');
    if (file.size <= 0) return t('plugin_store.upload_file_empty');
    if (file.size > PLUGIN_UPLOAD_MAX_BYTES) return t('plugin_store.upload_file_too_large');
    return '';
  }, [file, t, touched]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTouched(true);
    setFile(event.target.files?.[0] ?? null);
  };

  const handleSubmit = async () => {
    setTouched(true);
    if (!file || fileError || !trusted) return;
    await onSubmit(file);
  };

  return (
    <Modal
      open={open}
      title={t('plugin_store.upload_title')}
      onClose={onClose}
      closeDisabled={uploading}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={uploading}
            disabled={!file || Boolean(fileError) || !trusted}
          >
            <IconUpload size={15} />
            {t('plugin_store.upload_action')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.description}>{t('plugin_store.upload_desc')}</p>

        <div className={styles.fileBlock}>
          <label className={styles.fileLabel} htmlFor="plugin-upload-file">
            {t('plugin_store.upload_file_label')}
          </label>
          <input
            id="plugin-upload-file"
            className={styles.fileInput}
            type="file"
            accept=".so,.dylib,.dll"
            disabled={uploading}
            onChange={handleFileChange}
          />
          <label
            className={`${styles.fileDrop} ${uploading ? styles.fileDropDisabled : ''}`}
            htmlFor="plugin-upload-file"
          >
            <span className={styles.fileDropIcon} aria-hidden="true">
              <IconUpload size={18} />
            </span>
            <span className={styles.fileDropText}>{t('plugin_store.upload_file_hint')}</span>
          </label>
          {file ? (
            <div className={styles.filePreview}>
              <IconFileText size={16} />
              <span className={styles.fileName} title={file.name}>
                {file.name}
              </span>
              <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
            </div>
          ) : null}
          {fileError ? <div className={styles.errorText}>{fileError}</div> : null}
        </div>

        <div className={styles.warningBox}>
          <IconAlertTriangle size={16} />
          <span>{t('plugin_store.upload_risk_text')}</span>
        </div>

        <SelectionCheckbox
          checked={trusted}
          onChange={setTrusted}
          disabled={uploading}
          label={t('plugin_store.upload_risk_accept')}
          labelClassName={styles.checkboxLabel}
        />
      </div>
    </Modal>
  );
}
