import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { inputClass, textareaClass } from '@/components/ui/formStyles';
import { IconChevronDown, IconPlus, IconX } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import type { ModelEntryInput } from '../../types';
import styles from './sharedForm.module.scss';

const COLLAPSED_LIMIT = 10;

interface ModelEntriesEditorProps {
  models: ModelEntryInput[];
  extendedOptions: boolean;
  mutating: boolean;
  removeDisabled: boolean;
  onUpdate: (idx: number, patch: Partial<ModelEntryInput>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}

export function ModelEntriesEditor({
  models,
  extendedOptions,
  mutating,
  removeDisabled,
  onUpdate,
  onAdd,
  onRemove,
}: ModelEntriesEditorProps) {
  const { t } = useTranslation();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const handleAdd = () => {
    if (!showAll && models.length >= COLLAPSED_LIMIT) {
      setShowAll(true);
    }
    onAdd();
  };

  const handleRemove = (removeIdx: number) => {
    setExpandedIdx((prev) => {
      if (prev === null || prev === removeIdx) return null;
      return prev > removeIdx ? prev - 1 : prev;
    });
    onRemove(removeIdx);
  };

  const visible = showAll ? models : models.slice(0, COLLAPSED_LIMIT);

  return (
    <>
      {visible.map((entry, idx) => {
        const expanded = extendedOptions && expandedIdx === idx;
        const hasThinking = (entry.thinkingJson ?? '').trim().length > 0;
        return (
          <div key={idx} className={styles.modelEntry}>
            <div className={styles.modelAliasRow}>
              <input
                className={inputClass}
                placeholder="model-name"
                value={entry.name}
                onChange={(e) => onUpdate(idx, { name: e.target.value })}
                disabled={mutating}
              />
              <input
                className={inputClass}
                placeholder="alias (optional)"
                value={entry.alias ?? ''}
                onChange={(e) => onUpdate(idx, { alias: e.target.value })}
                disabled={mutating}
              />
              <div className={styles.modelEntryActions}>
                {extendedOptions && !expanded && entry.image === true ? (
                  <span className={styles.entryBadge}>
                    {t('providersPage.form.modelBadgeImage')}
                  </span>
                ) : null}
                {extendedOptions && !expanded && hasThinking ? (
                  <span className={styles.entryBadge}>
                    {t('providersPage.form.modelBadgeThinking')}
                  </span>
                ) : null}
                {extendedOptions ? (
                  <TooltipIconButton
                    className={styles.entryCardIconBtn}
                    onClick={() => setExpandedIdx(expanded ? null : idx)}
                    label={expanded ? t('common.collapse') : t('common.expand')}
                    aria-expanded={expanded}
                  >
                    <IconChevronDown
                      className={cn(
                        styles.entryCardChevron,
                        expanded && styles.entryCardChevronOpen
                      )}
                      size={14}
                    />
                  </TooltipIconButton>
                ) : null}
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
            {expanded ? (
              <div className={styles.modelEntryDetails}>
                <SelectionCheckbox
                  checked={entry.image === true}
                  disabled={mutating}
                  onChange={(checked) => onUpdate(idx, { image: checked })}
                  className={styles.checkboxRow}
                  labelClassName={styles.checkboxText}
                  label={
                    <>
                      <span>{t('providersPage.form.modelImage')}</span>
                      <small>{t('providersPage.form.modelImageHint')}</small>
                    </>
                  }
                />
                <div className={styles.field}>
                  <label className={styles.label}>
                    {t('providersPage.form.thinkingConfig')}
                    <span className={styles.labelHint}>
                      {' '}
                      · {t('providersPage.form.thinkingConfigHint')}
                    </span>
                  </label>
                  <textarea
                    className={cn(textareaClass, styles.textarea)}
                    rows={4}
                    value={entry.thinkingJson ?? ''}
                    onChange={(e) => onUpdate(idx, { thinkingJson: e.target.value })}
                    disabled={mutating}
                    placeholder={'{"levels":["low","medium","high"]}'}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {models.length > COLLAPSED_LIMIT ? (
        <button type="button" className={styles.showMoreBtn} onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t('providersPage.form.showFewerEntries')
            : t('providersPage.form.showAllEntries', { count: models.length })}
        </button>
      ) : null}
      <button type="button" className={styles.addBtn} disabled={mutating} onClick={handleAdd}>
        <IconPlus size={12} />
        <span>{t('providersPage.form.addModel')}</span>
      </button>
    </>
  );
}
