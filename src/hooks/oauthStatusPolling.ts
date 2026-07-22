import type { OAuthStatusResponse } from '@/services/api/oauth';
import { computeRetryDelay, sleepForRetry, type RetrySleep } from '../utils/retryBackoff.ts';

type OAuthStatusTerminalResponse = Exclude<OAuthStatusResponse, { status: 'wait' }>;

interface OAuthStatusPollingOptions {
  request: (signal: AbortSignal) => Promise<OAuthStatusResponse>;
  signal: AbortSignal;
  isCurrent: () => boolean;
  sleep?: RetrySleep;
  random?: () => number;
  pollDelayMs?: number;
}

export async function waitForOAuthStatus({
  request,
  signal,
  isCurrent,
  sleep = sleepForRetry,
  random = Math.random,
  pollDelayMs = 3_000,
}: OAuthStatusPollingOptions): Promise<OAuthStatusTerminalResponse | null> {
  let failureCount = 0;

  while (!signal.aborted && isCurrent()) {
    try {
      const response = await request(signal);
      if (signal.aborted || !isCurrent()) return null;
      failureCount = 0;
      if (response.status !== 'wait') return response;
      await sleep(pollDelayMs, signal);
    } catch {
      if (signal.aborted || !isCurrent()) return null;
      failureCount += 1;
      await sleep(computeRetryDelay(failureCount, random), signal);
    }

    if (signal.aborted || !isCurrent()) return null;
  }

  return null;
}
