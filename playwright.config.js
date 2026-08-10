import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3002',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 3002',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  testMatch: '**/*.spec.js',
  reporter: [['html', { outputFolder: './reports/html' }]],
  projects: [
    {
      name: 'Phase Shifter Tests',
      testIgnore: /playwright/,
    },
    // Phase 9.2: Firefox pointer-lock audio test. Boots the game
    // in real Firefox (not Chromium) so the §9.2 acceptance is
    // exercised on the platform where the bug was originally
    // reported. The test is gated on Firefox availability — if
    // `npx playwright install firefox` hasn't been run, the
    // project is skipped (the test-gate CI only installs
    // Chromium; the developer who wants the Firefox test runs
    // `npx playwright install --with-deps firefox` locally).
    {
      name: 'Firefox pointer-lock',
      testMatch: '**/firefox-pointer-lock.spec.js',
      use: {
        browserName: 'firefox',
        launchOptions: {
          // Firefox headless without a GPU still works for the
          // AudioContext tests (the audio context construction
          // doesn't require WebGL). The pre-existing §6 grep
          // for `--use-gl=angle` is in smoke.cjs (Chromium-only).
        },
      },
    },
  ],
});
