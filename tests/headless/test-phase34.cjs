#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 3.4 verification: Resonance Cores - Crystal Caverns amplifiers
// that reduce the energy cost of the matching phase transition.
//
//   1) Static-analysis - the pieces exist:
//        - src/core/constants.js has BLOCK_RESONANCE_CORE=16,
//          AMPLIFIER_PICKUP_RADIUS=1.5, AMPLIFIER_TRANSITIONS
//        - BLOCK_PROPERTIES has BLOCK_RESONANCE_CORE entry
//        - src/collect/resonance.js exports PICKUP_RADIUS,
//          resonanceCoreKey, resonanceCoreColorForBiome,
//          pickAmplifierForKey, pickupResult, isWithinRadius,
//          floatingOffset, coreToWorldData, isResonanceCoreBlock,
//          amplifierApplies
//        - src/core/world.js has spawnResonanceCore,
//          collectResonanceCore, listResonanceCores,
//          getTotalResonanceCores, getUncollectedResonanceCoreCount,
//          getCollectedResonanceCoreCount, clearResonanceCores
//   2) Behavior - pure module:
//        - PICKUP_RADIUS === 1.5
//        - resonanceCoreKey returns canonical "x,y,z" or null
//        - pickAmplifierForKey returns one of AB/BG/AG
//        - amplifierApplies respects AMPLIFIER_TRANSITIONS
//        - pickupResult returns nearest uncollected core in radius
//        - floatingOffset returns y + rotY
//   3) Behavior - World API:
//        - spawnResonanceCore creates a core
//        - collectResonanceCore marks collected + returns data
//        - clearResonanceCores wipes the list
//   4) Behavior - inventory round-trip:
//        - addAmplifier / hasAmplifier / amplifierCount
//        - serialize / deserialize preserves amplifiers

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const resonancePath = path.join(ROOT, 'src', 'collect', 'resonance.js');
const inventoryPath = path.join(ROOT, 'src', 'inventory', 'inventory.js');

const worldText = fs.readFileSync(worldPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}

// ── 1) Static-analysis (smoke-style) ──────────────────────────
console.log('\n=== Phase 3.4 static-analysis (against source files) ===');
check('constants.js has BLOCK_RESONANCE_CORE = 16', /export\s+const\s+BLOCK_RESONANCE_CORE\s*=\s*16\b/.test(constantsText));
check('constants.js has AMPLIFIER_TRANSITIONS', /export\s+const\s+AMPLIFIER_TRANSITIONS\s*=/.test(constantsText));
check('constants.js has AMPLIFIER_PICKUP_RADIUS = 1.5', /export\s+const\s+AMPLIFIER_PICKUP_RADIUS\s*=\s*1\.5\b/.test(constantsText));
check('BLOCK_PROPERTIES has BLOCK_RESONANCE_CORE entry', /\[BLOCK_RESONANCE_CORE\]:\s*\{/.test(constantsText));

check('world.js has spawnResonanceCore method', /spawnResonanceCore\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*amplifier\s*,\s*biomeId\s*\)/.test(worldText));
check('world.js has collectResonanceCore method', /collectResonanceCore\s*\(\s*key\s*\)/.test(worldText));
check('world.js has listResonanceCores method', /listResonanceCores\s*\(\s*\)/.test(worldText));
check('world.js has clearResonanceCores method', /clearResonanceCores\s*\(\s*\)/.test(worldText));
check('world.js has getTotalResonanceCores method', /getTotalResonanceCores\s*\(\s*\)/.test(worldText));
check('world.js has getUncollectedResonanceCoreCount method', /getUncollectedResonanceCoreCount\s*\(\s*\)/.test(worldText));
check('world.js has getCollectedResonanceCoreCount method', /getCollectedResonanceCoreCount\s*\(\s*\)/.test(worldText));

