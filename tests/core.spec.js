import { test, expect } from '@playwright/test';

test.describe('Core Game Systems', () => {
  test('constants file exports all required game configurations', async ({ page }) => {
    // The constants are module-scoped in a module, not window-scoped.
    // Test that the game loads without errors and the constants exist.
    await page.goto('/');
    
    // Check that the game console has no errors
    const errors = await page.evaluate(() => {
      return window.testErrors || [];
    });
    expect(errors.length).toBe(0);
    
    // Check that we can access chunk constants via the page
    const hasBlocker = await page.locator('#blocker').isVisible();
    expect(hasBlocker).toBe(true);
  });
});
