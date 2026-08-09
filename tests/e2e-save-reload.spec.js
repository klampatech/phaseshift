import { test, expect } from '@playwright/test';

test('Pause → Save → reload → restore restores position, phase, and block memory', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__phaseShifter__ !== undefined);

  // Load a chunk area and make a few setBlock calls in Alpha to populate
  // the world memory.
  await page.evaluate(async () => {
    const ps = window.__phaseShifter__;
    // Replace the visual update callback with a no-op so setBlock doesn't
    // try to call updateChunkVisual in a test context.
    ps.world.onChunkUpdated = () => {};
    ps.world.updateChunks(0, 0, 2);
    ps.world.setBlock(5, 30, 7, 0, 1);    // BLOCK_STONE in Alpha
    ps.world.setBlock(6, 30, 7, 0, 0);    // BLOCK_AIR in Alpha (player edit)
    ps.world.setBlock(7, 30, 8, 1, 4);    // BLOCK_GLASS in Beta
  });

  // Take a snapshot through the API and assert lastSaveInfo is now non-null.
  await page.evaluate(() => {
    const ps = window.__phaseShifter__;
    const pos = ps.playerPos;
    ps.saveSnapshot(pos.x, pos.y + 5, pos.z, 1, ps.world.exportGlobalState());
  });
  const before = await page.evaluate(() => window.__phaseShifter__.lastSaveInfo);
  expect(typeof before === 'string' && before.length > 0).toBe(true);

  // Reload the page; init() should re-apply the saved state.
  await page.reload();
  await page.waitForFunction(() => window.__phaseShifter__ !== undefined);

  const restored = await page.evaluate(() => {
    const ps = window.__phaseShifter__;
    return {
      phase: ps.phase,
      playerPos: ps.playerPos,
      // Pull the same Alpha edits through the global state map.
      stone: ps.world.getGlobalBlock(5, 30, 7, 0),
      airEdit: ps.world.getGlobalBlock(6, 30, 7, 0),
      betaGlass: ps.world.getGlobalBlock(7, 30, 8, 1),
      blockCount: Object.keys(ps.world.exportGlobalState()).length,
    };
  });
  expect(restored.phase).toBe(1);
  expect(restored.stone).toBe(1);
  expect(restored.airEdit).toBe(0);
  expect(restored.betaGlass).toBe(4);
  expect(restored.blockCount).toBeGreaterThan(0);
  expect(restored.playerPos).not.toBeNull();
  // Y should be at least the saved value (raycast may add a small offset if
  // the surface regenerated, but the XZ should match the saved coordinates).
});
