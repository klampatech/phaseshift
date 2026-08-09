#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.5 verification: world-coordinate chunk lookup and canonical writes.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const mainPath = path.join(ROOT, 'main.js');
const worldText = fs.readFileSync(worldPath, 'utf8');
const mainText = fs.readFileSync(mainPath, 'utf8');
const results = [];
function check(label, ok, extra = '') {
  results.push(ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 1.5 source checks ===');
  check('World.getChunk(x, z) is defined', /getChunk\s*\(\s*x\s*,\s*z\s*\)/.test(worldText));
  check('active main.js has no chunk.x/chunk.z reads', !/\bchunk\.(?:x|z)\b/.test(mainText));
  check('main.js has no direct chunk phase-data writes',
    !/chunk\.(?:alpha|beta|gamma)Data\s*\[[^\]]+\]\s*=/.test(mainText));
  const placeStart = mainText.indexOf('function placeBlockAt(');
  const placeEnd = mainText.indexOf('\n}', placeStart) + 2;
  const placeText = mainText.slice(placeStart, placeEnd);
  check('placeBlockAt routes through world.setBlock', /world\.setBlock\s*\(/.test(placeText));
  check('placeBlockAt writes the current phase', /phaseManager\.getCurrentPhase\s*\(\s*\)/.test(placeText));

  console.log('\n=== Phase 1.5 behavior ===');
  const { World } = await import(pathToFileURL(worldPath).href);
  const constants = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'constants.js')).href);
  const { PHASE_ALPHA, BLOCK_GLASS } = constants;
  let updates = 0;
  const world = new World({ add() {}, remove() {} }, () => { updates++; });
  world.ensureChunk(0, 0);
  world.ensureChunk(-1, -1);
  check('getChunk finds origin chunk', world.getChunk(0, 0)?.cx === 0 && world.getChunk(0, 0)?.cz === 0);
  check('getChunk floors positive boundary coordinates',
    world.getChunk(15, 15)?.cx === 0 && world.getChunk(16, 16) === undefined);
  check('getChunk floors negative world coordinates',
    world.getChunk(-1, -1)?.cx === -1 && world.getChunk(-1, -1)?.cz === -1);
  check('getChunk returns undefined for unloaded coordinates', world.getChunk(1000, 1000) === undefined);

  const before = updates;
  world.setBlock(-1, 30, -1, PHASE_ALPHA, BLOCK_GLASS);
  check('setBlock updates block through negative-coordinate chunk lookup',
    world.getBlock(-1, 30, -1, PHASE_ALPHA) === BLOCK_GLASS);
  check('setBlock records the global state',
    world.getGlobalBlock(-1, 30, -1, PHASE_ALPHA) === BLOCK_GLASS);
  check('setBlock triggers visual update callback', updates === before + 1, `updates=${updates - before}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 1.5 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
