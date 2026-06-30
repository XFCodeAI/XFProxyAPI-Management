import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type {
  SessionImportFailurePhase,
  SessionImportResult,
} from '@/features/authFiles/hooks/useAuthFilesData';
import styles from './AuthSessionImportResultModal.module.scss';

interface AuthSessionImportResultModalProps {
  open: boolean;
  result: SessionImportResult | null;
  onClose: () => void;
}

export function AuthSessionImportResultModal({
  open,
  result,
  onClose,
}: AuthSessionImportResultModalProps) {
  const { t } = useTranslation();

  if (!result) {
    return null;
  }

  const title =
    result.failed === 0
      ? t('auth_files.session_import_done', { defaultValue: 'Session 导入完成' })
      : result.imported > 0
        ? t('auth_files.session_import_partial_done', { defaultValue: 'Session 部分导入完成' })
        : t('auth_files.session_import_failed', { defaultValue: 'Session 导入失败' });
  const summary =
    result.failed === 0
      ? t('auth_files.session_import_success_summary', {
          defaultValue: '全部 Session 已验活并导入为 Codex 认证文件。',
        })
      : t('auth_files.session_import_failure_summary', {
          defaultValue: '部分 Session 未能完成导入，请根据下面的失败原因处理后重试。',
        });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={640}
      footer={
        <Button type="button" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className={styles.content}>
        <p className={styles.summaryText}>{summary}</p>
        <div className={styles.statsGrid}>
          <ResultStat
            label={t('auth_files.session_import_total', { defaultValue: '总数' })}
            value={result.total}
          />
          <ResultStat
            label={t('auth_files.session_import_validated', { defaultValue: '验活通过' })}
            value={result.validated}
          />
          <ResultStat
            label={t('auth_files.session_import_imported', { defaultValue: '成功导入' })}
            value={result.imported}
            tone="success"
          />
          <ResultStat
            label={t('auth_files.session_import_failed_count', { defaultValue: '失败' })}
            value={result.failed}
            tone={result.failed > 0 ? 'danger' : 'neutral'}
          />
        </div>

        {result.failures.length > 0 ? (
          <div className={styles.failureSection}>
            <div className={styles.failureHeader}>
              <strong>
                {t('auth_files.session_import_failure_details', { defaultValue: '失败明细' })}
              </strong>
              <span>
                {t('auth_files.session_import_failure_total', {
                  defaultValue: '{{count}} 项',
                  count: result.failures.length,
                })}
              </span>
            </div>
            <div className={styles.failureList}>
              {result.failures.map((failure, index) => (
                <div
                  className={styles.failureRow}
                  key={`${failure.phase}:${failure.name}:${index}`}
                >
                  <div className={styles.failureMain}>
                    <strong title={failure.name}>{failure.name}</strong>
                    <span title={failure.reason}>{failure.reason}</span>
                  </div>
                  <span className={styles.phasePill}>{getPhaseLabel(t, failure.phase)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ResultStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return (
    <div
      className={`${styles.statItem} ${
        tone === 'success' ? styles.statItemSuccess : tone === 'danger' ? styles.statItemDanger : ''
      }`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function getPhaseLabel(
  t: ReturnType<typeof useTranslation>['t'],
  phase: SessionImportFailurePhase
) {
  if (phase === 'upload') {
    return t('auth_files.session_import_phase_upload', { defaultValue: '导入' });
  }
  return t('auth_files.session_import_phase_validation', { defaultValue: '验活' });
}
