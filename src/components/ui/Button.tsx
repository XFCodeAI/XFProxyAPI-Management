import { forwardRef, type ButtonHTMLAttributes, type PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';
import styles from './Button.module.scss';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, PropsWithChildren<ButtonProps>>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    className = '',
    disabled,
    ...rest
  },
  ref
) {
  const hasChildren = children !== null && children !== undefined && children !== false;
  const classes = cn(
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    className
  );

  return (
    <button ref={ref} className={classes} disabled={disabled || loading} {...rest}>
      {loading && (
        <span className={styles.spinner} aria-hidden="true" />
      )}
      {hasChildren ? children : null}
    </button>
  );
});
