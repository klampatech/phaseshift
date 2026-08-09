#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.4 verification: centralized chunk indexing and get/set behavior.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const mainPath = path.join(ROOT, 'main.js');
const worldText = fs.readFileSync(worldPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const mainText = fs.readFileSync(mainPath, 'utf8');
const results = [];
function check(label, ok, extra = '') {
  results.push(ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  const { World } = await import(pathToFileURL(worldPath).href);
  const constants = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'constants.js')).href);
  const { CHUNK_SIZE, CHUNK_HEIGHT, PHASE_ALPHA, BLOCK_AIR, BLOCK_STONE, BLOCK_GLASS, BLOCK_WOOD } = constants;
  const world = new World({ add() {}, remove() {} }, () => {});

  console.log('=== Phase 1.4 index helpers ===');
  const points = [
    [0, 0, 0],
    [CHUNK_SIZE - 1, CHUNK_HEIGHT - 1, CHUNK_SIZE - 1],
    [5, 32, 7],
    [0, 63, 0],
    [15, 0, 15],
  ];
  for (const [x, y, z] of points) {
    const unpacked = world.unpackIndex(world.index(x, y, z));
    check(`round-trip (${x}, ${y}, ${z})`,
      unpacked.x === x && unpacked.y === y && unpacked.z === z,
      JSON.stringify(unpacked));
    check(`localIndex matches index at (${x}, ${y}, ${z})`,
      world.localIndex(x, y, z) === world.index(x, y, z));
  }

  console.log('\n=== Phase 1.4 source checks ===');
  check('World.index is defined', /\bindex\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText));
  check('World.localIndex is defined', /\blocalIndex\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText));
  check('World.unpackIndex is defined', /\bunpackIndex\s*\(\s*i\s*\)/.test(worldText));
  const getSet = worldText.slice(worldText.indexOf('getBlock('), worldText.indexOf('// Build/update chunk meshes'));
  check('getBlock/setBlock raw formulas removed', !/\b(?:lx|x)\s*\+\s*(?:wy|y)\s*\*\s*CHUNK_SIZE\s*\+\s*(?:lz|z)\s*\*\s*CHUNK_SIZE\s*\*\s*CHUNK_HEIGHT/.test(getSet));
  check('renderer uses unpackIndex', /world\.unpackIndex\s*\(\s*i\s*\)/.test(rendererText));
  check('renderer neighbor lookup uses localIndex', /world\.localIndex\s*\(\s*nx\s*,\s*ny\s*,\s*nz\s*\)/.test(rendererText));
  // Phase 1.4 + 2.5 + 2.6: performScan delegates to
  // world.findPhaseDifferences and performResonance delegates to
  // world.resonateWithReport — neither reads world.index directly.
  // The Phase 1.4 assertion was "scan/resonance use World.index" —
  // both used it. The new contract: BOTH performScan and
  // performResonance delegate to world APIs (no direct chunk
  // indexing in main.js).
  const performScanBody = mainText.match(
    /function\s+performScan\s*\([^)]*\)\s*\{[^}]*\}/
  );
  const performResonanceBody = mainText.match(
    /function\s+performResonance\s*\([^)]*\)\s*\{[^}]*\}/
  );
  check('main.js#performScan no longer uses world.index directly (Phase 2.5)', performScanBody && !/world\.index\s*\(/.test(performScanBody[0]));
  check('main.js#performResonance no longer uses world.index directly (Phase 2.6)', performResonanceBody && !/world\.index\s*\(/.test(performResonanceBody[0]));

  console.log('\n=== Phase 1.4 get/set behavior ===');
  world.updateChunks(0, 0, 2);
  for (const block of [BLOCK_STONE, BLOCK_AIR, BLOCK_GLASS, BLOCK_WOOD]) {
    world.setBlock(5, 30, 7, PHASE_ALPHA, block);
    check(`setBlock/getBlock round-trip for block ${block}`,
      world.getBlock(5, 30, 7, PHASE_ALPHA) === block);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 1.4 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
