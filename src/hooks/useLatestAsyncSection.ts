import { useCallback, useEffect, useRef, useState } from 'react';

export interface LatestRequestResult<T> {
  applied: boolean;
  value?: T;
}

export interface LatestRequestCoordinator {
  run: <T>(
    key: string,
    task: (signal: AbortSignal) => Promise<T>
  ) => Promise<LatestRequestResult<T>>;
  cancel: () => void;
}

export const createLatestRequestCoordinator = (): LatestRequestCoordinator => {
  let generation = 0;
  let current:
    | {
        key: string;
        controller: AbortController;
        promise: Promise<LatestRequestResult<unknown>>;
      }
    | undefined;

  const cancel = () => {
    generation++;
    current?.controller.abort();
    current = undefined;
  };

  return {
    run: <T>(key: string, task: (signal: AbortSignal) => Promise<T>) => {
      if (current?.key === key) {
        return current.promise as Promise<LatestRequestResult<T>>;
      }

      current?.controller.abort();
      const requestGeneration = ++generation;
      const controller = new AbortController();
      const promise = task(controller.signal)
        .then((value) => ({
          applied: requestGeneration === generation && !controller.signal.aborted,
          value,
        }))
        .catch((error: unknown) => {
          if (requestGeneration !== generation || controller.signal.aborted) {
            return { applied: false };
          }
          throw error;
        })
        .finally(() => {
          if (current?.controller === controller) current = undefined;
        });
      current = { key, controller, promise };
      return promise as Promise<LatestRequestResult<T>>;
    },
    cancel,
  };
};

export interface AsyncSectionState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  updatedAt: number | null;
}

export interface AsyncSection<T> extends AsyncSectionState<T> {
  run: (key: string, task: (signal: AbortSignal) => Promise<T>) => Promise<void>;
  cancel: () => void;
}

export const useLatestAsyncSection = <T>(): AsyncSection<T> => {
  const coordinatorRef = useRef<LatestRequestCoordinator | null>(null);
  if (!coordinatorRef.current) coordinatorRef.current = createLatestRequestCoordinator();
  const [state, setState] = useState<AsyncSectionState<T>>({
    data: null,
    loading: false,
    error: null,
    updatedAt: null,
  });

  useEffect(() => () => coordinatorRef.current?.cancel(), []);

  const run = useCallback(async (key: string, task: (signal: AbortSignal) => Promise<T>) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await coordinatorRef.current!.run(key, task);
      if (!result.applied) return;
      setState({ data: result.value ?? null, loading: false, error: null, updatedAt: Date.now() });
    } catch (error: unknown) {
      setState((current) => ({ ...current, loading: false, error }));
    }
  }, []);

  const cancel = useCallback(() => {
    coordinatorRef.current?.cancel();
    setState((current) => ({ ...current, loading: false }));
  }, []);

  return { ...state, run, cancel };
};
