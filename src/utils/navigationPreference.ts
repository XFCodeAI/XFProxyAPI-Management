export function readNavigationPreference<T extends string>(
  key: string,
  validValues?: readonly T[]
): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key)?.trim();
    if (!value) return null;
    if (validValues && !validValues.includes(value as T)) return null;
    return value as T;
  } catch {
    return null;
  }
}

export function writeNavigationPreference(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 浏览器隐私模式或存储配额异常时，导航偏好丢失不影响主流程。
  }
}
