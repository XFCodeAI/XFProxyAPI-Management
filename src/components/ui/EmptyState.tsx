import type { ReactNode } from 'react';
import { IconInbox } from './icons';
import styles from './EmptyState.module.scss';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <div className={styles.icon} aria-hidden="true">
          <IconInbox size={20} />
        </div>
        <div>
          <div className={styles.title}>{title}</div>
          {description ? <div className={styles.description}>{description}</div> : null}
        </div>
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
