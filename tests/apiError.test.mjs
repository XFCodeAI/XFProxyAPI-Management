import assert from 'node:assert/strict';
import { parseApiErrorResponse } from '../src/services/api/apiError.ts';

function testParsesXfpaErrorEnvelope() {
  const result = parseApiErrorResponse(
    {
      error: 'plugin_install_failed',
      message: 'download plugin archive: 404 Not Found',
      details: { plugin: 'example' },
    },
    {
      status: 502,
      code: 'ERR_BAD_RESPONSE',
      message: 'Request failed with status code 502',
    }
  );

  assert.deepEqual(result, {
    status: 502,
    code: 'plugin_install_failed',
    message: 'download plugin archive: 404 Not Found',
    details: {
      error: 'plugin_install_failed',
      message: 'download plugin archive: 404 Not Found',
      details: { plugin: 'example' },
    },
  });
}

function testSupportsNestedAndLegacyErrors() {
  assert.deepEqual(
    parseApiErrorResponse(
      { error: { type: 'invalid_config', message: 'plugins-dir is invalid' }, status: '422' },
      'Bad Request'
    ),
    {
      status: 422,
      code: 'invalid_config',
      message: 'plugins-dir is invalid',
      details: {
        error: { type: 'invalid_config', message: 'plugins-dir is invalid' },
        status: '422',
      },
    }
  );

  assert.deepEqual(parseApiErrorResponse({ error: 'invalid body' }, 'Bad Request'), {
    code: 'invalid body',
    message: 'invalid body',
    details: { error: 'invalid body' },
  });
}

function testSupportsTextResponsesAndTransportFallbacks() {
  assert.deepEqual(
    parseApiErrorResponse('upstream unavailable', {
      status: 503,
      code: 'ERR_BAD_RESPONSE',
      message: 'Request failed with status code 503',
    }),
    {
      status: 503,
      code: 'ERR_BAD_RESPONSE',
      message: 'upstream unavailable',
      details: 'upstream unavailable',
    }
  );

  assert.deepEqual(
    parseApiErrorResponse(undefined, {
      status: 408,
      code: 'ECONNABORTED',
      message: 'Request timed out',
      details: { operation: 'load-config' },
    }),
    {
      status: 408,
      code: 'ECONNABORTED',
      message: 'Request timed out',
      details: { operation: 'load-config' },
    }
  );
}

function testRedactsSensitiveFieldsRecursively() {
  const result = parseApiErrorResponse(
    {
      error: 'request_failed',
      message: 'Authorization: Bearer top-secret; cookie=session=hidden',
      details: {
        token: 'secret-token',
        api_key: 'secret-key',
        credentials: { username: 'hidden-user', password: 'hidden-password' },
        nested: [
          { managementKey: 'management-secret' },
          {
            headers: {
              Authorization: 'Bearer header-secret',
              Cookie: 'session=header-hidden',
              'Content-Type': 'application/json',
            },
          },
        ],
        token_usage: { input_tokens: 10 },
        safe: 'visible',
      },
    },
    { status: 502 }
  );

  assert.equal(result.message.includes('top-secret'), false);
  assert.equal(result.message.includes('session=hidden'), false);
  assert.equal(result.details.details.token, '[REDACTED]');
  assert.equal(result.details.details.api_key, '[REDACTED]');
  assert.equal(result.details.details.credentials, '[REDACTED]');
  assert.equal(result.details.details.nested[0].managementKey, '[REDACTED]');
  assert.equal(result.details.details.nested[1].headers.Authorization, '[REDACTED]');
  assert.equal(result.details.details.nested[1].headers.Cookie, '[REDACTED]');
  assert.equal(result.details.details.nested[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(result.details.details.token_usage, { input_tokens: 10 });
  assert.equal(result.details.details.safe, 'visible');

  const serialized = JSON.stringify(result);
  for (const secret of [
    'top-secret',
    'session=hidden',
    'secret-token',
    'secret-key',
    'hidden-user',
    'hidden-password',
    'management-secret',
    'header-secret',
    'header-hidden',
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
}

function testRedactsCredentialsEmbeddedInText() {
  const result = parseApiErrorResponse(
    'request failed for sk-testsecret123 and eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.signature',
    'Network Error'
  );

  assert.equal(result.message.includes('sk-testsecret123'), false);
  assert.equal(result.message.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.equal(JSON.stringify(result.details).includes('testsecret123'), false);
}

const tests = [
  testParsesXfpaErrorEnvelope,
  testSupportsNestedAndLegacyErrors,
  testSupportsTextResponsesAndTransportFallbacks,
  testRedactsSensitiveFieldsRecursively,
  testRedactsCredentialsEmbeddedInText,
];

let failed = 0;
for (const test of tests) {
  try {
    test();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL - ${test.name}`);
    console.error(error);
  }
}

if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}

console.log(`All ${tests.length} API error tests passed`);
