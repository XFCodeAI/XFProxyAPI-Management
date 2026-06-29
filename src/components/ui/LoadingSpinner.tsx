import { cn } from '@/lib/utils';

export function LoadingSpinner({
  size = 20,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('inline-block animate-spin rounded-full border-current border-r-transparent text-[var(--primary)]', className)}
      style={{ width: size, height: size, borderWidth: Math.max(2, size / 7) }}
      role="status"
      aria-live="polite"
    />
  );
}
