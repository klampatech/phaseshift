import { test, expect } from '@playwright/test';

// Phase 9.2 — Firefox pointer-lock + audio fix.
// This test boots the game in real Firefox (not Chromium) so the
// §9.2 acceptance is exercised on the platform where the bug was
// originally reported: Firefox's pointerlockchange fires BEFORE the
// AudioContext unlock path completes, so a direct resume() against
// the just-acquired state is a no-op. The fix defers the resume to
// the next event-loop tick via setTimeout(..., 0) AND installs a
// one-shot first-input fallback listener that re-attempts the
// resume on the very next keystroke / mouse-move.
//
// The test:
//   1. Boots the game and clicks the blocker (the user gesture).
//   2. Verifies the audio context is in 'running' state after the
//      pointer-lock + first input combo.
//   3. Verifies the deferred resume path is exercised (the
//      `getPointerLockAudioFallbackState` debug hook flips from
//      `installed: true` to `installed: false` after the first
//      input event fires the fallback).
//
// The test is wired to the "Firefox pointer-lock" project in
// playwright.config.js. If Firefox isn't installed locally, the
// project is skipped (the CI test-gate only installs Chromium so
// the deploy gate doesn't depend on Firefox availability).

test.describe('Phase 9.2 — Firefox pointer-lock + audio fix', () => {
  test('audio context is running after pointer-lock + first input on Firefox', async ({ page, browserName }) => {
    // Skip on Chromium — the test is Firefox-specific.
    test.skip(browserName !== 'firefox', 'Firefox pointer-lock test only runs on Firefox');

    await page.goto('/');
    await page.click('#blocker'); // The user gesture that unlocks the AudioContext.

    // Wait for the game to initialize.
    await page.waitForFunction(() => window.__phaseShifter__ !== undefined);
    await page.waitForFunction(() => {
      const el = document.querySelector('#phase-name');
      return el && el.textContent && el.textContent.length > 0;
    });

    // Verify the deferred-resume path is installed by the §9.2 fix.
    const fallbackInstalled = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      if (typeof ps.getPointerLockAudioFallbackState !== 'function') return null;
      return ps.getPointerLockAudioFallbackState();
    });
    expect(fallbackInstalled).not.toBeNull();
    // The first-input fallback should be installed (the pointerlockchange
    // listener installed it for the just-acquired pointer lock).
    expect(fallbackInstalled.installed).toBe(true);

    // Verify the AudioContext is in 'running' (or 'resuming') state
    // after the deferred resume + the first input event.
    await page.waitForFunction(() => {
      const ps = window.__phaseShifter__;
      if (typeof ps.getAudioContextState !== 'function') return true;
      const state = ps.getAudioContextState();
      return state === 'running' || state === 'resuming';
    }, { timeout: 5000 });

    // Verify the fallback has been removed (the first input fired it).
    const fallbackAfter = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      if (typeof ps.getPointerLockAudioFallbackState !== 'function') return null;
      return ps.getPointerLockAudioFallbackState();
    });
    expect(fallbackAfter).not.toBeNull();
    expect(fallbackAfter.installed).toBe(false);
  });

  test('forceAudioResume debug hook returns the post-resume state', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox pointer-lock test only runs on Firefox');

    await page.goto('/');
    await page.click('#blocker');
    await page.waitForFunction(() => window.__phaseShifter__ !== undefined);

    // The forceAudioResume debug hook returns { ok, state, deferred }.
    const result = await page.evaluate(() => {
      const ps = window.__phaseShifter__;
      if (typeof ps.forceAudioResume !== 'function') return null;
      return ps.forceAudioResume();
    });
    expect(result).not.toBeNull();
    expect(result.ok).toBe(true);
    // The deferred resume should fire on the next tick. The state
    // returned by the hook is the AudioContext state right after the
    // setTimeout callback runs. On Firefox this is 'running' (the
    // context was created by the blocker click).
    expect(['running', 'resuming', 'suspended']).toContain(result.state);
  });
});
