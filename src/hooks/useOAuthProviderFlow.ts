import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { oauthApi } from '@/services/api';
import type { OAuthCredentialResult } from '@/services/api/oauth';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { ProxySelection } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import { waitForOAuthStatus } from './oauthStatusPolling';
import {
  beginOAuthCallbackSubmission,
  finishOAuthCallbackSubmission,
  isCurrentOAuthAttempt,
  oauthCallbackReportsError,
} from './oauthAttemptLifecycle';

export interface OAuthProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'syncing' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  credential?: OAuthCredentialResult;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
}

export interface OAuthAttemptContext {
  state: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

interface UseOAuthProviderFlowOptions {
  getProviderText: (provider: string, suffix: string) => string;
  onSuccess?: (
    provider: string,
    credential: OAuthCredentialResult,
    attempt: OAuthAttemptContext
  ) => Promise<void>;
}

interface OAuthProviderAttempt {
  id: number;
  state?: string;
  controller: AbortController;
}

const CALLBACK_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai']);
const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';
const SUCCESS_RESET_DELAY_MS = 5000;
const OAUTH_CREDENTIAL_DISPOSITIONS = new Set(['created', 'updated', 'rekeyed']);

const isOAuthCredentialResult = (value: unknown): value is OAuthCredentialResult => {
  if (!isRecord(value)) return false;
  const provider = typeof value.provider === 'string' ? value.provider : '';
  const id = typeof value.id === 'string' ? value.id : '';
  const name = typeof value.name === 'string' ? value.name : '';
  const disposition = typeof value.disposition === 'string' ? value.disposition : '';
  const inventoryId = typeof value.inventory_id === 'string' ? value.inventory_id : '';
  const revision = Number(value.revision);
  return (
    provider !== '' &&
    provider.trim() === provider &&
    id !== '' &&
    id.trim() === id &&
    name !== '' &&
    name.trim() === name &&
    inventoryId !== '' &&
    inventoryId.trim() === inventoryId &&
    Number.isSafeInteger(revision) &&
    revision > 0 &&
    OAUTH_CREDENTIAL_DISPOSITIONS.has(disposition)
  );
};

const getErrorStatus = (error: unknown): number | undefined => {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
};

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const readQueryLikeCallbackInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const queryStart = trimmed.indexOf('?');
  const hashStart = trimmed.indexOf('#');
  const rawParams =
    queryStart >= 0
      ? trimmed.slice(queryStart + 1)
      : hashStart >= 0
        ? trimmed.slice(hashStart + 1)
        : trimmed;

  if (!/(^|[&#?])(code|state|error)=/i.test(rawParams)) return null;
  return new URLSearchParams(rawParams.replace(/^[?#]/, ''));
};

const extractDisplayedXaiCode = (value: string): string => {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/\bcode\s*[:=]\s*([^\s&]+)/i);
  return (codeMatch?.[1] ?? trimmed).trim();
};

const buildXaiCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteUrl(trimmed)) return trimmed;

  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    const code = params.get('code')?.trim();
    const error = params.get('error')?.trim();
    const errorDescription = params.get('error_description')?.trim();
    const callbackState = params.get('state')?.trim() || state?.trim();
    if (!callbackState) return null;

    const callbackUrl = new URL(XAI_CALLBACK_URL);
    callbackUrl.searchParams.set('state', callbackState);
    if (code) callbackUrl.searchParams.set('code', code);
    if (error) callbackUrl.searchParams.set('error', error);
    if (errorDescription) callbackUrl.searchParams.set('error_description', errorDescription);
    return callbackUrl.toString();
  }

  const code = extractDisplayedXaiCode(trimmed);
  const callbackState = state?.trim();
  if (!code || !callbackState) return null;

  const callbackUrl = new URL(XAI_CALLBACK_URL);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  return callbackUrl.toString();
};

const resolveCallbackUrl = (provider: string, input: string, state?: string): string | null => {
  if (provider !== 'xai') return input.trim();
  return buildXaiCallbackUrl(input, state);
};

export const supportsOAuthCallback = (provider: string, pluginProvider = false) =>
  pluginProvider || CALLBACK_SUPPORTED.has(provider);

export function useOAuthProviderFlow({ getProviderText, onSuccess }: UseOAuthProviderFlowOptions) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [states, setStates] = useState<Record<string, OAuthProviderState>>({});
  const statesRef = useRef<Record<string, OAuthProviderState>>({});
  const cancelRequested = useRef<Partial<Record<string, boolean>>>({});
  const successResetTimers = useRef<Partial<Record<string, number>>>({});
  const callbackSubmissions = useRef<Partial<Record<string, string>>>({});
  const attempts = useRef<Partial<Record<string, OAuthProviderAttempt>>>({});
  const attemptSequence = useRef(0);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const clearSuccessResetTimer = useCallback((provider: string) => {
    const timer = successResetTimers.current[provider];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete successResetTimers.current[provider];
    }
  }, []);

