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

  const placeholderUnified = buildXaiBillingSummary({
    currentPeriod: {
      type: 'weekly',
      start: '2026-07-20T00:00:00Z',
      end: '2026-07-27T00:00:00Z',
    },
    usage: { includedUsed: {}, onDemandUsed: {}, totalUsed: {} },
    onDemandCap: {},
    billingPeriodEnd: '2026-08-01',
  });
  const legacyWithEvidence = buildXaiBillingSummary({
    monthly_limit: { value: 10_000 },
    used: { val: 12_500 },
    on_demand_cap: { val: 5_000 },
    on_demand_used: { val: 2_500 },
    billingPeriodEnd: '2026-08-01',
  });
  const evidenceMerged = mergeXaiBillingSummaries(placeholderUnified, legacyWithEvidence);
  assert.deepEqual(
    {
      monthlyLimitCents: evidenceMerged.monthlyLimitCents,
      usedCents: evidenceMerged.usedCents,
      includedUsedCents: evidenceMerged.includedUsedCents,
      onDemandCapCents: evidenceMerged.onDemandCapCents,
      onDemandUsedCents: evidenceMerged.onDemandUsedCents,
      usagePercent: evidenceMerged.usagePercent,
    },
    {
      monthlyLimitCents: 10_000,
      usedCents: 12_500,
      includedUsedCents: 10_000,
      onDemandCapCents: 5_000,
      onDemandUsedCents: 2_500,
      usagePercent: 0,
    }
  );

  const unifiedConflict = buildXaiBillingSummary({
    currentPeriod: {
      type: 'weekly',
      start: '2026-07-20T00:00:00Z',
      end: '2026-07-27T00:00:00Z',
    },
    creditUsagePercent: 10,
    monthlyLimit: { val: 20_000 },
    used: { val: 5_000 },
    onDemandCap: { val: 6_000 },
    onDemandUsed: { val: 1_000 },
  });
  const legacyConflict = buildXaiBillingSummary({
    monthlyLimit: { val: 10_000 },
    used: { val: 9_000 },
    onDemandCap: { val: 2_000 },
    onDemandUsed: { val: 1_500 },
  });
  const conflictMerged = mergeXaiBillingSummaries(unifiedConflict, legacyConflict);
  assert.deepEqual(
    {
      monthlyLimitCents: conflictMerged.monthlyLimitCents,
      usedCents: conflictMerged.usedCents,
      onDemandCapCents: conflictMerged.onDemandCapCents,
      onDemandUsedCents: conflictMerged.onDemandUsedCents,
      usagePercent: conflictMerged.usagePercent,
    },
    {
      monthlyLimitCents: 20_000,
      usedCents: 5_000,
      onDemandCapCents: 6_000,
      onDemandUsedCents: 1_000,
      usagePercent: 10,
    }
  );
} finally {
  await server.close();
}

console.log('Kimi and xAI quota builder tests passed');
