import { useCallback, useEffect, useRef, useState } from 'react';
import { promptRewriteApi } from '@/services/api';
import type { ApiError, PromptRewriteCatalog } from '@/types';

export type PromptRewriteCatalogStatus = 'loading' | 'ready' | 'unsupported' | 'error';

const isUnsupportedStatus = (status: number | undefined) =>
  status === 404 || status === 405 || status === 501;

export function usePromptRewriteCatalog() {
  const [status, setStatus] = useState<PromptRewriteCatalogStatus>('loading');
  const [catalog, setCatalog] = useState<PromptRewriteCatalog | null>(null);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setStatus('loading');
    setError('');
    try {
      const nextCatalog = await promptRewriteApi.catalog();
      if (generation !== requestGeneration.current) return null;
      setCatalog(nextCatalog);
      setStatus('ready');
      return nextCatalog;
    } catch (caught: unknown) {
      if (generation !== requestGeneration.current) return null;
      const apiError = caught as ApiError;
      if (isUnsupportedStatus(apiError.status)) {
        setStatus('unsupported');
        return null;
      }
      setError(apiError.message || 'Failed to load the NERV target catalog.');
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  return { status, catalog, error, load };
}
