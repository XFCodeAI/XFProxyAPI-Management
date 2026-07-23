import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  CloudDownload,
  DollarSign,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import {
  isModelPricesCapabilityUnavailable,
  modelPricesApi,
  type ModelPriceCatalog,
  type ModelPriceCatalogAvailable,
  type ModelPriceRule,
  type ModelPriceSyncCandidate,
  type ModelPriceSyncPreview,
  type ModelPriceSyncSource,
} from '@/services/api';
import {
  buildModelPriceRows,
  buildModelPriceRuleInput,
  canAcceptSyncCandidate,
  createModelPriceDraft,
  filterModelPriceRows,
  getDecimalDisplayKind,
  toggleAcceptedCandidate,
  validateModelPriceDraft,
  type ModelPriceDraft,
  type ModelPriceDraftErrors,
  type ModelPriceFilter,
  type ModelPriceRow,
} from '@/features/modelPrices/viewModel';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import type { ApiError } from '@/types/api';
import styles from './ModelPricesPage.module.scss';

const FILTERS: ModelPriceFilter[] = ['all', 'used', 'unpriced'];
const SYNC_SOURCES: ModelPriceSyncSource[] = ['litellm', 'openrouter'];

interface PriceValueProps {
  value: string | null;
  missingLabel: string;
  freeLabel: string;
  suffix?: string;
}

function PriceValue({ value, missingLabel, freeLabel, suffix = '' }: PriceValueProps) {
  const kind = getDecimalDisplayKind(value);
  if (kind === 'missing') return <span className={styles.priceMissing}>{missingLabel}</span>;
  if (kind === 'free') return <span className={styles.priceFree}>{freeLabel}</span>;
  return <span className={styles.priceValue}>{`$${value}${suffix}`}</span>;
}

function formatEstimatedCost(value: string | null, currency: string, missingLabel: string): string {
  if (value === null) return missingLabel;
  return currency === 'USD' ? `$${value}` : `${value} ${currency}`;
}

