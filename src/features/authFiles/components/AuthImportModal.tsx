import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileJson, TextCursorInput, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  buildGptSessionCpaFileSpecs,
  consumeGptSessionInput,
  type GptSessionImportIssue,
  type GptSessionImportRecord,
  type GptSessionImportResult,
} from '@/features/authFiles/gptSessionImport';
import styles from './AuthImportModal.module.scss';

type ImportMode = 'file' | 'gpt-session';

interface AuthImportModalProps {
  open: boolean;
  importing?: boolean;
  onClose: () => void;
  onPickFiles: () => void;
  onImportFiles: (files: File[]) => void;
}

export function AuthImportModal({
  open,
  importing = false,
  onClose,
  onPickFiles,
  onImportFiles,
}: AuthImportModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ImportMode>('file');
  const [sessionText, setSessionText] = useState('');
  const [stagedRecords, setStagedRecords] = useState<GptSessionImportRecord[]>([]);
  const [sessionIssues, setSessionIssues] = useState<GptSessionImportIssue[]>([]);
  const importResult = buildSessionImportResult(stagedRecords, sessionIssues);
  const canImportSession = stagedRecords.length > 0 && !importing;

  const resetSessionImport = () => {
    setSessionText('');
    setStagedRecords([]);
    setSessionIssues([]);
  };

  const handleClose = () => {
    resetSessionImport();
    onClose();
  };

  const handlePickFiles = () => {
    handleClose();
    onPickFiles();
  };

  const handleSessionTextChange = (value: string) => {
    const consumed = consumeGptSessionInput(value);
    setSessionText(consumed.remainingText);
    setSessionIssues(consumed.issues);

    if (consumed.records.length === 0) {
      return;
    }

    setStagedRecords((currentRecords) => {
      const knownAccessTokens = new Set(
        currentRecords.map((record) => record.cpa.access_token).filter(Boolean)
      );
      const newRecords = consumed.records.filter((record) => {
        if (knownAccessTokens.has(record.cpa.access_token)) {
          return false;
        }
        knownAccessTokens.add(record.cpa.access_token);
        return true;
      });
      return newRecords.length > 0 ? [...currentRecords, ...newRecords] : currentRecords;
    });
  };

  const handleImportSession = () => {
    if (!canImportSession) return;
    const files = buildGptSessionCpaFileSpecs(stagedRecords).map(
      (spec) => new File([spec.content], spec.fileName, { type: 'application/json' })
    );
    resetSessionImport();
    onClose();
    onImportFiles(files);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('auth_files.import_modal_title', { defaultValue: '导入认证' })}
      width={620}
      footer={
        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={importing}>
            {t('common.cancel')}
          </Button>
          {mode === 'gpt-session' && stagedRecords.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={resetSessionImport}
              disabled={importing}
            >
              {t('auth_files.import_gpt_session_clear', { defaultValue: '清空预览' })}
            </Button>
          ) : null}
          {mode === 'file' ? (
            <Button type="button" onClick={handlePickFiles} disabled={importing}>
              <Upload size={16} aria-hidden="true" />
              {t('auth_files.import_file_pick', { defaultValue: '选择 JSON 文件' })}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleImportSession}
              disabled={!canImportSession}
              loading={importing}
            >
              {t('auth_files.import_gpt_session_confirm', { defaultValue: '导入 CPA' })}
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.content}>
        <div className={styles.modeSwitch} role="tablist" aria-label={t('auth_files.import_mode')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'file'}
            className={`${styles.modeButton} ${mode === 'file' ? styles.modeButtonActive : ''}`}
            onClick={() => setMode('file')}
          >
            <FileJson size={16} aria-hidden="true" />
            {t('auth_files.import_mode_file', { defaultValue: '文件导入' })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'gpt-session'}
            className={`${styles.modeButton} ${
              mode === 'gpt-session' ? styles.modeButtonActive : ''
            }`}
            onClick={() => setMode('gpt-session')}
          >
            <TextCursorInput size={16} aria-hidden="true" />
            {t('auth_files.import_mode_gpt_session', { defaultValue: 'GPT Session 文本导入' })}
          </button>
        </div>

        {mode === 'file' ? (
          <div className={styles.filePanel}>
            <div>
              <h3>{t('auth_files.import_file_title', { defaultValue: '导入认证文件' })}</h3>
              <p>
                {t('auth_files.import_file_desc', {
                  defaultValue: '选择一个或多个 JSON 认证文件，后续会继续进入代理选择。',
                })}
              </p>
            </div>
          </div>
        ) : (
          <div className={styles.sessionPanel}>
            <label className={styles.fieldLabel} htmlFor="gpt-session-import-text">
              {t('auth_files.import_gpt_session_label', { defaultValue: 'GPT Session JSON' })}
            </label>
            <textarea
              id="gpt-session-import-text"
              className={styles.sessionInput}
              value={sessionText}
              onChange={(event) => handleSessionTextChange(event.target.value)}
              spellCheck={false}
              placeholder={t('auth_files.import_gpt_session_placeholder', {
                defaultValue:
                  '{"user":{"email":"mark@example.com"},"accessToken":"...","sessionToken":"..."}',
              })}
            />
            <SessionImportSummary result={importResult} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function buildSessionImportResult(
  records: GptSessionImportRecord[],
  issues: GptSessionImportIssue[]
): GptSessionImportResult {
  return {
    records,
    issues,
    missingRefreshTokenCount: records.filter((record) => !record.hasRefreshToken).length,
    syntheticIdTokenCount: records.filter((record) => record.syntheticIdToken).length,
  };
}

function SessionImportSummary({ result }: { result: GptSessionImportResult }) {
  const { t } = useTranslation();
  const visibleIssues = result.issues.slice(0, 3);
  const hiddenIssueCount = Math.max(0, result.issues.length - visibleIssues.length);

  if (result.records.length === 0 && result.issues.length === 0) {
    return (
      <div className={styles.emptyHint}>
        {t('auth_files.import_gpt_session_empty', { defaultValue: '等待粘贴 Session JSON。' })}
      </div>
    );
  }

  return (
    <div className={styles.summary}>
      <div className={styles.statsGrid}>
        <StatItem
          label={t('auth_files.import_stat_ready', { defaultValue: '可导入' })}
          value={result.records.length}
        />
        <StatItem
          label={t('auth_files.import_stat_missing_refresh', { defaultValue: '无刷新令牌' })}
          value={result.missingRefreshTokenCount}
          tone={result.missingRefreshTokenCount > 0 ? 'warn' : 'neutral'}
        />
        <StatItem
          label={t('auth_files.import_stat_synthetic_id', { defaultValue: '占位 ID Token' })}
          value={result.syntheticIdTokenCount}
        />
        <StatItem
          label={t('auth_files.import_stat_skipped', { defaultValue: '跳过' })}
          value={result.issues.length}
          tone={result.issues.length > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {result.missingRefreshTokenCount > 0 ? (
        <div className={styles.warning}>
          {t('auth_files.import_missing_refresh_warning', {
            defaultValue:
              '部分 Session 没有 refresh_token，导入后可能只能在 access token 过期前使用。',
          })}
        </div>
      ) : null}

      {result.records.length > 0 ? (
        <div className={styles.previewList}>
          {result.records.map((record) => (
            <SessionPreviewRow
              key={`${record.sourceName}:${record.sourcePath}:${record.cpa.access_token}`}
              record={record}
            />
          ))}
        </div>
      ) : null}

      {visibleIssues.length > 0 ? (
        <div className={styles.issueList}>
          {visibleIssues.map((issue) => (
            <div className={styles.issueRow} key={`${issue.sourceName}:${issue.path}`}>
              <span>{issue.path}</span>
              <em>{issue.reason}</em>
            </div>
          ))}
          {hiddenIssueCount > 0 ? (
            <div className={styles.moreRow}>
              {t('auth_files.import_more_issues', {
                defaultValue: '还有 {{count}} 个跳过项',
                count: hiddenIssueCount,
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SessionPreviewRow({ record }: { record: GptSessionImportRecord }) {
  return (
    <div className={styles.previewRow}>
      <div className={styles.previewMain}>
        <strong>{record.email || record.name}</strong>
        <span>{record.fileName}</span>
      </div>
      <div className={styles.previewMeta}>
        <span>{record.planType || '-'}</span>
        <span>{formatDate(record.expiresAt) || '-'}</span>
      </div>
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
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div className={`${styles.statItem} ${tone === 'warn' ? styles.statItemWarn : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
