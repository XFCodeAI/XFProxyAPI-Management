import { create } from 'zustand';
import { credentialConcurrencyApi } from '@/services/api/credentialConcurrency';
import { DEFAULT_MAX_CONCURRENCY, isValidMaxConcurrency } from '@/utils/maxConcurrency';

interface CredentialConcurrencyState {
  defaultMaxConcurrency: number;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  load: (force?: boolean) => Promise<void>;
  save: (defaultMaxConcurrency: number) => Promise<void>;
  reset: () => void;
}

let loadRequest: Promise<void> | null = null;
let requestGeneration = 0;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'Failed to load concurrency settings');

export const useCredentialConcurrencyStore = create<CredentialConcurrencyState>((set, get) => ({
  defaultMaxConcurrency: DEFAULT_MAX_CONCURRENCY,
  loaded: false,
  loading: false,
  saving: false,
  error: '',

  load: async (force = false) => {
    if (!force && get().loaded) return;
    if (loadRequest) return loadRequest;
    const generation = requestGeneration;
    set({ loading: true, error: '' });
    const request = credentialConcurrencyApi
      .get()
      .then((config) => {
        if (generation !== requestGeneration) return;
        set({ defaultMaxConcurrency: config.defaultMaxConcurrency, loaded: true, error: '' });
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration) return;
        set({ error: errorMessage(error) });
        throw error;
      })
      .finally(() => {
        if (loadRequest === request) loadRequest = null;
        if (generation === requestGeneration) set({ loading: false });
      });
    loadRequest = request;
    return request;
  },

  save: async (defaultMaxConcurrency) => {
    if (!isValidMaxConcurrency(defaultMaxConcurrency)) {
      throw new Error('Invalid maximum concurrency');
    }
    set({ saving: true, error: '' });
    try {
      await credentialConcurrencyApi.update(defaultMaxConcurrency);
      set({ defaultMaxConcurrency, loaded: true });
    } catch (error: unknown) {
      set({ error: errorMessage(error) });
      throw error;
    } finally {
      set({ saving: false });
    }
  },

  reset: () => {
    requestGeneration += 1;
    loadRequest = null;
    set({
      defaultMaxConcurrency: DEFAULT_MAX_CONCURRENCY,
      loaded: false,
      loading: false,
      saving: false,
      error: '',
    });
  },
}));
