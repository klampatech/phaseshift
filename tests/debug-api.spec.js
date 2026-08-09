import { test, expect } from '@playwright/test';
test('check __phaseShifter__ API', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(500);
  const api = await page.evaluate(() => {
    const obj = window.__phaseShifter__;
    return {
      hasGlobal: typeof window.__phaseShifter__ !== 'undefined',
      data: obj ? {
        phase: obj.phase,
        energy: obj.energy,
        blockCount: obj.blockCount,
        chunkCount: obj.chunkCount
      } : null
    };
  });
  console.log('Phase shifter state:', JSON.stringify(api, null, 2));
  expect(api.hasGlobal).toBe(true);
  expect(api.data.phase).toBe(0);
  expect(api.data.energy).toBeGreaterThan(0);
  expect(api.data.chunkCount).toBeGreaterThan(0);
});
