import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconEye,
  IconInfo,
  IconLoader2,
  IconNetwork,
  IconPencil,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { TooltipIconButton as ActionTooltipButton } from '@/components/ui/TooltipControls';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { RuntimeCapacityBadge } from '@/components/runtime/RuntimeCapacityBadge';
import { RuntimeAvailabilityBadge } from '@/components/runtime/RuntimeAvailabilityBadge';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { useAuthInventoryStore, useRuntimeObservationStore } from '@/stores';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import type { SupplierBillingProbeEntry } from '@/services/api/supplierBillingProbe';
import type { OpenAIProviderConfig } from '@/types';
import type { ProviderResource } from '../types';
import {
  buildCodexImageRouteSupplierCatalog,
  formatCodexImageRouteModel,
  inspectCodexImageRoute,
} from '../codexImageRoute';
import {
  getProviderResourceStatusData,
  getProviderResourceTotalStats,
  getProviderResourceUsage,
} from '../providerUsage';
import { getProviderHomepageUrl } from '../providerHomepage';
import { getProviderRuntimeObservation } from '@/features/runtimeObservations/selectors';
import {
  supplierBillingResourceKey,
  type SupplierBillingProbeEntriesByResource,
} from '../useSupplierBillingProbes';
import { getSupplierRecoveryControlState } from '../supplierRecoveryControl';
import styles from './ProviderResourceTable.module.scss';
import statusBarStyles from './providerStatusBar.module.scss';

interface ProviderResourceTableProps {
  resources: ProviderResource[];
  selectedId?: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  billingProbeEntriesByResource?: SupplierBillingProbeEntriesByResource;
  imageRouteResources?: readonly ProviderResource[];
  onRefreshBillingProbe?: (targetId: string) => Promise<void>;
  recoveringSupplierIds?: ReadonlySet<string>;
  onRecoverSuppliers?: (supplierIds: readonly string[]) => Promise<void>;
  onView: (resource: ProviderResource) => void;
  onViewFailures: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled?: (resource: ProviderResource, disabled: boolean) => void;
}

const columnWidths = ['154px', '180px', '160px', '90px', '210px'];

const formatUsageBalance = (
  remaining: number,
  unit: string | undefined,
  locale: string
): string => {
  let value = String(remaining);
  try {
    value = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(remaining);
  } catch {
    value = String(remaining);
  }
  return `${value} ${unit?.trim() || 'USD'}`;
};

