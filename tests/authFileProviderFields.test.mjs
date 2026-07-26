import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAuthFileProviderFieldsPatch,
  buildAuthFileProviderFieldsPatch,
  readAuthFileWebsockets,
  readXAIAuthFileUsingAPI,
} from '../src/features/authFiles/authFileProviderFields.ts';

test('reads canonical and legacy websocket keys with canonical precedence', () => {
  assert.equal(readAuthFileWebsockets({ websocket: 'true' }), true);
  assert.equal(readAuthFileWebsockets({ websockets: false, websocket: true }), false);
  assert.equal(readAuthFileWebsockets({}), false);
});

test('builds only XFPA provider fields that changed', () => {
  assert.deepEqual(
    buildAuthFileProviderFieldsPatch({
      providerKey: 'codex',
      original: { websocket: true },
      websockets: false,
      websocketsTouched: true,
      usingApi: false,
      usingApiTouched: false,
    }),
    { websockets: false }
  );

  assert.deepEqual(
    buildAuthFileProviderFieldsPatch({
      providerKey: 'xai',
      original: { websocket: false, using_api: false },
      websockets: true,
      websocketsTouched: true,
      usingApi: true,
      usingApiTouched: true,
    }),
    { websockets: true, using_api: true }
  );

  assert.deepEqual(
    buildAuthFileProviderFieldsPatch({
      providerKey: 'xai',
      original: { websockets: true, using_api: true },
      websockets: true,
      websocketsTouched: false,
      usingApi: true,
      usingApiTouched: false,
    }),
    {}
  );
});

test('matches xAI using_api defaults for OAuth and non-OAuth credentials', () => {
  assert.equal(readXAIAuthFileUsingAPI({ auth_kind: 'oauth' }), false);
  assert.equal(readXAIAuthFileUsingAPI({ auth_kind: 'api_key' }), true);
  assert.equal(readXAIAuthFileUsingAPI({}), true);
  assert.equal(readXAIAuthFileUsingAPI({ auth_kind: 'oauth', using_api: 'true' }), true);
});

test('provider field preview preserves expired and unknown credential fields', () => {
  const original = {
    type: 'xai',
    websocket: true,
    expired: '2026-07-26T10:00:00Z',
    opaque_provider_state: { nested: ['keep-me'] },
  };

  const updated = applyAuthFileProviderFieldsPatch(original, {
    websockets: false,
    using_api: true,
  });

  assert.deepEqual(updated, {
    type: 'xai',
    websockets: false,
    using_api: true,
    expired: '2026-07-26T10:00:00Z',
    opaque_provider_state: { nested: ['keep-me'] },
  });
  assert.deepEqual(original, {
    type: 'xai',
    websocket: true,
    expired: '2026-07-26T10:00:00Z',
    opaque_provider_state: { nested: ['keep-me'] },
  });
});
