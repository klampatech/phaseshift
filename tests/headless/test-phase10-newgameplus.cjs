#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.14 — New Game+ mode (phase-dominance shuffle + ironman).
//
// §10.14 acceptance:
// - New phaseDominanceSeed in GameState (default 0 = no shuffle).
// - pickPhaseDominance(seed, biomeId) returns a permutation of [0, 1, 2].
// - Seed = 0 returns the canonical [0, 1, 2] (no shuffle).
// - Phase Nexus is special: it always returns [0, 1, 2] regardless of seed.
// - Same (seed, biomeId) pair always produces the same permutation
//   (deterministic across reloads).
// - Different (seed, biomeId) pairs produce different permutations
//   (at least for some pairs).
// - isShuffled returns true when the permutation differs from identity.
// - DEFAULT_IRONMAN === false; isIronman returns true only when set.
// - SaveSystem._coerceNewGamePlus is defensive (handles null/garbage).
// - SaveSystem.startNewGamePlus returns a fresh save blob with the new
//   seed + ironman flag.
// - World exposes getPhaseDominanceSeed / getPhaseDominancePermutation /
//   getDominantPhase / getDominanceWeights / setPhaseDominanceSeed.
// - main.js wires the "Start New Game+" button (btn-newgameplus) to
//   the click handler that calls saveSystem.startNewGamePlus().
// - BIOME_DATA in src/gen/terrain.js has a phaseDominance field per biome.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const ngPath = path.join(ROOT, 'src', 'newgameplus', 'newgameplus.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const terrainPath = path.join(ROOT, 'src', 'gen', 'terrain.js');
const savePath = path.join(ROOT, 'src', 'save', 'system.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const mainPath = path.join(ROOT, 'main.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.14 — New Game+ mode ===\n');

  const ng = await import(pathToFileURL(ngPath).href);
  const constants = await import(pathToFileURL(constantsPath).href);

  // 1. Module exports.
  check('newgameplus module exports DEFAULT_PHASE_DOMINANCE_SEED',
    ng.DEFAULT_PHASE_DOMINANCE_SEED === 0);
  check('newgameplus module exports DEFAULT_IRONMAN',
    ng.DEFAULT_IRONMAN === false);
  check('newgameplus module exports NEXUS_DOMINANCE',
    Array.isArray(ng.NEXUS_DOMINANCE) && ng.NEXUS_DOMINANCE.length === 3);
  check('newgameplus module exports SHUFFLABLE_BIOMES',
    Array.isArray(ng.SHUFFLABLE_BIOMES) && ng.SHUFFLABLE_BIOMES.length === 7);
  check('newgameplus module exports pickPhaseDominance',
    typeof ng.pickPhaseDominance === 'function');
  check('newgameplus module exports pickDominantPhase',
    typeof ng.pickDominantPhase === 'function');
  check('newgameplus module exports dominanceWeights',
    typeof ng.dominanceWeights === 'function');
  check('newgameplus module exports createNewGamePlusState',
    typeof ng.createNewGamePlusState === 'function');
  check('newgameplus module exports setIronman',
    typeof ng.setIronman === 'function');
  check('newgameplus module exports rollPhaseDominanceSeed',
    typeof ng.rollPhaseDominanceSeed === 'function');
  check('newgameplus module exports isIronman',
    typeof ng.isIronman === 'function');
  check('newgameplus module exports isShuffled',
    typeof ng.isShuffled === 'function');
  check('newgameplus module exports serialize',
    typeof ng.serialize === 'function');
  check('newgameplus module exports deserialize',
    typeof ng.deserialize === 'function');

  // 2. Seed = 0 returns identity permutation.
  const identity = ng.pickPhaseDominance(0, 1);
  check('seed=0, Forest → [0,1,2]',
    identity[0] === 0 && identity[1] === 1 && identity[2] === 2);

  // 3. Phase Nexus is special.
  const nexusPerm = ng.pickPhaseDominance(12345, constants.BIOME_PHASE_NEXUS);
  check('seed=12345, Nexus → [0,1,2] (special)',
    nexusPerm[0] === 0 && nexusPerm[1] === 1 && nexusPerm[2] === 2);

  // 4. Different seeds produce different permutations (at least one pair).
  const seed1 = 12345;
  const seed2 = 67890;
  const perm1 = ng.pickPhaseDominance(seed1, 1);
  const perm2 = ng.pickPhaseDominance(seed2, 1);
  const isDifferent = perm1.some((v, i) => v !== perm2[i]);
  check('Different seeds produce different permutations',
    isDifferent, `perm1=[${perm1}] perm2=[${perm2}]`);

  // 5. Determinism: same (seed, biomeId) pair always produces the same permutation.
  const permA = ng.pickPhaseDominance(seed1, 1);
  const permB = ng.pickPhaseDominance(seed1, 1);
  check('Determinism: same inputs → same permutation',
    permA[0] === permB[0] && permA[1] === permB[1] && permA[2] === permB[2]);

  // 6. Permutation is a permutation of [0, 1, 2] (no duplicates).
  function isPermutation(arr) {
    return Array.isArray(arr) && arr.length === 3
      && arr.includes(0) && arr.includes(1) && arr.includes(2)
      && new Set(arr).size === 3;
  }
  let allValid = true;
  for (const seed of [1, 42, 12345, 67890, 99999, 1 << 20, 1 << 25]) {
    for (const b of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const p = ng.pickPhaseDominance(seed, b);
      if (!isPermutation(p)) { allValid = false; break; }
    }
  }
  check('All (seed, biomeId) pairs produce valid permutations',
    allValid);

  // 7. pickDominantPhase returns index 0 of the permutation.
  const domPerm = ng.pickPhaseDominance(99, 5);
  const domPhase = ng.pickDominantPhase(99, 5);
  check('pickDominantPhase returns index 0 of permutation',
    domPhase === domPerm[0]);

  // 8. dominanceWeights returns the canonical shape.
  const weights = ng.dominanceWeights([2, 0, 1]);
  check('dominanceWeights returns dominant/middle/rare + phases',
    weights.dominant === 1.0 && weights.middle === 0.5 && weights.rare === 0.25
    && weights.dominantPhase === 2 && weights.middlePhase === 0 && weights.rarePhase === 1);

  // 9. isShuffled: false for seed=0, true for shuffled seed.
  check('isShuffled(0, 1) === false', ng.isShuffled(0, 1) === false);
  check('isShuffled(12345, 1) === true', ng.isShuffled(12345, 1) === true);
  check('isShuffled(12345, Nexus) === false (Nexus never shuffles)',
    ng.isShuffled(12345, constants.BIOME_PHASE_NEXUS) === false);

  // 10. createNewGamePlusState.
  const fresh = ng.createNewGamePlusState();
  check('createNewGamePlusState() returns default state',
    fresh.phaseDominanceSeed === 0 && fresh.ironman === false);
  const existing = { phaseDominanceSeed: 42, ironman: true };
  const same = ng.createNewGamePlusState(existing);
  check('createNewGamePlusState(existing) preserves state',
    same === existing);

  // 11. setIronman.
  const s1 = ng.createNewGamePlusState();
  ng.setIronman(s1, true);
  check('setIronman(state, true) sets ironman=true', s1.ironman === true);
  ng.setIronman(s1, false);
  check('setIronman(state, false) sets ironman=false', s1.ironman === false);

  // 12. isIronman.
  const s2 = ng.createNewGamePlusState();
  check('isIronman(default) === false', ng.isIronman(s2) === false);
  s2.ironman = true;
  check('isIronman(true) === true', ng.isIronman(s2) === true);
  check('isIronman(null) === false', ng.isIronman(null) === false);

  // 13. Serialization round-trip.
  const ser = ng.serialize({ phaseDominanceSeed: 42, ironman: true });
  check('serialize → { phaseDominanceSeed: 42, ironman: true }',
    ser.phaseDominanceSeed === 42 && ser.ironman === true);
  const des = ng.deserialize(ser);
  check('deserialize(ser) restores state',
    des.phaseDominanceSeed === 42 && des.ironman === true);
  const desBad = ng.deserialize({ phaseDominanceSeed: 'foo', ironman: 'yes' });
  check('deserialize(garbage) returns defaults',
    desBad.phaseDominanceSeed === 0 && desBad.ironman === false);
  const desNull = ng.deserialize(null);
  check('deserialize(null) returns defaults',
    desNull.phaseDominanceSeed === 0 && desNull.ironman === false);

  // 14. Defensive: NaN / non-integer seeds fall back to identity.
  const nanPerm = ng.pickPhaseDominance(NaN, 1);
  check('NaN seed returns identity permutation',
    nanPerm[0] === 0 && nanPerm[1] === 1 && nanPerm[2] === 2);
  const negPerm = ng.pickPhaseDominance(-1, 1);
  // -1 floors to -1 (non-zero) so should still produce a (different) permutation.
  check('Negative seed produces valid permutation',
    isPermutation(negPerm));

  // 15. World integration.
  const { World } = await import(pathToFileURL(worldPath).href);
  const world = new World(null, null, 42, 12345);
  check('world.getPhaseDominanceSeed() === 12345',
    world.getPhaseDominanceSeed() === 12345);
  const permForest = world.getPhaseDominancePermutation(1);
  check('world.getPhaseDominancePermutation(Forest) is valid',
    isPermutation(permForest));
  const permNexus = world.getPhaseDominancePermutation(constants.BIOME_PHASE_NEXUS);
  check('world.getPhaseDominancePermutation(Nexus) === [0,1,2]',
    permNexus[0] === 0 && permNexus[1] === 1 && permNexus[2] === 2);
  check('world.getDominantPhase(1) === permForest[0]',
    world.getDominantPhase(1) === permForest[0]);
  const weightsWorld = world.getDominanceWeights(1);
  check('world.getDominanceWeights(1) returns shape',
    typeof weightsWorld.dominant === 'number' && typeof weightsWorld.middlePhase === 'number');
  // setPhaseDominanceSeed.
  world.setPhaseDominanceSeed(999);
  check('world.setPhaseDominanceSeed(999) updates seed',
    world.getPhaseDominanceSeed() === 999);

  // 16. World default seed (no seed passed).
  const worldDefault = new World(null, null);
  check('World default seed === 42 (back-compat)',
    worldDefault.seed === 42);
  check('World default phaseDominanceSeed === 0 (back-compat)',
    worldDefault.getPhaseDominanceSeed() === 0);

  // 17. Save system integration.
  const { SaveSystem } = await import(pathToFileURL(savePath).href);
  const saveSystem = new SaveSystem();
  // Use the _coerceNewGamePlus directly (it's on the class).
  const freshNgp = saveSystem._coerceNewGamePlus(null);
  check('SaveSystem._coerceNewGamePlus(null) returns defaults',
    freshNgp.phaseDominanceSeed === 0 && freshNgp.ironman === false);
  const validNgp = saveSystem._coerceNewGamePlus({ phaseDominanceSeed: 42, ironman: true });
  check('SaveSystem._coerceNewGamePlus({...}) returns state',
    validNgp.phaseDominanceSeed === 42 && validNgp.ironman === true);
  const badNgp = saveSystem._coerceNewGamePlus({ phaseDominanceSeed: 'bad', ironman: 1 });
  check('SaveSystem._coerceNewGamePlus rejects garbage',
    badNgp.phaseDominanceSeed === 0 && badNgp.ironman === false);

  // 18. startNewGamePlus returns a fresh save blob.
  const newState = saveSystem.startNewGamePlus(null, { phaseDominanceSeed: 100, ironman: true });
  check('startNewGamePlus returns new state with seed=100',
    newState.newGamePlus.phaseDominanceSeed === 100);
  check('startNewGamePlus preserves ironman=true',
    newState.newGamePlus.ironman === true);
  check('startNewGamePlus resets worldState/anchors/inventory',
    Object.keys(newState.worldState).length === 0
    && newState.anchors.length === 0
    && newState.inventory.collectedEchoes.length === 0
    && newState.inventory.amplifiers.length === 0);
  check('startNewGamePlus resets position to (0, 20, 0)',
    newState.position.x === 0 && newState.position.y === 20 && newState.position.z === 0);

  // 19. Terrain.js: phaseDominance field per biome.
  const terrainText = fs.readFileSync(terrainPath, 'utf8');
  check('terrain.js BIOME_DATA has phaseDominance field (Forest)',
    /\[BIOME_FOREST\]:[\s\S]{0,2000}?phaseDominance:\s*\[/.test(terrainText));
  check('terrain.js generateChunk returns phaseDominance metadata',
    /phaseDominance:\s*\{[\s\S]{0,500}?permutation/.test(terrainText));
  check('terrain.js TerrainGenerator constructor accepts phaseDominanceSeed',
    /constructor\s*\(\s*seed\s*,\s*phaseDominanceSeed\s*\)/.test(terrainText));

  // 20. main.js wires the button.
  const mainText = fs.readFileSync(mainPath, 'utf8');
  check('main.js has btn-newgameplus in pause menu',
    /id="btn-newgameplus"/.test(mainText));
  check('main.js wires btn-newgameplus click handler',
    /safeOn\s*\(\s*['"]btn-newgameplus['"]/.test(mainText));
  check('main.js click handler calls startNewGamePlus',
    /safeOn\s*\(\s*['"]btn-newgameplus['"][\s\S]{0,1500}?startNewGamePlus/.test(mainText));
  check('main.js exports __phaseShifter__.newGamePlus debug hook',
    /newGamePlus:\s*\{[\s\S]{0,200}?get seed/.test(mainText));
  check('main.js saveGame passes newGamePlusState to saveSnapshot',
    /saveSnapshot[\s\S]{0,500}?newGamePlusState/.test(mainText));

  // 21. Save blob shape includes newGamePlus.
  check('SaveSystem._normalizeState includes newGamePlus',
    /_normalizeState[\s\S]{0,1500}?_coerceNewGamePlus/.test(fs.readFileSync(savePath, 'utf8')));
  check('SaveSystem.save includes newGamePlus',
    /save\s*\(gameState\)[\s\S]{0,1500}?_coerceNewGamePlus/.test(fs.readFileSync(savePath, 'utf8')));
  check('SaveSystem.saveSnapshot includes newGamePlus',
    /saveSnapshot[\s\S]{0,1500}?_coerceNewGamePlus/.test(fs.readFileSync(savePath, 'utf8')));

  // 22. GameState has newGamePlus.
  const gameStateText = fs.readFileSync(path.join(ROOT, 'src', 'gen', 'gameState.js'), 'utf8');
  check('GameState has newGamePlus property',
    /this\.newGamePlus\s*=\s*\{/.test(gameStateText));

  // 23. World exposes the §10.14 API.
  const worldText = fs.readFileSync(worldPath, 'utf8');
  check('World has getPhaseDominanceSeed method',
    /getPhaseDominanceSeed\s*\(\s*\)/.test(worldText));
  check('World has getPhaseDominancePermutation method',
    /getPhaseDominancePermutation\s*\(\s*biomeId\s*\)/.test(worldText));
  check('World has getDominantPhase method',
    /getDominantPhase\s*\(\s*biomeId\s*\)/.test(worldText));
  check('World has getDominanceWeights method',
    /getDominanceWeights\s*\(\s*biomeId\s*\)/.test(worldText));
  check('World has setPhaseDominanceSeed method',
    /setPhaseDominanceSeed\s*\(\s*seed\s*\)/.test(worldText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.14 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.14 test crashed:', err);
  process.exit(1);
});
