import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiCallApi, getApiCallErrorMessage, type ApiCallResult } from '@/services/api';
import {
  buildCodexResponsesEndpoint,
  buildClaudeMessagesEndpoint,
  buildGeminiGenerateContentEndpoint,
  buildOpenAIChatCompletionsEndpoint,
  buildOpenAIResponsesEndpoint,
  buildVertexGenerateContentEndpoint,
} from '@/components/providers/utils';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import type { ClaudeAuthMode, OpenAIProviderProtocolMode } from '@/types';
import type { ApiKeyEntryInput, ModelEntryInput, ProviderBrand } from '../../types';
import {
  classifyConnectivityHTTPStatus,
  isOpenAIEndpointUnsupported,
  openAIConnectivityEndpointOrder,
  resolveClaudeConnectivityAuthMode,
  type ConnectivityFailureKind,
} from './connectivityProtocol';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export type ConnectivityState = 'idle' | 'loading' | 'success' | 'error';

export interface ConnectivityStatus {
  state: ConnectivityState;
  message: string;
  reachable?: boolean;
  protocolReady?: boolean;
  failureKind?: ConnectivityFailureKind;
}

const IDLE: ConnectivityStatus = { state: 'idle', message: '' };

const requestFailureMessage = (err: unknown, messages: ConnectivityErrorMessages): string => {
  const raw = getErrorMessage(err);
  const isTimeout =
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      String((err as { code?: string }).code) === 'ECONNABORTED') ||
    raw.toLowerCase().includes('timeout');

  return isTimeout ? messages.timeout(DEFAULT_TIMEOUT_MS / 1000) : raw || messages.requestFailed;
};

const pickModel = (testModel: string | undefined, models: ModelEntryInput[]): string => {
  const trimmed = (testModel ?? '').trim();
  if (trimmed) return trimmed;
  for (const m of models) {
    const name = (m.name ?? '').trim();
    if (name) return name;
  }
  return '';
};

const deleteHeader = (headers: Record<string, string>, name: string): void => {
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (match) delete headers[match];
};

const setRequiredHeader = (headers: Record<string, string>, name: string, value: string): void => {
  deleteHeader(headers, name);
  headers[name] = value;
};

export interface UseConnectivityTestArgs {
  brand: ProviderBrand;
  baseUrl: string;
  testModel?: string;
  models: ModelEntryInput[];
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
  proxyUrl?: string;
  authMode?: ClaudeAuthMode | '';
  protocolMode?: OpenAIProviderProtocolMode;
}

export interface ConnectivityErrorMessages {
  baseUrlRequired: string;
  endpointInvalid: string;
  apiKeyRequired: string;
  modelRequired: string;
  timeout: (seconds: number) => string;
  requestFailed: string;
  authFailed: (status: number, detail: string) => string;
  routeUnsupported: (status: number, detail: string) => string;
  rateLimited: (status: number, detail: string) => string;
  serverFailed: (status: number, detail: string) => string;
  protocolFailed: (status: number, detail: string) => string;
}

const statusFromAPIResult = (
  result: ApiCallResult,
  messages: ConnectivityErrorMessages
): ConnectivityStatus => {
  const classification = classifyConnectivityHTTPStatus(result.statusCode, result.bodyText);
  if (classification.ready) {
    return { state: 'success', message: '', reachable: true, protocolReady: true };
  }
  if (!classification.reachable) {
    return {
      state: 'error',
      message: messages.requestFailed,
      reachable: false,
      protocolReady: false,
    };
  }
  const detail = getApiCallErrorMessage(result);
  const formatters: Record<ConnectivityFailureKind, (status: number, value: string) => string> = {
    authentication: messages.authFailed,
    'unsupported-route': messages.routeUnsupported,
    'rate-limit': messages.rateLimited,
    server: messages.serverFailed,
    protocol: messages.protocolFailed,
  };
  const failureKind = classification.failureKind ?? 'protocol';
  return {
    state: 'error',
    message: formatters[failureKind](result.statusCode, detail),
    reachable: classification.reachable,
    protocolReady: false,
    failureKind,
  };
};

