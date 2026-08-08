import { test, expect } from '@playwright/test';

test('hud init check with logs', async ({ page }) => {
  page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
  await page.goto('/');
  await page.click('#blocker');
  await page.waitForFunction(() => 
    typeof window.__phaseShifter__ !== 'undefined' && 
    window.__phaseShifter__.phaseManager !== null
  );
  // Now check phase-name
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => {
    const el = document.querySelector('#phase-name');
    return {
      exists: !!el,
      text: el?.textContent,
      html: el?.outerHTML,
      phaseManager: window.__phaseShifter__?.phaseManager,
      phaseValue: window.__phaseShifter__?.phase,
      phaseNames: ['ALPHA', 'BETA', 'GAMMA'],
      phaseNamesArray: window.__phaseShifter__?.phaseManager?.getCurrentPhase?.()
    };
  });
  console.log('Result:', JSON.stringify(text, null, 2));
  expect(text.text).toBe('ALPHA');
});
