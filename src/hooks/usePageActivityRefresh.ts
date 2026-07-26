import { useEffect } from 'react';

interface ActivityEventTarget {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

export interface PageActivityRefreshTargets {
  windowTarget: ActivityEventTarget;
  documentTarget: ActivityEventTarget;
  visibilityState: () => DocumentVisibilityState;
}

const browserTargets = (): PageActivityRefreshTargets => ({
  windowTarget: window,
  documentTarget: document,
  visibilityState: () => document.visibilityState,
});

export const subscribePageActivityRefresh = (
  refresh: () => void | Promise<unknown>,
  targets: PageActivityRefreshTargets = browserTargets()
): (() => void) => {
  const run = () => {
    void Promise.resolve(refresh()).catch(() => undefined);
  };
  const onVisibilityChange = () => {
    if (targets.visibilityState() === 'visible') run();
  };

  targets.windowTarget.addEventListener('focus', run);
  targets.documentTarget.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    targets.windowTarget.removeEventListener('focus', run);
    targets.documentTarget.removeEventListener('visibilitychange', onVisibilityChange);
  };
};

export const usePageActivityRefresh = (refresh: () => void | Promise<unknown>, enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    return subscribePageActivityRefresh(refresh);
  }, [enabled, refresh]);
};
