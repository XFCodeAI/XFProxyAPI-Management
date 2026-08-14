import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CredentialGroupsField } from '@/components/credentialGroups/CredentialGroupsField';
import { CredentialWeightInput } from '@/components/providers/CredentialWeightInput';
import { ConcurrencySettingField } from '@/components/concurrency/ConcurrencySettingField';
import {
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPlus,
  IconX,
} from '@/components/ui/icons';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { inputClass } from '@/components/ui/formStyles';
import { cn } from '@/lib/utils';
import { maskApiKey } from '@/utils/format';
import type { ApiKeyEntryInput } from '../../types';
import type { ConnectivityState, ConnectivityStatus } from './useConnectivityTest';
import { ConnectivityStatusIcon } from './ConnectivityStatusIcon';
import styles from './sharedForm.module.scss';

const COLLAPSED_LIMIT = 10;
const idleStatus: ConnectivityStatus = { state: 'idle' as ConnectivityState, message: '' };

const isBlankEntry = (entry: ApiKeyEntryInput): boolean =>
  !entry.apiKey.trim() && !entry.existingApiKey?.trim();

interface ApiKeyEntriesEditorProps {
  entries: ApiKeyEntryInput[];
  credentialGroupOptions: string[];
  credentialGroupsLabel: string;
  credentialGroupsHint: string;
  credentialGroupsEmpty: string;
  aliasLabel: string;
  aliasHint: string;
  removeDisabled: boolean;
  mutating: boolean;
  statuses: ConnectivityStatus[];
  isTestingAny: boolean;
  onUpdate: (idx: number, patch: Partial<ApiKeyEntryInput>) => void;
  onAdd: () => number;
  onRemove: (idx: number) => void;
  onTest: (idx: number) => void;
  onTestAll: () => void;
}

