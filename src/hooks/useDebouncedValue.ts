import { useEffect, useState } from 'react';

export const useDebouncedValue = <T>(value: T, delayMilliseconds: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMilliseconds);
    return () => window.clearTimeout(timer);
  }, [delayMilliseconds, value]);

  return debounced;
};
