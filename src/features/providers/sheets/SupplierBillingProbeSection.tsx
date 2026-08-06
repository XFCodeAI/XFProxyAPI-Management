import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconInfo,
  IconLoader2,
  IconRefreshCw,
} from '@/components/ui/icons';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import type { SupplierBillingProbeEntry } from '@/services/api/supplierBillingProbe';
import { maskApiKey } from '@/utils/format';
import type { ApiKeyEntry } from '@/types';
import styles from './forms/sharedForm.module.scss';

interface SupplierBillingProbeSectionProps {
  entries: readonly SupplierBillingProbeEntry[];
  apiKeyEntries: readonly ApiKeyEntry[];
  matchEntriesByPosition?: boolean;
  onRefresh: (targetId: string) => Promise<void>;
}

const formatRate = (value?: string) => (value ? `${value}x` : '--');

const formatBalance = (value: number | undefined, unit: string | undefined): string | null => {
  if (value === undefined) return null;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${unit?.trim() || 'USD'}`;
};

function formatAttemptTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function SupplierBillingProbeSection({
  entries,
  apiKeyEntries,
  matchEntriesByPosition = false,
  onRefresh,
}: SupplierBillingProbeSectionProps) {
  const { t } = useTranslation();
  const entriesByIndex = new Map(entries.map((entry) => [entry.api_key_index, entry]));

  const renderStatusIcon = (
    status: SupplierBillingProbeEntry['status'] | undefined,
    busy: boolean,
    stale: boolean,
    valid = true
  ) => {
    if (busy) {
      return (
        <IconLoader2
          className={`${styles.billingProbeIcon} ${styles.statusIconLoading}`}
          size={14}
        />
      );
    }
    if (status === 'ok' && !stale && valid) {
      return (
        <IconCheckCircle2
          className={`${styles.billingProbeIcon} ${styles.statusIconSuccess}`}
          size={14}
        />
      );
    }
    if (!status || status === 'not_checked') {
      return <IconInfo className={styles.billingProbeIcon} size={14} />;
    }
    return (
      <IconAlertTriangle
        className={`${styles.billingProbeIcon} ${styles.statusIconError}`}
        size={14}
      />
    );
  };

  return (
    <section
      className={styles.billingProbeSection}
      aria-label={t('providersPage.billingProbe.title')}
    >
      <div className={styles.billingProbeHeader}>
        <div>
          <div className={styles.apiKeyEntriesLabel}>{t('providersPage.billingProbe.title')}</div>
          <p className={styles.billingProbeHint}>{t('providersPage.billingProbe.hint')}</p>
        </div>
      </div>
      <div className={styles.billingProbeList}>
        {apiKeyEntries.map((apiKeyEntry, apiKeyIndex) => {
          const entry = matchEntriesByPosition
            ? entries[apiKeyIndex]
            : entriesByIndex.get(apiKeyIndex);
          const displayAlias = apiKeyEntry.name?.trim() || entry?.alias?.trim();
          const multiplier = entry?.multiplier;
          const busy = Boolean(entry?.probing || entry?.queued);
          const attemptTime = formatAttemptTime(entry?.received_at ?? entry?.last_attempt_at);
          const status = entry?.status ?? 'not_checked';
          const statusText = entry?.probing
            ? t('providersPage.billingProbe.probing')
            : entry?.queued
              ? t('providersPage.billingProbe.queued')
              : entry?.stale && status === 'ok'
                ? t('providersPage.billingProbe.stale')
                : t(`providersPage.billingProbe.status.${status}`);
          const detail = multiplier
            ? [
                t('providersPage.billingProbe.groupRate', {
                  value: formatRate(multiplier.group_rate_multiplier_text),
                }),
                multiplier.user_rate_multiplier_text
                  ? t('providersPage.billingProbe.userRate', {
                      value: formatRate(multiplier.user_rate_multiplier_text),
                    })
                  : null,
                t('providersPage.billingProbe.resolvedRate', {
                  value: formatRate(multiplier.resolved_rate_multiplier_text),
                }),
                multiplier.applied_peak_multiplier_text
                  ? t('providersPage.billingProbe.peakRate', {
                      value: formatRate(multiplier.applied_peak_multiplier_text),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : entry?.last_error
              ? t('providersPage.billingProbe.error', {
                  reason: entry.last_error,
                  status: entry.http_status || '--',
                })
              : null;
          const usage = entry?.usage;
          const usageStatus = usage?.status ?? 'not_checked';
          const usageAttemptTime = formatAttemptTime(usage?.received_at ?? usage?.last_attempt_at);
          const usageStatusText = entry?.probing
            ? t('providersPage.billingProbe.probing')
            : entry?.queued
              ? t('providersPage.billingProbe.queued')
              : usage?.stale && usageStatus === 'ok'
                ? t('providersPage.billingProbe.stale')
                : usageStatus === 'ok' && usage?.is_valid === false
                  ? t('providersPage.billingProbe.usageInvalid')
                  : usageStatus === 'ok'
                    ? t('providersPage.billingProbe.usageValid')
                    : t(`providersPage.billingProbe.status.${usageStatus}`);
          const balance = formatBalance(usage?.remaining, usage?.unit);
          const usageDetail = balance
            ? null
            : usageStatus === 'ok'
              ? t('providersPage.billingProbe.balanceUnavailable')
              : usage?.last_error
                ? t('providersPage.billingProbe.error', {
                    reason: usage.last_error,
                    status: usage.http_status || '--',
                  })
                : null;

          return (
            <div
              key={entry?.target_id ?? `billing-entry-${apiKeyIndex}`}
              className={styles.billingProbeItem}
            >
              <div className={styles.billingProbeIdentity}>
                <span className={styles.billingProbeIndex}>{apiKeyIndex + 1}</span>
                <div className={styles.billingProbeKeyText}>
                  {displayAlias ? (
                    <span className={styles.billingProbeAlias}>{displayAlias}</span>
                  ) : null}
                  <span className={styles.apiKeyEntryKey}>{maskApiKey(apiKeyEntry.apiKey)}</span>
                </div>
              </div>
              <div className={styles.billingProbeResult}>
                <div className={styles.billingProbeMetric}>
                  <span className={styles.billingProbeMetricLabel}>
                    {t('providersPage.billingProbe.metricMultiplier')}
                  </span>
                  <span className={styles.billingProbeStatus}>
                    {renderStatusIcon(entry?.status, busy, Boolean(entry?.stale))}
                    {statusText}
                  </span>
                  {multiplier ? (
                    <strong className={styles.billingProbeEffectiveRate}>
                      {formatRate(multiplier.effective_rate_multiplier_text)}
                    </strong>
                  ) : null}
                  {detail ? <span className={styles.billingProbeMeta}>{detail}</span> : null}
                  {attemptTime ? (
                    <span className={styles.billingProbeMeta}>
                      {t('providersPage.billingProbe.updatedAt', { time: attemptTime })}
                    </span>
                  ) : null}
                </div>
                <div className={styles.billingProbeMetric}>
                  <span className={styles.billingProbeMetricLabel}>
                    {t('providersPage.billingProbe.metricBalance')}
                  </span>
                  <span className={styles.billingProbeStatus}>
                    {renderStatusIcon(
                      usage?.status,
                      busy,
                      Boolean(usage?.stale),
                      usage?.is_valid !== false
                    )}
                    {usageStatusText}
                  </span>
                  {balance ? (
                    <strong
                      className={`${styles.billingProbeEffectiveRate} ${
                        usage?.is_valid === false ? styles.billingProbeInvalidBalance : ''
                      }`}
                    >
                      {balance}
                    </strong>
                  ) : null}
                  {usageDetail ? (
                    <span className={styles.billingProbeMeta}>{usageDetail}</span>
                  ) : null}
                  {usageAttemptTime ? (
                    <span className={styles.billingProbeMeta}>
                      {t('providersPage.billingProbe.updatedAt', { time: usageAttemptTime })}
                    </span>
                  ) : null}
                </div>
              </div>
              <TooltipIconButton
                className={styles.billingProbeRefresh}
                label={t('providersPage.billingProbe.refresh')}
                disabled={!entry?.eligible || busy}
                onClick={() => {
                  if (!entry) return;
                  void onRefresh(entry.target_id).catch(() => undefined);
                }}
              >
                {busy ? (
                  <IconLoader2 className={styles.statusIconLoading} size={15} />
                ) : (
                  <IconRefreshCw size={15} />
                )}
              </TooltipIconButton>
            </div>
          );
        })}
      </div>
    </section>
  );
}
