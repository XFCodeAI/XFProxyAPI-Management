import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { oauthApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { ProxySelection } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage, isRecord } from '@/utils/helpers';

export interface OAuthProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
}

interface UseOAuthProviderFlowOptions {
  getProviderText: (provider: string, suffix: string) => string;
  onSuccess?: (provider: string) => void;
}

const CALLBACK_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai']);
const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';
const SUCCESS_RESET_DELAY_MS = 5000;

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
  const [states, setStates] = useState<Record<string, OAuthProviderState>>({});
  const statesRef = useRef<Record<string, OAuthProviderState>>({});
  const cancelRequested = useRef<Partial<Record<string, boolean>>>({});
  const pollingTimers = useRef<Partial<Record<string, number>>>({});
  const successResetTimers = useRef<Partial<Record<string, number>>>({});

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const clearPollingTimer = useCallback((provider: string) => {
    const timer = pollingTimers.current[provider];
    if (timer !== undefined) {
      window.clearInterval(timer);
      delete pollingTimers.current[provider];
    }
  }, []);

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
      clearPollingTimer(provider);
      clearSuccessResetTimer(provider);
    },
    [clearPollingTimer, clearSuccessResetTimer]
  );

  const resetProviderAttempt = useCallback(
    (provider: string) => {
      clearProviderTimers(provider);
      cancelRequested.current[provider] = false;
      setStates((prev) => {
        const updated = {
          ...prev,
          [provider]: {},
        };
        statesRef.current = updated;
        return updated;
      });
    },
    [clearProviderTimers]
  );

  const completeProviderAuth = useCallback(
    (provider: string) => {
      cancelRequested.current[provider] = false;
      clearPollingTimer(provider);
      clearSuccessResetTimer(provider);
      updateProviderState(provider, {
        url: undefined,
        state: undefined,
        status: 'success',
        error: undefined,
        polling: false,
        callbackUrl: '',
        callbackSubmitting: false,
        callbackStatus: undefined,
        callbackError: undefined,
      });
      showNotification(getProviderText(provider, 'oauth_status_success'), 'success');
      onSuccess?.(provider);
      successResetTimers.current[provider] = window.setTimeout(() => {
        resetProviderAttempt(provider);
      }, SUCCESS_RESET_DELAY_MS);
    },
    [
      clearPollingTimer,
      clearSuccessResetTimer,
      getProviderText,
      onSuccess,
      resetProviderAttempt,
      showNotification,
      updateProviderState,
    ]
  );

  const startPolling = useCallback(
    (provider: string, state: string) => {
      clearPollingTimer(provider);
      const timer = window.setInterval(async () => {
        try {
          const res = await oauthApi.getAuthStatus(state);
          if (cancelRequested.current[provider]) {
            return;
          }
          if (res.status === 'ok') {
            completeProviderAuth(provider);
          } else if (res.status === 'error') {
            updateProviderState(provider, {
              status: 'error',
              error: res.error,
              polling: false,
            });
            showNotification(
              `${getProviderText(provider, 'oauth_status_error')} ${res.error || ''}`,
              'error'
            );
            window.clearInterval(timer);
            delete pollingTimers.current[provider];
          }
        } catch (err: unknown) {
          if (cancelRequested.current[provider]) {
            return;
          }
          updateProviderState(provider, {
            status: 'error',
            error: getErrorMessage(err),
            polling: false,
          });
          window.clearInterval(timer);
          delete pollingTimers.current[provider];
        }
      }, 3000);
      pollingTimers.current[provider] = timer;
    },
    [
      clearPollingTimer,
      completeProviderAuth,
      getProviderText,
      showNotification,
      updateProviderState,
    ]
  );

  const startAuth = useCallback(
    async (provider: string, proxySelection?: ProxySelection) => {
      clearProviderTimers(provider);
      cancelRequested.current[provider] = false;
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
        if (cancelRequested.current[provider]) {
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
        updateProviderState(provider, {
          url: res.url,
          state: res.state,
          status: 'waiting',
          polling: true,
        });
        startPolling(provider, res.state);
      } catch (err: unknown) {
        if (cancelRequested.current[provider]) {
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
    [clearProviderTimers, getProviderText, showNotification, startPolling, t, updateProviderState]
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
    [clearProviderTimers]
  );

  const submitCallback = useCallback(
    async (provider: string) => {
      const callbackInput = (states[provider]?.callbackUrl || '').trim();
      if (!callbackInput) {
        showNotification(
          t(
            provider === 'xai'
              ? 'auth_login.xai_callback_required'
              : 'auth_login.oauth_callback_required'
          ),
          'warning'
        );
        return;
      }
      const redirectUrl = resolveCallbackUrl(provider, callbackInput, states[provider]?.state);
      if (!redirectUrl) {
        showNotification(
          t(
            provider === 'xai'
              ? 'auth_login.xai_callback_state_missing'
              : 'auth_login.missing_state'
          ),
          'warning'
        );
        return;
      }
      updateProviderState(provider, {
        callbackSubmitting: true,
        callbackStatus: undefined,
        callbackError: undefined,
      });
      try {
        await oauthApi.submitCallback(provider, redirectUrl);
        updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
        showNotification(t('auth_login.oauth_callback_success'), 'success');
      } catch (err: unknown) {
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
      }
    },
    [showNotification, states, t, updateProviderState]
  );

  useEffect(() => {
    return () => {
      Object.values(pollingTimers.current).forEach((timer) => {
        if (timer !== undefined) window.clearInterval(timer);
      });
      Object.values(successResetTimers.current).forEach((timer) => {
        if (timer !== undefined) window.clearTimeout(timer);
      });
      pollingTimers.current = {};
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
