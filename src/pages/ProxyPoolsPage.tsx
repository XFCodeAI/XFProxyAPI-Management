import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ListRestart } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import { TooltipButton, TooltipIconButton } from '@/components/ui/TooltipControls';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconScale,
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
import type { AuthFileReconciliationCounts } from '@/services/api';
import {
  createStatusSnapshotCoordinator,
  reconcileBindingSelection,
  startStatusPolling,
  type StatusSnapshotCoordinator,
} from '@/features/proxyPools/statusRefresh';
import {
  useAuthInventoryStore,
  useAuthStore,
  useConfigStore,
  useNotificationStore,
} from '@/stores';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import type {
  ProxyPoolEntry,
  ProxyPoolRebalancePreview,
  ProxyPoolStatusEntry,
  ProxyPoolUsage,
} from '@/types';
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
    excludeFromSmartAssignment: false,
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

function parseRebalanceThreshold(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rebalanceIneligibleReasonLabel(
  reason: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (reason) {
    case 'disabled':
      return t('proxy_pools.rebalance.ineligible_disabled', { defaultValue: '已停用' });
    case 'manual_only':
      return t('proxy_pools.rebalance.ineligible_manual_only', { defaultValue: '仅允许手动绑定' });
    case 'invalid_config':
    case 'missing_concrete_url':
      return t('proxy_pools.rebalance.ineligible_invalid', { defaultValue: '配置无效' });
    case 'unavailable':
      return t('proxy_pools.rebalance.ineligible_unavailable', { defaultValue: '检测不可用' });
    case 'pending_assignment':
      return t('proxy_pools.rebalance.ineligible_pending', {
        defaultValue: '存在待完成认证',
      });
    default:
      return t('proxy_pools.rebalance.ineligible_unknown', { defaultValue: '当前不可参与' });
  }
}

function reconciliationFailureCount(counts: AuthFileReconciliationCounts): number {
  return Math.max(
    counts.credentials,
    counts.proxyBindings,
    counts.groupBindings,
    counts.apiKeyBindings,
    counts.runtimeRecords,
    counts.cleanupEntries
  );
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
  const authFiles = useAuthInventoryStore((state) => state.files);
  const authFilesError = useAuthInventoryStore((state) => state.error);
  const maintenanceFiles = useAuthInventoryStore((state) => state.maintenanceFiles);
  const refreshAuthFiles = useAuthInventoryStore((state) => state.refresh);
  const [statusFailed, setStatusFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [balancing, setBalancing] = useState(false);
  const [syncingBindings, setSyncingBindings] = useState(false);
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
  const [rebalanceThreshold, setRebalanceThreshold] = useState('1');
  const [rebalancePreview, setRebalancePreview] = useState<ProxyPoolRebalancePreview | null>(null);
  const [rebalancePreviewLoading, setRebalancePreviewLoading] = useState(false);
  const [rebalancePreviewError, setRebalancePreviewError] = useState('');
  const [rebalanceConfirmOpen, setRebalanceConfirmOpen] = useState(false);
  const [rebalancingSelected, setRebalancingSelected] = useState(false);
  const [rebalanceRefreshVersion, setRebalanceRefreshVersion] = useState(0);
  const rebalancePreviewRequestRef = useRef(0);
  const syncingBindingsRef = useRef(false);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const statusPoolsRef = useRef<ProxyPoolStatusEntry[]>([]);
  const statusCoordinatorRef = useRef<StatusSnapshotCoordinator<ProxyPoolStatusEntry[]> | null>(
    null
  );
  if (statusCoordinatorRef.current === null) {
    statusCoordinatorRef.current = createStatusSnapshotCoordinator({
      load: () => proxyPoolsApi.loadStatus(),
      onSnapshot: (snapshot) => {
        statusPoolsRef.current = snapshot;
        setStatusPools(snapshot);
        setStatusFailed(false);
        setRebalanceRefreshVersion((current) => current + 1);
      },
      onError: () => setStatusFailed(true),
    });
  }

  const refreshProxyPoolStatus = useCallback(() => statusCoordinatorRef.current!.refresh(), []);
  const refreshLatestProxyPoolStatus = useCallback(
    () => statusCoordinatorRef.current!.refreshLatest(),
    []
  );
  const publishProxyPoolStatus = useCallback((snapshot: ProxyPoolStatusEntry[]) => {
    statusCoordinatorRef.current!.publish(snapshot);
  }, []);

  const disabled = connectionStatus !== 'connected';
  const authFilesFailed = authFiles.length === 0 && Boolean(authFilesError);
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
  const selectedRebalanceProxyIDs = useMemo(
    () => selectedPoolStatuses.map((status) => status.id).sort(),
    [selectedPoolStatuses]
  );
  const selectedRebalanceProxyIDsKey = selectedRebalanceProxyIDs.join('|');
  const selectedRebalanceStatusSignature = useMemo(
    () =>
      selectedPoolStatuses
        .map((status) =>
          [
            status.id,
            status.assignedCount,
            status.enabled,
            status.excludeFromSmartAssignment,
            status.checked,
            status.available,
            status.configError || '',
          ].join(':')
        )
        .sort()
        .join('|'),
    [selectedPoolStatuses]
  );
  const parsedRebalanceThreshold = parseRebalanceThreshold(rebalanceThreshold);
  const boundCredentialsCount = statusPools.reduce((sum, pool) => sum + pool.assignedCount, 0);
  const availableCount = statusPools.filter((pool) => pool.checked && pool.available).length;
  const authFileIDs = useMemo(
    () =>
      Array.from(
        new Set(
          authFiles
            .filter((file) => file.assignable !== false)
            .map((file) => String(file.id || file.name || '').trim())
            .filter((id) => id.length > 0)
        )
      ),
    [authFiles]
  );

  const loadProxyPools = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [snapshotResult] = await Promise.allSettled([
        proxyPoolsApi.load(),
        refreshProxyPoolStatus(),
        refreshAuthFiles(),
      ]);

      if (snapshotResult.status !== 'fulfilled') {
        throw snapshotResult.reason;
      }

      const snapshot = snapshotResult.value;
      setPools(snapshot.pools);
      setGlobalProxyUrl(snapshot.globalProxyUrl);
      setConfigUsages(snapshot.usages);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [refreshAuthFiles, refreshProxyPoolStatus, t]);

  const persistPools = useCallback(
    async (nextPools: ProxyPoolEntry[], successMessage: string) => {
      setSaving(true);
      try {
        const snapshot = await proxyPoolsApi.save(nextPools);
        setPools(snapshot.pools);
        setGlobalProxyUrl(snapshot.globalProxyUrl);
        setConfigUsages(snapshot.usages);
        try {
          await refreshLatestProxyPoolStatus();
        } catch {
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
    [refreshLatestProxyPoolStatus, showNotification, t]
  );

  const handleSyncBindings = useCallback(async () => {
    if (syncingBindingsRef.current) return;
    syncingBindingsRef.current = true;
    setSyncingBindings(true);
    try {
      const result = await authFilesApi.reconcileBindings();
      const [, statusResult] = await Promise.allSettled([
        refreshAuthFiles(),
        refreshLatestProxyPoolStatus(),
      ]);
      if (statusResult.status === 'rejected') {
        setStatusFailed(true);
      }

      const removedCredentials = result.removed.credentials;
      const repairedBindings =
        result.removed.proxyBindings +
        result.removed.groupBindings +
        result.removed.apiKeyBindings +
        result.repaired.cleanupEntries;
      const unresolved = Math.max(
        result.pending.cleanupEntries,
        reconciliationFailureCount(result.failed)
      );
      if (result.status === 'partial' || unresolved > 0) {
        showNotification(
          t('proxy_pools.sync_bindings_partial', {
            defaultValue:
              '同步完成：扫描 {{scanned}} 个凭证，移除 {{removed}} 个失效凭证，修复 {{repaired}} 项引用，仍有 {{pending}} 项待重试',
            scanned: result.scanned.credentials,
            removed: removedCredentials,
            repaired: repairedBindings,
            pending: unresolved,
          }),
          'warning'
        );
      } else if (removedCredentials === 0 && repairedBindings === 0) {
        showNotification(
          t('proxy_pools.sync_bindings_noop', { defaultValue: '绑定已同步，无需修复' }),
          'success'
        );
      } else {
        showNotification(
          t('proxy_pools.sync_bindings_success', {
            defaultValue:
              '同步完成：扫描 {{scanned}} 个凭证，移除 {{removed}} 个失效凭证，修复 {{repaired}} 项引用',
            scanned: result.scanned.credentials,
            removed: removedCredentials,
            repaired: repairedBindings,
          }),
          'success'
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('proxy_pools.sync_bindings_failed', { defaultValue: '同步绑定失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      syncingBindingsRef.current = false;
      setSyncingBindings(false);
    }
  }, [refreshAuthFiles, refreshLatestProxyPoolStatus, showNotification, t]);

  useEffect(() => {
    statusCoordinatorRef.current?.resume();
    return () => {
      statusCoordinatorRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    void loadProxyPools();
  }, [loadProxyPools]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    return startStatusPolling({ refresh: refreshProxyPoolStatus });
  }, [connectionStatus, refreshProxyPoolStatus]);

  useEffect(() => {
    if (!bindingTarget) return;
    const nextTarget = statusPools.find((status) => status.id === bindingTarget.id);
    if (!nextTarget) {
      setBindingTarget(null);
      setBindingSelected(new Set());
      return;
    }
    setBindingSelected((current) =>
      reconcileBindingSelection(
        current,
        bindingTarget.assignedTo.map((assignment) => assignment.id),
        nextTarget.assignedTo.map((assignment) => assignment.id)
      )
    );
    if (nextTarget !== bindingTarget) {
      setBindingTarget(nextTarget);
    }
  }, [bindingTarget, statusPools]);

  useEffect(() => {
    const available = new Set(authFileIDs);
    setBindingSelected((current) => {
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [authFileIDs]);

  useEffect(() => {
    setSelectedPoolIDs((current) => {
      const poolIDs = new Set(pools.map((pool) => pool.id));
      const next = new Set(Array.from(current).filter((id) => poolIDs.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [pools]);

  useEffect(() => {
    const requestID = ++rebalancePreviewRequestRef.current;
    setRebalanceConfirmOpen(false);
    if (selectedPoolCount < 2) {
      setRebalancePreview(null);
      setRebalancePreviewError('');
      setRebalancePreviewLoading(false);
      return;
    }
    if (parsedRebalanceThreshold === null) {
      setRebalancePreview(null);
      setRebalancePreviewError(
        t('proxy_pools.rebalance.threshold_invalid', {
          defaultValue: '最大差值必须是大于或等于 0 的整数',
        })
      );
      setRebalancePreviewLoading(false);
      return;
    }
    if (selectedRebalanceProxyIDs.length !== selectedPoolCount) {
      setRebalancePreview(null);
      setRebalancePreviewError(
        t('proxy_pools.rebalance.status_unavailable', {
          defaultValue: '部分代理状态尚未加载',
        })
      );
      setRebalancePreviewLoading(false);
      return;
    }

    setRebalancePreviewLoading(true);
    setRebalancePreviewError('');
    const timer = setTimeout(() => {
      void proxyPoolsApi
        .previewRebalance(selectedRebalanceProxyIDs, parsedRebalanceThreshold)
        .then((preview) => {
          if (rebalancePreviewRequestRef.current !== requestID) return;
          setRebalancePreview(preview);
        })
        .catch((err: unknown) => {
          if (rebalancePreviewRequestRef.current !== requestID) return;
          setRebalancePreview(null);
          setRebalancePreviewError(
            err instanceof Error
              ? err.message
              : t('proxy_pools.rebalance.preview_failed', {
                  defaultValue: '无法比较所选代理',
                })
          );
        })
        .finally(() => {
          if (rebalancePreviewRequestRef.current === requestID) {
            setRebalancePreviewLoading(false);
          }
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    parsedRebalanceThreshold,
    rebalanceRefreshVersion,
    selectedPoolCount,
    selectedRebalanceProxyIDs,
    selectedRebalanceProxyIDsKey,
    selectedRebalanceStatusSignature,
    t,
  ]);

  useActionBarHeightVar(
    floatingBatchActionsRef,
    '--proxy-pools-action-bar-height',
    selectedPoolCount > 0
  );

  const rebalanceStatusText = useMemo(() => {
    if (selectedPoolCount < 2) return '';
    if (parsedRebalanceThreshold === null) {
      return t('proxy_pools.rebalance.threshold_invalid', {
        defaultValue: '最大差值必须是大于或等于 0 的整数',
      });
    }
    if (rebalancePreviewLoading) {
      return t('proxy_pools.rebalance.comparing', { defaultValue: '正在比较绑定数量' });
    }
    if (rebalancePreviewError) return rebalancePreviewError;
    if (!rebalancePreview) return '';
    if (!rebalancePreview.eligible) {
      const entries = rebalancePreview.pools
        .filter((pool) => !pool.eligible)
        .map(
          (pool) =>
            `${pool.redactedUrl || pool.name || pool.id}: ${rebalanceIneligibleReasonLabel(pool.ineligibleReason, t)}`
        );
      return t('proxy_pools.rebalance.ineligible_summary', {
        defaultValue: '不可参与：{{items}}',
        items: entries.join('、'),
      });
    }
    switch (rebalancePreview.reason) {
      case 'worthwhile':
        return t('proxy_pools.rebalance.worthwhile', {
          defaultValue: '当前差值 {{difference}}，预计迁移 {{moves}} 个绑定',
          difference: rebalancePreview.currentDifference,
          moves: rebalancePreview.moveCount,
        });
      case 'within_threshold':
        return t('proxy_pools.rebalance.within_threshold', {
          defaultValue: '当前差值 {{difference}}，已在允许范围 {{allowed}} 内',
          difference: rebalancePreview.currentDifference,
          allowed: rebalancePreview.maxDifference,
        });
      case 'no_movable_bindings':
        return t('proxy_pools.rebalance.no_bindings', { defaultValue: '没有可重新分配的绑定' });
      default:
        return t('proxy_pools.rebalance.already_balanced', { defaultValue: '当前已是最均衡分配' });
    }
  }, [
    parsedRebalanceThreshold,
    rebalancePreview,
    rebalancePreviewError,
    rebalancePreviewLoading,
    selectedPoolCount,
    t,
  ]);

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
      publishProxyPoolStatus(await proxyPoolsApi.checkAll());
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
        publishProxyPoolStatus(
          statusPoolsRef.current.map((item) => (item.id === nextStatus.id ? nextStatus : item))
        );
      }
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

  const handleSmartBalance = async () => {
    if (authFilesFailed || authFileIDs.length === 0) return;
    setBalancing(true);
    try {
      const result = await proxyPoolsApi.autoAssignUnassigned(authFileIDs);
      publishProxyPoolStatus(result.pools);
      if (result.failed > 0) {
        showNotification(
          t('proxy_pools.balance_partial', {
            defaultValue: '智能平衡完成，成功 {{updated}} 个，失败 {{failed}} 个',
            updated: result.updated,
            failed: result.failed,
          }),
          result.updated > 0 ? 'warning' : 'error'
        );
      } else if (result.updated === 0) {
        showNotification(
          t('proxy_pools.balance_noop', { defaultValue: '所有凭证均已配置代理' }),
          'info'
        );
      } else {
        showNotification(
          t('proxy_pools.balance_success', {
            defaultValue: '已为 {{count}} 个凭证智能分配代理',
            count: result.updated,
          }),
          'success'
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('proxy_pools.balance_failed', { defaultValue: '智能平衡失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setBalancing(false);
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
        publishProxyPoolStatus(
          statusPoolsRef.current.map((item) => statusByID.get(item.id) ?? item)
        );
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

  const openRebalanceConfirmation = () => {
    if (!rebalancePreview?.worthwhile || rebalancePreviewLoading || rebalancingSelected) return;
    setRebalanceConfirmOpen(true);
  };

  const closeRebalanceConfirmation = () => {
    if (rebalancingSelected) return;
    setRebalanceConfirmOpen(false);
  };

  const handleRebalanceSelected = async () => {
    if (
      !rebalancePreview?.worthwhile ||
      parsedRebalanceThreshold === null ||
      selectedRebalanceProxyIDs.length < 2
    ) {
      return;
    }
    setRebalancingSelected(true);
    try {
      const result = await proxyPoolsApi.rebalance(
        selectedRebalanceProxyIDs,
        parsedRebalanceThreshold,
        rebalancePreview.revision
      );
      setRebalancePreview(result.preview);
      setRebalanceConfirmOpen(false);
      switch (result.status) {
        case 'ok':
          showNotification(
            t('proxy_pools.rebalance.success', {
              defaultValue: '已重新分配 {{count}} 个绑定',
              count: result.moved,
            }),
            'success'
          );
          await loadProxyPools();
          setSelectedPoolIDs(new Set());
          break;
        case 'stale':
          showNotification(
            t('proxy_pools.rebalance.stale', {
              defaultValue: '绑定状态已变化，请确认新的比较结果',
            }),
            'warning'
          );
          await loadProxyPools();
          break;
        case 'noop':
          showNotification(
            t('proxy_pools.rebalance.noop', { defaultValue: '当前无需重新平衡' }),
            'info'
          );
          break;
        case 'rolled_back':
          showNotification(
            t('proxy_pools.rebalance.rolled_back', {
              defaultValue: '重新分配失败，所有变更已回滚',
            }),
            'error'
          );
          await loadProxyPools();
          break;
        case 'partial':
          showNotification(
            t('proxy_pools.rebalance.partial', {
              defaultValue: '重新分配未完整回滚，请检查最新绑定状态',
            }),
            'error'
          );
          await loadProxyPools();
          break;
        default:
          showNotification(
            t('proxy_pools.rebalance.failed', { defaultValue: '重新智能平衡失败' }),
            'error'
          );
          await loadProxyPools();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('proxy_pools.rebalance.failed', { defaultValue: '重新智能平衡失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRebalancingSelected(false);
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
      publishProxyPoolStatus(
        await proxyPoolsApi.assign(bindingTarget.id, Array.from(bindingSelected))
      );
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
              : syncingBindings
                ? t('proxy_pools.sync_bindings_running', { defaultValue: '正在同步历史绑定' })
                : saving
                  ? t('config_management.status_saving', { defaultValue: '保存中' })
                  : balancing
                    ? t('proxy_pools.balance_running', { defaultValue: '正在智能平衡' })
                    : t('config_management.status_loaded', { defaultValue: '已加载' })}
          </div>
        </div>
        <div className={styles.headerActions}>
          <TooltipIconButton
            label={t('config_management.reload', { defaultValue: '重新加载' })}
            className={styles.iconButton}
            onClick={handleReload}
            disabled={loading || saving || balancing || syncingBindings}
          >
            <IconRefreshCw size={16} />
          </TooltipIconButton>
          <TooltipButton
            label={t('proxy_pools.sync_bindings', { defaultValue: '同步绑定' })}
            variant="secondary"
            className={styles.syncButton}
            onClick={() => void handleSyncBindings()}
            loading={syncingBindings}
            disabled={disabled || loading || saving || checking || balancing}
          >
            {!syncingBindings && <ListRestart size={16} aria-hidden="true" />}
            <span className={styles.syncButtonLabel}>
              {t('proxy_pools.sync_bindings', { defaultValue: '同步绑定' })}
            </span>
          </TooltipButton>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCheckAll}
            loading={checking}
            disabled={
              disabled || loading || saving || balancing || syncingBindings || pools.length === 0
            }
          >
            <IconRefreshCw size={16} />
            {t('proxy_pools.check_all', { defaultValue: '检测全部' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleSmartBalance()}
            loading={balancing}
            disabled={
              disabled ||
              loading ||
              saving ||
              checking ||
              syncingBindings ||
              authFilesFailed ||
              authFileIDs.length === 0 ||
              pools.length === 0
            }
          >
            <IconScale size={16} />
            {t('proxy_pools.balance', { defaultValue: '智能平衡' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={openCreateModal}
            disabled={disabled || loading || saving || balancing || syncingBindings}
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
        <div className={styles.summaryItem}>
          <span>{t('proxy_pools.summary.maintenance_files', { defaultValue: '待维护文件' })}</span>
          <strong>{maintenanceFiles}</strong>
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
                        {pool.excludeFromSmartAssignment ? (
                          <span className={styles.manualOnlyBadge}>
                            {t('proxy_pools.manual_only', { defaultValue: '仅手动' })}
                          </span>
                        ) : null}
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
                          disabled={disabled || saving || syncingBindings || !status}
                        >
                          <IconKey size={16} />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label={t('proxy_pools.check_one', { defaultValue: '检测' })}
                          className={styles.rowIconButton}
                          onClick={() => status && void handleCheckOne(status)}
                          disabled={
                            disabled ||
                            saving ||
                            syncingBindings ||
                            !status ||
                            checkingID === status.id
                          }
                        >
                          <IconRefreshCw size={16} />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label={t('common.edit', { defaultValue: '编辑' })}
                          className={styles.rowIconButton}
                          onClick={() => openEditModal(pool)}
                          disabled={disabled || saving || syncingBindings}
                        >
                          <IconPencil size={16} />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label={t('common.delete', { defaultValue: '删除' })}
                          className={styles.rowIconButton}
                          onClick={() => handleDelete(pool)}
                          disabled={disabled || saving || syncingBindings}
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
              <div className={styles.batchSelectionGroup}>
                <span className={styles.batchSelectionText}>
                  {t('proxy_pools.batch_selected', {
                    defaultValue: '已选 {{count}} 个代理',
                    count: selectedPoolCount,
                  })}
                </span>
                {selectedPoolCount >= 2 ? (
                  <div className={styles.rebalanceControls}>
                    <label className={styles.rebalanceThresholdField}>
                      <span>
                        {t('proxy_pools.rebalance.threshold_label', {
                          defaultValue: '允许最大差值',
                        })}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={rebalanceThreshold}
                        onChange={(event) => setRebalanceThreshold(event.target.value)}
                        aria-invalid={parsedRebalanceThreshold === null}
                      />
                    </label>
                    <span
                      className={styles.rebalanceStatus}
                      title={rebalanceStatusText}
                      data-error={Boolean(
                        rebalancePreviewError || parsedRebalanceThreshold === null
                      )}
                    >
                      {rebalanceStatusText}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className={styles.batchActionButtons}>
                {rebalancePreview?.worthwhile ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={openRebalanceConfirmation}
                    loading={rebalancePreviewLoading || rebalancingSelected}
                    disabled={
                      disabled || saving || checking || syncingBindings || rebalancingSelected
                    }
                  >
                    <IconScale size={16} />
                    {t('proxy_pools.rebalance.action', { defaultValue: '重新智能平衡' })}
                  </Button>
                ) : null}
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
                  disabled={
                    disabled || saving || syncingBindings || selectedPoolStatuses.length === 0
                  }
                >
                  {t('proxy_pools.batch_check', { defaultValue: '检测选中' })}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={handleBatchDeleteSelected}
                  disabled={disabled || saving || syncingBindings}
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
        open={rebalanceConfirmOpen}
        onClose={closeRebalanceConfirmation}
        closeDisabled={rebalancingSelected}
        title={t('proxy_pools.rebalance.title', { defaultValue: '重新智能平衡' })}
        width={760}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={closeRebalanceConfirmation}
              disabled={rebalancingSelected}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRebalanceSelected()}
              loading={rebalancingSelected}
              disabled={!rebalancePreview?.worthwhile}
            >
              <IconScale size={16} />
              {t('proxy_pools.rebalance.confirm', { defaultValue: '确认重新分配' })}
            </Button>
          </>
        }
      >
        {rebalancePreview ? (
          <div className={styles.rebalancePanel}>
            <div className={styles.rebalanceSummary}>
              <div className={styles.rebalanceMetric}>
                <span>
                  {t('proxy_pools.rebalance.selected_count', { defaultValue: '所选代理' })}
                </span>
                <strong>{rebalancePreview.pools.length}</strong>
              </div>
              <div className={styles.rebalanceMetric}>
                <span>
                  {t('proxy_pools.rebalance.current_difference', {
                    defaultValue: '当前差值',
                  })}
                </span>
                <strong>{rebalancePreview.currentDifference}</strong>
              </div>
              <div className={styles.rebalanceMetric}>
                <span>{t('proxy_pools.rebalance.move_count', { defaultValue: '预计迁移' })}</span>
                <strong>{rebalancePreview.moveCount}</strong>
              </div>
            </div>
            <div className={styles.rebalanceTable}>
              <div className={`${styles.rebalanceRow} ${styles.rebalanceTableHead}`}>
                <span>{t('proxy_pools.rebalance.address', { defaultValue: '代理' })}</span>
                <span>{t('proxy_pools.rebalance.breakdown', { defaultValue: '绑定构成' })}</span>
                <span>{t('proxy_pools.rebalance.current', { defaultValue: '当前' })}</span>
                <span>{t('proxy_pools.rebalance.target', { defaultValue: '调整后' })}</span>
              </div>
              {rebalancePreview.pools.map((pool) => (
                <div className={styles.rebalanceRow} key={pool.id}>
                  <strong title={pool.redactedUrl}>{pool.redactedUrl || pool.name || '-'}</strong>
                  <span className={styles.rebalanceBindingBreakdown}>
                    {t('proxy_pools.rebalance.binding_breakdown', {
                      defaultValue: '凭证 {{credentials}} / API {{providerKeys}}',
                      credentials: pool.credentialCount,
                      providerKeys: pool.providerApiKeyCount,
                    })}
                  </span>
                  <span
                    className={styles.rebalanceCount}
                    data-label={t('proxy_pools.rebalance.current', { defaultValue: '当前' })}
                  >
                    {pool.currentCount}
                  </span>
                  <strong
                    className={styles.rebalanceCount}
                    data-label={t('proxy_pools.rebalance.target', { defaultValue: '调整后' })}
                  >
                    {pool.targetCount}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

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

          <label className={styles.toggleField}>
            <input
              type="checkbox"
              checked={form.excludeFromSmartAssignment}
              onChange={(event) => updateForm('excludeFromSmartAssignment', event.target.checked)}
            />
            <span>
              {t('proxy_pools.form.exclude_from_smart_assignment', {
                defaultValue: '不参与智能分配',
              })}
            </span>
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
            ) : authFileIDs.length === 0 ? (
              <div className={styles.emptyState}>
                {t('proxy_pools.no_auth_files', { defaultValue: '暂无认证文件' })}
              </div>
            ) : (
              authFiles
                .filter((file) => file.assignable !== false)
                .map((file) => {
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
