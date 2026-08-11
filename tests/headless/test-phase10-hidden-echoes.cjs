#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.11 — Wrong-phase Echoes (Phase-Lens-findable).
//
// §10.11 acceptance:
// - WRONG_PHASE_ECHOES constant maps each non-Nexus biome to its
//   visible phase + unique lore string.
// - wrongPhaseEchoForBiome returns the metadata for a given biome,
//   or null for the Phase Nexus.
// - getEchoVisibility returns { visible, reason } for an Echo key.
// - Standard Echoes are always visible.
// - Wrong-phase Echoes are visible only when currentPhase matches.
// - hiddenEchoBiomeCount returns 7 (all non-Nexus biomes).
// - World exposes getEchoVisibility(key, currentPhase),
//   listHiddenEchoes(), spawnHiddenEcho(x, y, z, hiddenPhase, lore,
//   biomeId), getHiddenEchoForBiome(biomeId).
// - World._hiddenEchoes is initialized to a Map() (round-trips
//   through save/load via applyEchoState).
// - EchoOverlay.updateEchoes accepts a currentPhase arg and hides
//   wrong-phase Echoes (mesh.visible = false) when phase doesn't
//   match.
// - main.js imports getEchoVisibility + wrongPhaseEchoForBiome +
//   hiddenEchoBiomeCount, skips pickup of wrong-phase Echoes,
//   exposes __phaseShifter__.hiddenEchoes debug hooks, passes
//   currentPhase to renderer.updateEchoes.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const echoPath = path.join(ROOT, 'src', 'collect', 'echo.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const mainPath = path.join(ROOT, 'main.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.11 — Wrong-phase Echoes ===\n');

  const echo = await import(pathToFileURL(echoPath).href);
  const constants = await import(pathToFileURL(constantsPath).href);

  // 1. Module exports.
  check('echo module exports WRONG_PHASE_ECHOES',
    typeof echo.WRONG_PHASE_ECHOES === 'object' && echo.WRONG_PHASE_ECHOES !== null);
  check('echo module exports wrongPhaseEchoForBiome',
    typeof echo.wrongPhaseEchoForBiome === 'function');
  check('echo module exports getEchoVisibility',
    typeof echo.getEchoVisibility === 'function');
  check('echo module exports hiddenEchoBiomeCount',
    typeof echo.hiddenEchoBiomeCount === 'function');

  // 2. WRONG_PHASE_ECHOES content.
  const biomeIds = [
    constants.BIOME_FOREST,
    constants.BIOME_RUINS,
    constants.BIOME_CAVES,
    constants.BIOME_CRYSTAL_CAVERN,
    constants.BIOME_DESERT,
    constants.BIOME_DEEP_VOID,
    constants.BIOME_SKY_RUINS,
  ];
  for (const id of biomeIds) {
    const entry = echo.WRONG_PHASE_ECHOES[id];
    check(`WRONG_PHASE_ECHOES[${id}] has visiblePhase in [0,1,2]`,
      entry && Number.isFinite(entry.visiblePhase)
        && entry.visiblePhase >= 0 && entry.visiblePhase <= 2);
    check(`WRONG_PHASE_ECHOES[${id}] has non-empty lore`,
      entry && typeof entry.lore === 'string' && entry.lore.length > 0);
  }
  check('WRONG_PHASE_ECHOES[BIOME_PHASE_NEXUS] is undefined',
    echo.WRONG_PHASE_ECHOES[constants.BIOME_PHASE_NEXUS] === undefined);

  // 3. hiddenEchoBiomeCount.
  check('hiddenEchoBiomeCount() === 7',
    echo.hiddenEchoBiomeCount() === 7);

  // 4. wrongPhaseEchoForBiome.
  const forestEntry = echo.wrongPhaseEchoForBiome(constants.BIOME_FOREST);
  check('wrongPhaseEchoForBiome(BIOME_FOREST) returns biomeId',
    forestEntry && forestEntry.biomeId === constants.BIOME_FOREST);
  check('wrongPhaseEchoForBiome(BIOME_FOREST) has visiblePhase',
    forestEntry && Number.isFinite(forestEntry.visiblePhase));
  check('wrongPhaseEchoForBiome(BIOME_PHASE_NEXUS) returns null',
    echo.wrongPhaseEchoForBiome(constants.BIOME_PHASE_NEXUS) === null);
  check('wrongPhaseEchoForBiome(NaN) returns null',
    echo.wrongPhaseEchoForBiome(NaN) === null);
  check('wrongPhaseEchoForBiome(99) returns null',
    echo.wrongPhaseEchoForBiome(99) === null);

  // 5. getEchoVisibility — standard Echo.
  const standardEchoes = [
    { key: '1,2,3', loreKey: 'forest.1', biomeId: 1 },
    { key: '4,5,6', loreKey: 'ruins.1', biomeId: 4 },
  ];
  const stdVis = echo.getEchoVisibility('1,2,3', 0, standardEchoes);
  check('getEchoVisibility for standard echo: visible=true',
    stdVis.visible === true);
  check('getEchoVisibility for standard echo: reason="standard"',
    stdVis.reason === 'standard');

  // 6. getEchoVisibility — wrong-phase Echo.
  const hiddenEchoes = [
    { key: '10,20,30', loreKey: 'forest.hidden', biomeId: 1, hiddenPhase: 1 },
  ];
  const hiddenVisMatch = echo.getEchoVisibility('10,20,30', 1, hiddenEchoes);
  check('getEchoVisibility for hidden echo matching phase: visible=true',
    hiddenVisMatch.visible === true);
  check('getEchoVisibility for hidden echo matching phase: reason="wrong-phase-echo"',
    hiddenVisMatch.reason === 'wrong-phase-echo');
  const hiddenVisMismatch = echo.getEchoVisibility('10,20,30', 0, hiddenEchoes);
  check('getEchoVisibility for hidden echo mismatched phase: visible=false',
    hiddenVisMismatch.visible === false);
  check('getEchoVisibility for hidden echo mismatched phase: reason="wrong-phase-echo"',
    hiddenVisMismatch.reason === 'wrong-phase-echo');

  // 7. getEchoVisibility — defensive.
  check('getEchoVisibility("", 0, []) returns not-spawned',
    echo.getEchoVisibility('', 0, []).reason === 'no-key');
  check('getEchoVisibility("missing", 0, []) returns not-spawned',
    echo.getEchoVisibility('missing', 0, []).reason === 'not-spawned');
  check('getEchoVisibility("k", 0, null) returns not-spawned',
    echo.getEchoVisibility('k', 0, null).reason === 'not-spawned');

  // 8. World integration.
  const { World } = await import(pathToFileURL(worldPath).href);
  const world = new World();
  world.updateChunks(0, 0);

  // Hidden Echo API.
  const hidden = world.spawnHiddenEcho(5, 30, 5, 1, 'forest.hidden.lore', 1);
  check('spawnHiddenEcho returns Echo with hiddenPhase',
    hidden && hidden.hiddenPhase === 1);
  check('getEchoVisibility at matching phase returns visible=true',
    world.getEchoVisibility('5,30,5', 1).visible === true);
  check('getEchoVisibility at mismatched phase returns visible=false',
    world.getEchoVisibility('5,30,5', 0).visible === false);

  // listHiddenEchoes.
  const listed = world.listHiddenEchoes();
  check('listHiddenEchoes returns 1 entry',
    Array.isArray(listed) && listed.length === 1);
  check('listHiddenEchoes[0] has correct biomeId',
    listed[0] && listed[0].biomeId === 1);

  // getHiddenEchoForBiome.
  check('getHiddenEchoForBiome(BIOME_FOREST) returns metadata',
    world.getHiddenEchoForBiome(constants.BIOME_FOREST) !== null);
  check('getHiddenEchoForBiome(BIOME_PHASE_NEXUS) returns null',
    world.getHiddenEchoForBiome(constants.BIOME_PHASE_NEXUS) === null);

  // Save/load round-trip with hiddenPhase.
  const state = world.getEchoState();
  const hasHidden = state.some(e => e.hiddenPhase === 1);
  check('getEchoState includes hiddenPhase field',
    hasHidden);
  const world2 = new World();
  world2.updateChunks(0, 0);
  world2.applyEchoState(state);
  check('applyEchoState restores hidden Echo',
    world2.getEchoVisibility('5,30,5', 1).visible === true);
  check('applyEchoState still hides on wrong phase',
    world2.getEchoVisibility('5,30,5', 0).visible === false);

  // 9. Renderer wires updateEchoes with currentPhase.
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  check('renderer.js EchoOverlay.updateEchoes accepts currentPhase',
    /updateEchoes\s*\(\s*dt\s*,\s*snapshot\s*,\s*currentPhase\s*\)/.test(rendererText));
  check('renderer.js hides wrong-phase Echoes via mesh.visible',
    /mesh\.visible\s*=\s*!isHidden/.test(rendererText));
  check('renderer.js computes isHidden from e.hiddenPhase',
    /hiddenPhase\s*!==\s*null[\s\S]{0,300}?hiddenPhase\s*!==\s*phase/.test(rendererText));
  check('renderer.js Renderer class wrapper passes currentPhase',
    /updateEchoes\s*\(\s*dt\s*,\s*snapshot\s*,\s*currentPhase\s*\)\s*\{[\s\S]{0,300}?echoOverlay\.updateEchoes/.test(rendererText));

  // 10. main.js wiring.
  const mainText = fs.readFileSync(mainPath, 'utf8');
  check('main.js imports getEchoVisibility',
    /import\s*\{[^}]*getEchoVisibility[^}]*\}\s*from\s+['"]\.\/src\/collect\/echo\.js['"]/.test(mainText));
  check('main.js imports wrongPhaseEchoForBiome',
    /import\s*\{[^}]*wrongPhaseEchoForBiome[^}]*\}\s*from\s+['"]\.\/src\/collect\/echo\.js['"]/.test(mainText));
  check('main.js imports hiddenEchoBiomeCount',
    /import\s*\{[^}]*hiddenEchoBiomeCount[^}]*\}\s*from\s+['"]\.\/src\/collect\/echo\.js['"]/.test(mainText));
  check('main.js tickEchoesPerFrame checks getEchoVisibility',
    /tickEchoesPerFrame[\s\S]{0,3000}?getEchoVisibility/.test(mainText));
  check('main.js tickEchoesPerFrame passes currentPhase to renderer.updateEchoes',
    /renderer\.updateEchoes\(\s*dt\s*,\s*snapshot\s*,\s*currentPhase\s*\)/.test(mainText));
  check('main.js exports hiddenEchoes debug hook',
    /hiddenEchoes:\s*\{[\s\S]{0,2000}?list/.test(mainText));
  check('main.js hiddenEchoes.getVisibility exists',
    /hiddenEchoes:\s*\{[\s\S]{0,2000}?getVisibility/.test(mainText));
  check('main.js hiddenEchoes.spawnHidden exists',
    /hiddenEchoes:\s*\{[\s\S]{0,2000}?spawnHidden/.test(mainText));
  check('main.js hiddenEchoes.biomeCount exists',
    /hiddenEchoes:\s*\{[\s\S]{0,2000}?biomeCount/.test(mainText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.11 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.11 test crashed:', err);
  process.exit(1);
});
