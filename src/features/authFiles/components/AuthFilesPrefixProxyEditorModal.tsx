import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  fieldErrorClass,
  fieldHintClass,
  fieldLabelClass,
  fieldRootClass,
  textareaClass,
} from '@/components/ui/formStyles';
import { cn } from '@/lib/utils';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFilesPrefixProxyEditorModalProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
};

export function AuthFilesPrefixProxyEditorModal(props: AuthFilesPrefixProxyEditorModalProps) {
  const { t } = useTranslation();
  const { disableControls, editor, updatedText, dirty, onClose, onCopyText, onSave, onChange } =
    props;
  const formatJsonText = (text: string) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const previewText = formatJsonText(updatedText);
  const invalidContentPreview = editor?.invalidContentPreview ?? '';

  return (
    <Modal
      open={Boolean(editor)}
      onClose={onClose}
      closeDisabled={editor?.saving === true}
      width="min(860px, calc(100vw - 2rem))"
      bodyClassName={styles.prefixProxyEditorModalBody}
      title={
        editor?.fileName
          ? t('auth_files.auth_field_editor_title', { name: editor.fileName })
          : t('auth_files.prefix_proxy_button')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={editor?.saving === true}>
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.prefixProxyEditor}>
          {editor.loading ? (
            <div className={styles.prefixProxyLoading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.prefixProxyError}>{editor.error}</div>}
              {editor.json && (
                <section className={styles.prefixProxySection}>
                  <div className={styles.prefixProxySectionHeader}>
                    <h3 className={styles.prefixProxySectionTitle}>
                      {t('auth_files.prefix_proxy_edit_section')}
                    </h3>
                  </div>
                  <div className={styles.prefixProxyFields}>
                    <div className={cn(fieldRootClass, styles.prefixProxyReadonlyGroups)}>
                      <div className={fieldLabelClass}>{t('auth_files.groups_label')}</div>
                      {editor.groups.length > 0 ? (
                        <div className={styles.prefixProxyGroupChips}>
                          {editor.groups.map((group) => (
                            <span key={group} className={styles.prefixProxyGroupChip}>
                              {group}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.prefixProxyGroupsEmpty}>
                          {t('auth_files.groups_readonly_empty', {
                            defaultValue: '未绑定分组',
                          })}
                        </div>
                      )}
                      <div className={fieldHintClass}>
                        {t('auth_files.groups_readonly_hint', {
                          defaultValue: '分组只能在分组管理，或导入/登录完成后的分组弹窗中调整。',
                        })}
                      </div>
                    </div>
                    <Input
                      label={t('auth_files.prefix_label')}
                      value={editor.prefix}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('prefix', e.target.value)}
                    />
                    <Input
                      label={t('auth_files.proxy_url_label')}
                      value={editor.proxyUrl}
                      placeholder={t('auth_files.proxy_url_placeholder')}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('proxyUrl', e.target.value)}
                    />
                    <Input
                      label={t('auth_files.priority_label')}
                      value={editor.priority}
                      placeholder={t('auth_files.priority_placeholder')}
                      hint={t('auth_files.priority_hint')}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('priority', e.target.value)}
                    />
                    {editor.providerKey === 'codex' && (
                      <div
                        className={cn(
                          fieldRootClass,
                          styles.prefixProxyToggleField,
                          styles.prefixProxyFullField
                        )}
                      >
                        <label className={fieldLabelClass}>
                          {t('auth_files.codex_websockets_label')}
                        </label>
                        <ToggleSwitch
                          checked={editor.websockets}
                          onChange={(value) => onChange('websockets', value)}
                          disabled={disableControls || editor.saving || !editor.json}
                          ariaLabel={t('auth_files.codex_websockets_label')}
                        />
                        <div className={fieldHintClass}>
                          {t('auth_files.codex_websockets_hint')}
                        </div>
                      </div>
                    )}
                    <div className={cn(fieldRootClass, styles.prefixProxyFullField)}>
                      <label className={fieldLabelClass}>{t('auth_files.headers_label')}</label>
                      <textarea
                        className={cn(
                          textareaClass,
                          styles.prefixProxyHeadersTextarea,
                          editor.headersError ? styles.prefixProxyTextareaInvalid : ''
                        )}
                        value={editor.headersText}
                        placeholder={t('auth_files.headers_placeholder')}
                        rows={4}
                        aria-invalid={Boolean(editor.headersError)}
                        disabled={disableControls || editor.saving || !editor.json}
                        onChange={(e) => onChange('headersText', e.target.value)}
                      />
                      {editor.headersError && (
                        <div className={fieldErrorClass}>{editor.headersError}</div>
                      )}
                      <div className={fieldHintClass}>{t('auth_files.headers_hint')}</div>
                    </div>
                    <Input
                      wrapperClassName={styles.prefixProxyFullField}
                      label={t('auth_files.note_label')}
                      value={editor.note}
                      placeholder={t('auth_files.note_placeholder')}
                      hint={t('auth_files.note_hint')}
                      disabled={disableControls || editor.saving || !editor.json}
                      onChange={(e) => onChange('note', e.target.value)}
                    />
                  </div>
                </section>
              )}
              <section className={styles.prefixProxySection}>
                <div className={styles.prefixProxySectionHeader}>
                  <h3 className={styles.prefixProxySectionTitle}>
                    {t('auth_files.prefix_proxy_preview_section')}
                  </h3>
                </div>
                <div className={styles.prefixProxyPreviewGrid}>
                  <div className={styles.prefixProxyJsonWrapper}>
                    <label className={styles.prefixProxyLabel}>
                      {t('auth_files.prefix_proxy_info_label')}
                    </label>
                    <textarea
                      className={cn(styles.prefixProxyTextarea, styles.prefixProxyPreviewTextarea)}
                      rows={5}
                      readOnly
                      value={editor.fileInfoText}
                    />
                  </div>
                  <div className={styles.prefixProxyJsonWrapper}>
                    <label className={styles.prefixProxyLabel}>
                      {editor.json
                        ? t('auth_files.prefix_proxy_source_label')
                        : t('auth_files.prefix_proxy_invalid_content_label')}
                    </label>
                    {editor.json ? (
                      <textarea
                        className={cn(
                          styles.prefixProxyTextarea,
                          styles.prefixProxyPreviewTextarea
                        )}
                        rows={6}
                        readOnly
                        value={previewText}
                      />
                    ) : (
                      <pre className={styles.prefixProxyInvalidContentPreview}>
                        {invalidContentPreview}
                      </pre>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
