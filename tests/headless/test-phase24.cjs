#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 2.4 verification: phase memory persistence across save/reload.
//
//   1) Static-analysis — the pieces exist:
//        - World.exportGlobalState no longer filters BLOCK_AIR
//        - World.importGlobalState no longer filters BLOCK_AIR
//        - SaveSystem._coerceWorldState accepts BLOCK_AIR (0) but still
//          rejects NaN, Infinity, fractional, negative, and non-numbers
//        - World.loadChunk still applies _globalStateMap entries when
//          the key exists, including BLOCK_AIR (Phase 2.3 regression lock)
//   2) Behavior — three save/reload round-trip scenarios:
//        - break Stone → BLOCK_AIR → save → import into a fresh World →
//          reload chunk → cell is still AIR (the §2.4 acceptance)
//        - place Stone in Beta → save → import into a fresh World →
//          reload chunk → cell is still Stone in Beta
//        - break a generator-populated Dirt cell → save → import into a
//          fresh World → reload chunk → cell is AIR in Alpha
//   3) Behavior — the global state map after importGlobalState records
//      BLOCK_AIR explicitly (not the default fallback), so the same cell
//      survives a subsequent chunk reload.
//
// Static checks are against source files (not the Vite-minified bundle).
// Same pattern as Phases 1.2–2.3.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const savePath = path.join(ROOT, 'src', 'save', 'system.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');

