import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  fieldErrorClass,
  fieldHintClass,
  fieldLabelClass,
  fieldRootClass,
  inputClass,
  inputRightClass,
  inputShellClass,
  inputWithRightClass,
} from './formStyles';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  rightElement?: ReactNode;
  wrapperClassName?: string;
  wrapperStyle?: CSSProperties;
}

export function Input({
  label,
  hint,
  error,
  rightElement,
  wrapperClassName,
  wrapperStyle,
  className = '',
  id,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy =
    [rest['aria-describedby'], errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn(fieldRootClass, wrapperClassName)} style={wrapperStyle}>
      {label && (
        <label htmlFor={inputId} className={fieldLabelClass}>
          {label}
        </label>
      )}
      <div className={inputShellClass}>
        <input
          id={inputId}
          className={cn(
            inputClass,
            rightElement ? inputWithRightClass : '',
            className
          )}
          aria-invalid={Boolean(error) || rest['aria-invalid']}
          aria-describedby={describedBy}
          {...rest}
        />
        {rightElement && (
          <div className={inputRightClass}>{rightElement}</div>
        )}
      </div>
      {hint && (
        <div id={hintId} className={fieldHintClass}>
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className={fieldErrorClass}>
          {error}
        </div>
      )}
    </div>
  );
}