  const updateProviderState = useCallback((provider: string, next: Partial<OAuthProviderState>) => {
    setStates((prev) => {
      const updated = {
        ...prev,
        [provider]: { ...(prev[provider] ?? {}), ...next },
      };
      statesRef.current = updated;
      return updated;
    });
  }, []);

  const clearProviderTimers = useCallback(
    (provider: string) => {
      clearSuccessResetTimer(provider);
    },
    [clearSuccessResetTimer]
  );

  const abortProviderAttempt = useCallback((provider: string) => {
    attempts.current[provider]?.controller.abort();
    delete attempts.current[provider];
  }, []);

  const isCurrentProviderAttempt = useCallback(
    (provider: string, attempt: OAuthProviderAttempt): boolean =>
      attempts.current[provider] === attempt && !attempt.controller.signal.aborted,
    []
  );

  const resetProviderAttempt = useCallback(
    (provider: string) => {
      abortProviderAttempt(provider);
      clearProviderTimers(provider);
      cancelRequested.current[provider] = false;
      delete callbackSubmissions.current[provider];
      setStates((prev) => {
        const updated = {
          ...prev,
          [provider]: {},
        };
        statesRef.current = updated;
        return updated;
      });
    },
    [abortProviderAttempt, clearProviderTimers]
  );

  const completeProviderAuth = useCallback(
    async (provider: string, credential: OAuthCredentialResult, attempt: OAuthProviderAttempt) => {
      if (!attempt.state || !isCurrentProviderAttempt(provider, attempt)) return;
      cancelRequested.current[provider] = false;
      delete callbackSubmissions.current[provider];
      clearSuccessResetTimer(provider);
      updateProviderState(provider, {
        url: undefined,
        state: attempt.state,
        status: 'syncing',
        error: undefined,
        polling: true,
        credential,
        callbackUrl: '',
        callbackSubmitting: false,
        callbackStatus: undefined,
        callbackError: undefined,
      });

      const context: OAuthAttemptContext = {
        state: attempt.state,
        signal: attempt.controller.signal,
        isCurrent: () => isCurrentProviderAttempt(provider, attempt),
      };
      try {
        await onSuccess?.(provider, credential, context);
      } catch (error: unknown) {
        if (!isCurrentProviderAttempt(provider, attempt)) return;
        const message = getErrorMessage(error);
        updateProviderState(provider, {
          status: 'error',
          error: message,
          polling: false,
        });
        showNotification(message, 'error');
        return;
      }

      if (!isCurrentProviderAttempt(provider, attempt)) return;
      updateProviderState(provider, {
        url: undefined,
        state: undefined,
        status: 'success',
        error: undefined,
        polling: false,
        credential,
      });
      showNotification(getProviderText(provider, 'oauth_status_success'), 'success');
      successResetTimers.current[provider] = window.setTimeout(() => {
        resetProviderAttempt(provider);
      }, SUCCESS_RESET_DELAY_MS);
    },
    [
      clearSuccessResetTimer,
      getProviderText,
      isCurrentProviderAttempt,
      onSuccess,
      resetProviderAttempt,
      showNotification,
      updateProviderState,
    ]
  );

