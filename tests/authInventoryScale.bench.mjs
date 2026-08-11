import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'silent',
});
await server.listen();

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const baseURL = server.resolvedUrls?.local?.[0];
  if (!baseURL) throw new Error('Vite did not publish a local URL');
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });

  const results = await page.evaluate(
    async (sizes) => {
      const inventory = await import('/management-assets/src/stores/useAuthInventoryStore.ts');
      const measurements = [];
      for (const size of sizes) {
        const files = Array.from({ length: Math.min(size, 100) }, (_, index) => ({
          id: `auth-${index}`,
          name: `auth-${index}.json`,
          provider: index % 2 === 0 ? 'codex' : 'claude',
        }));
        inventory.useAuthInventoryStore.setState({
          files,
          inventoryId: `inventory-${size}`,
          revision: 1,
          total: size,
          limit: 100,
          loading: false,
          error: '',
        });

        const startedAt = performance.now();
        for (let revision = 2; revision <= 101; revision += 1) {
          const index = (revision * 97) % files.length;
          inventory.applyInventoryEvent({
            inventoryId: `inventory-${size}`,
            revision,
            action: 'updated',
            ids: [`auth-${index}`],
            files: [
              {
                ...files[index],
                disabled: revision % 2 === 0,
              },
            ],
          });
        }
        const elapsedMs = performance.now() - startedAt;
        measurements.push({
          credentials: size,
          updates: 100,
          page_rows: files.length,
          elapsed_ms: Number(elapsedMs.toFixed(3)),
          mean_ms_per_update: Number((elapsedMs / 100).toFixed(4)),
        });
      }
      return measurements;
    },
    [500, 1000, 3000, 10000]
  );

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await browser.close();
  await server.close();
}