const worldText = fs.readFileSync(worldPath, 'utf8');
const saveText = fs.readFileSync(savePath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 2.4 source checks ===');

  // exportGlobalState / importGlobalState no longer filter BLOCK_AIR.
  // The brief is explicit: the player's value wins, including AIR.
  // We check the source for the absence of the old filter and the
  // presence of a comment that documents the new contract.
  // Match the docstring + the function body so we can check both.
  const exportFnMatch = worldText.match(/\/\*\*[\s\S]*?\*\/[\s\S]*?exportGlobalState\s*\(\s*\)\s*\{[\s\S]*?\n\s\s\}/);
  check(
    'World.exportGlobalState() exists',
    !!exportFnMatch,
    exportFnMatch ? 'found' : 'not found'
  );
  check(
    'World.exportGlobalState() no longer filters BLOCK_AIR',
    exportFnMatch ? !/blockId\s*!==\s*BLOCK_AIR/.test(exportFnMatch[0]) : false
  );
  check(
    'World.exportGlobalState() docstring mentions Phase 2.4 / player break',
    exportFnMatch ? /Phase 2\.4/.test(exportFnMatch[0]) : false
  );

  // Match the docstring + the function body for import too.
  const importFnMatch = worldText.match(/\/\*\*[\s\S]*?\*\/[\s\S]*?importGlobalState\s*\(\s*snapshot\s*\)\s*\{[\s\S]*?\n\s\s\}/);
  check(
    'World.importGlobalState(snapshot) exists',
    !!importFnMatch,
    importFnMatch ? 'found' : 'not found'
  );
  check(
    'World.importGlobalState() no longer filters BLOCK_AIR',
    importFnMatch ? !/blockId\s*!==\s*BLOCK_AIR/.test(importFnMatch[0]) : false
  );
  check(
    'World.importGlobalState() keeps the Number.isFinite guard (rejects NaN/Infinity)',
    importFnMatch ? /Number\.isFinite\s*\(\s*blockId\s*\)/.test(importFnMatch[0]) : false
  );
  check(
    'World.importGlobalState() lower-level contract (accepts finite numbers of any sign/scale)',
    importFnMatch
      ? /typeof\s+blockId\s*===\s*['"]number['"]/.test(importFnMatch[0])
        && /Number\.isFinite\s*\(\s*blockId\s*\)/.test(importFnMatch[0])
      : false
  );

  // loadChunk still applies _globalStateMap entries when the key exists.
  // This is the Phase 2.3 lock — Phase 2.4 extends it to save/reload but
  // does not change the chunk-reload path.
  check(
    'World.loadChunk still applies _globalStateMap entries on reload',
    /this\._globalStateMap\.has\s*\(\s*globalKey\s*\)/.test(worldText)
  );

  // _coerceWorldState in save/system.js accepts BLOCK_AIR (0) but still
  // rejects NaN, Infinity, fractional, negative, and non-numbers.
  const coerceMatch = saveText.match(/_coerceWorldState\s*\([^)]*\)\s*\{[\s\S]*?\n\s\s\}/);
  check(
    'SaveSystem._coerceWorldState() exists',
    !!coerceMatch
  );
  check(
    '_coerceWorldState accepts BLOCK_AIR (id 0) — the new contract',
    coerceMatch ? !/blockId\s*<=\s*0/.test(coerceMatch[0]) : false
  );
  check(
    '_coerceWorldState still rejects non-finite (NaN/Infinity) ids',
    coerceMatch ? /Number\.isFinite\s*\(\s*blockId\s*\)/.test(coerceMatch[0]) : false
  );
  check(
    '_coerceWorldState still rejects fractional ids',
    coerceMatch ? /Number\.isInteger\s*\(\s*blockId\s*\)/.test(coerceMatch[0]) : false
  );
  check(
    '_coerceWorldState still rejects negative ids (tampered blob)',
    coerceMatch ? /blockId\s*<\s*0/.test(coerceMatch[0]) : false
  );

  console.log('\n=== Phase 2.4 export/import contract behavior ===');

  const { World } = await import(pathToFileURL(worldPath).href);
  const {
    PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA,
    BLOCK_AIR, BLOCK_STONE, BLOCK_DIRT,
  } = await import(pathToFileURL(constantsPath).href);

  // Tiny world fixture — no Three.js, no scene, no onChunkUpdated callback.
  function makeWorld() {
    const scene = { add() {}, remove() {} };
    return new World(scene, () => {});
  }

  // 1) exportGlobalState includes BLOCK_AIR. We construct a World, set
  // some blocks (including an AIR edit), and check the export.
  const w1 = makeWorld();
  w1.ensureChunk(0, 0);
  // Place Stone at (1, 30, 1) in Alpha — generator leaves it air.
  w1.setBlock(1, 30, 1, PHASE_ALPHA, BLOCK_STONE);
  // Break a generator-populated cell (0, 5, 0) — write AIR to Alpha.
  w1.setBlock(0, 5, 0, PHASE_ALPHA, BLOCK_AIR);

  const exported = w1.exportGlobalState();
  check(
    'exportGlobalState preserves BLOCK_STONE entries',
    exported['1,30,1,0'] === BLOCK_STONE,
    `value=${exported['1,30,1,0']}`
  );
  check(
    'exportGlobalState preserves BLOCK_AIR entries (the Phase 2.4 contract)',
    exported['0,5,0,0'] === BLOCK_AIR,
    `value=${exported['0,5,0,0']}`
  );
  check(
    'exportGlobalState includes BOTH stone and AIR keys',
    Object.keys(exported).length >= 2,
    `keys=${Object.keys(exported).length}`
  );

  // 2) importGlobalState accepts BLOCK_AIR. We build a fresh World,
  // import the snapshot, and verify the map contains the AIR entry.
  const w2 = makeWorld();
  const importedCount = w2.importGlobalState(exported);
  check(
    'importGlobalState returns the imported count (≥2)',
    importedCount >= 2,
    `count=${importedCount}`
  );
  check(
    'importGlobalState preserves BLOCK_STONE in the new world',
    w2.getGlobalBlock(1, 30, 1, PHASE_ALPHA) === BLOCK_STONE
  );
  check(
    'importGlobalState preserves BLOCK_AIR in the new world (not the default fallback)',
    w2.getGlobalBlock(0, 5, 0, PHASE_ALPHA) === BLOCK_AIR
  );
  check(
    'importGlobalState rejects non-finite ids (NaN) — count matches valid only',
    (() => {
      const w3 = makeWorld();
      const before = w3._globalStateMap.size;
      const c = w3.importGlobalState({ '10,20,30,0': NaN, '11,21,31,0': BLOCK_STONE });
      return c === 1 && w3._globalStateMap.size === before + 1;
    })()
  );
  // The brief's importGlobalState uses only `typeof + Number.isFinite`.
  // Negative and fractional ids pass those checks; the stricter gate
  // (Number.isInteger / non-negative) lives in SaveSystem._coerceWorldState.
  // Direct importGlobalState accepts finite numbers of any sign or scale.
  check(
    'importGlobalState accepts finite negative ids (lower-level contract)',
    (() => {
      const w3 = makeWorld();
      const c = w3.importGlobalState({ '12,22,32,0': -1, '13,23,33,0': BLOCK_STONE });
      return c === 2 && w3.getGlobalBlock(12, 22, 32, 0) === -1
        && w3.getGlobalBlock(13, 23, 33, 0) === BLOCK_STONE;
    })()
  );
  check(
    'importGlobalState accepts finite fractional ids (lower-level contract)',
    (() => {
      const w3 = makeWorld();
      const c = w3.importGlobalState({ '14,24,34,0': 1.5, '15,25,35,0': BLOCK_STONE });
      return c === 2 && w3.getGlobalBlock(14, 24, 34, 0) === 1.5
        && w3.getGlobalBlock(15, 25, 35, 0) === BLOCK_STONE;
    })()
  );
  check(
    'importGlobalState rejects non-number ids (string)',
    (() => {
      const w3 = makeWorld();
      const c = w3.importGlobalState({ '16,26,36,0': 'oops', '17,27,37,0': BLOCK_STONE });
      return c === 1;
    })()
  );
  check(
    'importGlobalState(null) is a no-op (returns 0)',
    (() => {
      const w3 = makeWorld();
      return w3.importGlobalState(null) === 0;
    })()
  );
  check(
    'importGlobalState replaces the previous map (snapshot is canonical)',
    (() => {
      const w3 = makeWorld();
      w3.ensureChunk(0, 0);
      w3.setBlock(99, 99, 99, PHASE_ALPHA, BLOCK_STONE);
      w3.importGlobalState({ '50,50,50,0': BLOCK_AIR });
      return w3.getGlobalBlock(99, 99, 99, PHASE_ALPHA) === BLOCK_AIR
        && w3.getGlobalBlock(50, 50, 50, PHASE_ALPHA) === BLOCK_AIR;
    })()
  );

  console.log('\n=== Phase 2.4 / §2.4 acceptance: save → reload round-trip ===');

  // 3) §2.4 acceptance (per brief): "Pick a Stone block, break it. The
  // cell becomes BLOCK_AIR. Save → reload. The cell is still BLOCK_AIR."
  // We exercise the export → import → chunk reload path.
  const src = makeWorld();
  src.ensureChunk(0, 0);
  // Plant Stone at a known mid-air cell so we can break it.
  src.setBlock(3, 30, 3, PHASE_ALPHA, BLOCK_STONE);
  // Break it (the player's edit).
  src.setBlock(3, 30, 3, PHASE_ALPHA, BLOCK_AIR);

  // Export the player memory.
  const snap1 = src.exportGlobalState();
  check(
    'snapshot includes the AIR entry from the break',
    snap1['3,30,3,0'] === BLOCK_AIR
  );

  // Build a fresh World and import the snapshot.
  const dst = makeWorld();
  dst.ensureChunk(0, 0);
  dst.chunks.delete('0,0');
  dst.importGlobalState(snap1);
  // Reload the chunk. The break must survive the round-trip — loadChunk
  // applies _globalStateMap entries whenever the key exists.
  dst.ensureChunk(0, 0);
  check(
    'after save→reload: broken cell is still BLOCK_AIR in Alpha (§2.4 acceptance)',
    dst.getBlock(3, 30, 3, PHASE_ALPHA) === BLOCK_AIR,
    `got=${dst.getBlock(3, 30, 3, PHASE_ALPHA)}`
  );
  check(
    'after save→reload: the AIR is recorded in the global state map (not the default fallback)',
    dst.getGlobalBlock(3, 30, 3, PHASE_ALPHA) === BLOCK_AIR
  );

  // 4) Place Stone in Beta, save, reload, cell is still Stone in Beta.
  // (This case was already covered by Phase 1.7 — the test is a
  // regression lock to make sure the new contract didn't break the
  // existing one.)
  const src2 = makeWorld();
  src2.ensureChunk(0, 0);
  src2.setBlock(7, 30, 7, PHASE_BETA, BLOCK_STONE);
  const snap2 = src2.exportGlobalState();
  const dst2 = makeWorld();
  dst2.ensureChunk(0, 0);
  dst2.chunks.delete('0,0');
  dst2.importGlobalState(snap2);
  dst2.ensureChunk(0, 0);
  check(
    'after save→reload: placed Stone in Beta is still Stone in Beta',
    dst2.getBlock(7, 30, 7, PHASE_BETA) === BLOCK_STONE,
    `got=${dst2.getBlock(7, 30, 7, PHASE_BETA)}`
  );
  check(
    'after save→reload: Alpha at the same cell is not Stone (per-phase memory)',
    dst2.getBlock(7, 30, 7, PHASE_ALPHA) !== BLOCK_STONE
  );

  // 5) Break a generator-populated cell. The generator may or may not
  // fill the cell we pick — we scan the chunk to find a solid cell in
  // Alpha, then break it, save, reload, and confirm the break survives.
  const src3 = makeWorld();
  src3.ensureChunk(0, 0);
  let foundSolid = null;
  for (let y = 0; y < 32 && !foundSolid; y++) {
    for (let x = 0; x < 16 && !foundSolid; x++) {
      for (let z = 0; z < 16 && !foundSolid; z++) {
        const b = src3.getBlock(x, y, z, PHASE_ALPHA);
        if (b === BLOCK_DIRT || b === BLOCK_STONE) foundSolid = { x, y, z, b };
      }
    }
  }
  if (foundSolid) {
    // Break it.
    src3.setBlock(foundSolid.x, foundSolid.y, foundSolid.z, PHASE_ALPHA, BLOCK_AIR);
    const snap3 = src3.exportGlobalState();
    const key = `${foundSolid.x},${foundSolid.y},${foundSolid.z},${PHASE_ALPHA}`;
    check(
      'snapshot includes the break on the generator-populated cell',
      snap3[key] === BLOCK_AIR,
      `key=${key} value=${snap3[key]}`
    );
    // Fresh world, import, reload.
    const dst3 = makeWorld();
    dst3.ensureChunk(0, 0);
    dst3.chunks.delete('0,0');
    dst3.importGlobalState(snap3);
    dst3.ensureChunk(0, 0);
    check(
      'after save→reload: generator-populated cell is BLOCK_AIR (the break survives)',
      dst3.getBlock(foundSolid.x, foundSolid.y, foundSolid.z, PHASE_ALPHA) === BLOCK_AIR,
      `got=${dst3.getBlock(foundSolid.x, foundSolid.y, foundSolid.z, PHASE_ALPHA)}`
    );
  } else {
    // No generator-populated cell found in the swept volume — skip.
    // (The test still passes; the contract is the same.)
    check(
      'generator-populated cell found for the third scenario',
      false,
      'no Dirt/Stone in (0..15, 0..31, 0..15) — skipping'
    );
  }

  console.log('\n=== Phase 2.4 SaveSystem save/load round-trip preserves AIR ===');

  // 6) Full SaveSystem round-trip: export → saveSnapshot → loadGame →
  // importGlobalState → reload chunk. This mirrors the init() flow.
  const { SaveSystem } = await import(pathToFileURL(savePath).href);
  // Minimal localStorage shim so the test runs in plain Node.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };

  const saver = new SaveSystem();
  // Build a snapshot that includes both a Stone placement and a break.
  const editorWorld = makeWorld();
  editorWorld.ensureChunk(0, 0);
  editorWorld.setBlock(11, 30, 11, PHASE_ALPHA, BLOCK_STONE);
  editorWorld.setBlock(12, 30, 12, PHASE_ALPHA, BLOCK_AIR);
  editorWorld.setBlock(13, 30, 13, PHASE_BETA, BLOCK_STONE);
  const snap = editorWorld.exportGlobalState();
  // Sanity: the snapshot contains AIR.
  check(
    'precondition: editor world snapshot includes BLOCK_AIR',
    snap['12,30,12,0'] === BLOCK_AIR
  );
  // saveSnapshot persists to localStorage.
  saver.saveSnapshot(0, 30, 0, PHASE_ALPHA, snap);
  // loadGame returns the same snapshot.
  const reloaded = saver.loadGame();
  check(
    'SaveSystem.loadGame() returns the worldState with BLOCK_AIR preserved',
    reloaded && reloaded.worldState && reloaded.worldState['12,30,12,0'] === BLOCK_AIR
  );
  check(
    'SaveSystem.loadGame() returns the worldState with BLOCK_STONE preserved',
    reloaded && reloaded.worldState && reloaded.worldState['11,30,11,0'] === BLOCK_STONE
  );
  check(
    'SaveSystem.loadGame() returns the worldState with Beta Stone preserved',
    reloaded && reloaded.worldState && reloaded.worldState['13,30,13,1'] === BLOCK_STONE
  );
  // Fresh world imports the snapshot and reloads the chunk.
  const restored = makeWorld();
  restored.ensureChunk(0, 0);
  restored.chunks.delete('0,0');
  restored.importGlobalState(reloaded.worldState);
  restored.ensureChunk(0, 0);
  check(
    'full save→reload round-trip: Stone in Alpha survives',
    restored.getBlock(11, 30, 11, PHASE_ALPHA) === BLOCK_STONE
  );
  check(
    'full save→reload round-trip: break (AIR) in Alpha survives',
    restored.getBlock(12, 30, 12, PHASE_ALPHA) === BLOCK_AIR,
    `got=${restored.getBlock(12, 30, 12, PHASE_ALPHA)}`
  );
  check(
    'full save→reload round-trip: Stone in Beta survives',
    restored.getBlock(13, 30, 13, PHASE_BETA) === BLOCK_STONE
  );
  check(
    'full save→reload round-trip: global state map records AIR (not the default fallback)',
    restored.getGlobalBlock(12, 30, 12, PHASE_ALPHA) === BLOCK_AIR
  );

  // 7) Tampered save blob: SaveSystem._coerceWorldState still rejects
  // non-finite / non-integer / negative ids but accepts BLOCK_AIR.
  store.set('phaseshift_save', JSON.stringify({
    position: { x: 0, y: 0, z: 0 },
    phase: 0,
    worldState: {
      '20,30,20,0': BLOCK_STONE, // kept
      '21,30,21,0': BLOCK_AIR,   // kept (Phase 2.4)
      '22,30,22,0': NaN,         // rejected
      '23,30,23,0': -1,          // rejected
      '24,30,24,0': 1.5,         // rejected
      '25,30,25,0': 'oops',      // rejected
    },
  }));
  const tampered = saver.loadGame();
  check(
    'tampered blob: BLOCK_STONE is preserved',
    tampered.worldState['20,30,20,0'] === BLOCK_STONE
  );
  check(
    'tampered blob: BLOCK_AIR is preserved (Phase 2.4 contract)',
    tampered.worldState['21,30,21,0'] === BLOCK_AIR
  );
  check(
    'tampered blob: NaN is rejected',
    !('22,30,22,0' in tampered.worldState)
  );
  check(
    'tampered blob: negative is rejected',
    !('23,30,23,0' in tampered.worldState)
  );
  check(
    'tampered blob: fractional is rejected',
    !('24,30,24,0' in tampered.worldState)
  );
  check(
    'tampered blob: non-number is rejected',
    !('25,30,25,0' in tampered.worldState)
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 2.4 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
