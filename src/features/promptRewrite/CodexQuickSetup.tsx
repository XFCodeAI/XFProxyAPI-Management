import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CircleCheck,
  KeyRound,
  PackageOpen,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unplug,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { capabilityPackApi, promptRewriteApi, responseTamperApi } from '@/services/api';
import type {
  CapabilityBinding,
  CapabilityBindingTarget,
  CapabilityPackActivationBlueprint,
  CapabilityPackActivationResponse,
  CapabilityPackCatalog,
  CapabilityPackStatus,
  PromptRewriteCatalog,
} from '@/types';
import { resolvePackCapabilities } from './capabilityBindingModel';
import styles from './CodexQuickSetup.module.scss';

export type QuickTargetType = 'global' | 'provider' | 'credential-group' | 'credential';

interface CodexQuickSetupProps {
  targetCatalog: PromptRewriteCatalog;
  initialTargetType?: QuickTargetType;
  initialTargetValue?: string;
  onChanged?: () => Promise<unknown> | unknown;
}

interface QuickPreset {
  id: string;
  status: CapabilityPackStatus;
  blueprints: CapabilityPackActivationBlueprint[];
  blueprint: CapabilityPackActivationBlueprint;
}

type QuickResponseSelection = 'none' | 'direct' | 'relay' | `capability:${string}`;

const requestFixture = {
  instructions: 'Existing Codex instruction',
  input: 'Quick binding simulation',
};

const targetTypes: QuickTargetType[] = ['credential', 'credential-group', 'provider'];

const supportsCodexRequest = (
  status: CapabilityPackStatus,
  blueprint: CapabilityPackActivationBlueprint
) => {
  const capabilities = resolvePackCapabilities(status, blueprint.capabilities).filter(
    (capability) => capability.kind === 'request-instruction'
  );
  return (
    capabilities.length > 0 &&
    capabilities.every((capability) =>
      capability.carriers.some((carrier) => carrier.toLowerCase().includes('codex'))
    )
  );
};

const blueprintFamilyName = (blueprint: CapabilityPackActivationBlueprint) =>
  blueprint.name
    .replace(/^activate\s+/i, '')
    .replace(/^(append|prepend|preserve|replace)\s+/i, '')
    .replace(/\.md$/i, '')
    .trim();

const blueprintForMode = (blueprints: CapabilityPackActivationBlueprint[], mode: string) =>
  blueprints.find((blueprint) => blueprint.recommendedMode === mode) ??
  blueprints.find((blueprint) =>
    blueprint.name.toLowerCase().startsWith(`${mode.toLowerCase()} `)
  ) ??
  blueprints[0];

const quickPresets = (statuses: CapabilityPackStatus[]): QuickPreset[] =>
  statuses.flatMap((status) => {
    if (
      (!status.bundled && !status.installed) ||
      (status.pack.project.trim().toLowerCase() !== 'nerv' &&
        status.pack.id.trim().toLowerCase() !== 'pack:nerv')
    ) {
      return [];
    }
    const grouped = new Map<string, CapabilityPackActivationBlueprint[]>();
    status.pack.activationBlueprints
      .filter((blueprint) => supportsCodexRequest(status, blueprint))
      .forEach((blueprint) => {
        const family = blueprintFamilyName(blueprint);
        const key = `${family.toLowerCase()}::${blueprint.capabilities.join(',')}`;
        grouped.set(key, [...(grouped.get(key) ?? []), blueprint]);
      });
    return [...grouped.values()].map((blueprints) => {
      const blueprint = blueprintForMode(blueprints, 'append') ?? blueprints[0];
      return {
        id: `${status.pack.id}::${blueprintFamilyName(blueprint).toLowerCase()}`,
        status,
        blueprints,
        blueprint,
      };
    });
  });

const codexResponseCapabilities = (status: CapabilityPackStatus) =>
  status.pack.capabilities.filter(
    (capability) =>
      capability.activatable &&
      capability.kind === 'response-transform' &&
      capability.carriers.some((carrier) => carrier.toLowerCase().includes('codex'))
  );

