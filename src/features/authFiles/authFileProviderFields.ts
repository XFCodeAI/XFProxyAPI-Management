export type AuthFileProviderFieldsPatch = {
  websockets?: boolean;
  using_api?: boolean;
};

export type AuthFileProviderEditorValues = {
  providerKey: string;
  original: Record<string, unknown>;
  websockets: boolean;
  websocketsTouched: boolean;
  usingApi: boolean;
  usingApiTouched: boolean;
};

const TRUTHY_TEXT_VALUES = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSY_TEXT_VALUES = new Set(['false', '0', 'no', 'n', 'off']);

export const parseAuthFileBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TRUTHY_TEXT_VALUES.has(normalized)) return true;
  if (FALSY_TEXT_VALUES.has(normalized)) return false;
  return undefined;
};

export const supportsAuthFileWebsockets = (providerKey: string): boolean =>
  providerKey === 'codex' || providerKey === 'xai';

export const readAuthFileWebsockets = (value: Record<string, unknown>): boolean =>
  parseAuthFileBoolean(value.websockets ?? value.websocket) ?? false;

export const readXAIAuthFileUsingAPI = (value: Record<string, unknown>): boolean => {
  const explicitValue = parseAuthFileBoolean(value.using_api);
  if (explicitValue !== undefined) return explicitValue;

  const authKind = typeof value.auth_kind === 'string' ? value.auth_kind.trim() : '';
  return authKind.toLowerCase() !== 'oauth';
};

export const buildAuthFileProviderFieldsPatch = (
  values: AuthFileProviderEditorValues
): AuthFileProviderFieldsPatch => {
  const patch: AuthFileProviderFieldsPatch = {};

  if (supportsAuthFileWebsockets(values.providerKey) && values.websocketsTouched) {
    if (values.websockets !== readAuthFileWebsockets(values.original)) {
      patch.websockets = values.websockets;
    }
  }

  if (values.providerKey === 'xai' && values.usingApiTouched) {
    if (values.usingApi !== readXAIAuthFileUsingAPI(values.original)) {
      patch.using_api = values.usingApi;
    }
  }

  return patch;
};

export const applyAuthFileProviderFieldsPatch = (
  value: Record<string, unknown>,
  patch: AuthFileProviderFieldsPatch
): Record<string, unknown> => {
  const next = { ...value };

  if (patch.websockets !== undefined) {
    delete next.websocket;
    next.websockets = patch.websockets;
  }
  if (patch.using_api !== undefined) {
    next.using_api = patch.using_api;
  }

  return next;
};
