/**
 * Authentication state management.
 * Migrated from src/modules/login.js and src/core/connection.js in the original project.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus, ServerRuntimeKind } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { versionApi } from '@/services/api/version';
import { useConfigStore } from './useConfigStore';
import { useModelsStore } from './useModelsStore';
import { useQuotaStore } from './useQuotaStore';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

interface AuthStoreState extends AuthState {
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (
    version: string | null,
    buildDate?: string | null,
    runtimeKind?: ServerRuntimeKind | null
  ) => void;
  updateServerRuntimeKind: (runtimeKind: ServerRuntimeKind) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
  updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;

const detectRuntimeKind = async (): Promise<ServerRuntimeKind> => {
  try {
    return await versionApi.detectRuntimeKind();
  } catch (error) {
    console.warn('检测运行时类型失败:', error);
    return 'unknown';
  }
};

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      serverVersion: null,
      serverBuildDate: null,
      serverRuntimeKind: 'unknown',
      supportsPlugin: false,
      connectionStatus: 'disconnected',
      connectionError: null,

      // Restore the session and log in automatically.
      restoreSession: () => {
        if (restoreSessionPromise) return restoreSessionPromise;

        restoreSessionPromise = (async () => {
          obfuscatedStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

          const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
          const legacyBase =
            obfuscatedStorage.getItem<string>('apiBase') ||
            obfuscatedStorage.getItem<string>('apiUrl', { encrypt: true });
          const legacyKey = obfuscatedStorage.getItem<string>('managementKey');

          const { apiBase, managementKey, rememberPassword } = get();
          const resolvedBase = normalizeApiBase(
            apiBase || legacyBase || detectApiBaseFromLocation()
          );
          const resolvedKey = managementKey || legacyKey || '';
          const resolvedRememberPassword =
            rememberPassword || Boolean(managementKey) || Boolean(legacyKey);

          set({
            apiBase: resolvedBase,
            managementKey: resolvedKey,
            rememberPassword: resolvedRememberPassword,
          });
          apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

          if (wasLoggedIn && resolvedBase && resolvedKey) {
            try {
              await get().login({
                apiBase: resolvedBase,
                managementKey: resolvedKey,
                rememberPassword: resolvedRememberPassword,
              });
              return true;
            } catch (error) {
              console.warn('自动登录失败:', error);
              return false;
            }
          }

          return false;
        })();

        return restoreSessionPromise;
      },

      // Log in.
      login: async (credentials) => {
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;

        try {
          set({
            connectionStatus: 'connecting',
            serverVersion: null,
            serverBuildDate: null,
            serverRuntimeKind: 'unknown',
            supportsPlugin: false,
          });
          useModelsStore.getState().clearCache();
          useQuotaStore.getState().clearQuotaCache();

          // Configure the API client.
          apiClient.setConfig({
            apiBase,
            managementKey,
          });

          // Test the connection by fetching the configuration.
          await useConfigStore.getState().fetchConfig(undefined, true);
          const runtimeKind = await detectRuntimeKind();

          // Login succeeded.
          set({
            isAuthenticated: true,
            apiBase,
            managementKey,
            rememberPassword,
            connectionStatus: 'connected',
            connectionError: null,
            ...(runtimeKind !== 'unknown' ? { serverRuntimeKind: runtimeKind } : {}),
          });
          if (rememberPassword) {
            localStorage.setItem('isLoggedIn', 'true');
          } else {
            localStorage.removeItem('isLoggedIn');
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'Connection failed';
          set({
            connectionStatus: 'error',
            connectionError: message || 'Connection failed',
          });
          throw error;
        }
      },

      // Log out.
      logout: () => {
        restoreSessionPromise = null;
        useConfigStore.getState().clearCache();
        useModelsStore.getState().clearCache();
        useQuotaStore.getState().clearQuotaCache();
        set({
          isAuthenticated: false,
          apiBase: '',
          managementKey: '',
          serverVersion: null,
          serverBuildDate: null,
          serverRuntimeKind: 'unknown',
          supportsPlugin: false,
          connectionStatus: 'disconnected',
          connectionError: null,
        });
        localStorage.removeItem('isLoggedIn');
      },

      // Check authentication state.
      checkAuth: async () => {
        const { managementKey, apiBase } = get();

        if (!managementKey || !apiBase) {
          return false;
        }

        try {
          // Reconfigure the client.
          apiClient.setConfig({ apiBase, managementKey });
          set({ supportsPlugin: false });

          // Verify the connection.
          await useConfigStore.getState().fetchConfig();
          const runtimeKind = await detectRuntimeKind();

          set({
            isAuthenticated: true,
            connectionStatus: 'connected',
            ...(runtimeKind !== 'unknown' ? { serverRuntimeKind: runtimeKind } : {}),
          });

          return true;
        } catch {
          set({
            isAuthenticated: false,
            connectionStatus: 'error',
            supportsPlugin: false,
          });
          return false;
        }
      },

      // Update server version metadata.
      updateServerVersion: (version, buildDate, runtimeKind) => {
        set((state) => ({
          serverVersion: version || null,
          serverBuildDate: buildDate || null,
          serverRuntimeKind: runtimeKind || state.serverRuntimeKind,
        }));
      },

      updateServerRuntimeKind: (runtimeKind) => {
        set({ serverRuntimeKind: runtimeKind });
      },

      updateServerPluginSupport: (supportsPlugin) => {
        set({ supportsPlugin });
      },

      // Update connection status.
      updateConnectionStatus: (status, error = null) => {
        set({
          connectionStatus: status,
          connectionError: error,
        });
      },
    }),
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = obfuscatedStorage.getItem<AuthStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          obfuscatedStorage.setItem(name, JSON.parse(value));
        },
        removeItem: (name) => {
          obfuscatedStorage.removeItem(name);
        },
      })),
      partialize: (state) => ({
        apiBase: state.apiBase,
        ...(state.rememberPassword ? { managementKey: state.managementKey } : {}),
        rememberPassword: state.rememberPassword,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate,
        serverRuntimeKind: state.serverRuntimeKind,
      }),
    }
  )
);

// Listen for global unauthorized events.
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => {
    useAuthStore.getState().logout();
  });

  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    const detail = e.detail || {};
    const runtimeKind =
      detail.runtimeKind === 'cpa' || detail.runtimeKind === 'home' ? detail.runtimeKind : null;
    useAuthStore
      .getState()
      .updateServerVersion(detail.version || null, detail.buildDate || null, runtimeKind);
  }) as EventListener);

  window.addEventListener('server-plugin-support-update', ((e: CustomEvent) => {
    useAuthStore.getState().updateServerPluginSupport(e.detail?.supportsPlugin === true);
  }) as EventListener);
}