  const startPolling = useCallback(
    async (provider: string, state: string, attempt: OAuthProviderAttempt) => {
      const res = await waitForOAuthStatus({
        request: (signal) => oauthApi.getAuthStatus(state, signal),
        signal: attempt.controller.signal,
        isCurrent: () =>
          !cancelRequested.current[provider] && isCurrentProviderAttempt(provider, attempt),
      });
      if (!res || !isCurrentProviderAttempt(provider, attempt)) return;

      if (res.status === 'ok') {
        if (!isOAuthCredentialResult(res.credential)) {
          const message = t('auth_login.oauth_credential_result_missing', {
            defaultValue: 'OAuth completed without a valid credential result.',
          });
          updateProviderState(provider, {
            status: 'error',
            error: message,
            polling: false,
          });
          showNotification(message, 'error');
          return;
        }
        await completeProviderAuth(provider, res.credential, attempt);
        return;
      }

      updateProviderState(provider, {
        status: 'error',
        error: res.error,
        polling: false,
      });
      showNotification(
        `${getProviderText(provider, 'oauth_status_error')} ${res.error || ''}`,
        'error'
      );
    },
    [
      completeProviderAuth,
      getProviderText,
      isCurrentProviderAttempt,
      showNotification,
      t,
      updateProviderState,
    ]
  );

  const startAuth = useCallback(
    async (provider: string, proxySelection?: ProxySelection) => {
      abortProviderAttempt(provider);
      clearProviderTimers(provider);
      cancelRequested.current[provider] = false;
      delete callbackSubmissions.current[provider];
      const attempt: OAuthProviderAttempt = {
        id: ++attemptSequence.current,
        controller: new AbortController(),
      };
      attempts.current[provider] = attempt;
      updateProviderState(provider, {
        url: undefined,
        state: undefined,
        status: 'waiting',
        polling: true,
        error: undefined,
        callbackStatus: undefined,
        callbackError: undefined,
        callbackUrl: '',
      });
      try {
        const res = await oauthApi.startAuth(provider, proxySelection);
        if (cancelRequested.current[provider] || !isCurrentProviderAttempt(provider, attempt)) {
          if (res.state) {
            void oauthApi.cancelAuth(provider, res.state).catch(() => {});
          }
          return;
        }
        if (!res.state) {
          const message = t('auth_login.missing_state');
          updateProviderState(provider, {
            url: res.url,
            state: undefined,
            status: 'error',
            error: message,
            polling: false,
          });
          showNotification(message, 'error');
          return;
        }
        attempt.state = res.state;
        updateProviderState(provider, {
          url: res.url,
          state: res.state,
          status: 'waiting',
          polling: true,
        });
        void startPolling(provider, res.state, attempt);
      } catch (err: unknown) {
        if (cancelRequested.current[provider] || !isCurrentProviderAttempt(provider, attempt)) {
          return;
        }
        const message = getErrorMessage(err);
        updateProviderState(provider, { status: 'error', error: message, polling: false });
        showNotification(
          `${getProviderText(provider, 'oauth_start_error')}${message ? ` ${message}` : ''}`,
          'error'
        );
      }
    },
    [
      abortProviderAttempt,
      clearProviderTimers,
      getProviderText,
      isCurrentProviderAttempt,
      showNotification,
      startPolling,
      t,
      updateProviderState,
    ]
  );