function formatTimestamp(value: string | null, locale: string, missingLabel: string): string {
  if (!value) return missingLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function candidateStatusVariant(candidate: ModelPriceSyncCandidate): string {
  if (candidate.rejectionReason || candidate.status === 'rejected') return styles.statusRejected;
  if (candidate.status === 'ambiguous') return styles.statusAmbiguous;
  return styles.statusReady;
}

export function ModelPricesPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [catalog, setCatalog] = useState<ModelPriceCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ModelPriceFilter>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ModelPriceRule | null>(null);
  const [draft, setDraft] = useState<ModelPriceDraft>(() => createModelPriceDraft());
  const [draftErrors, setDraftErrors] = useState<ModelPriceDraftErrors>({});
  const [savingRule, setSavingRule] = useState(false);
  const [mutatingRuleID, setMutatingRuleID] = useState<string | null>(null);
  const [mutatingEntryKey, setMutatingEntryKey] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncSources, setSyncSources] = useState<Set<ModelPriceSyncSource>>(
    () => new Set(SYNC_SOURCES)
  );
  const [syncPreview, setSyncPreview] = useState<ModelPriceSyncPreview | null>(null);
  const [syncError, setSyncError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [acceptedCandidateIDs, setAcceptedCandidateIDs] = useState<Set<string>>(new Set());
  const loadRequestRef = useRef(0);

  const disabled = connectionStatus !== 'connected';
  const availableCatalog = catalog?.available ? catalog : null;
  const rows = useMemo(
    () => (availableCatalog ? buildModelPriceRows(availableCatalog) : []),
    [availableCatalog]
  );
  const visibleRows = useMemo(
    () => filterModelPriceRows(rows, filter, search),
    [filter, rows, search]
  );

  const loadCatalog = useCallback(async () => {
    const requestID = ++loadRequestRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const nextCatalog = await modelPricesApi.getCatalog();
      if (loadRequestRef.current === requestID) setCatalog(nextCatalog);
    } catch (error: unknown) {
      if (loadRequestRef.current !== requestID) return;
      if (isModelPricesCapabilityUnavailable(error)) {
        setCatalog({ available: false, reason: 'endpoint_unavailable' });
      } else {
        setCatalog(null);
        setLoadError(getErrorMessage(error, t('model_prices.errors.load')));
      }
    } finally {
      if (loadRequestRef.current === requestID) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const openCreateEditor = () => {
    setEditingRule(null);
    setDraft(createModelPriceDraft());
    setDraftErrors({});
    setEditorOpen(true);
  };

  const openEditEditor = (rule: ModelPriceRule) => {
    setEditingRule(rule);
    setDraft(createModelPriceDraft(rule));
    setDraftErrors({});
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (savingRule) return;
    setEditorOpen(false);
    setEditingRule(null);
    setDraft(createModelPriceDraft());
    setDraftErrors({});
  };

  const updateDraft = (field: keyof ModelPriceDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDraftErrors((current) => {
      if (!current[field] && !current.prices) return current;
      const next = { ...current };
      delete next[field];
      delete next.prices;
      return next;
    });
  };

  const draftError = (field: keyof ModelPriceDraft): string | undefined => {
    const code = draftErrors[field];
    if (!code) return undefined;
    const fallbacks: Record<string, string> = {
      provider_required: 'Provider is required',
      integer: 'Enter a non-negative whole number',
      context_range: 'Minimum context cannot exceed maximum context',
      base_price_required: 'Set the matching base price first',
    };
    return t(`model_prices.validation.${code}`, { defaultValue: fallbacks[code] ?? code });
  };

  const saveRule = async () => {
    const errors = validateModelPriceDraft(draft);
    setDraftErrors(errors);
    const input = buildModelPriceRuleInput(draft);
    if (!input) return;

    setSavingRule(true);
    try {
      if (editingRule) {
        await modelPricesApi.updateRule(editingRule.id, editingRule.version, input);
      } else {
        await modelPricesApi.createRule(input);
      }
      showNotification(
        t(
          editingRule ? 'model_prices.notifications.updated' : 'model_prices.notifications.created'
        ),
        'success'
      );
      closeEditor();
      await loadCatalog();
    } catch (error: unknown) {
      showNotification(
        `${t('model_prices.errors.save')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
        'error'
      );
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = (rule: ModelPriceRule) => {
    showConfirmation({
      title: t('model_prices.delete.title'),
      message: t('model_prices.delete.message', { model: rule.model }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setMutatingRuleID(rule.id);
        try {
          await modelPricesApi.deleteRule(rule.id, rule.version);
          showNotification(t('model_prices.notifications.deleted'), 'success');
          await loadCatalog();
        } catch (error: unknown) {
          showNotification(
            `${t('model_prices.errors.delete')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
            'error'
          );
          throw error;
        } finally {
          setMutatingRuleID(null);
        }
      },
    });
  };

  const deleteEntry = (row: ModelPriceRow) => {
    if (!availableCatalog) return;
    const expectedCatalogVersion = availableCatalog.catalogVersion;
    showConfirmation({
      title: t('model_prices.delete_entry.title'),
      message: t('model_prices.delete_entry.message', {
        provider: row.provider,
        model: row.model,
      }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setMutatingEntryKey(row.key);
        try {
          await modelPricesApi.deleteEntry(row.provider, row.model, expectedCatalogVersion);
          showNotification(t('model_prices.notifications.entry_deleted'), 'success');
          setExpandedRows((current) => {
            const next = new Set(current);
            next.delete(row.key);
            return next;
          });
          await loadCatalog();
        } catch (error: unknown) {
          showNotification(
            `${t('model_prices.errors.delete_entry')}: ${getErrorMessage(error, t('common.unknown_error'))}`,
            'error'
          );
          throw error;
        } finally {
          setMutatingEntryKey(null);
        }
      },
    });
  };

  const openSync = () => {
    setSyncSources(new Set(SYNC_SOURCES));
    setSyncPreview(null);
    setSyncError('');
    setAcceptedCandidateIDs(new Set());
    setSyncOpen(true);
  };

  const closeSync = () => {
    if (previewing || applyingPreview) return;
    setSyncOpen(false);
    setSyncPreview(null);
    setSyncError('');
    setAcceptedCandidateIDs(new Set());
  };

  const toggleSyncSource = (source: ModelPriceSyncSource) => {
    setSyncSources((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const previewSync = async () => {
    if (syncSources.size === 0) {
      setSyncError(t('model_prices.sync.source_required'));
      return;
    }
    setPreviewing(true);
    setSyncError('');
    setSyncPreview(null);
    setAcceptedCandidateIDs(new Set());
    try {
      setSyncPreview(await modelPricesApi.previewSync(Array.from(syncSources)));
    } catch (error: unknown) {
      setSyncError(getErrorMessage(error, t('model_prices.errors.preview')));
    } finally {
      setPreviewing(false);
    }
  };

  const toggleCandidate = (candidate: ModelPriceSyncCandidate) => {
    if (!syncPreview) return;
    setAcceptedCandidateIDs((current) =>
      toggleAcceptedCandidate(current, candidate, syncPreview.candidates)
    );
  };

  const applySync = async () => {
    if (!syncPreview || syncPreview.stale || acceptedCandidateIDs.size === 0) return;
    setApplyingPreview(true);
    setSyncError('');
    try {
      const result = await modelPricesApi.applySync(
        syncPreview.previewId,
        Array.from(acceptedCandidateIDs)
      );
      showNotification(
        t('model_prices.sync.applied', {
          applied: result.appliedCount,
          skipped: result.skippedCount,
        }),
        'success'
      );
      closeSync();
      await loadCatalog();
    } catch (error: unknown) {
      const status = (error as ApiError).status;
      if (status === 409) {
        setSyncPreview((current) => (current ? { ...current, stale: true } : current));
        setSyncError(t('model_prices.sync.preview_stale'));
      } else {
        setSyncError(getErrorMessage(error, t('model_prices.errors.apply')));
      }
    } finally {
      setApplyingPreview(false);
    }
  };

  const renderSummary = (currentCatalog: ModelPriceCatalogAvailable) => (
    <section className={styles.summaryStrip} aria-label={t('model_prices.summary.label')}>
      <div className={styles.summaryMetric}>
        <span>{t('model_prices.summary.models')}</span>
        <strong>{currentCatalog.summary.modelCount.toLocaleString(i18n.language)}</strong>
      </div>
      <div className={styles.summaryMetric}>
        <span>{t('model_prices.summary.used')}</span>
        <strong>{currentCatalog.summary.usedModelCount.toLocaleString(i18n.language)}</strong>
      </div>
      <div
        className={styles.summaryMetric}
        data-warning={currentCatalog.summary.unpricedModelCount > 0}
      >
        <span>{t('model_prices.summary.unpriced')}</span>
        <strong>{currentCatalog.summary.unpricedModelCount.toLocaleString(i18n.language)}</strong>
      </div>
      <div className={styles.summaryMetric}>
        <span>{t('model_prices.summary.estimated_cost')}</span>
        <strong>
          {formatEstimatedCost(
            currentCatalog.summary.estimatedCost,
            currentCatalog.summary.currency,
            t('model_prices.missing')
          )}
        </strong>
        <small>{t('model_prices.summary.server_estimate')}</small>
      </div>
    </section>
  );

  const renderRulePrices = (rule: ModelPriceRule, compact = false) => {
    const cacheReadFallback = rule.prices.cacheReadPerMillion === null;
    const cacheCreationFallback = rule.prices.cacheCreationPerMillion === null;
    const values = [
      {
        key: 'input',
        value: rule.prices.inputPerMillion,
        multiplier: rule.multipliers.input,
        fallback: false,
      },
      {
        key: 'cache_read',
        value: rule.prices.cacheReadPerMillion ?? rule.prices.inputPerMillion,
        multiplier: cacheReadFallback ? rule.multipliers.input : rule.multipliers.cacheRead,
        fallback: cacheReadFallback && rule.prices.inputPerMillion !== null,
      },
      {
        key: 'output',
        value: rule.prices.outputPerMillion,
        multiplier: rule.multipliers.output,
        fallback: false,
      },
      ...(!compact
        ? [
            {
              key: 'cache_creation',
              value: rule.prices.cacheCreationPerMillion ?? rule.prices.inputPerMillion,
              multiplier: cacheCreationFallback
                ? rule.multipliers.input
                : rule.multipliers.cacheCreation,
              fallback: cacheCreationFallback && rule.prices.inputPerMillion !== null,
            },
          ]
        : []),
      ...(rule.prices.reasoningPerMillion !== null
        ? [
            {
              key: 'reasoning_independent',
              value: rule.prices.reasoningPerMillion,
              multiplier: rule.multipliers.reasoning,
              fallback: false,
            },
          ]
        : []),
      ...(!compact
        ? [
            {
              key: 'fixed_request',
              value: rule.prices.fixedRequest,
              multiplier: rule.multipliers.fixedRequest,
              fallback: false,
            },
          ]
        : []),
    ];
    return (
      <div className={`${styles.priceGrid} ${compact ? styles.priceGridCompact : ''}`}>
        {values.map(({ key, value, multiplier, fallback }) => (
          <div className={styles.priceField} key={key}>
            <span>{t(`model_prices.fields.${key}`)}</span>
            <PriceValue
              value={value}
              missingLabel={t('model_prices.missing')}
              freeLabel={t('model_prices.free_zero')}
              suffix={key === 'fixed_request' ? '' : t('model_prices.per_million_suffix')}
            />
            {fallback ? (
              <small className={styles.rateNote}>{t('model_prices.uses_input_rate')}</small>
            ) : null}
            {multiplier !== null ? (
              <small
                className={styles.multiplierValue}
                title={t('model_prices.fields.multiplier', { defaultValue: 'Multiplier' })}
              >
                {`x ${multiplier}`}
              </small>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderRuleActions = (rule: ModelPriceRule, allowDelete = true) =>
    rule.source.kind === 'manual' ? (
      <>
        <TooltipIconButton
          label={t('common.edit')}
          onClick={() => openEditEditor(rule)}
          disabled={
            disabled || savingRule || mutatingRuleID === rule.id || mutatingEntryKey !== null
          }
        >
          <Pencil size={16} />
        </TooltipIconButton>
        {allowDelete ? (
          <TooltipIconButton
            label={t('common.delete')}
            onClick={() => deleteRule(rule)}
            disabled={
              disabled || savingRule || mutatingRuleID === rule.id || mutatingEntryKey !== null
            }
          >
            <Trash2 size={16} />
          </TooltipIconButton>
        ) : null}
      </>
    ) : null;

  const renderRuleSource = (rule: ModelPriceRule) => {
    const sourceIdentity = [rule.source.provider, rule.source.model].filter(Boolean).join(' / ');
    return (
      <>
        <span
          className={`${styles.badge} ${
            rule.source.kind === 'manual' ? styles.badgeManual : styles.badgeSource
          }`}
        >
          {rule.source.kind}
        </span>
        <strong title={sourceIdentity || undefined}>
          {sourceIdentity || t('model_prices.local_rule')}
        </strong>
        <span title={rule.source.url ?? undefined}>
          {formatTimestamp(
            rule.source.fetchedAt ?? rule.updatedAt,
            i18n.language,
            t('common.not_set')
          )}
        </span>
      </>
    );
  };

  const renderConditionalRule = (rule: ModelPriceRule, conflict: boolean) => (
    <div className={styles.variantRule} data-conflict={conflict} key={rule.id}>
      <div className={styles.variantIdentity}>
        <div>
          <strong>{rule.serviceTier ?? t('model_prices.default_tier')}</strong>
          {conflict ? (
            <span className={`${styles.badge} ${styles.badgeUnpriced}`}>
              {t('model_prices.conflict')}
            </span>
          ) : null}
        </div>
        <span>
          {t('model_prices.context_value', {
            min: rule.contextMinTokens ?? 0,
            max: rule.contextMaxTokens ?? t('model_prices.no_limit'),
          })}
        </span>
        {rule.missingDimensions.length ? (
          <small>
            {t('model_prices.missing_dimensions', {
              dimensions: rule.missingDimensions.join(', '),
            })}
          </small>
        ) : null}
      </div>
      <div className={styles.variantPrices}>{renderRulePrices(rule)}</div>
      <div className={styles.variantSource}>{renderRuleSource(rule)}</div>
      <div className={styles.variantActions}>{renderRuleActions(rule)}</div>
    </div>
  );

  const renderRow = (row: ModelPriceRow) => {
    const { entry } = row;
    const rule = entry.default;
    const representativeRule = rule ?? entry.variants[0] ?? entry.conflicts[0] ?? null;
    const detailCount = entry.variants.length + entry.conflicts.length;
    const expanded = expandedRows.has(row.key);
    const detailsID = `model-price-${row.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const estimatedCost = formatEstimatedCost(
      entry.estimatedCost,
      availableCatalog?.summary.currency ?? 'USD',
      t('model_prices.missing')
    );
    return (
      <Fragment key={row.key}>
        <div className={styles.dataRow} data-expanded={expanded}>
          <div className={styles.modelCell}>
            <div className={styles.modelLine}>
              <strong title={row.model}>{row.model}</strong>
              <span
                className={`${styles.badge} ${
                  entry.coverage === 'priced'
                    ? styles.badgePriced
                    : entry.coverage === 'partial'
                      ? styles.badgePartial
                      : styles.badgeUnpriced
                }`}
              >
                {t(`model_prices.coverage.${entry.coverage}`)}
              </span>
            </div>
            <span className={styles.secondaryText}>{row.provider}</span>
            {entry.missingDimensions.length ? (
              <span className={styles.reasonText}>
                {t('model_prices.missing_dimensions', {
                  dimensions: entry.missingDimensions.join(', '),
                })}
              </span>
            ) : null}
          </div>

          <div className={styles.usageCell}>
            <span className={styles.mobileLabel}>{t('model_prices.columns.usage')}</span>
            <strong>{row.requestCount.toLocaleString(i18n.language)}</strong>
            <span>{row.used ? t('model_prices.used') : t('model_prices.unused')}</span>
            <small>{estimatedCost}</small>
          </div>

          <div className={styles.pricesCell}>
            <span className={styles.mobileLabel}>{t('model_prices.columns.prices')}</span>
            {rule ? (
              renderRulePrices(rule, true)
            ) : (
              <div className={styles.missingPriceBlock}>
                <AlertTriangle size={15} />
                <span>
                  {detailCount > 0 ? t('model_prices.no_default_rule') : t('model_prices.no_rule')}
                </span>
                {entry.missingDimensions.length ? (
                  <small>{entry.missingDimensions.join(', ')}</small>
                ) : null}
              </div>
            )}
          </div>

          <div className={styles.scopeCell}>
            <span className={styles.mobileLabel}>{t('model_prices.columns.variants')}</span>
            <div>
              <span>{t('model_prices.variants')}</span>
              <strong>{entry.variants.length.toLocaleString(i18n.language)}</strong>
            </div>
            {entry.requestedModels.length ? (
              <div>
                <span>{t('model_prices.fields.requested_model')}</span>
                <strong title={entry.requestedModels.join(', ')}>
                  {entry.requestedModels.join(', ')}
                </strong>
              </div>
            ) : null}
            {entry.conflicts.length ? (
              <div>
                <span>{t('model_prices.conflicts')}</span>
                <strong className={styles.conflictValue}>{entry.conflicts.length}</strong>
              </div>
            ) : null}
          </div>

          <div className={styles.sourceCell}>
            <span className={styles.mobileLabel}>{t('model_prices.columns.source')}</span>
            {representativeRule ? (
              renderRuleSource(representativeRule)
            ) : (
              <span className={styles.priceMissing}>{t('model_prices.missing')}</span>
            )}
          </div>

          <div className={styles.actionsCell}>
            {detailCount > 0 ? (
              <TooltipIconButton
                label={t(
                  expanded ? 'model_prices.collapse_variants' : 'model_prices.expand_variants'
                )}
                onClick={() =>
                  setExpandedRows((current) => {
                    const next = new Set(current);
                    if (next.has(row.key)) next.delete(row.key);
                    else next.add(row.key);
                    return next;
                  })
                }
                aria-expanded={expanded}
                aria-controls={detailsID}
              >
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </TooltipIconButton>
            ) : null}
            {rule ? renderRuleActions(rule, false) : null}
            {representativeRule ? (
              <TooltipIconButton
                label={t('model_prices.delete_entry.action')}
                onClick={() => deleteEntry(row)}
                disabled={
                  disabled || savingRule || mutatingRuleID !== null || mutatingEntryKey !== null
                }
              >
                <Trash2 size={16} />
              </TooltipIconButton>
            ) : null}
          </div>
        </div>

        {expanded ? (
          <div
            className={styles.variantDetail}
            id={detailsID}
            role="region"
            aria-label={t('model_prices.variant_details_for', { model: row.model })}
          >
            <div className={styles.variantDetailHeader}>
              <strong>{t('model_prices.variant_details')}</strong>
              <span>
                {t('model_prices.variant_count', {
                  count: entry.variants.length,
                  conflicts: entry.conflicts.length,
                })}
              </span>
            </div>
            {entry.variants.map((variant) => renderConditionalRule(variant, false))}
            {entry.conflicts.map((conflict) => renderConditionalRule(conflict, true))}
          </div>
        ) : null}
      </Fragment>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <h1 className={styles.pageTitle}>{t('model_prices.title')}</h1>
          <div className={styles.statusLine}>
            {loading
              ? t('common.loading')
              : availableCatalog
                ? t('model_prices.last_sync', {
                    value: formatTimestamp(
                      availableCatalog.lastSyncAt,
                      i18n.language,
                      t('model_prices.never')
                    ),
                  })
                : t('model_prices.status_unavailable')}
          </div>
        </div>
        <div className={styles.headerActions}>
          <TooltipIconButton
            label={t('common.refresh')}
            className={styles.iconButton}
            onClick={() => void loadCatalog()}
            disabled={loading}
          >
            <RefreshCw size={16} />
          </TooltipIconButton>
          <Button
            variant="secondary"
            onClick={openSync}
            disabled={disabled || loading || !availableCatalog}
          >
            <CloudDownload size={16} />
            {t('model_prices.sync.action')}
          </Button>
          <Button onClick={openCreateEditor} disabled={disabled || loading || !availableCatalog}>
            <Plus size={16} />
            {t('model_prices.add_rule')}
          </Button>
        </div>
      </div>

      {loading && !catalog ? (
        <>
          <div className={styles.summaryStrip} aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <div className={styles.summaryMetric} key={index}>
                <Skeleton width="42%" height={12} />
                <Skeleton width="64%" height={22} />
              </div>
            ))}
          </div>
          <div className={styles.loadingRows}>
            {[0, 1, 2].map((index) => (
              <Skeleton height={84} key={index} />
            ))}
          </div>
        </>
      ) : loadError ? (
        <section className={styles.statePanel} role="alert">
          <AlertTriangle size={22} />
          <div>
            <strong>{t('model_prices.states.error_title')}</strong>
            <span>{loadError}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadCatalog()}>
            <RefreshCw size={16} />
            {t('common.refresh')}
          </Button>
        </section>
      ) : catalog && !catalog.available ? (
        <section className={styles.statePanel} role="status">
          <AlertTriangle size={22} />
          <div>
            <strong>{t('model_prices.states.unavailable_title')}</strong>
            <span>{t('model_prices.states.unavailable_description')}</span>
            <code>{catalog.reason}</code>
          </div>
        </section>
      ) : availableCatalog ? (
        <>
          {renderSummary(availableCatalog)}
          {availableCatalog.summary.truncated ? (
            <div className={styles.staleNotice} role="alert">
              <AlertTriangle size={16} />
              <span>
                {t('model_prices.states.truncated_description', {
                  defaultValue: 'Usage totals are limited to the server query window.',
                })}
              </span>
            </div>
          ) : null}

          <section className={styles.catalogPanel}>
            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('model_prices.search_placeholder')}
                  rightElement={<Search size={16} />}
                  aria-label={t('model_prices.search_placeholder')}
                />
              </div>
              <div className={styles.segmentedControl} aria-label={t('model_prices.filters.label')}>
                {FILTERS.map((value) => (
                  <button
                    type="button"
                    className={filter === value ? styles.segmentedActive : styles.segmentedButton}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    key={value}
                  >
                    {t(`model_prices.filters.${value}`)}
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title={t('model_prices.states.empty_title')}
                description={t('model_prices.states.empty_description')}
                action={
                  <Button size="sm" onClick={openCreateEditor} disabled={disabled}>
                    <Plus size={16} />
                    {t('model_prices.add_rule')}
                  </Button>
                }
              />
            ) : visibleRows.length === 0 ? (
              <EmptyState
                title={t('model_prices.states.filtered_empty_title')}
                description={t('model_prices.states.filtered_empty_description')}
              />
            ) : (
              <div className={styles.dataList}>
                <div className={styles.dataHead}>
                  <span>{t('model_prices.columns.model')}</span>
                  <span>{t('model_prices.columns.usage')}</span>
                  <span>{t('model_prices.columns.prices')}</span>
                  <span>{t('model_prices.columns.variants')}</span>
                  <span>{t('model_prices.columns.source')}</span>
                  <span>{t('common.action')}</span>
                </div>
                {visibleRows.map(renderRow)}
              </div>
            )}
          </section>
        </>
      ) : null}

      <Modal
        open={editorOpen}
        onClose={closeEditor}
        closeDisabled={savingRule}
        title={
          editingRule ? t('model_prices.editor.edit_title') : t('model_prices.editor.add_title')
        }
        width={880}
        footer={
          <>
            <Button variant="secondary" onClick={closeEditor} disabled={savingRule}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveRule()} loading={savingRule}>
              <CheckCircle2 size={16} />
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className={styles.editorForm}>
          <fieldset className={styles.formSection}>
            <legend>{t('model_prices.editor.identity')}</legend>
            <div className={styles.formGridFour}>
              <Input
                label={t('model_prices.fields.model')}
                value={draft.model}
                onChange={(event) => updateDraft('model', event.target.value)}
                error={draftError('model')}
                placeholder="gpt-5"
              />
              <Input
                label={t('model_prices.fields.provider')}
                value={draft.provider}
                onChange={(event) => updateDraft('provider', event.target.value)}
                error={draftError('provider')}
                placeholder="openai"
              />
              <Input
                label={t('model_prices.fields.service_tier')}
                value={draft.serviceTier}
                onChange={(event) => updateDraft('serviceTier', event.target.value)}
                placeholder={t('model_prices.default_tier')}
              />
              <Input
                label={t('model_prices.fields.context_min_tokens', {
                  defaultValue: 'Minimum context tokens',
                })}
                value={draft.contextMinTokens}
                onChange={(event) => updateDraft('contextMinTokens', event.target.value)}
                error={draftError('contextMinTokens')}
                inputMode="numeric"
                placeholder="0"
              />
              <Input
                label={t('model_prices.fields.context_max_tokens', {
                  defaultValue: 'Maximum context tokens',
                })}
                value={draft.contextMaxTokens}
                onChange={(event) => updateDraft('contextMaxTokens', event.target.value)}
                error={draftError('contextMaxTokens')}
                inputMode="numeric"
                placeholder="200000"
              />
            </div>
            {draftErrors.contextRange ? (
              <div className={styles.formError}>
                {t('model_prices.validation.context_range', {
                  defaultValue: 'Minimum context cannot exceed maximum context',
                })}
              </div>
            ) : null}
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>{t('model_prices.editor.price_dimensions')}</legend>
            {draftErrors.prices ? (
              <div className={styles.formError}>{t('model_prices.validation.price_required')}</div>
            ) : null}
            <div className={styles.formGridThree}>
              {(
                [
                  ['inputPerMillion', 'input'],
                  ['outputPerMillion', 'output'],
                  ['reasoningPerMillion', 'reasoning_independent'],
                  ['cacheReadPerMillion', 'cache_read'],
                  ['cacheCreationPerMillion', 'cache_creation'],
                  ['fixedRequest', 'fixed_request'],
                ] as const
              ).map(([field, label]) => (
                <Input
                  key={field}
                  label={t(`model_prices.fields.${label}`)}
                  value={draft[field]}
                  onChange={(event) => updateDraft(field, event.target.value)}
                  error={draftError(field)}
                  inputMode="decimal"
                  placeholder="0.00"
                  hint={
                    label === 'fixed_request'
                      ? t('model_prices.editor.per_request_hint')
                      : t('model_prices.editor.per_million_hint')
                  }
                />
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>
              {t('model_prices.editor.multipliers', { defaultValue: 'Price multipliers' })}
            </legend>
            <div className={styles.formGridThree}>
              {(
                [
                  ['inputMultiplier', 'input'],
                  ['outputMultiplier', 'output'],
                  ['reasoningMultiplier', 'reasoning_independent'],
                  ['cacheReadMultiplier', 'cache_read'],
                  ['cacheCreationMultiplier', 'cache_creation'],
                  ['fixedRequestMultiplier', 'fixed_request'],
                ] as const
              ).map(([field, label]) => (
                <Input
                  key={field}
                  label={`${t(`model_prices.fields.${label}`)} x`}
                  value={draft[field]}
                  onChange={(event) => updateDraft(field, event.target.value)}
                  error={draftError(field)}
                  inputMode="decimal"
                  placeholder="1"
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>

      <Modal
        open={syncOpen}
        onClose={closeSync}
        closeDisabled={previewing || applyingPreview}
        title={t('model_prices.sync.title')}
        width={940}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeSync}
              disabled={previewing || applyingPreview}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant={syncPreview ? 'secondary' : 'primary'}
              onClick={() => void previewSync()}
              loading={previewing}
              disabled={applyingPreview || syncSources.size === 0}
            >
              <CloudDownload size={16} />
              {t(syncPreview ? 'model_prices.sync.refresh_preview' : 'model_prices.sync.preview')}
            </Button>
            {syncPreview ? (
              <Button
                onClick={() => void applySync()}
                loading={applyingPreview}
                disabled={previewing || syncPreview.stale || acceptedCandidateIDs.size === 0}
              >
                <CheckCircle2 size={16} />
                {t('model_prices.sync.apply_count', { count: acceptedCandidateIDs.size })}
              </Button>
            ) : null}
          </>
        }
      >
        <div className={styles.syncBody}>
          <div className={styles.sourceSelector}>
            {SYNC_SOURCES.map((source) => (
              <label key={source}>
                <input
                  type="checkbox"
                  checked={syncSources.has(source)}
                  onChange={() => toggleSyncSource(source)}
                  disabled={previewing || applyingPreview}
                />
                <span>{t(`model_prices.sync.sources.${source}`)}</span>
              </label>
            ))}
          </div>

          {syncError ? (
            <div className={styles.syncError} role="alert">
              <AlertTriangle size={16} />
              <span>{syncError}</span>
            </div>
          ) : null}

          {previewing ? (
            <div className={styles.previewLoading}>
              {[0, 1, 2].map((index) => (
                <Skeleton height={72} key={index} />
              ))}
            </div>
          ) : syncPreview ? (
            <>
              {syncPreview.stale ? (
                <div className={styles.staleNotice} role="alert">
                  <Clock3 size={16} />
                  <span>{t('model_prices.sync.preview_stale')}</span>
                </div>
              ) : null}

              <div className={styles.sourceResults}>
                {syncPreview.sourceResults.map((result) => (
                  <div key={result.source} data-error={Boolean(result.error)}>
                    <strong>{result.source}</strong>
                    <span>
                      {t(`model_prices.sync.status.${result.status}`, {
                        defaultValue: result.status,
                      })}
                    </span>
                    <small>
                      {t('model_prices.sync.source_counts', {
                        fetched: result.fetchedCount,
                        candidates: result.candidateCount,
                        rejected: result.rejectedCount,
                      })}
                    </small>
                    {result.error ? <small>{result.error}</small> : null}
                  </div>
                ))}
              </div>

              <div className={styles.previewMeta}>
                <span>{t('model_prices.sync.preview_id', { id: syncPreview.previewId })}</span>
                <span>
                  {t('model_prices.sync.expires', {
                    value: formatTimestamp(
                      syncPreview.expiresAt,
                      i18n.language,
                      t('common.not_set')
                    ),
                  })}
                </span>
              </div>

              {syncPreview.candidates.length === 0 ? (
                <EmptyState title={t('model_prices.sync.no_candidates')} />
              ) : (
                <div className={styles.candidateList}>
                  {syncPreview.candidates.map((candidate) => {
                    const selectable = canAcceptSyncCandidate(candidate);
                    const selected = acceptedCandidateIDs.has(candidate.id);
                    return (
                      <label
                        className={`${styles.candidateRow} ${selected ? styles.candidateSelected : ''}`}
                        data-disabled={!selectable}
                        key={candidate.id}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleCandidate(candidate)}
                          disabled={!selectable || applyingPreview || syncPreview.stale}
                          aria-label={t('model_prices.sync.accept_candidate', {
                            model: candidate.targetModel,
                          })}
                        />
                        <div className={styles.candidateIdentity}>
                          <div>
                            <strong>{candidate.targetModel}</strong>
                            <span
                              className={`${styles.badge} ${candidateStatusVariant(candidate)}`}
                            >
                              {t(`model_prices.sync.candidate_status.${candidate.status}`, {
                                defaultValue: candidate.status,
                              })}
                            </span>
                          </div>
                          <span>{`${candidate.targetProvider} / ${candidate.source} / ${candidate.sourceModelId}`}</span>
                        </div>
                        <div className={styles.candidatePrices}>
                          <span>
                            {t('model_prices.fields.input')}{' '}
                            <PriceValue
                              value={candidate.rule.prices.inputPerMillion}
                              missingLabel={t('model_prices.missing')}
                              freeLabel={t('model_prices.free_zero')}
                              suffix={t('model_prices.per_million_suffix')}
                            />
                          </span>
                          <span>
                            {t('model_prices.fields.output')}{' '}
                            <PriceValue
                              value={candidate.rule.prices.outputPerMillion}
                              missingLabel={t('model_prices.missing')}
                              freeLabel={t('model_prices.free_zero')}
                              suffix={t('model_prices.per_million_suffix')}
                            />
                          </span>
                        </div>
                        <div className={styles.candidateReason}>
                          {candidate.ambiguityReason ? (
                            <span data-warning="true">{candidate.ambiguityReason}</span>
                          ) : null}
                          {candidate.rejectionReason ? (
                            <span data-error="true">{candidate.rejectionReason}</span>
                          ) : null}
                          {candidate.reason ? <span>{candidate.reason}</span> : null}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {syncPreview.rejected.length ? (
                <section className={styles.rejectionList}>
                  <h3>{t('model_prices.sync.rejected_title')}</h3>
                  {syncPreview.rejected.map((rejection, index) => (
                    <div key={`${rejection.source}:${rejection.sourceModelId}:${index}`}>
                      <strong>{rejection.sourceModelId}</strong>
                      <span>{rejection.targetModel ?? t('model_prices.sync.no_target')}</span>
                      <small>{rejection.reason}</small>
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <div className={styles.syncPendingState}>
              <DollarSign size={20} />
              <span>{t('model_prices.sync.pending')}</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
