import { test, expect } from '@playwright/test';

test.describe('Debug Tests', () => {
  test('check page loads', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => {
      errors.push(err.message);
    });
    
    await page.goto('/');
    await page.waitForTimeout(3000);
    
    console.log('=== Page Errors ===');
    errors.forEach(e => console.log(e));
    console.log('===================');
    
    // Check if the error prevents __phaseShifter__ from loading
    const phaseShifterState = await page.evaluate(() => {
      if (!window.__phaseShifter__) {
        return { hasGlobal: false, error: 'window.__phaseShifter__ is undefined' };
      }
      const ps = window.__phaseShifter__;
      return {
        hasGlobal: true,
        chunkCount: ps.worldData?.chunkCount ?? 'N/A',
        blockCount: ps.worldData?.blockCount ?? 'N/A',
        currentPhase: ps.phase,
        energy: ps.energy,
        playerPos: ps.playerData?.position ? ps.playerData.position : 'N/A'
      };
    });
    console.log('Phase shifter state:', JSON.stringify(phaseShifterState, null, 2));
    
    // Check what's in constants.js by loading it directly
    const constantsContent = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/constants.js');
        return { hasBlockWood: 'BLOCK_WOOD' in mod, blockWood: mod.BLOCK_WOOD };
      } catch(e) {
        return { error: e.message };
      }
    });
    console.log('Constants module:', JSON.stringify(constantsContent, null, 2));
  });
});
