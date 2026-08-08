import { test, expect } from '@playwright/test';
test('check page loads without errors', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1000);
  
  // Capture console errors
  let errors = [];
  const errorListener = (msg) => { errors.push(msg.text()); };
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(500);
  
  console.log('Page errors:', errors);
  const hasPhaseShifter = await page.evaluate(() => typeof window.__phaseShifter__ !== 'undefined');
  console.log('Has __phaseShifter__:', hasPhaseShifter);
  expect(hasPhaseShifter).toBe(true);
});