export function ProviderResourceTable({
  resources,
  selectedId,
  disableMutations,
  usageByProvider,
  billingProbeEntriesByResource,
  imageRouteResources = [],
  onRefreshBillingProbe,
  recoveringSupplierIds = new Set<string>(),
  onRecoverSuppliers,
  onView,
  onViewFailures,
  onEdit,
  onDelete,
  onToggleDisabled,
}: ProviderResourceTableProps) {
  const { t, i18n } = useTranslation();
  const authFiles = useAuthInventoryStore((state) => state.files);
  const runtimeResources = useRuntimeObservationStore((state) => state.resourcesByKey);
  const runtimeCredentialsByAuthIndex = useRuntimeObservationStore(
    (state) => state.credentialsByAuthIndex
  );
  const imageRouteSuppliers = useMemo(
    () => buildCodexImageRouteSupplierCatalog(imageRouteResources),
    [imageRouteResources]
  );

  const renderStatus = (
    resource: ProviderResource,
    runtimeResource: ReturnType<typeof getProviderRuntimeObservation>
  ) => {
    const connectivity = resource.runtimeStatus?.connectivity ?? 'unknown';
    const scheduling =
      resource.runtimeStatus?.scheduling ?? (resource.disabled ? 'disabled' : 'not_registered');
    const ready = resource.runtimeStatus?.ready === true && !resource.disabled;
    const statusClass = ready
      ? styles.statusActive
      : connectivity === 'unreachable' || scheduling === 'unavailable'
        ? styles.statusError
        : scheduling === 'cooling' || scheduling === 'no_effective_model'
          ? styles.statusWarning
          : styles.statusDisabled;
    const label = ready
      ? t('providersPage.runtime.scheduling.ready')
      : connectivity === 'unreachable'
        ? t('providersPage.runtime.connectivity.unreachable')
        : t(`providersPage.runtime.scheduling.${scheduling}`);
    const title = `${t(`providersPage.runtime.connectivity.${connectivity}`)} · ${t(
      `providersPage.runtime.scheduling.${scheduling}`
    )}`;

    return (
      <>
        <span className={`${styles.statusBadge} ${statusClass}`} title={title}>
          {ready ? <IconCheckCircle2 size={14} /> : <IconAlertTriangle size={14} />}
          {label}
        </span>
        <RuntimeCapacityBadge
          resource={runtimeResource ?? undefined}
          mode={resource.concurrencyMode}
          maxConcurrency={resource.maxConcurrency}
          aggregate={resource.concurrencyMode === null}
        />
        <RuntimeAvailabilityBadge resource={runtimeResource ?? undefined} />
      </>
    );
  };

  const renderRequestHealth = (
    resource: ProviderResource,
    runtimeResource: ReturnType<typeof getProviderRuntimeObservation>
  ) => {
    if (!usageByProvider && !runtimeResource) return null;
    const stats = runtimeResource
      ? { success: runtimeResource.success, failure: runtimeResource.failed }
      : getProviderResourceTotalStats(resource, usageByProvider!);
    const statusData = runtimeResource
      ? statusBarDataFromRecentRequests(runtimeResource.recentRequests)
      : getProviderResourceStatusData(resource, usageByProvider!);
    const usage = usageByProvider ? getProviderResourceUsage(resource, usageByProvider) : null;
    const latestFailure = usage?.latestFailure ?? null;
    const failureMeta = latestFailure
      ? [
          latestFailure.statusCode ? `HTTP ${latestFailure.statusCode}` : '',
          latestFailure.code ?? '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

    return (
      <>
        <div className={styles.stats}>
          <span className={`${styles.statPill} ${styles.statSuccess}`}>
            {t('stats.success')}: {stats.success}
          </span>
          {(usage?.recentFailureCount ?? 0) > 0 ? (
            <button
              type="button"
              className={`${styles.statPill} ${styles.statFailure} ${styles.statFailureButton}`}
              aria-label={t('providersPage.failures.viewHistory', {
                count: usage?.recentFailureCount ?? 0,
              })}
              onClick={(event) => {
                event.stopPropagation();
                onViewFailures(resource);
              }}
            >
              {t('stats.failure')}: {stats.failure}
            </button>
          ) : (
            <span className={`${styles.statPill} ${styles.statFailure}`}>
              {t('stats.failure')}: {stats.failure}
            </span>
          )}
        </div>
        <div className={styles.statusBarWrap}>
          <ProviderStatusBar statusData={statusData} styles={statusBarStyles} />
        </div>
        {latestFailure ? (
          <div className={styles.latestFailure} title={latestFailure.message}>
            <IconAlertTriangle size={13} />
            <span className={styles.latestFailureText}>
              {failureMeta ? <strong>{failureMeta}</strong> : null}
              <span>{latestFailure.message}</span>
            </span>
          </div>
        ) : null}
      </>
    );
  };

  const renderPrimary = (resource: ProviderResource) => {
    const name = resource.name ?? resource.identifier;
    const homepageUrl = getProviderHomepageUrl(resource.baseUrl);
    const imageRoute =
      resource.brand === 'openaiCompatibility'
        ? (resource.raw as OpenAIProviderConfig).codexImageRoute
        : undefined;
    const imageRouteInspection = inspectCodexImageRoute(imageRoute, imageRouteSuppliers);
    const imageRouteTarget = imageRouteInspection.model
      ? `${imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier} / ${formatCodexImageRouteModel(imageRouteInspection.model)}`
      : [imageRouteInspection.targetSupplier, imageRouteInspection.targetModel]
          .filter(Boolean)
          .join(' / ');
    const secondary = [
      resource.apiKeyPreview,
      resource.apiKeyEntryCount > 1
        ? t('providersPage.table.keyCount', { count: resource.apiKeyEntryCount })
        : null,
      resource.groups.length > 0
        ? t('providersPage.table.groupSummary', { groups: resource.groups.join(', ') })
        : null,
      resource.fallback ? t('providersPage.table.fallbackTag') : null,
    ].filter((value): value is string => Boolean(value));

    return (
      <div className={styles.primaryCell}>
        {homepageUrl ? (
          <a
            className={`${styles.primaryName} ${styles.primaryNameLink}`}
            href={homepageUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={homepageUrl}
          >
            {name}
          </a>
        ) : (
          <span className={styles.primaryName}>{name}</span>
        )}
        {secondary.length > 0 ? (
          <span className={styles.primarySub}>{secondary.join(' · ')}</span>
        ) : null}
        {imageRoute?.enabled ? (
          <span
            className={`${styles.imageRouteIndicator} ${styles[`imageRouteIndicator_${imageRouteInspection.status}`]}`}
            title={`${t(`providersPage.imageRoute.status.${imageRouteInspection.status}`)}${imageRouteTarget ? ` · ${imageRouteTarget}` : ''}`}
          >
            <IconNetwork size={12} />
            <span>
              {imageRouteTarget ||
                t(`providersPage.imageRoute.status.${imageRouteInspection.status}`)}
            </span>
          </span>
        ) : null}
      </div>
    );
  };

  const renderBaseUrl = (resource: ProviderResource) => {
    if (resource.brand === 'claude' && !resource.baseUrl) {
      return (
        <span className={styles.baseUrl}>
          https://api.anthropic.com {t('providersPage.status.defaultSuffix')}
        </span>
      );
    }
    return (
      <span className={styles.baseUrl} title={resource.baseUrl ?? undefined}>
        {resource.baseUrl ?? t('providersPage.status.notSet')}
      </span>
    );
  };

  const billingStatusText = (entry: SupplierBillingProbeEntry): string => {
    if (entry.probing) return t('providersPage.billingProbe.probing');
    if (entry.queued) return t('providersPage.billingProbe.queued');
    if (entry.stale && entry.status === 'ok') return t('providersPage.billingProbe.stale');
    return t(`providersPage.billingProbe.status.${entry.status}`);
  };

  const usageStatusText = (entry: SupplierBillingProbeEntry): string => {
    const usage = entry.usage;
    if (entry.probing) return t('providersPage.billingProbe.probing');
    if (entry.queued) return t('providersPage.billingProbe.queued');
    if (!usage) return t('providersPage.billingProbe.status.not_checked');
    if (usage.stale && usage.status === 'ok') return t('providersPage.billingProbe.stale');
    if (usage.status === 'ok' && usage.is_valid === false) {
      return t('providersPage.billingProbe.usageInvalid');
    }
    if (usage.status === 'ok' && usage.remaining === undefined) {
      return t('providersPage.billingProbe.balanceUnavailable');
    }
    return t(`providersPage.billingProbe.status.${usage.status}`);
  };

  const formatProbeTime = (value: string | undefined): string => {
    if (!value) return '';
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(timestamp);
    } catch {
      return timestamp.toLocaleString();
    }
  };

  const renderAvailabilityDetail = (entry: SupplierBillingProbeEntry) => {
    const runtime = entry.runtime;
    if (!runtime) return null;
    const reasonCode = runtime.availability_reason?.trim() || runtime.provider_code?.trim() || '';
    const reason = reasonCode
      ? t(`providersPage.availabilityRecovery.reasons.${reasonCode}`, {
          defaultValue: reasonCode,
        })
      : t(`runtime_observation.availability.${runtime.availability_state}`);
    const deadline = formatProbeTime(
      runtime.availability_deadline ||
        (runtime.availability_state === 'usage_wait'
          ? entry.usage?.reset_at || entry.usage?.next_probe_at
          : undefined)
    );
    if (runtime.availability_state === 'ready' && !deadline) return null;
    const stateText =
      runtime.availability_state === 'usage_wait'
        ? t('providersPage.availabilityRecovery.waitReason', { reason })
        : t(`runtime_observation.availability.${runtime.availability_state}`);
    return (
      <span className={styles.availabilityDetail} title={runtime.provider_code || stateText}>
        <span>{stateText}</span>
        {deadline ? (
          <span>{t('providersPage.availabilityRecovery.nextProbe', { time: deadline })}</span>
        ) : null}
      </span>
    );
  };

  const renderBillingStatusIcon = (entry: SupplierBillingProbeEntry) => {
    if (entry.probing || entry.queued) {
      return <IconLoader2 className={styles.rateLoading} size={13} />;
    }
    if (entry.status === 'ok' && !entry.stale) {
      return <IconCheckCircle2 className={styles.rateSuccess} size={13} />;
    }
    if (entry.status === 'not_checked') {
      return <IconInfo className={styles.rateMuted} size={13} />;
    }
    return <IconAlertTriangle className={styles.rateError} size={13} />;
  };

  const renderMultiplier = (resource: ProviderResource) => {
    const entries =
      billingProbeEntriesByResource?.[
        supplierBillingResourceKey(resource.brand, resource.originalIndex)
      ] ?? [];
    if (entries.length === 0) {
      return (
        <span className={styles.rateUnavailable}>
          {t('providersPage.billingProbe.notEligible')}
        </span>
      );
    }
    const multiple = entries.length > 1;
    return (
      <div className={styles.rateList}>
        {entries.map((entry) => {
          const busy = entry.probing || entry.queued;
          const statusText = billingStatusText(entry);
          const rate = entry.multiplier?.effective_rate_multiplier_text;
          const usage = entry.usage;
          const usageAmount =
            usage?.remaining !== undefined
              ? formatUsageBalance(usage.remaining, usage.unit, i18n.language)
              : null;
          const usageState = usageStatusText(entry);
          const usageWarning =
            !usage || usage.status !== 'ok' || usage.stale || usage.is_valid === false;
          const usageError = usage?.status === 'failed' || usage?.is_valid === false;
          return (
            <div
              key={entry.target_id}
              className={`${styles.rateLine} ${multiple ? styles.rateLineWithAlias : ''}`}
              title={`${statusText} · ${usageStatusText(entry)}`}
            >
              {multiple ? (
                <span className={styles.rateAlias} title={entry.alias}>
                  {entry.alias ||
                    t('providersPage.billingProbe.keyNumber', {
                      index: entry.api_key_index + 1,
                    })}
                </span>
              ) : null}
              <span className={styles.rateMetrics}>
                <span className={styles.rateValue}>{rate ? `${rate}x` : statusText}</span>
                <span
                  className={`${styles.usageValue} ${usageWarning ? styles.usageValueWarning : ''}`}
                >
                  {usageAmount ?? usageState}
                </span>
                {usageAmount && usageWarning ? (
                  <span
                    className={`${styles.usageState} ${usageError ? styles.usageStateError : ''}`}
                  >
                    {usageState}
                  </span>
                ) : null}
              </span>
              <span className={styles.rateStatusSlot}>{renderBillingStatusIcon(entry)}</span>
              <span className={styles.rateRefreshSlot}>
                {entry.eligible && onRefreshBillingProbe ? (
                  <ActionTooltipButton
                    className={styles.rateRefresh}
                    label={t('providersPage.billingProbe.refresh')}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onRefreshBillingProbe(entry.target_id).catch(() => undefined);
                    }}
                  >
                    <IconRefreshCw size={14} />
                  </ActionTooltipButton>
                ) : null}
              </span>
              {renderAvailabilityDetail(entry)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Table
      className={styles.providerTable}
      cols={columnWidths.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    >
      <TableHeader>
        <TableRow>
          <TableHead>{t('providersPage.table.supplier')}</TableHead>
          <TableHead>{t('providersPage.table.status')}</TableHead>
          <TableHead>{t('providersPage.table.multiplierBalance')}</TableHead>
          <TableHead>{t('providersPage.table.serviceAddress')}</TableHead>
          <TableHead alignRight className={styles.actionsHead}>
            {t('providersPage.table.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resources.map((resource) => {
          const billingEntries =
            billingProbeEntriesByResource?.[
              supplierBillingResourceKey(resource.brand, resource.originalIndex)
            ] ?? [];
          const runtimeResource = getProviderRuntimeObservation(
            resource,
            authFiles,
            runtimeResources,
            runtimeCredentialsByAuthIndex
          );
          const recoveryControl = getSupplierRecoveryControlState(
            billingEntries,
            resource.disabled,
            recoveringSupplierIds,
            runtimeResource?.availabilityState ?? 'unknown'
          );
          const recoveryLabel = t(
            `providersPage.availabilityRecovery.actions.${recoveryControl.reason}`
          );
          return (
            <TableRow
              key={resource.id}
              className={styles.resourceRow}
              selected={resource.id === selectedId}
            >
              <TableCell className={styles.primaryTableCell}>{renderPrimary(resource)}</TableCell>
              <TableCell className={styles.statusTableCell}>
                <div className={styles.statusCell}>
                  <div className={styles.statusSummary}>
                    {renderStatus(resource, runtimeResource)}
                  </div>
                  {renderRequestHealth(resource, runtimeResource)}
                </div>
              </TableCell>
              <TableCell className={styles.rateCell}>
                <span className={styles.mobileRateLabel} data-testid="provider-rate-label">
                  {t('providersPage.table.multiplierBalance')}
                </span>
                {renderMultiplier(resource)}
              </TableCell>
              <TableCell className={styles.baseUrlCell}>{renderBaseUrl(resource)}</TableCell>
              <TableCell
                alignRight
                className={[
                  styles.actionsCell,
                  resource.id === selectedId ? styles.actionsCellSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.actions}>
                  <span className={styles.recoveryAction} title={recoveryLabel}>
                    <ActionTooltipButton
                      className={styles.iconBtn}
                      label={recoveryLabel}
                      disabled={recoveryControl.disabled || !onRecoverSuppliers}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (recoveryControl.disabled || !onRecoverSuppliers) return;
                        void onRecoverSuppliers(recoveryControl.supplierIds).catch(() => undefined);
                      }}
                    >
                      {recoveryControl.reason === 'probing' ? (
                        <IconLoader2 className={styles.rateLoading} size={16} />
                      ) : (
                        <IconRefreshCw size={16} />
                      )}
                    </ActionTooltipButton>
                  </span>
                  {onToggleDisabled ? (
                    <span
                      className={styles.toggleWrap}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ToggleSwitch
                        checked={!resource.disabled}
                        disabled={disableMutations}
                        onChange={(value) => onToggleDisabled(resource, !value)}
                        ariaLabel={
                          resource.disabled
                            ? t('providersPage.actions.enable')
                            : t('providersPage.actions.disable')
                        }
                      />
                    </span>
                  ) : null}
                  <ActionTooltipButton
                    className={styles.iconBtn}
                    label={t('providersPage.actions.view')}
                    onClick={(event) => {
                      event.stopPropagation();
                      onView(resource);
                    }}
                  >
                    <IconEye size={16} />
                  </ActionTooltipButton>
                  <ActionTooltipButton
                    className={styles.iconBtn}
                    label={t('providersPage.actions.edit')}
                    disabled={disableMutations}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(resource);
                    }}
                  >
                    <IconPencil size={16} />
                  </ActionTooltipButton>
                  <ActionTooltipButton
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    label={t('providersPage.actions.delete')}
                    disabled={disableMutations}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(resource);
                    }}
                  >
                    <IconTrash2 size={16} />
                  </ActionTooltipButton>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
