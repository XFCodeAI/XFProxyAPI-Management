import { useMemo } from 'react';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { cn } from '@/lib/utils';
import { fieldHintClass, fieldLabelClass, fieldRootClass } from '@/components/ui/formStyles';
import styles from './CredentialGroupsField.module.scss';

interface CredentialGroupsFieldProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  hint?: string;
  emptyText?: string;
  className?: string;
}

export function CredentialGroupsField({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  hint,
  emptyText,
  className,
}: CredentialGroupsFieldProps) {
  const mergedOptions = useMemo(() => {
    const merged: string[] = [];
    const seen = new Set<string>();

    [...options, ...selected].forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(trimmed);
    });

    return merged;
  }, [options, selected]);

  const selectedKeys = useMemo(() => new Set(selected.map((item) => item.toLowerCase())), [selected]);

  const toggleGroup = (group: string, checked: boolean) => {
    const key = group.toLowerCase();
    if (checked) {
      if (selectedKeys.has(key)) return;
      onChange([...selected, group]);
      return;
    }
    onChange(selected.filter((item) => item.toLowerCase() !== key));
  };

  return (
    <div className={cn(fieldRootClass, styles.groupField, className)}>
      <div className={fieldLabelClass}>{label}</div>
      {selected.length > 0 ? (
        <div className={styles.selectedRow}>
          {selected.map((group) => (
            <span key={group} className={styles.selectedChip}>
              {group}
            </span>
          ))}
        </div>
      ) : null}
      {mergedOptions.length > 0 ? (
        <div className={styles.optionsGrid}>
          {mergedOptions.map((group) => (
            <SelectionCheckbox
              key={group}
              checked={selectedKeys.has(group.toLowerCase())}
              disabled={disabled}
              onChange={(checked) => toggleGroup(group, checked)}
              className={styles.optionCheckbox}
              labelClassName={styles.optionLabel}
              label={<span>{group}</span>}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>{emptyText}</div>
      )}
      {hint ? <div className={fieldHintClass}>{hint}</div> : null}
    </div>
  );
}
