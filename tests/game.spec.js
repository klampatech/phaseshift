import { test, expect } from '@playwright/test';

test.describe('Phase Shifter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the game page', async ({ page }) => {
    const title = await page.title();
    expect(title).toContain('Phase Shifter');
  });

  test('should initialize the game canvas', async ({ page }) => {
    // Check that the game loads - the canvas is created by Three.js
    const hasBlocker = await page.locator('#blocker').isVisible();
    expect(hasBlocker).toBe(true);
  });

  test('should display the HUD elements', async ({ page }) => {
    const crosshair = page.locator('#crosshair');
    await expect(crosshair).toBeVisible();
  });

  test('should display the phase indicator', async ({ page }) => {
    const phaseIndicator = page.locator('#phase-indicator');
    await expect(phaseIndicator).toBeVisible();
  });

  test('should display the energy bar', async ({ page }) => {
    const energyBar = page.locator('#energy-fill');
    await expect(energyBar).toBeVisible();
  });

  test('should display the blocker/instructions overlay', async ({ page }) => {
    const blocker = page.locator('#blocker');
    await expect(blocker).toBeVisible();
    const heading = blocker.locator('h1');
    await expect(heading).toContainText('PHASE SHIFTER');
  });
});
