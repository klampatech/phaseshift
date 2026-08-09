import { test, expect } from '@playwright/test';

test('hud init check with logs', async ({ page }) => {
  page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
  await page.goto('/');
  await page.click('#blocker');
  await page.waitForFunction(() => window.__phaseShifter__ !== undefined);
  await page.waitForFunction(() => {
    const el = document.querySelector('#phase-name');
    return el && el.textContent && el.textContent.length > 0;
  });
  // Now check phase-name
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => {
    const el = document.querySelector('#phase-name');
    return {
      exists: !!el,
      text: el?.textContent,
      html: el?.outerHTML,
      phaseManagerExists: typeof window.__phaseShifter__?.phaseName === 'string',
      phaseValue: window.__phaseShifter__?.phase,
      phaseNames: ['ALPHA', 'BETA', 'GAMMA'],
      phaseNameValue: window.__phaseShifter__?.phaseName
    };
  });
  console.log('Result:', JSON.stringify(text, null, 2));
  expect(text.text).toBe('ALPHA');
});
