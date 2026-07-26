export interface ApiErrorContext {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
}

export interface ParsedApiErrorResponse {
  status?: number;
  code?: string;
  message: string;
  details?: unknown;
}

const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const CIRCULAR_VALUE = '[CIRCULAR]';
const MAX_DETAIL_DEPTH = 20;
const SENSITIVE_KEY_NAMES = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'bearertoken',
  'apikey',
  'managementkey',
  'privatekey',
  'key',
  'secret',
  'clientsecret',
  'credential',
  'credentials',
  'clientcredential',
  'clientcredentials',
  'password',
  'passwd',
]);
const SENSITIVE_TRAILING_WORDS = new Set([
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'key',
  'password',
  'passwd',
  'secret',
  'token',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSensitiveKey = (key: string): boolean => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const normalized = words.join('');
  return (
    SENSITIVE_KEY_NAMES.has(normalized) ||
    (words.length > 0 && SENSITIVE_TRAILING_WORDS.has(words[words.length - 1]))
  );
};

const redactSensitiveText = (value: string): string =>
  value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(
      /\b(authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|(?:access|refresh|id|api|auth|management|private)[-_ ]?(?:token|key)|token|key|credentials?|client[-_ ]?secret|secret|password|passwd)\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\r\n]+)/gi,
      '$1$2[REDACTED]'
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED_VALUE)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, REDACTED_VALUE);

const sanitizeValue = (value: unknown, ancestors: WeakSet<object>, depth: number): unknown => {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DETAIL_DEPTH) {
    return TRUNCATED_VALUE;
  }
  if (ancestors.has(value)) {
    return CIRCULAR_VALUE;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeValue(entry, ancestors, depth + 1));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = isSensitiveKey(key)
        ? REDACTED_VALUE
        : sanitizeValue(entry, ancestors, depth + 1);
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
};

export const sanitizeApiErrorDetails = (details: unknown): unknown =>
  sanitizeValue(details, new WeakSet<object>(), 0);

const readString = (value: unknown): string =>
  typeof value === 'string' ? redactSensitiveText(value.trim()) : '';

const readStatus = (value: unknown): number | undefined => {
  const status =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{3}$/.test(value.trim())
        ? Number(value)
        : undefined;
  return status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
};

export const parseApiErrorResponse = (
  responseData: unknown,
  fallback: string | ApiErrorContext = ''
): ParsedApiErrorResponse => {
  const context: ApiErrorContext = typeof fallback === 'string' ? { message: fallback } : fallback;
  const responseRecord = isRecord(responseData) ? responseData : null;
  const errorValue = responseRecord?.error;
  const errorRecord = isRecord(errorValue) ? errorValue : null;
  const stringError = readString(errorValue);

  const status =
    readStatus(context.status) ||
    readStatus(responseRecord?.status) ||
    readStatus(responseRecord?.statusCode) ||
    readStatus(errorRecord?.status);
  const code =
    readString(responseRecord?.code) ||
    stringError ||
    readString(errorRecord?.code) ||
    readString(errorRecord?.type) ||
    readString(context.code) ||
    undefined;
  const message =
    readString(responseRecord?.message) ||
    readString(errorRecord?.message) ||
    readString(responseRecord?.detail) ||
    stringError ||
    readString(responseData) ||
    readString(context.message) ||
    'Request failed';
  const detailsSource = responseData !== undefined ? responseData : context.details;

  const parsed: ParsedApiErrorResponse = { message };
  if (status !== undefined) parsed.status = status;
  if (code !== undefined) parsed.code = code;
  if (detailsSource !== undefined) parsed.details = sanitizeApiErrorDetails(detailsSource);
  return parsed;
};
