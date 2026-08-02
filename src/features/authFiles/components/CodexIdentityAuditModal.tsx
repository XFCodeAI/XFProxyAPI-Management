import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  authFilesApi,
  type CodexIdentityAuditIssue,
  type CodexIdentityAuditResult,
} from '@/services/api';
import { getErrorMessage } from '@/utils/helpers';
import styles from './CodexIdentityAuditModal.module.scss';

interface CodexIdentityAuditModalProps {
  open: boolean;
  onClose: () => void;
}

const issueTranslationKeys: Record<string, string> = {
  missing_selected_workspace: 'auth_files.codex_identity_audit_issue_missing_workspace',
  token_claim_mismatch: 'auth_files.codex_identity_audit_issue_claim_mismatch',
  non_canonical_name: 'auth_files.codex_identity_audit_issue_legacy_name',
  canonical_name_collision: 'auth_files.codex_identity_audit_issue_name_collision',
};

const issueLabel = (issue: CodexIdentityAuditIssue, t: (key: string) => string): string =>
  t(issueTranslationKeys[issue.issue] ?? 'auth_files.codex_identity_audit_issue_unknown');

function AuditIssueRow({ issue, t }: { issue: CodexIdentityAuditIssue; t: (key: string) => string }) {
  return (
    <div className={styles.issueRow}>
      <div className={styles.issueMain}>
        <strong>{issue.name}</strong>
        {issue.canonicalName && issue.canonicalName !== issue.name ? (
          <span>
            {t('auth_files.codex_identity_audit_canonical_name')}: {issue.canonicalName}
          </span>
        ) : null}
        <span className={styles.issueLabel}>{issueLabel(issue, t)}</span>
      </div>
      <div className={styles.issueMeta}>
        {issue.workspaceFingerprint ? (
          <span>
            {t('auth_files.codex_identity_audit_workspace_fingerprint')}: {issue.workspaceFingerprint}
          </span>
        ) : (
          <span>{t('auth_files.codex_identity_audit_workspace_missing')}</span>
        )}
        {issue.requiresReauthorization ? (
          <span>{t('auth_files.codex_identity_audit_requires_reauthorization')}</span>
        ) : null}
        {issue.requiresReimport ? (
          <span>{t('auth_files.codex_identity_audit_requires_reimport')}</span>
        ) : null}
        {!issue.workspaceInferenceAvailable ? (
          <span>{t('auth_files.codex_identity_audit_no_inference')}</span>
        ) : null}
      </div>
    </div>
  );
}

export function CodexIdentityAuditModal({ open, onClose }: CodexIdentityAuditModalProps) {
  const { t } = useTranslation();
  const [audit, setAudit] = useState<CodexIdentityAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAudit(await authFilesApi.getCodexIdentityAudit());
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('auth_files.codex_identity_audit_load_failed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void loadAudit();
  }, [loadAudit, open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.codex_identity_audit_title')}
      width="min(900px, calc(100vw - 2rem))"
      headerAction={
        <TooltipIconButton
          label={t('auth_files.codex_identity_audit_refresh')}
          onClick={() => void loadAudit()}
          disabled={loading}
        >
          <IconRefreshCw size={16} />
        </TooltipIconButton>
      }
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className={styles.content}>
        {error ? <div className={styles.errorBox}>{error}</div> : null}

        {loading && !audit ? (
          <div className={styles.loadingState} role="status" aria-live="polite">
            <LoadingSpinner size={20} />
            <span>{t('auth_files.codex_identity_audit_loading')}</span>
          </div>
        ) : audit ? (
          <>
            <div className={styles.summary}>
              <span>
                {t('auth_files.codex_identity_audit_scanned', { count: audit.scanned })}
              </span>
              <span data-state={audit.issueCount > 0 ? 'warning' : 'ok'}>
                {audit.issueCount > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                {t('auth_files.codex_identity_audit_issues', { count: audit.issueCount })}
              </span>
            </div>

            {audit.issues.length === 0 ? (
              <div className={styles.emptyState}>
                <CheckCircle2 size={20} />
                <span>{t('auth_files.codex_identity_audit_no_issues')}</span>
              </div>
            ) : (
              <div className={styles.issueList}>
                {audit.issues.map((issue, index) => (
                  <AuditIssueRow key={`${issue.name}:${issue.issue}:${index}`} issue={issue} t={t} />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
