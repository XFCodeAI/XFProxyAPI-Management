import { Pause, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatFileSize } from '@/utils/format';
import type { MonitoringImportProgress } from './importSession';

interface MonitoringImportProgressModalProps {
  open: boolean;
  progress: MonitoringImportProgress | null;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onClose: () => void;
}

const ACTIVE_PHASES = new Set(['preparing', 'uploading', 'processing']);

export function MonitoringImportProgressModal({
  open,
  progress,
  busy,
  onPause,
  onResume,
  onCancel,
  onClose,
}: MonitoringImportProgressModalProps) {
  const { t } = useTranslation();
  if (!progress) return null;

  const active = ACTIVE_PHASES.has(progress.phase);
  const canResume =
    progress.phase === 'paused' || (progress.phase === 'failed' && progress.retryable === true);
  const terminal = progress.phase === 'completed' || progress.phase === 'cancelled';

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={active || busy}
      title={t('request_monitoring.import_progress.title')}
      width={560}
      footer={
        <>
          {!active ? (
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              {t('common.close')}
            </Button>
          ) : null}
          {active ? (
            <Button variant="secondary" size="sm" onClick={onPause} disabled={busy}>
              <Pause size={15} />
              {t('request_monitoring.import_progress.pause')}
            </Button>
          ) : null}
          {progress.sessionId && !terminal ? (
            <Button variant="danger" size="sm" onClick={onCancel} disabled={busy}>
              <Trash2 size={15} />
              {t('request_monitoring.import_progress.cancel')}
            </Button>
          ) : null}
          {canResume ? (
            <Button size="sm" onClick={onResume} disabled={busy}>
              <RotateCcw size={15} />
              {t(
                progress.phase === 'failed'
                  ? 'request_monitoring.import_progress.retry'
                  : 'request_monitoring.import_progress.resume'
              )}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div
          className="truncate text-sm font-semibold text-[var(--foreground)]"
          title={progress.filename}
        >
          {progress.filename}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
          <span className="min-w-0 break-words text-[var(--muted-foreground)]">
            {t(`request_monitoring.import_progress.phases.${progress.phase}`)}
          </span>
          <strong className="shrink-0 text-[var(--foreground)]">{progress.percent}%</strong>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"
          role="progressbar"
          aria-label={t('request_monitoring.import_progress.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span
            className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-200"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          {t('request_monitoring.import_progress.bytes', {
            uploaded: formatFileSize(progress.uploadedBytes),
            total: formatFileSize(progress.totalBytes),
          })}
        </div>
        {progress.phase === 'processing' || progress.phase === 'paused' ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {t(
              progress.phase === 'processing'
                ? 'request_monitoring.import_progress.processing_hint'
                : 'request_monitoring.import_progress.paused_hint'
            )}
          </div>
        ) : null}
        {progress.result ? (
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-[var(--border)]">
            {(['added', 'skipped', 'failed'] as const).map((key) => (
              <div
                className="flex min-w-0 flex-col gap-1 border-l border-[var(--border)] px-3 py-2 first:border-l-0"
                key={key}
              >
                <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">
                  {t(`request_monitoring.import_progress.result.${key}`)}
                </span>
                <strong className="truncate text-sm text-[var(--foreground)]">
                  {progress.result?.[key] ?? 0}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
        {progress.error ? (
          <div
            className="break-words rounded-md border border-[color-mix(in_srgb,var(--destructive)_28%,var(--border))] bg-[color-mix(in_srgb,var(--destructive)_7%,var(--background))] px-3 py-2 text-xs text-[var(--destructive)]"
            role="alert"
          >
            {progress.error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
