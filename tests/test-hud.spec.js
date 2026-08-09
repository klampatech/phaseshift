import { test, expect } from '@playwright/test';

test('hud init check', async ({ page }) => {
  await page.goto('/');
  await page.click('#blocker');
  await page.waitForFunction(() => window.__phaseShifter__ !== undefined);
  await page.waitForFunction(() => {
    const el = document.querySelector('#phase-name');
    return el && el.textContent && el.textContent.length > 0;
  });
  const text = await page.evaluate(() => document.querySelector('#phase-name')?.textContent);
  console.log('Phase name text:', text);
  const allElements = await page.evaluate(() => {
    const hud = document.querySelector('#hud');
    const phaseName = document.querySelector('#phase-name');
    return {
      hud: !!hud,
      phaseName: !!phaseName,
      phaseNameText: phaseName?.textContent,
      phaseNameHtml: phaseName?.outerHTML,
      hudChildren: hud ? hud.children.length : 0
    };
  });
  console.log('DOM check:', JSON.stringify(allElements, null, 2));
  await expect(page.locator('#phase-name')).toContainText('ALPHA');
});
