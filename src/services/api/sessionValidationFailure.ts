export type AuthFileSessionValidationFailure = {
  name: string;
  error: string;
  statusCode?: number;
  importable: boolean;
  proxyUrl: string;
};

export const normalizeSessionValidationFailures = (
  value: unknown
): AuthFileSessionValidationFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileSessionValidationFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';
    if (!name && !error) return result;

    const statusValue = Number(entry.status_code);
    const statusCode = Number.isInteger(statusValue) && statusValue > 0 ? statusValue : undefined;
    result.push({
      name,
      error: error || 'Unknown error',
      ...(statusCode === undefined ? {} : { statusCode }),
      importable: entry.importable === true,
      proxyUrl: typeof entry.proxy_url === 'string' ? entry.proxy_url.trim() : '',
    });
    return result;
  }, []);
};
