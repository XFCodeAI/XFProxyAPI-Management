import type { OAuthCredentialResult } from '@/services/api/oauth';
import type { AuthFileItem, AuthFilesResponse } from '@/types';
import { resolveOAuthCredentialTarget } from './oauthCredentialTarget.ts';
import { computeRetryDelay, sleepForRetry, type RetrySleep } from '../../utils/retryBackoff.ts';

export type OAuthCredentialPublicationResult<T extends AuthFileItem> =
  { status: 'ready'; credential: T } | { status: 'cancelled' };

interface OAuthCredentialPublicationOptions<T extends AuthFileItem> {
  credential: OAuthCredentialResult;
  refresh: () => Promise<AuthFilesResponse & { files: T[] }>;
  signal: AbortSignal;
  isCurrent: () => boolean;
  sleep?: RetrySleep;
  random?: () => number;
  pollDelayMs?: number;
}

const normalizeRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
};

export function resolvePublishedOAuthCredential<T extends AuthFileItem>(
  credential: OAuthCredentialResult,
  snapshot: AuthFilesResponse & { files: T[] }
): T | null {
  const inventoryId = String(snapshot.inventory_id ?? '').trim();
  if (!inventoryId) return null;

  if (
    inventoryId === credential.inventory_id &&
    normalizeRevision(snapshot.revision) < credential.revision
  ) {
    return null;
  }

  return resolveOAuthCredentialTarget(credential, snapshot.files ?? []);
}

export async function waitForOAuthCredentialPublication<T extends AuthFileItem>({
  credential,
  refresh,
  signal,
  isCurrent,
  sleep = sleepForRetry,
  random = Math.random,
  pollDelayMs = 1_000,
}: OAuthCredentialPublicationOptions<T>): Promise<OAuthCredentialPublicationResult<T>> {
  let failureCount = 0;

  while (!signal.aborted && isCurrent()) {
    try {
      const snapshot = await refresh();
      if (signal.aborted || !isCurrent()) return { status: 'cancelled' };
      failureCount = 0;
      const target = resolvePublishedOAuthCredential(credential, snapshot);
      if (target) return { status: 'ready', credential: target };
      await sleep(pollDelayMs, signal);
    } catch {
      if (signal.aborted || !isCurrent()) return { status: 'cancelled' };
      failureCount += 1;
      await sleep(computeRetryDelay(failureCount, random), signal);
    }

    if (signal.aborted || !isCurrent()) return { status: 'cancelled' };
  }

  return { status: 'cancelled' };
}
