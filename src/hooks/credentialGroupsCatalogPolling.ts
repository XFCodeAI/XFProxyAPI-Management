import { computeRetryDelay, sleepForRetry, type RetrySleep } from '../utils/retryBackoff.ts';

export type CredentialGroupsCatalogResult =
  | { status: 'ready'; groups: string[] }
  | { status: 'failed'; error: unknown }
  | { status: 'cancelled' };

interface CredentialGroupsCatalogPollingOptions {
  load: (signal: AbortSignal) => Promise<string[]>;
  signal: AbortSignal;
  isCurrent: () => boolean;
  retry: boolean;
  onAttempt?: () => void;
  onFailure?: (error: unknown) => void;
  sleep?: RetrySleep;
  random?: () => number;
}

export async function waitForCredentialGroupsCatalog({
  load,
  signal,
  isCurrent,
  retry,
  onAttempt,
  onFailure,
  sleep = sleepForRetry,
  random = Math.random,
}: CredentialGroupsCatalogPollingOptions): Promise<CredentialGroupsCatalogResult> {
  let failureCount = 0;

  while (!signal.aborted && isCurrent()) {
    onAttempt?.();
    try {
      const groups = await load(signal);
      if (signal.aborted || !isCurrent()) return { status: 'cancelled' };
      return { status: 'ready', groups };
    } catch (error: unknown) {
      if (signal.aborted || !isCurrent()) return { status: 'cancelled' };
      failureCount += 1;
      onFailure?.(error);
      if (!retry) return { status: 'failed', error };
      await sleep(computeRetryDelay(failureCount, random), signal);
    }

    if (signal.aborted || !isCurrent()) return { status: 'cancelled' };
  }

  return { status: 'cancelled' };
}
