import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import {
  coolingOverrideFromPolicySelect,
  coolingPolicySelectValue,
  type CoolingOverride,
} from '@/utils/coolingPolicy';

interface CoolingPolicySelectProps {
  id?: string;
  value: CoolingOverride;
  onChange: (value: boolean | undefined) => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function CoolingPolicySelect({
  id,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: CoolingPolicySelectProps) {
  const { t } = useTranslation();

  return (
    <Select
      id={id}
      value={coolingPolicySelectValue(value)}
      options={[
        { value: 'inherit', label: t('cooling_policy.inherit') },
        { value: 'enabled', label: t('cooling_policy.enabled') },
        { value: 'disabled', label: t('cooling_policy.disabled') },
      ]}
      onChange={(nextValue) => onChange(coolingOverrideFromPolicySelect(nextValue))}
      disabled={disabled}
      ariaLabel={ariaLabel}
    />
  );
}
