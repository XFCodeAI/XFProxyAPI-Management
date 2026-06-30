import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import { TooltipIconButton } from '@/components/ui/TooltipControls';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import {
  authFilesApi,
  buildProxyPoolURL,
  DEFAULT_PROXY_POOL_NAME,
  parseProxyPoolURL,
  PROXY_POOL_PROTOCOLS,
  proxyPoolsApi,
  redactProxyURL,
} from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import type { AuthFileItem, ProxyPoolEntry, ProxyPoolStatusEntry, ProxyPoolUsage } from '@/types';
import { generateId } from '@/utils/helpers';
import { readNavigationPreference, writeNavigationPreference } from '@/utils/navigationPreference';
import styles from './ProxyPoolsPage.module.scss';

type ProxyPoolFormErrors = Partial<Record<'proxyUrl' | 'protocol' | 'host' | 'port', string>>;
type ProxyPoolInputMode = 'url' | 'form';
const PROXY_POOLS_PANELS = ['proxies', 'usages'] as const;
type ProxyPoolsPanel = (typeof PROXY_POOLS_PANELS)[number];
const PROXY_POOLS_ACTIVE_PANEL_STORAGE_KEY = 'proxyPoolsPage.activePanel';

const protocolOptions = PROXY_POOL_PROTOCOLS.map((protocol) => ({
  value: protocol,
  label: protocol.toUpperCase(),
}));

function createEmptyPool(name = DEFAULT_PROXY_POOL_NAME): ProxyPoolEntry {
  return {
    id: generateId(),
    name,
    enabled: true,
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
    note: '',
  };
}

function proxyPoolReferenceName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith('pool:')) return '';
  return trimmed.slice('pool:'.length).trim();
}

function defaultPoolName(pools: ProxyPoolEntry[], globalProxyUrl: string): string {
  const globalPoolName = proxyPoolReferenceName(globalProxyUrl);
  if (globalPoolName) return globalPoolName;
  return pools.find((pool) => pool.name.trim())?.name.trim() || DEFAULT_PROXY_POOL_NAME;
}

function supportsFormMode(protocol: ProxyPoolEntry['protocol']): boolean {
  return protocol === 'socks5' || protocol === 'socks5h';
}

function usesURLMode(protocol: ProxyPoolEntry['protocol'], mode: ProxyPoolInputMode): boolean {
  return !supportsFormMode(protocol) || mode === 'url';
}

function validateProxyPool(
  form: ProxyPoolEntry,
  t: (key: string, options?: Record<string, unknown>) => string
): ProxyPoolFormErrors {
  const errors: ProxyPoolFormErrors = {};
  const host = form.host.trim();
  const port = form.port.trim();

  if (!PROXY_POOL_PROTOCOLS.includes(form.protocol)) {
    errors.protocol = t('proxy_pools.validation.protocol_required', {
      defaultValue: '请选择代理协议',
    });
  }

  if (!host) {
    errors.host = t('proxy_pools.validation.host_required', { defaultValue: '请输入代理地址' });
  } else if (/\s/.test(host)) {
    errors.host = t('proxy_pools.validation.host_pattern', {
      defaultValue: '代理地址不能包含空格',
    });
  }

  if (!port) {
    errors.port = t('proxy_pools.validation.port_required', { defaultValue: '请输入端口' });
  } else if (!/^\d+$/.test(port)) {
    errors.port = t('proxy_pools.validation.port_number', { defaultValue: '端口必须是数字' });
  } else {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      errors.port = t('proxy_pools.validation.port_range', {
        defaultValue: '端口范围必须是 1-65535',
      });
    }
  }

  return errors;
}

function usageKindLabel(
  kind: ProxyPoolUsage['kind'],
  t: (key: string, options?: Record<string, unknown>) => string
) {
  switch (kind) {
    case 'global':
      return t('proxy_pools.usage.global', { defaultValue: '全局代理' });
    case 'auth-file':
      return t('proxy_pools.usage.auth_file', { defaultValue: '认证文件' });
    default:
      return t('proxy_pools.usage.provider_key', { defaultValue: 'AI 供应商' });
  }
}

function proxyPoolMatchKey(pool: Pick<ProxyPoolEntry, 'protocol' | 'host' | 'port' | 'username'>) {
  return [
    pool.protocol,
    pool.host.trim().toLowerCase(),
    pool.port.trim(),
    pool.username.trim(),
  ].join('|');
}