  const copyLink = useCallback(
    async (url?: string) => {
      if (!url) return;
      const copied = await copyToClipboard(url);
      showNotification(
        t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const cancelAuth = useCallback(
    (provider: string) => {
      const activeState = statesRef.current[provider]?.state;
      cancelRequested.current[provider] = true;
      delete callbackSubmissions.current[provider];
      abortProviderAttempt(provider);
      clearProviderTimers(provider);
      setStates((prev) => {
        const updated = {
          ...prev,
          [provider]: {},
        };
        statesRef.current = updated;
        return updated;
      });
      if (activeState) {
        void oauthApi.cancelAuth(provider, activeState).catch(() => {});
      }
    },
    [abortProviderAttempt, clearProviderTimers]
  );

  const submitCallback = useCallback(
    async (provider: string): Promise<boolean> => {
      const attempt = statesRef.current[provider];
      const attemptState = attempt?.state?.trim() ?? '';
      const callbackInput = (attempt?.callbackUrl || '').trim();
      const callbackReportsError = oauthCallbackReportsError(callbackInput);
      if (!callbackInput) {
        showNotification(
          t(
            provider === 'xai'
              ? 'auth_login.xai_callback_required'
              : 'auth_login.oauth_callback_required'
          ),
          'warning'
        );
        return false;
      }
      if (!attemptState) {
        showNotification(t('auth_login.missing_state'), 'warning');
        return false;
      }
      const redirectUrl = resolveCallbackUrl(provider, callbackInput, attemptState);
      if (!redirectUrl) {
        showNotification(
          t(
            provider === 'xai'
              ? 'auth_login.xai_callback_state_missing'
              : 'auth_login.missing_state'
          ),
          'warning'
        );
        return false;
      }
      if (!beginOAuthCallbackSubmission(callbackSubmissions.current, provider, attemptState)) {
        return false;
      }
      updateProviderState(provider, {
        callbackSubmitting: true,
        callbackStatus: undefined,
        callbackError: undefined,
      });
      try {
        await oauthApi.submitCallback(provider, redirectUrl);
        if (
          cancelRequested.current[provider] ||
          !isCurrentOAuthAttempt(statesRef.current, provider, attemptState)
        ) {
          return false;
        }
        updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
        showNotification(t('auth_login.oauth_callback_success'), 'success');
        return !callbackReportsError;
      } catch (err: unknown) {
        if (
          cancelRequested.current[provider] ||
          !isCurrentOAuthAttempt(statesRef.current, provider, attemptState)
        ) {
          return false;
        }
        const status = getErrorStatus(err);
        const message = getErrorMessage(err);
        const errorMessage =
          status === 404
            ? t('auth_login.oauth_callback_upgrade_hint', {
                defaultValue: 'Please update CLI Proxy API or check the connection.',
              })
            : message || undefined;
        updateProviderState(provider, {
          callbackSubmitting: false,
          callbackStatus: 'error',
          callbackError: errorMessage,
        });
        const notificationMessage = errorMessage
          ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
          : t('auth_login.oauth_callback_error');
        showNotification(notificationMessage, 'error');
        return false;
      } finally {
        finishOAuthCallbackSubmission(callbackSubmissions.current, provider, attemptState);
      }
    },
    [showNotification, t, updateProviderState]
  );

  useEffect(() => {
    if (isAuthenticated) return;
    Object.keys(attempts.current).forEach(abortProviderAttempt);
    Object.keys(successResetTimers.current).forEach(clearSuccessResetTimer);
  }, [abortProviderAttempt, clearSuccessResetTimer, isAuthenticated]);

  useEffect(() => {
    return () => {
      Object.values(attempts.current).forEach((attempt) => attempt?.controller.abort());
      Object.values(successResetTimers.current).forEach((timer) => {
        if (timer !== undefined) window.clearTimeout(timer);
      });
      attempts.current = {};
      successResetTimers.current = {};
    };
  }, []);

  return {
    states,
    updateProviderState,
    resetProviderAttempt,
    startAuth,
    cancelAuth,
    copyLink,
    submitCallback,
  };
}
