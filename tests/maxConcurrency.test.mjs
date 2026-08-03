import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MAX_CONCURRENCY,
  MAX_CONCURRENCY,
  effectiveMaxConcurrency,
  isValidMaxConcurrency,
  normalizeConcurrencySetting,
  parseOptionalMaxConcurrency,
} from '../src/utils/maxConcurrency.ts';

test('global per-resource concurrency defaults to ten', () => {
  assert.equal(DEFAULT_MAX_CONCURRENCY, 10);
});

test('optional max concurrency distinguishes blank from explicit zero', () => {
  assert.deepEqual(parseOptionalMaxConcurrency(''), { valid: true });
  assert.deepEqual(parseOptionalMaxConcurrency('   '), { valid: true });
  assert.deepEqual(parseOptionalMaxConcurrency('0'), { valid: true, value: 0 });
  assert.deepEqual(parseOptionalMaxConcurrency('17'), { valid: true, value: 17 });
});

test('concurrency settings preserve inherited and independent unlimited semantics', () => {
  assert.deepEqual(normalizeConcurrencySetting(undefined, undefined), {
    mode: 'inherit',
    maxConcurrency: 0,
  });
  assert.deepEqual(normalizeConcurrencySetting(undefined, 7), {
    mode: 'independent',
    maxConcurrency: 7,
  });
  assert.deepEqual(normalizeConcurrencySetting('independent', 0), {
    mode: 'independent',
    maxConcurrency: 0,
  });
  assert.deepEqual(normalizeConcurrencySetting('inherit', 9), {
    mode: 'inherit',
    maxConcurrency: 0,
  });
  assert.equal(effectiveMaxConcurrency({ mode: 'inherit', maxConcurrency: 0 }, 4), 4);
  assert.equal(effectiveMaxConcurrency({ mode: 'independent', maxConcurrency: 0 }, 4), 0);
});

test('optional max concurrency enforces the shared backend range and integer syntax', () => {
  assert.equal(isValidMaxConcurrency(MAX_CONCURRENCY), true);
  for (const value of ['-1', '1.5', '1e2', String(MAX_CONCURRENCY + 1), 'not-a-number']) {
    assert.deepEqual(parseOptionalMaxConcurrency(value), { valid: false });
  }
});