function proxyPoolStatusMatchKey(
  pool: Pick<ProxyPoolStatusEntry, 'protocol' | 'host' | 'port' | 'username'>
) {
  return [
    pool.protocol,
    pool.host.trim().toLowerCase(),
    String(pool.port),
    pool.username.trim(),
  ].join('|');
}

function proxyPoolRegion(status?: ProxyPoolStatusEntry): string {
  if (!status) return '';
  return [status.country, status.region, status.city].filter(Boolean).join(' / ');
}

export function ProxyPoolsPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [pools, setPools] = useState<ProxyPoolEntry[]>([]);
  const [statusPools, setStatusPools] = useState<ProxyPoolStatusEntry[]>([]);
  const [globalProxyUrl, setGlobalProxyUrl] = useState('');
  const [configUsages, setConfigUsages] = useState<ProxyPoolUsage[]>([]);
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [authFilesFailed, setAuthFilesFailed] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingID, setCheckingID] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingID, setEditingID] = useState<string | null>(null);
  const [form, setForm] = useState<ProxyPoolEntry>(() => createEmptyPool());
  const [inputMode, setInputMode] = useState<ProxyPoolInputMode>('url');
  const [proxyURLInput, setProxyURLInput] = useState('');
  const [formErrors, setFormErrors] = useState<ProxyPoolFormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [bindingTarget, setBindingTarget] = useState<ProxyPoolStatusEntry | null>(null);
  const [bindingSelected, setBindingSelected] = useState<Set<string>>(new Set());
  const [bindingSaving, setBindingSaving] = useState(false);
  const [activePanel, setActivePanel] = useState<ProxyPoolsPanel>(
    () =>
      readNavigationPreference(PROXY_POOLS_ACTIVE_PANEL_STORAGE_KEY, PROXY_POOLS_PANELS) ??
      'proxies'
  );
  const [selectedPoolIDs, setSelectedPoolIDs] = useState<Set<string>>(new Set());
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);

  const disabled = connectionStatus !== 'connected';
  const enabledCount = pools.filter((pool) => pool.enabled).length;
  const usageRows = useMemo(
    () => configUsages.filter((usage) => usage.kind === 'global' || usage.kind === 'provider-key'),
    [configUsages]
  );
  const statusByKey = useMemo(() => {
    const next = new Map<string, ProxyPoolStatusEntry>();
    statusPools.forEach((status) => {
      next.set(proxyPoolStatusMatchKey(status), status);
    });
    return next;
  }, [statusPools]);
  const poolRows = useMemo(
    () =>
      pools.map((pool) => ({
        pool,
        status: statusByKey.get(proxyPoolMatchKey(pool)),
      })),
    [pools, statusByKey]
  );
  const selectedPoolRows = useMemo(
    () => poolRows.filter(({ pool }) => selectedPoolIDs.has(pool.id)),
    [poolRows, selectedPoolIDs]
  );
  const selectedPoolCount = selectedPoolRows.length;
  const selectedPoolStatuses = useMemo(
    () =>
      selectedPoolRows
        .map(({ status }) => status)
        .filter((status): status is ProxyPoolStatusEntry => Boolean(status)),
    [selectedPoolRows]
  );
  const boundCredentialsCount = statusPools.reduce((sum, pool) => sum + pool.assignedCount, 0);
  const availableCount = statusPools.filter((pool) => pool.checked && pool.available).length;

  const loadProxyPools = useCallback(async () => {
    setLoading(true);
    setError('');
    setAuthFilesFailed(false);
    setStatusFailed(false);

    try {
      const [snapshotResult, statusResult, authFileResult] = await Promise.allSettled([
        proxyPoolsApi.load(),
        proxyPoolsApi.loadStatus(),
        authFilesApi.list(),
      ]);

      if (snapshotResult.status !== 'fulfilled') {
        throw snapshotResult.reason;
      }

      const snapshot = snapshotResult.value;
      setPools(snapshot.pools);
      setGlobalProxyUrl(snapshot.globalProxyUrl);
      setConfigUsages(snapshot.usages);

      if (statusResult.status === 'fulfilled') {
        setStatusPools(statusResult.value);
      } else {
        setStatusPools([]);
        setStatusFailed(true);
      }

      if (authFileResult.status === 'fulfilled') {
        setAuthFiles(authFileResult.value.files);
      } else {
        setAuthFiles([]);
        setAuthFilesFailed(true);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const persistPools = useCallback(
    async (nextPools: ProxyPoolEntry[], successMessage: string) => {
      setSaving(true);
      try {
        const snapshot = await proxyPoolsApi.save(nextPools);
        setPools(snapshot.pools);
        setGlobalProxyUrl(snapshot.globalProxyUrl);
        setConfigUsages(snapshot.usages);
        try {
          setStatusPools(await proxyPoolsApi.loadStatus());
          setStatusFailed(false);
        } catch {
          setStatusPools([]);
          setStatusFailed(true);
        }
        try {
          useConfigStore.getState().clearCache();
          await useConfigStore.getState().fetchConfig(undefined, true);
        } catch (err: unknown) {
          console.warn('代理池已保存，但配置缓存刷新失败:', err);
        }
        showNotification(successMessage, 'success');
        return snapshot;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        showNotification(
          `${t('notification.save_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showNotification, t]
  );

  useEffect(() => {
    void loadProxyPools();
  }, [loadProxyPools]);

  useEffect(() => {
    setSelectedPoolIDs((current) => {
      const poolIDs = new Set(pools.map((pool) => pool.id));
      const next = new Set(Array.from(current).filter((id) => poolIDs.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [pools]);

  useActionBarHeightVar(
    floatingBatchActionsRef,
    '--proxy-pools-action-bar-height',
    selectedPoolCount > 0
  );

  const openCreateModal = () => {
    setEditingID(null);
    const nextForm = createEmptyPool(defaultPoolName(pools, globalProxyUrl));
    setForm(nextForm);
    setInputMode('url');
    setProxyURLInput('');
    setFormErrors({});
    setShowPassword(false);
    setModalOpen(true);
  };

  const openEditModal = (pool: ProxyPoolEntry) => {
    setEditingID(pool.id);
    setForm({ ...pool });
    const nextInputMode = supportsFormMode(pool.protocol) ? 'form' : 'url';
    setInputMode(nextInputMode);
    setProxyURLInput(nextInputMode === 'url' ? buildProxyPoolURL(pool, true) : '');
    setFormErrors({});
    setShowPassword(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setFormErrors({});
  };

  const clearFieldErrors = (...fields: Array<keyof ProxyPoolFormErrors>) => {
    setFormErrors((current) => {
      const next = { ...current };
      for (const field of fields) {
        delete next[field];
      }
      return next;
    });
  };

  const updateProtocol = (protocol: ProxyPoolEntry['protocol']) => {
    setForm((current) => ({ ...current, protocol }));
    setFormErrors({});
    if (!supportsFormMode(protocol)) {
      setInputMode('url');
    }
    setProxyURLInput('');
  };

  const switchInputMode = (mode: ProxyPoolInputMode) => {
    setInputMode(mode);
    setFormErrors({});
    if (mode === 'url') {
      setProxyURLInput(buildProxyPoolURL(form, true));
    } else {
      setProxyURLInput('');
    }
  };

  const updateForm = <K extends keyof ProxyPoolEntry>(field: K, value: ProxyPoolEntry[K]) => {
    if (['protocol', 'host', 'port', 'username', 'password'].includes(String(field))) {
      setProxyURLInput('');
    }
    setForm((current) => ({ ...current, [field]: value }));
    clearFieldErrors(field as keyof ProxyPoolFormErrors);
  };

  const updateProxyURLInput = (value: string) => {
    setProxyURLInput(value);
    setFormErrors((current) => {
      if (!current.proxyUrl) return current;
      const next = { ...current };
      delete next.proxyUrl;
      return next;
    });

    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const parsed = parseProxyPoolURL(trimmed);
      setForm((current) => ({
        ...current,
        protocol: parsed.protocol,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
      }));
      if (supportsFormMode(parsed.protocol)) {
        setInputMode('url');
      }
      clearFieldErrors('protocol', 'host', 'port');
    } catch {
      // Allow incomplete proxy URLs while typing; validation runs on submit.
    }
  };

  const handleModalSubmit = async () => {
    let nextForm = form;
    if (usesURLMode(form.protocol, inputMode)) {
      try {
        const parsed = parseProxyPoolURL(proxyURLInput);
        nextForm = {
          ...nextForm,
          protocol: parsed.protocol,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
        };
      } catch {
        setFormErrors({
          proxyUrl: t('proxy_pools.validation.proxy_url_invalid', {
            defaultValue: '请输入有效的代理直链',
          }),
        });
        return;
      }
    }

    const errors = validateProxyPool(nextForm, t);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const nextPool: ProxyPoolEntry = {
      ...nextForm,
      name: editingID
        ? nextForm.name.trim() || DEFAULT_PROXY_POOL_NAME
        : defaultPoolName(pools, globalProxyUrl),
      host: nextForm.host.trim(),
      port: nextForm.port.trim(),
      username: nextForm.username.trim(),
      note: nextForm.note.trim(),
    };

    const nextPools = !editingID
      ? [...pools, nextPool]
      : pools.map((pool) => (pool.id === editingID ? nextPool : pool));

    await persistPools(
      nextPools,
      editingID
        ? t('proxy_pools.update_success', { defaultValue: '代理已保存' })
        : t('proxy_pools.add_success', { defaultValue: '代理已新增' })
    );
    closeModal();
  };

  const handleDelete = (pool: ProxyPoolEntry) => {
    const target = buildProxyPoolURL(pool);
    showConfirmation({
      title: t('proxy_pools.delete_title', { defaultValue: '删除代理' }),
      message: t('proxy_pools.delete_message', {
        defaultValue: '确认删除代理 {{target}}？',
        target,
      }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await persistPools(
          pools.filter((item) => item.id !== pool.id),
          t('proxy_pools.delete_success', { defaultValue: '代理已删除' })
        );
        setSelectedPoolIDs((current) => {
          const next = new Set(current);
          next.delete(pool.id);
          return next;
        });
      },
    });
  };

  const handleReload = () => {
    void loadProxyPools();
  };

  const handleCheckAll = async () => {
    setChecking(true);
    try {
      setStatusPools(await proxyPoolsApi.checkAll());
      setStatusFailed(false);
      showNotification(t('proxy_pools.check_success', { defaultValue: '代理检测完成' }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('proxy_pools.check_failed', { defaultValue: '代理检测失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setChecking(false);
    }
  };

  const handleCheckOne = async (status: ProxyPoolStatusEntry) => {
    setCheckingID(status.id);
    try {
      const [nextStatus] = await proxyPoolsApi.checkOne(status.id);
      if (nextStatus) {
        setStatusPools((current) =>
          current.map((item) => (item.id === nextStatus.id ? nextStatus : item))
        );
      }
      setStatusFailed(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('proxy_pools.check_failed', { defaultValue: '代理检测失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setCheckingID(null);
    }
  };

  const togglePoolSelection = (poolID: string) => {
    setSelectedPoolIDs((current) => {
      const next = new Set(current);
      if (next.has(poolID)) {
        next.delete(poolID);
      } else {
        next.add(poolID);
      }
      return next;
    });
  };

  const selectAllPools = () => {
    setSelectedPoolIDs(new Set(poolRows.map(({ pool }) => pool.id)));
  };

  const deselectAllPools = () => {
    setSelectedPoolIDs(new Set());
  };

  const handleBatchCheckSelected = async () => {
    if (selectedPoolStatuses.length === 0) return;
    setChecking(true);
    try {
      const results = await Promise.allSettled(
        selectedPoolStatuses.map((status) => proxyPoolsApi.checkOne(status.id))
      );
      const fulfilledResults = results.filter(
        (result): result is PromiseFulfilledResult<ProxyPoolStatusEntry[]> =>
          result.status === 'fulfilled'
      );
      const nextStatuses = fulfilledResults.flatMap((result) => result.value);

      if (nextStatuses.length > 0) {
        const statusByID = new Map(nextStatuses.map((status) => [status.id, status]));
        setStatusPools((current) => current.map((item) => statusByID.get(item.id) ?? item));
        setStatusFailed(false);
      }

      const successCount = fulfilledResults.length;
      const failedCount = results.length - successCount;
      showNotification(
        failedCount === 0
          ? t('proxy_pools.batch_check_success', {
              defaultValue: '已检测 {{count}} 个代理',
              count: successCount,
            })
          : t('proxy_pools.batch_check_partial', {
              defaultValue: '代理检测完成，成功 {{success}} 个，失败 {{failed}} 个',
              success: successCount,
              failed: failedCount,
            }),
        failedCount === 0 ? 'success' : 'warning'
      );
    } finally {
      setChecking(false);
    }
  };

  const handleBatchDeleteSelected = () => {
    if (selectedPoolCount === 0) return;
    showConfirmation({
      title: t('proxy_pools.batch_delete_title', { defaultValue: '删除选中代理' }),
      message: t('proxy_pools.batch_delete_message', {
        defaultValue: '确认删除选中的 {{count}} 个代理？',
        count: selectedPoolCount,
      }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        const selectedIDs = new Set(selectedPoolIDs);
        await persistPools(
          pools.filter((pool) => !selectedIDs.has(pool.id)),
          t('proxy_pools.batch_delete_success', {
            defaultValue: '已删除 {{count}} 个代理',
            count: selectedIDs.size,
          })
        );
        setSelectedPoolIDs(new Set());
      },
    });
  };

  const selectPanel = (panel: ProxyPoolsPanel) => {
    setActivePanel(panel);
    writeNavigationPreference(PROXY_POOLS_ACTIVE_PANEL_STORAGE_KEY, panel);
  };

  const openBindingModal = (status: ProxyPoolStatusEntry) => {
    setBindingTarget(status);
    setBindingSelected(new Set(status.assignedTo.map((item) => item.id)));
  };

  const closeBindingModal = () => {
    if (bindingSaving) return;
    setBindingTarget(null);
    setBindingSelected(new Set());
  };

  const toggleBindingAuth = (name: string) => {
    setBindingSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const saveBinding = async () => {
    if (!bindingTarget) return;
    setBindingSaving(true);
    try {
      setStatusPools(await proxyPoolsApi.assign(bindingTarget.id, Array.from(bindingSelected)));
      showNotification(
        t('proxy_pools.binding_success', { defaultValue: '凭证绑定已更新' }),
        'success'
      );
      setBindingTarget(null);
      setBindingSelected(new Set());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('proxy_pools.binding_failed', { defaultValue: '凭证绑定失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setBindingSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <h1 className={styles.pageTitle}>{t('proxy_pools.title', { defaultValue: '代理池' })}</h1>
          <div className={styles.statusLine}>
            {loading
              ? t('config_management.status_loading', { defaultValue: '加载中' })
              : saving
                ? t('config_management.status_saving', { defaultValue: '保存中' })
                : t('config_management.status_loaded', { defaultValue: '已加载' })}
          </div>
        </div>
        <div className={styles.headerActions}>
          <TooltipIconButton
            label={t('config_management.reload', { defaultValue: '重新加载' })}
            className={styles.iconButton}
            onClick={handleReload}
            disabled={loading || saving}
          >
            <IconRefreshCw size={16} />
          </TooltipIconButton>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCheckAll}
            loading={checking}
            disabled={disabled || loading || saving || pools.length === 0}
          >
            <IconRefreshCw size={16} />
            {t('proxy_pools.check_all', { defaultValue: '检测全部' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={openCreateModal}
            disabled={disabled || loading || saving}
          >
            <IconPlus size={16} />
            {t('proxy_pools.add', { defaultValue: '新增代理' })}
          </Button>
        </div>
      </div>

      <div className={styles.notice} role="status">
        <IconAlertTriangle size={16} />
        <span>
          {t('proxy_pools.runtime_notice', {
            defaultValue: '代理池会立即保存到配置文件，并在配置引用代理池时参与请求代理路线。',
          })}
        </span>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
      {statusFailed ? (
        <div className={styles.errorBox}>
          {t('proxy_pools.status_failed', { defaultValue: '代理池状态读取失败' })}
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}>
          <span>{t('proxy_pools.summary.total', { defaultValue: '代理数量' })}</span>
          <strong>{pools.length}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{t('proxy_pools.summary.enabled', { defaultValue: '启用' })}</span>
          <strong>{enabledCount}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{t('proxy_pools.summary.available', { defaultValue: '检测可用' })}</span>
          <strong>{availableCount}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{t('proxy_pools.summary.bound_credentials', { defaultValue: '绑定凭证' })}</span>
          <strong>{boundCredentialsCount}</strong>
        </div>
      </div>

      <section className={styles.managementPanel}>
        <div
          className={styles.panelTabs}
          aria-label={t('proxy_pools.panel_label', { defaultValue: '代理池内容' })}
        >
          <button
            type="button"
            className={`${styles.panelTab} ${activePanel === 'proxies' ? styles.panelTabActive : ''}`}
            onClick={() => selectPanel('proxies')}
            aria-current={activePanel === 'proxies' ? 'page' : undefined}
          >
            <span>{t('proxy_pools.pool_list', { defaultValue: '代理条目' })}</span>
            <span className={styles.panelCount}>{pools.length}</span>
          </button>
          <button
            type="button"
            className={`${styles.panelTab} ${activePanel === 'usages' ? styles.panelTabActive : ''}`}
            onClick={() => selectPanel('usages')}
            aria-current={activePanel === 'usages' ? 'page' : undefined}
          >
            <span>{t('proxy_pools.usage_title', { defaultValue: '配置代理引用' })}</span>
            <span className={styles.panelCount}>{usageRows.length}</span>
          </button>
        </div>

        <div className={styles.panelContent}>
          {activePanel === 'proxies' ? (
            <div className={styles.table}>
              <div className={`${styles.tableRow} ${styles.tableHead}`}>
                <div>{t('common.select', { defaultValue: '选择' })}</div>
                <div>{t('proxy_pools.columns.address', { defaultValue: '地址' })}</div>
                <div>{t('proxy_pools.columns.health', { defaultValue: '健康 / 地区' })}</div>
                <div>{t('proxy_pools.columns.bound', { defaultValue: '绑定凭证' })}</div>
                <div>{t('proxy_pools.columns.note', { defaultValue: '备注' })}</div>
                <div>{t('proxy_pools.columns.actions', { defaultValue: '操作' })}</div>
              </div>
              {loading ? (
                <div className={styles.emptyState}>{t('config_management.status_loading')}</div>
              ) : pools.length === 0 ? (
                <div className={styles.emptyState}>
                  {t('proxy_pools.empty', { defaultValue: '暂无代理条目' })}
                </div>
              ) : (
                poolRows.map(({ pool, status }) => {
                  const selected = selectedPoolIDs.has(pool.id);
                  return (
                    <div
                      className={`${styles.tableRow} ${selected ? styles.tableRowSelected : ''}`}
                      key={pool.id}
                    >
                      <div className={styles.selectionCell}>
                        <SelectionCheckbox
                          checked={selected}
                          onChange={() => togglePoolSelection(pool.id)}
                          ariaLabel={
                            selected
                              ? t('proxy_pools.deselect_proxy', { defaultValue: '取消选择代理' })
                              : t('proxy_pools.select_proxy', { defaultValue: '选择代理' })
                          }
                        />
                      </div>
                      <div className={styles.proxyCell}>
                        <strong>{buildProxyPoolURL(pool)}</strong>
                        <span>{pool.protocol.toUpperCase()}</span>
                      </div>
                      <div className={styles.healthCell}>
                        <span
                          className={
                            !pool.enabled ||
                            status?.configError ||
                            (status?.checked && !status.available)
                              ? styles.disabledBadge
                              : status?.checked
                                ? styles.enabledBadge
                                : styles.neutralBadge
                          }
                        >
                          {!pool.enabled
                            ? t('proxy_pools.disabled', { defaultValue: '停用' })
                            : status?.configError
                              ? t('proxy_pools.invalid', { defaultValue: '无效' })
                              : status?.checked
                                ? status.available
                                  ? t('proxy_pools.available', { defaultValue: '可用' })
                                  : t('proxy_pools.unavailable', { defaultValue: '不可用' })
                                : t('proxy_pools.unchecked', { defaultValue: '未检测' })}
                        </span>
                        <span>
                          {proxyPoolRegion(status) || status?.ip || status?.checkError || '-'}
                        </span>
                      </div>
                      <div className={styles.boundCell}>
                        <strong>{status?.assignedCount ?? 0}</strong>
                        <span>
                          {status?.assignedTo.length
                            ? status.assignedTo
                                .slice(0, 2)
                                .map((item) => item.email || item.label || item.fileName || item.id)
                                .join(', ')
                            : t('proxy_pools.no_bound_credentials', { defaultValue: '未绑定' })}
                        </span>
                      </div>
                      <div className={styles.noteCell}>{pool.note || '-'}</div>
                      <div className={styles.rowActions}>
                        <TooltipIconButton
                          label={t('proxy_pools.bind_credentials', { defaultValue: '绑定凭证' })}
                          className={styles.rowIconButton}
                          onClick={() => status && openBindingModal(status)}
                          disabled={disabled || saving || !status}
                        >
                          <IconKey size={16} />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label={t('proxy_pools.check_one', { defaultValue: '检测' })}
                          className={styles.rowIconButton}
                          onClick={() => status && void handleCheckOne(status)}
                          disabled={disabled || saving || !status || checkingID === status.id}
                        >
                          <IconRefreshCw size={16} />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label={t('common.edit', { defaultValue: '编辑' })}
                          className={styles.rowIconButton}
                          onClick={() => openEditModal(pool)}
                          disabled={disabled || saving}
                        >
                          <IconPencil size={16} />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label={t('common.delete', { defaultValue: '删除' })}
                          className={styles.rowIconButton}
                          onClick={() => handleDelete(pool)}
                          disabled={disabled || saving}
                        >
                          <IconTrash2 size={16} />
                        </TooltipIconButton>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className={styles.usageList}>
              {usageRows.length === 0 ? (
                <div className={styles.emptyState}>
                  {t('proxy_pools.no_usages', {
                    defaultValue:
                      '当前没有全局或 AI 供应商配置直接引用代理；凭证绑定请看“代理条目”。',
                  })}
                </div>
              ) : (
                usageRows.map((usage) => (
                  <div className={styles.usageRow} key={usage.id}>
                    <span className={styles.usageKind}>{usageKindLabel(usage.kind, t)}</span>
                    <span className={styles.usageProvider}>{usage.provider}</span>
                    <span className={styles.usageTarget}>{usage.target}</span>
                    <span className={styles.monoValue}>{redactProxyURL(usage.proxyUrl)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {selectedPoolCount > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionBar} ref={floatingBatchActionsRef}>
              <span className={styles.batchSelectionText}>
                {t('proxy_pools.batch_selected', {
                  defaultValue: '已选 {{count}} 个代理',
                  count: selectedPoolCount,
                })}
              </span>
              <div className={styles.batchActionButtons}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={selectAllPools}
                  disabled={poolRows.length === 0}
                >
                  {t('proxy_pools.batch_select_visible', { defaultValue: '全选当前代理' })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleBatchCheckSelected()}
                  loading={checking}
                  disabled={disabled || saving || selectedPoolStatuses.length === 0}
                >
                  {t('proxy_pools.batch_check', { defaultValue: '检测选中' })}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={handleBatchDeleteSelected}
                  disabled={disabled || saving}
                >
                  {t('common.delete')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={deselectAllPools}>
                  {t('auth_files.batch_deselect', { defaultValue: '取消选择' })}
                </Button>
              </div>
            </div>,
            document.body
          )
        : null}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        closeDisabled={saving}
        title={
          editingID
            ? t('proxy_pools.edit_title', { defaultValue: '编辑代理' })
            : t('proxy_pools.create_title', { defaultValue: '新增代理' })
        }
        width={720}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleModalSubmit} loading={saving}>
              <IconCheckCircle2 size={16} />
              {editingID
                ? t('common.save', { defaultValue: '保存' })
                : t('proxy_pools.add', { defaultValue: '新增代理' })}
            </Button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <label className={styles.selectField}>
            <span>{t('proxy_pools.form.protocol', { defaultValue: '协议' })}</span>
            <Select
              value={form.protocol}
              options={protocolOptions}
              onChange={(value) => updateProtocol(value as ProxyPoolEntry['protocol'])}
              ariaLabel={t('proxy_pools.form.protocol', { defaultValue: '协议' })}
            />
            {formErrors.protocol ? (
              <span className={styles.fieldError}>{formErrors.protocol}</span>
            ) : null}
          </label>

          {supportsFormMode(form.protocol) ? (
            <label className={styles.methodField}>
              <span>{t('proxy_pools.form.add_mode', { defaultValue: '新增方式' })}</span>
              <div className={styles.segmentedControl}>
                <button
                  type="button"
                  className={
                    inputMode === 'url' ? styles.segmentedButtonActive : styles.segmentedButton
                  }
                  onClick={() => switchInputMode('url')}
                >
                  {t('proxy_pools.form.mode_url', { defaultValue: '直链' })}
                </button>
                <button
                  type="button"
                  className={
                    inputMode === 'form' ? styles.segmentedButtonActive : styles.segmentedButton
                  }
                  onClick={() => switchInputMode('form')}
                >
                  {t('proxy_pools.form.mode_form', { defaultValue: '表格' })}
                </button>
              </div>
            </label>
          ) : null}

          {usesURLMode(form.protocol, inputMode) ? (
            <Input
              wrapperClassName={styles.fullWidthField}
              label={t('proxy_pools.form.proxy_url', { defaultValue: '代理直链' })}
              value={proxyURLInput}
              onChange={(event) => updateProxyURLInput(event.target.value)}
              placeholder={
                form.protocol === 'https'
                  ? 'https://127.0.0.1:7890'
                  : form.protocol === 'socks5h'
                    ? 'socks5h://user:pass@127.0.0.1:1080'
                    : form.protocol === 'socks5'
                      ? 'socks5://user:pass@127.0.0.1:1080'
                      : 'http://127.0.0.1:7890'
              }
              error={formErrors.proxyUrl}
              autoComplete="off"
            />
          ) : (
            <>
              <Input
                label={t('proxy_pools.form.host', { defaultValue: '地址' })}
                value={form.host}
                onChange={(event) => updateForm('host', event.target.value)}
                placeholder="127.0.0.1"
                error={formErrors.host}
              />

              <Input
                label={t('proxy_pools.form.port', { defaultValue: '端口' })}
                value={form.port}
                onChange={(event) => updateForm('port', event.target.value)}
                placeholder="1080"
                inputMode="numeric"
                error={formErrors.port}
              />

              <Input
                label={t('proxy_pools.form.username', { defaultValue: '用户名' })}
                value={form.username}
                onChange={(event) => updateForm('username', event.target.value)}
                autoComplete="off"
              />

              <Input
                label={t('proxy_pools.form.password', { defaultValue: '密码' })}
                value={form.password}
                onChange={(event) => updateForm('password', event.target.value)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                rightElement={
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={
                      showPassword
                        ? t('proxy_pools.form.hide_password', { defaultValue: '隐藏密码' })
                        : t('proxy_pools.form.show_password', { defaultValue: '显示密码' })
                    }
                  >
                    {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                }
              />
            </>
          )}

          <label className={styles.toggleField}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => updateForm('enabled', event.target.checked)}
            />
            <span>{t('proxy_pools.form.enabled', { defaultValue: '启用这个代理' })}</span>
          </label>

          <label className={styles.noteField}>
            <span>{t('proxy_pools.form.note', { defaultValue: '备注' })}</span>
            <textarea
              value={form.note}
              onChange={(event) => updateForm('note', event.target.value)}
              rows={3}
              maxLength={240}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(bindingTarget)}
        onClose={closeBindingModal}
        closeDisabled={bindingSaving}
        title={t('proxy_pools.binding_title', { defaultValue: '绑定凭证' })}
        width={680}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={closeBindingModal}
              disabled={bindingSaving}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void saveBinding()} loading={bindingSaving}>
              <IconCheckCircle2 size={16} />
              {t('common.save', { defaultValue: '保存' })}
            </Button>
          </>
        }
      >
        <div className={styles.bindingPanel}>
          <div className={styles.bindingTarget}>
            <span>{bindingTarget?.redactedUrl || '-'}</span>
            <strong>
              {t('proxy_pools.binding_selected_count', {
                defaultValue: '{{count}} 个凭证',
                count: bindingSelected.size,
              })}
            </strong>
          </div>
          <div className={styles.bindingList}>
            {authFilesFailed ? (
              <div className={styles.emptyState}>
                {t('proxy_pools.auth_files_failed', { defaultValue: '认证文件读取失败' })}
              </div>
            ) : authFiles.length === 0 ? (
              <div className={styles.emptyState}>
                {t('proxy_pools.no_auth_files', { defaultValue: '暂无认证文件' })}
              </div>
            ) : (
              authFiles.map((file) => {
                const name = String(file.name || '').trim();
                const provider = String(file.provider || file.type || 'Auth').trim();
                return (
                  <label className={styles.bindingRow} key={name}>
                    <input
                      type="checkbox"
                      checked={bindingSelected.has(name)}
                      onChange={() => toggleBindingAuth(name)}
                    />
                    <span className={styles.bindingName}>{name}</span>
                    <span className={styles.bindingProvider}>{provider}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
