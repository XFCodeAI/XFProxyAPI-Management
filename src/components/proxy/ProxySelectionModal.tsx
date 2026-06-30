import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { ProxyPoolStatusEntry, ProxySelection } from '@/types';
import type {
  AuthFileProxyInspection,
  AuthFileProxyInspectionGroup,
} from '@/features/authFiles/proxyUploadInspection';
import { ProxySelectionControl } from './ProxySelectionControl';
import styles from './ProxySelectionModal.module.scss';

interface ProxySelectionModalProps {
  open: boolean;
  title: string;
  value: ProxySelection;
  pools: ProxyPoolStatusEntry[];
  loading?: boolean;
  confirming?: boolean;
  allowFileMode?: boolean;
  inspection?: AuthFileProxyInspection;
  onChange: (value: ProxySelection) => void;
  onRefresh?: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProxySelectionModal({
  open,
  title,
  value,
  pools,
  loading = false,
  confirming = false,
  allowFileMode = false,
  inspection,
  onChange,
  onRefresh,
  onCancel,
  onConfirm,
}: ProxySelectionModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      closeDisabled={confirming}
      title={title}
      width={620}
      footer={
        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={confirming}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} loading={confirming}>
            {t('common.confirm')}
          </Button>
        </div>
      }
    >
      <div className={styles.content}>
        <ProxySelectionControl
          value={value}
          pools={pools}
          loading={loading}
          disabled={confirming}
          allowFileMode={allowFileMode}
          onChange={onChange}
          onRefresh={onRefresh}
        />
        {inspection && inspection.status !== 'idle' ? (
          <ProxyUploadInspectionSummary inspection={inspection} mode={value.mode} />
        ) : null}
      </div>
    </Modal>
  );
}

function ProxyUploadInspectionSummary({
  inspection,
  mode,
}: {
  inspection: AuthFileProxyInspection;
  mode: ProxySelection['mode'];
}) {
  const { t } = useTranslation();
  const useFileProxy = mode === 'file';
  const visibleNewProxies = inspection.newProxies.slice(0, 4);
  const hiddenNewProxyCount = Math.max(0, inspection.newProxies.length - visibleNewProxies.length);
  const visibleFailures = inspection.failures.slice(0, 3);
  const hiddenFailureCount = Math.max(0, inspection.failures.length - visibleFailures.length);

  if (inspection.status === 'loading') {
    return (
      <div className={styles.inspectionBox}>
        <div className={styles.inspectionHeader}>
          {t('proxy_selection.inspecting_files', {
            defaultValue: '正在解析 {{count}} 个认证文件的代理地址...',
            count: inspection.totalFiles,
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.inspectionBox}>
      <div className={styles.inspectionHeader}>
        <span>
          {t('proxy_selection.file_proxy_summary', {
            defaultValue: '文件内代理: {{proxyFiles}}/{{total}} 个文件',
            proxyFiles: inspection.filesWithProxy,
            total: inspection.totalFiles,
          })}
        </span>
        <span>
          {t('proxy_selection.unique_proxy_summary', {
            defaultValue: '{{count}} 个唯一代理',
            count: inspection.uniqueProxyCount,
          })}
        </span>
      </div>

      <div className={styles.inspectionStats}>
        <StatItem
          label={t('proxy_selection.existing_proxy_count', { defaultValue: '已在代理池' })}
          value={inspection.existingProxyCount}
        />
        <StatItem
          label={
            useFileProxy
              ? t('proxy_selection.new_proxy_count', { defaultValue: '将新增' })
              : t('proxy_selection.ignored_proxy_count', { defaultValue: '不会应用' })
          }
          value={useFileProxy ? inspection.newProxyCount : inspection.uniqueProxyCount}
        />
        <StatItem
          label={t('proxy_selection.no_proxy_file_count', { defaultValue: '无代理文件' })}
          value={inspection.filesWithoutProxy}
        />
        <StatItem
          label={t('proxy_selection.invalid_file_count', { defaultValue: '解析失败' })}
          value={inspection.failures.length}
          tone={inspection.failures.length > 0 ? 'bad' : 'neutral'}
        />
      </div>

      {inspection.compareFailed ? (
        <div className={styles.inspectionWarning}>
          {t('proxy_selection.compare_failed', {
            defaultValue: '代理池配置读取失败，上传后将由后端按文件内代理兜底处理。',
          })}
        </div>
      ) : null}

      {useFileProxy && visibleNewProxies.length > 0 ? (
        <ProxyGroupList
          title={t('proxy_selection.new_proxy_preview', { defaultValue: '将写入代理池' })}
          groups={visibleNewProxies}
          moreCount={hiddenNewProxyCount}
        />
      ) : null}

      {!useFileProxy && inspection.filesWithProxy > 0 ? (
        <div className={styles.inspectionHint}>
          {t('proxy_selection.file_proxy_ignored_hint', {
            defaultValue:
              '当前模式会覆盖或忽略文件内代理地址，不会因为这些文件自动新增代理池条目。',
          })}
        </div>
      ) : null}

      {visibleFailures.length > 0 ? (
        <div className={styles.failurePreview}>
          <div className={styles.proxyPreviewTitle}>
            {t('proxy_selection.parse_failure_preview', { defaultValue: '解析失败文件' })}
          </div>
          {visibleFailures.map((failure) => (
            <div className={styles.failureRow} key={`${failure.fileName}:${failure.error}`}>
              <span>{failure.fileName}</span>
              <em>{failure.error}</em>
            </div>
          ))}
          {hiddenFailureCount > 0 ? (
            <div className={styles.proxyPreviewMore}>
              {t('proxy_selection.more_failure_count', {
                defaultValue: '还有 {{count}} 个失败文件',
                count: hiddenFailureCount,
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatItem({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'bad';
}) {
  return (
    <div className={`${styles.statItem} ${tone === 'bad' ? styles.statItemBad : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ProxyGroupList({
  title,
  groups,
  moreCount,
}: {
  title: string;
  groups: AuthFileProxyInspectionGroup[];
  moreCount: number;
}) {
  const { t } = useTranslation();

  return (
    <div className={styles.proxyPreview}>
      <div className={styles.proxyPreviewTitle}>{title}</div>
      {groups.map((group) => (
        <div className={styles.proxyPreviewRow} key={group.proxyUrl}>
          <span>{group.redactedUrl}</span>
          <em>
            {t('proxy_selection.proxy_file_count', {
              defaultValue: '{{count}} 个文件',
              count: group.fileNames.length,
            })}
          </em>
        </div>
      ))}
      {moreCount > 0 ? (
        <div className={styles.proxyPreviewMore}>
          {t('proxy_selection.more_proxy_count', {
            defaultValue: '还有 {{count}} 个代理',
            count: moreCount,
          })}
        </div>
      ) : null}
    </div>
  );
}
