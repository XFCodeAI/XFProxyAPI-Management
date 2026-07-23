import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

const identity = (overrides = {}) => ({
  recorded_id: '',
  display_name: '',
  current_id: '',
  current: false,
  ...overrides,
});

const monitoringWire = {
  available: true,
  generated_at: '2026-07-23T02:00:00Z',
  snapshot_at: '2026-07-23T02:00:00Z',
  summary: {
    requests: 1,
    successes: 1,
    failures: 0,
    input_tokens: 12,
    output_tokens: 6,
    reasoning_tokens: 2,
    cache_read_tokens: 4,
    cache_creation_tokens: 0,
    total_tokens: 20,
    average_latency_ms: 150,
    p95_latency_ms: 150,
    average_ttft_ms: 40,
    cache_hits: 1,
  },
  cost: {
    amount: '0.00125',
    currency: 'USD',
    complete_calls: 1,
    partial_calls: 0,
    unpriced_calls: 0,
    free_calls: 0,
    missing_dimensions: null,
    catalog_version: 3,
    truncated: false,
  },
  facets: {
    providers: [{ value: 'codex', count: 1 }],
    resolved_models: [{ value: 'gpt-5.6', count: 1 }],
    requested_models: [{ value: 'gpt-5.6', count: 1 }],
    failure_categories: [],
  },
  credentials: [
    {
      recorded_id: 'auth-1',
      display_name: 'codex-user@example.com',
      provider: 'codex',
      requests: 1,
      failures: 0,
      total_tokens: 20,
      average_latency_ms: 150,
      last_request_at: '2026-07-23T01:59:00Z',
      current_id: 'auth-1',
      current: true,
    },
  ],
  api_keys: [],
  requests: [
    {
      id: 'event-1',
      request_id: 'request-1',
      requested_at: '2026-07-23T01:59:00Z',
      ingested_at: '2026-07-23T01:59:01Z',
      provider: 'codex',
      executor_type: 'codex',
      resolved_model: 'gpt-5.6',
      requested_model: 'gpt-5.6',
      auth_type: 'oauth',
      auth_index: 'auth-1',
      reasoning_effort: 'high',
      service_tier: '',
      response_service_tier: '',
      generate: false,
      tokens: {
        input: 12,
        output: 6,
        reasoning: 2,
        cached: 4,
        cache_read: 4,
        cache_creation: 0,
        total: 20,
      },
      latency_ms: 150,
      ttft_ms: 40,
      result: 'success',
      failure_category: '',
      response_headers: { 'x-request-id': ['request-1'] },
      identities: {
        credential: identity({
          recorded_id: 'auth-1',
          display_name: 'codex-user@example.com',
          current_id: 'auth-1',
          current: true,
        }),
        api_key: identity(),
        credential_groups: [],
        api_key_groups: [],
        plugin: identity(),
        source: identity(),
        proxy_pool: identity(),
      },
      cost: {
        estimate: true,
        currency: 'USD',
        amount: '0.00125',
        coverage: 'complete',
        missing_dimensions: null,
        rule_id: 'price-1',
        rule_source: 'manual',
        catalog_version: 3,
      },
    },
  ],
  next_cursor: 'cursor-2',
};

