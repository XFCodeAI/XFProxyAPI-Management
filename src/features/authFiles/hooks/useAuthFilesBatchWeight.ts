import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useAuthInventoryStore, useNotificationStore } from '@/stores';
import {
  getCredentialWeightError,
  normalizeCredentialWeight,
  type CredentialWeightInputValue,
} from '@/utils/credentialWeight';
import {
  applyAuthFilesBatchWeight,
  createAuthFilesBatchWeightPlan,
  type AuthFilesBatchWeightInventory,
  type AuthFilesBatchWeightPlan,
} from '../authFilesBatchWeight';

type UseAuthFilesBatchWeightOptions = {
  onSuccess: () => void;
};

export type UseAuthFilesBatchWeightResult = {
  open: boolean;
  targetCount: number;
  value: CredentialWeightInputValue;
  saving: boolean;
  openDialog: (names: readonly string[]) => void;
  closeDialog: () => void;
  setValue: (value: CredentialWeightInputValue) => void;
  applyWeight: () => Promise<void>;
  clearWeight: () => Promise<void>;
};

const readInventory = (): AuthFilesBatchWeightInventory => {
  const state = useAuthInventoryStore.getState();
  return {
    files: state.files,
    inventoryId: state.inventoryId,
    revision: state.revision,
  };
};

export function useAuthFilesBatchWeight({
  onSuccess,
}: UseAuthFilesBatchWeightOptions): UseAuthFilesBatchWeightResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const commitMutationVersion = useAuthInventoryStore((state) => state.commitMutationVersion);
  const refreshInventory = useAuthInventoryStore((state) => state.refresh);
  const [plan, setPlan] = useState<AuthFilesBatchWeightPlan | null>(null);
  const [value, setValue] = useState<CredentialWeightInputValue>(undefined);
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef(false);

  const closeDialog = useCallback(() => {
    if (pendingRef.current) return;
    setPlan(null);
    setValue(undefined);
  }, []);

  const openDialog = useCallback(
    (names: readonly string[]) => {
      if (pendingRef.current) return;
      const nextPlan = createAuthFilesBatchWeightPlan(readInventory(), names);
      if (nextPlan.targets.length === 0) {
        showNotification(
          t('auth_files.batch_weight_no_targets', {
            defaultValue: 'No current credentials are available for this weight update.',
          }),
          'warning'
        );
        return;
      }
      setValue(undefined);
      setPlan(nextPlan);
    },
    [showNotification, t]
  );

  const run = useCallback(
    async (weight: number | null) => {
      if (!plan || pendingRef.current) return;
      pendingRef.current = true;
      setSaving(true);
      try {
        const result = await applyAuthFilesBatchWeight({
          plan,
          weight,
          getInventory: readInventory,
          patch: (target, fields) => authFilesApi.patchFields(target, fields),
        });

        result.versions.forEach((version) =>
          commitMutationVersion(version.inventoryId, version.revision, version.files)
        );
        const staleCount = result.failed.filter(
          (failure) => failure.reason === 'stale_inventory' || failure.reason === 'stale_identity'
        ).length;
        try {
          await refreshInventory(true);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : '';
          showNotification(
            `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
            'warning'
          );
        }

        if (result.failed.length === 0) {
          showNotification(
            t('auth_files.batch_weight_success', {
              count: result.successCount,
              defaultValue: 'Updated routing weight for {{count}} credentials.',
            }),
            'success'
          );
          onSuccess();
        } else {
          showNotification(
            t('auth_files.batch_weight_partial', {
              success: result.successCount,
              failed: result.failed.length,
              stale: staleCount,
              defaultValue:
                'Updated {{success}} credentials; {{failed}} failed ({{stale}} changed while selected).',
            }),
            result.successCount > 0 ? 'warning' : 'error'
          );
        }
        setPlan(null);
        setValue(undefined);
      } finally {
        pendingRef.current = false;
        setSaving(false);
      }
    },
    [commitMutationVersion, onSuccess, plan, refreshInventory, showNotification, t]
  );

  const applyWeight = useCallback(async () => {
    if (getCredentialWeightError(value)) return;
    const normalized = normalizeCredentialWeight(value);
    if (normalized === undefined) return;
    await run(Math.max(0, normalized));
  }, [run, value]);

  const clearWeight = useCallback(async () => run(null), [run]);

  return {
    open: plan !== null,
    targetCount: plan?.targets.length ?? 0,
    value,
    saving,
    openDialog,
    closeDialog,
    setValue,
    applyWeight,
    clearWeight,
  };
}
