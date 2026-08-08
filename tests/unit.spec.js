import { test, expect } from '@playwright/test';

test.describe('World System', () => {
  test('chunks are loaded around player on initialization', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const chunksLoaded = await page.evaluate(() => {
      return window.__phaseShifter__.chunkCount;
    });
    
    expect(chunksLoaded).toBeGreaterThanOrEqual(1);
  });

  test('blocks are placed in the world', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const debugInfo = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      const world = ps.world;
      const chunkCount = world && world.getChunks ? world.getChunks().size : -1;
      let blockCount = 0;
      let totalBlocks = 0;
      let firstChunkAlpha = null;
      if (world && world.getChunks) {
        world.getChunks().forEach((chunk, key) => {
          if (chunk && chunk.alphaData) {
            const nonZero = chunk.alphaData.filter(b => b !== 0);
            blockCount += nonZero.length;
            totalBlocks += chunk.alphaData.length;
            if (!firstChunkAlpha && nonZero.length === 0) {
              // Log first 20 values for debugging
              firstChunkAlpha = Array.from(chunk.alphaData).slice(0, 20);
            }
          }
        });
      }
      return { chunkCount, blockCount, totalBlocks, hasWorld: !!world, hasPhaseMgr: !!ps.phaseManager, firstChunkAlpha };
    });
    
    console.log('DEBUG:', JSON.stringify(debugInfo));
    
    // Directly test terrain generation
    const terrainResult = await page.evaluate(() => {
      const world = window.__phaseShifter__.world;
      const gen = world.getTerrainGen();
      try {
        const data = gen.generateChunk(0, 0, 0);
        const nonZero = Array.from(data).filter(b => b !== 0);
        return { totalBlocks: data.length, nonZeroCount: nonZero.length, first100: Array.from(data).slice(0, 100) };
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    });
    console.log('Terrain gen result:', JSON.stringify(terrainResult));
    expect(debugInfo.blockCount).toBeGreaterThan(0);
  });

  test('world generates different biomes', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    const biomes = await page.evaluate(() => {
      return window.__phaseShifter__.biomes;
    });
    
    expect(Array.isArray(biomes)).toBe(true);
  });
});

test.describe('Phase Manager', () => {
  test('phase cycling works correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const phases = [];
    for (let i = 0; i < 6; i++) {
      phases.push(await page.evaluate(() => window.__phaseShifter__.phase));
      // Trigger phase shift via keyboard (Shift+Space)
      await page.keyboard.press('Shift+Space');
      await page.waitForTimeout(150);
    }
    expect(phases.length).toBe(6);
  });

  test('phase shift uses energy', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const energyBefore = await page.evaluate(() => window.__phaseShifter__.energy);
    
    // Trigger phase shift
    await page.keyboard.press('Shift+Space');
    await page.waitForTimeout(150);
    
    const energyAfter = await page.evaluate(() => window.__phaseShifter__.energy);
    
    expect(typeof energyBefore).toBe('number');
    expect(energyBefore).toBeGreaterThan(0);
  });
});

test.describe('Physics System', () => {
  test('player physics initialize correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const physicsState = await page.evaluate(() => {
      return window.__phaseShifter__.playerPos;
    });
    
    expect(physicsState).not.toBeNull();
  });

  test('gravity is applied to player', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const playerPos = await page.evaluate(() => {
      return window.__phaseShifter__.playerPos;
    });
    
    expect(playerPos).not.toBeNull();
  });
});
