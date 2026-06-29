import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useCallback, useEffect, type PropsWithChildren, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from '../icons';
import { lockScroll, unlockScroll } from '../scrollLock';
import { cn } from '@/lib/utils';

export type SheetSize = 'md' | 'lg' | 'xl';
export type SheetPlacement = 'right' | 'center';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  size?: SheetSize;
  placement?: SheetPlacement;
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeDisabled?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  ariaLabel?: string;
  confirmClose?: () => boolean | Promise<boolean>;
}

const SIZE_CLASS: Record<SheetSize, string> = {
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

const PLACEMENT_CLASS: Record<SheetPlacement, string> = {
  right: 'bottom-0 right-0 top-0 w-[calc(100vw-1rem)] border-l border-[var(--border)]',
  center:
    'left-1/2 top-1/2 max-h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border)] max-sm:inset-0 max-sm:max-h-none max-sm:w-screen max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none',
};

export function Sheet({
  open,
  onClose,
  size = 'md',
  placement = 'right',
  eyebrow,
  title,
  description,
  footer,
  closeDisabled = false,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  ariaLabel,
  confirmClose,
  children,
}: PropsWithChildren<SheetProps>) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    lockScroll();
    return () => unlockScroll();
  }, [open]);

  const requestClose = useCallback(async () => {
    if (closeDisabled) return;
    if (confirmClose) {
      try {
        const ok = await confirmClose();
        if (ok === false) return;
      } catch {
        return;
      }
    }
    onClose();
  }, [closeDisabled, confirmClose, onClose]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void requestClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[2000] bg-[var(--overlay)]" />
        <DialogPrimitive.Content
          aria-label={!title && ariaLabel ? ariaLabel : undefined}
          className={cn(
            'fixed z-[2010] flex flex-col overflow-hidden bg-[var(--popover)] text-[var(--popover-foreground)] shadow-[var(--shadow-lg)] outline-none',
            PLACEMENT_CLASS[placement],
            SIZE_CLASS[size],
            className
          )}
          onEscapeKeyDown={(event) => {
            if (closeDisabled) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            void requestClose();
          }}
        >
          <button
            type="button"
            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50"
            onClick={() => void requestClose()}
            disabled={closeDisabled}
            aria-label={t('common.close')}
          >
            <IconX size={18} />
          </button>
          {(eyebrow || title || description) && (
            <div
              className={cn(
                'min-w-0 border-b border-[var(--border)] px-6 py-5 pr-12 max-sm:px-4 max-sm:py-4 max-sm:pr-12',
                headerClassName
              )}
            >
              {eyebrow ? (
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  {eyebrow}
                </div>
              ) : null}
              {title ? (
                <DialogPrimitive.Title className="break-words text-lg font-semibold leading-tight tracking-normal">
                  {title}
                </DialogPrimitive.Title>
              ) : null}
              {description ? (
                <DialogPrimitive.Description className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
          )}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-auto px-6 py-5 max-sm:px-4 max-sm:py-4',
              bodyClassName
            )}
          >
            {children}
          </div>
          {footer ? (
            <div
              className={cn(
                'flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4 max-sm:flex-col-reverse max-sm:items-stretch max-sm:px-4 max-sm:[&_button]:w-full',
                footerClassName
              )}
            >
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
