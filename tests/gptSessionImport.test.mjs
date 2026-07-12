import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  consumeGptSessionInput,
  parseGptSessionTextToCpa,
} from '../src/features/authFiles/gptSessionImport.ts';

if (!globalThis.atob) {
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');
}
if (!globalThis.btoa) {
  globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
}

const fixedNow = new Date('2026-06-30T10:00:00.000Z');

function jwtWithPayload(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.');
}

function testChatGptSessionConvertsToCpa() {
  const result = parseGptSessionTextToCpa(
    JSON.stringify({
      user: {
        id: 'user-test',
        email: 'mark@example.com',
      },
      account: {
        id: 'chatgpt-account-1',
        planType: 'plus',
      },
      accessToken: 'access-token',
      sessionToken: 'session-token',
    }),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.missingRefreshTokenCount, 1);
  assert.equal(result.syntheticIdTokenCount, 1);

  const auth = result.records[0].cpa;
  assert.equal(auth.type, 'codex');
  assert.equal(auth.email, 'mark@example.com');
  assert.equal(auth.account_id, 'chatgpt-account-1');
  assert.equal(auth.plan_type, 'plus');
  assert.equal(auth.access_token, 'access-token');
  assert.equal(auth.refresh_token, '');
  assert.equal(auth.session_token, 'session-token');
  assert.equal(auth.id_token_synthetic, true);
  assert.equal(auth.id_token.split('.').length, 3);
  assert.equal(auth.last_refresh, fixedNow.toISOString());
  assert.equal(result.records[0].fileName, 'codex-mark@example-plus.json');
}

function testPreservesRefreshAndIdToken() {
  const result = parseGptSessionTextToCpa(
    JSON.stringify({
      email: 'refreshable@example.com',
      accessToken: 'access-token',
      refreshToken: 'real-refresh-token',
      idToken: 'real.header.signature',
      tokens: {
        account_id: 'chatgpt-account-2',
      },
    }),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.missingRefreshTokenCount, 0);
  assert.equal(result.syntheticIdTokenCount, 0);

  const auth = result.records[0].cpa;
  assert.equal(auth.refresh_token, 'real-refresh-token');
  assert.equal(auth.id_token, 'real.header.signature');
  assert.equal(auth.id_token_synthetic, undefined);
  assert.equal(auth.expired, undefined);
  assert.equal(auth.account_id, 'chatgpt-account-2');
}

function testPreservesRootProxyURL() {
  const result = parseGptSessionTextToCpa(
    JSON.stringify({
      email: 'proxied@example.com',
      accessToken: 'access-token',
      proxyUrl: '  socks5://user:pass@127.0.0.1:1080  ',
      tokens: {
        account_id: 'proxied-account',
      },
    }),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cpa.proxy_url, 'socks5://user:pass@127.0.0.1:1080');
  assert.equal(result.records[0].cpa.proxyUrl, undefined);
}

function testNestedMultipleSessionsUseAccessTokenExpiry() {
  const result = parseGptSessionTextToCpa(
    JSON.stringify({
      accounts: [
        {
          email: 'late@example.com',
          access_token: jwtWithPayload({
            exp: 1780473960,
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'chatgpt-account-late',
            },
          }),
        },
        {
          email: 'early@example.com',
          access_token: jwtWithPayload({
            exp: 1780000000,
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'chatgpt-account-early',
            },
          }),
        },
      ],
    }),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].cpa.expired, '2026-06-03T08:06:00.000Z');
  assert.equal(result.records[1].cpa.expired, '2026-05-28T20:26:40.000Z');
}

function testInvalidInputReportsIssue() {
  const result = parseGptSessionTextToCpa(JSON.stringify({ items: [{ value: 1 }] }), {
    now: fixedNow,
  });

  assert.equal(result.records.length, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].reason, /未找到/);
}

function testLineDelimitedSessionsConvertIndependently() {
  const result = parseGptSessionTextToCpa(
    [
      JSON.stringify({
        email: 'first@example.com',
        accessToken: 'first-access-token',
        tokens: {
          account_id: 'first-account',
        },
      }),
      JSON.stringify({
        email: 'second@example.com',
        accessToken: 'second-access-token',
        tokens: {
          account_id: 'second-account',
        },
      }),
    ].join('\n'),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 2);
  assert.equal(result.issues.length, 0);
  assert.equal(result.records[0].sourceName, 'line 1');
  assert.equal(result.records[1].sourceName, 'line 2');
  assert.equal(result.records[0].fileName, 'codex-first@example.json');
  assert.equal(result.records[1].fileName, 'codex-second@example.json');
  assert.equal(result.records[0].cpa.access_token, 'first-access-token');
  assert.equal(result.records[1].cpa.access_token, 'second-access-token');
}

function testLineDelimitedSessionsTrimAndSkipBlankLines() {
  const result = parseGptSessionTextToCpa(
    [
      '',
      `  ${JSON.stringify({
        email: 'trimmed@example.com',
        accessToken: 'trimmed-access-token',
        tokens: {
          account_id: 'trimmed-account',
        },
      })}  `,
      '   ',
      JSON.stringify({
        email: 'after-blank@example.com',
        accessToken: 'after-blank-access-token',
        tokens: {
          account_id: 'after-blank-account',
        },
      }),
    ].join('\n'),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 2);
  assert.equal(result.issues.length, 0);
  assert.equal(result.records[0].sourceName, 'line 2');
  assert.equal(result.records[1].sourceName, 'line 4');
}

