import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => {
  console.log('BROWSER LOG:', msg.type(), '-', msg.text());
});
page.on('pageerror', err => {
  console.log('PAGE ERROR:', err);
});

try {
  await page.goto('http://localhost:3002');
  await page.waitForTimeout(4000);
  
  const chunks = await page.evaluate(() => {
    const ps = window.__phaseShifter__;
    if (!ps) return 'NO PS';
    return ps.worldData ? ps.worldData.chunkCount : 'NO WORLD DATA';
  });
  
  console.log('CHUNKS:', chunks);
} catch (e) {
  console.log('ERROR:', e.message);
}

await browser.close();
