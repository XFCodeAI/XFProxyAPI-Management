export type CoolingOverride = boolean | null | undefined;

export const coolingPolicySelectValue = (value: CoolingOverride): string => {
  if (value === true) return 'disabled';
  if (value === false) return 'enabled';
  return 'inherit';
};

export const coolingOverrideFromPolicySelect = (value: string): boolean | undefined => {
  if (value === 'disabled') return true;
  if (value === 'enabled') return false;
  return undefined;
};
