import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';

export function ConfirmationModal() {
  const { t } = useTranslation();
  const confirmation = useNotificationStore((state) => state.confirmation);
  const hideConfirmation = useNotificationStore((state) => state.hideConfirmation);
  const setConfirmationLoading = useNotificationStore((state) => state.setConfirmationLoading);

  const { isOpen, isLoading, options } = confirmation;

  if (!isOpen || !options) {
    return null;
  }

  const {
    title,
    message,
    onConfirm,
    onCancel,
    confirmText,
    cancelText,
    variant = 'primary',
  } = options;

  const handleConfirm = async () => {
    try {
      setConfirmationLoading(true);
      await onConfirm();
      hideConfirmation();
    } catch (error) {
      console.error('确认操作执行失败:', error);
    } finally {
      setConfirmationLoading(false);
    }
  };

  const handleCancel = () => {
    if (isLoading) {
      return;
    }
    if (onCancel) {
      onCancel();
    }
    hideConfirmation();
  };

  const isDanger = variant === 'danger';
  const MessageIcon = isDanger ? IconAlertTriangle : IconInfo;
  const messageContent =
    typeof message === 'string' ? (
      <p className="m-0 text-sm leading-6 text-[var(--foreground)]">{message}</p>
    ) : (
      <div className="text-sm leading-6 text-[var(--foreground)]">{message}</div>
    );

  return (
    <Modal
      open={isOpen}
      onClose={handleCancel}
      title={title}
      closeDisabled={isLoading}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={handleCancel} disabled={isLoading}>
            {cancelText || t('common.cancel')}
          </Button>
          <Button variant={variant} onClick={handleConfirm} loading={isLoading}>
            {confirmText || t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 gap-3 rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3.5">
        <span
          className={
            isDanger
              ? 'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-[var(--destructive)]'
              : 'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-[var(--muted-foreground)]'
          }
        >
          <MessageIcon size={17} />
        </span>
        <div className="min-w-0 flex-1">{messageContent}</div>
      </div>
    </Modal>
  );
}
