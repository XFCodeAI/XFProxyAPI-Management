import { useTranslation } from 'react-i18next';
import type { AuthFileUploadState } from '@/features/authFiles/hooks/useAuthFilesData';
import styles from './AuthFileUploadProgress.module.scss';

interface AuthFileUploadProgressProps {
  progress: AuthFileUploadState;
}

export function AuthFileUploadProgress({ progress }: AuthFileUploadProgressProps) {
  const { t } = useTranslation();
  const percent =
    progress.totalFiles > 0
      ? Math.min(100, Math.round((progress.processedFiles / progress.totalFiles) * 100))
      : 0;
  const phaseLabel =
    progress.phase === 'cancelling'
      ? t('auth_files.upload_stopping', { defaultValue: '正在停止...' })
      : progress.phase === 'cancelled'
        ? t('auth_files.upload_cancelled_short', { defaultValue: '已停止' })
        : progress.phase === 'completed'
          ? t('auth_files.upload_finished', { defaultValue: '导入已完成' })
          : t('auth_files.upload_in_progress', { defaultValue: '正在导入' });

  return (
    <section className={styles.root} aria-live="polite">
      <div className={styles.header}>
        <strong>{phaseLabel}</strong>
        <span>
          {t('auth_files.upload_chunk_progress', {
            defaultValue: '分块 {{current}} / {{total}}',
            current: progress.totalChunks > 0 ? Math.max(1, progress.currentChunk) : 0,
            total: progress.totalChunks,
          })}
        </span>
      </div>
      <progress className={styles.progress} max={100} value={percent} />
      <div className={styles.stats}>
        <span>
          {t('auth_files.upload_progress_processed', {
            defaultValue: '已处理 {{count}} / {{total}}',
            count: progress.processedFiles,
            total: progress.totalFiles,
          })}
        </span>
        <span>
          {t('auth_files.upload_progress_accepted', {
            defaultValue: '已接收 {{count}}',
            count: progress.acceptedFiles,
          })}
        </span>
        <span>
          {t('auth_files.upload_progress_rejected', {
            defaultValue: '失败 {{count}}',
            count: progress.rejectedFiles,
          })}
        </span>
        <span>
          {t('auth_files.upload_progress_remaining', {
            defaultValue: '剩余 {{count}}',
            count: progress.remainingFiles,
          })}
        </span>
      </div>
      {progress.failures.length > 0 ? (
        <div className={styles.failures}>
          {progress.failures.slice(0, 3).map((failure, index) => (
            <div key={`${failure.name}:${index}`}>
              <span>{failure.name}</span>
              <em>{failure.error}</em>
            </div>
          ))}
          {progress.failures.length > 3 ? (
            <small>
              {t('auth_files.upload_progress_more_failures', {
                defaultValue: '另有 {{count}} 个失败文件',
                count: progress.failures.length - 3,
              })}
            </small>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
