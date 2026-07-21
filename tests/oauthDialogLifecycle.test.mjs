import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginOAuthCallbackSubmission,
  finishOAuthCallbackSubmission,
  isCurrentOAuthAttempt,
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

test('asynchronous callback result applies only to its exact provider and state', () => {
  const states = {
    codex: { state: 'state-a' },
    xai: { state: 'state-b' },
  };
  assert.equal(isCurrentOAuthAttempt(states, 'codex', 'state-a'), true);
  assert.equal(isCurrentOAuthAttempt(states, 'codex', 'state-b'), false);
  assert.equal(isCurrentOAuthAttempt(states, 'xai', 'state-a'), false);
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
