import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, proxyPoolsApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import type {
  AuthFileBatchDeleteResult,
  AuthFileSessionValidationResult,
} from '@/services/api/authFiles';
import { useAuthInventoryStore, useNotificationStore } from '@/stores';
import type { AuthFileItem, ProxyPoolStatusEntry, ProxySelection } from '@/types';
import { formatFileSize } from '@/utils/format';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
import { downloadBlob } from '@/utils/download';
import {
  getTypeLabel,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import {
  emptyAuthFileProxyInspection,
  inspectAuthFileProxyUploads,
  loadingAuthFileProxyInspection,
  type AuthFileProxyInspection,
} from '@/features/authFiles/proxyUploadInspection';
import { resolveDefaultImportProxySelection } from '@/features/authFiles/proxySelectionDefault';
import { normalizeCredentialGroups } from '@/utils/credentialGroups';
import { isRecord } from '@/utils/helpers';

type DeleteAllOptions = {
  filter: string;
  problemOnly: boolean;
  disabledOnly: boolean;
  enabledOnly: boolean;
  onResetFilterToAll: () => void;
  onResetProblemOnly: () => void;
  onResetDisabledOnly: () => void;
  onResetEnabledOnly: () => void;
};

type PendingUploadSource = 'file' | 'session';

export type AuthFileGroupAssignmentSource = PendingUploadSource | 'oauth';

export interface AuthFileGroupAssignmentTarget {
  name: string;
  type?: string;
  provider?: string;
  groups: string[];
}

export interface AuthFileGroupAssignmentState {
  source: AuthFileGroupAssignmentSource;
  targets: AuthFileGroupAssignmentTarget[];
}

type BeginFileImportOptions = {
  source?: PendingUploadSource;
};

export type SessionImportFailurePhase = 'validation' | 'upload';

export interface SessionImportFailure {
  name: string;
  phase: SessionImportFailurePhase;
  reason: string;
}

export interface SessionImportResult {
  total: number;
  validated: number;
  imported: number;
  failed: number;
  failures: SessionImportFailure[];
}

export type UseAuthFilesDataResult = {
  files: AuthFileItem[];
  selectedFiles: Set<string>;
  selectionCount: number;
  loading: boolean;
  error: string;
  uploading: boolean;
  deleting: string | null;
  deletingAll: boolean;
  statusUpdating: Record<string, boolean>;
  batchStatusUpdating: boolean;
  uploadProxyDialogOpen: boolean;
  uploadProxySelection: ProxySelection;
  uploadProxyPools: ProxyPoolStatusEntry[];
  uploadProxyPoolsLoading: boolean;
  uploadProxyInspection: AuthFileProxyInspection;
  sessionImportResult: SessionImportResult | null;
  groupAssignment: AuthFileGroupAssignmentState | null;
  groupAssigning: boolean;
  groupAssignmentError: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFiles: (fresh?: boolean) => Promise<AuthFileItem[]>;
  beginFileImport: (files: File[], options?: BeginFileImportOptions) => boolean;
  handleUploadClick: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDelete: (name: string) => void;
  handleDeleteAll: (options: DeleteAllOptions) => void;
  handleDownload: (name: string) => Promise<void>;
  handleStatusToggle: (item: AuthFileItem, enabled: boolean) => Promise<void>;
  toggleSelect: (name: string) => void;
  selectAllVisible: (visibleFiles: AuthFileItem[]) => void;
  invertVisibleSelection: (visibleFiles: AuthFileItem[]) => void;
  deselectAll: () => void;
  batchDownload: (names: string[]) => Promise<void>;
  batchSetStatus: (names: string[], enabled: boolean) => Promise<void>;
  batchDelete: (names: string[]) => void;
  setUploadProxySelection: (selection: ProxySelection) => void;
  refreshUploadProxyPools: () => Promise<void>;
  confirmUploadProxySelection: () => Promise<void>;
  cancelUploadProxySelection: () => void;
  clearSessionImportResult: () => void;
  openCredentialGroupAssignment: (
    targets: AuthFileItem[],
    source?: AuthFileGroupAssignmentSource
  ) => void;
  closeCredentialGroupAssignment: () => void;
  confirmCredentialGroupAssignment: (groups: string[]) => Promise<void>;
};

const SESSION_IMPORT_BATCH_SIZE = 5;

const chunkFiles = (files: File[], size: number): File[][] => {
  const chunks: File[][] = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
};

const getErrorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Unknown error';

const unresolvedDeleteCount = (result: AuthFileBatchDeleteResult): number =>
  result.pending.length + result.conflicts.length + result.failed.length;

const normalizeAssignmentTargets = (targets: AuthFileItem[]): AuthFileGroupAssignmentTarget[] => {
  const normalized: AuthFileGroupAssignmentTarget[] = [];
  const seen = new Set<string>();

  targets.forEach((target) => {
    const name = String(target.name ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    normalized.push({
      name,
      type: typeof target.type === 'string' ? target.type : undefined,
      provider: typeof target.provider === 'string' ? target.provider : undefined,
      groups: normalizeCredentialGroups(target.groups),
    });
  });

  return normalized;
};

const resolveAssignmentTargetsByName = (names: string[], files: AuthFileItem[]): AuthFileItem[] => {
  const byName = new Map(files.map((file) => [file.name, file]));
  return names
    .map((name) => {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) return null;
      return byName.get(trimmed) ?? ({ name: trimmed, groups: [] } satisfies AuthFileItem);
    })
    .filter(Boolean) as AuthFileItem[];
};

const uniqueNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
};

