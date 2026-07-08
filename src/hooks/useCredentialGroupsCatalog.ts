import { useCallback, useEffect, useState } from 'react';
import { credentialGroupsApi } from '@/services/api';
import { getErrorMessage } from '@/utils/helpers';

interface UseCredentialGroupsCatalogOptions {
  enabled?: boolean;
}

export function useCredentialGroupsCatalog({
  enabled = true,
}: UseCredentialGroupsCatalogOptions = {}) {
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setGroups([]);
      setError(null);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const list = await credentialGroupsApi.list();
      setGroups(list);
      return list;
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load credential groups');
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setGroups([]);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return {
    groups,
    loading,
    error,
    refresh,
  };
}
