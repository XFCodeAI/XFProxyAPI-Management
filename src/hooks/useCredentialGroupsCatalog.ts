import { useCallback, useEffect, useRef, useState } from 'react';
import { credentialGroupsApi } from '@/services/api';
import { getErrorMessage } from '@/utils/helpers';
import { waitForCredentialGroupsCatalog } from './credentialGroupsCatalogPolling';

interface UseCredentialGroupsCatalogOptions {
  enabled?: boolean;
  retry?: boolean;
}

export function useCredentialGroupsCatalog({
  enabled = true,
  retry = false,
}: UseCredentialGroupsCatalogOptions = {}) {
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setGroups([]);
      setError(null);
      setReady(false);
      return [];
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    const isCurrent = () =>
      generationRef.current === generation &&
      controllerRef.current === controller &&
      !controller.signal.aborted;

    setError(null);
    setReady(false);
    const result = await waitForCredentialGroupsCatalog({
      load: (signal) => credentialGroupsApi.list(signal),
      signal: controller.signal,
      isCurrent,
      retry,
      onAttempt: () => {
        if (!isCurrent()) return;
        setLoading(true);
        setError(null);
      },
      onFailure: (err) => {
        if (!isCurrent()) return;
        setLoading(false);
        setError(getErrorMessage(err, 'Failed to load credential groups'));
      },
    });

    if (!isCurrent()) return [];
    setLoading(false);
    if (result.status === 'ready') {
      setGroups(result.groups);
      setError(null);
      setReady(true);
      return result.groups;
    }
    return [];
  }, [enabled, retry]);

  useEffect(() => {
    if (!enabled) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      generationRef.current += 1;
      setGroups([]);
      setError(null);
      setLoading(false);
      setReady(false);
      return;
    }
    void refresh();
    return () => {
      controllerRef.current?.abort();
    };
  }, [enabled, refresh]);

  return {
    groups,
    loading,
    error,
    ready,
    refresh,
  };
}
