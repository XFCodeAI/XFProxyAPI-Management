import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  authFilesApi,
  type AuthFileMaintenanceItem,
  type AuthFileReconciliationResult,
} from '@/services/api';
import styles from './AuthFilesLegacyRepairModal.module.scss';

const EMPTY_MAINTENANCE_ITEMS: AuthFileMaintenanceItem[] = [];

interface AuthFilesLegacyRepairModalProps {
  open: boolean;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

export function AuthFilesLegacyRepairModal({
  open,
  onClose,
  onCompleted,
}: AuthFilesLegacyRepairModalProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<AuthFileReconciliationResult | null>(null);
  const [result, setResult] = useState<AuthFileReconciliationResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await authFilesApi.previewLegacyAuthSources();
      setPreview(next);
      setResult(null);
      setSelected(new Set());
      setConfirming(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [loadPreview, open]);

  const items = preview?.maintenance.items ?? EMPTY_MAINTENANCE_ITEMS;
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.sourceId)),
    [items, selected]
  );
  const outcome = result?.maintenance ?? null;

  const toggleSelection = (sourceId: string, checked: boolean) => {
    if (submitting || result) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(sourceId);
      } else {
        next.delete(sourceId);
      }
      return next;
    });
  };

  const submitRepair = async () => {
    if (selectedItems.length === 0 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const next = await authFilesApi.repairLegacyAuthSources(
        selectedItems.map((item) => ({
          sourceId: item.sourceId,
          contentSha256: item.contentSha256,
        }))
      );
      setResult(next);
      setConfirming(false);
      await onCompleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('notification.delete_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const resultCounts = useMemo(() => {
    const counts = { removed: 0, pending: 0, conflict: 0, failed: 0 };
    outcome?.items.forEach((item) => {
      if (item.result === 'removed') counts.removed++;
      if (item.result === 'pending') counts.pending++;
      if (item.result === 'conflict') counts.conflict++;
      if (item.result === 'failed') counts.failed++;
    });
    return counts;
  }, [outcome]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={submitting}
      title={t('auth_files.legacy_repair_title', { defaultValue: '修复历史删除残留' })}
      width={760}
      headerAction={
        <TooltipIconButton
          label={t('common.refresh')}
          onClick={() => void loadPreview()}
          disabled={loading || submitting}
        >
          <IconRefreshCw size={16} />
        </TooltipIconButton>
      }
      footer={
        result ? (
          <Button type="button" onClick={onClose} disabled={submitting}>
            {t('common.close')}
          </Button>
        ) : confirming ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={submitting}
            >
              {t('common.back', { defaultValue: '返回' })}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void submitRepair()}
              loading={submitting}
            >
              {t('auth_files.legacy_repair_confirm', {
                defaultValue: '确认删除 {{count}} 项',
                count: selectedItems.length,
              })}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirming(true)}
              disabled={selectedItems.length === 0 || loading || submitting}
            >
              {t('auth_files.legacy_repair_delete_selected', {
                defaultValue: '删除选中项 ({{count}})',
                count: selectedItems.length,
              })}
            </Button>
          </>
        )
      }
    >
      <div className={styles.content}>
        {error ? <div className={styles.errorBox}>{error}</div> : null}

        {result && outcome ? (
          <div className={styles.resultSection}>
            <div className={styles.resultSummary}>
              <ResultCount
                label={t('common.success')}
                count={resultCounts.removed}
                tone="success"
              />
              <ResultCount
                label={t('auth_files.legacy_repair_pending', { defaultValue: '待重试' })}
                count={resultCounts.pending}
                tone="pending"
              />
              <ResultCount
                label={t('auth_files.legacy_repair_conflict', { defaultValue: '需确认' })}
                count={resultCounts.conflict}
                tone="conflict"
              />
              <ResultCount label={t('common.failed')} count={resultCounts.failed} tone="failed" />
            </div>
            <RepairItemList
              items={outcome.items}
              selected={new Set()}
              disabled
              showSelection={false}
              onToggle={() => undefined}
            />
          </div>
        ) : confirming ? (
          <div className={styles.confirmSection}>
            <div className={styles.confirmTitle}>
              {t('auth_files.legacy_repair_confirm_title', { defaultValue: '确认删除以下文件' })}
            </div>
            <RepairItemList
              items={selectedItems}
              selected={selected}
              disabled
              showSelection={false}
              onToggle={() => undefined}
            />
          </div>
        ) : (
          <>
            <div className={styles.summaryRow}>
              <span>
                {t('auth_files.legacy_repair_found', {
                  defaultValue: '可确认修复 {{count}} 项',
                  count: items.length,
                })}
              </span>
              {preview && preview.pending.cleanupEntries > 0 ? (
                <span className={styles.pendingText}>
                  {t('auth_files.legacy_repair_cleanup_pending', {
                    defaultValue: '{{count}} 项删除同步待重试',
                    count: preview.pending.cleanupEntries,
                  })}
                </span>
              ) : null}
              {preview && preview.failed.cleanupConflicts > 0 ? (
                <span className={styles.conflictText}>
                  {t('auth_files.legacy_repair_cleanup_conflicts', {
                    defaultValue: '{{count}} 项删除需要重新确认',
                    count: preview.failed.cleanupConflicts,
                  })}
                </span>
              ) : null}
            </div>
            {loading ? (
              <div className={styles.emptyState}>{t('common.loading')}</div>
            ) : items.length === 0 ? (
              <div className={styles.emptyState}>
                {t('auth_files.legacy_repair_empty', { defaultValue: '没有可修复的历史残留' })}
              </div>
            ) : (
              <RepairItemList
                items={items}
                selected={selected}
                disabled={submitting}
                showSelection
                onToggle={toggleSelection}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function RepairItemList({
  items,
  selected,
  disabled,
  showSelection,
  onToggle,
}: {
  items: AuthFileMaintenanceItem[];
  selected: Set<string>;
  disabled: boolean;
  showSelection: boolean;
  onToggle: (sourceId: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.itemList}>
      {items.map((item) => {
        const selectedItem = selected.has(item.sourceId);
        const state = item.result || 'ready';
        return (
          <div
            key={`${item.sourceId}:${item.contentSha256}`}
            className={`${styles.itemRow} ${showSelection ? '' : styles.itemRowStatic}`}
          >
            {showSelection ? (
              <SelectionCheckbox
                checked={selectedItem}
                onChange={(checked) => onToggle(item.sourceId, checked)}
                disabled={disabled}
                ariaLabel={item.sourceId}
              />
            ) : null}
            <div className={styles.itemMain}>
              <strong title={item.sourceId}>{item.sourceId}</strong>
              <span>{[item.provider, item.ownerState].filter(Boolean).join(' / ') || '-'}</span>
            </div>
            <div className={styles.itemMeta}>
              <span>
                {t('auth_files.legacy_repair_bindings', {
                  defaultValue: '{{count}} 个绑定',
                  count: totalBindings(item),
                })}
              </span>
              {state !== 'ready' ? <span data-state={state}>{resultLabel(t, state)}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultCount({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={styles.resultCount} data-tone={tone}>
      <strong>{count}</strong>
      <span>{label}</span>
    </div>
  );
}

function totalBindings(item: AuthFileMaintenanceItem): number {
  const bindings = item.bindings;
  return (
    bindings.credentials + bindings.proxyBindings + bindings.groupBindings + bindings.apiKeyBindings
  );
}

function resultLabel(t: ReturnType<typeof useTranslation>['t'], state: string): string {
  if (state === 'removed') return t('common.success');
  if (state === 'pending') return t('auth_files.legacy_repair_pending', { defaultValue: '待重试' });
  if (state === 'conflict')
    return t('auth_files.legacy_repair_conflict', { defaultValue: '需确认' });
  return t('common.failed');
}