try {
  const api = await server.ssrLoadModule('/src/services/api/requestMonitoring.ts');
  const client = await server.ssrLoadModule('/src/services/api/client.ts');
  const viewModel = await server.ssrLoadModule('/src/features/requestMonitoring/viewModel.ts');

  const normalized = api.normalizeMonitoringResponse(monitoringWire);
  assert.equal(normalized.requests[0].statusCode, 0);
  assert.deepEqual(normalized.requests[0].cost.missingDimensions, []);
  assert.deepEqual(normalized.cost.missingDimensions, {});
  assert.equal(normalized.credentials[0].currentId, 'auth-1');
  assert.equal(normalized.nextCursor, 'cursor-2');

  assert.throws(
    () =>
      api.normalizeMonitoringResponse({
        ...monitoringWire,
        requests: [{ ...monitoringWire.requests[0], status_code: '200' }],
      }),
    /request_monitoring_invalid_response:monitoring.requests\[0\].status_code/
  );
  assert.throws(
    () =>
      api.normalizeMonitoringResponse({
        ...monitoringWire,
        requests: [
          {
            ...monitoringWire.requests[0],
            cost: { ...monitoringWire.requests[0].cost, missing_dimensions: ['input', 4] },
          },
        ],
      }),
    /request_monitoring_invalid_response:monitoring.requests\[0\].cost.missing_dimensions\[1\]/
  );

  const query = new URLSearchParams(
    api.buildMonitoringQuery({
      from: '2026-07-22T00:00:00Z',
      to: '2026-07-23T00:00:00Z',
      search: '  request-1  ',
      statusCode: 0,
      minLatencyMs: 250,
      cache: 'hit',
      cursor: 'cursor-1',
      limit: 50,
    })
  );
  assert.equal(query.get('search'), 'request-1');
  assert.equal(query.get('status_code'), '0');
  assert.equal(query.get('min_latency_ms'), '250');
  assert.equal(query.get('cursor'), 'cursor-1');

  const calls = [];
  const originalGet = client.apiClient.get;
  try {
    client.apiClient.get = async (url) => {
      calls.push(url);
      return monitoringWire;
    };
    const response = await api.requestMonitoringApi.get({
      from: '2026-07-22T00:00:00Z',
      to: '2026-07-23T00:00:00Z',
      limit: 50,
    });
    assert.equal(response.requests.length, 1);
    assert.match(calls[0], /^\/usage-analytics\/monitoring\?/);
  } finally {
    client.apiClient.get = originalGet;
  }

  const now = new Date('2026-07-23T02:00:00Z');
  assert.deepEqual(viewModel.buildMonitoringRange('1h', now), {
    from: '2026-07-23T01:00:00.000Z',
    to: '2026-07-23T02:00:00.000Z',
  });
  assert.equal(viewModel.buildMonitoringRange('custom', now, '2026-07-23T02:00:00Z', 'bad'), null);

  const requestQuery = viewModel.buildMonitoringRequestQuery(
    { from: 'from', to: 'to' },
    {
      ...viewModel.EMPTY_MONITORING_FILTERS,
      search: '  request-1 ',
      provider: 'codex',
      minLatencyMs: '-2',
    },
    'next'
  );
  assert.equal(requestQuery.search, 'request-1');
  assert.equal(requestQuery.provider, 'codex');
  assert.equal(requestQuery.result, '');
  assert.equal(requestQuery.minLatencyMs, undefined);
  assert.equal(requestQuery.cursor, 'next');
  assert.equal(requestQuery.limit, 50);

  const fullFilters = {
    ...viewModel.EMPTY_MONITORING_FILTERS,
    search: 'request / one',
    provider: 'openai-compatible',
    pluginId: 'plugin/one + beta',
    requestedModel: 'gpt-5.6/requested',
    resolvedModel: 'gpt-5.6 resolved',
    result: 'failure',
    failureCategory: 'upstream/error',
    authId: 'auth:user@example.com',
    apiKeyId: `hmac-sha256:${'a'.repeat(64)}`,
    credentialGroupId: 'credential/group one',
    apiKeyGroupId: 'api-key/group two',
    proxyPoolId: 'pool:edge/eu',
    cache: 'miss',
    statusCode: '429',
    minLatencyMs: '250',
    maxLatencyMs: '5000',
    requestId: 'request?id=one',
    trace: 'trace/value + one',
  };
  const fullRange = {
    from: '2026-07-22T01:02:03.456+08:00',
    to: '2026-07-23T04:05:06.789+08:00',
  };
  const fullRequestQuery = viewModel.buildMonitoringRequestQuery(fullRange, fullFilters);
  assert.equal(fullRequestQuery.pluginId, fullFilters.pluginId);
  assert.equal(fullRequestQuery.requestedModel, fullFilters.requestedModel);
  assert.equal(fullRequestQuery.credentialGroupId, fullFilters.credentialGroupId);
  assert.equal(fullRequestQuery.apiKeyGroupId, fullFilters.apiKeyGroupId);
  assert.equal(fullRequestQuery.proxyPoolId, fullFilters.proxyPoolId);
  assert.equal(fullRequestQuery.statusCode, 429);
  assert.equal(fullRequestQuery.maxLatencyMs, 5000);

  const drillHref = viewModel.buildMonitoringDrillHref(
    fullRange,
    fullFilters,
    '?campaign=q4&campaign=cost&raw_api_key=sk-secret&key=another-secret'
  );
  assert.equal(drillHref.includes('sk-secret'), false);
  assert.equal(drillHref.includes('another-secret'), false);
  assert.equal(drillHref.includes('raw_api_key'), false);
  const drillParams = new URLSearchParams(drillHref.slice(drillHref.indexOf('?') + 1));
  assert.deepEqual(drillParams.getAll('campaign'), ['q4', 'cost']);
  assert.equal(drillParams.get('api_key_id'), fullFilters.apiKeyId);
  assert.equal(drillParams.get('plugin_id'), fullFilters.pluginId);
  assert.equal(drillParams.get('credential_group_id'), fullFilters.credentialGroupId);
  assert.equal(drillParams.get('max_latency_ms'), '5000');
  assert.match(drillHref, /api_key_id=hmac-sha256%3A[a-f0-9]{64}/);
  assert.match(drillHref, /plugin_id=plugin%2Fone\+%2B\+beta/);

  const parsedDrill = viewModel.parseMonitoringDrillQuery(
    `https://example.test/management.html#${drillHref}`
  );
  assert.deepEqual(parsedDrill.range, fullRange);
  assert.deepEqual(parsedDrill.filters, fullFilters);
  assert.equal(parsedDrill.preservedQuery, 'campaign=q4&campaign=cost');
  const rebuiltHref = viewModel.buildMonitoringDrillHref(
    parsedDrill.range,
    parsedDrill.filters,
    parsedDrill.preservedQuery
  );
  assert.equal(rebuiltHref, drillHref);

  const invalidDrill = viewModel.parseMonitoringDrillQuery(
    '/monitoring?from=not-a-date&to=2026-07-23T00%3A00%3A00Z&status_code=2.5' +
      '&min_latency_ms=-1&max_latency_ms=Infinity&result=unknown&cache=unknown' +
      '&api_key=sk-raw&authorization=Bearer+secret&api_key_id=sk-raw-in-id-field'
  );
  assert.equal(invalidDrill.range, null);
  assert.equal(invalidDrill.filters.statusCode, '');
  assert.equal(invalidDrill.filters.minLatencyMs, '');
  assert.equal(invalidDrill.filters.maxLatencyMs, '');
  assert.equal(
    viewModel.buildMonitoringDrillHref(
      { from: '2026-07-22T00:00:00Z', to: '2026-07-23T00:00:00Z' },
      {},
      'access_token=secret&session_cookie=secret&safe_view=analytics'
    ),
    '/monitoring?safe_view=analytics&from=2026-07-22T00%3A00%3A00Z&to=2026-07-23T00%3A00%3A00Z'
  );
  assert.equal(invalidDrill.filters.result, 'all');
  assert.equal(invalidDrill.filters.cache, 'all');
  assert.equal(invalidDrill.filters.apiKeyId, 'all');
  assert.equal(invalidDrill.preservedQuery.includes('secret'), false);

  const unsafeRuntimeInput = {
    from: fullRange.from,
    to: fullRange.to,
    apiKeyId: `hmac-sha256:${'b'.repeat(64)}`,
    apiKey: 'sk-must-not-leak',
    rawApiKey: 'sk-also-must-not-leak',
  };
  const safeAPIQuery = api.buildMonitoringQuery(unsafeRuntimeInput);
  assert.equal(safeAPIQuery.includes('sk-must-not-leak'), false);
  assert.equal(safeAPIQuery.includes('sk-also-must-not-leak'), false);
  assert.equal(
    new URLSearchParams(safeAPIQuery).get('api_key_id'),
    `hmac-sha256:${'b'.repeat(64)}`
  );
  assert.equal(
    api
      .buildMonitoringQuery({
        from: fullRange.from,
        to: fullRange.to,
        apiKeyId: 'sk-raw-in-id-field',
      })
      .includes('sk-raw-in-id-field'),
    false
  );

  assert.equal(viewModel.monitoringSuccessRate(normalized.summary), 100);
  assert.equal(viewModel.monitoringCacheRate(normalized.summary), 100);
  assert.equal(
    viewModel.monitoringIdentityLabel(normalized.requests[0].identities.credential, 'missing'),
    'codex-user@example.com'
  );
  assert.equal(
    viewModel.isCurrentMonitoringIdentity(normalized.requests[0].identities.credential),
    true
  );
  assert.equal(viewModel.hasCurrentMonitoringTarget(normalized.requests[0]), true);
  const historicalRequest = {
    ...normalized.requests[0],
    identities: {
      ...normalized.requests[0].identities,
      credential: { ...normalized.requests[0].identities.credential, current: false },
    },
  };
  assert.equal(viewModel.hasCurrentMonitoringTarget(historicalRequest), false);
  assert.equal(viewModel.isCurrentMonitoringIdentity({ current: true, currentId: '' }), false);
  assert.equal(viewModel.hasMonitoringEvidence(normalized.requests[0]), true);
  assert.equal(
    viewModel.hasMonitoringEvidence({
      ...normalized.requests[0],
      requestId: '',
      responseHeaders: {},
    }),
    false
  );

  const older = {
    ...normalized.requests[0],
    id: 'event-0',
    requestedAt: '2026-07-23T01:58:00Z',
  };
  const replacement = { ...normalized.requests[0], latencyMs: 99 };
  const merged = viewModel.mergeMonitoringRequests([normalized.requests[0], older], [replacement]);
  assert.deepEqual(
    merged.map((request) => request.id),
    ['event-1', 'event-0']
  );
  assert.equal(merged[0].latencyMs, 99);

  assert.equal(api.isMonitoringCapabilityUnavailable({ status: 404 }), true);
  assert.equal(api.isMonitoringCapabilityUnavailable({ status: 500 }), false);
} finally {
  await server.close();
}
