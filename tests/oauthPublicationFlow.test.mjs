import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForCredentialGroupsCatalog } from '../src/hooks/credentialGroupsCatalogPolling.ts';
import { waitForOAuthCredentialPublication } from '../src/features/authFiles/oauthCredentialPublication.ts';
import { waitForOAuthStatus } from '../src/hooks/oauthStatusPolling.ts';

const scenarios = [
  { label: 'built-in created credential', provider: 'codex', disposition: 'created' },
  { label: 'plugin updated credential', provider: 'gemini-cli', disposition: 'updated' },
  { label: 'built-in rekeyed credential', provider: 'claude', disposition: 'rekeyed' },
];

for (const scenario of scenarios) {
  test(`${scenario.label} opens exactly one modal after publication and catalog recovery`, async () => {
    const controller = new AbortController();
    const credential = {
      provider: scenario.provider,
      id: `${scenario.provider}-new@example.com.json`,
      name: `${scenario.provider}-new@example.com.json`,
      disposition: scenario.disposition,
      inventory_id: 'inventory-a',
      revision: 9,
    };
    const target = {
      provider: credential.provider,
      id: credential.id,
      name: credential.name,
      groups: [],
    };
    let statusCalls = 0;
    const status = await waitForOAuthStatus({
      signal: controller.signal,
      isCurrent: () => true,
      request: async () => {
        statusCalls += 1;
        if (statusCalls === 1) throw new Error('temporary status failure');
        if (statusCalls === 2) return { status: 'wait' };
        return { status: 'ok', credential };
      },
      sleep: async () => {},
    });
    assert.equal(status?.status, 'ok');

    let inventoryCalls = 0;
    const publication = await waitForOAuthCredentialPublication({
      credential: status.credential,
      signal: controller.signal,
      isCurrent: () => true,
      refresh: async () => {
        inventoryCalls += 1;
        if (inventoryCalls === 1) throw new Error('temporary inventory failure');
        return {
          inventory_id: credential.inventory_id,
          revision: credential.revision,
          files: inventoryCalls >= 4 ? [target] : [],
        };
      },
      sleep: async () => {},
    });
    assert.equal(publication.status, 'ready');

    const openedTargets = [];
    openedTargets.push(publication.credential);

    let catalogCalls = 0;
    const catalog = await waitForCredentialGroupsCatalog({
      signal: controller.signal,
      isCurrent: () => true,
      retry: true,
      load: async () => {
        catalogCalls += 1;
        if (catalogCalls <= 2) throw new Error('temporary catalog failure');
        return ['plus', 'k12'];
      },
      sleep: async () => {},
    });

    assert.deepEqual(catalog, { status: 'ready', groups: ['plus', 'k12'] });
    assert.deepEqual(openedTargets, [target]);
  });
}

test('superseding an attempt before publication prevents a stale modal', async () => {
  const controller = new AbortController();
  let current = true;
  const credential = {
    provider: 'codex',
    id: 'codex-stale@example.com.json',
    name: 'codex-stale@example.com.json',
    disposition: 'created',
    inventory_id: 'inventory-a',
    revision: 2,
  };
  const openedTargets = [];
  const publication = await waitForOAuthCredentialPublication({
    credential,
    signal: controller.signal,
    isCurrent: () => current,
    refresh: async () => ({
      inventory_id: credential.inventory_id,
      revision: credential.revision,
      files: [],
    }),
    sleep: async () => {
      current = false;
    },
  });
  if (publication.status === 'ready') openedTargets.push(publication.credential);

  assert.deepEqual(publication, { status: 'cancelled' });
  assert.deepEqual(openedTargets, []);
});
