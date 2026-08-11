/** Notification state shared by transient messages and confirmation dialogs. */

import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { Notification, NotificationType } from '@/types';
import { generateId } from '@/utils/helpers';
import { NOTIFICATION_DURATION_MS } from '@/utils/constants';

interface ConfirmationStepOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary';
}

interface ConfirmationOptions extends ConfirmationStepOptions {
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  secondConfirmation?: ConfirmationStepOptions;
}

interface NotificationState {
  notifications: Notification[];
  confirmation: {
    requestId: string | null;
    isOpen: boolean;
    isLoading: boolean;
    step: 1 | 2;
    options: ConfirmationOptions | null;
  };
  showNotification: (message: string, type?: NotificationType, duration?: number) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  showConfirmation: (options: ConfirmationOptions) => string;
  hideConfirmation: (requestId: string) => void;
  setConfirmationLoading: (requestId: string, loading: boolean) => void;
  advanceConfirmation: (requestId: string) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  confirmation: {
    requestId: null,
    isOpen: false,
    isLoading: false,
    step: 1,
    options: null,
  },

  showNotification: (message, type = 'info', duration = NOTIFICATION_DURATION_MS) => {
    const id = generateId();
    const notification: Notification = {
      id,
      message,
      type,
      duration,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  showConfirmation: (options) => {
    const current = get().confirmation;
    if (current.isOpen && current.options?.onCancel) {
      try {
        current.options.onCancel();
      } catch (error) {
        console.error('Failed to cancel replaced confirmation:', error);
      }
    }

    const requestId = generateId();
    set({
      confirmation: {
        requestId,
        isOpen: true,
        isLoading: false,
        step: 1,
        options,
      },
    });
    return requestId;
  },

  hideConfirmation: (requestId) => {
    set((state) => {
      if (state.confirmation.requestId !== requestId) return state;
      return {
        confirmation: {
          requestId: null,
          isOpen: false,
          isLoading: false,
          step: 1,
          options: null,
        },
      };
    });
  },

  setConfirmationLoading: (requestId, loading) => {
    set((state) => {
      if (state.confirmation.requestId !== requestId) return state;
      return {
        confirmation: {
          ...state.confirmation,
          isLoading: loading,
        },
      };
    });
  },

  advanceConfirmation: (requestId) => {
    set((state) => {
      if (state.confirmation.requestId !== requestId) return state;
      if (!state.confirmation.options?.secondConfirmation) return state;
      return {
        confirmation: {
          ...state.confirmation,
          isLoading: false,
          step: 2,
        },
      };
    });
  },
}));
