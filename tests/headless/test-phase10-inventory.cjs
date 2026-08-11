#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.10 — Echo Hunter panel.
//
// §10.10 acceptance:
// - inventory.js exports listEchoesByBiome() with the canonical shape
//   { byBiome, collected, total, byBiomeCollected, byBiomeTotal }.
// - listEchoesByBiome() returns a fresh state for missing / invalid
//   inventory.
// - The byBiome map groups collected Echoes by their biomeId.
// - byBiomeTotal is the canonical 5-per-biome + 1 Nexus shape.
// - The HUD exposes showEchoHunter() + hideEchoHunter() +
//   showBiomeZoneOverlay() methods.
// - The HUD's inventory panel includes the "Open Echo Hunter" button.
// - main.js wires the open-echo-hunter click handler.
// - main.js exports the __phaseShifter__.echoHunter debug surface.
// - main.js shows the zone overlay on biome transition.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const invPath = path.join(ROOT, 'src', 'inventory', 'inventory.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const mainPath = path.join(ROOT, 'main.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.10 — Echo Hunter panel ===\n');

  const inv = await import(pathToFileURL(invPath).href);

  // 1. Module exports.
  check('inventory module exports listEchoesByBiome',
    typeof inv.listEchoesByBiome === 'function');
  check('inventory module exports getBiomeIdForKey',
    typeof inv.getBiomeIdForKey === 'function');

  // 2. listEchoesByBiome: empty inventory returns fresh state.
  const fresh = inv.listEchoesByBiome(null);
  check('listEchoesByBiome(null) returns fresh state',
    typeof fresh === 'object' && fresh.collected === 0 && fresh.total === 0
    && Object.keys(fresh.byBiome).length === 0);

  // 3. listEchoesByBiome: missing loreCountForBiome defaults to 5.
  const inv2 = inv.createInventory();
  inv.addEcho(inv2, '1,5,10', 'Forest 1');
  const r2 = inv.listEchoesByBiome(inv2, () => 1, null);
  check('listEchoesByBiome with null loreCountForBiome defaults to 5',
    r2.byBiomeTotal[1] === 5);

  // 4. listEchoesByBiome: groups by biome.
  inv.addEcho(inv2, '1,5,11', 'Forest 2');
  inv.addEcho(inv2, '1,5,12', 'Forest 3');
  const r3 = inv.listEchoesByBiome(inv2, (key) => {
    if (key === '1,5,10' || key === '1,5,11' || key === '1,5,12') return 1; // Forest
    return 0;
  }, (b) => (b === 8 ? 1 : 5));
  check('listEchoesByBiome groups 3 Echoes into byBiome[1]',
    r3.byBiome[1] && r3.byBiome[1].length === 3);
  check('listEchoesByBiome returns collected = 3',
    r3.collected === 3);
  check('listEchoesByBiome returns total = 36 (7 biomes × 5 + 1 Nexus)',
    r3.total === 36, `got: ${r3.total}`);

  // 5. listEchoesByBiome: per-biome breakdown includes all 8 biomes.
  let allBiomes = true;
  for (let b = 1; b <= 8; b++) {
    if (!(b in r3.byBiomeTotal)) { allBiomes = false; break; }
  }
  check('listEchoesByBiome byBiomeTotal includes all 8 biomes', allBiomes);
  check('listEchoesByBiome byBiomeTotal[Nexus=8] === 1', r3.byBiomeTotal[8] === 1);
  check('listEchoesByBiome byBiomeTotal[Forest=1] === 5', r3.byBiomeTotal[1] === 5);

  // 6. listEchoesByBiome: missing biomeIdForKey defaults to 0.
  const inv3 = inv.createInventory();
  inv.addEcho(inv3, 'a,b,c', 'Lore A');
  const r4 = inv.listEchoesByBiome(inv3, null, (b) => 5);
  check('listEchoesByBiome with null biomeIdForKey defaults to biome 0',
    r4.byBiome[0] && r4.byBiome[0].length === 1);
  check('listEchoesByBiome entry has the lore string',
    r4.byBiome[0][0].lore === 'Lore A');

  // 7. getBiomeIdForKey: returns 0 for missing key.
  check('getBiomeIdForKey(missing) === 0', inv.getBiomeIdForKey(inv2, 'foo') === 0);
  check('getBiomeIdForKey(invalid) === 0', inv.getBiomeIdForKey(null, 'x') === 0);

  // 8. HUD module exposes the §10.10 API.
  const hudText = fs.readFileSync(hudPath, 'utf8');
  check('HUD has showEchoHunter method',
    /showEchoHunter\s*\(\s*summary\s*,\s*biomeName\s*\)/.test(hudText));
  check('HUD has hideEchoHunter method',
    /hideEchoHunter\s*\(\s*\)/.test(hudText));
  check('HUD has showBiomeZoneOverlay method',
    /showBiomeZoneOverlay\s*\(\s*zoneText\s*,\s*ttlMs\s*\)/.test(hudText));
  check('HUD inventory panel has Open Echo Hunter button',
    /id="btn-open-echo-hunter"/.test(hudText));
  check('HUD fixes the broken template literal (no $ interpolation)',
    /ECHOES & LORE \(\${echoes\.length}/.test(hudText) === false);

  // 9. main.js wires the §10.10 API.
  const mainText = fs.readFileSync(mainPath, 'utf8');
  check('main.js imports listEchoesByBiome from inventory module',
    /import\s*\{[^}]*listEchoesByBiome[^}]*\}\s*from\s*['"]\.\/src\/inventory\/inventory\.js['"]/.test(mainText));
  check('main.js wires btn-open-echo-hunter click handler',
    /safeOn\s*\(\s*['"]btn-open-echo-hunter['"]/.test(mainText));
  check('main.js buildEchoHunterSummary function defined',
    /function\s+buildEchoHunterSummary\s*\(/.test(mainText));
  check('main.js buildEchoHunterSummary uses listEchoesByBiome',
    /buildEchoHunterSummary[\s\S]{0,1500}?listEchoesByBiome/.test(mainText));
  check('main.js tickBiomesPerFrame shows zone overlay',
    /tickBiomesPerFrame[\s\S]{0,3000}?showBiomeZoneOverlay/.test(mainText));
  check('main.js exports __phaseShifter__.echoHunter debug hook',
    /echoHunter:\s*\{[\s\S]{0,500}?openPanel/.test(mainText));
  // The original adapter had a broken getEchoes that read
  // from playerInventory.echoes (which was always empty).
  // The fix reads from playerInventory.collectedEchoes.
  check('main.js getEchoes reads from collectedEchoes Map',
    /getEchoes:[^}]*collectedEchoes\s+instanceof\s+Map/.test(mainText));

  // 10. The biome zone overlay hook reads from biomeLabel.
  check('main.js biome zone overlay uses biomeLabel for biome name',
    /showBiomeZoneOverlay[\s\S]{0,200}?biomeLabel/.test(mainText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.10 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.10 test crashed:', err);
  process.exit(1);
});