const statusFromRequestError = (
  err: unknown,
  messages: ConnectivityErrorMessages
): ConnectivityStatus => ({
  state: 'error',
  message: requestFailureMessage(err, messages),
  reachable: false,
  protocolReady: false,
});

export interface UseConnectivityTestResult {
  openaiStatuses: ConnectivityStatus[];
  codexStatus: ConnectivityStatus;
  geminiStatus: ConnectivityStatus;
  vertexStatus: ConnectivityStatus;
  claudeStatus: ConnectivityStatus;
  isTestingAny: boolean;
  runOpenAIKey: (idx: number) => Promise<boolean>;
  runOpenAIAllKeys: () => Promise<void>;
  runCodex: () => Promise<void>;
  runGemini: () => Promise<void>;
  runVertex: () => Promise<void>;
  runClaude: () => Promise<void>;
}

export function useConnectivityTest(
  args: UseConnectivityTestArgs,
  messages: ConnectivityErrorMessages
): UseConnectivityTestResult {
  const {
    brand,
    baseUrl,
    testModel,
    models,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
    proxyUrl,
    authMode,
    protocolMode,
  } = args;

  const entriesCount = apiKeyEntries?.length ?? 0;

  const [openaiStatuses, setOpenaiStatuses] = useState<ConnectivityStatus[]>(() =>
    Array.from({ length: entriesCount }, () => IDLE)
  );
  const [codexStatus, setCodexStatus] = useState<ConnectivityStatus>(IDLE);
  const [geminiStatus, setGeminiStatus] = useState<ConnectivityStatus>(IDLE);
  const [vertexStatus, setVertexStatus] = useState<ConnectivityStatus>(IDLE);
  const [claudeStatus, setClaudeStatus] = useState<ConnectivityStatus>(IDLE);
  const [inFlight, setInFlight] = useState(0);

  const entrySignatures = useMemo(
    () =>
      (apiKeyEntries ?? []).map((entry) =>
        [
          entry.apiKey ?? '',
          entry.existingApiKey ?? '',
          entry.authIndex ?? '',
          entry.proxyUrl ?? '',
        ].join('||')
      ),
    [apiKeyEntries]
  );

  const lastEntrySignaturesRef = useRef<string[]>(entrySignatures);
  useEffect(() => {
    const prev = lastEntrySignaturesRef.current;
    const curr = entrySignatures;
    lastEntrySignaturesRef.current = curr;

    setOpenaiStatuses((statuses) => {
      const nextLen = curr.length;
      let mutated = statuses.length !== nextLen;
      const next = statuses.slice(0, nextLen);
      while (next.length < nextLen) next.push(IDLE);
      for (let i = 0; i < nextLen; i++) {
        if (prev[i] !== undefined && prev[i] !== curr[i] && next[i].state !== 'idle') {
          next[i] = IDLE;
          mutated = true;
        }
      }
      return mutated ? next : statuses;
    });
  }, [entrySignatures]);

  const signature = useMemo(() => {
    const h = formHeaders.map((it) => `${it.key}:${it.value}`).join('|');
    const m = models.map((it) => `${it.name}:${it.alias ?? ''}`).join('|');
    return [
      baseUrl,
      (testModel ?? '').trim(),
      apiKey ?? '',
      fallbackApiKey ?? '',
      authIndex ?? '',
      proxyUrl ?? '',
      authMode ?? '',
      protocolMode ?? '',
      h,
      m,
    ].join('||');
  }, [
    apiKey,
    authIndex,
    authMode,
    baseUrl,
    fallbackApiKey,
    formHeaders,
    models,
    protocolMode,
    proxyUrl,
    testModel,
  ]);

  const lastSignatureRef = useRef(signature);
  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    setOpenaiStatuses((prev) => prev.map(() => IDLE));
    setCodexStatus(IDLE);
    setGeminiStatus(IDLE);
    setVertexStatus(IDLE);
    setClaudeStatus(IDLE);
  }, [signature]);

  const updateOpenaiStatus = useCallback((idx: number, value: ConnectivityStatus) => {
    setOpenaiStatuses((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const runOpenAIKey = useCallback(
    async (idx: number): Promise<boolean> => {
      if (brand !== 'openaiCompatibility') return false;

      const trimmedBase = baseUrl.trim();
      if (!trimmedBase) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.baseUrlRequired,
        });
        return false;
      }
      const chatEndpoint = buildOpenAIChatCompletionsEndpoint(trimmedBase);
      const responsesEndpoint = buildOpenAIResponsesEndpoint(trimmedBase);
      if (!chatEndpoint || !responsesEndpoint) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.endpointInvalid,
        });
        return false;
      }
      const entry = apiKeyEntries?.[idx];
      const entryKey = (entry?.apiKey ?? '').trim() || (entry?.existingApiKey ?? '').trim();
      const entryProxyURL = entry?.proxyUrl ?? '';
      const resolvedAuthIndex =
        (entry?.authIndex ?? '').trim() || (authIndex ?? '').trim() || undefined;
      if (!entryKey && !resolvedAuthIndex) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.apiKeyRequired,
        });
        return false;
      }
      const model = pickModel(testModel, models);
      if (!model) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.modelRequired,
        });
        return false;
      }

      const headerObj: Record<string, string> = {
        'Content-Type': 'application/json',
        ...buildHeaderObject(formHeaders),
      };
      setRequiredHeader(
        headerObj,
        'Authorization',
        entryKey ? `Bearer ${entryKey}` : 'Bearer $TOKEN$'
      );

      updateOpenaiStatus(idx, { state: 'loading', message: '' });
      setInFlight((n) => n + 1);
      try {
        const requestEndpoint = async (kind: 'chat-completions' | 'responses') =>
          apiCallApi.request(
            {
              authIndex: resolvedAuthIndex,
              proxyUrl: entryProxyURL,
              method: 'POST',
              url: kind === 'responses' ? responsesEndpoint : chatEndpoint,
              header: headerObj,
              data: JSON.stringify(
                kind === 'responses'
                  ? { model, input: 'Hi', stream: false, max_output_tokens: 5 }
                  : {
                      model,
                      messages: [{ role: 'user', content: 'Hi' }],
                      stream: false,
                      max_tokens: 5,
                    }
              ),
            },
            { timeout: DEFAULT_TIMEOUT_MS }
          );

        const endpointOrder = openAIConnectivityEndpointOrder(protocolMode);
        const primaryEndpoint = endpointOrder[0];
        const fallbackEndpoint = endpointOrder[1];
        let result = await requestEndpoint(primaryEndpoint);
        if (
          fallbackEndpoint &&
          isOpenAIEndpointUnsupported(result.statusCode, result.bodyText, primaryEndpoint)
        ) {
          result = await requestEndpoint(fallbackEndpoint);
        }
        const status = statusFromAPIResult(result, messages);
        updateOpenaiStatus(idx, status);
        return status.state === 'success';
      } catch (err) {
        updateOpenaiStatus(idx, statusFromRequestError(err, messages));
        return false;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      formHeaders,
      messages,
      models,
      protocolMode,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runOpenAIAllKeys = useCallback(async (): Promise<void> => {
    if (brand !== 'openaiCompatibility') return;
    const entries = apiKeyEntries ?? [];
    if (!entries.length) return;
    await Promise.all(entries.map((_, idx) => runOpenAIKey(idx)));
  }, [apiKeyEntries, brand, runOpenAIKey]);

  const runCodex = useCallback(async (): Promise<void> => {
    if (brand !== 'codex' && brand !== 'xai') return;

    const trimmedBase = baseUrl.trim();
    if (!trimmedBase) {
      setCodexStatus({ state: 'error', message: messages.baseUrlRequired });
      return;
    }

    const endpoint = buildCodexResponsesEndpoint(trimmedBase);
    if (!endpoint) {
      setCodexStatus({ state: 'error', message: messages.endpointInvalid });
      return;
    }

    const model = pickModel(testModel, models);
    if (!model) {
      setCodexStatus({ state: 'error', message: messages.modelRequired });
      return;
    }

    const customHeaders = buildHeaderObject(formHeaders);
    const explicitKey = (apiKey ?? '').trim();
    const persistedKey = (fallbackApiKey ?? '').trim();
    const resolvedKey = explicitKey || persistedKey;
    const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;

    if (!resolvedKey && !resolvedAuthIndex) {
      setCodexStatus({ state: 'error', message: messages.apiKeyRequired });
      return;
    }

    const headerObj: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    setRequiredHeader(
      headerObj,
      'Authorization',
      resolvedKey ? `Bearer ${resolvedKey}` : 'Bearer $TOKEN$'
    );

    setCodexStatus({ state: 'loading', message: '' });
    setInFlight((n) => n + 1);
    try {
      const result = await apiCallApi.request(
        {
          authIndex: resolvedAuthIndex,
          proxyUrl: proxyUrl ?? '',
          method: 'POST',
          url: endpoint,
          header: headerObj,
          data: JSON.stringify({
            model,
            input: 'Hi',
            stream: false,
          }),
        },
        { timeout: DEFAULT_TIMEOUT_MS }
      );
      setCodexStatus(statusFromAPIResult(result, messages));
    } catch (err) {
      setCodexStatus(statusFromRequestError(err, messages));
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [
    apiKey,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    messages,
    models,
    proxyUrl,
    testModel,
  ]);

  const runGemini = useCallback(async (): Promise<void> => {
    if (brand !== 'gemini') return;

    const model = pickModel(testModel, models);
    if (!model) {
      setGeminiStatus({ state: 'error', message: messages.modelRequired });
      return;
    }

    const endpoint = buildGeminiGenerateContentEndpoint(baseUrl ?? '', model);
    if (!endpoint) {
      setGeminiStatus({ state: 'error', message: messages.endpointInvalid });
      return;
    }

    const customHeaders = buildHeaderObject(formHeaders);
    const explicitKey = (apiKey ?? '').trim();
    const persistedKey = (fallbackApiKey ?? '').trim();
    const hasApiKeyHeader = hasHeader(customHeaders, 'x-goog-api-key');
    const resolvedKey = explicitKey || persistedKey;
    const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;

    if (!resolvedKey && !hasApiKeyHeader && !resolvedAuthIndex) {
      setGeminiStatus({ state: 'error', message: messages.apiKeyRequired });
      return;
    }

    const headerObj: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    if (!hasHeader(headerObj, 'x-goog-api-key')) {
      if (resolvedKey) {
        headerObj['x-goog-api-key'] = resolvedKey;
      } else if (resolvedAuthIndex) {
        headerObj['x-goog-api-key'] = '$TOKEN$';
      }
    }

    setGeminiStatus({ state: 'loading', message: '' });
    setInFlight((n) => n + 1);
    try {
      const result = await apiCallApi.request(
        {
          authIndex: resolvedAuthIndex,
          proxyUrl: proxyUrl ?? '',
          method: 'POST',
          url: endpoint,
          header: headerObj,
          data: JSON.stringify({
            contents: [{ parts: [{ text: 'Hi' }] }],
            generationConfig: { maxOutputTokens: 8 },
          }),
        },
        { timeout: DEFAULT_TIMEOUT_MS }
      );
      setGeminiStatus(statusFromAPIResult(result, messages));
    } catch (err) {
      setGeminiStatus(statusFromRequestError(err, messages));
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [
    apiKey,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    messages,
    models,
    proxyUrl,
    testModel,
  ]);

  const runVertex = useCallback(async (): Promise<void> => {
    if (brand !== 'vertex') return;

    const model = pickModel(testModel, models);
    if (!model) {
      setVertexStatus({ state: 'error', message: messages.modelRequired });
      return;
    }
    const endpoint = buildVertexGenerateContentEndpoint(baseUrl ?? '', model);
    if (!endpoint) {
      setVertexStatus({ state: 'error', message: messages.endpointInvalid });
      return;
    }

    const resolvedKey = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
    const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;
    if (!resolvedKey && !resolvedAuthIndex) {
      setVertexStatus({ state: 'error', message: messages.apiKeyRequired });
      return;
    }
    const headerObj: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildHeaderObject(formHeaders),
    };
    setRequiredHeader(headerObj, 'x-goog-api-key', resolvedKey ? resolvedKey : '$TOKEN$');
    deleteHeader(headerObj, 'Authorization');

    setVertexStatus({ state: 'loading', message: '' });
    setInFlight((n) => n + 1);
    try {
      const result = await apiCallApi.request(
        {
          authIndex: resolvedAuthIndex,
          proxyUrl: proxyUrl ?? '',
          method: 'POST',
          url: endpoint,
          header: headerObj,
          data: JSON.stringify({
            contents: [{ parts: [{ text: 'Hi' }] }],
            generationConfig: { maxOutputTokens: 8 },
          }),
        },
        { timeout: DEFAULT_TIMEOUT_MS }
      );
      setVertexStatus(statusFromAPIResult(result, messages));
    } catch (err) {
      setVertexStatus(statusFromRequestError(err, messages));
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [
    apiKey,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    messages,
    models,
    proxyUrl,
    testModel,
  ]);

  const runClaude = useCallback(async (): Promise<void> => {
    if (brand !== 'claude') return;

    const endpoint = buildClaudeMessagesEndpoint(baseUrl ?? '');
    if (!endpoint) {
      setClaudeStatus({ state: 'error', message: messages.endpointInvalid });
      return;
    }
    const model = pickModel(testModel, models);
    if (!model) {
      setClaudeStatus({ state: 'error', message: messages.modelRequired });
      return;
    }

    const customHeaders = buildHeaderObject(formHeaders);
    const explicitKey = (apiKey ?? '').trim();
    const persistedKey = (fallbackApiKey ?? '').trim();
    const resolvedKey = explicitKey || persistedKey;
    const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;

    if (!resolvedKey && !resolvedAuthIndex) {
      setClaudeStatus({ state: 'error', message: messages.apiKeyRequired });
      return;
    }

    const headerObj: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    if (!hasHeader(headerObj, 'anthropic-version')) {
      headerObj['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
    }
    const credential = resolvedKey || '$TOKEN$';
    if (resolveClaudeConnectivityAuthMode(authMode, endpoint) === 'x-api-key') {
      deleteHeader(headerObj, 'Authorization');
      setRequiredHeader(headerObj, 'x-api-key', credential);
    } else {
      deleteHeader(headerObj, 'x-api-key');
      setRequiredHeader(headerObj, 'Authorization', `Bearer ${credential}`);
    }

    setClaudeStatus({ state: 'loading', message: '' });
    setInFlight((n) => n + 1);
    try {
      const result = await apiCallApi.request(
        {
          authIndex: resolvedAuthIndex,
          proxyUrl: proxyUrl ?? '',
          method: 'POST',
          url: endpoint,
          header: headerObj,
          data: JSON.stringify({
            model,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        },
        { timeout: DEFAULT_TIMEOUT_MS }
      );
      setClaudeStatus(statusFromAPIResult(result, messages));
    } catch (err) {
      setClaudeStatus(statusFromRequestError(err, messages));
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [
    apiKey,
    authIndex,
    authMode,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    messages,
    models,
    proxyUrl,
    testModel,
  ]);

  return {
    openaiStatuses,
    codexStatus,
    geminiStatus,
    vertexStatus,
    claudeStatus,
    isTestingAny: inFlight > 0,
    runOpenAIKey,
    runOpenAIAllKeys,
    runCodex,
    runGemini,
    runVertex,
    runClaude,
  };
}