const responseSelectionFor = (
  capability: CapabilityPackStatus['pack']['capabilities'][number]
): QuickResponseSelection => {
  const identity =
    `${capability.id} ${capability.name} ${capability.runtimeRef ?? ''}`.toLowerCase();
  if (identity.includes('relay')) return 'relay';
  if (identity.includes('direct')) return 'direct';
  return `capability:${capability.id}`;
};

const responseLabelFor = (
  capability: CapabilityPackStatus['pack']['capabilities'][number],
  selection: QuickResponseSelection,
  t: (key: string) => string
) => {
  if (selection === 'direct') return t('prompt_rewrite.quick.response_direct');
  if (selection === 'relay') return t('prompt_rewrite.quick.response_relay');
  return capability.name || capability.id;
};

const cleanPresetName = (preset: QuickPreset) => preset.status.pack.name;

const targetText = (target: CapabilityBindingTarget, t: (key: string) => string) => {
  if (target.type === 'global') return t('prompt_rewrite.quick.target_global');
  const typeLabel = t(`prompt_rewrite.target.${target.type}`);
  return `${typeLabel}: ${target.value ?? ''}`;
};

const sameValues = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export function CodexQuickSetup({
  targetCatalog,
  initialTargetType,
  initialTargetValue,
  onChanged,
}: CodexQuickSetupProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CapabilityPackCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPresetID, setSelectedPresetID] = useState('');
  const [responseSelection, setResponseSelection] = useState<QuickResponseSelection>('none');
  const [responseModificationConsent, setResponseModificationConsent] = useState(false);
  const [promptReplaceConsent, setPromptReplaceConsent] = useState(false);
  const [targetType, setTargetType] = useState<QuickTargetType>(
    initialTargetType === 'global' ? 'provider' : (initialTargetType ?? 'credential-group')
  );
  const [targetValues, setTargetValues] = useState<string[]>(
    initialTargetValue ? [initialTargetValue] : []
  );
  const [mode, setMode] = useState('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [planned, setPlanned] = useState<CapabilityPackActivationResponse | null>(null);
  const [activation, setActivation] = useState<CapabilityPackActivationResponse | null>(null);
  const initializedPresetID = useRef('');

  const loadCatalog = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        const next = await capabilityPackApi.catalog();
        const presets = quickPresets(next.packs);
        setCatalog(next);
        setSelectedPresetID((current) =>
          current && presets.some((preset) => preset.id === current)
            ? current
            : (presets[0]?.id ?? '')
        );
      } catch (caught: unknown) {
        const apiError = caught as { message?: string };
        setError(apiError.message || t('prompt_rewrite.quick.error_load'));
        setCatalog(null);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const presets = useMemo(() => quickPresets(catalog?.packs ?? []), [catalog?.packs]);
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetID) ?? presets[0] ?? null,
    [presets, selectedPresetID]
  );
  const selectedStatus = selectedPreset?.status ?? null;
  const modeOptions = useMemo(() => {
    if (!selectedPreset) return [];
    const seen = new Set<string>();
    return selectedPreset.blueprints.flatMap((blueprint) => {
      const value = blueprint.recommendedMode || 'replace';
      if (seen.has(value)) return [];
      seen.add(value);
      return [{ value, label: t(`prompt_rewrite.quick.mode_${value}`) }];
    });
  }, [selectedPreset, t]);
  const selectedBlueprint = useMemo(
    () =>
      selectedPreset
        ? (blueprintForMode(selectedPreset.blueprints, mode) ?? selectedPreset.blueprint)
        : null,
    [mode, selectedPreset]
  );
  const requestCapabilities = useMemo(
    () =>
      selectedStatus && selectedBlueprint
        ? resolvePackCapabilities(selectedStatus, selectedBlueprint.capabilities).filter(
            (capability) => capability.kind === 'request-instruction'
          )
        : [],
    [selectedBlueprint, selectedStatus]
  );
  const responseCapabilities = useMemo(
    () => (selectedStatus ? codexResponseCapabilities(selectedStatus) : []),
    [selectedStatus]
  );
  const responseOptions = useMemo(() => {
    const seen = new Set<string>();
    return responseCapabilities.flatMap((capability) => {
      const value = responseSelectionFor(capability);
      if (seen.has(value)) return [];
      seen.add(value);
      return [{ value, capability }];
    });
  }, [responseCapabilities]);
  const selectedResponseCapability = useMemo(
    () => responseOptions.find((option) => option.value === responseSelection)?.capability,
    [responseOptions, responseSelection]
  );

  useEffect(() => {
    if (!selectedPreset || initializedPresetID.current === selectedPreset.id) return;
    initializedPresetID.current = selectedPreset.id;
    setMode(selectedPreset.blueprint.recommendedMode || 'replace');
    setResponseSelection('none');
    setResponseModificationConsent(false);
    setPromptReplaceConsent(false);
    setPlanned(null);
    setActivation(null);
    setError('');
  }, [selectedPreset]);

  const codexCredentials = useMemo(
    () =>
      targetCatalog.credentials.filter(
        (credential) =>
          credential.carrierSupported && credential.provider.trim().toLowerCase() === 'codex'
      ),
    [targetCatalog.credentials]
  );
  const codexGroups = useMemo(
    () =>
      targetCatalog.credentialGroups.filter((group) =>
        codexCredentials.some((credential) =>
          credential.groups.some(
            (candidate) => candidate.trim().toLowerCase() === group.trim().toLowerCase()
          )
        )
      ),
    [codexCredentials, targetCatalog.credentialGroups]
  );
  const codexProvider = useMemo(
    () =>
      targetCatalog.providers.find(
        (provider) => provider.carrierSupported && provider.id.trim().toLowerCase() === 'codex'
      )?.id ?? 'codex',
    [targetCatalog.providers]
  );

  useEffect(() => {
    setTargetValues((current) => {
      let next = current;
      if (targetType === 'global') next = [];
      if (targetType === 'provider') next = [codexProvider];
      if (targetType === 'credential-group') {
        next = current.filter((value) => codexGroups.includes(value));
      }
      if (targetType === 'credential') {
        const available = new Set(codexCredentials.map((credential) => credential.id));
        next = current.filter((value) => available.has(value));
      }
      return sameValues(current, next) ? current : next;
    });
  }, [codexCredentials, codexGroups, codexProvider, targetType]);

  useEffect(() => {
    if (responseSelection !== 'none' && !selectedResponseCapability) {
      setResponseSelection('none');
      setResponseModificationConsent(false);
    }
  }, [responseSelection, selectedResponseCapability]);

  const selectedCapabilityIDs = useMemo(() => {
    if (!selectedBlueprint || !selectedStatus) return [];
    const ids = requestCapabilities.map((capability) => capability.id);
    if (selectedResponseCapability && !ids.includes(selectedResponseCapability.id)) {
      ids.push(selectedResponseCapability.id);
    }
    return ids;
  }, [requestCapabilities, selectedBlueprint, selectedResponseCapability, selectedStatus]);

  const targets = useMemo<CapabilityBindingTarget[]>(() => {
    if (targetType === 'global') return [{ type: 'global' }];
    return targetValues.map((value) => ({ type: targetType, value }));
  }, [targetType, targetValues]);

  const activeBindings = useMemo(
    () =>
      (catalog?.packs ?? []).flatMap((status) =>
        status.pack.project.trim().toLowerCase() === 'nerv' ||
        status.pack.id.trim().toLowerCase() === 'pack:nerv'
          ? status.bindingInventory
              .filter((binding) => binding.state === 'active')
              .map((binding) => ({
                id: `${status.pack.id}:${binding.id}`,
                status,
                binding,
              }))
          : []
      ),
    [catalog?.packs]
  );

  const resetOutcome = () => {
    setPlanned(null);
    setActivation(null);
    setError('');
  };

  const selectTargetType = (next: QuickTargetType) => {
    setTargetType(next);
    setTargetValues(next === 'provider' ? [codexProvider] : []);
    resetOutcome();
  };

  const toggleTargetValue = (value: string) => {
    setTargetValues((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
    resetOutcome();
  };

  const simulation = useCallback(() => {
    const credential =
      targetType === 'credential'
        ? codexCredentials.find((item) => targetValues.includes(item.id))
        : targetType === 'credential-group'
          ? codexCredentials.find((item) =>
              item.groups.some((group) => targetValues.includes(group))
            )
          : undefined;
    return {
      kind: selectedResponseCapability ? 'response' : 'request',
      body: selectedResponseCapability
        ? {
            id: 'quick-response',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'I cannot help with that request.' }],
              },
            ],
          }
        : requestFixture,
      source_format: 'openai-response',
      target_format: 'codex',
      model: 'gpt-5.6-codex',
      request_path: '/backend-api/codex/responses',
      codex_client: true,
      auth_id: credential?.id,
      auth_ids: targetType === 'credential' ? targetValues : undefined,
      provider: codexProvider,
      groups: targetType === 'credential-group' ? targetValues : (credential?.groups ?? []),
    };
  }, [codexCredentials, codexProvider, selectedResponseCapability, targetType, targetValues]);

  const requestFor = useCallback(
    (confirm: boolean, planned?: CapabilityPackActivationResponse) => {
      const values = {
        ...(selectedBlueprint ? { blueprint_id: selectedBlueprint.id } : {}),
        capability_ids: selectedCapabilityIDs,
        mode,
        prompt_replace_consent: promptReplaceConsent,
        targets,
        match: {
          models: [],
          requested_models: [],
          request_paths: [],
          input: { exact: [], contains: [], suffixes: [] },
        },
        priority: 0,
        response_modification_consent: responseModificationConsent,
        simulation: simulation(),
        ...(catalog?.revision ? { pack_revision: catalog.revision } : {}),
      } as Record<string, unknown>;
      if (!confirm || !planned) return values;
      return {
        ...values,
        confirm: true,
        plan_fingerprint: planned.plan.fingerprint,
        ...(planned.simulationFingerprint || planned.plan.simulationFingerprint
          ? {
              simulation_fingerprint:
                planned.simulationFingerprint || planned.plan.simulationFingerprint,
            }
          : {}),
      };
    },
    [
      catalog,
      mode,
      promptReplaceConsent,
      responseModificationConsent,
      selectedCapabilityIDs,
      selectedBlueprint,
      simulation,
      targets,
    ]
  );

  const validateSelection = () => {
    if (!selectedPreset || !selectedBlueprint || selectedCapabilityIDs.length === 0) {
      setError(t('prompt_rewrite.quick.error_preset'));
      return false;
    }
    if (targets.length === 0) {
      setError(t('prompt_rewrite.quick.error_target'));
      return false;
    }
    if (mode === 'replace' && !promptReplaceConsent) {
      setError(t('prompt_rewrite.quick.error_prompt_replace_consent'));
      return false;
    }
    if (selectedResponseCapability && !responseModificationConsent) {
      setError(t('prompt_rewrite.quick.error_response_consent'));
      return false;
    }
    return true;
  };

  const simulate = async () => {
    if (!validateSelection() || !selectedPreset) return;
    setBusy(true);
    setError('');
    try {
      const next = await capabilityPackApi.activationSimulate(
        selectedPreset.status.pack.id,
        requestFor(false)
      );
      setPlanned(next);
      setActivation(null);
    } catch (caught: unknown) {
      const apiError = caught as { message?: string };
      setPlanned(null);
      setError(apiError.message || t('prompt_rewrite.quick.error_simulation'));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    if (!validateSelection() || !selectedPreset) return;
    if (!planned) {
      setError(t('prompt_rewrite.quick.error_simulation_required'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const [promptDocument, responseDocument] = await Promise.all([
        promptRewriteApi.get(),
        responseTamperApi.get(),
      ]);
      const request = requestFor(true, planned) as Record<string, unknown>;
      request.prompt_revision = promptDocument.revision;
      request.response_revision = responseDocument.revision;
      request.inventory_id = promptDocument.inventoryId;
      request.inventory_revision = promptDocument.inventoryRevision;
      const next = await capabilityPackApi.activate(selectedPreset.status.pack.id, request);
      setActivation(next);
      setPlanned(null);
      await loadCatalog(false);
      await onChanged?.();
    } catch (caught: unknown) {
      const apiError = caught as { message?: string };
      setError(apiError.message || t('prompt_rewrite.quick.error_activation'));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!activation || !selectedPreset) return;
    setBusy(true);
    setError('');
    try {
      const [promptDocument, responseDocument] = await Promise.all([
        promptRewriteApi.get(),
        responseTamperApi.get(),
      ]);
      await capabilityPackApi.rollback(selectedPreset.status.pack.id, {
        pack_id: selectedPreset.status.pack.id,
        pack_revision: catalog?.revision || '*',
        plan_fingerprint: activation.plan.fingerprint,
        prompt_revision: promptDocument.revision,
        response_revision: responseDocument.revision,
        inventory_id: promptDocument.inventoryId,
        inventory_revision: promptDocument.inventoryRevision,
        confirm: true,
      });
      setActivation(null);
      await loadCatalog(false);
      await onChanged?.();
    } catch (caught: unknown) {
      const apiError = caught as { message?: string };
      setError(apiError.message || t('prompt_rewrite.quick.error_rollback'));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (status: CapabilityPackStatus, binding?: CapabilityBinding) => {
    if (status.activeBindings.length === 0 && !binding) return;
    setBusy(true);
    setError('');
    try {
      const [promptDocument, responseDocument] = await Promise.all([
        promptRewriteApi.get(),
        responseTamperApi.get(),
      ]);
      const promptRuleIDs = status.activeBindings
        .filter((item) => item.startsWith('rule:'))
        .map((item) => item.slice('rule:'.length));
      const responseRuleIDs = status.activeBindings
        .filter((item) => item.startsWith('response-rule:'))
        .map((item) => item.slice('response-rule:'.length));
      await capabilityPackApi.deactivate(status.pack.id, {
        pack_id: status.pack.id,
        pack_revision: catalog?.revision || '*',
        ...(binding
          ? { binding_id: binding.id }
          : { prompt_rule_ids: promptRuleIDs, response_rule_ids: responseRuleIDs }),
        prompt_revision: promptDocument.revision,
        response_revision: responseDocument.revision,
        confirm: true,
      });
      setActivation(null);
      await loadCatalog(false);
      await onChanged?.();
    } catch (caught: unknown) {
      const apiError = caught as { message?: string };
      setError(apiError.message || t('prompt_rewrite.quick.error_deactivation'));
    } finally {
      setBusy(false);
    }
  };

  const targetSummary =
    targets.length > 0
      ? targets.map((target) => targetText(target, t)).join(' / ')
      : t('prompt_rewrite.quick.target_pending');

  if (loading) {
    return (
      <div className={styles.quickState}>
        <LoadingSpinner size={24} />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  if (!catalog || presets.length === 0) {
    return (
      <div className={styles.quickEmpty} role="status">
        <PackageOpen size={26} />
        <strong>{t('prompt_rewrite.quick.no_pack')}</strong>
        <p>{t('prompt_rewrite.quick.no_pack_hint')}</p>
        <div className={styles.quickActions}>
          <Button variant="ghost" onClick={() => void loadCatalog()}>
            {t('common.retry')}
          </Button>
        </div>
        {error ? <div className={styles.quickError}>{error}</div> : null}
      </div>
    );
  }

  return (
    <div className={styles.quickRoot}>
      <header className={styles.quickHeader}>
        <div>
          <h1>{t('prompt_rewrite.quick.title')}</h1>
          <p>{t('prompt_rewrite.quick.description')}</p>
        </div>
      </header>

      <section className={styles.quickSetup}>
        <div className={styles.quickColumns}>
          <div className={styles.quickColumn}>
            <div className={styles.quickStepHeading}>
              <span className={styles.quickStepNumber}>1</span>
              <div>
                <h2>{t('prompt_rewrite.quick.step_nerv')}</h2>
                <p>{t('prompt_rewrite.quick.step_nerv_desc')}</p>
              </div>
            </div>
            {selectedPreset ? (
              <div className={styles.quickPresetInfo}>
                <Sparkles size={18} />
                <div>
                  <strong>{selectedPreset.status.pack.name}</strong>
                  <span>{t('prompt_rewrite.quick.nerv_ready')}</span>
                </div>
              </div>
            ) : null}
            {selectedPreset ? (
              <div className={styles.quickProfile}>
                <div className={styles.quickField}>
                  <span>{t('prompt_rewrite.quick.profile')}</span>
                  <Select
                    value={selectedPreset.id}
                    options={presets.map((preset) => ({
                      value: preset.id,
                      label: cleanPresetName(preset),
                    }))}
                    onChange={(value) => {
                      setSelectedPresetID(value);
                      resetOutcome();
                    }}
                    ariaLabel={t('prompt_rewrite.quick.profile')}
                  />
                </div>
                <span className={styles.quickMuted}>{t('prompt_rewrite.quick.profile_hint')}</span>
              </div>
            ) : null}
            {selectedPreset ? (
              <div className={styles.quickProvenance} aria-label={t('prompt_rewrite.quick.provenance')}>
                <div>
                  <span>{t('prompt_rewrite.quick.runtime_status')}</span>
                  <strong>
                    {selectedPreset.status.bundled
                      ? t('prompt_rewrite.quick.status_bundled')
                      : selectedPreset.status.installed
                        ? t('prompt_rewrite.quick.status_installed')
                        : t('prompt_rewrite.quick.status_unavailable')}
                  </strong>
                </div>
                <div>
                  <span>{t('prompt_rewrite.quick.source_revision')}</span>
                  <code>{selectedPreset.status.pack.sourceRevision}</code>
                </div>
              </div>
            ) : null}
            {modeOptions.length > 0 ? (
              <label className={styles.quickField}>
                <span>{t('prompt_rewrite.quick.mode')}</span>
                <Select
                  value={mode}
                  options={modeOptions}
                  onChange={(value) => {
                    setMode(value);
                    setPromptReplaceConsent(false);
                    resetOutcome();
                  }}
                  ariaLabel={t('prompt_rewrite.quick.mode')}
                />
              </label>
            ) : null}
            {mode === 'replace' ? (
              <div className={styles.quickResponseOption}>
                <div>
                  <strong>{t('prompt_rewrite.quick.prompt_replace_consent')}</strong>
                  <span>{t('prompt_rewrite.quick.prompt_replace_consent_hint')}</span>
                </div>
                <ToggleSwitch
                  checked={promptReplaceConsent}
                  onChange={(checked) => {
                    setPromptReplaceConsent(checked);
                    resetOutcome();
                  }}
                  ariaLabel={t('prompt_rewrite.quick.prompt_replace_consent')}
                />
              </div>
            ) : null}
          </div>

          <div className={styles.quickColumn}>
            <div className={styles.quickStepHeading}>
              <span className={styles.quickStepNumber}>2</span>
              <div>
                <h2>{t('prompt_rewrite.quick.step_target')}</h2>
                <p>{t('prompt_rewrite.quick.step_target_desc')}</p>
              </div>
            </div>
            <div
              className={styles.quickTargetTypes}
              role="radiogroup"
              aria-label={t('prompt_rewrite.quick.step_target')}
            >
              {targetTypes.map((type) => {
                const Icon =
                  type === 'credential-group'
                    ? Users
                    : type === 'credential'
                      ? KeyRound
                      : Building2;
                const label =
                  type === 'credential-group'
                    ? t('prompt_rewrite.quick.target_group')
                    : type === 'credential'
                      ? t('prompt_rewrite.quick.target_credential')
                      : t('prompt_rewrite.quick.target_provider');
                return (
                  <button
                    type="button"
                    key={type}
                    className={
                      targetType === type ? styles.quickTargetTypeActive : styles.quickTargetType
                    }
                    onClick={() => selectTargetType(type)}
                    aria-pressed={targetType === type}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            {targetType === 'credential-group' ? (
              codexGroups.length > 0 ? (
                <div
                  className={styles.quickField}
                  role="group"
                  aria-label={t('prompt_rewrite.quick.choose_group')}
                >
                  <span>{t('prompt_rewrite.quick.choose_group')}</span>
                  <div className={styles.quickChoiceList}>
                    {codexGroups.map((group) => (
                      <label className={styles.quickChoice} key={group}>
                        <input
                          type="checkbox"
                          checked={targetValues.includes(group)}
                          onChange={() => toggleTargetValue(group)}
                        />
                        <span>
                          <strong>{group}</strong>
                          <small>
                            {t('prompt_rewrite.quick.credential_count', {
                              count: codexCredentials.filter((credential) =>
                                credential.groups.some(
                                  (candidate) => candidate.toLowerCase() === group.toLowerCase()
                                )
                              ).length,
                            })}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <p className={styles.quickMuted}>{t('prompt_rewrite.quick.no_groups')}</p>
              )
            ) : null}
            {targetType === 'credential' ? (
              codexCredentials.length > 0 ? (
                <div
                  className={styles.quickField}
                  role="group"
                  aria-label={t('prompt_rewrite.quick.choose_credential')}
                >
                  <span>{t('prompt_rewrite.quick.choose_credential')}</span>
                  <div className={styles.quickChoiceList}>
                    {codexCredentials.map((credential) => (
                      <label className={styles.quickChoice} key={credential.id}>
                        <input
                          type="checkbox"
                          checked={targetValues.includes(credential.id)}
                          onChange={() => toggleTargetValue(credential.id)}
                        />
                        <span>
                          <strong>{credential.displayName || credential.id}</strong>
                          <small>{credential.id}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <p className={styles.quickMuted}>{t('prompt_rewrite.quick.no_credentials')}</p>
              )
            ) : null}
            {targetType === 'provider' ? (
              <div className={styles.quickSelectedTarget}>
                <Building2 size={17} />
                <div>
                  <strong>{t('prompt_rewrite.quick.codex_provider')}</strong>
                  <span>{t('prompt_rewrite.quick.codex_only')}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {responseOptions.length > 0 ? (
          <div className={styles.quickCapabilitySection}>
            <div className={styles.quickStepHeading}>
              <span className={styles.quickStepNumber}>3</span>
              <div>
                <h2>{t('prompt_rewrite.quick.response_mode')}</h2>
                <p>{t('prompt_rewrite.quick.response_mode_hint')}</p>
              </div>
            </div>
            <div
              className={styles.quickChoiceList}
              role="radiogroup"
              aria-label={t('prompt_rewrite.quick.response_mode')}
            >
              <label className={styles.quickChoice}>
                <input
                  type="radio"
                  name="codex-response-mode"
                  checked={responseSelection === 'none'}
                  onChange={() => {
                    setResponseSelection('none');
                    setResponseModificationConsent(false);
                    resetOutcome();
                  }}
                />
                <span>
                  <strong>{t('prompt_rewrite.quick.response_none')}</strong>
                  <small>{t('prompt_rewrite.quick.response_none_hint')}</small>
                </span>
              </label>
              {responseOptions.map(({ value, capability }) => (
                <label className={styles.quickChoice} key={value}>
                  <input
                    type="radio"
                    name="codex-response-mode"
                    checked={responseSelection === value}
                    onChange={() => {
                      setResponseSelection(value);
                      setResponseModificationConsent(false);
                      resetOutcome();
                    }}
                  />
                  <span>
                    <strong>{responseLabelFor(capability, value, t)}</strong>
                    <small>{capability.name || capability.id}</small>
                  </span>
                </label>
              ))}
            </div>
            {selectedResponseCapability ? (
              <div className={styles.quickResponseOption}>
                <div>
                  <strong>{t('prompt_rewrite.quick.response_consent')}</strong>
                  <span>{t('prompt_rewrite.quick.response_consent_hint')}</span>
                </div>
                <ToggleSwitch
                  checked={responseModificationConsent}
                  onChange={(checked) => {
                    setResponseModificationConsent(checked);
                    resetOutcome();
                  }}
                  ariaLabel={t('prompt_rewrite.quick.response_consent')}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className={styles.quickError} role="alert">
            <ShieldAlert size={16} /> {error}
          </div>
        ) : null}
        {activation ? (
          <div className={styles.quickSuccess} role="status">
            <ShieldCheck size={17} />
            <div>
              <strong>{t('prompt_rewrite.quick.applied')}</strong>
              <span>{targetSummary}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void rollback()}
              disabled={busy}
              aria-label={t('prompt_rewrite.quick.rollback')}
            >
              <RotateCcw size={15} /> {t('prompt_rewrite.quick.rollback')}
            </Button>
          </div>
        ) : null}
        {planned ? (
          <div className={styles.quickSimulation} role="status">
            <div className={styles.quickSimulationHeader}>
              <CircleCheck size={17} />
              <div>
                <strong>
                  {planned.simulation?.changed || planned.plan.simulation?.changed
                    ? t('prompt_rewrite.quick.preview_changed')
                    : t('prompt_rewrite.quick.preview_unchanged')}
                </strong>
                <span>
                  {planned.plan.promptChanged ? t('prompt_rewrite.quick.prompt_changed') : ''}
                  {planned.plan.promptChanged && planned.plan.responseChanged ? ' · ' : ''}
                  {planned.plan.responseChanged ? t('prompt_rewrite.quick.response_changed') : ''}
                  {planned.plan.replacedBindingIDs.length +
                    planned.plan.replacedPromptRuleIDs.length +
                    planned.plan.replacedResponseRuleIDs.length >
                  0
                    ? ` · ${t('prompt_rewrite.quick.migration_replaces', {
                        count:
                          planned.plan.replacedBindingIDs.length +
                          planned.plan.replacedPromptRuleIDs.length +
                          planned.plan.replacedResponseRuleIDs.length,
                      })}`
                    : ''}
                </span>
              </div>
            </div>
            <details className={styles.quickSimulationDetails}>
              <summary>{t('prompt_rewrite.quick.preview_details')}</summary>
              <div className={styles.quickSimulationGrid}>
                <div>
                  <strong>{t('prompt_rewrite.quick.preview_before')}</strong>
                  <pre>
                    {JSON.stringify(
                      planned.simulation?.before ?? planned.plan.simulation?.before ?? null,
                      null,
                      2
                    )}
                  </pre>
                </div>
                <div>
                  <strong>{t('prompt_rewrite.quick.preview_after')}</strong>
                  <pre>
                    {JSON.stringify(
                      planned.simulation?.after ?? planned.plan.simulation?.after ?? null,
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        ) : null}
        {(planned?.simulation?.warnings ?? planned?.plan.simulation?.warnings ?? []).map(
          (warning) => (
            <div className={styles.quickWarning} key={warning}>
              <ShieldAlert size={14} /> {warning}
            </div>
          )
        )}

        <div className={styles.quickActionBar}>
          <div className={styles.quickSummary}>
            <strong>{selectedPreset ? cleanPresetName(selectedPreset) : ''}</strong>
            <span>{targetSummary}</span>
          </div>
          <div className={styles.quickActions}>
            <Button
              variant="secondary"
              onClick={() => void simulate()}
              loading={busy}
              disabled={
                selectedCapabilityIDs.length === 0 ||
                targets.length === 0 ||
                (mode === 'replace' && !promptReplaceConsent) ||
                Boolean(selectedResponseCapability && !responseModificationConsent)
              }
            >
              <Play size={16} /> {t('prompt_rewrite.quick.simulate')}
            </Button>
            <Button
              onClick={() => void activate()}
              loading={busy}
              disabled={
                !planned ||
                selectedCapabilityIDs.length === 0 ||
                targets.length === 0 ||
                (mode === 'replace' && !promptReplaceConsent) ||
                Boolean(selectedResponseCapability && !responseModificationConsent)
              }
            >
              <Check size={16} /> {t('prompt_rewrite.quick.activate')}
            </Button>
          </div>
        </div>
      </section>

      {activeBindings.length > 0 ? (
        <details className={styles.quickActiveSection}>
          <summary className={styles.quickActiveHeading}>
            <span>{t('prompt_rewrite.quick.active')}</span>
            <span>{activeBindings.length}</span>
          </summary>
          <div className={styles.quickBindingList}>
            {activeBindings.map(({ id, status, binding }) => (
              <div className={styles.quickBinding} key={id}>
                <div>
                  <strong>{status.pack.name}</strong>
                  <span>
                    {binding.operation.includes('response')
                      ? t('prompt_rewrite.quick.response_kind')
                      : t('prompt_rewrite.quick.request_kind')}
                    {' · '}
                    {binding.targets.map((target) => targetText(target, t)).join(' / ')}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void deactivate(status, binding)}
                  disabled={busy}
                  aria-label={t('prompt_rewrite.quick.deactivate')}
                >
                  <Unplug size={15} />
                </Button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
