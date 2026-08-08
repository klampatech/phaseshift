import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => {
  const text = msg.text();
  if (text.includes('Error') || text.includes('error') || text.includes('Init failed')) {
    console.log('BROWSER:', text);
  }
});

try {
  await page.goto('http://localhost:3002');
  await page.waitForTimeout(5000);
  
  const debug = await page.evaluate(() => {
    const ps = window.__phaseShifter__;
    if (!ps) return 'NO PS';
    if (!ps.worldData) return 'NO WORLD DATA';
    
    const chunkCount = ps.worldData.chunkCount;
    const blockCount = ps.worldData.blockCount;
    
    let totalBlocks = 0;
    let chunkInfo = [];
    
    if (ps.world && ps.world.getChunks) {
      const chunks = ps.world.getChunks();
      chunks.forEach((chunk, key) => {
        const blockInfo = {
          alpha: chunk.alphaData ? chunk.alphaData.filter(b => b !== 0).length : 0,
          beta: chunk.betaData ? chunk.betaData.filter(b => b !== 0).length : 0,
          gamma: chunk.gammaData ? chunk.gammaData.filter(b => b !== 0).length : 0,
          loaded: chunk.loaded
        };
        totalBlocks += blockInfo.alpha + blockInfo.beta + blockInfo.gamma;
        chunkInfo.push({ key, ...blockInfo });
      });
    }
    
    return { chunkCount, blockCount, totalBlocks, chunks: chunkInfo.slice(0, 3) };
  });
  
  console.log('DEBUG:', JSON.stringify(debug, null, 2));
} catch (e) {
  console.log('ERROR:', e.message);
}

await browser.close();
