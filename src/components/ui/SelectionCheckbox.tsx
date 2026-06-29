import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import type { ReactNode } from 'react';
import { IconCheck } from './icons';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';

interface SelectionCheckboxProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
}

export function SelectionCheckbox({
  checked,
  onChange,
  label,
  ariaLabel,
  title,
  disabled = false,
  className,
  labelClassName,
}: SelectionCheckboxProps) {
  const control = (
    <label
      className={cn(
        'inline-flex min-w-0 items-center gap-2 text-sm text-[var(--foreground)]',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
        className
      )}
    >
      <CheckboxPrimitive.Root
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        aria-label={ariaLabel}
        disabled={disabled}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded border border-[var(--input)] bg-[var(--background)] text-[var(--primary-foreground)] shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--primary)] data-[state=checked]:bg-[var(--primary)]"
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <IconCheck size={12} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? <div className={cn('min-w-0', labelClassName)}>{label}</div> : null}
    </label>
  );

  if (!title) return control;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}
