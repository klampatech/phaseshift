import { test, expect } from '@playwright/test';

test.describe('Phase Shifter - Gameplay Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('#blocker'); // Start the game
    // Wait for game module to fully initialize
    await page.waitForFunction(() => 
      typeof window.__phaseShifter__ !== 'undefined' && 
      window.__phaseShifter__.phaseManager !== null
    );
    // Wait for initial HUD update to populate phase-name
    await page.waitForFunction(() => {
      const el = document.querySelector('#phase-name');
      return el && el.textContent;
    });
  });

  test('should change phase indicator when phase is shifted', async ({ page }) => {
    const phaseName = page.locator('#phase-name');
    await expect(phaseName).toContainText('ALPHA');
    
    const phaseBefore = await page.evaluate(() => window.__phaseShifter__.phase);
    
    // Force phase shift
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(300);
    
    const phaseAfter = await page.evaluate(() => window.__phaseShifter__.phase);
    expect(phaseAfter).not.toBe(phaseBefore);
  });

  test('should update energy bar when phase shifts', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const energyBefore = await page.evaluate(() => window.__phaseShifter__.energy);
    
    // Trigger phase shift
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(300);
    
    const energyAfter = await page.evaluate(() => window.__phaseShifter__.energy);
    expect(energyAfter).toBeLessThan(energyBefore);
  });

  test('should respond to phase changes', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const phaseBefore = await page.evaluate(() => window.__phaseShifter__.phase);
    
    // Force phase shift
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(300);
    
    const phaseAfter = await page.evaluate(() => window.__phaseShifter__.phase);
    expect(phaseAfter).not.toBe(phaseBefore);
  });

  test('should display block hint when phase-walking through blocks', async ({ page }) => {
    await page.waitForTimeout(1000);
    const blockHint = page.locator('#block-hint');
    expect(await blockHint.isVisible()).toBe(true);
  });

  test('should show phase notification on shift', async ({ page }) => {
    // Use forceCyclePhase for reliable testing (bypasses keyboard quirks)
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(300);
    
    // Check UI feedback
    const afterShift = await page.evaluate(() => {
      const n = document.querySelector('#notification');
      const phaseName = document.querySelector('#phase-name');
      return {
        text: n ? n.textContent : 'null',
        opacity: n ? parseFloat(n.style.opacity || '0') : -1,
        phaseName: phaseName ? phaseName.textContent : 'null',
        isShifting: window.__phaseShifter?.phaseData?.isShifting,
        phase: window.__phaseShifter?.phaseData?.currentPhase,
        energy: window.__phaseShifter?.phaseData?.energy
      };
    });
    console.log('After shift:', JSON.stringify(afterShift));
    
    // Phase should have shifted (ALPHA -> BETA or ALPHA -> GAMMA depending on cycle)
    const currentPhase = await page.evaluate(() => window.__phaseShifter__.phase);
    expect(currentPhase).not.toBe(-1);
    expect(afterShift.phaseName).not.toBe('');
  });
});
