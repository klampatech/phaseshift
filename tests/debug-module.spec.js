import { test, expect } from '@playwright/test';

test('find why __phaseShifter__ is not defined', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);
  
  // Check for any JS errors in the page
  let rawConsole = [];
  page.on('console', (msg) => {
    rawConsole.push(`${msg.type()}: ${msg.text()}`);
  });
  
  // Try to see if the module scope is the issue
  const result = await page.evaluate(() => {
    return {
      phaseShifter: typeof window.__phaseShifter__,
      hasPhaseName: typeof window.__phaseShifter__?.phaseName,
      hasIsShifting: typeof window.__phaseShifter__?.isShifting,
      player: typeof window.__phaseShifter?.player,
      phase: window.__phaseShifter?.phase,
      playerEnergy: window.__phaseShifter?.player?.energy
    };
  });
  
  console.log('Page results:', JSON.stringify(result, null, 2));
  console.log('Console messages:', rawConsole);
});
