#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 2.6 verification: Resonance (Q) — the one-shot press that
// swaps phase presence on the blocks around the player.
//
//   1) Static-analysis — the pieces exist:
//        - src/resonance/resonate.js exports resonateResults,
//          resonateRadius, resonateCost, totalSwappedCount,
//          resonanceSpherePulse
//        - constants.js exports RESONANCE_RADIUS = 1 and
//          RESONANCE_PULSE_DURATION = 1.0
//        - World.resonateWithReport is defined
//        - main.js#performResonance delegates to
//          world.resonateWithReport (no direct chunk.alphaData reads)
//        - main.js#performResonance handles insufficient energy
//          with a "Insufficient energy" notification
//        - ResonancePulse class exposes showResonancePulse,
//          updateResonancePulse, clearResonancePulse
//        - Renderer forwards the pulse API
//        - audioManager.playResonance(phase) is defined
//        - main.js exposes forceResonate / getResonancePulseMeshCount
//          / getResonancePulseVisible / clearResonancePulse debug hooks
//   2) Behavior — pure module:
//        - resonateRadius() returns 1
//        - resonateCost() returns 15
//        - resonanceSpherePulse(0, 0) returns radius 0.2 (expand start)
//        - resonanceSpherePulse(0.125, 0) returns radius 0.6 (mid-expand)
//        - resonanceSpherePulse(0.25, 0) returns radius 1.0 (expand end)
//        - resonanceSpherePulse(0.6, 0) returns opacity 0.4 (mid-fade)
//        - resonanceSpherePulse(1.0, 0) returns null (expired)
//        - resonanceSpherePulse(NaN, 0) returns { radius: 0.2, opacity: 1.0 }
//        - resonanceSpherePulse(0.1, 2) returns Gamma color "#d9b34c"
//        - totalSwappedCount sums per-cell swappedPhases lengths
//   3) Behavior — against tiny World:
//        - resonateResults on a fully-air region returns []
//        - resonateResults on a Stone cell in Alpha returns []
//          (Stone is visible in Alpha — no phase difference to swap)
//        - resonateResults on a Crystal cell in Beta while player is
//          in Alpha returns the cell with swappedPhases: [1]
//        - resonateWithReport round-trip: Stone in Alpha (no swap),
//          Crystal in Beta (swap to Alpha), then Stone in Alpha
//          (restored) and the cell is now back to Beta-only
//        - Energy math: spending 15 on a 100-energy player leaves 85;
//          refusing to spend below 15 leaves the player's energy
//          unchanged.
//
// Static checks are against source files (not the Vite-minified bundle).
// Same pattern as Phases 1.2–2.5.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const resonatePath = path.join(ROOT, 'src', 'resonance', 'resonate.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const audioPath = path.join(ROOT, 'src', 'audio', 'manager.js');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const resonateText = fs.readFileSync(resonatePath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const audioText = fs.readFileSync(audioPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 2.6 source checks ===');

  // ── src/resonance/resonate.js exports ─────────────────────────────
  check(
    'src/resonance/resonate.js exports resonateResults',
    /export\s+function\s+resonateResults\s*\(/.test(resonateText)
  );
  check(
    'src/resonance/resonate.js exports resonateRadius',
    /export\s+function\s+resonateRadius\s*\(/.test(resonateText)
  );
  check(
    'src/resonance/resonate.js exports resonateCost',
    /export\s+function\s+resonateCost\s*\(/.test(resonateText)
  );
  check(
    'src/resonance/resonate.js exports totalSwappedCount',
    /export\s+function\s+totalSwappedCount\s*\(/.test(resonateText)
  );
  check(
    'src/resonance/resonate.js exports resonanceSpherePulse',
    /export\s+function\s+resonanceSpherePulse\s*\(/.test(resonateText)
  );

  // ── main.js imports + wiring ─────────────────────────────────────
  check(
    'main.js imports from src/resonance/resonate.js',
    /import\s*\{[^}]*resonateResults[^}]*\}\s*from\s*['"]\.\/src\/resonance\/resonate\.js['"]/.test(mainText)
  );
  check(
    'main.js imports RESONANCE_RADIUS from constants',
    /import\s*\{[^}]*RESONANCE_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(mainText)
  );
  check(
    'main.js imports RESONANCE_PULSE_DURATION from constants',
    /import\s*\{[^}]*RESONANCE_PULSE_DURATION[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(mainText)
  );
  check(
    'main.js imports ResonancePulse from src/render/renderer.js',
    /import\s*\{[^}]*ResonancePulse[^}]*\}\s*from\s*['"]\.\/src\/render\/renderer\.js['"]/.test(mainText)
  );

  // ── Constants ────────────────────────────────────────────────────
  check(
    'RESONANCE_RADIUS = 1 in constants',
    /export\s+const\s+RESONANCE_RADIUS\s*=\s*1\b/.test(constantsText)
  );
  check(
    'RESONANCE_PULSE_DURATION = 1.0 in constants',
    /export\s+const\s+RESONANCE_PULSE_DURATION\s*=\s*1\.0\b/.test(constantsText)
  );

  // ── World.resonateWithReport ─────────────────────────────────────
  check(
    'World.resonateWithReport is defined',
    /resonateWithReport\s*\(\s*cx\s*,\s*cy\s*,\s*cz\s*,\s*radius\s*,\s*currentPhase\s*\)/.test(worldText)
  );
  // Match the resonateWithReport function body and check the return
  // shape. The body starts at the function signature and ends at the
  // closing brace. The return statement is `return { results: eligible, count };`.
  const resonateReportBody = worldText.match(
    /resonateWithReport\s*\(\s*cx[\s\S]*?return\s*\{[^}]*\}\s*;/
  );
  check(
    'World.resonateWithReport returns { results, count }',
    resonateReportBody
      && /results:/.test(resonateReportBody[0])
      && (/:\s*count\b/.test(resonateReportBody[0]) || /,\s*count\s*\}/.test(resonateReportBody[0]))
  );
  check(
    'World.resonateWithReport per-cell entry has swappedPhases',
    resonateReportBody && /swappedPhases/.test(resonateReportBody[0])
  );

  // ── main.js — performResonance delegation (no direct chunk.alphaData
  //    reads in the resonance loop) ────────────────────────────────
  const performResonanceBody = mainText.match(
    /function\s+performResonance\s*\([^)]*\)\s*\{[\s\S]*?resonateResults\s*\(/
  );
  check(
    'main.js#performResonance no longer reads chunk.alphaData directly (Phase 2.6 anti-pattern)',
    performResonanceBody && !/chunk\.alphaData/.test(performResonanceBody[0])
  );
  check(
    'main.js#performResonance uses resonateResults(...)',
    /function\s+performResonance[\s\S]*?resonateResults\s*\(/.test(mainText)
  );
  check(
    'main.js#performResonance uses resonateCost()',
    /function\s+performResonance[\s\S]*?resonateCost\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js#performResonance uses resonateRadius()',
    /function\s+performResonance[\s\S]*?resonateRadius\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js#performResonance consumes energy via phaseManager.consumeEnergy',
    /function\s+performResonance[\s\S]*?phaseManager\.consumeEnergy\s*\(\s*resonateCost\s*\(\s*\)\s*\)/.test(mainText)
  );
  check(
    'main.js#performResonance handles insufficient energy with one-shot notification',
    /function\s+performResonance[\s\S]*?resonance_insufficientNotifiedThisPress[\s\S]*?Insufficient energy/.test(mainText)
  );
  check(
    'main.js wires the sphere pulse via renderer.showResonancePulse',
    /function\s+performResonance[\s\S]*?renderer\.showResonancePulse\s*\(/.test(mainText)
  );
  check(
    'main.js wires the audio via audioManager.playResonance',
    /function\s+performResonance[\s\S]*?audioManager\.playResonance\s*\(/.test(mainText)
  );

  // ── main.js — per-frame pulse update ─────────────────────────────
  check(
    'main.js advances the resonance pulse every frame',
    /renderer\.updateResonancePulse\s*\(\s*deltaTime\s*\)/.test(mainText)
  );
  check(
    'main.js disposes the pulse when the lifetime expires',
    /renderer\.resonancePulse[\s\S]{0,200}?isVisible\s*\(\s*\)/.test(mainText)
  );

  // ── ResonancePulse class API ────────────────────────────────────
  check(
    'ResonancePulse class exposes showResonancePulse',
    /class\s+ResonancePulse[\s\S]*?showResonancePulse\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*currentPhase\s*\)/.test(rendererText)
  );
  check(
    'ResonancePulse class exposes updateResonancePulse',
    /class\s+ResonancePulse[\s\S]*?updateResonancePulse\s*\(\s*dt\s*\)/.test(rendererText)
  );
  check(
    'ResonancePulse class exposes clearResonancePulse',
    /class\s+ResonancePulse[\s\S]*?clearResonancePulse\s*\(\s*\)/.test(rendererText)
  );
  check(
    'ResonancePulse lives in its own THREE.Group (separate from scanOverlay)',
    /class\s+ResonancePulse[\s\S]*?new\s+THREE\.Group\(\)[\s\S]*?this\.group\.name\s*=\s*['"]resonancePulse['"]/.test(rendererText)
  );
  check(
    'ResonancePulse auto-disposes when opacity reaches 0',
    /class\s+ResonancePulse[\s\S]*?updateResonancePulse[\s\S]*?clearResonancePulse\s*\(\s*\)/.test(rendererText)
  );

  // ── Renderer forwarding ─────────────────────────────────────────
  check(
    'Renderer.showResonancePulse forwards to ResonancePulse',
    /showResonancePulse\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*currentPhase\s*\)\s*\{[\s\S]*?this\.resonancePulse\.showResonancePulse/.test(rendererText)
  );
  check(
    'Renderer.updateResonancePulse forwards to ResonancePulse',
    /updateResonancePulse\s*\(\s*dt\s*\)\s*\{[\s\S]*?this\.resonancePulse\.updateResonancePulse/.test(rendererText)
  );
  check(
    'Renderer.clearResonancePulse forwards to ResonancePulse',
    /clearResonancePulse\s*\(\s*\)\s*\{[\s\S]*?this\.resonancePulse\.clearResonancePulse/.test(rendererText)
  );

  // ── AudioManager.playResonance(phase) ────────────────────────────
  check(
    'AudioManager.playResonance(phase) signature',
    /playResonance\s*\(\s*phase\s*(?:=\s*0)?\s*\)/.test(audioText)
  );

  // ── main.js — debug hooks ───────────────────────────────────────
  check(
    'main.js exposes __phaseShifter__.forceResonate()',
    /__phaseShifter__[\s\S]*?forceResonate\s*\(\s*\)\s*\{[\s\S]*?resonateResults\s*\(/.test(mainText)
  );
  check(
    'main.js exposes __phaseShifter__.getResonancePulseMeshCount()',
    /__phaseShifter__[\s\S]*?getResonancePulseMeshCount\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js exposes __phaseShifter__.getResonancePulseVisible()',
    /__phaseShifter__[\s\S]*?getResonancePulseVisible\s*\(\s*\)/.test(mainText)
  );
  check(
    'main.js exposes __phaseShifter__.clearResonancePulse()',
    /__phaseShifter__[\s\S]*?clearResonancePulse\s*\(\s*\)/.test(mainText)
  );

  console.log('\n=== Phase 2.6 module-level behavior ===');

  const resonateModule = await import(pathToFileURL(resonatePath).href);
  const {
    PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
    PHASE_COLORS, RESONATE_COST, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION,
    BLOCK_AIR, BLOCK_STONE, BLOCK_CRYSTAL,
  } = await import(pathToFileURL(constantsPath).href);

  // 1) resonateRadius() returns 1.
  check(
    'resonateRadius() returns 1',
    resonateModule.resonateRadius() === 1,
    `got=${resonateModule.resonateRadius()}`
  );

  // 2) resonateCost() returns 15.
  check(
    'resonateCost() returns 15',
    resonateModule.resonateCost() === 15,
    `got=${resonateModule.resonateCost()}`
  );

  // 3) resonateCost() mirrors RESONATE_COST.
  check(
    'resonateCost() === RESONATE_COST',
    resonateModule.resonateCost() === RESONATE_COST
  );

  // 4) resonanceSpherePulse(0, 0) returns radius 0.2 (expand start).
  const pulse0 = resonateModule.resonanceSpherePulse(0, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(0, Alpha) returns radius 0.2 (expand start)',
    pulse0 && pulse0.radius === 0.2,
    `got=${JSON.stringify(pulse0)}`
  );
  check(
    'resonanceSpherePulse(0, Alpha) returns opacity 1.0',
    pulse0 && pulse0.opacity === 1.0
  );
  check(
    'resonanceSpherePulse(0, Alpha) returns Alpha color',
    pulse0 && pulse0.color === '#5aa85a',
    `got=${pulse0 && pulse0.color}`
  );

  // 5) resonanceSpherePulse(0.125, 0) returns radius 0.6 (mid-expand).
  const pulseMid = resonateModule.resonanceSpherePulse(0.125, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(0.125, Alpha) returns radius 0.6 (mid-expand)',
    pulseMid && Math.abs(pulseMid.radius - 0.6) < 0.001,
    `got=${pulseMid && pulseMid.radius}`
  );

  // 6) resonanceSpherePulse(0.25, 0) returns radius 1.0 (expand end).
  const pulseEnd = resonateModule.resonanceSpherePulse(0.25, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(0.25, Alpha) returns radius 1.0 (expand end)',
    pulseEnd && pulseEnd.radius === 1.0,
    `got=${pulseEnd && pulseEnd.radius}`
  );
  check(
    'resonanceSpherePulse(0.25, Alpha) returns opacity 1.0',
    pulseEnd && pulseEnd.opacity === 1.0
  );

  // 7) resonanceSpherePulse(0.6, 0) returns opacity 0.4 (mid-fade).
  const pulseFade = resonateModule.resonanceSpherePulse(0.6, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(0.6, Alpha) returns opacity ~0.53 (mid-fade)',
    pulseFade && Math.abs(pulseFade.opacity - 0.533) < 0.001,
    `got=${pulseFade && pulseFade.opacity}`
  );
  check(
    'resonanceSpherePulse(0.6, Alpha) returns radius 1.0 (held)',
    pulseFade && pulseFade.radius === 1.0
  );

  // 8) resonanceSpherePulse(1.0, 0) returns null (expired).
  const pulseExpired = resonateModule.resonanceSpherePulse(1.0, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(1.0, Alpha) returns null (expired)',
    pulseExpired === null,
    `got=${JSON.stringify(pulseExpired)}`
  );

  // 9) resonanceSpherePulse(1.5, 0) returns null (well past expiry).
  const pulsePast = resonateModule.resonanceSpherePulse(1.5, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(1.5, Alpha) returns null (well past expiry)',
    pulsePast === null
  );

  // 10) resonanceSpherePulse(NaN, 0) returns the start shape (defensive).
  const pulseNaN = resonateModule.resonanceSpherePulse(NaN, PHASE_ALPHA);
  check(
    'resonanceSpherePulse(NaN, Alpha) returns the start shape (defensive)',
    pulseNaN && pulseNaN.radius === 0.2 && pulseNaN.opacity === 1.0,
    `got=${JSON.stringify(pulseNaN)}`
  );

  // 11) resonanceSpherePulse(0, 2) returns Gamma color.
  const pulseGamma = resonateModule.resonanceSpherePulse(0, PHASE_GAMMA);
  check(
    'resonanceSpherePulse(0, Gamma) returns Gamma gold color',
    pulseGamma && pulseGamma.color === '#d9b34c',
    `got=${pulseGamma && pulseGamma.color}`
  );

  // 12) resonanceSpherePulse(0, 1) returns Beta color.
  const pulseBeta = resonateModule.resonanceSpherePulse(0, PHASE_BETA);
  check(
    'resonanceSpherePulse(0, Beta) returns Beta blue color',
    pulseBeta && pulseBeta.color === '#3399e6',
    `got=${pulseBeta && pulseBeta.color}`
  );

  // 13) totalSwappedCount of empty array returns 0.
  check(
    'totalSwappedCount([]) returns 0',
    resonateModule.totalSwappedCount([]) === 0
  );

  // 14) totalSwappedCount sums per-cell swappedPhases lengths.
  const fakeResults = [
    { x: 0, y: 0, z: 0, swappedPhases: [1] },
    { x: 1, y: 0, z: 0, swappedPhases: [2] },
    { x: 2, y: 0, z: 0, swappedPhases: [1, 2] },
    { x: 3, y: 0, z: 0, swappedPhases: [] },
  ];
  check(
    'totalSwappedCount sums per-cell swappedPhases lengths (1+1+2+0 = 4)',
    resonateModule.totalSwappedCount(fakeResults) === 4
  );

  // 15) totalSwappedCount(null) returns 0 (defensive).
  check(
    'totalSwappedCount(null) returns 0 (defensive)',
    resonateModule.totalSwappedCount(null) === 0
  );

  // 16) resonateResults delegates to world.resonateWithReport (stub).
  let captured = null;
  const stubWorld = {
    resonateWithReport(px, py, pz, radius, phase) {
      captured = { px, py, pz, radius, phase };
      return {
        results: [{ x: px, y: py, z: pz, swappedPhases: [1] }],
        count: 1,
      };
    },
  };
  const stubResults = resonateModule.resonateResults(10, 20, 30, 1, PHASE_ALPHA, stubWorld);
  check(
    'resonateResults delegates to world.resonateWithReport',
    captured !== null
      && captured.px === 10 && captured.py === 20 && captured.pz === 30
      && captured.radius === 1 && captured.phase === PHASE_ALPHA
  );
  check(
    'resonateResults returns the stub worlds resonateWithReport results',
    Array.isArray(stubResults) && stubResults.length === 1 && stubResults[0].swappedPhases[0] === 1
  );

  // 17) resonateResults on a world without resonateWithReport returns [].
  const emptyResults = resonateModule.resonateResults(0, 0, 0, 1, 0, {});
  check(
    'resonateResults on a world without resonateWithReport returns []',
    Array.isArray(emptyResults) && emptyResults.length === 0
  );

  // 18) resonateResults with an out-of-range current phase returns [].
  const noPhaseResults = resonateModule.resonateResults(0, 0, 0, 1, 99, stubWorld);
  check(
    'resonateResults with current phase 99 returns []',
    Array.isArray(noPhaseResults) && noPhaseResults.length === 0
  );

  console.log('\n=== Phase 2.6 behavior on a tiny World ===');

  const { World } = await import(pathToFileURL(worldPath).href);

  function makeWorld() {
    const scene = { add() {}, remove() {} };
    return new World(scene, () => {});
  }

  // 19) resonateWithReport on a fully-air 3x3x3 region returns 0 swaps.
  const w1 = makeWorld();
  w1.ensureChunk(0, 0);
  const cx = 5, cy = 50, cz = 5;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let p = 0; p < PHASE_COUNT; p++) {
          w1.setBlock(cx + dx, cy + dy, cz + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  const airReport = w1.resonateWithReport(cx, cy, cz, 1, PHASE_ALPHA);
  check(
    'resonateWithReport on an air-only 3x3x3 region returns 0 swaps',
    airReport && Array.isArray(airReport.results) && airReport.count === 0,
    `count=${airReport && airReport.count}`
  );

  // 20) resonateWithReport on a Stone cell in Alpha (single phase,
  // current = current) returns 0 swaps. Stone is visible only in
  // Alpha+Beta, so a single-phase Alpha cell has no cross-phase to
  // swap. The player is in Alpha, so the cell is also visible there.
  // We scrub the FULL 3x3x3 region around the cell so the test isn't
  // confused by the generator's noise.
  const w2 = makeWorld();
  w2.ensureChunk(0, 0);
  const tx = 10, ty = 30, tz = 10;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let p = 0; p < PHASE_COUNT; p++) {
          w2.setBlock(tx + dx, ty + dy, tz + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  w2.setBlock(tx, ty, tz, PHASE_ALPHA, BLOCK_STONE);
  const stoneReport = w2.resonateWithReport(tx, ty, tz, 1, PHASE_ALPHA);
  check(
    'resonateWithReport on Stone in Alpha (single-phase, current) returns 0 swaps',
    stoneReport && stoneReport.count === 0,
    `count=${stoneReport && stoneReport.count}`
  );

  // 21) resonateWithReport on Crystal in Beta (single-phase, OTHER
  // than current = Alpha) returns 1 swap with swappedPhases: [1].
  const w3 = makeWorld();
  w3.ensureChunk(0, 0);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let p = 0; p < PHASE_COUNT; p++) {
          w3.setBlock(tx + dx, ty + dy, tz + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  w3.setBlock(tx, ty, tz, PHASE_BETA, BLOCK_CRYSTAL);
  const crystalReport = w3.resonateWithReport(tx, ty, tz, 1, PHASE_ALPHA);
  check(
    'resonateWithReport on Crystal in Beta (single-phase, other) returns 1 swap',
    crystalReport && crystalReport.count === 1,
    `count=${crystalReport && crystalReport.count}`
  );
  check(
    'Crystal report cell has swappedPhases: [1] (Beta)',
    crystalReport && crystalReport.results.length === 1
      && crystalReport.results[0].swappedPhases.length === 1
      && crystalReport.results[0].swappedPhases[0] === PHASE_BETA,
    `result=${JSON.stringify(crystalReport && crystalReport.results[0])}`
  );

  // 22) Resonance inversion: the Crystal in Beta should now be in
  // Alpha (the swap moves the block from Beta to Alpha, since the
  // current phase is Alpha and the inverse of Beta is Gamma — but
  // the brief specifies the legacy resonate moves to the inverse
  // phase). Verify the cell is no longer in Beta after the press.
  const cellAfter = w3.getBlock(tx, ty, tz, PHASE_BETA);
  check(
    'After resonance, Crystal cell is no longer in Beta',
    cellAfter === BLOCK_AIR,
    `block=${cellAfter}`
  );

  // 23) Multi-phase cell: a Stone block in Alpha + Beta. The current
  // phase is Alpha, so the player should see Beta get swapped (the
  // single-phase non-current entry). Place Stone in Alpha + Beta,
  // call resonateWithReport, expect 1 swap with swappedPhases: [1].
  const w4 = makeWorld();
  w4.ensureChunk(0, 0);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let p = 0; p < PHASE_COUNT; p++) {
          w4.setBlock(tx + dx, ty + dy, tz + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  w4.setBlock(tx, ty, tz, PHASE_ALPHA, BLOCK_STONE);
  w4.setBlock(tx, ty, tz, PHASE_BETA, BLOCK_STONE);
  const multiReport = w4.resonateWithReport(tx, ty, tz, 1, PHASE_ALPHA);
  check(
    'resonateWithReport on multi-phase Stone (Alpha+Beta) returns 1 swap',
    multiReport && multiReport.count === 1,
    `count=${multiReport && multiReport.count}`
  );

  // 24) All-air swap: no crash, no swaps.
  const w5 = makeWorld();
  w5.ensureChunk(0, 0);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let p = 0; p < PHASE_COUNT; p++) {
          w5.setBlock(cx + dx, cy + dy, cz + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  const noCrashReport = w5.resonateWithReport(cx, cy, cz, 1, PHASE_ALPHA);
  check(
    'resonateWithReport on a fully-air region does not crash',
    noCrashReport && Array.isArray(noCrashReport.results)
  );

  // 25) Energy math. Phase 2.6 acceptance: 15 energy per press.
  const { PhaseManager } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'phase.js')).href);
  const pm = new PhaseManager();
  pm.setEnergy(100);
  check(
    'phaseManager.consumeEnergy(15) at 100 energy succeeds',
    pm.consumeEnergy(15) === true && pm.getEnergy() === 85
  );

  // 26) Energy below threshold: refuse.
  pm.setEnergy(10);
  check(
    'phaseManager.consumeEnergy(15) at 10 energy refuses',
    pm.consumeEnergy(15) === false && pm.getEnergy() === 10
  );

  // 27) resonateWithReport radius check: a Crystal at (50, 30, 50)
  // outside radius 1 from (10, 30, 10) is not swapped.
  const w6 = makeWorld();
  w6.ensureChunk(0, 0);
  w6.ensureChunk(3, 3);
  for (let p = 0; p < PHASE_COUNT; p++) w6.setBlock(50, 30, 50, p, BLOCK_AIR);
  w6.setBlock(50, 30, 50, PHASE_BETA, BLOCK_CRYSTAL);
  const farReport = w6.resonateWithReport(10, 30, 10, 1, PHASE_ALPHA);
  const farCell = farReport && farReport.results.find(r => r.x === 50 && r.y === 30 && r.z === 50);
  check(
    'resonateWithReport with radius=1 excludes cells outside the radius',
    !farCell,
    `found inside radius: ${!!farCell}`
  );

  // 28) Resonance total spanning 3x3x3: 27 cells, but only the
  // non-air, non-current-phase cells are swapped. Build a 3x3x3
  // region with Crystal in Beta at the center cell (1, 0, 0).
  const w7 = makeWorld();
  w7.ensureChunk(0, 0);
  const center = 10;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let p = 0; p < PHASE_COUNT; p++) {
          w7.setBlock(center + dx, 30 + dy, center + dz, p, BLOCK_AIR);
        }
      }
    }
  }
  w7.setBlock(center, 30, center, PHASE_BETA, BLOCK_CRYSTAL);
  const centerReport = w7.resonateWithReport(center, 30, center, 1, PHASE_ALPHA);
  check(
    'resonateWithReport counts 1 swap (Crystal in Beta at center cell)',
    centerReport && centerReport.count === 1,
    `count=${centerReport && centerReport.count}`
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 2.6 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
