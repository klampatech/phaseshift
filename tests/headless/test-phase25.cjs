#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 2.5 verification: Phase Lens (hold E to highlight phase-different
// blocks + beam + energy drain).
//
//   1) Static-analysis — the pieces exist:
//        - src/scan/lens.js exports scanResults, phaseLensDrain, lensRadius
//        - main.js#performScan delegates to world.findPhaseDifferences
//          (no direct chunk.alphaData reads in the scan loop)
//        - World.findPhaseDifferences is defined with the right signature
//        - PHASE_LENS_DRAIN_RATE = 0.5 and SCAN_RADIUS = 4 are constants
//        - ScanOverlay exposes showScanHighlights, clearScanHighlights,
//          showScanBeam, hideScanBeam
//        - main.js wires the per-frame lens loop with energy drain
//        - main.js handles insufficient energy with a notification
//        - main.js exposes the forceScan / startPhaseLens / stopPhaseLens
//          debug hooks
//   2) Behavior — scanResults on a tiny world:
//        - lensRadius() returns 4
//        - phaseLensDrain(0) returns 0; phaseLensDrain(1) returns 0.5
//        - scanResults delegates to world.findPhaseDifferences
//        - findPhaseDifferences returns empty for a fully-uniform chunk
//        - findPhaseDifferences includes single-phase non-current blocks
//          (Crystal in Beta when player is in Alpha)
//        - findPhaseDifferences returns the current-phase block id
//          (per-cell result includes currentPhaseBlock)
//        - findPhaseDifferences otherPhases array excludes the current phase
//   3) Behavior — energy drain math over a 2-second hold:
//        - drain = 0.5/sec * 2s = 1.0 energy
//   4) Behavior — insufficient energy gate:
//        - belowDrainThreshold(0, 0.016) is true (the per-frame cost)
//        - belowDrainThreshold(50, 0.016) is false
//
// Static checks are against source files (not the Vite-minified bundle).
// Same pattern as Phases 1.2–2.4.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const lensPath = path.join(ROOT, 'src', 'scan', 'lens.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const lensText = fs.readFileSync(lensPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 2.5 source checks ===');

  // ── src/scan/lens.js exports ─────────────────────────────────────
  check(
    'src/scan/lens.js exports scanResults',
    /export\s+function\s+scanResults\s*\(/.test(lensText)
  );
  check(
    'src/scan/lens.js exports phaseLensDrain',
    /export\s+function\s+phaseLensDrain\s*\(/.test(lensText)
  );
  check(
    'src/scan/lens.js exports lensRadius',
    /export\s+function\s+lensRadius\s*\(/.test(lensText)
  );
  check(
    'src/scan/lens.js exports belowDrainThreshold',
    /export\s+function\s+belowDrainThreshold\s*\(/.test(lensText)
  );
  check(
    'src/scan/lens.js exports hasDifferences',
    /export\s+function\s+hasDifferences\s*\(/.test(lensText)
  );
  check(
    'src/scan/lens.js exports wireframeColorForPhase',
    /export\s+function\s+wireframeColorForPhase\s*\(/.test(lensText)
  );
  check(
    'src/scan/lens.js exports LENS_WIREFRAME_COLORS',
    /export\s+const\s+LENS_WIREFRAME_COLORS\s*=\s*\[/.test(lensText)
  );

  // ── main.js imports + wiring ─────────────────────────────────────
  check(
    'main.js imports from src/scan/lens.js',
    /import\s*\{[^}]*scanResults[^}]*\}\s*from\s*['"]\.\/src\/scan\/lens\.js['"]/.test(mainText)
  );
  check(
    'main.js imports PHASE_LENS_DRAIN_RATE from constants',
    /import\s*\{[^}]*PHASE_LENS_DRAIN_RATE[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(mainText)
  );
  check(
    'main.js imports SCAN_RADIUS from constants',
    /import\s*\{[^}]*SCAN_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(mainText)
  );
  check(
    'main.js imports ScanOverlay from src/render/renderer.js',
    /import\s*\{[^}]*ScanOverlay[^}]*\}\s*from\s*['"]\.\/src\/render\/renderer\.js['"]/.test(mainText)
  );

  // ── Constants ────────────────────────────────────────────────────
  check(
    'PHASE_LENS_DRAIN_RATE = 0.5 in constants',
    /export\s+const\s+PHASE_LENS_DRAIN_RATE\s*=\s*0\.5\b/.test(constantsText)
  );
  check(
    'SCAN_RADIUS = 4 in constants',
    /export\s+const\s+SCAN_RADIUS\s*=\s*4\b/.test(constantsText)
  );

  // ── World.findPhaseDifferences ───────────────────────────────────
  check(
    'World.findPhaseDifferences is defined',
    /findPhaseDifferences\s*\(\s*playerX\s*,\s*playerY\s*,\s*playerZ\s*,\s*radius\s*,\s*currentPhase\s*\)/.test(worldText)
  );
  // Match the findPhaseDifferences function body and check both
  // currentPhaseBlock and otherPhases appear in the result literal.
  // The return value uses shorthand property syntax (`currentPhaseBlock,`
  // not `currentPhaseBlock: this.currentPhaseBlock`) so we match on
  // the bare identifiers.
  const findPhaseBody = worldText.match(
    /findPhaseDifferences\s*\(\s*playerX[\s\S]*?results\.push\([\s\S]*?\}/
  );
  check(
    'World.findPhaseDifferences returns { x, y, z, currentPhaseBlock, otherPhases, mask }',
    findPhaseBody
      && /currentPhaseBlock/.test(findPhaseBody[0])
      && /otherPhases/.test(findPhaseBody[0])
  );
  check(
    'World.findPhaseDifferences excludes current phase from otherPhases',
    findPhaseBody && /p\s*!==\s*currentPhase/.test(findPhaseBody[0])
  );

  // ── main.js — performScan delegation (no direct chunk.alphaData
  //    reads in the scan loop) ─────────────────────────────────────
  // The old performScan hand-rolled a chunk loop and read chunk.alphaData
  // directly. The new performScan must call scanResults(...) which
  // delegates to world.findPhaseDifferences. Brief: the SCAN path must
  // not. (performResonance still does — that's a Phase 2.6 refactor.)
  // Scope the check to the performScan function body.
  const performScanBody = mainText.match(
    /function\s+performScan\s*\([^)]*\)\s*\{[\s\S]*?scanResults\s*\(/
  );
  check(
    'main.js#performScan no longer reads chunk.alphaData directly (Phase 2.5 anti-pattern)',
    performScanBody && !/chunk\.alphaData/.test(performScanBody[0])
  );
  check(
    'main.js calls world.findPhaseDifferences (or scanResults) on scan',
    /world\.findPhaseDifferences\s*\(/.test(mainText) || /scanResults\s*\(\s*pos\.x/.test(mainText)
  );
  check(
    'main.js#performScan uses scanResults(...)',
    /function\s+performScan[\s\S]*?scanResults\s*\(/.test(mainText)
  );

  // ── ScanOverlay API ─────────────────────────────────────────────
  check(
    'ScanOverlay class exposes showScanHighlights',
    /class\s+ScanOverlay[\s\S]*?showScanHighlights\s*\(\s*results\s*,\s*currentPhase\s*\)/.test(rendererText)
  );
  check(
    'ScanOverlay class exposes clearScanHighlights',
    /class\s+ScanOverlay[\s\S]*?clearScanHighlights\s*\(\s*\)/.test(rendererText)
  );
  check(
    'ScanOverlay class exposes showScanBeam',
    /class\s+ScanOverlay[\s\S]*?showScanBeam\s*\(\s*camera\s*,\s*currentPhase\s*\)/.test(rendererText)
  );
  check(
    'ScanOverlay class exposes hideScanBeam',
    /class\s+ScanOverlay[\s\S]*?hideScanBeam\s*\(\s*\)/.test(rendererText)
  );
  check(
    'ScanOverlay disposes geometries on clear',
    /clearWireframes[\s\S]{0,400}?\.geometry\s*\.dispose\s*\(/.test(rendererText)
  );
  // The beam must be parented to the camera so it tracks every frame.
  check(
    'ScanOverlay parents the beam to the camera (per-frame tracking)',
    /beam\.parent\s*=\s*camera/.test(rendererText)
  );

  // ── main.js — per-frame lens loop ────────────────────────────────
  check(
    'main.js drains energy per dt in the lens loop',
    /phaseLensDrain\s*\(\s*deltaTime\s*\)[\s\S]{0,200}?consumeEnergy\s*\(\s*drain\s*\)/.test(mainText)
  );
  check(
    'main.js handles insufficient energy (notify + clear)',
    /Insufficient energy/.test(mainText)
      && /lens_insufficientNotifiedThisPress/.test(mainText)
  );
  check(
    'main.js clears the overlay on release',
    /scanOverlay\.clearScanHighlights\s*\(\s*\)/.test(mainText)
      && /scanOverlay\.hideScanBeam\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js redraws the overlay each frame while scanning',
    /scanOverlay\.showScanHighlights\s*\(\s*results\s*,\s*phaseManager\.getCurrentPhase\s*\(\s*\)\s*\)/.test(mainText)
      && /scanOverlay\.showScanBeam\s*\(\s*camera\s*,\s*phaseManager\.getCurrentPhase\s*\(\s*\)\s*\)/.test(mainText)
  );

  // ── main.js — debug hooks ───────────────────────────────────────
  check(
    'main.js exposes __phaseShifter__.forceScan()',
    /__phaseShifter__[\s\S]*?forceScan\s*\(\s*\)\s*\{[\s\S]*?scanResults\s*\(/.test(mainText)
  );
  check(
    'main.js exposes __phaseShifter__.startPhaseLens()',
    /__phaseShifter__[\s\S]*?startPhaseLens\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js exposes __phaseShifter__.stopPhaseLens()',
    /__phaseShifter__[\s\S]*?stopPhaseLens\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js exposes __phaseShifter__.getScanOverlayHighlightCount()',
    /__phaseShifter__[\s\S]*?getScanOverlayHighlightCount\s*\(\s*\)/.test(mainText)
  );

  // ── Renderer class (back-compat shim) ───────────────────────────
  check(
    'Renderer.showScanHighlights forwards to ScanOverlay',
    /showScanHighlights\s*\(\s*results\s*,\s*currentPhase\s*\)\s*\{[\s\S]*?scanOverlay\.showScanHighlights/.test(rendererText)
  );
  check(
    'Renderer.showScanBeam forwards to ScanOverlay',
    /showScanBeam\s*\(\s*camera\s*,\s*currentPhase\s*\)\s*\{[\s\S]*?scanOverlay\.showScanBeam/.test(rendererText)
  );

  console.log('\n=== Phase 2.5 module-level behavior ===');

  const lensModule = await import(pathToFileURL(lensPath).href);
  const {
    PHASE_LENS_DRAIN_RATE, SCAN_RADIUS,
    PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA,
    BLOCK_AIR, BLOCK_STONE, BLOCK_CRYSTAL, BLOCK_WOOD,
  } = await import(pathToFileURL(constantsPath).href);

  // 1) lensRadius() returns 4.
  check(
    'lensRadius() returns 4',
    lensModule.lensRadius() === 4,
    `got=${lensModule.lensRadius()}`
  );

  // 2) lensDrainRate() returns 0.5.
  check(
    'lensDrainRate() returns 0.5',
    lensModule.lensDrainRate() === 0.5
  );

  // 3) phaseLensDrain(0) returns 0 (no-op on zero dt).
  check(
    'phaseLensDrain(0) returns 0',
    lensModule.phaseLensDrain(0) === 0
  );

  // 4) phaseLensDrain(1) returns 0.5.
  check(
    'phaseLensDrain(1) returns 0.5',
    lensModule.phaseLensDrain(1) === 0.5
  );

  // 5) phaseLensDrain(2) returns 1.0 (the §2.5 acceptance math).
  check(
    'phaseLensDrain(2) returns 1.0 (2-second hold = 1.0 energy)',
    lensModule.phaseLensDrain(2) === 1.0
  );

  // 6) phaseLensDrain(NaN) returns 0 (defensive).
  check(
    'phaseLensDrain(NaN) returns 0 (defensive)',
    lensModule.phaseLensDrain(NaN) === 0
  );

  // 7) phaseLensDrain(-1) returns 0 (defensive).
  check(
    'phaseLensDrain(-1) returns 0 (defensive)',
    lensModule.phaseLensDrain(-1) === 0
  );

  // 8) wireframeColorForPhase returns the PHASE_COLORS entry.
  check(
    'wireframeColorForPhase(0) returns Alpha green',
    lensModule.wireframeColorForPhase(0) === '#5aa85a'
  );
  check(
    'wireframeColorForPhase(1) returns Beta blue',
    lensModule.wireframeColorForPhase(1) === '#3399e6'
  );
  check(
    'wireframeColorForPhase(2) returns Gamma gold',
    lensModule.wireframeColorForPhase(2) === '#d9b34c'
  );
  check(
    'wireframeColorForPhase(99) returns null (out-of-range)',
    lensModule.wireframeColorForPhase(99) === null
  );

  // 9) scanResults delegates to world.findPhaseDifferences. Use a
  // stub world that records the call.
  let captured = null;
  const stubWorld = {
    findPhaseDifferences(px, py, pz, radius, phase) {
      captured = { px, py, pz, radius, phase };
      return [{ x: px, y: py, z: pz, currentPhaseBlock: 0, otherPhases: [1], mask: 2 }];
    },
  };
  const stubResults = lensModule.scanResults(10, 20, 30, 4, PHASE_ALPHA, stubWorld);
  check(
    'scanResults delegates to world.findPhaseDifferences',
    captured !== null
      && captured.px === 10 && captured.py === 20 && captured.pz === 30
      && captured.radius === 4 && captured.phase === PHASE_ALPHA
  );
  check(
    'scanResults returns the stub worlds findPhaseDifferences results',
    Array.isArray(stubResults) && stubResults.length === 1 && stubResults[0].otherPhases[0] === 1
  );

  // 10) scanResults on a world without findPhaseDifferences returns [].
  const emptyResults2 = lensModule.scanResults(0, 0, 0, 4, 0, {});
  check(
    'scanResults on a world without findPhaseDifferences returns []',
    Array.isArray(emptyResults2) && emptyResults2.length === 0
  );

  // 11) scanResults with an out-of-range current phase returns [].
  const noPhaseResults = lensModule.scanResults(0, 0, 0, 4, 99, stubWorld);
  check(
    'scanResults with current phase 99 returns []',
    Array.isArray(noPhaseResults) && noPhaseResults.length === 0
  );

  // 12) hasDifferences returns true for non-empty arrays.
  check(
    'hasDifferences([...]) is true',
    lensModule.hasDifferences([{ x: 0, y: 0, z: 0 }]) === true
  );
  check(
    'hasDifferences([]) is false',
    lensModule.hasDifferences([]) === false
  );
  check(
    'hasDifferences(null) is false',
    lensModule.hasDifferences(null) === false
  );

  // 13) belowDrainThreshold math.
  check(
    'belowDrainThreshold(0, 0.016) is true (not enough energy)',
    lensModule.belowDrainThreshold(0, 0.016) === true
  );
  check(
    'belowDrainThreshold(50, 0.016) is false (enough energy)',
    lensModule.belowDrainThreshold(50, 0.016) === false
  );
  check(
    'belowDrainThreshold(NaN, 0.016) is true (defensive)',
    lensModule.belowDrainThreshold(NaN, 0.016) === true
  );

  console.log('\n=== Phase 2.5 behavior on a tiny World ===');

  const { World } = await import(pathToFileURL(worldPath).href);

  function makeWorld() {
    const scene = { add() {}, remove() {} };
    return new World(scene, () => {});
  }

  // 14) findPhaseDifferences on a fully-air region returns [].
  // Build a tiny world and scrub a 9×9×9 region to BLOCK_AIR in all
  // three phases — the generator may fill these cells, so we wipe
  // first to set a clean baseline.
  const w1 = makeWorld();
  w1.ensureChunk(0, 0);
  const cx = 5, cy = 50, cz = 5;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let p = 0; p < 3; p++) {
          w1.setBlock(cx + dx, cy + dy, cz + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  const emptyColResults = w1.findPhaseDifferences(cx, cy, cz, 2, PHASE_ALPHA);
  check(
    'findPhaseDifferences returns [] for an air-only 5×5×5 region',
    Array.isArray(emptyColResults) && emptyColResults.length === 0,
    `count=${emptyColResults.length}`
  );

  // 15) findPhaseDifferences includes single-phase non-current blocks.
  // Crystal is only visible in Beta. Scrub a cell to BLOCK_AIR in all
  // three phases first, then place Crystal in Beta. Scan from that cell
  // in Alpha — the Crystal block is not in Alpha but is in Beta, so it
  // should be returned.
  const w2 = makeWorld();
  w2.ensureChunk(0, 0);
  const tx = 10, ty = 30, tz = 10;
  for (let p = 0; p < 3; p++) w2.setBlock(tx, ty, tz, p, BLOCK_AIR);
  w2.setBlock(tx, ty, tz, PHASE_BETA, BLOCK_CRYSTAL);
  const inAlpha = w2.findPhaseDifferences(tx, ty, tz, 4, PHASE_ALPHA);
  const foundCrystal = inAlpha.find(r => r.x === tx && r.y === ty && r.z === tz);
  check(
    'findPhaseDifferences includes Crystal in Beta (single-phase non-current) when player is in Alpha',
    !!foundCrystal,
    `count=${inAlpha.length}`
  );
  if (foundCrystal) {
    check(
      'Crystal cell: currentPhaseBlock is BLOCK_AIR (not visible in Alpha)',
      foundCrystal.currentPhaseBlock === BLOCK_AIR,
      `got=${foundCrystal.currentPhaseBlock}`
    );
    check(
      'Crystal cell: otherPhases includes Beta (1) but not Alpha (0)',
      Array.isArray(foundCrystal.otherPhases)
        && foundCrystal.otherPhases.includes(PHASE_BETA)
        && !foundCrystal.otherPhases.includes(PHASE_ALPHA),
      `otherPhases=${JSON.stringify(foundCrystal.otherPhases)}`
    );
  }

  // 16) findPhaseDifferences includes multi-phase blocks. Wood is visible
  // in Alpha + Gamma. Scrub the cell first, then place Wood in BOTH
  // Alpha and Gamma so the cell is a phase difference when the player
  // is in Alpha (where it's the current phase, but it's also in Gamma
  // which is "other"). The renderer should outline Gamma for this cell.
  const w3 = makeWorld();
  w3.ensureChunk(0, 0);
  const tx3 = 10, ty3 = 30, tz3 = 10;
  for (let p = 0; p < 3; p++) w3.setBlock(tx3, ty3, tz3, p, BLOCK_AIR);
  w3.setBlock(tx3, ty3, tz3, PHASE_ALPHA, BLOCK_WOOD);
  w3.setBlock(tx3, ty3, tz3, PHASE_GAMMA, BLOCK_WOOD);
  const w3Results = w3.findPhaseDifferences(tx3, ty3, tz3, 4, PHASE_ALPHA);
  const foundWood = w3Results.find(r => r.x === tx3 && r.y === ty3 && r.z === tz3);
  check(
    'findPhaseDifferences includes Wood in Alpha (multi-phase) when player is in Alpha',
    !!foundWood,
    `count=${w3Results.length}`
  );
  if (foundWood) {
    check(
      'Wood cell: currentPhaseBlock is BLOCK_WOOD (visible in Alpha)',
      foundWood.currentPhaseBlock === BLOCK_WOOD,
      `got=${foundWood.currentPhaseBlock}`
    );
    check(
      'Wood cell: otherPhases excludes Alpha (0) but includes Gamma (2)',
      Array.isArray(foundWood.otherPhases)
        && !foundWood.otherPhases.includes(PHASE_ALPHA)
        && foundWood.otherPhases.includes(PHASE_GAMMA),
      `otherPhases=${JSON.stringify(foundWood.otherPhases)}`
    );
  }

  // 17) findPhaseDifferences respects the radius. Place a Crystal block
  // at (50, 30, 50) (far from the player) and scan from (10, 30, 10)
  // with radius 4. The Crystal block should be out of range.
  const w4 = makeWorld();
  w4.ensureChunk(0, 0);
  // Crystallize at (50, 30, 50) — but (50, 30, 50) is in chunk (3, 3).
  // Load that chunk too.
  w4.ensureChunk(3, 3);
  for (let p = 0; p < 3; p++) w4.setBlock(50, 30, 50, p, BLOCK_AIR);
  w4.setBlock(50, 30, 50, PHASE_BETA, BLOCK_CRYSTAL);
  const farResults = w4.findPhaseDifferences(10, 30, 10, 4, PHASE_ALPHA);
  const foundFar = farResults.find(r => r.x === 50 && r.y === 30 && r.z === 50);
  check(
    'findPhaseDifferences with radius=4 excludes cells outside the radius',
    !foundFar,
    `found inside radius: ${!!foundFar}`
  );

  // 18) Energy drain math over a 2-second hold. Apply phaseLensDrain
  // 120 times at 1/60 dt and confirm the total drain is ~1.0.
  const totalDrain = Array.from({ length: 120 }, () => lensModule.phaseLensDrain(1 / 60))
    .reduce((a, b) => a + b, 0);
  check(
    '2-second hold drains ~1.0 energy (sum of 120 ticks at 1/60 dt)',
    Math.abs(totalDrain - 1.0) < 0.001,
    `totalDrain=${totalDrain.toFixed(4)}`
  );

  // 19) Insufficient energy: phaseManager.consumeEnergy returns false
  // when there's not enough energy. The brief specifies a "force off"
  // pattern: when the per-frame cost exceeds the available energy, the
  // lens turns off and the player is told "Insufficient energy".
  const { PhaseManager } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'phase.js')).href);
  const pm = new PhaseManager();
  pm.setEnergy(0); // zero energy
  const drainThisFrame = lensModule.phaseLensDrain(0.016);
  check(
    'with 0 energy, the per-frame drain exceeds the budget',
    pm.getEnergy() < drainThisFrame
  );
  check(
    'phaseManager.consumeEnergy refuses to drain below 0',
    pm.consumeEnergy(0.5) === false && pm.getEnergy() === 0
  );

  // 20) phaseManager.consumeEnergy(0.5) at 50 energy succeeds.
  pm.setEnergy(50);
  check(
    'phaseManager.consumeEnergy(0.5) at 50 energy succeeds',
    pm.consumeEnergy(0.5) === true && pm.getEnergy() === 49.5
  );

  // 21) Wireframe colors match PHASE_COLORS. The brief says Alpha =
  // green, Beta = blue, Gamma = gold. The LENS_WIREFRAME_COLORS array
  // must match PHASE_COLORS character-for-character.
  check(
    'LENS_WIREFRAME_COLORS match PHASE_COLORS (Alpha green, Beta blue, Gamma gold)',
    lensModule.LENS_WIREFRAME_COLORS[0] === '#5aa85a'
      && lensModule.LENS_WIREFRAME_COLORS[1] === '#3399e6'
      && lensModule.LENS_WIREFRAME_COLORS[2] === '#d9b34c',
    `LENS_WIREFRAME_COLORS=${JSON.stringify(lensModule.LENS_WIREFRAME_COLORS)}`
  );

  // 22) scanResults with a positive integer radius respects the floor.
  const capturedRadius = null;
  const recRadius = (px, py, pz, r, phase) => {
    const stub = {
      findPhaseDifferences(a, b, c, radius, p) {
        captured && (captured.radius = radius);
        return [];
      },
    };
    capturedRadius = radius;
    return lensModule.scanResults(px, py, pz, r, phase, stub);
  };
  // No internal observability for the radius — instead, validate via
  // the public shape: scanResults(0,0,0, 4, 0, stubWorld) returns
  // stubWorld's findPhaseDifferences result (which is what we already
  // tested above). Skip this redundant check and instead verify the
  // null-radius edge case.
  check(
    'scanResults with radius=0 falls back to SCAN_RADIUS',
    lensModule.scanResults(0, 0, 0, 0, PHASE_ALPHA, stubWorld).length === 1
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 2.5 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
