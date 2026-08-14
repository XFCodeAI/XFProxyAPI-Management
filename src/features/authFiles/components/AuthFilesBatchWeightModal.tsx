import { useTranslation } from 'react-i18next';
import { CredentialWeightInput } from '@/components/providers/CredentialWeightInput';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  getCredentialWeightError,
  normalizeCredentialWeight,
  type CredentialWeightInputValue,
} from '@/utils/credentialWeight';

type AuthFilesBatchWeightModalProps = {
  open: boolean;
  targetCount: number;
  value: CredentialWeightInputValue;
  saving: boolean;
  onChange: (value: CredentialWeightInputValue) => void;
  onApply: () => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
};

export function AuthFilesBatchWeightModal({
  open,
  targetCount,
  value,
  saving,
  onChange,
  onApply,
  onClear,
  onClose,
}: AuthFilesBatchWeightModalProps) {
  const { t } = useTranslation();
  const normalized = normalizeCredentialWeight(value);
  const invalid = Boolean(getCredentialWeightError(value));
  const applyDisabled = saving || invalid || normalized === undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      title={t('auth_files.batch_weight_title', {
        defaultValue: 'Set credential routing weight',
      })}
      width={440}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onClear()}
            disabled={saving}
          >
            {t('auth_files.batch_weight_clear', { defaultValue: 'Clear weight' })}
          </Button>
          <Button
            type="button"
            onClick={() => void onApply()}
            loading={saving}
            disabled={applyDisabled}
          >
            {t('auth_files.batch_weight_apply', { defaultValue: 'Apply weight' })}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-sm leading-6 text-[var(--muted-foreground)]">
          {t('auth_files.batch_weight_description', {
            count: targetCount,
            defaultValue:
              'Apply one routing weight to {{count}} selected credentials. Clear removes the explicit weight and restores the default.',
          })}
        </p>
        <CredentialWeightInput value={value} disabled={saving} onChange={onChange} />
      </div>
    </Modal>
  );
}