// ── 2) Behavior - pure module ─────────────────────────────────
console.log('\n=== Phase 3.4 behavior - resonance.js pure module ===');
async function main() {
  const resonanceUrl = 'file://' + resonancePath.replace(/\\/g, '/');
  const inventoryUrl = 'file://' + inventoryPath.replace(/\\/g, '/');
  const worldUrl = 'file://' + worldPath.replace(/\\/g, '/');

  const resonance = await import(resonanceUrl);
  const inventory = await import(inventoryUrl);
  const { World } = await import(worldUrl);

  check('PICKUP_RADIUS === 1.5', resonance.PICKUP_RADIUS === 1.5);
  check('resonanceCoreKey returns canonical "x,y,z"', resonance.resonanceCoreKey(1.4, 2.6, 3.8) === '1,2,3');
  check('resonanceCoreKey returns null for non-finite', resonance.resonanceCoreKey(NaN, 2, 3) === null);
  check('resonanceCoreKey returns null for undefined', resonance.resonanceCoreKey(undefined, 2, 3) === null);
  check('resonanceCoreColorForBiome returns 0x88ccff for Crystal Cavern (6)', resonance.resonanceCoreColorForBiome(6) === 0x88ccff);
  check('isResonanceCoreBlock(16) is true', resonance.isResonanceCoreBlock(16) === true);
  check('isResonanceCoreBlock(0) is false', resonance.isResonanceCoreBlock(0) === false);
  check('isResonanceCoreBlock(1) is false', resonance.isResonanceCoreBlock(1) === false);

  // pickAmplifierForKey
  const amp1 = resonance.pickAmplifierForKey('0,0,0');
  const amp2 = resonance.pickAmplifierForKey('10,20,30');
  const amp3 = resonance.pickAmplifierForKey('1,2,3');
  check('pickAmplifierForKey returns string for key 0,0,0', typeof amp1 === 'string' && amp1.length > 0);
  const valid = ['amplifierAB', 'amplifierBG', 'amplifierAG'];
  check('pickAmplifierForKey returns one of AB/BG/AG', valid.includes(amp1) && valid.includes(amp2) && valid.includes(amp3));
  check('pickAmplifierForKey is deterministic', resonance.pickAmplifierForKey('5,5,5') === resonance.pickAmplifierForKey('5,5,5'));
  check('pickAmplifierForKey for empty string returns AB', resonance.pickAmplifierForKey('') === 'amplifierAB');

  // amplifierApplies
  check('amplifierApplies AB for alpha<->beta', resonance.amplifierApplies('amplifierAB', 0, 1) === true);
  check('amplifierApplies AB for beta<->alpha', resonance.amplifierApplies('amplifierAB', 1, 0) === true);
  check('amplifierApplies AB for alpha<->gamma is false', resonance.amplifierApplies('amplifierAB', 0, 2) === false);
  check('amplifierApplies BG for beta<->gamma', resonance.amplifierApplies('amplifierBG', 1, 2) === true);
  check('amplifierApplies AG for alpha<->gamma', resonance.amplifierApplies('amplifierAG', 0, 2) === true);
  check('amplifierApplies null for null amplifier', resonance.amplifierApplies(null, 0, 1) === false);
  check('amplifierApplies false for unknown amplifier', resonance.amplifierApplies('foo', 0, 1) === false);

  // isWithinRadius
  check('isWithinRadius true for same cell', resonance.isWithinRadius({x:0,y:0,z:0}, {x:0,y:0,z:0}, 1.5) === true);
  check('isWithinRadius false for far cell', resonance.isWithinRadius({x:0,y:0,z:0}, {x:5,y:0,z:0}, 1.5) === false);
  check('isWithinRadius false for null inputs', resonance.isWithinRadius(null, {x:0,y:0,z:0}, 1.5) === false);
  check('isWithinRadius false for null core', resonance.isWithinRadius({x:0,y:0,z:0}, null, 1.5) === false);
  check('isWithinRadius true at exactly 1.5', resonance.isWithinRadius({x:1.5,y:0,z:0}, {x:0,y:0,z:0}, 1.5) === true);

  // pickupResult
  check('pickupResult returns null for empty list', resonance.pickupResult({x:0,y:0,z:0}, [], 1.5) === null);
  check('pickupResult returns null for null player', resonance.pickupResult(null, [{x:0,y:0,z:0,amplifier:'amplifierAB',collected:false,key:'0,0,0'}], 1.5) === null);
  const r1 = resonance.pickupResult({x:0,y:0,z:0}, [{x:0.5,y:0.5,z:0.5,amplifier:'amplifierAB',collected:false,key:'0,0,0'}], 1.5);
  check('pickupResult returns the core within range', r1 !== null && r1.amplifier === 'amplifierAB');
  check('pickupResult returns null for out-of-range core',
    resonance.pickupResult({x:0,y:0,z:0}, [{x:10,y:0,z:0,amplifier:'amplifierAB',collected:false,key:'10,0,0'}], 1.5) === null);
  check('pickupResult skips collected cores',
    resonance.pickupResult({x:0,y:0,z:0}, [{x:0.5,y:0.5,z:0.5,amplifier:'amplifierAB',collected:true,key:'0,0,0'}], 1.5) === null);
  const r2 = resonance.pickupResult({x:0,y:0,z:0}, [
    {x:1.2,y:0.5,z:0.5,amplifier:'amplifierAB',collected:false,key:'1,0,0'},
    {x:0.5,y:0.5,z:0.5,amplifier:'amplifierBG',collected:false,key:'0,0,0'},
  ], 1.5);
  check('pickupResult returns the nearest of multiple cores', r2 !== null && r2.amplifier === 'amplifierBG');

  // floatingOffset
  const o1 = resonance.floatingOffset(0, 0);
  check('floatingOffset returns y and rotY', typeof o1.y === 'number' && typeof o1.rotY === 'number');
  let maxY = -Infinity, minY = Infinity;
  for (let t = 0; t < 10; t += 0.1) {
    const o = resonance.floatingOffset(t, 0);
    if (o.y > maxY) maxY = o.y;
    if (o.y < minY) minY = o.y;
  }
  check('floatingOffset y is between -0.2 and 0.2', maxY <= 0.2 && minY >= -0.2);

  // coreToWorldData
  const cd = resonance.coreToWorldData(1.4, 2.6, 3.8, 'amplifierBG', 6);
  check('coreToWorldData has canonical shape',
    cd.x === 1 && cd.y === 2 && cd.z === 3 && cd.amplifier === 'amplifierBG' && cd.biomeId === 6);

  // ── 3) Behavior - World API ───────────────────────────────────
  console.log('\n=== Phase 3.4 behavior - World resonance-core API ===');
  const w = new World(() => {});
  w.updateChunks(0, 0);
  const core = w.spawnResonanceCore(0, 30, 0, 'amplifierAB', 6);
  check('World.spawnResonanceCore creates a core', core !== null && core.key === '0,30,0' && core.amplifier === 'amplifierAB');
  check('World.listResonanceCores returns uncollected cores',
    w.listResonanceCores().length === 1 && w.listResonanceCores()[0].amplifier === 'amplifierAB');
  check('World.getTotalResonanceCores === 1', w.getTotalResonanceCores() === 1);
  check('World.getUncollectedResonanceCoreCount === 1', w.getUncollectedResonanceCoreCount() === 1);
  check('World.getCollectedResonanceCoreCount === 0', w.getCollectedResonanceCoreCount() === 0);
  const cd2 = w.collectResonanceCore('0,30,0');
  check('World.collectResonanceCore returns data', cd2 !== null && cd2.amplifier === 'amplifierAB' && cd2.key === '0,30,0');
  check('World.listResonanceCores is empty after collect', w.listResonanceCores().length === 0);
  check('World.getCollectedResonanceCoreCount === 1 after collect', w.getCollectedResonanceCoreCount() === 1);
  check('World.getUncollectedResonanceCoreCount === 0 after collect', w.getUncollectedResonanceCoreCount() === 0);
  check('World.collectResonanceCore on missing key returns null', w.collectResonanceCore('999,999,999') === null);
  w.spawnResonanceCore(5, 30, 5, 'amplifierBG', 6);
  const core2 = w.spawnResonanceCore(5, 30, 5, 'amplifierBG', 6);
  check('World.spawnResonanceCore is idempotent for uncollected cell', core2 !== null && core2.amplifier === 'amplifierBG');
  w.clearResonanceCores();
  check('World.clearResonanceCores wipes the list', w.getTotalResonanceCores() === 0);

  // ── 4) Behavior - inventory round-trip ────────────────────────
  console.log('\n=== Phase 3.4 behavior - inventory amplifier round-trip ===');
  const inv = inventory.createInventory();
  const added = inventory.addAmplifier(inv, 'amplifierAB');
  check('inventory.addAmplifier returns truthy', !!added);
  check('inventory.addAmplifier adds to the set', inv.amplifiers.has('amplifierAB'));
  check('inventory.hasAmplifier true for added', inventory.hasAmplifier(inv, 'amplifierAB') === true);
  check('inventory.hasAmplifier false for missing', inventory.hasAmplifier(inv, 'amplifierAG') === false);
  inventory.addAmplifier(inv, 'amplifierBG');
  check('inventory.amplifierCount counts amplifiers', inventory.amplifierCount(inv) === 2);
  const ser = inventory.serialize(inv);
  check('serialize includes amplifiers array', Array.isArray(ser.amplifiers) && ser.amplifiers.length === 2);
  const inv2 = inventory.deserialize(ser);
  check('deserialize restores amplifiers', inv2.amplifiers.has('amplifierAB') && inv2.amplifiers.has('amplifierBG'));

  console.log(`\n=== Phase 3.4 TOTAL: ${passed}/${passed + failed} passed ===`);
  if (failed > 0) {
    console.log('Failed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
