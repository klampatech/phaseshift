import { test, expect } from '@playwright/test';

test('debug game load', async ({ page }) => {
  const logs = [];
  page.on('console', msg => {
    if (msg.text().includes('hud.update') || msg.text().includes('HUD') || 
        msg.text().includes('error') || msg.text().includes('Error')) {
      logs.push(msg.text());
    }
  });
  
  await page.goto('/');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  console.log('=== Console logs ===');
  logs.forEach(l => console.log('  ' + l));
  
  const state = await page.evaluate(() => {
    const phaseName = document.querySelector('#phase-name');
    return {
      hasPhaseName: !!phaseName,
      phaseNameText: phaseName?.textContent,
      hasPhaseShifter: typeof window.__phaseShifter__ !== 'undefined',
      phaseValue: window.__phaseShifter__?.phase,
      phaseManagerExists: typeof window.__phaseShifter__?.phaseName === 'string',
      hasForceCyclePhase: typeof window.__phaseShifter__?.forceCyclePhase === 'function',
    };
  });
  
  console.log('=== State ===');
  console.log(JSON.stringify(state, null, 2));
  
  expect(state.hasPhaseName).toBe(true);
  expect(state.phaseNameText).toBe('ALPHA');
  expect(state.hasPhaseShifter).toBe(true);
  expect(state.hasForceCyclePhase).toBe(true);
});
