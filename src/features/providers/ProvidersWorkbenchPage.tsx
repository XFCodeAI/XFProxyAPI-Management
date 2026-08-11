import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { IconX } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useCredentialGroupsCatalog } from '@/hooks/useCredentialGroupsCatalog';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuthInventoryStore, useAuthStore, useNotificationStore } from '@/stores';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { ProviderHeaderCard } from './components/ProviderHeaderCard';
import { CredentialConcurrencyDefaultControl } from '@/components/concurrency/CredentialConcurrencyDefaultControl';
import { ProviderCategoryList } from './components/ProviderCategoryList';
import { ProviderResourcePanel } from './components/ProviderResourcePanel';
import {
  classifyCredentialGroupFilterState,
  clearCredentialGroupFilterParams,
  credentialGroupKey,
  filterProviderGroupsByCredentialGroup,
  readCredentialGroupFilter,
} from './credentialGroupFilter';
import type { ProviderPanelControls } from './components/ProviderResourcePanel';
import { ProviderSheet, type ProviderSheetHandle } from './sheets/ProviderSheet';
import { isSponsorPartialMutationError } from './sponsorMutationRecovery';
import { useProviderWorkbench } from './useProviderWorkbench';
import { getProviderResourceRecentWindowStats } from './providerUsage';
import { supplierBillingResourceKey, useSupplierBillingProbes } from './useSupplierBillingProbes';
import {
  getProviderFilterState,
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
  type ProviderFilterState,
  type ProvidersWorkbenchUiState,
} from './uiState';
import type { ProviderBrand, ProviderResource, ProviderSortBy, SortDir } from './types';
import styles from './ProvidersWorkbenchPage.module.scss';

type SheetMode = 'detail' | 'create' | 'edit';

interface SheetState {
  open: boolean;
  brand: ProviderBrand;
  mode: SheetMode;
  resource: ProviderResource | null;
  focusFailureHistory?: boolean;
}

const formatDateTime = (iso: string, locale?: string) => {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return iso;
  }
};

const matchesFilter = (r: ProviderResource, normalized: string): boolean => {
  if (!normalized) return true;
  const haystack = [
    r.identifier,
    r.name,
    r.authIndex,
    r.apiKeyPreview,
    r.apiKey,
    r.baseUrl,
    r.proxyUrl,
    r.prefix,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  return haystack.some((v) => v.includes(normalized));
};

const getResourceSortName = (resource: ProviderResource): string =>
  (resource.name ?? resource.identifier ?? resource.apiKeyPreview ?? '').toLowerCase();

const getResourceRecentSuccess = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): number => getProviderResourceRecentWindowStats(resource, usageByProvider).success;

