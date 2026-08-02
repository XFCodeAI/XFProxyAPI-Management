import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconInfo,
  IconLoader2,
  IconRefreshCw,
} from '@/components/ui/icons';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import {
  supplierBillingProbeApi,
  type SupplierBillingProbeEntry,
} from '@/services/api/supplierBillingProbe';
import { maskApiKey } from '@/utils/format';
import type { ApiKeyEntry } from '@/types';
import styles from './forms/sharedForm.module.scss';

interface SupplierBillingProbeSectionProps {
  providerName: string;
  apiKeyEntries: ApiKeyEntry[];
}

const emptyProbeEntry = (apiKeyIndex: number, alias?: string): SupplierBillingProbeEntry => ({
  provider_name: '',
  api_key_index: apiKeyIndex,
  alias,
  status: 'not_checked',
});

const formatRate = (value?: string) => (value ? `${value}x` : '--');

function formatAttemptTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function SupplierBillingProbeSection({
  providerName,
  apiKeyEntries,
}: SupplierBillingProbeSectionProps) {
  const { t } = useTranslation();
  const [probeEntries, setProbeEntries] = useState<Record<number, SupplierBillingProbeEntry>>({});
  const [probing, setProbing] = useState<Set<number>>(() => new Set());
  const scopeKey = useMemo(
    () => `${providerName}\u0000${apiKeyEntries.map((entry) => entry.apiKey).join('\u0000')}`,
    [apiKeyEntries, providerName]
  );

  useEffect(() => {
    let disposed = false;
    setProbeEntries({});
    setProbing(new Set());
    if (!providerName.trim() || apiKeyEntries.length === 0) return undefined;

    void supplierBillingProbeApi
      .list(providerName)
      .then((response) => {
        if (disposed) return;
        const next: Record<number, SupplierBillingProbeEntry> = {};
        response.entries.forEach((entry) => {
          next[entry.api_key_index] = entry;
        });
        setProbeEntries((current) => ({ ...next, ...current }));
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, [apiKeyEntries.length, providerName, scopeKey]);

  const probe = useCallback(
    async (apiKeyIndex: number, alias?: string) => {
      setProbing((current) => new Set(current).add(apiKeyIndex));
      try {
        const result = await supplierBillingProbeApi.probe(providerName, apiKeyIndex);
        setProbeEntries((current) => ({ ...current, [apiKeyIndex]: result }));
      } catch {
        setProbeEntries((current) => ({
          ...current,
          [apiKeyIndex]: {
            ...emptyProbeEntry(apiKeyIndex, alias),
            status: 'failed',
            last_error: 'request_failed',
          },
        }));
      } finally {
        setProbing((current) => {
          const next = new Set(current);
          next.delete(apiKeyIndex);
          return next;
        });
      }
    },
    [providerName]
  );

  const renderStatusIcon = (entry: SupplierBillingProbeEntry, isProbing: boolean) => {
    if (isProbing) {
      return (
        <IconLoader2
          className={`${styles.billingProbeIcon} ${styles.statusIconLoading}`}
          size={14}
        />
      );
    }
    if (entry.status === 'ok') {
      return (
        <IconCheckCircle2
          className={`${styles.billingProbeIcon} ${styles.statusIconSuccess}`}
          size={14}
        />
      );
    }
    if (entry.status === 'not_checked') {
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
          const entry =
            probeEntries[apiKeyIndex] ?? emptyProbeEntry(apiKeyIndex, apiKeyEntry.name?.trim());
          const isProbing = probing.has(apiKeyIndex);
          const multiplier = entry.multiplier;
          const attemptTime = formatAttemptTime(entry.received_at ?? entry.last_attempt_at);
          const statusText = isProbing
            ? t('providersPage.billingProbe.probing')
            : t(`providersPage.billingProbe.status.${entry.status}`);
          const detail =
            entry.status === 'ok' && multiplier
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
              : entry.last_error
                ? t('providersPage.billingProbe.error', {
                    reason: entry.last_error,
                    status: entry.http_status || '--',
                  })
                : null;

          return (
            <div key={`${apiKeyEntry.apiKey}-${apiKeyIndex}`} className={styles.billingProbeItem}>
              <div className={styles.billingProbeIdentity}>
                <span className={styles.billingProbeIndex}>{apiKeyIndex + 1}</span>
                <div className={styles.billingProbeKeyText}>
                  {apiKeyEntry.name?.trim() ? (
                    <span className={styles.billingProbeAlias}>{apiKeyEntry.name.trim()}</span>
                  ) : null}
                  <span className={styles.apiKeyEntryKey}>{maskApiKey(apiKeyEntry.apiKey)}</span>
                </div>
              </div>
              <div className={styles.billingProbeResult}>
                <span className={styles.billingProbeStatus}>
                  {renderStatusIcon(entry, isProbing)}
                  {statusText}
                </span>
                {entry.status === 'ok' && multiplier ? (
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
              <TooltipIconButton
                className={styles.billingProbeRefresh}
                label={t('providersPage.billingProbe.refresh')}
                disabled={isProbing}
                onClick={() => {
                  void probe(apiKeyIndex, apiKeyEntry.name?.trim());
                }}
              >
                {isProbing ? (
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
