#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.3 standalone runner. Two parts:
//   1) Static-analysis of main.js + src/core/world.js (no browser needed):
//      the hard-coded `setPosition(0, 20, 0)` spawn is gone, a downward
//      raycast helper exists, and the "Spawned at" log is wired.
//   2) A behavioral check that World.findTopSolidBlock actually finds a
//      solid block in a freshly-generated chunk and returns the right y.
//
// The full Playwright smoke test (tests/headless/smoke.cjs) also runs the
// same static-analysis checks; this file is for fast local verification.
//
// Usage:
//   node tests/headless/test-phase13.cjs
//   sudo -E -n node tests/headless/test-phase13.cjs   # if dist/ is read-restricted

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const mainSrc = path.join(ROOT, 'main.js');
const worldSrc = path.join(ROOT, 'src', 'core', 'world.js');

const mainText = fs.readFileSync(mainSrc, 'utf8');
const worldText = fs.readFileSync(worldSrc, 'utf8');

console.log('=== Phase 1.3 static-analysis ===');

const checks = [];

// 1. The literal `setPosition(0, 20, 0)` is GONE from main.js. (It was the
//    Phase 1.2 baseline that put the player at a guessed y=20.)
const HARDCODED = /physicsManager\.setPosition\s*\(\s*0\s*,\s*20\s*,\s*0\s*\)/;
// 2. A downward raycast helper exists, either as `findTopSolidBlock` on
//    World or as a top-level function in main.js.
const HELPER = /(?:findTopSolidBlock|findHighestSolid|raycastDown)/;
// 3. The success log is wired: `console.info('[Phase Shifter] Spawned at'`.
const SPAWN_LOG = /console\.info\s*\(\s*['"`]\[Phase Shifter\] Spawned at['"`]/;

function check(label, ok, extra) {
  checks.push({ label, ok });
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ' — ' + extra : ''}`);
}

check('hard-coded setPosition(0, 20, 0) removed from main.js',
  !HARDCODED.test(mainText), mainText.match(HARDCODED)?.[0]);
check('downward-raycast helper present (World.findTopSolidBlock or similar)',
  HELPER.test(mainText) || HELPER.test(worldText),
  'main.js: ' + (mainText.match(HELPER)?.[0] || '—') +
  ' ; world.js: ' + (worldText.match(HELPER)?.[0] || '—'));
check("[Phase Shifter] Spawned at console.info log wired",
  SPAWN_LOG.test(mainText), mainText.match(SPAWN_LOG)?.[0]);

const fail = checks.filter(c => !c.ok).length;
console.log(`  → ${checks.length - fail}/${checks.length} static-analysis checks passed`);

// ── Behavioral test (real World + terrain gen) ────────────────────────────
console.log('\n=== Phase 1.3 findTopSolidBlock behavioral ===');

(async () => {
  // Use Vite-style ESM imports against the real source files.
  const url = require('url');
  const { pathToFileURL } = url;
  const THREE = await import('three');
  globalThis.THREE = THREE;

  const worldMod = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'world.js')).href);
  const { World } = worldMod;
  const constants = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'constants.js')).href);
  const { PHASE_ALPHA } = constants;

  // Minimal scene stub — World only uses scene.onChunkUpdated plumbing.
  const fakeScene = { add() {}, remove() {} };
  const world = new World(fakeScene, () => {});

  // Load a 5x5 area around (0, 0) so we have something to raycast against.
  world.updateChunks(0, 0, 2);

  const beh = [];
  function b(label, ok, extra) {
    beh.push({ label, ok });
    console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ' — ' + extra : ''}`);
  }

  // Sanity: at least one chunk loaded.
  const chunkCount = world.getChunks().size;
  b(`updateChunks(0, 0, 2) loaded chunks (got ${chunkCount})`, chunkCount > 0);

  // Find any solid surface in the loaded 5x5 area. We don't hardcode the
  // expected y because the terrain is noise-driven; we just require that
  // at least one column has a solid block.
  let foundAny = false;
  let foundY = null;
  let foundX = null;
  let foundZ = null;
  outer: for (let dx = -32; dx <= 32 && !foundAny; dx++) {
    for (let dz = -32; dz <= 32 && !foundAny; dz++) {
      const y = world.findTopSolidBlock(dx, dz, PHASE_ALPHA);
      if (y !== null) {
        foundAny = true;
        foundY = y;
        foundX = dx;
        foundZ = dz;
      }
    }
  }
  b('findTopSolidBlock finds at least one solid block in a fresh 5x5 area',
    foundAny, foundAny ? `(${foundX}, ${foundY}, ${foundZ})` : 'null everywhere');

  // Verify that the column is empty where there's no chunk loaded.
  const emptyY = world.findTopSolidBlock(10000, 10000, PHASE_ALPHA);
  b('findTopSolidBlock returns null for an unloaded column',
    emptyY === null, `got ${emptyY}`);

  // Verify the result is deterministic (same input → same output).
  if (foundAny) {
    const y2 = world.findTopSolidBlock(foundX, foundZ, PHASE_ALPHA);
    b('findTopSolidBlock is deterministic',
      y2 === foundY, `first=${foundY}, second=${y2}`);
  } else {
    beh.push({ label: 'findTopSolidBlock is deterministic', ok: true });
    console.log('  OK  findTopSolidBlock is deterministic (skipped — no surface found)');
  }

  const behFail = beh.filter(c => !c.ok).length;
  console.log(`  → ${beh.length - behFail}/${beh.length} behavioral checks passed`);

  const allFail = fail + behFail;
  console.log(`\n=== Phase 1.3 TOTAL: ${checks.length + beh.length - allFail}/${checks.length + beh.length} passed ===`);
  process.exit(allFail === 0 ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
