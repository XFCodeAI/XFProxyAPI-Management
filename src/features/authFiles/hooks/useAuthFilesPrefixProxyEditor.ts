import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, type AuthFileFieldsPatch } from '@/services/api';
import type { AuthFileCredentialIdentity, AuthFileItem, ConcurrencyMode } from '@/types';
import { useAuthInventoryStore, useNotificationStore } from '@/stores';
import { normalizeProviderKey, parsePriorityValue } from '@/features/authFiles/constants';
import {
  applyAuthFileProviderFieldsPatch,
  buildAuthFileProviderFieldsPatch,
  readAuthFileWebsockets,
  readXAIAuthFileUsingAPI,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/authFileProviderFields';
import { normalizeCredentialGroups } from '@/utils/credentialGroups';
import {
  normalizeConcurrencySetting,
  parseOptionalMaxConcurrency,
  resolveAuthFileConcurrencySetting,
} from '@/utils/maxConcurrency';
import {
  authFileMatchesCredentialIdentity,
  isAuthFileIdentityChangedError,
  readAuthFileCredentialIdentity,
} from '@/features/authFiles/credentialIdentity';

type AuthFileHeaders = Record<string, string>;
type AuthFileHeadersErrorKey =
  | 'auth_files.headers_invalid_json'
  | 'auth_files.headers_invalid_object'
  | 'auth_files.headers_invalid_value';
type AuthFileContentErrorKey =
  'auth_files.prefix_proxy_invalid_json' | 'auth_files.prefix_proxy_html_challenge';

export type PrefixProxyEditorField =
  | 'prefix'
  | 'proxyUrl'
  | 'priority'
  | 'concurrencyMode'
  | 'maxConcurrency'
  | 'fallback'
  | 'disableCooling'
  | 'websockets'
  | 'usingApi'
  | 'note'
  | 'headersText';

export type PrefixProxyEditorFieldValue = string | boolean;

export type PrefixProxyEditorState = {
  fileName: string;
  credentialIdentity: AuthFileCredentialIdentity;
  fileInfoText: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  originalText: string;
  rawText: string;
  invalidContentPreview: string;
  json: Record<string, unknown> | null;
  providerKey: string;
  groups: string[];
  prefix: string;
  proxyUrl: string;
  priority: string;
  concurrencyMode: ConcurrencyMode;
  maxConcurrency: string;
  maxConcurrencyError: string | null;
  fallback: boolean;
  disableCooling: boolean;
  websockets: boolean;
  websocketsTouched: boolean;
  usingApi: boolean;
  usingApiTouched: boolean;
  note: string;
  noteTouched: boolean;
  headersText: string;
  headersTouched: boolean;
  headersError: string | null;
};

export type UseAuthFilesPrefixProxyEditorOptions = {
  disableControls: boolean;
};

export type UseAuthFilesPrefixProxyEditorResult = {
  prefixProxyEditor: PrefixProxyEditorState | null;
  prefixProxyUpdatedText: string;
  prefixProxyDirty: boolean;
  openPrefixProxyEditor: (file: AuthFileItem) => Promise<void>;
  closePrefixProxyEditor: () => void;
  handlePrefixProxyChange: (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => void;
  handlePrefixProxySave: () => Promise<void>;
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateHeadersValue = (value: unknown): AuthFileHeadersErrorKey | null => {
  if (!isRecordObject(value)) {
    return 'auth_files.headers_invalid_object';
  }
  return Object.values(value).every((item) => typeof item === 'string')
    ? null
    : 'auth_files.headers_invalid_value';
};

const parseHeadersText = (
  text: string
): { value: AuthFileHeaders | null; errorKey: AuthFileHeadersErrorKey | null } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, errorKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { value: null, errorKey: 'auth_files.headers_invalid_json' };
  }

  const errorKey = validateHeadersValue(parsed);
  if (errorKey) {
    return { value: null, errorKey };
  }

  return { value: parsed as AuthFileHeaders, errorKey: null };
};

const normalizeTextField = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
};

export const readAuthFileDisableCooling = (value: Record<string, unknown>): boolean => {
  for (const key of ['disable_cooling', 'disable-cooling'] as const) {
    const normalized = normalizeBooleanValue(value[key]);
    if (normalized !== undefined) return normalized;
  }
  return false;
};

const INVALID_CONTENT_PREVIEW_LIMIT = 1000;

