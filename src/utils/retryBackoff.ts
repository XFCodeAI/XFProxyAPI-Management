export type RetrySleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

export const computeRetryDelay = (
  failureCount: number,
  random: () => number = Math.random,
  baseDelayMs = 1_000,
  maxDelayMs = 15_000
): number => {
  const exponent = Math.max(0, Math.min(30, failureCount - 1));
  const bounded = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(bounded * jitter);
};

export const sleepForRetry: RetrySleep = (delayMs, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, delayMs));
    signal.addEventListener('abort', finish, { once: true });
  });