const rewriteSessionAuthFileProxy = async (file: File, proxyURL: string): Promise<File> => {
  const parsed = JSON.parse(await file.text()) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('JSON must be an object');
  }

  const normalizedProxyURL = proxyURL.trim();
  if (normalizedProxyURL) {
    parsed.proxy_url = normalizedProxyURL;
  } else {
    delete parsed.proxy_url;
  }
  delete parsed.proxyUrl;

  return new File([`${JSON.stringify(parsed, null, 2)}\n`], file.name, {
    type: file.type || 'application/json',
  });
};

const resolveSessionUploadFiles = async (
  batch: File[],
  validation: AuthFileSessionValidationResult,
  selection: ProxySelection
): Promise<{ files: File[]; selection: ProxySelection }> => {
  const validNames = new Set(validation.files);
  const fallbackFiles = batch.filter((file) => validNames.has(file.name));
  if (validation.resolved.length === 0) {
    return { files: fallbackFiles, selection };
  }

  const filesByName = new Map<string, File[]>();
  batch.forEach((file) => {
    const queue = filesByName.get(file.name);
    if (queue) {
      queue.push(file);
    } else {
      filesByName.set(file.name, [file]);
    }
  });

  const resolvedFiles: File[] = [];
  for (const resolved of validation.resolved) {
    const file = filesByName.get(resolved.name)?.shift();
    if (!file) continue;
    if (selection.mode === 'direct') {
      resolvedFiles.push(file);
      continue;
    }
    if (!resolved.proxyUrl) {
      return { files: fallbackFiles, selection };
    }
    resolvedFiles.push(await rewriteSessionAuthFileProxy(file, resolved.proxyUrl));
  }

  if (resolvedFiles.length !== validation.validated) {
    return { files: fallbackFiles, selection };
  }
  return {
    files: resolvedFiles,
    selection: selection.mode === 'direct' ? selection : { mode: 'file' },
  };
};

