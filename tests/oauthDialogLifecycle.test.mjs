import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginOAuthCallbackSubmission,
  createOAuthAttemptToken,
  createOAuthConnectionFingerprint,
  finishOAuthCallbackSubmission,
  isCurrentOAuthAttemptToken,
  oauthAttemptTokenKey,
  oauthCallbackReportsError,
} from '../src/hooks/oauthAttemptLifecycle.ts';

test('duplicate callback submission is rejected for the same provider attempt', () => {
  const submissions = {};
  assert.equal(beginOAuthCallbackSubmission(submissions, 'codex', 'state-a'), true);
  assert.equal(beginOAuthCallbackSubmission(submissions, 'codex', 'state-a'), false);
});

test('concurrent provider callback submissions remain isolated', () => {
  const submissions = {};
  assert.equal(beginOAuthCallbackSubmission(submissions, 'codex', 'state-a'), true);
  assert.equal(beginOAuthCallbackSubmission(submissions, 'xai', 'state-b'), true);
  finishOAuthCallbackSubmission(submissions, 'codex', 'state-a');
  assert.equal(submissions.codex, undefined);
  assert.equal(submissions.xai, 'state-b');
});

test('stale completion cannot clear a newer attempt lock', () => {
  const submissions = { codex: 'state-new' };
  finishOAuthCallbackSubmission(submissions, 'codex', 'state-old');
  assert.equal(submissions.codex, 'state-new');
});

test('asynchronous result applies only to its exact provider, connection, and attempt ID', () => {
  const connectionA = createOAuthConnectionFingerprint('https://a.example/', 'key-a');
  const connectionB = createOAuthConnectionFingerprint('https://b.example', 'key-b');
  const first = createOAuthAttemptToken('codex', connectionA, 1);
  const second = createOAuthAttemptToken('codex', connectionA, 2);

  assert.equal(isCurrentOAuthAttemptToken(first, first, connectionA), true);
  assert.equal(isCurrentOAuthAttemptToken(first, second, connectionA), false);
  assert.equal(isCurrentOAuthAttemptToken(first, first, connectionB), false);
  assert.equal(
    isCurrentOAuthAttemptToken(first, createOAuthAttemptToken('xai', connectionA, 1), connectionA),
    false
  );
  assert.notEqual(connectionA, connectionB);
});

test('changing only the management key invalidates the previous connection scope', () => {
  const firstConnection = createOAuthConnectionFingerprint('https://a.example/', 'key-a');
  const nextConnection = createOAuthConnectionFingerprint('https://a.example', 'key-b');
  const attempt = createOAuthAttemptToken('codex', firstConnection, 1);

  assert.notEqual(firstConnection, nextConnection);
  assert.equal(isCurrentOAuthAttemptToken(attempt, attempt, nextConnection), false);
});

test('callback locks are scoped to the internal attempt token instead of OAuth state alone', () => {
  const connection = createOAuthConnectionFingerprint('https://a.example', 'key-a');
  const first = oauthAttemptTokenKey(createOAuthAttemptToken('codex', connection, 1));
  const second = oauthAttemptTokenKey(createOAuthAttemptToken('codex', connection, 2));
  const submissions = {};

  assert.equal(beginOAuthCallbackSubmission(submissions, 'codex', first), true);
  finishOAuthCallbackSubmission(submissions, 'codex', second);
  assert.equal(submissions.codex, first);
  finishOAuthCallbackSubmission(submissions, 'codex', first);
  assert.equal(submissions.codex, undefined);
});

test('OAuth error callbacks remain visible after backend acceptance', () => {
  assert.equal(
    oauthCallbackReportsError('http://localhost/callback?state=state-a&error=access_denied'),
    true
  );
  assert.equal(oauthCallbackReportsError('state=state-a&error_description=denied'), true);
  assert.equal(
    oauthCallbackReportsError('http://localhost/callback?state=state-a&code=code-a'),
    false
  );
});
