import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const authFiles = await server.ssrLoadModule('/src/services/api/authFiles.ts');
  const codexQuota = await server.ssrLoadModule('/src/services/api/codexQuota.ts');
  const apiClientModule = await server.ssrLoadModule('/src/services/api/client.ts');
  const identities = await server.ssrLoadModule('/src/features/authFiles/credentialIdentity.ts');
  const quotaLoader = await server.ssrLoadModule('/src/components/quota/useQuotaLoader.ts');
  const quotaSection = await server.ssrLoadModule('/src/components/quota/QuotaSection.tsx');

  await test('serializes credential identity fences for status, fields, refresh, and delete', async () => {
    const originalPatch = apiClientModule.apiClient.patch;
    const originalDelete = apiClientModule.apiClient.delete;
    const calls = [];
    apiClientModule.apiClient.patch = async (url, data) => {
      calls.push({ method: 'PATCH', url, data });
      return { status: 'ok', disabled: false };
    };
    apiClientModule.apiClient.delete = async (url, options) => {
      calls.push({ method: 'DELETE', url, data: options?.data });
      return { status: 'ok', deleted: 1, files: ['codex-user.json'] };
    };

    const target = {
      name: 'codex-user.json',
      credentialId: 'credential-1',
      authIndex: 'codex:user',
    };
    try {
      await authFiles.authFilesApi.setStatus(target, false);
      await authFiles.authFilesApi.patchFields(target, { groups: ['team'] });
      await authFiles.authFilesApi.requestManualRefresh(target);
      await authFiles.authFilesApi.deleteFile(target);
    } finally {
      apiClientModule.apiClient.patch = originalPatch;
      apiClientModule.apiClient.delete = originalDelete;
    }

    for (const call of calls) {
      assert.equal(call.data.name, target.name);
      assert.equal(call.data.credential_id, target.credentialId);
      assert.equal(call.data.auth_index, target.authIndex);
    }
    assert.deepEqual(calls[1].data.groups, ['team']);
    assert.equal(typeof calls[2].data.expired, 'string');
    assert.equal(calls[3].method, 'DELETE');
  });

  const quotaResponse = (overrides = {}) => ({
    credential_id: 'credential-1',
    credential_generation: 8,
    auth_index: 'codex:user',
    account: {
      selected_account_fingerprint: 'selected',
      fedramp: false,
      fedramp_known: true,
      token_claims_present: true,
      token_claim_mismatch: false,
    },
    observed_at: '2026-08-11T00:00:00Z',
    usage: {},
    reset_credits: { available_count: 0, credits: [] },
    ...overrides,
  });

  await test('accepts current/new Codex generations and rejects stale or mismatched responses', async () => {
    const originalGet = apiClientModule.apiClient.get;
    const calls = [];
    apiClientModule.apiClient.get = async (url, options) => {
      calls.push({ url, options });
      return quotaResponse();
    };
    try {
      const snapshot = await codexQuota.codexQuotaApi.get({
        credentialId: 'credential-1',
        authIndex: 'codex:user',
        credentialGeneration: 7,
      });
      assert.equal(snapshot.credentialGeneration, 8);
      assert.deepEqual(calls[0].options.params, { auth_index: 'codex:user' });

      apiClientModule.apiClient.get = async () => quotaResponse({ credential_generation: 6 });
      await assert.rejects(
        codexQuota.codexQuotaApi.get({
          credentialId: 'credential-1',
          authIndex: 'codex:user',
          credentialGeneration: 7,
        }),
        (error) => error?.status === 409 && error?.code === 'auth_context_changed'
      );

      apiClientModule.apiClient.get = async () =>
        quotaResponse({ credential_id: 'replacement-credential' });
      await assert.rejects(
        codexQuota.codexQuotaApi.get({
          credentialId: 'credential-1',
          authIndex: 'codex:user',
          credentialGeneration: 7,
        }),
        (error) => error?.status === 409 && error?.code === 'auth_context_changed'
      );
    } finally {
      apiClientModule.apiClient.get = originalGet;
    }
  });

  await test('refreshes inventory once and retries a stale quota GET only for the same identity', async () => {
    const original = {
      name: 'codex-user.json',
      credential_id: 'credential-1',
      auth_index: 'codex:user',
      credential_generation: 7,
    };
    const latest = { ...original, credential_generation: 8 };
    let files = [original];
    let refreshes = 0;
    let requests = 0;
    const result = await quotaLoader.fetchQuotaWithIdentityRecovery({
      file: original,
      t: (key) => key,
      fetchQuota: async (file) => {
        requests += 1;
        if (requests === 1) {
          throw Object.assign(new Error('stale'), {
            status: 409,
            code: 'auth_context_changed',
          });
        }
        assert.equal(file.credential_generation, 8);
        return { ok: true };
      },
      refreshInventory: async () => {
        refreshes += 1;
        files = [latest];
      },
      getCurrentFiles: () => files,
    });
    assert.equal(result.recovered, true);
    assert.equal(result.file, latest);
    assert.equal(refreshes, 1);
    assert.equal(requests, 2);

    assert.equal(
      identities.findCurrentAuthFileForIdentity(
        [{ ...latest, credential_id: 'replacement-credential' }],
        identities.readAuthFileCredentialIdentity(original)
      ),
      null
    );
  });

  await test('stable-partitions enabled credentials before disabled credentials', () => {
    const files = [
      { name: 'enabled-a', disabled: false },
      { name: 'disabled-a', disabled: true },
      { name: 'enabled-b' },
      { name: 'disabled-b', disabled: true },
    ];
    assert.deepEqual(
      quotaSection.stablePartitionEnabledCredentials(files).map((file) => file.name),
      ['enabled-a', 'enabled-b', 'disabled-a', 'disabled-b']
    );
  });
} finally {
  await server.close();
}

console.log('credential identity fencing tests passed');
