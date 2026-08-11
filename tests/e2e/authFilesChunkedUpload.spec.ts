import { expect, test } from '@playwright/test';

test('uploads 3,000 credential files in bounded sequential chunks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const chunkSizes: number[] = [];
  await page.route('**/v0/management/auth-files', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const fileParts = body.match(/name="file"; filename=/g)?.length ?? 0;
    chunkSizes.push(fileParts);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    });
  });

  await page.goto('/management-assets/', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    type UploadModule = {
      authFilesApi: {
        uploadFilesInChunks: (...args: unknown[]) => Promise<{
          uploaded: number;
          remainingFiles: File[];
          completedChunks: number;
        }>;
      };
    };
    type ClientModule = {
      apiClient: {
        setConfig: (config: { apiBase: string; managementKey: string }) => void;
      };
    };
    const loadModule = new Function(
      'return import("/management-assets/src/services/api/authFiles.ts")'
    ) as () => Promise<UploadModule>;
    const loadClient = new Function(
      'return import("/management-assets/src/services/api/client.ts")'
    ) as () => Promise<ClientModule>;
    const { authFilesApi } = await loadModule();
    const { apiClient } = await loadClient();
    apiClient.setConfig({ apiBase: window.location.origin, managementKey: 'test-key' });
    const files = Array.from(
      { length: 3000 },
      (_, index) => new File(['{}'], `credential-${index}.json`, { type: 'application/json' })
    );
    const upload = await authFilesApi.uploadFilesInChunks(
      files,
      { mode: 'direct' },
      { mode: 'inherit', maxConcurrency: 0 }
    );
    return {
      uploaded: upload.uploaded,
      remaining: upload.remainingFiles.length,
      chunks: upload.completedChunks,
      failures: upload.failed.slice(0, 3),
    };
  });

  expect(result).toEqual({ uploaded: 3000, remaining: 0, chunks: 30, failures: [] });
  expect(chunkSizes).toHaveLength(30);
  expect(chunkSizes.every((size) => size === 100)).toBe(true);
});
