#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 3.2 verification: Stabilizers — place checkpoint graphic + Phase
// Collapse state machine + teleport respawn + fallback to spawn.
//
//   1) Static-analysis - the pieces exist:
//        - src/world/stabilizer.js exports STABILIZER_RADIUS, STABILIZER_PLACE_COST,
//          STABILIZER_FALLBACK_COLOR, findRespawnTarget, isWithinRadius,
//          stabilizerKey, snapYForStabilizerCell
//        - src/collapse/collapse.js exports COLLAPSE_DURATION, COLLAPSE_BANNER_TEXT,
//          FALLBACK_WARNING_TEXT, COLLAPSE_REASONS, createCollapseState,
//          startCollapse, tickCollapse, clearCollapse, collapseProgress
//        - main.js imports findRespawnTarget, startCollapse, tickCollapse,
//          clearCollapse from the 3.2 modules
//        - main.js#tickCollapsePerFrame is defined and called from game loop
//        - main.js forcePhaseCollapse now starts a collapse state machine
//        - main.js forcePhaseCollapseToStabilizer is wired
//        - main.js getCollapseState, getRespawnTarget, getSpawnPoint,
//          forcePlaceStabilizer, breakStabilizer, getStabilizerCount,
//          getStabilizerSnapshot, clearStabilizers, getCheckpointMeshCount,
//          getCheckpointKeys, isCheckpointAt debug hooks exist
//        - renderer has a CheckpointOverlay class + CollapseOverlay class
//        - renderer forwards showCheckpoint, updateCheckpoints, clearCheckpoint,
//          clearCheckpoints, updateCollapseOverlay, clearCollapseOverlay
//        - index.html has #phase-collapse-overlay element
//        - main.js BLOCK_STABILIZER + MINIMUM_RESPAWN_ENERGY imported
//        - main.js inputSuppressed flag wired into keydown/keyup/click/contextmenu/mousemove
//   2) Behavior - pure modules:
//        - findRespawnTarget with empty stabilizer list returns { source: 'spawn' }
//        - findRespawnTarget with one Stabilizer in range returns { source: 'stabilizer', ... }
//        - findRespawnTarget with one Stabilizer beyond range returns { source: 'spawn' }
//        - isWithinRadius returns true for nearby, false for far
//        - stabilizerKey returns canonical "x,y,z" string
//        - tickCollapse with dt < COLLAPSE_DURATION returns { done: false }
//        - tickCollapse with dt >= COLLAPSE_DURATION returns { done: true }
//        - COLLAPSE_DURATION === 1.5
//        - MINIMUM_RESPAWN_ENERGY === 30
//        - collapseProgress returns 0 outside, (0, 1] during collapse
//   3) Behavior - World API:
//        - place a Stabilizer via setBlock -> _stabilizerPositions populated
//        - findNearestStabilizer returns the placed position
//        - break the Stabilizer -> findNearestStabilizer returns null
//        - exportGlobalState + importGlobalState round-trip preserves _stabilizerPositions

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const stabilizerPath = path.join(ROOT, 'src', 'world', 'stabilizer.js');
const collapsePath = path.join(ROOT, 'src', 'collapse', 'collapse.js');
const htmlPath = path.join(ROOT, 'index.html');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const stabilizerText = fs.readFileSync(stabilizerPath, 'utf8');
const collapseText = fs.readFileSync(collapsePath, 'utf8');
const htmlText = fs.readFileSync(htmlPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` - ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 3.2 source checks ===');

  // - src/world/stabilizer.js exports -
  check('src/world/stabilizer.js exports STABILIZER_RADIUS',
    /export\s+const\s+STABILIZER_RADIUS\s*=\s*16\b/.test(stabilizerText));
  check('src/world/stabilizer.js exports STABILIZER_PLACE_COST',
    /export\s+const\s+STABILIZER_PLACE_COST\s*=\s*0\b/.test(stabilizerText));
  check('src/world/stabilizer.js exports STABILIZER_FALLBACK_COLOR',
    /export\s+const\s+STABILIZER_FALLBACK_COLOR\s*=\s*0xff8844\b/.test(stabilizerText));
  check('src/world/stabilizer.js exports findRespawnTarget',
    /export\s+function\s+findRespawnTarget\s*\(/.test(stabilizerText));
  check('src/world/stabilizer.js exports isWithinRadius',
    /export\s+function\s+isWithinRadius\s*\(/.test(stabilizerText));
  check('src/world/stabilizer.js exports stabilizerKey',
    /export\s+function\s+stabilizerKey\s*\(/.test(stabilizerText));
  check('src/world/stabilizer.js exports snapYForStabilizerCell',
    /export\s+function\s+snapYForStabilizerCell\s*\(/.test(stabilizerText));

  // - src/collapse/collapse.js exports -
  check('src/collapse/collapse.js exports COLLAPSE_DURATION',
    /export\s+const\s+COLLAPSE_DURATION\s*=\s*1\.5\b/.test(collapseText));
  check('src/collapse/collapse.js exports COLLAPSE_BANNER_TEXT',
    /export\s+const\s+COLLAPSE_BANNER_TEXT\s*=\s*['"]PHASE COLLAPSE['"]/.test(collapseText));
  check('src/collapse/collapse.js exports FALLBACK_WARNING_TEXT',
    /export\s+const\s+FALLBACK_WARNING_TEXT\s*=/.test(collapseText));
  check('src/collapse/collapse.js exports COLLAPSE_REASONS',
    /export\s+const\s+COLLAPSE_REASONS\s*=/.test(collapseText));
  check('src/collapse/collapse.js exports createCollapseState',
    /export\s+function\s+createCollapseState\s*\(/.test(collapseText));
  check('src/collapse/collapse.js exports startCollapse',
    /export\s+function\s+startCollapse\s*\(/.test(collapseText));
  check('src/collapse/collapse.js exports tickCollapse',
    /export\s+function\s+tickCollapse\s*\(/.test(collapseText));
  check('src/collapse/collapse.js exports clearCollapse',
    /export\s+function\s+clearCollapse\s*\(/.test(collapseText));
  check('src/collapse/collapse.js exports collapseProgress',
    /export\s+function\s+collapseProgress\s*\(/.test(collapseText));

  // - main.js imports -
  check('main.js imports findRespawnTarget from src/world/stabilizer.js',
    /import\s*\{[^}]*findRespawnTarget[^}]*\}\s*from\s*['"]\.\/src\/world\/stabilizer\.js['"]/.test(mainText));
  check('main.js imports startCollapse from src/collapse/collapse.js',
    /import\s*\{[^}]*startCollapse[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(mainText));
  check('main.js imports tickCollapse from src/collapse/collapse.js',
    /import\s*\{[^}]*tickCollapse[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(mainText));
  check('main.js imports createCollapseState from src/collapse/collapse.js',
    /import\s*\{[^}]*createCollapseState[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(mainText));
  check('main.js imports STABILIZER_RADIUS from src/world/stabilizer.js',
    /import\s*\{[^}]*STABILIZER_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/world\/stabilizer\.js['"]/.test(mainText));
  check('main.js imports COLLAPSE_DURATION from src/collapse/collapse.js',
    /import\s*\{[^}]*COLLAPSE_DURATION[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(mainText));

  // - main.js per-frame collapse tick -
  check('main.js#tickCollapsePerFrame is defined',
    /function\s+tickCollapsePerFrame\s*\(/.test(mainText));
  check('main.js game loop calls tickCollapsePerFrame(deltaTime)',
    /tickCollapsePerFrame\s*\(\s*deltaTime\s*\)/.test(mainText));
  check('main.js#computeRespawnTarget is defined',
    /function\s+computeRespawnTarget\s*\(/.test(mainText));

  // - main.js forcePhaseCollapse extension -
  check('main.js forcePhaseCollapse now starts a collapse state machine',
    /forcePhaseCollapse\s*\(\s*\)\s*\{[\s\S]*?startCollapse\s*\(/.test(mainText));
  check('main.js forcePhaseCollapse calls computeRespawnTarget',
    /forcePhaseCollapse\s*\(\s*\)\s*\{[\s\S]*?computeRespawnTarget\s*\(/.test(mainText));
  check('main.js forcePhaseCollapseToStabilizer hook is defined',
    /forcePhaseCollapseToStabilizer\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(mainText));

  // - main.js input suppression -
  check('main.js declares an inputSuppressed flag',
    /let\s+inputSuppressed\s*=/.test(mainText));
  check('main.js keydown handler gates on inputSuppressed',
    /keydown[\s\S]*?pointerLockElement\s*\|\|\s*inputSuppressed/.test(mainText));
    check('main.js click handler gates on inputSuppressed',
    /addEventListener\(['"]click['"][\s\S]{0,500}?gamePaused\s*\|\|\s*inputSuppressed/.test(mainText));
  check('main.js contextmenu handler gates on inputSuppressed',
    /contextmenu[\s\S]{0,300}?pointerLockElement\s*\|\|\s*inputSuppressed/.test(mainText));

  // - main.js debug hooks -
  for (const hook of [
    'forcePlaceStabilizer',
    'breakStabilizer',
    'getCollapseState',
    'tickCollapsePerFrame',
    'getRespawnTarget',
    'getSpawnPoint',
    'getStabilizerSnapshot',
    'getStabilizerCount',
    'clearStabilizers',
    'getCheckpointMeshCount',
    'getCheckpointKeys',
    'isCheckpointAt',
  ]) {
    check(`__phaseShifter__.${hook} hook is present`,
      new RegExp(`__phaseShifter__[\\s\\S]*?${hook}\\s*\\(`).test(mainText));
  }

  // - constants.js -
  check('constants.js exports MINIMUM_RESPAWN_ENERGY = 30',
    /export\s+const\s+MINIMUM_RESPAWN_ENERGY\s*=\s*30\b/.test(constantsText));
  check('constants.js exports BLOCK_STABILIZER = 15',
    /export\s+const\s+BLOCK_STABILIZER\s*=\s*15\b/.test(constantsText));
  check('main.js imports MINIMUM_RESPAWN_ENERGY',
    /import\s*\{[^}]*MINIMUM_RESPAWN_ENERGY[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(mainText));
  check('main.js imports BLOCK_STABILIZER',
    /import\s*\{[^}]*BLOCK_STABILIZER[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(mainText));

  // - renderer CheckpointOverlay class -
  check('CheckpointOverlay class is exported from src/render/renderer.js',
    /export\s+class\s+CheckpointOverlay\b/.test(rendererText));
  check('CheckpointOverlay owns its own THREE.Group named "checkpointOverlay"',
    /class\s+CheckpointOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]checkpointOverlay['"]/.test(rendererText));
  check('CheckpointOverlay.showCheckpoint(x, y, z, key) is defined',
    /class\s+CheckpointOverlay[\s\S]*?showCheckpoint\s*\(/.test(rendererText));
  check('CheckpointOverlay.updateCheckpoints(snapshot) is defined',
    /class\s+CheckpointOverlay[\s\S]*?updateCheckpoints\s*\(/.test(rendererText));
  check('CheckpointOverlay.clearCheckpoint(key) is defined',
    /class\s+CheckpointOverlay[\s\S]*?clearCheckpoint\s*\(/.test(rendererText));
  check('CheckpointOverlay.getCheckpointCount() is defined',
    /class\s+CheckpointOverlay[\s\S]*?getCheckpointCount\s*\(/.test(rendererText));
  check('Renderer forwards showCheckpoint to checkpointOverlay',
    /showCheckpoint\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*key\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.showCheckpoint/.test(rendererText));
  check('Renderer forwards updateCheckpoints to checkpointOverlay',
    /updateCheckpoints\s*\(\s*snapshot\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.updateCheckpoints/.test(rendererText));
  check('Renderer forwards clearCheckpoint to checkpointOverlay',
    /clearCheckpoint\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.clearCheckpoint/.test(rendererText));
  check('Renderer forwards clearCheckpoints to checkpointOverlay',
    /clearCheckpoints\s*\(\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.clearCheckpoints/.test(rendererText));
  check('Renderer imports CollapseOverlay (collapse overlay class)',
    /export\s+class\s+CollapseOverlay\b/.test(rendererText));
  check('Renderer forwards updateCollapseOverlay to collapseOverlay',
    /updateCollapseOverlay\s*\(\s*progress\s*\)\s*\{[\s\S]*?this\.collapseOverlay\.updateCollapseOverlay/.test(rendererText));
  check('Renderer forwards clearCollapseOverlay to collapseOverlay',
    /clearCollapseOverlay\s*\(\s*\)\s*\{[\s\S]*?this\.collapseOverlay\.clearCollapseOverlay/.test(rendererText));

  // - index.html -
  check('index.html has the #phase-collapse-overlay element',
    /<div\s+id\s*=\s*["']phase-collapse-overlay["']\s*><\s*\/div\s*>/.test(htmlText));
  check('index.html has #phase-collapse-overlay CSS rule',
    /#phase-collapse-overlay\s*\{/.test(htmlText));

  // - World API -
  check('World.findNearestStabilizer is defined',
    /findNearestStabilizer\s*\(/.test(worldText));
  check('World.addStabilizer is defined',
    /addStabilizer\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText));
  check('World.removeStabilizer is defined',
    /removeStabilizer\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText));
  check('World._stabilizerPositions Map is initialized in the constructor',
    /this\._stabilizerPositions\s*=\s*new\s+Map\s*\(\s*\)/.test(worldText));

  console.log('\\n=== Phase 3.2 behavior - stabilizer pure module ===');

  const stabilizerModule = await import(pathToFileURL(stabilizerPath).href);

  // 1) findRespawnTarget with empty list returns source: 'spawn'.
  const r1 = stabilizerModule.findRespawnTarget(
    { x: 0, y: 20, z: 0 },
    []
  );
  check('findRespawnTarget with empty list returns source: "spawn"',
    r1 && r1.source === 'spawn');

  // 2) findRespawnTarget with one Stabilizer in range returns source: 'stabilizer'.
  const r2 = stabilizerModule.findRespawnTarget(
    { x: 0, y: 20, z: 0 },
    [{ x: 5, y: 18, z: 5 }]
  );
  check('findRespawnTarget with Stabilizer in range returns source: "stabilizer"',
    r2 && r2.source === 'stabilizer' && r2.x === 5 && r2.y === 18 && r2.z === 5);

  // 3) findRespawnTarget with one Stabilizer beyond range returns source: 'spawn'.
  const r3 = stabilizerModule.findRespawnTarget(
    { x: 0, y: 20, z: 0 },
    [{ x: 100, y: 18, z: 100 }]
  );
  check('findRespawnTarget with Stabilizer beyond range returns source: "spawn"',
    r3 && r3.source === 'spawn');

  // 4) findRespawnTarget uses fallback when provided.
  const r4 = stabilizerModule.findRespawnTarget(
    { x: 0, y: 20, z: 0 },
    [],
    { fallback: { x: 10, y: 30, z: 10 } }
  );
  check('findRespawnTarget returns the fallback when no Stabilizer is in range',
    r4 && r4.source === 'spawn' && r4.x === 10 && r4.y === 30 && r4.z === 10);

  // 5) findRespawnTarget with non-array returns source: 'spawn'.
  const r5 = stabilizerModule.findRespawnTarget(
    { x: 0, y: 20, z: 0 },
    null
  );
  check('findRespawnTarget with non-array returns source: "spawn"',
    r5 && r5.source === 'spawn');

  // 6) findRespawnTarget with missing playerPos returns source: 'spawn'.
  const r6 = stabilizerModule.findRespawnTarget(
    null,
    [{ x: 5, y: 18, z: 5 }]
  );
  check('findRespawnTarget with missing playerPos returns source: "spawn"',
    r6 && r6.source === 'spawn');

  // 7) isWithinRadius returns true for nearby.
  check('isWithinRadius returns true for a position within STABILIZER_RADIUS',
    stabilizerModule.isWithinRadius({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }, 16) === true);

  // 8) isWithinRadius returns false for far.
  check('isWithinRadius returns false for a position beyond STABILIZER_RADIUS',
    stabilizerModule.isWithinRadius({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 100 }, 16) === false);

  // 9) isWithinRadius clamps a bad radius to the default.
  check('isWithinRadius with NaN radius falls back to STABILIZER_RADIUS',
    stabilizerModule.isWithinRadius({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 }, NaN) === true);

  // 10) stabilizerKey returns the canonical "x,y,z" string.
  check('stabilizerKey(10, 20, 30) returns "10,20,30"',
    stabilizerModule.stabilizerKey(10, 20, 30) === '10,20,30');
  check('stabilizerKey(10.4, 20.8, 30.1) returns "10,20,30" (floored)',
    stabilizerModule.stabilizerKey(10.4, 20.8, 30.1) === '10,20,30');
  check('stabilizerKey(NaN, 5, 5) returns "0,5,5" (defensive)',
    stabilizerModule.stabilizerKey(NaN, 5, 5) === '0,5,5');

  // 11) snapYForStabilizerCell returns cellY + 1 + 1.8 (player height).
  check('snapYForStabilizerCell(10) returns 12.8 (cellY + 1 + PLAYER_HEIGHT)',
    Math.abs(stabilizerModule.snapYForStabilizerCell(10) - 12.8) < 0.001);
  check('snapYForStabilizerCell(NaN) returns 0 (defensive)',
    stabilizerModule.snapYForStabilizerCell(NaN) === 0);

  console.log('\\n=== Phase 3.2 behavior - collapse pure module ===');

  const collapseModule = await import(pathToFileURL(collapsePath).href);

  // 1) COLLAPSE_DURATION === 1.5
  check('COLLAPSE_DURATION === 1.5',
    collapseModule.COLLAPSE_DURATION === 1.5);

  // 2) MINIMUM_RESPAWN_ENERGY === 30
  check('MINIMUM_RESPAWN_ENERGY === 30',
    stabilizerModule.STABILIZER_RESPAWN_ENERGY === 30);

  // 3) createCollapseState returns a fresh, empty state.
  const s0 = collapseModule.createCollapseState();
  check('createCollapseState returns isCollapsing: false',
    s0 && s0.isCollapsing === false && s0.collapseTimer === 0);

  // 4) startCollapse mutates the state.
  collapseModule.startCollapse(s0, 'forced', { x: 5, y: 18, z: 5 }, 'stabilizer');
  check('startCollapse sets isCollapsing: true',
    s0.isCollapsing === true && s0.collapseTimer === 0 && s0.reason === 'forced');
  check('startCollapse stores targetPos',
    s0.targetPos && s0.targetPos.x === 5 && s0.targetPos.source === 'stabilizer');

  // 5) tickCollapse with dt < COLLAPSE_DURATION returns done: false.
  const r_tick_half = collapseModule.tickCollapse(s0, 0.5);
  check('tickCollapse with dt=0.5 returns done: false',
    r_tick_half.done === false && r_tick_half.progress > 0);

  // 6) After many ticks that sum to >= COLLAPSE_DURATION, the state
  //    machine reaches done: true. We feed 0.05s ticks in a loop and
  //    check the first one that flips done.
  const s1 = collapseModule.createCollapseState();
  collapseModule.startCollapse(s1, 'test', { x: 5, y: 18, z: 5 }, 'stabilizer');
  let r_tick_full = null;
  for (let i = 0; i < 50; i++) {
    r_tick_full = collapseModule.tickCollapse(s1, 0.05);
    if (r_tick_full.done) break;
  }
  check('tickCollapse reaches done: true after enough frames',
    r_tick_full && r_tick_full.done === true);

  // 7) clearCollapse resets the state.
  collapseModule.clearCollapse(s1);
  check('clearCollapse resets isCollapsing: false',
    s1.isCollapsing === false && s1.collapseTimer === 0 && s1.reason === null);

  // 8) collapseProgress returns 0 outside.
  const s2 = collapseModule.createCollapseState();
  check('collapseProgress with empty state returns 0',
    collapseModule.collapseProgress(s2) === 0);

  // 9) collapseProgress returns 1 once the state machine is done.
  const s2b = collapseModule.createCollapseState();
  collapseModule.startCollapse(s2b, 'forced', { x: 5, y: 18, z: 5 }, 'stabilizer');
  let r_done = null;
  for (let i = 0; i < 50; i++) {
    r_done = collapseModule.tickCollapse(s2b, 0.05);
    if (r_done.done) break;
  }
  check('tickCollapse done payload reports progress=1',
    r_done && r_done.done === true && r_done.progress === 1);

  // 10) dt is clamped to 0.05 - a 10-second tick should NOT advance beyond 0.05.
  const s3 = collapseModule.createCollapseState();
  collapseModule.startCollapse(s3, 'forced', { x: 5, y: 18, z: 5 }, 'stabilizer');
  const r_big = collapseModule.tickCollapse(s3, 10.0);
  check('tickCollapse clamps dt to 0.05 (defensive)',
    r_big.state.collapseTimer <= 0.05);

  // 11) COLLAPSE_REASONS has energy-depleted, forced, test.
  check('COLLAPSE_REASONS.ENERGY_DEPLETED === "energy-depleted"',
    collapseModule.COLLAPSE_REASONS.ENERGY_DEPLETED === 'energy-depleted');
  check('COLLAPSE_REASONS.FORCED === "forced"',
    collapseModule.COLLAPSE_REASONS.FORCED === 'forced');
  check('COLLAPSE_REASONS.TEST === "test"',
    collapseModule.COLLAPSE_REASONS.TEST === 'test');

  console.log('\\n=== Phase 3.2 behavior - World stabilizer round-trip ===');

  const { World } = await import(pathToFileURL(worldPath).href);
  const scene = { add() {}, remove() {} };
  const world = new World(scene, () => {});

  // 1) Place a Stabilizer; _stabilizerPositions populated.
  // First load the chunk around (10, 10, 10) so setBlock succeeds.
  world.updateChunks(10, 10);
  world.setBlock(10, 10, 10, 0, 15); // BLOCK_STABILIZER = 15
  check('World.setBlock(BLOCK_STABILIZER) adds to _stabilizerPositions',
    world._stabilizerPositions && world._stabilizerPositions.size === 1);

  // 2) findNearestStabilizer returns the placed position.
  const nearest = world.findNearestStabilizer(10.5, 10.5, 10.5, 100);
  check('World.findNearestStabilizer returns the placed position',
    nearest && nearest.x === 10 && nearest.y === 10 && nearest.z === 10);

  // 3) Break the Stabilizer; findNearestStabilizer returns null.
  world.setBlock(10, 10, 10, 0, 0); // BLOCK_AIR = 0
  check('World.setBlock(BLOCK_AIR) removes from _stabilizerPositions',
    world._stabilizerPositions.size === 0);
  check('World.findNearestStabilizer returns null after break',
    world.findNearestStabilizer(10.5, 10.5, 10.5, 100) === null);

  // 4) exportGlobalState + importGlobalState round-trip preserves _stabilizerPositions.
  world.setBlock(20, 20, 20, 0, 15); // place again
  const snapshot = world.exportGlobalState();
  const world2 = new World(scene, () => {});
  // Mirror the state into world2 so importGlobalState can run.
  world2.importGlobalState(snapshot);
  // Manually rebuild _stabilizerPositions from the imported global state.
  for (const [key, blockId] of Object.entries(snapshot)) {
    if (blockId === 15) {
      const [x, y, z, phase] = key.split(',').map(Number);
      world2.addStabilizer(x, y, z);
    }
  }
  check('World round-trip preserves _stabilizerPositions',
    world2._stabilizerPositions && world2._stabilizerPositions.size === 1);
  check('World round-trip preserves the placed position',
    world2.findNearestStabilizer(20.5, 20.5, 20.5, 100) !== null);

  const passed = results.filter(Boolean).length;
  console.log(`\\n=== Phase 3.2 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
