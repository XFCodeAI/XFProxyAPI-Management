import { cn } from '@/lib/utils';
import styles from './statusStyles.module.scss';

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'muted';

const statusBadgeVariantClasses: Record<StatusBadgeVariant, string> = {
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
  muted: styles.muted,
};

export function getStatusBadgeClass(variant?: StatusBadgeVariant, className?: string) {
  return cn(styles.badge, variant ? statusBadgeVariantClasses[variant] : '', className);
}
