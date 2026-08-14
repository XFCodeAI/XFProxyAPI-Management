import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import {
  MAX_CREDENTIAL_WEIGHT,
  getCredentialWeightError,
  toCredentialWeightInputValue,
  type CredentialWeightInputValue,
} from '@/utils/credentialWeight';

export type CredentialWeightInputProps = {
  value: CredentialWeightInputValue;
  disabled?: boolean;
  wrapperClassName?: string;
  onChange: (value: CredentialWeightInputValue) => void;
};

export function CredentialWeightInput({
  value,
  disabled,
  wrapperClassName,
  onChange,
}: CredentialWeightInputProps) {
  const { t } = useTranslation();
  const errorCode = getCredentialWeightError(value);
  const error = errorCode
    ? t(`credential_weight.errors.${errorCode}`, {
        max: MAX_CREDENTIAL_WEIGHT.toLocaleString(),
      })
    : undefined;

  return (
    <Input
      wrapperClassName={wrapperClassName}
      label={t('credential_weight.label')}
      hint={t('credential_weight.hint')}
      error={error}
      type="text"
      inputMode="text"
      value={value ?? ''}
      onChange={(event) => onChange(toCredentialWeightInputValue(event.target.value))}
      disabled={disabled}
    />
  );
}
