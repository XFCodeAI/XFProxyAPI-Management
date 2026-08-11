import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Collapsible } from '@/components/ui/Collapsible';
import {
  IconAlertTriangle,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconNetwork,
  IconX,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { RuntimeCapacityBadge } from '@/components/runtime/RuntimeCapacityBadge';
import { useCredentialConcurrencyStore } from '@/stores/useCredentialConcurrencyStore';
import { effectiveMaxConcurrency, normalizeConcurrencySetting } from '@/utils/maxConcurrency';
import { getProviderTotalStats, type ProviderRecentUsageMap } from '@/components/providers/utils';
import { useAuthInventoryStore, useRuntimeObservationStore } from '@/stores';
import { apiKeyUsageApi } from '@/services/api';
import type { ApiKeyFailureHistory, RecentFailure } from '@/utils/recentRequests';
import type { ApiKeyEntry, OpenAIProviderConfig } from '@/types';
import type { SupplierBillingProbeEntry } from '@/services/api/supplierBillingProbe';
import { formatDateTimeValue, maskApiKey } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import type { ProviderResource, SponsorProviderRaw } from '../types';
import {
  buildCodexImageRouteSupplierCatalog,
  formatCodexImageRouteModel,
  inspectCodexImageRoute,
} from '../codexImageRoute';
import {
  buildRuntimeCredentialIDByAuthIndex,
  getProviderRuntimeCredentials,
  getProviderRuntimeObservation,
  getRuntimeCredentialByAuthIndex,
} from '@/features/runtimeObservations/selectors';
import {
  getProviderResourceStatusData,
  getProviderResourceTotalStats,
  getProviderResourceUsage,
} from '../providerUsage';
import { SupplierBillingProbeSection } from './SupplierBillingProbeSection';
import styles from './forms/sharedForm.module.scss';
import statusBarStyles from '../components/providerStatusBar.module.scss';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';

interface ResourceDetailViewProps {
  resource: ProviderResource;
  imageRouteResources?: readonly ProviderResource[];
  usageByProvider?: ProviderRecentUsageMap;
  focusFailureHistory?: boolean;
  billingProbeEntries?: readonly SupplierBillingProbeEntry[];
  onRefreshBillingProbe?: (targetId: string) => Promise<void>;
}

const nativeBillingBrands = new Set<ProviderResource['brand']>(['codex', 'claude', 'xai']);

const kimiBillingAPIKeyEntries = (raw: SponsorProviderRaw): ApiKeyEntry[] => [
  ...raw.openai.flatMap((item) =>
    (item.config.apiKeyEntries ?? []).map((entry) => ({
      ...entry,
      name: entry.name?.trim() ? `OpenAI / ${entry.name.trim()}` : 'OpenAI',
    }))
  ),
  ...raw.claude.map((item) => ({
    name: item.config.name?.trim() ? `Claude / ${item.config.name.trim()}` : 'Claude',
    apiKey: item.config.apiKey,
    proxyUrl: item.config.proxyUrl,
  })),
];

export function ResourceDetailView({
  resource,
  imageRouteResources = [],
  usageByProvider,
  focusFailureHistory = false,
  billingProbeEntries = [],
  onRefreshBillingProbe,
}: ResourceDetailViewProps) {
  const { t, i18n } = useTranslation();
  const authFiles = useAuthInventoryStore((state) => state.files);
  const runtimeResources = useRuntimeObservationStore((state) => state.resourcesByKey);
  const runtimeCredentialsByAuthIndex = useRuntimeObservationStore(
    (state) => state.credentialsByAuthIndex
  );
  const defaultMaxConcurrency = useCredentialConcurrencyStore(
    (state) => state.defaultMaxConcurrency
  );
  const failureSectionRef = useRef<HTMLElement>(null);
  const [failureHistories, setFailureHistories] = useState<ApiKeyFailureHistory[]>([]);
  const [failureHistoryLoading, setFailureHistoryLoading] = useState(false);
  const [failureHistoryError, setFailureHistoryError] = useState<string | null>(null);
  const resolveFieldLabel = (key: string) =>
    key === 'groups'
      ? t('providersPage.detail.fields.groups', { defaultValue: '凭证分组' })
      : t(`providersPage.detail.fields.${key}`);

  const resourceConcurrency = normalizeConcurrencySetting(
    resource.concurrencyMode,
    resource.maxConcurrency
  );
  const displayedMaxConcurrency =
    resource.concurrencyMode === null
      ? resource.maxConcurrency
      : effectiveMaxConcurrency(resourceConcurrency, defaultMaxConcurrency);
  const concurrencySource =
    resource.concurrencyMode === null
      ? t('concurrency.source_aggregate')
      : resourceConcurrency.mode === 'inherit'
        ? t('concurrency.source_inherit')
        : t('concurrency.source_independent');
  const primary: Array<[string, string]> = [
    ['identifier', resource.identifier],
    [
      'groups',
      resource.groups.length > 0 ? resource.groups.join(', ') : t('providersPage.status.none'),
    ],
    ['baseUrl', resource.baseUrl ?? t('providersPage.status.notSet')],
    ['proxyUrl', resource.proxyUrl ?? t('providersPage.status.notSet')],
    ['prefix', resource.prefix ?? t('providersPage.status.none')],
    ['fallback', resource.fallback ? t('common.yes') : t('common.no')],
    [
      'maxConcurrency',
      `${displayedMaxConcurrency > 0 ? displayedMaxConcurrency : t('runtime_observation.unlimited')} · ${concurrencySource}`,
    ],
    ['models', String(resource.modelCount)],
    ['headers', String(resource.headerCount)],
  ];

  const metadata: Array<[string, string]> = [
    ['authIndex', resource.authIndex ?? t('providersPage.status.notSet')],
    ['excludedModels', String(resource.excludedModelCount)],
    ['apiKeyEntries', String(resource.apiKeyEntryCount)],
  ];

  const openaiConfig =
    resource.brand === 'openaiCompatibility'
      ? ((resource.usageRaw ?? resource.raw) as OpenAIProviderConfig)
      : null;
  const imageRouteSuppliers = useMemo(
    () => buildCodexImageRouteSupplierCatalog(imageRouteResources),
    [imageRouteResources]
  );
  const imageRouteInspection = useMemo(
    () => inspectCodexImageRoute(openaiConfig?.codexImageRoute, imageRouteSuppliers),
    [imageRouteSuppliers, openaiConfig?.codexImageRoute]
  );
  const imageRouteIssueMessage = (() => {
    switch (imageRouteInspection.issue) {
      case 'target_supplier_required':
        return t('providersPage.imageRoute.issues.targetSupplierRequired');
      case 'target_model_required':
        return t('providersPage.imageRoute.issues.targetModelRequired');
      case 'supplier_missing':
        return t('providersPage.imageRoute.issues.supplierMissing', {
          supplier: imageRouteInspection.targetSupplier,
        });
      case 'supplier_ambiguous':
        return t('providersPage.imageRoute.issues.supplierAmbiguous', {
          supplier: imageRouteInspection.targetSupplier,
        });
      case 'model_missing':
        return t('providersPage.imageRoute.issues.modelMissing', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
          model: imageRouteInspection.targetModel,
        });
      case 'model_ambiguous':
        return t('providersPage.imageRoute.issues.modelAmbiguous', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
          model: imageRouteInspection.targetModel,
        });
      case 'model_not_image':
        return t('providersPage.imageRoute.issues.modelNotImage', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
          model: imageRouteInspection.targetModel,
        });
      case 'supplier_disabled':
        return t('providersPage.imageRoute.issues.supplierDisabled', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
        });
      case 'supplier_no_credentials':
        return t('providersPage.imageRoute.issues.supplierNoCredentials', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
        });
      case 'supplier_not_ready':
        return t('providersPage.imageRoute.issues.supplierNotReady', {
          supplier: imageRouteInspection.supplier?.name ?? imageRouteInspection.targetSupplier,
        });
      default:
        return '';
    }
  })();
  const apiKeyEntries = openaiConfig?.apiKeyEntries ?? [];
  const billingApiKeyEntries: ApiKeyEntry[] = openaiConfig
    ? apiKeyEntries
    : nativeBillingBrands.has(resource.brand) && resource.apiKey
      ? [{ name: resource.name ?? undefined, apiKey: resource.apiKey }]
      : resource.brand === 'kimi'
        ? kimiBillingAPIKeyEntries((resource.billingRaw ?? resource.raw) as SponsorProviderRaw)
        : [];
  const providerUsage = useMemo(
    () => (usageByProvider ? getProviderResourceUsage(resource, usageByProvider) : null),
    [resource, usageByProvider]
  );
  const runtimeObservation = useMemo(
    () =>
      getProviderRuntimeObservation(
        resource,
        authFiles,
        runtimeResources,
        runtimeCredentialsByAuthIndex
      ),
    [authFiles, resource, runtimeCredentialsByAuthIndex, runtimeResources]
  );
  const runtimeCredentials = useMemo(
    () =>
      getProviderRuntimeCredentials(
        resource,
        authFiles,
        runtimeResources,
        runtimeCredentialsByAuthIndex
      ),
    [authFiles, resource, runtimeCredentialsByAuthIndex, runtimeResources]
  );
  const runtimeCredentialIDByAuthIndex = useMemo(
    () => buildRuntimeCredentialIDByAuthIndex(authFiles),
    [authFiles]
  );
  const totalStats = runtimeObservation
    ? { success: runtimeObservation.success, failure: runtimeObservation.failed }
    : usageByProvider
      ? getProviderResourceTotalStats(resource, usageByProvider)
      : null;
  const recentStatus = runtimeObservation
    ? statusBarDataFromRecentRequests(runtimeObservation.recentRequests)
    : usageByProvider
      ? getProviderResourceStatusData(resource, usageByProvider)
      : null;
  const authIndexesKey = providerUsage?.authIndexes.join('\u0000') ?? '';
  const hasRecentFailures = (providerUsage?.recentFailureCount ?? 0) > 0;

  useEffect(() => {
    const authIndexes = providerUsage?.authIndexes ?? [];
    if (!hasRecentFailures || authIndexes.length === 0) {
      setFailureHistories([]);
      setFailureHistoryLoading(false);
      setFailureHistoryError(null);
      return;
    }

    let cancelled = false;
    setFailureHistories([]);
    setFailureHistoryLoading(true);
    setFailureHistoryError(null);
    void Promise.allSettled(authIndexes.map((authIndex) => apiKeyUsageApi.getFailures(authIndex)))
      .then((results) => {
        if (cancelled) return;
        const histories = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        setFailureHistories(histories);
        if (firstFailure) {
          setFailureHistoryError(
            histories.length > 0
              ? t('providersPage.failures.partialError')
              : getErrorMessage(firstFailure.reason, t('providersPage.failures.loadError'))
          );
        }
      })
      .finally(() => {
        if (!cancelled) setFailureHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authIndexesKey, hasRecentFailures, providerUsage?.authIndexes, t]);

  useEffect(() => {
    if (!focusFailureHistory || !hasRecentFailures) return;
    const frame = window.requestAnimationFrame(() => {
      failureSectionRef.current?.scrollIntoView({ block: 'start' });
      failureSectionRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusFailureHistory, hasRecentFailures, resource.id]);

  const monitoringHref = (history: ApiKeyFailureHistory, failure: RecentFailure): string => {
    const params = new URLSearchParams({ result: 'failure' });
    if (history.authId) params.set('auth_id', history.authId);
    if (failure.requestId) params.set('request_id', failure.requestId);
    return `/monitoring?${params.toString()}`;
  };

  return (
    <div>
      <div className={styles.detailHeader}>
        <div className={styles.sectionTitle}>{resource.name ?? resource.identifier}</div>
        <RuntimeCapacityBadge
          resource={runtimeObservation ?? undefined}
          mode={resource.concurrencyMode}
          maxConcurrency={resource.maxConcurrency}
          aggregate={resource.concurrencyMode === null}
        />
      </div>

      <dl className={styles.dl}>
        {primary.map(([key, value]) => (
          <div key={key}>
            <dt className={styles.dt}>{resolveFieldLabel(key)}</dt>
            <dd className={styles.dd}>{value}</dd>
          </div>
        ))}
      </dl>

      {openaiConfig?.codexImageRoute ? (
        <section className={styles.imageRouteDetailSection}>
          <div className={styles.imageRouteDetailHeader}>
            <div className={styles.apiKeyEntriesLabel}>{t('providersPage.imageRoute.title')}</div>
            <span
              className={`${styles.imageRouteBadge} ${styles[`imageRouteBadge_${imageRouteInspection.status}`]}`}
            >
              <IconNetwork size={13} />
              {t(`providersPage.imageRoute.status.${imageRouteInspection.status}`)}
            </span>
          </div>
          {imageRouteInspection.status !== 'disabled' ? (
            <dl className={styles.imageRouteDetailGrid}>
              <div>
                <dt>{t('providersPage.imageRoute.targetSupplier')}</dt>
                <dd>
                  {imageRouteInspection.supplier?.name ||
                    imageRouteInspection.targetSupplier ||
                    t('providersPage.status.notSet')}
                </dd>
              </div>
              <div>
                <dt>{t('providersPage.imageRoute.targetModel')}</dt>
                <dd>
                  {imageRouteInspection.model
                    ? formatCodexImageRouteModel(imageRouteInspection.model)
                    : imageRouteInspection.targetModel || t('providersPage.status.notSet')}
                </dd>
              </div>
            </dl>
          ) : null}
          {imageRouteIssueMessage ? (
            <p className={styles.imageRouteDetailMessage}>{imageRouteIssueMessage}</p>
          ) : null}
        </section>
      ) : null}

      {totalStats && recentStatus ? (
        <section className={styles.detailUsageSection}>
          <div className={styles.apiKeyEntriesLabel}>{t('providersPage.detail.requestHealth')}</div>
          <div className={styles.detailUsageStats}>
            <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
              <IconCheck size={12} /> {t('stats.success')}: {totalStats.success}
            </span>
            <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
              <IconX size={12} /> {t('stats.failure')}: {totalStats.failure}
            </span>
          </div>
          <ProviderStatusBar statusData={recentStatus} styles={statusBarStyles} />
        </section>
      ) : null}

      {hasRecentFailures ? (
        <section
          ref={failureSectionRef}
          className={styles.failureHistorySection}
          tabIndex={-1}
          aria-labelledby="provider-failure-history-title"
        >
          <div className={styles.failureHistoryHeader}>
            <div className={styles.apiKeyEntriesLabel} id="provider-failure-history-title">
              {t('providersPage.failures.title')}
            </div>
            <span className={styles.failureHistoryCount}>
              {providerUsage?.recentFailureCount ?? 0}
            </span>
          </div>

          {failureHistoryLoading ? (
            <div className={styles.failureHistoryState} aria-live="polite">
              <IconLoader2 className={styles.failureHistorySpinner} size={15} />
              <span>{t('providersPage.failures.loading')}</span>
            </div>
          ) : null}
          {failureHistoryError ? (
            <div className={styles.failureHistoryError} role="alert">
              <IconAlertTriangle size={15} />
              <span>{failureHistoryError}</span>
            </div>
          ) : null}

          {!failureHistoryLoading &&
          failureHistories.every((history) => history.failures.length === 0) ? (
            <div className={styles.failureHistoryState}>{t('providersPage.failures.empty')}</div>
          ) : null}

          <div className={styles.failureHistoryList}>
            {failureHistories.map((history) => (
              <div key={history.authIndex} className={styles.failureHistoryGroup}>
                <div className={styles.failureIdentity}>
                  <strong>
                    {history.alias || history.keyPreview || history.provider || history.authIndex}
                  </strong>
                  {history.alias && history.keyPreview ? <span>{history.keyPreview}</span> : null}
                </div>
                {history.failures.map((failure, failureIndex) => {
                  const timestamp =
                    formatDateTimeValue(failure.timestamp, i18n.language) ||
                    t('providersPage.status.notSet');
                  const fields: Array<[string, string]> = [
                    ...(failure.statusCode
                      ? [
                          [
                            t('providersPage.failures.fields.statusCode'),
                            `HTTP ${failure.statusCode}`,
                          ] as [string, string],
                        ]
                      : []),
                    ...(failure.code
                      ? [
                          [t('providersPage.failures.fields.code'), failure.code] as [
                            string,
                            string,
                          ],
                        ]
                      : []),
                    [
                      t('providersPage.failures.fields.scope'),
                      t(`providersPage.failures.scopes.${failure.scope}`, {
                        defaultValue: failure.scope,
                      }),
                    ],
                    ...(failure.model
                      ? [
                          [t('providersPage.failures.fields.model'), failure.model] as [
                            string,
                            string,
                          ],
                        ]
                      : []),
                    ...(failure.requestId
                      ? [
                          [t('providersPage.failures.fields.requestId'), failure.requestId] as [
                            string,
                            string,
                          ],
                        ]
                      : []),
                    [
                      t('providersPage.failures.fields.retryable'),
                      failure.retryable ? t('common.yes') : t('common.no'),
                    ],
                    ...(failure.retryAfterSeconds !== undefined
                      ? [
                          [
                            t('providersPage.failures.fields.retryAfter'),
                            t('providersPage.failures.seconds', {
                              count: failure.retryAfterSeconds,
                            }),
                          ] as [string, string],
                        ]
                      : []),
                    ...(failure.nextRetryAt
                      ? [
                          [
                            t('providersPage.failures.fields.nextRetryAt'),
                            formatDateTimeValue(failure.nextRetryAt, i18n.language) ||
                              failure.nextRetryAt,
                          ] as [string, string],
                        ]
                      : []),
                  ];
                  return (
                    <article
                      key={`${failure.timestamp}:${failure.requestId ?? failureIndex}`}
                      className={styles.failureHistoryItem}
                    >
                      <div className={styles.failureHistoryItemHeader}>
                        <time dateTime={failure.timestamp || undefined}>{timestamp}</time>
                        {history.monitoringAvailable && failure.requestId ? (
                          <Link
                            className={styles.failureMonitoringLink}
                            to={monitoringHref(history, failure)}
                          >
                            <IconExternalLink size={13} />
                            <span>{t('providersPage.failures.openMonitoring')}</span>
                          </Link>
                        ) : null}
                      </div>
                      <p className={styles.failureMessage}>{failure.message}</p>
                      <dl className={styles.failureMetadata}>
                        {fields.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {openaiConfig && apiKeyEntries.length > 0 ? (
        <div className={styles.apiKeyEntriesSection}>
          <div className={styles.apiKeyEntriesLabel}>
            {t('providersPage.form.apiKeyEntriesSection')}: {apiKeyEntries.length}
          </div>
          <div className={styles.apiKeyEntryList}>
            {apiKeyEntries.map((entry, entryIndex) => {
              const runtimeEntry = getRuntimeCredentialByAuthIndex(
                entry.authIndex,
                runtimeCredentialIDByAuthIndex,
                runtimeResources,
                runtimeCredentialsByAuthIndex
              );
              const entryStats = runtimeEntry
                ? { success: runtimeEntry.success, failure: runtimeEntry.failed }
                : usageByProvider
                  ? getProviderTotalStats(
                      usageByProvider,
                      openaiConfig.name,
                      entry.apiKey,
                      openaiConfig.baseUrl
                    )
                  : { success: 0, failure: 0 };
              return (
                <div key={`${entry.apiKey}-${entryIndex}`} className={styles.apiKeyEntryCard}>
                  <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                  <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                  {entry.name?.trim() ? (
                    <span className={styles.apiKeyEntryAlias}>{entry.name.trim()}</span>
                  ) : null}
                  {entry.proxyUrl ? (
                    <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                  ) : null}
                  {entry.groups?.length ? (
                    <div className={styles.groupBadgeRow}>
                      {entry.groups.map((group) => (
                        <span key={group} className={styles.groupBadge}>
                          {group}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className={styles.apiKeyEntryStats}>
                    <RuntimeCapacityBadge
                      resource={runtimeEntry ?? undefined}
                      mode={entry.concurrencyMode}
                      maxConcurrency={entry.maxConcurrency ?? 0}
                    />
                    <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
                      <IconCheck size={12} /> {entryStats.success}
                    </span>
                    <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
                      <IconX size={12} /> {entryStats.failure}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {resource.brand === 'kimi' && runtimeCredentials.length > 0 ? (
        <div className={styles.apiKeyEntriesSection}>
          <div className={styles.apiKeyEntriesLabel}>
            {t('runtime_observation.protocol_limits')}
          </div>
          <div className={styles.apiKeyEntryList}>
            {runtimeCredentials.map((credential) => (
              <div key={credential.id} className={styles.apiKeyEntryCard}>
                <span className={styles.apiKeyEntryKey}>{credential.name}</span>
                <span className={styles.apiKeyEntryAlias}>{credential.provider}</span>
                <div className={styles.apiKeyEntryStats}>
                  <RuntimeCapacityBadge resource={credential} aggregate />
                  <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
                    <IconCheck size={12} /> {credential.success}
                  </span>
                  <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
                    <IconX size={12} /> {credential.failed}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {billingApiKeyEntries.length > 0 && onRefreshBillingProbe ? (
        <SupplierBillingProbeSection
          entries={billingProbeEntries}
          apiKeyEntries={billingApiKeyEntries}
          matchEntriesByPosition={resource.brand === 'kimi'}
          onRefresh={onRefreshBillingProbe}
        />
      ) : null}

      <div className={styles.metadataSection}>
        <Collapsible label={t('providersPage.detail.metadataTitle')}>
          <dl className={styles.dl}>
            {metadata.map(([key, value]) => (
              <div key={key}>
                <dt className={styles.dt}>{resolveFieldLabel(key)}</dt>
                <dd className={styles.dd}>{value}</dd>
              </div>
            ))}
          </dl>
        </Collapsible>
      </div>
    </div>
  );
}
