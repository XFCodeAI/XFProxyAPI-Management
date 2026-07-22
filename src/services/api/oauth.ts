/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';
import type { ProxySelection } from '@/types';
import { proxySelectionParams } from './proxyPools';

export type BuiltInOAuthProvider = 'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'xai';

export type OAuthProvider = string;

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthCancelResponse {
  status: 'ok';
  canceled: boolean;
}

export type OAuthCredentialDisposition = 'created' | 'updated' | 'rekeyed';

export interface OAuthCredentialResult {
  provider: string;
  id: string;
  name: string;
  disposition: OAuthCredentialDisposition;
  inventory_id: string;
  revision: number;
}

export type OAuthStatusResponse =
  | { status: 'ok'; credential: OAuthCredentialResult }
  | { status: 'wait' }
  | { status: 'error'; error?: string };

const WEBUI_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai']);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key;
};

export const oauthApi = {
  startAuth: (provider: string, proxySelection?: ProxySelection) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = { ...proxySelectionParams(proxySelection) };
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    return apiClient.get<OAuthStartResponse>(`/${providerKey}-auth-url`, {
      params: Object.keys(params).length ? params : undefined,
    });
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<OAuthStatusResponse>(`/get-auth-status`, {
      params: { state },
      signal,
    }),

  submitCallback: (provider: string, redirectUrl: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: providerKey,
      redirect_url: redirectUrl,
    });
  },

  cancelAuth: (provider: string, state: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCancelResponse>('/oauth-cancel', {
      provider: providerKey,
      state,
    });
  },
};
