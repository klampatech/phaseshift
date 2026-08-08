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
  ],
});