export function ProvidersWorkbenchPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();
  const authGroupTotals = useAuthInventoryStore((state) => state.groupTotals);

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const workbench = useProviderWorkbench();
  const [uiState, setUiState] = useState<ProvidersWorkbenchUiState>(readProvidersWorkbenchUiState);
  const [sheetState, setSheetState] = useState<SheetState>({
    open: false,
    brand: 'gemini',
    mode: 'detail',
    resource: null,
  });
  const sheetRef = useRef<ProviderSheetHandle>(null);
  const appliedCredentialGroupFilterRef = useRef('');
  const supplierRecoveryNotificationsRef = useRef(new Map<string, Promise<void>>());

  const connected = connectionStatus === 'connected';
  const credentialGroupFilter = useMemo(
    () => readCredentialGroupFilter(searchParams),
    [searchParams]
  );
  const credentialGroupCatalog = useCredentialGroupsCatalog({
    enabled: connected && Boolean(credentialGroupFilter),
  });
  const { usageByProvider, refreshRecentRequests } = useProviderRecentRequests({
    enabled: connected,
  });

  const disableMutations =
    connectionStatus !== 'connected' ||
    workbench.mutating ||
    workbench.isFetching ||
    workbench.isError;

  const persistUiState = useCallback(
    (updater: (prev: ProvidersWorkbenchUiState) => ProvidersWorkbenchUiState) => {
      setUiState((prev) => {
        const next = updater(prev);
        writeProvidersWorkbenchUiState(next);
        return next;
      });
    },
    []
  );

  const setActiveBrand = useCallback(
    (brand: ProviderBrand) => {
      persistUiState((prev) =>
        prev.activeBrand === brand ? prev : { ...prev, activeBrand: brand }
      );
    },
    [persistUiState]
  );

  const allGroups = useMemo(() => workbench.snapshot?.groups ?? [], [workbench.snapshot]);
  const imageRouteResources = useMemo(
    () => allGroups.find((group) => group.id === 'openaiCompatibility')?.resources ?? [],
    [allGroups]
  );
  const groups = useMemo(
    () => filterProviderGroupsByCredentialGroup(allGroups, credentialGroupFilter),
    [allGroups, credentialGroupFilter]
  );
  const firstVisibleBrand = groups[0]?.id ?? 'gemini';
  const activeBrand = groups.some((group) => group.id === uiState.activeBrand)
    ? uiState.activeBrand
    : firstVisibleBrand;
  const activeFilterState = getProviderFilterState(uiState, activeBrand);
  const filter = activeFilterState.filter;
  const providerSortBy = activeFilterState.sortBy;
  const providerSortDir = activeFilterState.sortDir;
  const activeGroup = groups.find((g) => g.id === activeBrand) ?? groups[0] ?? null;
  useEffect(() => {
    if (groups.length === 0) return;
    if (groups.some((group) => group.id === uiState.activeBrand)) return;
    persistUiState((prev) =>
      prev.activeBrand === firstVisibleBrand ? prev : { ...prev, activeBrand: firstVisibleBrand }
    );
  }, [firstVisibleBrand, groups, persistUiState, uiState.activeBrand]);

  useEffect(() => {
    const filterKey = credentialGroupKey(credentialGroupFilter);
    if (!filterKey) {
      appliedCredentialGroupFilterRef.current = '';
      return;
    }
    if (appliedCredentialGroupFilterRef.current === filterKey) return;
    const firstMatchingGroup = groups.find((group) => group.resources.length > 0);
    if (!firstMatchingGroup) return;
    appliedCredentialGroupFilterRef.current = filterKey;
    setActiveBrand(firstMatchingGroup.id);
  }, [credentialGroupFilter, groups, setActiveBrand]);

  const updateActiveFilterState = useCallback(
    (patch: Partial<ProviderFilterState>) => {
      persistUiState((prev) => {
        const current = getProviderFilterState(prev, activeBrand);
        return {
          ...prev,
          filtersByBrand: {
            ...prev.filtersByBrand,
            [activeBrand]: {
              ...current,
              ...patch,
            },
          },
        };
      });
    },
    [activeBrand, persistUiState]
  );

  const filteredResources = useMemo(() => {
    if (!activeGroup) return [];
    const normalized = filter.trim().toLowerCase();
    return activeGroup.resources.filter((r) => matchesFilter(r, normalized));
  }, [activeGroup, filter]);

  const availableModels = useMemo(() => {
    if (!activeGroup) return [];
    const seen = new Set<string>();
    activeGroup.resources.forEach((r) => {
      r.models.forEach((name) => seen.add(name));
    });
    return Array.from(seen).sort();
  }, [activeGroup]);

  const selectedModels = useMemo(() => {
    if (availableModels.length === 0) return new Set<string>();
    const availableModelSet = new Set(availableModels);
    return new Set(activeFilterState.selectedModels.filter((name) => availableModelSet.has(name)));
  }, [activeFilterState.selectedModels, availableModels]);

  const visibleResources = useMemo(() => {
    let arr = filteredResources;
    if (selectedModels.size > 0) {
      arr = arr.filter((r) => r.models.some((name) => selectedModels.has(name)));
    }

    const sorted = [...arr].sort((a, b) => {
      let diff = 0;
      if (providerSortBy === 'name') {
        diff = getResourceSortName(a).localeCompare(getResourceSortName(b));
      } else if (providerSortBy === 'priority') {
        diff = a.priority - b.priority;
      } else {
        diff =
          getResourceRecentSuccess(a, usageByProvider) -
          getResourceRecentSuccess(b, usageByProvider);
      }
      if (diff === 0) {
        diff = a.originalIndex - b.originalIndex;
      }
      return providerSortDir === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [filteredResources, providerSortBy, providerSortDir, selectedModels, usageByProvider]);

  const visibleBillingResources = useMemo(() => {
    const next = [...visibleResources];
    const detailResource = sheetState.open ? sheetState.resource : null;
    if (detailResource && !next.some((resource) => resource.id === detailResource.id)) {
      next.push(detailResource);
    }
    return next;
  }, [sheetState.open, sheetState.resource, visibleResources]);
  const billingProbes = useSupplierBillingProbes({
    enabled: connected && isCurrentLayer,
    resources: visibleBillingResources,
  });
  const refetchBillingProbes = billingProbes.refetch;
  const recoverSupplierAvailability = billingProbes.recoverSupplier;

  const handleRecoverSuppliers = useCallback(
    async (supplierIds: readonly string[]) => {
      const normalizedSupplierIds = Array.from(
        new Set(supplierIds.map((supplierId) => supplierId.trim()).filter(Boolean))
      ).sort();
      if (normalizedSupplierIds.length === 0) return;
      const requestKey = normalizedSupplierIds.join('\u0000');
      const existingRequest = supplierRecoveryNotificationsRef.current.get(requestKey);
      if (existingRequest) {
        await existingRequest;
        return;
      }
      const request = (async () => {
        const results = await Promise.allSettled(
          normalizedSupplierIds.map((supplierId) => recoverSupplierAvailability(supplierId))
        );
        const accepted = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        const rejected = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : []
        );
        if (accepted.length > 0) {
          const queued = accepted.reduce((total, response) => total + response.queued, 0);
          const alreadyProbing = accepted.reduce(
            (total, response) => total + response.already_probing,
            0
          );
          const skipped = accepted.reduce(
            (total, response) =>
              total + Object.values(response.skipped).reduce((sum, count) => sum + count, 0),
            0
          );
          showNotification(
            t('providersPage.availabilityRecovery.summary', {
              queued,
              alreadyProbing,
              skipped,
            }),
            skipped > 0 ? 'warning' : queued > 0 ? 'success' : 'info'
          );

          const visibleEntries = Object.values(billingProbes.entriesByResource).flat();
          const labelsByEntry = new Map(
            visibleEntries.map((entry) => [
              `${entry.supplier_id}\u0000${entry.entry_id}`,
              entry.alias?.trim() || entry.entry_id,
            ])
          );
          const partialFailures = accepted.flatMap((response) =>
            response.entries.flatMap((entry) => {
              if (entry.status !== 'skipped') return [];
              const reason = entry.reason?.trim() || 'unknown_state';
              const reasonText = t(`providersPage.availabilityRecovery.reasons.${reason}`, {
                defaultValue: reason,
              });
              const label =
                labelsByEntry.get(`${entry.supplier_id}\u0000${entry.entry_id}`) || entry.entry_id;
              return [
                t('providersPage.availabilityRecovery.partialEntry', {
                  key: label,
                  reason: reasonText,
                }),
              ];
            })
          );
          if (partialFailures.length > 0) {
            showNotification(partialFailures.join('; '), 'warning', 12_000);
          }
        }
        if (rejected.length > 0) {
          const reasons = rejected.map((reason) =>
            reason instanceof Error ? reason.message : String(reason)
          );
          showNotification(
            t('providersPage.availabilityRecovery.failed', { reason: reasons.join('; ') }),
            'error',
            12_000
          );
        }
      })();
      supplierRecoveryNotificationsRef.current.set(requestKey, request);
      try {
        await request;
      } finally {
        if (supplierRecoveryNotificationsRef.current.get(requestKey) === request) {
          supplierRecoveryNotificationsRef.current.delete(requestKey);
        }
      }
    },
    [billingProbes.entriesByResource, recoverSupplierAvailability, showNotification, t]
  );

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([
      workbench.refetch(),
      refreshRecentRequests().catch(() => undefined),
      refetchBillingProbes().catch(() => undefined),
    ]);
  }, [refetchBillingProbes, refreshRecentRequests, workbench]);

  useHeaderRefresh(handleRefresh, isCurrentLayer);

  const toolbarControls = useMemo<ProviderPanelControls | undefined>(() => {
    if (!activeGroup) return undefined;
    return {
      sortBy: providerSortBy,
      sortDir: providerSortDir,
      onSortBy: (value: ProviderSortBy) => updateActiveFilterState({ sortBy: value }),
      onSortDir: (value: SortDir) => updateActiveFilterState({ sortDir: value }),
      availableModels,
      selectedModels,
      onSelectedModelsChange: (next) =>
        updateActiveFilterState({
          selectedModels: Array.from(next).sort((a, b) => a.localeCompare(b)),
        }),
    };
  }, [
    activeGroup,
    availableModels,
    providerSortBy,
    providerSortDir,
    selectedModels,
    updateActiveFilterState,
  ]);

  const totalResources = useMemo(
    () =>
      groups.reduce((sum, g) => sum + g.resources.filter((r) => !r.flags.isPlaceholder).length, 0),
    [groups]
  );

  const totalActive = useMemo(
    () =>
      groups.reduce(
        (sum, g) => sum + g.resources.filter((r) => !r.disabled && !r.flags.isPlaceholder).length,
        0
      ),
    [groups]
  );

  const providerFamilies = useMemo(
    () => groups.filter((g) => g.resources.some((r) => !r.flags.isPlaceholder)).length,
    [groups]
  );
  const canonicalCredentialGroup = useMemo(
    () =>
      credentialGroupCatalog.groups.find(
        (group) => credentialGroupKey(group) === credentialGroupKey(credentialGroupFilter)
      ) ?? credentialGroupFilter,
    [credentialGroupCatalog.groups, credentialGroupFilter]
  );
  const matchingOAuthCount = useMemo(
    () =>
      credentialGroupFilter ? (authGroupTotals[credentialGroupKey(credentialGroupFilter)] ?? 0) : 0,
    [authGroupTotals, credentialGroupFilter]
  );
  const credentialGroupFilterState = classifyCredentialGroupFilterState({
    filter: credentialGroupFilter,
    catalogReady: credentialGroupCatalog.ready,
    catalogGroups: credentialGroupCatalog.groups,
    matchingProviderCount: totalResources,
    matchingOAuthCount,
  });
  const credentialGroupFilterMessage =
    credentialGroupFilterState === 'stale'
      ? t('providersPage.groupFilter.stale', { group: canonicalCredentialGroup })
      : credentialGroupFilterState === 'oauth-only'
        ? t('providersPage.groupFilter.oauthOnly', {
            group: canonicalCredentialGroup,
            count: matchingOAuthCount,
          })
        : credentialGroupFilterState === 'empty'
          ? t('providersPage.groupFilter.empty', { group: canonicalCredentialGroup })
          : t('providersPage.groupFilter.results', {
              group: canonicalCredentialGroup,
              count: totalResources,
            });
  const updatedAtLabel = workbench.snapshot
    ? formatDateTime(workbench.snapshot.fetchedAt, i18n.language)
    : t('providersPage.modelCatalog.notLoaded');

  const openCreate = useCallback(() => {
    const brand = activeBrand;
    setSheetState({ open: true, brand, mode: 'create', resource: null });
  }, [activeBrand]);

  const openView = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'detail',
      resource,
      focusFailureHistory: false,
    });
  }, []);

  const openFailureHistory = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'detail',
      resource,
      focusFailureHistory: true,
    });
  }, []);

  const openEdit = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'edit',
      resource,
      focusFailureHistory: false,
    });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetState((s) => ({ ...s, open: false }));
  }, []);

  const clearCredentialGroupFilter = useCallback(() => {
    const proceed =
      sheetState.open && sheetRef.current
        ? sheetRef.current.confirmDiscardIfDirty()
        : Promise.resolve(true);
    void proceed.then((confirmed) => {
      if (!confirmed) return;
      setSearchParams(clearCredentialGroupFilterParams(searchParams));
      closeSheet();
    });
  }, [closeSheet, searchParams, setSearchParams, sheetState.open]);

  const handleDelete = useCallback(
    (resource: ProviderResource) => {
      const name = resource.name ?? resource.apiKeyPreview ?? resource.identifier ?? '';
      showConfirmation({
        title: t('providersPage.delete.title'),
        message: t('providersPage.delete.confirm', { name }),
        variant: 'danger',
        confirmText: t('providersPage.actions.delete'),
        onConfirm: async () => {
          try {
            await workbench.deleteProvider(resource);
            showNotification(t('providersPage.toast.deleted'), 'success');
          } catch (err) {
            if (isSponsorPartialMutationError(err)) {
              showNotification(t('providersPage.sponsor.partialMutationWarning'), 'warning');
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            showNotification(`${t('notification.delete_failed')}: ${msg}`, 'error');
          }
        },
      });
    },
    [showConfirmation, showNotification, t, workbench]
  );

  const handleToggleDisabled = useCallback(
    async (resource: ProviderResource, disabled: boolean) => {
      try {
        await workbench.toggleDisabled(resource, disabled);
        showNotification(
          disabled ? t('providersPage.toast.disabled') : t('providersPage.toast.enabled'),
          'success'
        );
      } catch (err) {
        if (isSponsorPartialMutationError(err)) {
          showNotification(t('providersPage.sponsor.partialMutationWarning'), 'warning');
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        showNotification(`${t('providersPage.toast.toggleFailed')}: ${msg}`, 'error');
      }
    },
    [showNotification, t, workbench]
  );

  const handleCreated = useCallback(() => {
    showNotification(t('providersPage.toast.created'), 'success');
    closeSheet();
  }, [closeSheet, showNotification, t]);

  const handleUpdated = useCallback(() => {
    showNotification(t('providersPage.toast.updated'), 'success');
    closeSheet();
  }, [closeSheet, showNotification, t]);

  // Loading state
  if (!workbench.snapshot && workbench.isPending) {
    return (
      <div className={styles.page}>
        <Skeleton height={120} />
        <div className={styles.layout}>
          <Skeleton height={420} />
          <Skeleton height={420} />
        </div>
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className={styles.page}>
        <ProviderHeaderCard
          totalActive={0}
          totalResources={0}
          providerFamilies={0}
          updatedAtLabel={updatedAtLabel}
          isFetching={workbench.isFetching}
          onRefresh={() => void handleRefresh()}
          onNew={() => {}}
          isNewDisabled
        />
        <CredentialConcurrencyDefaultControl />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ProviderHeaderCard
        totalActive={totalActive}
        totalResources={totalResources}
        providerFamilies={providerFamilies}
        updatedAtLabel={updatedAtLabel}
        isFetching={workbench.isFetching}
        isNewDisabled={disableMutations || credentialGroupFilterState === 'stale'}
        newLabel={t('providersPage.actions.new')}
        onRefresh={() => void handleRefresh()}
        onNew={openCreate}
      />
      <CredentialConcurrencyDefaultControl />

      {credentialGroupFilter ? (
        <section
          className={styles.groupFilterNotice}
          data-state={credentialGroupFilterState}
          aria-live="polite"
        >
          <div className={styles.groupFilterCopy}>
            <span className={styles.groupFilterLabel}>{t('providersPage.groupFilter.label')}</span>
            <strong className={styles.groupFilterName}>{canonicalCredentialGroup}</strong>
            <p className={styles.groupFilterMessage}>{credentialGroupFilterMessage}</p>
          </div>
          <button
            type="button"
            className={styles.groupFilterClear}
            onClick={clearCredentialGroupFilter}
          >
            <IconX size={16} />
            <span>{t('providersPage.groupFilter.clear')}</span>
          </button>
        </section>
      ) : null}

      <div className={styles.layout}>
        <ProviderCategoryList
          groups={groups}
          activeBrand={activeGroup.id}
          onSelect={(brand) => {
            const isSwitching = sheetState.open && sheetState.brand !== brand;
            const proceed =
              isSwitching && sheetRef.current
                ? sheetRef.current.confirmDiscardIfDirty()
                : Promise.resolve(true);
            void proceed.then((ok) => {
              if (!ok) return;
              setActiveBrand(brand);
              if (isSwitching) {
                closeSheet();
              }
            });
          }}
        />
        <ProviderResourcePanel
          group={activeGroup}
          filter={filter}
          onFilterChange={(value) => updateActiveFilterState({ filter: value })}
          filteredResources={visibleResources}
          selectedId={sheetState.open ? (sheetState.resource?.id ?? null) : null}
          disableMutations={disableMutations}
          usageByProvider={usageByProvider}
          billingProbeEntriesByResource={billingProbes.entriesByResource}
          imageRouteResources={imageRouteResources}
          onRefreshBillingProbe={billingProbes.refreshTarget}
          recoveringSupplierIds={billingProbes.recoveringSupplierIds}
          onRecoverSuppliers={handleRecoverSuppliers}
          toolbarControls={toolbarControls}
          emptyText={
            credentialGroupFilter
              ? activeGroup.resources.length === 0 && totalResources > 0
                ? t('providersPage.groupFilter.providerEmpty', {
                    group: canonicalCredentialGroup,
                  })
                : credentialGroupFilterMessage
              : undefined
          }
          showEmptyAction={!credentialGroupFilter}
          onView={openView}
          onViewFailures={openFailureHistory}
          onEdit={openEdit}
          onDelete={handleDelete}
          onToggleDisabled={handleToggleDisabled}
          onCreate={openCreate}
        />
      </div>

      <ProviderSheet
        ref={sheetRef}
        state={sheetState}
        onClose={closeSheet}
        onSwitchToEdit={() => {
          setSheetState((s) => (s.resource ? { ...s, mode: 'edit' } : s));
        }}
        workbench={workbench}
        onCreated={handleCreated}
        onUpdated={handleUpdated}
        mutationDisabled={disableMutations}
        imageRouteResources={imageRouteResources}
        usageByProvider={usageByProvider}
        billingProbeEntries={
          sheetState.resource
            ? billingProbes.entriesByResource[
                supplierBillingResourceKey(
                  sheetState.resource.brand,
                  sheetState.resource.originalIndex
                )
              ]
            : undefined
        }
        onRefreshBillingProbe={billingProbes.refreshTarget}
      />
    </div>
  );
}