export function useAuthFilesData(): UseAuthFilesDataResult {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();

  const files = useAuthInventoryStore((state) => state.files);
  const setFiles = useAuthInventoryStore((state) => state.setFiles);
  const refreshAuthFiles = useAuthInventoryStore((state) => state.refresh);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploadProxyDialogOpen, setUploadProxyDialogOpen] = useState(false);
  const [uploadProxySelection, setUploadProxySelection] = useState<ProxySelection>({
    mode: 'file',
  });
  const [uploadProxyPools, setUploadProxyPools] = useState<ProxyPoolStatusEntry[]>([]);
  const [uploadProxyPoolsLoading, setUploadProxyPoolsLoading] = useState(false);
  const [uploadProxyInspection, setUploadProxyInspection] = useState<AuthFileProxyInspection>(() =>
    emptyAuthFileProxyInspection()
  );
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pendingUploadSource, setPendingUploadSource] = useState<PendingUploadSource>('file');
  const [sessionImportResult, setSessionImportResult] = useState<SessionImportResult | null>(null);
  const [groupAssignment, setGroupAssignment] = useState<AuthFileGroupAssignmentState | null>(null);
  const [groupAssigning, setGroupAssigning] = useState(false);
  const [groupAssignmentError, setGroupAssignmentError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchStatusPendingRef = useRef(false);
  const uploadProxyInspectionSeqRef = useRef(0);
  const uploadProxySelectionTouchedRef = useRef(false);
  const filesRef = useRef<AuthFileItem[]>([]);
  const pendingUploadGroupNamesRef = useRef<string[]>([]);
  const selectionCount = selectedFiles.size;

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const toggleSelect = useCallback((name: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((visibleFiles: AuthFileItem[]) => {
    const nextSelected = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => file.name);
    if (nextSelected.length === 0) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      nextSelected.forEach((name) => next.add(name));
      return next;
    });
  }, []);

  const invertVisibleSelection = useCallback((visibleFiles: AuthFileItem[]) => {
    const visibleNames = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => file.name);
    if (visibleNames.length === 0) return;

    setSelectedFiles((prev) => {
      const next = new Set(prev);
      visibleNames.forEach((name) => {
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
      });
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const applyDeletedFiles = useCallback(
    (names: string[]) => {
      const deletedNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
      if (deletedNames.length === 0) return;

      const deletedSet = new Set(deletedNames);
      setFiles((prev) => prev.filter((file) => !deletedSet.has(file.name)));
      setSelectedFiles((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set<string>();
        prev.forEach((name) => {
          if (deletedSet.has(name)) {
            changed = true;
          } else {
            next.add(name);
          }
        });
        return changed ? next : prev;
      });
    },
    [setFiles]
  );

  useEffect(() => {
    if (selectedFiles.size === 0) return;
    const existingNames = new Set(files.map((file) => file.name));
    setSelectedFiles((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (existingNames.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [files, selectedFiles.size]);

  const loadFiles = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setError('');
      try {
        await refreshAuthFiles(fresh);
        const nextFiles = useAuthInventoryStore.getState().files;
        filesRef.current = nextFiles;
        return nextFiles;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
        setError(errorMessage);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [refreshAuthFiles, t]
  );

  const refreshUploadProxyPools = useCallback(async () => {
    setUploadProxyPoolsLoading(true);
    try {
      setUploadProxyPools(await proxyPoolsApi.loadStatus());
    } catch {
      setUploadProxyPools([]);
    } finally {
      setUploadProxyPoolsLoading(false);
    }
  }, []);

  const inspectUploadProxyFiles = useCallback(async (validFiles: File[]) => {
    const seq = uploadProxyInspectionSeqRef.current + 1;
    uploadProxyInspectionSeqRef.current = seq;
    setUploadProxyInspection(loadingAuthFileProxyInspection(validFiles.length));

    const poolComparison = proxyPoolsApi
      .load()
      .then((snapshot) => ({ pools: snapshot.pools }))
      .catch(() => ({ pools: [], compareFailed: true }));
    const inspection = await inspectAuthFileProxyUploads(validFiles, poolComparison);
    if (uploadProxyInspectionSeqRef.current !== seq) return null;
    setUploadProxyInspection(inspection);
    return inspection;
  }, []);

  const changeUploadProxySelection = useCallback((selection: ProxySelection) => {
    uploadProxySelectionTouchedRef.current = true;
    setUploadProxySelection(selection);
  }, []);

  const openCredentialGroupAssignment = useCallback(
    (targets: AuthFileItem[], source: AuthFileGroupAssignmentSource = 'file') => {
      const normalizedTargets = normalizeAssignmentTargets(targets);
      if (normalizedTargets.length === 0) return;
      setGroupAssignment({ source, targets: normalizedTargets });
      setGroupAssignmentError('');
    },
    []
  );

  const openCredentialGroupAssignmentByNames = useCallback(
    (names: string[], source: AuthFileGroupAssignmentSource) => {
      const targets = resolveAssignmentTargetsByName(uniqueNames(names), filesRef.current);
      openCredentialGroupAssignment(targets, source);
    },
    [openCredentialGroupAssignment]
  );

  const addPendingUploadGroupNames = useCallback((names: string[]) => {
    pendingUploadGroupNamesRef.current = uniqueNames([
      ...pendingUploadGroupNamesRef.current,
      ...names,
    ]);
  }, []);

  const flushPendingUploadGroupAssignment = useCallback(
    (source: AuthFileGroupAssignmentSource) => {
      const names = pendingUploadGroupNamesRef.current;
      pendingUploadGroupNamesRef.current = [];
      if (names.length === 0) return;
      openCredentialGroupAssignmentByNames(names, source);
    },
    [openCredentialGroupAssignmentByNames]
  );

  const closeCredentialGroupAssignment = useCallback(() => {
    if (groupAssigning) return;
    setGroupAssignment(null);
    setGroupAssignmentError('');
  }, [groupAssigning]);

  const confirmCredentialGroupAssignment = useCallback(
    async (groups: string[]) => {
      if (!groupAssignment || groupAssigning) return;
      const targetGroups = normalizeCredentialGroups(groups);
      const targets = groupAssignment.targets;
      if (targets.length === 0) {
        setGroupAssignment(null);
        return;
      }

      setGroupAssigning(true);
      setGroupAssignmentError('');
      try {
        const results = await Promise.allSettled(
          targets.map((target) => authFilesApi.patchFields(target.name, { groups: targetGroups }))
        );
        const failed = results
          .map((result, index) => ({ result, target: targets[index] }))
          .filter((entry) => entry.result.status === 'rejected');
        const successCount = results.length - failed.length;

        if (successCount > 0) {
          await loadFiles(true);
        }

        if (failed.length > 0) {
          const details = failed
            .slice(0, 5)
            .map((entry) => {
              const reason =
                entry.result.status === 'rejected' ? getErrorMessage(entry.result.reason) : '';
              return `${entry.target.name}: ${reason}`;
            })
            .join('; ');
          const suffix =
            failed.length > 5
              ? t('auth_files.group_assignment_failed_more', {
                  defaultValue: '，另有 {{count}} 项失败',
                  count: failed.length - 5,
                })
              : '';
          const message = `${t('auth_files.group_assignment_failed', {
            defaultValue: '分组写入失败',
          })}: ${details}${suffix}`;
          setGroupAssignmentError(message);
          showNotification(message, successCount > 0 ? 'warning' : 'error');
          return;
        }

        showNotification(
          t('auth_files.group_assignment_success', {
            defaultValue: '已更新 {{count}} 个凭证的分组',
            count: targets.length,
          }),
          'success'
        );
        setGroupAssignment(null);
      } finally {
        setGroupAssigning(false);
      }
    },
    [groupAssignment, groupAssigning, loadFiles, showNotification, t]
  );

  const uploadFilesWithSelection = useCallback(
    async (validFiles: File[], selection: ProxySelection) => {
      setUploading(true);
      try {
        const result = await authFilesApi.uploadFiles(validFiles, selection);
        const successCount = result.uploaded;

        if (successCount > 0) {
          const failedNames = new Set(result.failed.map((item) => item.name).filter(Boolean));
          const uploadedNames =
            result.files.length > 0
              ? result.files
              : validFiles
                  .filter((file) => !failedNames.has(file.name))
                  .slice(0, successCount)
                  .map((file) => file.name);
          const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
          showNotification(
            `${t('auth_files.upload_success')}${suffix}`,
            result.failed.length ? 'warning' : 'success'
          );
          await loadFiles(true);
          addPendingUploadGroupNames(uploadedNames);
          if (selection.mode === 'file') {
            await refreshUploadProxyPools();
          }
        }

        if (result.failed.length > 0) {
          const details = result.failed.map((item) => `${item.name}: ${item.error}`).join('; ');
          showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
        }

        if (result.failed.length === 0) {
          return [];
        }
        const failedNames = new Set(result.failed.map((item) => item.name).filter(Boolean));
        return failedNames.size > 0
          ? validFiles.filter((file) => failedNames.has(file.name))
          : validFiles;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '未知错误';
        showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
        return validFiles;
      } finally {
        setUploading(false);
      }
    },
    [addPendingUploadGroupNames, loadFiles, refreshUploadProxyPools, showNotification, t]
  );

  const validateAndUploadSessionFiles = useCallback(
    async (validFiles: File[], selection: ProxySelection) => {
      setUploading(true);
      const failures: SessionImportFailure[] = [];
      let validatedCount = 0;
      let importedCount = 0;
      const importedNames: string[] = [];

      try {
        const missingValidationResult = t('auth_files.session_validation_missing_result', {
          defaultValue: '后端未返回验活结果',
        });
        const missingUploadResult = t('auth_files.session_upload_missing_result', {
          defaultValue: '后端未返回导入结果',
        });

        for (const batch of chunkFiles(validFiles, SESSION_IMPORT_BATCH_SIZE)) {
          let filesToUpload: File[] = [];
          let uploadSelection = selection;

          try {
            const validation = await authFilesApi.validateSessionFiles(batch, selection);
            const validNames = new Set(validation.files);
            const validationFailedNames = new Set(
              validation.failed.map((item) => item.name).filter(Boolean)
            );
            const resolvedUpload = await resolveSessionUploadFiles(batch, validation, selection);
            filesToUpload = resolvedUpload.files;
            uploadSelection = resolvedUpload.selection;
            validatedCount += filesToUpload.length;

            validation.failed.forEach((item) => {
              failures.push({
                name: item.name || '-',
                phase: 'validation',
                reason: item.error || 'Unknown error',
              });
            });
            batch.forEach((file) => {
              if (validNames.has(file.name) || validationFailedNames.has(file.name)) return;
              failures.push({
                name: file.name,
                phase: 'validation',
                reason: missingValidationResult,
              });
            });
          } catch (err: unknown) {
            const reason = getErrorMessage(err);
            batch.forEach((file) => {
              failures.push({ name: file.name, phase: 'validation', reason });
            });
            continue;
          }

          if (filesToUpload.length === 0) {
            continue;
          }

          try {
            const uploadResult = await authFilesApi.uploadFiles(filesToUpload, uploadSelection);
            const uploadedNames = new Set(uploadResult.files);
            const uploadFailedNames = new Set(
              uploadResult.failed.map((item) => item.name).filter(Boolean)
            );
            const uploadedCount =
              uploadedNames.size > 0
                ? filesToUpload.filter((file) => uploadedNames.has(file.name)).length
                : uploadResult.uploaded;
            importedCount += Math.min(uploadedCount, filesToUpload.length);
            if (uploadedNames.size > 0) {
              importedNames.push(...Array.from(uploadedNames));
            } else if (uploadedCount > 0) {
              importedNames.push(
                ...filesToUpload
                  .filter((file) => !uploadFailedNames.has(file.name))
                  .slice(0, uploadedCount)
                  .map((file) => file.name)
              );
            }

            uploadResult.failed.forEach((item) => {
              failures.push({
                name: item.name || '-',
                phase: 'upload',
                reason: item.error || 'Unknown error',
              });
            });
            if (uploadedNames.size > 0) {
              filesToUpload.forEach((file) => {
                if (uploadedNames.has(file.name) || uploadFailedNames.has(file.name)) return;
                failures.push({
                  name: file.name,
                  phase: 'upload',
                  reason: missingUploadResult,
                });
              });
            } else {
              const knownFailureCount = filesToUpload.filter((file) =>
                uploadFailedNames.has(file.name)
              ).length;
              const missingFailureCount = Math.max(
                0,
                filesToUpload.length - uploadedCount - knownFailureCount
              );
              filesToUpload
                .filter((file) => !uploadFailedNames.has(file.name))
                .slice(0, missingFailureCount)
                .forEach((file) => {
                  failures.push({
                    name: file.name,
                    phase: 'upload',
                    reason: missingUploadResult,
                  });
                });
            }
          } catch (err: unknown) {
            const reason = getErrorMessage(err);
            filesToUpload.forEach((file) => {
              failures.push({ name: file.name, phase: 'upload', reason });
            });
          }
        }

        if (importedCount > 0) {
          await loadFiles(true);
          if (selection.mode === 'file') {
            await refreshUploadProxyPools();
          }
          openCredentialGroupAssignmentByNames(importedNames, 'session');
        }

        setSessionImportResult({
          total: validFiles.length,
          validated: validatedCount,
          imported: importedCount,
          failed: failures.length,
          failures,
        });
      } finally {
        setUploading(false);
      }
    },
    [loadFiles, openCredentialGroupAssignmentByNames, refreshUploadProxyPools, t]
  );

  const clearSessionImportResult = useCallback(() => {
    setSessionImportResult(null);
  }, []);

  const beginFileImport = useCallback(
    (filesToUpload: File[], options: BeginFileImportOptions = {}) => {
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];
      const oversizedFiles: string[] = [];

      filesToUpload.forEach((file) => {
        if (!file.name.endsWith('.json')) {
          invalidFiles.push(file.name);
          return;
        }
        if (file.size > MAX_AUTH_FILE_SIZE) {
          oversizedFiles.push(file.name);
          return;
        }
        validFiles.push(file);
      });

      if (invalidFiles.length > 0) {
        showNotification(t('auth_files.upload_error_json'), 'error');
      }
      if (oversizedFiles.length > 0) {
        showNotification(
          t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
          'error'
        );
      }

      if (validFiles.length === 0) {
        return false;
      }

      setPendingUploadFiles(validFiles);
      setPendingUploadSource(options.source ?? 'file');
      uploadProxySelectionTouchedRef.current = false;
      setUploadProxySelection({ mode: 'file' });
      void inspectUploadProxyFiles(validFiles).then((inspection) => {
        if (!inspection || uploadProxySelectionTouchedRef.current) return;
        setUploadProxySelection(resolveDefaultImportProxySelection(inspection.filesWithProxy));
      });
      setUploadProxyDialogOpen(true);
      void refreshUploadProxyPools();
      return true;
    },
    [inspectUploadProxyFiles, refreshUploadProxyPools, showNotification, t]
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      beginFileImport(Array.from(fileList));
      event.target.value = '';
    },
    [beginFileImport]
  );

  const handleDelete = useCallback(
    (name: string) => {
      showConfirmation({
        title: t('auth_files.delete_title', { defaultValue: 'Delete File' }),
        message: `${t('auth_files.delete_confirm')} "${name}" ?`,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeleting(name);
          try {
            const result = await authFilesApi.deleteFile(name);
            applyDeletedFiles(result.files);
            if (unresolvedDeleteCount(result) === 0) {
              showNotification(t('auth_files.delete_success'), 'success');
            } else {
              showNotification(
                t('auth_files.delete_pending_result', {
                  defaultValue:
                    '已删除 {{deleted}} 项，待重试 {{pending}} 项，需确认 {{conflicts}} 项，失败 {{failed}} 项',
                  deleted: result.deleted,
                  pending: result.pending.length,
                  conflicts: result.conflicts.length,
                  failed: result.failed.length,
                }),
                'warning'
              );
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeleting(null);
          }
        },
      });
    },
    [applyDeletedFiles, showConfirmation, showNotification, t]
  );

  const handleDeleteAll = useCallback(
    (deleteAllOptions: DeleteAllOptions) => {
      const {
        filter,
        problemOnly,
        disabledOnly,
        enabledOnly,
        onResetFilterToAll,
        onResetProblemOnly,
        onResetDisabledOnly,
        onResetEnabledOnly,
      } = deleteAllOptions;
      const isFiltered = filter !== 'all';
      const isProblemOnly = problemOnly === true;
      const isDisabledOnly = disabledOnly === true;
      const isEnabledOnly = enabledOnly === true;
      const typeLabel = isFiltered ? getTypeLabel(t, filter) : t('auth_files.filter_all');
      let confirmMessage = t('auth_files.delete_all_confirm');
      if (isDisabledOnly || isEnabledOnly) {
        confirmMessage = t('auth_files.delete_filtered_result_confirm');
      } else if (isProblemOnly) {
        confirmMessage = isFiltered
          ? t('auth_files.delete_problem_filtered_confirm', { type: typeLabel })
          : t('auth_files.delete_problem_confirm');
      } else if (isFiltered) {
        confirmMessage = t('auth_files.delete_filtered_confirm', { type: typeLabel });
      }

      showConfirmation({
        title: t('auth_files.delete_all_title', { defaultValue: 'Delete All Files' }),
        message: confirmMessage,
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeletingAll(true);
          try {
            if (!isFiltered && !isProblemOnly && !isDisabledOnly && !isEnabledOnly) {
              const result = await authFilesApi.deleteAll();
              applyDeletedFiles(result.files);
              if (unresolvedDeleteCount(result) === 0) {
                showNotification(t('auth_files.delete_all_success'), 'success');
              } else {
                showNotification(
                  t('auth_files.delete_pending_result', {
                    defaultValue:
                      '已删除 {{deleted}} 项，待重试 {{pending}} 项，需确认 {{conflicts}} 项，失败 {{failed}} 项',
                    deleted: result.deleted,
                    pending: result.pending.length,
                    conflicts: result.conflicts.length,
                    failed: result.failed.length,
                  }),
                  'warning'
                );
              }
              deselectAll();
            } else {
              const filesToDelete = files.filter((file) => {
                if (isRuntimeOnlyAuthFile(file)) return false;
                if (
                  isFiltered &&
                  normalizeProviderKey(String(file.type ?? file.provider ?? '')) !== filter
                ) {
                  return false;
                }
                if (isProblemOnly && !hasAuthFileStatusMessage(file)) return false;
                if (isDisabledOnly && file.disabled !== true) return false;
                if (isEnabledOnly && file.disabled === true) return false;
                return true;
              });

              if (filesToDelete.length === 0) {
                let emptyMessage = t('auth_files.delete_filtered_none', { type: typeLabel });
                if (isDisabledOnly || isEnabledOnly) {
                  emptyMessage = t('auth_files.delete_filtered_result_none');
                } else if (isProblemOnly) {
                  emptyMessage = isFiltered
                    ? t('auth_files.delete_problem_filtered_none', { type: typeLabel })
                    : t('auth_files.delete_problem_none');
                }
                showNotification(emptyMessage, 'info');
                setDeletingAll(false);
                return;
              }

              const result = await authFilesApi.deleteFiles(filesToDelete.map((file) => file.name));
              const success = result.deleted;
              const failed = unresolvedDeleteCount(result);

              applyDeletedFiles(result.files);

              if (failed === 0 && (isDisabledOnly || isEnabledOnly)) {
                showNotification(
                  t('auth_files.delete_filtered_result_success', { count: success }),
                  'success'
                );
              } else if (failed === 0 && isProblemOnly) {
                showNotification(
                  isFiltered
                    ? t('auth_files.delete_problem_filtered_success', {
                        count: success,
                        type: typeLabel,
                      })
                    : t('auth_files.delete_problem_success', { count: success }),
                  'success'
                );
              } else if (failed === 0) {
                showNotification(
                  t('auth_files.delete_filtered_success', { count: success, type: typeLabel }),
                  'success'
                );
              } else if (isDisabledOnly || isEnabledOnly) {
                showNotification(
                  t('auth_files.delete_filtered_result_partial', { success, failed }),
                  'warning'
                );
              } else if (isProblemOnly) {
                showNotification(
                  isFiltered
                    ? t('auth_files.delete_problem_filtered_partial', {
                        success,
                        failed,
                        type: typeLabel,
                      })
                    : t('auth_files.delete_problem_partial', { success, failed }),
                  'warning'
                );
              } else {
                showNotification(
                  t('auth_files.delete_filtered_partial', { success, failed, type: typeLabel }),
                  'warning'
                );
              }

              if (isFiltered) {
                onResetFilterToAll();
              }
              if (isProblemOnly) {
                onResetProblemOnly();
              }
              if (isDisabledOnly) {
                onResetDisabledOnly();
              }
              if (isEnabledOnly) {
                onResetEnabledOnly();
              }
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeletingAll(false);
          }
        },
      });
    },
    [applyDeletedFiles, deselectAll, files, showConfirmation, showNotification, t]
  );

  const handleDownload = useCallback(
    async (name: string) => {
      try {
        const response = await apiClient.getRaw(
          `/auth-files/download?name=${encodeURIComponent(name)}`,
          { responseType: 'blob' }
        );
        const blob = new Blob([response.data]);
        downloadBlob({ filename: name, blob });
        showNotification(t('auth_files.download_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
      }
    },
    [showNotification, t]
  );

  const handleStatusToggle = useCallback(
    async (item: AuthFileItem, enabled: boolean) => {
      const name = item.name;
      const nextDisabled = !enabled;
      const previousDisabled = item.disabled === true;

      setStatusUpdating((prev) => ({ ...prev, [name]: true }));
      setFiles((prev) => prev.map((f) => (f.name === name ? { ...f, disabled: nextDisabled } : f)));

      try {
        const res = await authFilesApi.setStatus(name, nextDisabled);
        setFiles((prev) =>
          prev.map((f) => (f.name === name ? { ...f, disabled: res.disabled } : f))
        );
        showNotification(
          enabled
            ? t('auth_files.status_enabled_success', { name })
            : t('auth_files.status_disabled_success', { name }),
          'success'
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setFiles((prev) =>
          prev.map((f) => (f.name === name ? { ...f, disabled: previousDisabled } : f))
        );
        showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      } finally {
        setStatusUpdating((prev) => {
          if (!prev[name]) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    },
    [setFiles, showNotification, t]
  );

  const batchSetStatus = useCallback(
    async (names: string[], enabled: boolean) => {
      if (batchStatusPendingRef.current) return;

      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;
      if (uniqueNames.some((name) => statusUpdating[name] === true)) return;

      const originalDisabled = new Map(
        files
          .filter((file) => uniqueNames.includes(file.name))
          .map((file) => [file.name, file.disabled === true])
      );
      const targetNames = new Set(originalDisabled.keys());
      const targetNameList = Array.from(targetNames);
      if (targetNameList.length === 0) return;

      const nextDisabled = !enabled;

      batchStatusPendingRef.current = true;
      setBatchStatusUpdating(true);
      setStatusUpdating((prev) => {
        const next = { ...prev };
        targetNameList.forEach((name) => {
          next[name] = true;
        });
        return next;
      });
      setFiles((prev) =>
        prev.map((file) =>
          targetNames.has(file.name) ? { ...file, disabled: nextDisabled } : file
        )
      );

      try {
        const results = await Promise.allSettled(
          targetNameList.map((name) => authFilesApi.setStatus(name, nextDisabled))
        );

        let successCount = 0;
        let failCount = 0;
        const failedNames = new Set<string>();
        const confirmedDisabled = new Map<string, boolean>();

        results.forEach((result, index) => {
          const name = targetNameList[index];
          if (result.status === 'fulfilled') {
            successCount++;
            confirmedDisabled.set(name, result.value.disabled);
          } else {
            failCount++;
            failedNames.add(name);
          }
        });

        setFiles((prev) =>
          prev.map((file) => {
            if (failedNames.has(file.name)) {
              return { ...file, disabled: originalDisabled.get(file.name) === true };
            }
            if (confirmedDisabled.has(file.name)) {
              return { ...file, disabled: confirmedDisabled.get(file.name) };
            }
            return file;
          })
        );

        if (failCount === 0) {
          showNotification(
            t('auth_files.batch_status_success', { count: successCount }),
            'success'
          );
        } else {
          showNotification(
            t('auth_files.batch_status_partial', { success: successCount, failed: failCount }),
            'warning'
          );
        }

        deselectAll();
      } finally {
        batchStatusPendingRef.current = false;
        setBatchStatusUpdating(false);
        setStatusUpdating((prev) => {
          const next = { ...prev };
          targetNameList.forEach((name) => {
            delete next[name];
          });
          return next;
        });
      }
    },
    [deselectAll, files, setFiles, showNotification, statusUpdating, t]
  );

  const batchDownload = useCallback(
    async (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      let successCount = 0;
      let failCount = 0;

      for (const name of uniqueNames) {
        try {
          const response = await apiClient.getRaw(
            `/auth-files/download?name=${encodeURIComponent(name)}`,
            { responseType: 'blob' }
          );
          const blob = new Blob([response.data]);
          downloadBlob({ filename: name, blob });
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (failCount === 0) {
        showNotification(
          t('auth_files.batch_download_success', { count: successCount }),
          'success'
        );
      } else {
        showNotification(
          t('auth_files.batch_download_partial', { success: successCount, failed: failCount }),
          'warning'
        );
      }
    },
    [showNotification, t]
  );

  const batchDelete = useCallback(
    (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      showConfirmation({
        title: t('auth_files.batch_delete_title'),
        message: t('auth_files.batch_delete_confirm', { count: uniqueNames.length }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          try {
            const result = await authFilesApi.deleteFiles(uniqueNames);
            applyDeletedFiles(result.files);

            const unresolved = unresolvedDeleteCount(result);
            if (unresolved === 0) {
              showNotification(
                `${t('auth_files.delete_all_success')} (${result.deleted})`,
                'success'
              );
            } else {
              showNotification(
                t('auth_files.delete_filtered_partial', {
                  success: result.deleted,
                  failed: unresolved,
                  type: t('auth_files.filter_all'),
                }),
                'warning'
              );
            }
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          }
        },
      });
    },
    [applyDeletedFiles, showConfirmation, showNotification, t]
  );

  const cancelUploadProxySelection = useCallback(() => {
    if (uploading) return;
    const source = pendingUploadSource;
    uploadProxyInspectionSeqRef.current += 1;
    setPendingUploadFiles([]);
    setPendingUploadSource('file');
    uploadProxySelectionTouchedRef.current = false;
    setUploadProxyInspection(emptyAuthFileProxyInspection());
    setUploadProxyDialogOpen(false);
    flushPendingUploadGroupAssignment(source);
  }, [flushPendingUploadGroupAssignment, pendingUploadSource, uploading]);

  const confirmUploadProxySelection = useCallback(async () => {
    if (pendingUploadFiles.length === 0) {
      setUploadProxyDialogOpen(false);
      return;
    }
    const filesToUpload = pendingUploadFiles;
    const source = pendingUploadSource;
    setUploadProxyDialogOpen(false);
    setPendingUploadFiles([]);
    setPendingUploadSource('file');
    if (source === 'session') {
      await validateAndUploadSessionFiles(filesToUpload, uploadProxySelection);
      return;
    }
    const failedFiles = await uploadFilesWithSelection(filesToUpload, uploadProxySelection);
    if (failedFiles.length === 0) {
      setUploadProxyInspection(emptyAuthFileProxyInspection());
      flushPendingUploadGroupAssignment('file');
      return;
    }
    setPendingUploadFiles(failedFiles);
    void inspectUploadProxyFiles(failedFiles);
    setUploadProxyDialogOpen(true);
  }, [
    flushPendingUploadGroupAssignment,
    inspectUploadProxyFiles,
    pendingUploadFiles,
    pendingUploadSource,
    uploadFilesWithSelection,
    uploadProxySelection,
    validateAndUploadSessionFiles,
  ]);

  return {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    uploadProxyDialogOpen,
    uploadProxySelection,
    uploadProxyPools,
    uploadProxyPoolsLoading,
    uploadProxyInspection,
    sessionImportResult,
    groupAssignment,
    groupAssigning,
    groupAssignmentError,
    fileInputRef,
    loadFiles,
    beginFileImport,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
    setUploadProxySelection: changeUploadProxySelection,
    refreshUploadProxyPools,
    confirmUploadProxySelection,
    cancelUploadProxySelection,
    clearSessionImportResult,
    openCredentialGroupAssignment,
    closeCredentialGroupAssignment,
    confirmCredentialGroupAssignment,
  };
}
