import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { KIMI_CONFIG } = await server.ssrLoadModule('/src/components/quota/quotaConfigs.ts');
  const { buildKimiQuotaRows, buildXaiBillingSummary, mergeXaiBillingSummaries } =
    await server.ssrLoadModule('/src/utils/quota/index.ts');

  const rows = buildKimiQuotaRows({
    usage: { used: 200, limit: 1000 },
    limits: [
      {
        detail: { used: 20, limit: 100 },
        window: { duration: 300, timeUnit: 'MINUTES' },
      },
    ],
  });
  assert.deepEqual(
    rows.map(({ id }) => id),
    ['limit-0', 'summary']
  );
  assert.equal(rows[0].labelKey, 'kimi_quota.limit_window');
  assert.deepEqual(rows[0].labelParams, { duration: '5h' });
  assert.equal(rows[1].labelKey, 'kimi_quota.weekly_limit');

  const styles = new Proxy({}, { get: (_, property) => String(property) });
  const quotaMarkup = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      KIMI_CONFIG.renderQuotaItems(
        {
          status: 'success',
          rows: [
            { id: 'zero', label: 'Unknown quota', used: 0, limit: 0 },
            { id: 'known', label: 'Known quota', used: 4, limit: 10 },
          ],
        },
        (key) => key,
        {
          styles,
          QuotaProgressBar: ({ percent }) =>
            createElement('span', { 'data-percent': percent ?? 'unknown' }),
        }
      )
    )
  );
  assert.equal(quotaMarkup.includes('0 / 0'), false);
  assert.equal(quotaMarkup.includes('4 / 10'), true);

  const weekly = buildXaiBillingSummary({
    currentPeriod: { type: 'weekly', start: '2026-07-20', end: '2026-07-27' },
    creditUsagePercent: '25',
    productUsage: [{ product: 'grok-code', usagePercent: '40' }],
  });
  const monthly = buildXaiBillingSummary({
    monthlyLimit: { val: 10_000 },
    used: { val: 12_500 },
    onDemandCap: { val: 5_000 },
    billingPeriodEnd: '2026-08-01',
  });
  const merged = mergeXaiBillingSummaries(weekly, monthly);

  assert.deepEqual(
    {
      periodType: merged.periodType,
      usagePercent: merged.usagePercent,
      productUsage: merged.productUsage,
      monthlyLimitCents: merged.monthlyLimitCents,
      includedUsedCents: merged.includedUsedCents,
      onDemandUsedCents: merged.onDemandUsedCents,
      onDemandUsedPercent: merged.onDemandUsedPercent,
    },
    {
      periodType: 'weekly',
      usagePercent: 25,
      productUsage: [{ product: 'grok-code', usagePercent: 40 }],
      monthlyLimitCents: 10_000,
      includedUsedCents: 10_000,
      onDemandUsedCents: 2_500,
      onDemandUsedPercent: 50,
    }
  );
} finally {
  await server.close();
}

console.log('Kimi and xAI quota builder tests passed');
