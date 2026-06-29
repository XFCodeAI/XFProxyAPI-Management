import type { PropsWithChildren, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './Card.module.scss';

interface CardProps {
  title?: ReactNode;
  extra?: ReactNode;
  className?: string;
}

export function Card({ title, extra, children, className }: PropsWithChildren<CardProps>) {
  return (
    <div className={cn(styles.card, className)}>
      {(title || extra) && (
        <div className={styles.header}>
          <div className={styles.title}>{title}</div>
          {extra ? <div className={styles.extra}>{extra}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}
