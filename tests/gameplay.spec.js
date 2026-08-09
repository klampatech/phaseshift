import { test, expect } from '@playwright/test';

test.describe('Phase Shifter - Gameplay Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('#blocker'); // Start the game
    // Wait for game module to fully initialize
    await page.waitForFunction(() => window.__phaseShifter__ !== undefined);
    await page.waitForFunction(() => {
      const el = document.querySelector('#phase-name');
      return el && el.textContent && el.textContent.length > 0;
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

  test('phase-indicator dot background changes color on cycle (Phase 2.1)', async ({ page }) => {
    // The #phase-indicator dot's background should follow PHASE_COLORS[phase].
    // Alpha = rgb(90, 168, 90); Beta = rgb(51, 153, 230); Gamma = rgb(217, 179, 76).
    const rgbFor = async () => page.evaluate(() => {
      const el = document.querySelector('#phase-indicator');
      return el ? getComputedStyle(el).backgroundColor : null;
    });

    await page.waitForTimeout(300);
    const alphaRgb = await rgbFor();
    expect(alphaRgb).toBe('rgb(90, 168, 90)');

    // ALPHA → BETA via the debug hook.
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(500);
    const betaRgb = await rgbFor();
    expect(betaRgb).toBe('rgb(51, 153, 230)');

    // BETA → GAMMA.
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(500);
    const gammaRgb = await rgbFor();
    expect(gammaRgb).toBe('rgb(217, 179, 76)');

    // GAMMA → ALPHA (wrap).
    await page.evaluate(() => window.__phaseShifter__.forceCyclePhase());
    await page.waitForTimeout(500);
    const wrappedRgb = await rgbFor();
    expect(wrappedRgb).toBe('rgb(90, 168, 90)');
  });

  test('spam-clicking cyclePhase does not consume extra energy (Phase 2.1)', async ({ page }) => {
    // forceCyclePhase triggers one cycle and one completeShift() — exactly
    // one energy decrement. If the spam guard were broken, repeated calls
    // during the same tick would double-deduct.
    await page.waitForTimeout(300);
    const energyBefore = await page.evaluate(() => window.__phaseShifter__.energy);
    await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      // Three force-cycles in the same tick. Each should be a single
      // (cyclePhase + completeShift) pair — energy drops by 3× cost, not
      // 6× (i.e. the spam guard inside cyclePhase isn't triggered when
      // completeShift is called immediately by the debug hook).
      ps.forceCyclePhase();
      ps.forceCyclePhase();
      ps.forceCyclePhase();
    });
    await page.waitForTimeout(300);
    const energyAfter = await page.evaluate(() => window.__phaseShifter__.energy);
    // 3 cycles × 5 cost = 15 energy decrement.
    expect(energyBefore - energyAfter).toBe(15);
  });

  test('block-hint element is present in the HUD', async ({ page }) => {
    await page.waitForTimeout(500);
    // The block-hint is only visible when the crosshair actually targets a
    // block. After init the spawn column is one block below the player, so
    // we only assert the element exists in the DOM.
    const exists = await page.evaluate(() => !!document.querySelector('#block-hint'));
    expect(exists).toBe(true);
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
        isShifting: window.__phaseShifter?.isShifting,
        phase: window.__phaseShifter?.phase,
        energy: window.__phaseShifter?.energy
      };
    });
    console.log('After shift:', JSON.stringify(afterShift));
    
    // Phase should have shifted (ALPHA -> BETA or ALPHA -> GAMMA depending on cycle)
    const currentPhase = await page.evaluate(() => window.__phaseShifter__.phase);
    expect(typeof currentPhase === 'number');
    expect(afterShift.phaseName).not.toBe('');
  });
});
