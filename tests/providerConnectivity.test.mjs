import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const {
    buildOpenAIChatCompletionsEndpoint,
    buildOpenAIResponsesEndpoint,
    buildVertexGenerateContentEndpoint,
  } = await server.ssrLoadModule('/src/components/providers/utils.ts');
  const {
    classifyConnectivityHTTPStatus,
    isOpenAIEndpointUnsupported,
    openAIConnectivityEndpointOrder,
    resolveClaudeConnectivityAuthMode,
  } = await server.ssrLoadModule('/src/features/providers/sheets/forms/connectivityProtocol.ts');

  assert.equal(
    buildOpenAIChatCompletionsEndpoint('https://gateway.example'),
    'https://gateway.example/v1/chat/completions'
  );
  assert.equal(
    buildOpenAIResponsesEndpoint('https://gateway.example/v1/chat/completions'),
    'https://gateway.example/v1/responses'
  );
  assert.equal(
    buildOpenAIChatCompletionsEndpoint('https://gateway.example/relay/v4'),
    'https://gateway.example/relay/v4/chat/completions'
  );
  assert.equal(
    buildVertexGenerateContentEndpoint(
      'https://vertex.example/v1/publishers/google/models/stale:generateContent',
      'team/model'
    ),
    'https://vertex.example/v1/publishers/google/models/team%2Fmodel:generateContent'
  );

  assert.deepEqual(classifyConnectivityHTTPStatus(204), { ready: true, reachable: true });
  assert.equal(classifyConnectivityHTTPStatus(401).failureKind, 'authentication');
  assert.equal(classifyConnectivityHTTPStatus(404).failureKind, 'unsupported-route');
  assert.equal(
    classifyConnectivityHTTPStatus(404, '{"error":{"code":"model_not_found"}}').failureKind,
    'protocol'
  );
  assert.equal(classifyConnectivityHTTPStatus(429).failureKind, 'rate-limit');
  assert.equal(classifyConnectivityHTTPStatus(502).failureKind, 'server');
  assert.equal(classifyConnectivityHTTPStatus(0).reachable, false);

  assert.equal(
    resolveClaudeConnectivityAuthMode('', 'https://api.anthropic.com/v1/messages'),
    'x-api-key'
  );
  assert.equal(
    resolveClaudeConnectivityAuthMode('', 'https://claude-gateway.example/v1/messages'),
    'bearer'
  );
  assert.equal(
    resolveClaudeConnectivityAuthMode('x-api-key', 'https://claude-gateway.example/v1/messages'),
    'x-api-key'
  );

  assert.deepEqual(openAIConnectivityEndpointOrder('auto'), ['responses', 'chat-completions']);
  assert.deepEqual(openAIConnectivityEndpointOrder('chat-completions'), ['chat-completions']);
  assert.deepEqual(openAIConnectivityEndpointOrder('preserve-openai'), ['chat-completions']);

  assert.equal(
    isOpenAIEndpointUnsupported(404, '{"detail":"Not Found"}', 'chat-completions'),
    true
  );
  assert.equal(
    isOpenAIEndpointUnsupported(
      404,
      '{"error":{"code":"model_not_found","message":"model not found"}}',
      'chat-completions'
    ),
    false
  );
  assert.equal(
    isOpenAIEndpointUnsupported(401, '{"error":{"message":"invalid api key"}}', 'chat-completions'),
    false
  );
} finally {
  await server.close();
}

console.log('Provider connectivity protocol tests passed');
