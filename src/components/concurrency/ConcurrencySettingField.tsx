import { useTranslation } from 'react-i18next';
import type { ConcurrencyMode } from '@/types/concurrency';
import { MAX_CONCURRENCY } from '@/utils/maxConcurrency';
import { useCredentialConcurrencyStore } from '@/stores/useCredentialConcurrencyStore';
import styles from './ConcurrencySettingField.module.scss';

interface ConcurrencySettingFieldProps {
  id: string;
  label: string;
  mode: ConcurrencyMode;
  maxConcurrency: string | number;
  disabled?: boolean;
  error?: string;
  className?: string;
  onModeChange: (mode: ConcurrencyMode) => void;
  onMaxConcurrencyChange: (value: string) => void;
}

export function ConcurrencySettingField({
  id,
  label,
  mode,
  maxConcurrency,
  disabled = false,
  error,
  className = '',
  onModeChange,
  onMaxConcurrencyChange,
}: ConcurrencySettingFieldProps) {
  const { t } = useTranslation();
  const defaultMaxConcurrency = useCredentialConcurrencyStore(
    (state) => state.defaultMaxConcurrency
  );
  const inheritedValue =
    defaultMaxConcurrency > 0
      ? String(defaultMaxConcurrency)
      : t('runtime_observation.unlimited');
  const hint =
    mode === 'inherit'
      ? t('concurrency.inherit_hint', { value: inheritedValue })
      : t('concurrency.independent_hint');

  return (
    <div className={`${styles.field} ${className}`.trim()}>
      <span className={styles.label}>{label}</span>
      <div className={styles.modeControl} role="group" aria-label={t('concurrency.mode_label')}>
        {(['inherit', 'independent'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={option === mode ? styles.modeButtonActive : styles.modeButton}
            aria-pressed={option === mode}
            disabled={disabled}
            onClick={() => onModeChange(option)}
          >
            {t(`concurrency.mode_${option}`)}
          </button>
        ))}
      </div>
      <label className={styles.valueLabel} htmlFor={`${id}-value`}>
        {t('concurrency.independent_value')}
      </label>
      <input
        id={`${id}-value`}
        className={styles.input}
        type="number"
        min={0}
        max={MAX_CONCURRENCY}
        step={1}
        value={maxConcurrency}
        disabled={disabled || mode !== 'independent'}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        onChange={(event) => onMaxConcurrencyChange(event.target.value)}
      />
      <span id={`${id}-hint`} className={styles.hint}>
        {hint}
      </span>
      {error ? (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
