import assert from 'node:assert/strict';
import { normalizeSessionValidationFailures } from '../src/services/api/sessionValidationFailure.ts';
import {
  planSessionValidation,
  reconcileSessionUpload,
} from '../src/features/authFiles/sessionImportValidation.ts';

function testNormalizesImportableFailureMetadata() {
  const failures = normalizeSessionValidationFailures([
    {
      name: ' warning.json ',
      error: ' upstream 401 ',
      status_code: 401,
      importable: true,
      proxy_url: ' http://127.0.0.1:8080 ',
    },
    { name: 'invalid.json', error: 'invalid schema' },
  ]);

  assert.deepEqual(failures, [
    {
      name: 'warning.json',
      error: 'upstream 401',
      statusCode: 401,
      importable: true,
      proxyUrl: 'http://127.0.0.1:8080',
    },
    {
      name: 'invalid.json',
      error: 'invalid schema',
      importable: false,
      proxyUrl: '',
    },
  ]);
}

function testPlansMixedValidationOutcomes() {
  const plan = planSessionValidation(
    ['healthy.json', 'warning.json', 'invalid.json', 'missing.json'],
    {
      files: ['healthy.json'],
      resolved: [{ name: 'healthy.json', proxyUrl: 'http://healthy-proxy' }],
      failed: [
        {
          name: 'warning.json',
          error: 'validation returned status 401',
          importable: true,
          proxyUrl: 'http://warning-proxy',
        },
        {
          name: 'invalid.json',
          error: 'invalid schema',
          importable: false,
          proxyUrl: '',
        },
      ],
    },
    'missing validation result'
  );

  assert.deepEqual(plan.candidateNames, ['healthy.json', 'warning.json', 'missing.json']);
  assert.deepEqual(plan.validatedNames, ['healthy.json']);
  assert.deepEqual(plan.warnings, [
    { name: 'warning.json', reason: 'validation returned status 401' },
    { name: 'missing.json', reason: 'missing validation result' },
  ]);
  assert.deepEqual(plan.failures, [{ name: 'invalid.json', reason: 'invalid schema' }]);
  assert.deepEqual(plan.proxyUrls, {
    'healthy.json': 'http://healthy-proxy',
    'warning.json': 'http://warning-proxy',
  });
}

function testPlansAllSuccessfulValidation() {
  const plan = planSessionValidation(
    ['first.json', 'second.json'],
    {
      files: ['first.json', 'second.json'],
      resolved: [],
      failed: [],
    },
    'missing validation result'
  );

  assert.deepEqual(plan.candidateNames, ['first.json', 'second.json']);
  assert.deepEqual(plan.validatedNames, ['first.json', 'second.json']);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.failures, []);
}

function testPlansAllImportableWarnings() {
  const plan = planSessionValidation(
    ['first.json', 'second.json'],
    {
      files: [],
      resolved: [],
      failed: [
        {
          name: 'first.json',
          error: 'validation returned status 401',
          importable: true,
          proxyUrl: '',
        },
        {
          name: 'second.json',
          error: 'validation request failed',
          importable: true,
          proxyUrl: '',
        },
      ],
    },
    'missing validation result'
  );

  assert.deepEqual(plan.candidateNames, ['first.json', 'second.json']);
  assert.equal(plan.validatedNames.length, 0);
  assert.equal(plan.warnings.length, 2);
  assert.equal(plan.failures.length, 0);
}

function testValidationEndpointFailureFallsBackToAllFiles() {
  const plan = planSessionValidation(
    ['first.json', 'second.json'],
    { files: [], resolved: [], failed: [] },
    'validation endpoint unavailable'
  );

  assert.deepEqual(plan.candidateNames, ['first.json', 'second.json']);
  assert.equal(plan.failures.length, 0);
  assert.equal(plan.warnings.length, 2);
}

function testUploadSuccessRetainsOnlyImportedWarnings() {
  const result = reconcileSessionUpload(
    ['healthy.json', 'warning.json'],
    { uploaded: 2, files: ['healthy.json', 'warning.json'], failed: [] },
    [{ name: 'warning.json', reason: 'validation returned status 401' }],
    'missing upload result'
  );

  assert.deepEqual(result.uploadedNames, ['healthy.json', 'warning.json']);
  assert.deepEqual(result.warnings, [
    { name: 'warning.json', reason: 'validation returned status 401' },
  ]);
  assert.deepEqual(result.failures, []);
}

function testUploadFailureReplacesValidationWarning() {
  const result = reconcileSessionUpload(
    ['warning.json'],
    {
      uploaded: 0,
      files: [],
      failed: [{ name: 'warning.json', error: 'database unavailable' }],
    },
    [{ name: 'warning.json', reason: 'validation returned status 401' }],
    'missing upload result'
  );

  assert.deepEqual(result.uploadedNames, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.failures, [{ name: 'warning.json', reason: 'database unavailable' }]);
}

function testCountOnlyUploadResponseIsReconciledDeterministically() {
  const result = reconcileSessionUpload(
    ['first.json', 'second.json', 'third.json'],
    {
      uploaded: 1,
      files: [],
      failed: [{ name: 'second.json', error: 'rejected' }],
    },
    [{ name: 'third.json', reason: 'validation unavailable' }],
    'missing upload result'
  );

  assert.deepEqual(result.uploadedNames, ['first.json']);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.failures, [
    { name: 'second.json', reason: 'rejected' },
    { name: 'third.json', reason: 'missing upload result' },
  ]);
}

testNormalizesImportableFailureMetadata();
testPlansMixedValidationOutcomes();
testPlansAllSuccessfulValidation();
testPlansAllImportableWarnings();
testValidationEndpointFailureFallsBackToAllFiles();
testUploadSuccessRetainsOnlyImportedWarnings();
testUploadFailureReplacesValidationWarning();
testCountOnlyUploadResponseIsReconciledDeterministically();
console.log('session validation import tests passed');
