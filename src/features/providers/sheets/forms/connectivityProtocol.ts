import type { ClaudeAuthMode, OpenAIProviderProtocolMode } from '@/types';

export type OpenAIConnectivityEndpoint = 'chat-completions' | 'responses';
export type OpenAIConnectivityEndpointOrder =
  | readonly [OpenAIConnectivityEndpoint]
  | readonly [OpenAIConnectivityEndpoint, OpenAIConnectivityEndpoint];

export type ConnectivityFailureKind =
  'authentication' | 'unsupported-route' | 'rate-limit' | 'server' | 'protocol';

export interface ConnectivityHTTPClassification {
  ready: boolean;
  reachable: boolean;
  failureKind?: ConnectivityFailureKind;
}

export const classifyConnectivityHTTPStatus = (
  statusCode: number,
  bodyText = ''
): ConnectivityHTTPClassification => {
  if (!Number.isFinite(statusCode) || statusCode <= 0) {
    return { ready: false, reachable: false, failureKind: 'protocol' };
  }
  if (statusCode >= 200 && statusCode < 300) {
    return { ready: true, reachable: true };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { ready: false, reachable: true, failureKind: 'authentication' };
  }
  const lowerBody = String(bodyText).toLowerCase();
  const modelFailure = ['model_not_found', 'invalid_model', 'model not found'].some((value) =>
    lowerBody.includes(value)
  );
  const routeFailure = ['endpoint', 'route', 'not found', 'not supported', 'not implemented'].some(
    (value) => lowerBody.includes(value)
  );
  if (
    statusCode === 405 ||
    statusCode === 501 ||
    (statusCode === 404 && !modelFailure) ||
    (statusCode === 400 && routeFailure && !modelFailure)
  ) {
    return { ready: false, reachable: true, failureKind: 'unsupported-route' };
  }
  if (statusCode === 429) {
    return { ready: false, reachable: true, failureKind: 'rate-limit' };
  }
  if (statusCode >= 500) {
    return { ready: false, reachable: true, failureKind: 'server' };
  }
  return { ready: false, reachable: true, failureKind: 'protocol' };
};

export const resolveClaudeConnectivityAuthMode = (
  authMode: ClaudeAuthMode | '' | undefined,
  endpoint: string
): ClaudeAuthMode => {
  if (authMode === 'x-api-key' || authMode === 'bearer') return authMode;
  try {
    const url = new URL(endpoint);
    if (url.protocol === 'https:' && url.hostname.toLowerCase() === 'api.anthropic.com') {
      return 'x-api-key';
    }
  } catch {
    // Endpoint validation reports malformed URLs before authentication is resolved.
  }
  return 'bearer';
};

export const openAIConnectivityEndpointOrder = (
  protocolMode: OpenAIProviderProtocolMode | undefined
): OpenAIConnectivityEndpointOrder =>
  protocolMode === 'auto' ? ['responses', 'chat-completions'] : ['chat-completions'];

export const isOpenAIEndpointUnsupported = (
  statusCode: number,
  bodyText: string,
  endpoint: OpenAIConnectivityEndpoint
): boolean => {
  if (![400, 404, 405, 501].includes(statusCode)) return false;
  if (statusCode === 405 || statusCode === 501) return true;

  const lower = String(bodyText ?? '')
    .trim()
    .toLowerCase();
  const denied = [
    'model_not_found',
    'invalid_model',
    'invalid api key',
    'authentication',
    'permission',
    'rate_limit',
    'rate limit',
    'quota',
    'billing',
    'insufficient',
  ];
  if (denied.some((value) => lower.includes(value))) return false;

  const explicit =
    (lower.includes('endpoint') || lower.includes('route') || lower.includes(endpoint)) &&
    (lower.includes('unsupported') ||
      lower.includes('not supported') ||
      lower.includes('not found') ||
      lower.includes('not implemented'));
  if (statusCode === 400) {
    return (
      explicit || lower.includes('unsupported_endpoint') || lower.includes('endpoint_not_supported')
    );
  }
  if (!lower) return true;
  return (
    explicit ||
    lower.includes('404 page not found') ||
    lower.includes('cannot post') ||
    (lower.includes('not found') && !lower.includes('model'))
  );
};