const buildInvalidContentPreview = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= INVALID_CONTENT_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, INVALID_CONTENT_PREVIEW_LIMIT)}\n...`;
};

const buildInvalidAuthFileContentState = (
  text: string,
  resolveError: (key: AuthFileContentErrorKey) => string
): Pick<
  PrefixProxyEditorState,
  'loading' | 'error' | 'rawText' | 'originalText' | 'invalidContentPreview'
> => ({
  loading: false,
  error: resolveError(getAuthFileContentErrorKey(text)),
  rawText: text,
  originalText: text,
  invalidContentPreview: buildInvalidContentPreview(text),
});

const getAuthFileContentErrorKey = (text: string): AuthFileContentErrorKey => {
  const head = text.trimStart().slice(0, 4096).toLowerCase();
  const looksLikeHtml =
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<head') ||
    head.includes('<body');
  const looksLikeChallenge =
    head.includes('cf_chl') ||
    head.includes('__cf_chl_tk') ||
    head.includes('challenge-platform') ||
    head.includes('cloudflare');

  return looksLikeHtml || looksLikeChallenge
    ? 'auth_files.prefix_proxy_html_challenge'
    : 'auth_files.prefix_proxy_invalid_json';
};

const hasKeys = (value: Record<string, unknown> | AuthFileFieldsPatch | null): boolean =>
  Boolean(value && Object.keys(value).length > 0);

const normalizeHeaders = (value: unknown): AuthFileHeaders => {
  if (!isRecordObject(value)) return {};

  return Object.entries(value).reduce<AuthFileHeaders>((result, [key, rawValue]) => {
    if (typeof rawValue !== 'string') return result;
    const name = key.trim();
    const headerValue = rawValue.trim();
    if (!name || !headerValue) return result;
    result[name] = headerValue;
    return result;
  }, {});
};

const buildHeadersPatch = (
  originalHeaders: AuthFileHeaders,
  nextHeaders: AuthFileHeaders
): AuthFileHeaders | undefined => {
  const patch: AuthFileHeaders = {};
  const nextNames = new Set(Object.keys(nextHeaders));

  Object.entries(nextHeaders).forEach(([name, value]) => {
    if (originalHeaders[name] !== value) {
      patch[name] = value;
    }
  });

  Object.keys(originalHeaders).forEach((name) => {
    if (!nextNames.has(name)) {
      patch[name] = '';
    }
  });

  return Object.keys(patch).length > 0 ? patch : undefined;
};

const applyHeadersPatch = (
  value: Record<string, unknown>,
  headersPatch: AuthFileHeaders | undefined
) => {
  if (!headersPatch) return;

  const nextHeaders = normalizeHeaders(value.headers);
  Object.entries(headersPatch).forEach(([name, rawValue]) => {
    const headerName = name.trim();
    if (!headerName) return;
    const headerValue = rawValue.trim();
    if (!headerValue) {
      delete nextHeaders[headerName];
      return;
    }
    nextHeaders[headerName] = headerValue;
  });

  if (Object.keys(nextHeaders).length > 0) {
    value.headers = nextHeaders;
  } else {
    delete value.headers;
  }
};

export const buildAuthFileFieldsPatch = (
  editor: PrefixProxyEditorState,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string
): AuthFileFieldsPatch => {
  const original = editor.json ?? {};
  const patch: AuthFileFieldsPatch = {};

  const originalPrefix = normalizeTextField(original.prefix);
  const nextPrefix = editor.prefix.trim();
  if (nextPrefix !== originalPrefix) {
    patch.prefix = nextPrefix;
  }

  const originalProxyURL = normalizeTextField(original.proxy_url);
  const nextProxyURL = editor.proxyUrl.trim();
  if (nextProxyURL !== originalProxyURL) {
    patch.proxy_url = nextProxyURL;
  }

  const originalPriority = parsePriorityValue(original.priority);
  const priorityText = editor.priority.trim();
  const nextPriority = parsePriorityValue(priorityText);
  if (!priorityText) {
    if (originalPriority !== undefined && originalPriority !== 0) {
      patch.priority = 0;
    }
  } else if (nextPriority !== undefined) {
    if (nextPriority === 0) {
      if (originalPriority !== undefined && originalPriority !== 0) {
        patch.priority = 0;
      }
    } else if (nextPriority !== originalPriority) {
      patch.priority = nextPriority;
    }
  }

  const originalConcurrency = resolveAuthFileConcurrencySetting(original);
  const maxConcurrencyText = editor.maxConcurrency.trim();
  const parsedMaxConcurrency = parseOptionalMaxConcurrency(maxConcurrencyText);
  if (!parsedMaxConcurrency.valid) {
    throw new Error('AUTH_FILE_MAX_CONCURRENCY_INVALID');
  }
  const nextConcurrency = normalizeConcurrencySetting(
    editor.concurrencyMode,
    parsedMaxConcurrency.value ?? 0
  );
  if (
    nextConcurrency.mode !== originalConcurrency.mode ||
    nextConcurrency.maxConcurrency !== originalConcurrency.maxConcurrency
  ) {
    patch.concurrency_mode = nextConcurrency.mode;
    patch.max_concurrency = nextConcurrency.maxConcurrency;
  }

  const originalFallback = original.fallback === true;
  if (editor.fallback !== originalFallback) {
    patch.fallback = editor.fallback;
  }

  const originalDisableCooling = readAuthFileDisableCooling(original);
  if (editor.disableCooling !== originalDisableCooling) {
    patch.disable_cooling = editor.disableCooling;
  }

  if (editor.noteTouched) {
    const originalNote = normalizeTextField(original.note);
    const nextNote = editor.note.trim();
    if (nextNote !== originalNote) {
      patch.note = nextNote;
    }
  }

  Object.assign(
    patch,
    buildAuthFileProviderFieldsPatch({
      providerKey: editor.providerKey,
      original,
      websockets: editor.websockets,
      websocketsTouched: editor.websocketsTouched,
      usingApi: editor.usingApi,
      usingApiTouched: editor.usingApiTouched,
    })
  );

  if (editor.headersTouched) {
    const { value: parsedHeaders, errorKey } = parseHeadersText(editor.headersText);
    if (errorKey) {
      throw new Error(resolveHeadersError(errorKey));
    }
    const headersPatch = buildHeadersPatch(
      normalizeHeaders(original.headers),
      normalizeHeaders(parsedHeaders ?? {})
    );
    if (headersPatch) {
      patch.headers = headersPatch;
    }
  }

  return patch;
};

export const buildPrefixProxyUpdatedText = (
  editor: PrefixProxyEditorState | null,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string
): string => {
  if (!editor?.json) return editor?.rawText ?? '';
  const patch = buildAuthFileFieldsPatch(editor, resolveHeadersError);
  let next: Record<string, unknown> = { ...editor.json };

  if (patch.prefix !== undefined) {
    if (patch.prefix) {
      next.prefix = patch.prefix;
    } else {
      delete next.prefix;
    }
  }
  if (patch.proxy_url !== undefined) {
    if (patch.proxy_url) {
      next.proxy_url = patch.proxy_url;
    } else {
      delete next.proxy_url;
    }
  }

  if (patch.priority !== undefined) {
    if (patch.priority === 0) {
      delete next.priority;
    } else {
      next.priority = patch.priority;
    }
  }

  if (patch.concurrency_mode !== undefined || patch.max_concurrency !== undefined) {
    const concurrency = normalizeConcurrencySetting(
      patch.concurrency_mode ?? editor.concurrencyMode,
      patch.max_concurrency ?? editor.maxConcurrency
    );
    delete next['concurrency-mode'];
    delete next['max-concurrency'];
    next.concurrency_mode = concurrency.mode;
    if (concurrency.mode === 'independent') {
      next.max_concurrency = concurrency.maxConcurrency;
    } else {
      delete next.max_concurrency;
    }
  }

  if (patch.fallback !== undefined) {
    next.fallback = patch.fallback;
  }

  if (patch.disable_cooling !== undefined) {
    delete next['disable-cooling'];
    if (patch.disable_cooling) {
      next.disable_cooling = true;
    } else {
      delete next.disable_cooling;
    }
  }

  if (patch.note !== undefined) {
    if (patch.note) {
      next.note = patch.note;
    } else if ('note' in next) {
      delete next.note;
    }
  }

  applyHeadersPatch(next, patch.headers);

  next = applyAuthFileProviderFieldsPatch(next, patch);

  return JSON.stringify(next);
};

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const commitMutationVersion = useAuthInventoryStore((state) => state.commitMutationVersion);
  const refreshAuthInventory = useAuthInventoryStore((state) => state.refresh);

  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);
  const editorRequestIdRef = useRef(0);

  const hasBlockingValidationError = Boolean(
    (prefixProxyEditor?.headersTouched && prefixProxyEditor.headersError) ||
    prefixProxyEditor?.maxConcurrencyError
  );
  const prefixProxyUpdatedText =
    prefixProxyEditor && !hasBlockingValidationError
      ? buildPrefixProxyUpdatedText(prefixProxyEditor, (key) => t(key))
      : '';

  const prefixProxyPatch =
    prefixProxyEditor?.json && !hasBlockingValidationError
      ? buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key))
      : null;

  const prefixProxyDirty = hasKeys(prefixProxyPatch);

  const closePrefixProxyEditor = () => {
    editorRequestIdRef.current += 1;
    setPrefixProxyEditor(null);
  };

  const openPrefixProxyEditor = async (file: AuthFileItem) => {
    const name = file.name;
    const credentialIdentity = readAuthFileCredentialIdentity(file);
    const fileProviderKey = normalizeProviderKey(String(file.type ?? file.provider ?? ''));

    if (disableControls) return;
    if (prefixProxyEditor?.fileName === name) {
      editorRequestIdRef.current += 1;
      setPrefixProxyEditor(null);
      return;
    }
    const editorRequestId = editorRequestIdRef.current + 1;
    editorRequestIdRef.current = editorRequestId;

    setPrefixProxyEditor({
      fileName: name,
      credentialIdentity,
      fileInfoText: JSON.stringify(file, null, 2),
      loading: true,
      saving: false,
      error: null,
      originalText: '',
      rawText: '',
      invalidContentPreview: '',
      json: null,
      providerKey: fileProviderKey,
      groups: [],
      prefix: '',
      proxyUrl: '',
      priority: '',
      concurrencyMode: 'inherit',
      maxConcurrency: '0',
      maxConcurrencyError: null,
      fallback: false,
      disableCooling: false,
      websockets: false,
      websocketsTouched: false,
      usingApi: false,
      usingApiTouched: false,
      note: '',
      noteTouched: false,
      headersText: '',
      headersTouched: false,
      headersError: null,
    });

    try {
      const rawText = await authFilesApi.downloadText(name);
      if (editorRequestIdRef.current !== editorRequestId) return;
      const trimmed = rawText.trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            ...buildInvalidAuthFileContentState(rawText, (key) => t(key)),
          };
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            ...buildInvalidAuthFileContentState(rawText, (key) => t(key)),
          };
        });
        return;
      }

      const json = { ...(parsed as Record<string, unknown>) };
      const originalText = JSON.stringify(json);
      const providerKey = normalizeProviderKey(
        String(json.type ?? json.provider ?? file.type ?? file.provider ?? '')
      );
      const groups = normalizeCredentialGroups(json.groups);
      const prefix = typeof json.prefix === 'string' ? json.prefix : '';
      const proxyUrl = typeof json.proxy_url === 'string' ? json.proxy_url : '';
      const priority = parsePriorityValue(json.priority);
      const concurrency = resolveAuthFileConcurrencySetting(json);
      const fallback = json.fallback === true;
      const disableCooling = readAuthFileDisableCooling(json);
      const websockets = supportsAuthFileWebsockets(providerKey)
        ? readAuthFileWebsockets(json)
        : false;
      const usingApi = providerKey === 'xai' ? readXAIAuthFileUsingAPI(json) : false;
      const note = typeof json.note === 'string' ? json.note : '';
      const headers = json.headers;
      let headersText = '';
      let headersError: string | null = null;
      if (headers !== undefined) {
        headersText = JSON.stringify(headers, null, 2);
        const { errorKey } = parseHeadersText(headersText);
        headersError = errorKey ? t(errorKey) : null;
      }

      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return {
          ...prev,
          loading: false,
          originalText,
          rawText: originalText,
          invalidContentPreview: '',
          json,
          providerKey,
          groups,
          prefix,
          proxyUrl,
          priority: priority !== undefined ? String(priority) : '',
          concurrencyMode: concurrency.mode,
          maxConcurrency: String(concurrency.maxConcurrency),
          maxConcurrencyError: null,
          fallback,
          disableCooling,
          websockets,
          websocketsTouched: false,
          usingApi,
          usingApiTouched: false,
          note,
          noteTouched: false,
          headersText,
          headersTouched: false,
          headersError,
          error: null,
        };
      });
    } catch (err: unknown) {
      if (editorRequestIdRef.current !== editorRequestId) return;
      const errorMessage = err instanceof Error ? err.message : t('notification.download_failed');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, loading: false, error: errorMessage, rawText: '' };
      });
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  const handlePrefixProxyChange = (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => {
    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      if (field === 'prefix') return { ...prev, prefix: String(value) };
      if (field === 'proxyUrl') return { ...prev, proxyUrl: String(value) };
      if (field === 'priority') return { ...prev, priority: String(value) };
      if (field === 'concurrencyMode') {
        return { ...prev, concurrencyMode: String(value) as ConcurrencyMode };
      }
      if (field === 'maxConcurrency') {
        const maxConcurrency = String(value);
        const parsed = parseOptionalMaxConcurrency(maxConcurrency);
        return {
          ...prev,
          maxConcurrency,
          maxConcurrencyError: parsed.valid ? null : t('auth_files.max_concurrency_invalid'),
        };
      }
      if (field === 'fallback') return { ...prev, fallback: Boolean(value) };
      if (field === 'disableCooling') {
        return { ...prev, disableCooling: Boolean(value) };
      }
      if (field === 'websockets') {
        return { ...prev, websockets: Boolean(value), websocketsTouched: true };
      }
      if (field === 'usingApi') {
        return { ...prev, usingApi: Boolean(value), usingApiTouched: true };
      }
      if (field === 'note') return { ...prev, note: String(value), noteTouched: true };
      if (field === 'headersText') {
        const headersText = String(value);
        const { errorKey } = parseHeadersText(headersText);
        return {
          ...prev,
          headersText,
          headersTouched: true,
          headersError: errorKey ? t(errorKey) : null,
        };
      }
      return prev;
    });
  };

  const handlePrefixProxySave = async () => {
    if (!prefixProxyEditor?.json) return;
    if (!prefixProxyDirty) return;

    const name = prefixProxyEditor.fileName;
    const target = prefixProxyEditor.credentialIdentity;
    const editorRequestId = editorRequestIdRef.current;
    let payload: AuthFileFieldsPatch;
    try {
      payload = buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key));
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error && err.message === 'AUTH_FILE_MAX_CONCURRENCY_INVALID'
          ? t('auth_files.max_concurrency_invalid')
          : err instanceof Error
            ? err.message
            : 'Invalid format';
      showNotification(errorMessage, 'error');
      return;
    }
    if (!hasKeys(payload)) return;

    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== name) return prev;
      return { ...prev, saving: true };
    });

    try {
      const response = await authFilesApi.patchFields(target, payload);
      const authoritativeFile = response.files?.find((file) =>
        authFileMatchesCredentialIdentity(file, target)
      );
      if (!authoritativeFile) {
        throw new Error(t('auth_files.field_save_confirmation_failed'));
      }
      if (
        payload.disable_cooling !== undefined &&
        readAuthFileDisableCooling(authoritativeFile) !== payload.disable_cooling
      ) {
        throw new Error(t('auth_files.disable_cooling_confirmation_failed'));
      }
      commitMutationVersion(
        response.inventory_id ?? '',
        response.revision ?? 0,
        response.files ?? []
      );
      showNotification(t('auth_files.prefix_proxy_saved_success', { name }), 'success');
      if (editorRequestIdRef.current === editorRequestId) {
        editorRequestIdRef.current += 1;
        setPrefixProxyEditor(null);
      }
    } catch (err: unknown) {
      if (isAuthFileIdentityChangedError(err)) {
        try {
          await refreshAuthInventory(true);
          showNotification(
            t('auth_files.identity_changed', {
              defaultValue:
                'Credential changed. The latest inventory has been loaded; reopen it before saving.',
            }),
            'warning'
          );
          if (editorRequestIdRef.current === editorRequestId) {
            editorRequestIdRef.current += 1;
            setPrefixProxyEditor(null);
          }
        } catch (refreshError: unknown) {
          const message = refreshError instanceof Error ? refreshError.message : '';
          showNotification(
            `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
            'error'
          );
          setPrefixProxyEditor((prev) => {
            if (!prev || editorRequestIdRef.current !== editorRequestId) return prev;
            return { ...prev, saving: false };
          });
        }
        return;
      }
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, saving: false };
      });
    }
  };

  return {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  };
}
