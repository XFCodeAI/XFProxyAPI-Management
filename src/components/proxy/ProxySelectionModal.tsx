import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { ProxyPoolStatusEntry, ProxySelection } from '@/types';
import { ProxySelectionControl } from './ProxySelectionControl';
import styles from './ProxySelectionModal.module.scss';

interface ProxySelectionModalProps {
  open: boolean;
  title: string;
  value: ProxySelection;
  pools: ProxyPoolStatusEntry[];
  loading?: boolean;
  confirming?: boolean;
  allowFileMode?: boolean;
  onChange: (value: ProxySelection) => void;
  onRefresh?: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProxySelectionModal({
  open,
  title,
  value,
  pools,
  loading = false,
  confirming = false,
  allowFileMode = false,
  onChange,
  onRefresh,
  onCancel,
  onConfirm,
}: ProxySelectionModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onCancel}
      closeDisabled={confirming}
      title={title}
      width={620}
      footer={
        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={confirming}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} loading={confirming}>
            {t('common.confirm')}
          </Button>
        </div>
      }
    >
      <div className={styles.content}>
        <ProxySelectionControl
          value={value}
          pools={pools}
          loading={loading}
          disabled={confirming}
          allowFileMode={allowFileMode}
          onChange={onChange}
          onRefresh={onRefresh}
        />
      </div>
    </Modal>
  );
}
