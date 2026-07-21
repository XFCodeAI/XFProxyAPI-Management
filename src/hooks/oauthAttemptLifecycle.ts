type OAuthAttemptState = {
  state?: string;
};

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

export function isCurrentOAuthAttempt(
  states: Record<string, OAuthAttemptState>,
  provider: string,
  state: string
): boolean {
  return states[provider]?.state === state;
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
