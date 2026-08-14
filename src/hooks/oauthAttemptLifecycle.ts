export type OAuthAttemptToken = {
  provider: string;
  connectionFingerprint: string;
  id: number;
};

const normalizeConnectionPart = (value: unknown): string => String(value ?? '').trim();

export function createOAuthConnectionFingerprint(apiBase: string, managementKey: string): string {
  const normalizedBase = normalizeConnectionPart(apiBase).replace(/\/+$/, '');
  const normalizedKey = normalizeConnectionPart(managementKey);
  if (!normalizedBase || !normalizedKey) return '';

  const input = `${normalizedBase}\u0000${normalizedKey}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }
  return `v1:${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
}

export function createOAuthAttemptToken(
  provider: string,
  connectionFingerprint: string,
  id: number
): OAuthAttemptToken {
  return {
    provider: provider.trim().toLowerCase(),
    connectionFingerprint: connectionFingerprint.trim(),
    id,
  };
}

export function oauthAttemptTokenKey(token: OAuthAttemptToken): string {
  return JSON.stringify([token.provider, token.connectionFingerprint, token.id]);
}

export function isCurrentOAuthAttemptToken(
  started: OAuthAttemptToken,
  current: OAuthAttemptToken | undefined,
  currentConnectionFingerprint: string
): boolean {
  return Boolean(
    current &&
    started.provider === current.provider &&
    started.connectionFingerprint === current.connectionFingerprint &&
    started.id === current.id &&
    started.connectionFingerprint === currentConnectionFingerprint
  );
}

export function beginOAuthCallbackSubmission(
  submissions: Record<string, string | undefined>,
  provider: string,
  state: string
): boolean {
  if (submissions[provider] !== undefined) return false;
  submissions[provider] = state;
  return true;
}

export function finishOAuthCallbackSubmission(
  submissions: Record<string, string | undefined>,
  provider: string,
  state: string
): void {
  if (submissions[provider] === state) {
    delete submissions[provider];
  }
}

export function oauthCallbackReportsError(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  let params: URLSearchParams;
  try {
    params = new URL(trimmed).searchParams;
  } catch {
    const queryStart = trimmed.indexOf('?');
    const hashStart = trimmed.indexOf('#');
    const rawParams =
      queryStart >= 0
        ? trimmed.slice(queryStart + 1)
        : hashStart >= 0
          ? trimmed.slice(hashStart + 1)
          : trimmed;
    params = new URLSearchParams(rawParams.replace(/^[?#]/, ''));
  }
  return Boolean(params.get('error')?.trim() || params.get('error_description')?.trim());
}
