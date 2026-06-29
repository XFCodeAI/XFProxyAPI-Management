import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, type PropsWithChildren, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from './icons';
import { lockScroll, unlockScroll } from './scrollLock';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  headerAction?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
  className?: string;
  bodyClassName?: string;
  closeDisabled?: boolean;
}

export function Modal({
  open,
  title,
  headerAction,
  onClose,
  footer,
  width = 520,
  className,
  bodyClassName,
  closeDisabled = false,
  children,
}: PropsWithChildren<ModalProps>) {
  const { t } = useTranslation();
  const hasHeader = Boolean(title || headerAction);
  const closeButton = (
    <button
      type="button"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50"
      onClick={closeDisabled ? undefined : onClose}
      aria-label={t('common.close')}
      disabled={closeDisabled}
    >
      <IconX size={18} />
    </button>
  );

  useEffect(() => {
    if (!open) return;
    lockScroll();
    return () => unlockScroll();
  }, [open]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !closeDisabled) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-modal-overlay="true"
          className="fixed inset-0 z-[2000] bg-[var(--overlay)]"
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[2010] flex max-h-[min(90vh,calc(100vh-2rem))] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-[var(--shadow-lg)] outline-none max-sm:max-h-[calc(100vh-1.5rem)] max-sm:rounded-md',
            className
          )}
          style={{ width, maxWidth: 'calc(100vw - 2rem)' }}
          onEscapeKeyDown={(event) => {
            if (closeDisabled) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          {!hasHeader ? <div className="absolute right-3 top-3">{closeButton}</div> : null}
          {hasHeader ? (
            <div className="grid min-h-16 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[var(--border)] px-6 py-4 max-sm:min-h-14 max-sm:px-4 max-sm:py-3">
              <div className="min-w-0 flex-1">
                {title ? (
                  <DialogPrimitive.Title className="break-words text-base font-semibold leading-tight tracking-normal text-[var(--foreground)]">
                    {title}
                  </DialogPrimitive.Title>
                ) : null}
              </div>
              {headerAction ? (
                <div className="flex min-w-0 max-w-[min(44vw,28rem)] shrink-0 items-center justify-end gap-2 overflow-hidden max-sm:max-w-[calc(100vw-8rem)]">
                  {headerAction}
                </div>
              ) : null}
              {closeButton}
            </div>
          ) : null}
          <div
            className={cn(
              'min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain px-6 py-5 max-sm:p-4',
              bodyClassName
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--popover)] px-6 py-4 max-sm:flex-col-reverse max-sm:items-stretch max-sm:p-4 max-sm:[&_button]:w-full">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
