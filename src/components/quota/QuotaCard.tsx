import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { TooltipButton } from '@/components/ui/TooltipControls';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import {
  formatModified,
  getAuthFileIcon,
  getAuthFileStatusMessage,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
} from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import {
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
  statusBarDataFromRecentRequests,
} from '@/utils/recentRequests';
import { formatFileSize } from '@/utils/format';
import { useThemeStore } from '@/stores';
import quotaStyles from '@/pages/QuotaPage.module.scss';
import authStyles from '@/pages/AuthFilesPage.module.scss';

type QuotaStatus = 'idle' | 'loading' | 'success' | 'error';

const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);

const normalizeCredentialGroups = (groups: AuthFileItem['groups']) => {
  if (!Array.isArray(groups)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  groups.forEach((group) => {
    const value = String(group ?? '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(value);
  });
  return normalized;
};

export interface QuotaStatusState {
  status: QuotaStatus;
  error?: string;
  errorStatus?: number;
}

export interface QuotaProgressBarProps {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
}

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
}: QuotaProgressBarProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? quotaStyles.quotaBarFillMedium
      : normalized >= highThreshold
        ? quotaStyles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? quotaStyles.quotaBarFillMedium
          : quotaStyles.quotaBarFillLow;
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;

  return (
    <div className={quotaStyles.quotaBar}>
      <div
        className={`${quotaStyles.quotaBarFill} ${fillClass}`}
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

export interface QuotaRenderHelpers {
  styles: typeof quotaStyles;
  QuotaProgressBar: (props: QuotaProgressBarProps) => ReactElement;
}

interface QuotaCardProps<TState extends QuotaStatusState> {
  item: AuthFileItem;
  quota?: TState;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  cardClassName: string;
  defaultType: string;
  canRefresh?: boolean;
  onRefresh?: () => void;
  actionDisabled?: boolean;
  selected?: boolean;
  deletingCredentialName?: string | null;
  credentialStatusUpdating?: Record<string, boolean>;
  onDownload?: (name: string) => void;
  onShowModels?: (item: AuthFileItem) => void;
  onOpenSettings?: (item: AuthFileItem) => void;
  onDelete?: (name: string) => void;
  onToggleStatus?: (item: AuthFileItem, enabled: boolean) => void;
  onToggleSelect?: (name: string) => void;
  hideQuotaSection?: boolean;
  resetQuotaAction?: ReactNode;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

export function QuotaCard<TState extends QuotaStatusState>({
  item,
  quota,
  i18nPrefix,
  cardIdleMessageKey,
  cardClassName,
  defaultType,
  canRefresh = false,
  onRefresh,
  actionDisabled = false,
  selected = false,
  deletingCredentialName = null,
  credentialStatusUpdating = {},
  onDownload,
  onShowModels,
  onOpenSettings,
  onDelete,
  onToggleStatus,
  onToggleSelect,
  hideQuotaSection = false,
  resetQuotaAction,
  renderQuotaItems,
}: QuotaCardProps<TState>) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const isRuntimeOnly = isRuntimeOnlyAuthFile(item);
  const displayType = String(item.type || item.provider || defaultType);
  const providerKey = normalizeProviderKey(displayType || 'unknown');
  const isAistudio = providerKey === 'aistudio';
  const showModelsButton = Boolean(onShowModels) && (!isRuntimeOnly || isAistudio);
  const typeColor = getTypeColor(providerKey, resolvedTheme);
  const typeLabel = getTypeLabel(t, providerKey);
  const providerIcon = getAuthFileIcon(providerKey, resolvedTheme);
  const rawStatusMessage = getAuthFileStatusMessage(item);
  const hasStatusWarning =
    Boolean(rawStatusMessage) && !HEALTHY_STATUS_MESSAGES.has(rawStatusMessage.toLowerCase());
  const priorityValue = parsePriorityValue(item.priority ?? item['priority']);
  const noteValue = typeof item.note === 'string' ? item.note.trim() : '';
  const credentialGroups = normalizeCredentialGroups(item.groups);
  const visibleCredentialGroups = credentialGroups.slice(0, 3);
  const hiddenCredentialGroupCount = Math.max(
    0,
    credentialGroups.length - visibleCredentialGroups.length
  );
  const fileStats = {
    success: normalizeUsageTotal(item.success),
    failure: normalizeUsageTotal(item.failed),
  };
  const statusData = statusBarDataFromRecentRequests(
    normalizeRecentRequestBuckets(item.recent_requests ?? item.recentRequests)
  );
  const stateLabel = isRuntimeOnly
    ? t('auth_files.type_virtual')
    : item.disabled
      ? t('auth_files.health_status_disabled')
      : hasStatusWarning
        ? t('auth_files.health_status_warning')
        : rawStatusMessage
          ? t('auth_files.health_status_healthy')
          : t('auth_files.status_toggle_label');
  const stateBadgeClass = isRuntimeOnly
    ? authStyles.stateBadgeVirtual
    : item.disabled
      ? authStyles.stateBadgeDisabled
      : hasStatusWarning
        ? authStyles.stateBadgeWarning
        : authStyles.stateBadgeActive;
  const quotaStatus = quota?.status ?? 'idle';
  const quotaLoading = quotaStatus === 'loading';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const idleMessageKey = onRefresh
    ? `${i18nPrefix}.idle`
    : (cardIdleMessageKey ?? `${i18nPrefix}.idle`);
  const canDownload = Boolean(onDownload) && !isRuntimeOnly;
  const canEditFile = !isRuntimeOnly;
  const isDeleting = deletingCredentialName === item.name;
  const isStatusUpdating = credentialStatusUpdating[item.name] === true;

  return (
    <div
      className={`${authStyles.fileCard} ${cardClassName} ${
        selected ? authStyles.fileCardSelected : ''
      } ${item.disabled ? authStyles.fileCardDisabled : ''}`}
    >
      <div className={authStyles.fileCardLayout}>
        <div className={authStyles.fileCardMain}>
          <div className={authStyles.cardHeader}>
            {canEditFile && onToggleSelect && (
              <SelectionCheckbox
                checked={selected}
                onChange={() => onToggleSelect(item.name)}
                className={authStyles.cardSelection}
                ariaLabel={
                  selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                }
                title={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
              />
            )}
            <div
              className={authStyles.providerAvatar}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {}),
              }}
            >
              {providerIcon ? (
                <img src={providerIcon} alt="" className={authStyles.providerAvatarImage} />
              ) : (
                <span className={authStyles.providerAvatarFallback}>
                  {typeLabel.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className={authStyles.cardHeaderContent}>
              <div className={authStyles.cardBadgeRow}>
                <span
                  className={authStyles.typeBadge}
                  style={{
                    backgroundColor: typeColor.bg,
                    color: typeColor.text,
                    ...(typeColor.border ? { border: typeColor.border } : {}),
                  }}
                >
                  {typeLabel}
                </span>
                <span className={`${authStyles.stateBadge} ${stateBadgeClass}`}>{stateLabel}</span>
                {item.fallback === true && (
                  <span className={authStyles.fallbackBadge}>{t('auth_files.fallback_badge')}</span>
                )}
              </div>
              <span className={authStyles.fileName} title={item.name}>
                {item.name}
              </span>
              {credentialGroups.length > 0 && (
                <div
                  className={authStyles.credentialGroupRow}
                  aria-label={t('auth_files.groups_card_label')}
                  title={credentialGroups.join(', ')}
                >
                  <span className={authStyles.credentialGroupLabel}>
                    {t('auth_files.groups_card_label')}
                  </span>
                  {visibleCredentialGroups.map((group) => (
                    <span className={authStyles.credentialGroupChip} key={group}>
                      {group}
                    </span>
                  ))}
                  {hiddenCredentialGroupCount > 0 && (
                    <span className={authStyles.credentialGroupChip}>
                      +{hiddenCredentialGroupCount}
                    </span>
                  )}
                </div>
              )}
              {noteValue && (
                <div className={authStyles.noteText} title={noteValue}>
                  <span className={authStyles.noteLabel}>{t('auth_files.note_display')}</span>
                  <span className={authStyles.noteValue}>{noteValue}</span>
                </div>
              )}
            </div>
          </div>

          <div className={authStyles.cardMeta}>
            <div className={authStyles.metaItem}>
              <span className={authStyles.metaLabel}>{t('auth_files.file_size')}</span>
              <span className={authStyles.metaValue}>
                {item.size ? formatFileSize(item.size) : '-'}
              </span>
            </div>
            <div className={authStyles.metaItem}>
              <span className={authStyles.metaLabel}>{t('auth_files.file_modified')}</span>
              <span className={authStyles.metaValue}>{formatModified(item)}</span>
            </div>
            {priorityValue !== undefined && (
              <div className={`${authStyles.metaItem} ${authStyles.priorityBadge}`}>
                <span className={authStyles.metaLabel}>{t('auth_files.priority_display')}</span>
                <span className={`${authStyles.metaValue} ${authStyles.priorityValue}`}>
                  {priorityValue}
                </span>
              </div>
            )}
          </div>

          {rawStatusMessage && hasStatusWarning && (
            <div className={authStyles.healthStatusMessage} title={rawStatusMessage}>
              <IconInfo className={authStyles.messageIcon} size={14} />
              <span>{rawStatusMessage}</span>
            </div>
          )}

          <div className={authStyles.cardInsights}>
            <div className={authStyles.cardStats}>
              <div className={`${authStyles.statPill} ${authStyles.statSuccess}`}>
                <span className={authStyles.statLabel}>{t('stats.success')}</span>
                <span className={authStyles.statValue}>{fileStats.success}</span>
              </div>
              <div className={`${authStyles.statPill} ${authStyles.statFailure}`}>
                <span className={authStyles.statLabel}>{t('stats.failure')}</span>
                <span className={authStyles.statValue}>{fileStats.failure}</span>
              </div>
            </div>

            <div className={authStyles.statusPanel}>
              <div className={authStyles.statusPanelLabel}>
                <span>{t('auth_files.health_status_label')}</span>
              </div>
              <ProviderStatusBar statusData={statusData} styles={authStyles} />
            </div>
          </div>

          {!hideQuotaSection && (
            <div className={quotaStyles.quotaSection}>
              {quotaLoading ? (
                <div className={quotaStyles.quotaMessage}>{t(`${i18nPrefix}.loading`)}</div>
              ) : quotaStatus === 'idle' ? (
                onRefresh ? (
                  <button
                    type="button"
                    className={`${quotaStyles.quotaMessage} ${quotaStyles.quotaMessageAction}`}
                    onClick={onRefresh}
                    disabled={!canRefresh}
                  >
                    {t(idleMessageKey)}
                  </button>
                ) : (
                  <div className={quotaStyles.quotaMessage}>{t(idleMessageKey)}</div>
                )
              ) : quotaStatus === 'error' ? (
                <div className={quotaStyles.quotaError}>
                  {t(`${i18nPrefix}.load_failed`, {
                    message: quotaErrorMessage,
                  })}
                </div>
              ) : quota ? (
                renderQuotaItems(quota, t, { styles: quotaStyles, QuotaProgressBar })
              ) : (
                <div className={quotaStyles.quotaMessage}>{t(idleMessageKey)}</div>
              )}
            </div>
          )}

          <div className={authStyles.cardActions}>
            <div className={authStyles.cardActionsMain}>
              {showModelsButton && (
                <TooltipButton
                  variant="secondary"
                  size="sm"
                  onClick={() => onShowModels?.(item)}
                  className={`${authStyles.primaryActionButton} ${authStyles.modelsActionButton}`}
                  label={t('auth_files.models_button', { defaultValue: '模型' })}
                  disabled={actionDisabled}
                >
                  <>
                    <span className={authStyles.modelsActionIconWrap}>
                      <IconModelCluster className={authStyles.actionIcon} size={16} />
                    </span>
                    <span className={authStyles.actionButtonLabel}>
                      {t('auth_files.models_button', { defaultValue: '模型' })}
                    </span>
                  </>
                </TooltipButton>
              )}
              {resetQuotaAction}
              {canEditFile && (
                <div className={authStyles.cardUtilityActions}>
                  {canDownload && (
                    <TooltipButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={authStyles.iconButton}
                      onClick={() => onDownload?.(item.name)}
                      disabled={actionDisabled}
                      label={t('auth_files.download_button')}
                    >
                      <IconDownload className={authStyles.actionIcon} size={16} />
                    </TooltipButton>
                  )}
                  {onOpenSettings && (
                    <TooltipButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={authStyles.iconButton}
                      onClick={() => onOpenSettings(item)}
                      disabled={actionDisabled}
                      label={t('auth_files.prefix_proxy_button')}
                    >
                      <IconSettings className={authStyles.actionIcon} size={16} />
                    </TooltipButton>
                  )}
                  {onDelete && (
                    <TooltipButton
                      type="button"
                      variant="danger"
                      size="sm"
                      className={authStyles.iconButton}
                      onClick={() => onDelete(item.name)}
                      disabled={actionDisabled || isDeleting}
                      label={t('auth_files.delete_button')}
                    >
                      {isDeleting ? (
                        <LoadingSpinner size={14} />
                      ) : (
                        <IconTrash2 className={authStyles.actionIcon} size={16} />
                      )}
                    </TooltipButton>
                  )}
                  {onRefresh && quotaStatus !== 'idle' && !hideQuotaSection && (
                    <TooltipButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      className={authStyles.iconButton}
                      onClick={onRefresh}
                      disabled={!canRefresh || quotaLoading}
                      loading={quotaLoading}
                      label={t('auth_files.quota_refresh_hint')}
                    >
                      {!quotaLoading && (
                        <IconRefreshCw className={authStyles.actionIcon} size={16} />
                      )}
                    </TooltipButton>
                  )}
                </div>
              )}
            </div>
            {canEditFile && onToggleStatus && (
              <div className={authStyles.statusToggle}>
                <span className={authStyles.statusToggleLabel}>
                  {t('auth_files.status_toggle_label')}
                </span>
                <ToggleSwitch
                  ariaLabel={t('auth_files.status_toggle_label')}
                  checked={!item.disabled}
                  disabled={actionDisabled || isStatusUpdating}
                  onChange={(value) => onToggleStatus(item, value)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};
