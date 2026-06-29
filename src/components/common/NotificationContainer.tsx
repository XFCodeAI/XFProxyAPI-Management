import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';
import { IconX } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';
import styles from './NotificationContainer.module.scss';

interface AnimatedNotification extends Notification {
  isExiting?: boolean;
}

const ANIMATION_DURATION = 300; // ms

const notificationVariantClass: Record<Notification['type'], string> = {
  success: 'border-[var(--primary)]/35',
  warning: 'border-[var(--secondary-foreground)]/25',
  error: 'border-[var(--destructive)]/40',
  info: 'border-[var(--border)]',
};

export function NotificationContainer() {
  const { t } = useTranslation();
  const { notifications, removeNotification } = useNotificationStore();
  const [animatedNotifications, setAnimatedNotifications] = useState<AnimatedNotification[]>([]);
  const prevNotificationsRef = useRef<Notification[]>([]);

  useEffect(() => {
    const prevNotifications = prevNotificationsRef.current;
    const prevIds = new Set(prevNotifications.map((n) => n.id));
    const currentIds = new Set(notifications.map((n) => n.id));

    const newNotifications = notifications.filter((n) => !prevIds.has(n.id));

    const removedIds = new Set(
      prevNotifications.filter((n) => !currentIds.has(n.id)).map((n) => n.id)
    );

    setAnimatedNotifications((prev) => {
      let updated = prev.map((n) => (removedIds.has(n.id) ? { ...n, isExiting: true } : n));

      newNotifications.forEach((n) => {
        if (!updated.find((animatedNotification) => animatedNotification.id === n.id)) {
          updated.push({ ...n, isExiting: false });
        }
      });

      updated = updated.filter((n) => currentIds.has(n.id) || n.isExiting);

      return updated;
    });

    if (removedIds.size > 0) {
      setTimeout(() => {
        setAnimatedNotifications((prev) => prev.filter((n) => !removedIds.has(n.id)));
      }, ANIMATION_DURATION);
    }

    prevNotificationsRef.current = notifications;
  }, [notifications]);

  const handleClose = (id: string) => {
    setAnimatedNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isExiting: true } : n))
    );

    setTimeout(() => {
      removeNotification(id);
    }, ANIMATION_DURATION);
  };

  if (!animatedNotifications.length) return null;

  return (
    <div className="fixed right-6 top-6 z-[3000] flex max-w-[360px] flex-col gap-2">
      {animatedNotifications.map((notification) => (
        <div
          key={notification.id}
          className={cn(
            'flex items-center justify-between gap-2 rounded-md border bg-[var(--card)] p-4 text-[var(--foreground)] shadow-[var(--shadow)]',
            notificationVariantClass[notification.type],
            notification.isExiting ? styles.exiting : styles.entering
          )}
        >
          <div className="flex-1 font-medium">{notification.message}</div>
          <button
            type="button"
            className="inline-flex size-[30px] items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            onClick={() => handleClose(notification.id)}
            aria-label={t('common.close')}
          >
            <IconX size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