export function ApiKeyEntriesEditor({
  entries,
  credentialGroupOptions,
  credentialGroupsLabel,
  credentialGroupsHint,
  credentialGroupsEmpty,
  aliasLabel,
  aliasHint,
  removeDisabled,
  mutating,
  statuses,
  isTestingAny,
  onUpdate,
  onAdd,
  onRemove,
  onTest,
  onTestAll,
}: ApiKeyEntriesEditorProps) {
  const { t } = useTranslation();
  const inputIdPrefix = useId();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(() =>
    entries.length === 1 && isBlankEntry(entries[0]) ? 0 : null
  );
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const togglePasswordVisibility = (idx: number) => {
    setShowPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleAdd = () => {
    const idx = onAdd();
    setExpandedIdx(idx);
  };

  const handleRemove = (removeIdx: number) => {
    setShowPasswords((prev) => {
      if (!prev.size) return prev;
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < removeIdx) {
          next.add(idx);
        } else if (idx > removeIdx) {
          next.add(idx - 1);
        }
      });
      return next;
    });
    setExpandedIdx((prev) => {
      if (prev === null || prev === removeIdx) return null;
      return prev > removeIdx ? prev - 1 : prev;
    });
    onRemove(removeIdx);
  };

  const reversed = entries.map((entry, idx) => ({ entry, idx })).reverse();
  const visible = showAll ? reversed : reversed.slice(0, COLLAPSED_LIMIT);

  return (
    <div className={styles.entriesList}>
      <div className={`${styles.entriesToolbar} ${styles.entriesToolbarSplit}`}>
        <button type="button" className={styles.addBtn} disabled={mutating} onClick={handleAdd}>
          <IconPlus size={12} />
          <span>{t('providersPage.form.addApiKeyEntry')}</span>
        </button>
        <button
          type="button"
          className={styles.connectivityBtn}
          disabled={mutating || isTestingAny}
          onClick={onTestAll}
        >
          {isTestingAny ? (
            <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
              <IconLoader2 size={14} />
            </span>
          ) : null}
          <span>{t('providersPage.connectivity.testAll')}</span>
        </button>
      </div>
      {visible.map(({ entry, idx }) => {
        const status = statuses[idx] ?? idleStatus;
        const expanded = expandedIdx === idx;
        const summaryKey = entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
        const alias = entry.name?.trim() ?? '';
        const aliasInputId = `${inputIdPrefix}-entry-${idx}-alias`;
        const apiKeyInputId = `${inputIdPrefix}-entry-${idx}-api-key`;
        const proxyInputId = `${inputIdPrefix}-entry-${idx}-proxy`;
        const maxConcurrencyInputId = `${inputIdPrefix}-entry-${idx}-max-concurrency`;
        return (
          <div
            key={idx}
            className={cn(
              styles.entryCard,
              !expanded && status.state !== 'error' && styles.entryCardCollapsed
            )}
          >
            <div className={styles.entryCardHeader}>
              <button
                type="button"
                className={styles.entryCardToggle}
                aria-expanded={expanded}
                onClick={() => setExpandedIdx(expanded ? null : idx)}
              >
                <span className={styles.entryTitle}>
                  <span>{t('providersPage.form.apiKeyEntry', { index: idx + 1 })}</span>
                  {alias ? <span className={styles.entryAlias}>{alias}</span> : null}
                </span>
                <span className={styles.entrySummary}>
                  {entry.proxyUrl.trim() ? (
                    <span className={styles.entryBadge} title={entry.proxyUrl}>
                      {t('providersPage.form.proxyBadge')}
                    </span>
                  ) : null}
                  <span className={styles.entrySummaryKey}>
                    {summaryKey ? maskApiKey(summaryKey) : t('providersPage.status.notConfigured')}
                  </span>
                </span>
              </button>
              <div className={styles.entryCardHeaderRight}>
                <ConnectivityStatusIcon state={status.state} />
                <button
                  type="button"
                  className={styles.connectivityBtnGhost}
                  disabled={mutating || status.state === 'loading'}
                  onClick={() => onTest(idx)}
                >
                  {status.state === 'loading' ? (
                    <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                      <IconLoader2 size={14} />
                    </span>
                  ) : null}
                  <span>{t('providersPage.connectivity.test')}</span>
                </button>
                <TooltipIconButton
                  className={styles.entryCardIconBtn}
                  onClick={() => setExpandedIdx(expanded ? null : idx)}
                  label={expanded ? t('common.collapse') : t('common.expand')}
                  aria-expanded={expanded}
                >
                  <IconChevronDown
                    className={cn(styles.entryCardChevron, expanded && styles.entryCardChevronOpen)}
                    size={14}
                  />
                </TooltipIconButton>
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || removeDisabled}
                  onClick={() => handleRemove(idx)}
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
            {status.state === 'error' ? (
              <div className={styles.connectivityError}>{status.message}</div>
            ) : null}
            {expanded ? (
              <div className={styles.entryCardBody}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={aliasInputId}>
                    {aliasLabel}
                    <span className={styles.labelHint}> · {aliasHint}</span>
                  </label>
                  <input
                    id={aliasInputId}
                    className={inputClass}
                    value={entry.name ?? ''}
                    onChange={(e) => onUpdate(idx, { name: e.target.value })}
                    disabled={mutating}
                  />
                </div>
                <CredentialGroupsField
                  label={credentialGroupsLabel}
                  hint={credentialGroupsHint}
                  options={credentialGroupOptions}
                  selected={entry.groups ?? []}
                  onChange={(next) => onUpdate(idx, { groups: next })}
                  disabled={mutating}
                  emptyText={credentialGroupsEmpty}
                />
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={apiKeyInputId}>
                    {t('providersPage.form.apiKey')}
                  </label>
                  <div className={styles.passwordField}>
                    <input
                      id={apiKeyInputId}
                      className={cn(inputClass, styles.passwordInput)}
                      type={showPasswords.has(idx) ? 'text' : 'password'}
                      value={entry.apiKey}
                      onChange={(e) => onUpdate(idx, { apiKey: e.target.value })}
                      autoComplete="new-password"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                      disabled={mutating}
                      placeholder={
                        entry.existingApiKey
                          ? t('providersPage.form.apiKeyEditPlaceholder')
                          : t('providersPage.form.apiKeyCreatePlaceholder')
                      }
                    />
                    <TooltipIconButton
                      className={styles.passwordToggle}
                      onClick={() => togglePasswordVisibility(idx)}
                      disabled={mutating}
                      label={
                        showPasswords.has(idx)
                          ? t('providersPage.form.hideApiKey')
                          : t('providersPage.form.showApiKey')
                      }
                    >
                      {showPasswords.has(idx) ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </TooltipIconButton>
                  </div>
                </div>
                <CredentialWeightInput
                  value={entry.weight}
                  disabled={mutating}
                  onChange={(value) => onUpdate(idx, { weight: value })}
                />
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={proxyInputId}>
                    {t('providersPage.form.proxyUrl')}
                  </label>
                  <input
                    id={proxyInputId}
                    className={inputClass}
                    value={entry.proxyUrl}
                    onChange={(e) => onUpdate(idx, { proxyUrl: e.target.value })}
                    disabled={mutating}
                    placeholder="http://127.0.0.1:7890"
                  />
                </div>
                <ConcurrencySettingField
                  id={maxConcurrencyInputId}
                  label={t('providersPage.form.keyMaxConcurrency')}
                  mode={entry.concurrencyMode ?? 'inherit'}
                  maxConcurrency={entry.maxConcurrency ?? 0}
                  disabled={mutating}
                  onModeChange={(value) => onUpdate(idx, { concurrencyMode: value })}
                  onMaxConcurrencyChange={(value) =>
                    onUpdate(idx, {
                      maxConcurrency: value === '' ? 0 : Number(value),
                    })
                  }
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {entries.length > COLLAPSED_LIMIT ? (
        <button type="button" className={styles.showMoreBtn} onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t('providersPage.form.showFewerEntries')
            : t('providersPage.form.showAllEntries', { count: entries.length })}
        </button>
      ) : null}
    </div>
  );
}
