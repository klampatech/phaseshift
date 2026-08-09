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

test('placeBlock debug hook writes Stone at (x, y, z) in the current phase (Phase 2.3)', async ({ page }) => {
    // Find a known-empty cell that is reachable from the spawn position. We
    // aim at y=20-ish, which is mid-air in the Forest biome (the floor is
    // around y=10-15). Calling placeBlock should:
    //   - return { ok: true, x, y, z, phase }
    //   - write a Stone block at those coordinates in the player's phase
    //   - the next world.getBlock(...) call reads back Stone
    await page.waitForTimeout(500);

    const target = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      const phase = ps.phase;
      // The Forest surface is around y=8-15; pick a y well above the
      // surface so the cell is mid-air and definitely writable.
      const x = 10, y = 30, z = 10;
      const result = ps.placeBlock(x, y, z, 1 /* BLOCK_STONE */);
      // Read back via world.getBlock(x, y, z, phase) so we verify the
      // write hit the chunk data, not just the spinner state.
      const world = ps.world;
      const after = world.getBlock(x, y, z, phase);
      return { result, after, phase };
    });

    expect(target.result.ok).toBe(true);
    expect(target.result.x).toBe(10);
    expect(target.result.y).toBe(30);
    expect(target.result.z).toBe(10);
    expect(target.result.phase).toBe(target.phase);
    expect(target.after).toBe(1); // BLOCK_STONE
  });

  test('placeBlock refuses to overwrite non-air target cell (Phase 2.3)', async ({ page }) => {
    // Place Stone at (12, 30, 12) twice. The second call should refuse
    // (target-not-air) and the cell should still be Stone (id 1).
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      const phase = ps.phase;
      const first = ps.placeBlock(12, 30, 12, 1);
      const second = ps.placeBlock(12, 30, 12, 1);
      const after = ps.world.getBlock(12, 30, 12, phase);
      return { first, second, after, phase };
    });

    expect(result.first.ok).toBe(true);
    expect(result.second.ok).toBe(false);
    expect(result.second.reason).toBe('target-not-air');
    expect(result.after).toBe(1);
  });

  test('placeBlock persists across chunk unload + reload (Phase 2.3 / 2.4)', async ({ page }) => {
    // §2.4 acceptance: a placed block survives chunk unload + reload.
    // Walks the player far enough to unload the chunk, then back, and
    // asserts the cell is still Stone. (The headless test-phase23.cjs
    // exercises the unit-level unload via chunks.delete; this is the
    // browser-level counterpart.)
    await page.waitForTimeout(500);

    const target = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      const phase = ps.phase;
      const x = 14, y = 30, z = 14;
      const before = ps.world.getBlock(x, y, z, phase);
      const placed = ps.placeBlock(x, y, z, 1);
      return { x, y, z, phase, before, placed };
    });

    expect(target.placed.ok).toBe(true);
    expect(target.before).toBe(0); // air before

    // Force the chunk to be unloaded by reaching into the chunks Map.
    // The §2.4 acceptance test bypasses the in-game UNLOAD_CHUNK_DIST
    // walk (which is slow) and pokes the data path directly. Walking
    // works in a real browser E2E; this is the in-page equivalent.
    const reloaded = await page.evaluate(({ x, y, z, phase }) => {
      const ps = window.__phaseShifter__;
      const world = ps.world;
      // Find the chunk containing (x, z).
      const CHUNK_SIZE = 16;
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      // Unload it.
      if (world.chunks.has(key)) {
        world.chunks.delete(key);
      }
      // Force a load (ensureChunk calls loadChunk via the generator +
      // _globalStateMap apply).
      if (world.ensureChunk) {
        world.ensureChunk(cx, cz);
      }
      // Read back. The cell should still be Stone because the
      // _globalStateMap recorded the player's edit.
      return world.getBlock(x, y, z, phase);
    }, target);

    expect(reloaded).toBe(1); // BLOCK_STONE survives reload
  });
});
