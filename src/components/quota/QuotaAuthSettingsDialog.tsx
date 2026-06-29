import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';

const QuotaAuthSettingsPanel = lazy(() =>
  import('@/components/quota/QuotaAuthSettingsPanel').then((module) => ({
    default: module.QuotaAuthSettingsPanel,
  }))
);

interface QuotaAuthSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function SettingsFallback() {
  return (
    <div className="flex min-h-[260px] items-center justify-center text-[var(--muted-foreground)]">
      <LoadingSpinner size={24} />
    </div>
  );
}

export function QuotaAuthSettingsDialog({ open, onClose }: QuotaAuthSettingsDialogProps) {
  const { t } = useTranslation();
  const [headerAction, setHeaderAction] = useState<ReactNode | null>(null);

  useEffect(() => {
    if (!open) {
      setHeaderAction(null);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title={t('quota_management.auth_settings_title')}
      headerAction={headerAction}
      onClose={onClose}
      width="min(1120px, calc(100vw - 2rem))"
      bodyClassName="max-h-[calc(90vh-5rem)] bg-[var(--background)] max-sm:max-h-[calc(100vh-8rem)] max-sm:px-3 max-sm:py-3"
    >
      <Suspense fallback={<SettingsFallback />}>
        {open ? <QuotaAuthSettingsPanel onHeaderActionChange={setHeaderAction} /> : null}
      </Suspense>
    </Modal>
  );
}
