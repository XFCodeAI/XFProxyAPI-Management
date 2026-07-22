import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CredentialGroupsField } from '@/components/credentialGroups/CredentialGroupsField';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useCredentialGroupsCatalog } from '@/hooks/useCredentialGroupsCatalog';
import type {
  AuthFileGroupAssignmentSource,
  AuthFileGroupAssignmentState,
} from '@/features/authFiles/hooks/useAuthFilesData';
import { normalizeCredentialGroups } from '@/utils/credentialGroups';
import styles from './AuthFilesGroupAssignmentModal.module.scss';

interface AuthFilesGroupAssignmentModalProps {
  assignment: AuthFileGroupAssignmentState | null;
  open: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (groups: string[]) => Promise<void>;
}

export function AuthFilesGroupAssignmentModal({
  assignment,
  open,
  saving,
  error,
  onClose,
  onConfirm,
}: AuthFilesGroupAssignmentModalProps) {
  const { t } = useTranslation();
  const {
    groups: availableGroups,
    loading: groupsLoading,
    error: groupsError,
    ready: groupsReady,
    refresh: refreshGroups,
  } = useCredentialGroupsCatalog({
    enabled: open,
    retry: true,
  });
  const targets = useMemo(() => assignment?.targets ?? [], [assignment]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const targetKey = useMemo(
    () =>
      targets
        .map((target) => `${target.name}:${normalizeCredentialGroups(target.groups).join(',')}`)
        .join('|'),
    [targets]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedGroups(getCommonGroups(targets));
  }, [open, targetKey, targets]);

  if (!assignment) return null;

  const oauthAssignment = assignment.source === 'oauth';
  const title = getAssignmentTitle(t, assignment.source);
  const description = oauthAssignment
    ? t('auth_files.group_assignment_oauth_desc', {
        defaultValue: '为本次登录凭证设置分组。取消会保留现有分组不变。',
      })
    : t('auth_files.group_assignment_desc', {
        defaultValue: '为本次完成的凭证统一设置分组。取消会保留现有分组不变。',
      });

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      title={title}
      width={680}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm(selectedGroups)}
            loading={saving}
            disabled={saving || !groupsReady}
          >
            {t('auth_files.group_assignment_apply', { defaultValue: '应用分组' })}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <p className={styles.description}>{description}</p>

        <div className={styles.targetSection}>
          <div className={styles.sectionHeader}>
            <strong>
              {oauthAssignment
                ? t('auth_files.group_assignment_oauth_target', {
                    defaultValue: '本次登录凭证',
                  })
                : t('auth_files.group_assignment_targets', { defaultValue: '本次凭证' })}
            </strong>
            {!oauthAssignment ? (
              <span>
                {t('auth_files.group_assignment_target_count', {
                  defaultValue: '{{count}} 项',
                  count: targets.length,
                })}
              </span>
            ) : null}
          </div>
          <div className={styles.targetList}>
            {targets.map((target) => {
              const currentGroups = normalizeCredentialGroups(target.groups);
              return (
                <div key={target.name} className={styles.targetRow}>
                  <div className={styles.targetMain}>
                    <strong title={target.name}>{target.name}</strong>
                    <span>{formatTargetProvider(target)}</span>
                  </div>
                  <div className={styles.currentGroups}>
                    {currentGroups.length > 0 ? (
                      currentGroups.map((group) => (
                        <span key={group} className={styles.groupChip}>
                          {group}
                        </span>
                      ))
                    ) : (
                      <span className={styles.emptyGroups}>
                        {t('auth_files.groups_readonly_empty', { defaultValue: '未绑定分组' })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <CredentialGroupsField
          label={t('auth_files.group_assignment_field_label', { defaultValue: '目标分组' })}
          hint={
            groupsLoading
              ? t('common.loading')
              : oauthAssignment
                ? t('auth_files.group_assignment_oauth_field_hint', {
                    defaultValue: '确认后，该凭证会写入所选分组；不选择则清空分组。',
                  })
                : t('auth_files.group_assignment_field_hint', {
                    defaultValue: '确认后，本次凭证会统一写入所选分组；不选择则清空分组。',
                  })
          }
          options={availableGroups}
          selected={selectedGroups}
          onChange={setSelectedGroups}
          disabled={saving || !groupsReady}
          emptyText={t('auth_files.groups_empty')}
        />

        {groupsError ? (
          <div className={styles.catalogError}>
            <span>
              {t('auth_files.group_catalog_load_failed', {
                defaultValue: '分组列表加载失败：{{error}}',
                error: groupsError,
              })}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void refreshGroups()}
              disabled={saving || groupsLoading}
            >
              {t('auth_files.group_catalog_retry', { defaultValue: '立即重试' })}
            </Button>
          </div>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
      </div>
    </Modal>
  );
}

function getCommonGroups(targets: AuthFileGroupAssignmentState['targets']): string[] {
  if (targets.length === 0) return [];
  const [first, ...rest] = targets.map((target) => normalizeCredentialGroups(target.groups));
  return first.filter((group) =>
    rest.every((groups) => groups.some((item) => item.toLowerCase() === group.toLowerCase()))
  );
}

function getAssignmentTitle(
  t: ReturnType<typeof useTranslation>['t'],
  source: AuthFileGroupAssignmentSource
) {
  if (source === 'oauth') {
    return t('auth_files.group_assignment_oauth_title', { defaultValue: '登录凭证分组' });
  }
  if (source === 'session') {
    return t('auth_files.group_assignment_session_title', {
      defaultValue: 'Session 导入凭证分组',
    });
  }
  return t('auth_files.group_assignment_file_title', { defaultValue: '导入凭证分组' });
}

function formatTargetProvider(target: AuthFileGroupAssignmentState['targets'][number]): string {
  const provider = String(target.provider ?? target.type ?? '').trim();
  return provider || '-';
}
