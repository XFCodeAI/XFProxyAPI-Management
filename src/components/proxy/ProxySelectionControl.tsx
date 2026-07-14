import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import { IconNetwork, IconRefreshCw } from '@/components/ui/icons';
import { isProxyPoolSelectable, isProxyPoolSmartAssignable } from '@/services/api/proxyPools';
import type { ProxyPoolStatusEntry, ProxySelection, ProxySelectionMode } from '@/types';
import styles from './ProxySelectionControl.module.scss';

interface ProxySelectionControlProps {
  value: ProxySelection;
  pools: ProxyPoolStatusEntry[];
  loading?: boolean;
  disabled?: boolean;
  allowFileMode?: boolean;
  onChange: (value: ProxySelection) => void;
  onRefresh?: () => void;
}

function poolRegion(pool: ProxyPoolStatusEntry): string {
  return [pool.country, pool.region, pool.city].filter(Boolean).join(' / ');
}

function poolLabel(pool: ProxyPoolStatusEntry): string {
  const region = poolRegion(pool);
  const suffix = region ? ` · ${region}` : '';
  return `${pool.redactedUrl || `${pool.protocol}://${pool.host}:${pool.port}`}${suffix}`;
}

export function ProxySelectionControl({
  value,
  pools,
  loading = false,
  disabled = false,
  allowFileMode = false,
  onChange,
  onRefresh,
}: ProxySelectionControlProps) {
  const { t } = useTranslation();
  const availablePools = useMemo(() => pools.filter(isProxyPoolSelectable), [pools]);
  const smartPools = useMemo(() => pools.filter(isProxyPoolSmartAssignable), [pools]);
  const requestedProxyId = value.proxyId ?? '';
  const selectedProxyId = availablePools.some((pool) => pool.id === requestedProxyId)
    ? requestedProxyId
    : availablePools[0]?.id || '';

  const setMode = (mode: ProxySelectionMode) => {
    if (mode === 'proxy') {
      onChange({ mode, proxyId: selectedProxyId });
      return;
    }
    onChange({ mode });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.title}>
          <IconNetwork size={16} />
          <span>{t('proxy_selection.title', { defaultValue: '代理分配' })}</span>
        </div>
        {onRefresh ? (
          <TooltipIconButton
            label={t('config_management.reload', { defaultValue: '重新加载' })}
            className={styles.iconButton}
            onClick={onRefresh}
            disabled={disabled || loading}
          >
            <IconRefreshCw size={15} />
          </TooltipIconButton>
        ) : null}
      </div>

      <div className={styles.modeGrid}>
        {allowFileMode ? (
          <Button
            type="button"
            variant={value.mode === 'file' ? 'primary' : 'secondary'}
            onClick={() => setMode('file')}
            disabled={disabled}
          >
            {t('proxy_selection.file', { defaultValue: '文件内代理' })}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={value.mode === 'smart' ? 'primary' : 'secondary'}
          onClick={() => setMode('smart')}
          disabled={disabled || smartPools.length === 0}
        >
          {t('proxy_selection.smart', { defaultValue: '智能分配' })}
        </Button>
        <Button
          type="button"
          variant={value.mode === 'proxy' ? 'primary' : 'secondary'}
          onClick={() => setMode('proxy')}
          disabled={disabled || availablePools.length === 0}
        >
          {t('proxy_selection.manual', { defaultValue: '指定代理' })}
        </Button>
        <Button
          type="button"
          variant={value.mode === 'direct' ? 'primary' : 'secondary'}
          onClick={() => setMode('direct')}
          disabled={disabled}
        >
          {t('proxy_selection.direct', { defaultValue: '直连' })}
        </Button>
      </div>

      {value.mode === 'proxy' ? (
        <Select
          value={selectedProxyId}
          options={availablePools.map((pool) => ({
            value: pool.id,
            label: poolLabel(pool),
          }))}
          onChange={(proxyId) => onChange({ mode: 'proxy', proxyId })}
          disabled={disabled || availablePools.length === 0}
          ariaLabel={t('proxy_selection.proxy', { defaultValue: '代理' })}
        />
      ) : null}

      <div className={styles.poolList}>
        {loading ? (
          <div className={styles.empty}>
            {t('config_management.status_loading', { defaultValue: '加载中' })}
          </div>
        ) : pools.length === 0 ? (
          <div className={styles.empty}>
            {t('proxy_selection.empty', { defaultValue: '代理池为空，可选择直连' })}
          </div>
        ) : (
          pools.slice(0, 5).map((pool) => (
            <div className={styles.poolRow} key={pool.id}>
              <div className={styles.poolMain}>
                <strong>
                  {pool.redactedUrl || `${pool.protocol}://${pool.host}:${pool.port}`}
                </strong>
                <span>{poolRegion(pool) || pool.ip || '-'}</span>
              </div>
              <div className={styles.poolMeta}>
                <span
                  className={
                    pool.configError || (pool.checked && !pool.available)
                      ? styles.badBadge
                      : pool.checked
                        ? styles.goodBadge
                        : styles.neutralBadge
                  }
                >
                  {pool.configError
                    ? t('proxy_selection.invalid', { defaultValue: '无效' })
                    : pool.checked
                      ? pool.available
                        ? t('proxy_selection.available', { defaultValue: '可用' })
                        : t('proxy_selection.unavailable', { defaultValue: '不可用' })
                      : t('proxy_selection.unchecked', { defaultValue: '未检测' })}
                </span>
                <span className={styles.boundText}>
                  {t('proxy_selection.bound_count', {
                    defaultValue: '{{count}} 个凭证',
                    count: pool.assignedCount,
                  })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
