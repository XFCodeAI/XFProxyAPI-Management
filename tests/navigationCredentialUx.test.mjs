import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const i18nModule = await server.ssrLoadModule('/src/i18n/index.ts');
  await i18nModule.initializeI18n();
  const layout = await server.ssrLoadModule('/src/components/layout/MainLayout.tsx');
  const quotaPage = await server.ssrLoadModule('/src/pages/QuotaPage.tsx');
  const quotaSection = await server.ssrLoadModule('/src/components/quota/QuotaSection.tsx');
  const quotaResolvers = await server.ssrLoadModule('/src/utils/quota/resolvers.ts');
  const { QuotaCard } = await server.ssrLoadModule('/src/components/quota/QuotaCard.tsx');
  const { TooltipProvider } = await server.ssrLoadModule('/src/components/ui/Tooltip.tsx');

  assert.equal(
    layout.resolveCredentialNavigationBadge({ files: [], inventoryId: '', revision: 0 }),
    null
  );
  assert.deepEqual(
    layout.resolveCredentialNavigationBadge({
      files: [{ id: 'one' }, { id: 'two' }],
      inventoryId: 'inventory-a',
      revision: 7,
      total: 3000,
      providerTotals: { codex: 2000, claude: 1000 },
    }),
    { count: 3000, revision: 7 }
  );
  assert.deepEqual(
    layout.resolveCredentialNavigationBadge({
      files: [],
      inventoryId: 'inventory-a',
      revision: 8,
    }),
    { count: 0, revision: 8 }
  );

  const countedLabel = 'Credential Management, Credentials: 2';
  assert.deepEqual(
    layout.resolveNavigationItemAccessibility('Credential Management', 'Credentials: 2', true),
    { ariaLabel: countedLabel, showTooltip: true }
  );
  assert.deepEqual(
    layout.resolveNavigationItemAccessibility('Credential Management', 'Credentials: 2', false),
    { ariaLabel: countedLabel, showTooltip: true }
  );
  assert.deepEqual(layout.resolveNavigationItemAccessibility('Dashboard', undefined, true), {
    ariaLabel: undefined,
    showTooltip: false,
  });
  assert.deepEqual(layout.resolveNavigationItemAccessibility('Dashboard', undefined, false), {
    ariaLabel: 'Dashboard',
    showTooltip: true,
  });

  assert.equal(quotaSection.matchesQuotaCredentialStatus({}, 'all', false), true);
  assert.equal(quotaSection.matchesQuotaCredentialStatus({}, 'enabled', false), true);
  assert.equal(
    quotaSection.matchesQuotaCredentialStatus({ disabled: true }, 'enabled', false),
    false
  );
  assert.equal(
    quotaSection.matchesQuotaCredentialStatus({ disabled: true }, 'disabled', false),
    true
  );
  assert.equal(quotaSection.matchesQuotaCredentialStatus({}, 'problem', true), true);
  assert.equal(quotaSection.matchesQuotaCredentialStatus({}, 'problem', false), false);

  const teamQuota = { status: 'success', planType: 'team' };
  assert.equal(quotaSection.matchesQuotaCredentialPlan({}, teamQuota, 'all'), true);
  assert.equal(quotaSection.matchesQuotaCredentialPlan({}, teamQuota, 'team'), true);
  assert.equal(quotaSection.matchesQuotaCredentialPlan({}, teamQuota, 'plus'), false);
  assert.equal(quotaSection.matchesQuotaCredentialPlan({}, undefined, '__unverified__'), true);
  assert.equal(
    quotaSection.resolveQuotaCredentialPlan(
      { plan_type: 'plus' },
      {
        status: 'success',
        account: { upstreamPlanType: 'k12', credentialPlanType: 'team' },
      }
    ),
    'k12'
  );
  assert.equal(quotaSection.resolveQuotaCredentialPlan({ plan_type: 'plus' }, undefined), 'plus');
  const codexIdToken = `header.${Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_plan_type: 'k12' },
    })
  ).toString('base64url')}.signature`;
  assert.equal(quotaResolvers.resolveCodexPlanType({ id_token: codexIdToken }), 'k12');

  const credentialPlanMarkup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      { delayDuration: 0 },
      createElement(QuotaCard, {
        item: { name: 'codex-k12.json', type: 'codex', plan_type: 'k12' },
        i18nPrefix: 'codex_quota',
        cardClassName: '',
        defaultType: 'codex',
        hideQuotaSection: true,
        credentialPlan: { type: 'k12', label: 'K12' },
        renderQuotaItems: () => null,
      })
    )
  );
  assert.match(credentialPlanMarkup, /data-credential-plan="k12"/);
  assert.match(credentialPlanMarkup, /K12/);

  const providers = [
    { id: 'claude', credentialCount: 0 },
    { id: 'codex', credentialCount: 3 },
    { id: 'plugin:long-provider', credentialCount: 1 },
  ];
  assert.deepEqual(quotaPage.resolveQuotaProviderSelection(providers, null), {
    defaultProviderId: 'codex',
    activeProviderId: 'codex',
  });
  assert.deepEqual(quotaPage.resolveQuotaProviderSelection(providers, 'claude'), {
    defaultProviderId: 'codex',
    activeProviderId: 'claude',
  });
  assert.deepEqual(quotaPage.resolveQuotaProviderSelection(providers, 'removed-provider'), {
    defaultProviderId: 'codex',
    activeProviderId: 'claude',
  });
  assert.equal(quotaPage.QUOTA_ACTIVE_PROVIDER_STORAGE_KEY, 'quotaPage.activeProvider');

  const routesSource = await readFile(
    new URL('../src/router/MainRoutes.tsx', import.meta.url),
    'utf8'
  );
  const routePaths = new Set(
    Array.from(routesSource.matchAll(/\{\s*path:\s*'([^']+)'/g), (match) => match[1])
  );
  const expectedRoutePaths = new Set([
    '/',
    '/dashboard',
    '/settings',
    '/api-keys',
    '/ai-providers',
    '/ai-providers/*',
    '/proxy-pools',
    '/auth-files',
    '/auth-files/oauth-excluded',
    '/auth-files/oauth-model-alias',
    '/quota',
    '/credential-groups',
    '/2fa',
    '/plugin-pages/:pluginId/:menuIndex',
    '/plugins',
    '/plugin-store',
    '/plugins/*',
    '/plugin-pages/*',
    '/config',
    '/model-prices',
    '/usage-analytics',
    '/monitoring',
    '/logs',
    '/migration',
    '/system',
    '*',
  ]);
  assert.deepEqual([...routePaths].sort(), [...expectedRoutePaths].sort());
  assert.match(routesSource, /function AuthFilesRedirect\(\)[\s\S]*to="\/quota" replace/);

  const layoutSource = await readFile(
    new URL('../src/components/layout/MainLayout.tsx', import.meta.url),
    'utf8'
  );
  assert.match(layoutSource, /useAuthInventoryStore/);
  assert.match(layoutSource, /data-inventory-revision/);
  assert.match(layoutSource, /aria-live="polite"/);
  assert.match(layoutSource, /aria-expanded=\{isOpen\}/);
  assert.doesNotMatch(layoutSource, /authFilesApi|AUTH_FILES_CHANGED_EVENT/);

  const quotaPageSource = await readFile(
    new URL('../src/pages/QuotaPage.tsx', import.meta.url),
    'utf8'
  );
  assert.match(quotaPageSource, /readNavigationPreference\(QUOTA_ACTIVE_PROVIDER_STORAGE_KEY\)/);
  assert.match(quotaPageSource, /writeNavigationPreference\(QUOTA_ACTIVE_PROVIDER_STORAGE_KEY/);
  assert.doesNotMatch(quotaPageSource, /recommended|affiliate/i);
} finally {
  await server.close();
}

console.log('Navigation and credential UX tests passed');
