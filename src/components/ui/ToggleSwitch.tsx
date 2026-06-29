import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './ToggleSwitch.module.scss';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  labelPosition?: 'left' | 'right';
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  labelPosition = 'right',
}: ToggleSwitchProps) {
  const switchControl = (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={styles.root}
    >
      <SwitchPrimitive.Thumb className={styles.thumb} />
    </SwitchPrimitive.Root>
  );

  if (!label) {
    return switchControl;
  }

  return (
    <label
      className={cn(
        styles.label,
        disabled ? styles.disabled : styles.enabled
      )}
    >
      {labelPosition === 'left' ? (
        <>
          <span>{label}</span>
          {switchControl}
        </>
      ) : (
        <>
          {switchControl}
          <span>{label}</span>
        </>
      )}
    </label>
  );
}
