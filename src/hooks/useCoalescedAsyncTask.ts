import { useCallback, useEffect, useRef } from 'react';

export interface CoalescedAsyncTask {
  run: () => Promise<void>;
  setTask: (task: () => Promise<void>) => void;
  resume: () => void;
  pause: () => void;
}

export const createCoalescedAsyncTask = (initialTask: () => Promise<void>): CoalescedAsyncTask => {
  let task = initialTask;
  let active = true;
  let queued = false;
  let running: Promise<void> | null = null;

  const run = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (running) {
      queued = true;
      return running;
    }
    const drain = async () => {
      do {
        queued = false;
        await task();
      } while (active && queued);
    };
    running = drain().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    run,
    setTask: (nextTask) => {
      task = nextTask;
    },
    resume: () => {
      active = true;
    },
    pause: () => {
      active = false;
      queued = false;
    },
  };
};

export const useCoalescedAsyncTask = (task: () => Promise<void>): (() => Promise<void>) => {
  const runnerRef = useRef<CoalescedAsyncTask | null>(null);
  if (!runnerRef.current) runnerRef.current = createCoalescedAsyncTask(task);
  runnerRef.current.setTask(task);

  useEffect(() => {
    const runner = runnerRef.current;
    runner?.resume();
    return () => runner?.pause();
  }, []);

  return useCallback(() => runnerRef.current?.run() ?? Promise.resolve(), []);
};