function testLineDelimitedInvalidLineDoesNotBlockValidLines() {
  const result = parseGptSessionTextToCpa(
    [
      JSON.stringify({
        email: 'valid-a@example.com',
        accessToken: 'valid-a-token',
        tokens: {
          account_id: 'valid-a-account',
        },
      }),
      '{"email":"broken@example.com","accessToken":',
      JSON.stringify({
        email: 'valid-b@example.com',
        accessToken: 'valid-b-token',
        tokens: {
          account_id: 'valid-b-account',
        },
      }),
    ].join('\n'),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].path, 'line 2');
  assert.match(result.issues[0].reason, /JSON 解析失败/);
}

function testLineDelimitedFiltersNonObjectLines() {
  const result = parseGptSessionTextToCpa(
    [
      'Paste one JSON object per line:',
      '[{"email":"array@example.com","accessToken":"array-token"}]',
      `  ${JSON.stringify({
        email: 'object@example.com',
        accessToken: 'object-token',
        tokens: {
          account_id: 'object-account',
        },
      })}`,
      'not-json',
      '{"email":"broken@example.com","accessToken":',
    ].join('\n'),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.issues.length, 1);
  assert.equal(result.records[0].sourceName, 'line 3');
  assert.equal(result.records[0].cpa.email, 'object@example.com');
  assert.equal(result.issues[0].path, 'line 5');
  assert.match(result.issues[0].reason, /JSON 解析失败/);
}

function testWholeDocumentArrayStillParsesBeforeLineFiltering() {
  const result = parseGptSessionTextToCpa(
    JSON.stringify([
      {
        email: 'array-a@example.com',
        accessToken: 'array-a-token',
        tokens: {
          account_id: 'array-a-account',
        },
      },
      {
        email: 'array-b@example.com',
        accessToken: 'array-b-token',
        tokens: {
          account_id: 'array-b-account',
        },
      },
    ]),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 2);
  assert.equal(result.issues.length, 0);
  assert.equal(result.records[0].sourceName, 'pasted-json');
  assert.equal(result.records[1].sourceName, 'pasted-json');
}

function testFormattedSingleJsonStillUsesWholeDocumentParsing() {
  const result = parseGptSessionTextToCpa(
    JSON.stringify(
      {
        user: {
          email: 'formatted@example.com',
        },
        accessToken: 'formatted-token',
        account: {
          id: 'formatted-account',
        },
      },
      null,
      2
    ),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.issues.length, 0);
  assert.equal(result.records[0].sourceName, 'pasted-json');
  assert.equal(result.records[0].cpa.email, 'formatted@example.com');
}

function testConsumeRemovesSuccessfulJsonLine() {
  const result = consumeGptSessionInput(
    JSON.stringify({
      email: 'consumed@example.com',
      accessToken: 'consumed-token',
      tokens: {
        account_id: 'consumed-account',
      },
    }),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cpa.email, 'consumed@example.com');
  assert.equal(result.remainingText, '');
}

function testConsumeDeletesFilteredAndInvalidLinesAndStagesValidRecords() {
  const brokenLine = '{"email":"broken@example.com","accessToken":';
  const result = consumeGptSessionInput(
    [
      'Paste one JSON object per line:',
      JSON.stringify({
        email: 'valid-consume@example.com',
        accessToken: 'valid-consume-token',
        tokens: {
          account_id: 'valid-consume-account',
        },
      }),
      brokenLine,
    ].join('\n'),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cpa.email, 'valid-consume@example.com');
  assert.equal(result.remainingText, '');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].path, 'line 3');
}

function testConsumeKeepsOnlyValidJsonWithoutPreview() {
  const unresolvedLine = JSON.stringify({ items: [{ value: 1 }] });
  const result = consumeGptSessionInput(
    [
      'Paste one JSON object per line:',
      unresolvedLine,
      JSON.stringify({
        email: 'valid-with-unresolved@example.com',
        accessToken: 'valid-with-unresolved-token',
        tokens: {
          account_id: 'valid-with-unresolved-account',
        },
      }),
      '{"email":"broken@example.com","accessToken":',
    ].join('\n'),
    { now: fixedNow }
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cpa.email, 'valid-with-unresolved@example.com');
  assert.equal(result.remainingText, unresolvedLine);
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].path, 'line 2:$');
  assert.equal(result.issues[1].path, 'line 4');
}

function testConsumeKeepsParsedJsonWithoutSession() {
  const text = JSON.stringify({ items: [{ value: 1 }] });
  const result = consumeGptSessionInput(text, { now: fixedNow });

  assert.equal(result.records.length, 0);
  assert.equal(result.remainingText, text);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].reason, /未找到/);
}

testChatGptSessionConvertsToCpa();
testPreservesRefreshAndIdToken();
testPreservesRootProxyURL();
testNestedMultipleSessionsUseAccessTokenExpiry();
testInvalidInputReportsIssue();
testLineDelimitedSessionsConvertIndependently();
testLineDelimitedSessionsTrimAndSkipBlankLines();
testLineDelimitedInvalidLineDoesNotBlockValidLines();
testLineDelimitedFiltersNonObjectLines();
testWholeDocumentArrayStillParsesBeforeLineFiltering();
testFormattedSingleJsonStillUsesWholeDocumentParsing();
testConsumeRemovesSuccessfulJsonLine();
testConsumeDeletesFilteredAndInvalidLinesAndStagesValidRecords();
testConsumeKeepsOnlyValidJsonWithoutPreview();
testConsumeKeepsParsedJsonWithoutSession();
console.log('gptSessionImport tests passed');
