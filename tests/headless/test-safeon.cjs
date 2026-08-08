#!/usr/bin/env node
// Phase 1.1 safeOn unit test. Runs in any browser (no WebGL needed).
// Usage: node tests/headless/test-safeon.cjs
const path = require('path');
let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch {
  chromium = require(path.resolve(__dirname, '..', '..', 'node_modules', 'playwright-core')).chromium;
}

const HTML = path.resolve(__dirname, 'safeon-unit.html');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => window.__test_results__ !== undefined);
  const results = await page.evaluate(() => window.__test_results__);
  console.log(JSON.stringify(results, null, 2));
  await page.screenshot({ path: path.resolve(__dirname, 'safeon-unit.png'), fullPage: true });
  await browser.close();
  process.exit(results.failed === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
