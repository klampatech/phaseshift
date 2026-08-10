#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.4 — Sequence the lore.
//
// §10.4 acceptance:
// - Lore is no longer random. 30+ sequenced Echoes (5 per biome x 7 + 1 Nexus final).
// - Each Echo has a biome-specific lore, deterministic per (biomeId, ordinal).
// - The legacy ECHO_LORE_LIBRARY still exists as a flat array (back-compat).
// - echoLoreForKey (legacy) still works for the §3.3 test.
// - The HUD can show "Forest Echo 3 of 5" via echoOrdinalLabel.
// - loreCountForBiome returns the correct count per biome.
//
// The 36 lore strings tell a coherent narrative about the Architect,
// the Mirror City, the Lost Three Cities, and the player as the
// next Architect.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const echoPath = path.join(ROOT, 'src', 'collect', 'echo.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.4 — Sequence the lore ===\n');

  const echoMod = await import(pathToFileURL(echoPath).href);
  const constantsMod = await import(pathToFileURL(constantsPath).href);

  // 1. The 30+ lore requirement.
  check('ECHO_LORE_BY_BIOME has 8 biomes', Object.keys(echoMod.ECHO_LORE_BY_BIOME).length === 8);
  check('Forest biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_FOREST].length === 5);
  check('Ruins biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_RUINS].length === 5);
  check('Caves biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_CAVES].length === 5);
  check('Crystal Cavern biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_CRYSTAL_CAVERN].length === 5);
  check('Desert biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_DESERT].length === 5);
  check('Deep Void biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_DEEP_VOID].length === 5);
  check('Sky Ruins biome has 5 lore entries', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_SKY_RUINS].length === 5);
  check('Phase Nexus biome has 1 lore entry (the final)', echoMod.ECHO_LORE_BY_BIOME[constantsMod.BIOME_PHASE_NEXUS].length === 1);

  // 2. Total = 36 (5*7 + 1).
  const total = 5 * 7 + 1;
  check('Total lore entries = 36 (5 per biome × 7 + 1 Nexus final)', echoMod.ECHO_LORE_LIBRARY.length === total);

  // 3. Each biome has unique lore (no overlap between biomes).
  const allLore = [];
  for (const b of Object.keys(echoMod.ECHO_LORE_BY_BIOME)) {
    for (const lore of echoMod.ECHO_LORE_BY_BIOME[b]) {
      allLore.push(lore);
    }
  }
  const unique = new Set(allLore);
  check('All 36 lore strings are unique', unique.size === allLore.length, `unique=${unique.size} total=${allLore.length}`);

  // 4. loreForBiomeOrdinal is deterministic.
  const l1 = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_FOREST, 1);
  const l2 = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_FOREST, 1);
  check('loreForBiomeOrdinal is deterministic (same input → same output)',
    l1 === l2);

  // 5. loreForBiomeOrdinal handles out-of-range gracefully.
  const lOver = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_FOREST, 99);
  const lLast = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_FOREST, 5);
  check('loreForBiomeOrdinal clamps ordinal > length to last entry',
    lOver === lLast);

  // 6. loreForBiomeOrdinal handles out-of-range biome gracefully.
  const lBad = echoMod.loreForBiomeOrdinal(999, 1);
  const lForestFirst = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_FOREST, 1);
  check('loreForBiomeOrdinal falls back to Forest for unknown biome',
    lBad === lForestFirst);

  // 7. Each biome's lore is distinct (the picker returns different strings).
  const forest = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_FOREST, 1);
  const ruins = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_RUINS, 1);
  const caves = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_CAVES, 1);
  check('Different biomes return different lore strings',
    forest !== ruins && ruins !== caves && forest !== caves);

  // 8. The Nexus final is "you are the next Architect".
  const nexus = echoMod.loreForBiomeOrdinal(constantsMod.BIOME_PHASE_NEXUS, 1);
  check('Nexus final Echo is the "next Architect" line',
    /next Architect/.test(nexus));

  // 9. loreCountForBiome is correct.
  check('loreCountForBiome(Forest) === 5', echoMod.loreCountForBiome(constantsMod.BIOME_FOREST) === 5);
  check('loreCountForBiome(Nexus) === 1', echoMod.loreCountForBiome(constantsMod.BIOME_PHASE_NEXUS) === 1);
  check('loreCountForBiome(999) defaults to Forest count (5)', echoMod.loreCountForBiome(999) === 5);

  // 10. echoOrdinalLabel produces the HUD label.
  const label = echoMod.echoOrdinalLabel(constantsMod.BIOME_FOREST, 'Forest', 3);
  check('echoOrdinalLabel returns "Forest Echo 3 of 5"',
    label === 'Forest Echo 3 of 5', `got: "${label}"`);
  const nexusLabel = echoMod.echoOrdinalLabel(constantsMod.BIOME_PHASE_NEXUS, 'Phase Nexus', 1);
  check('echoOrdinalLabel returns "Phase Nexus Echo 1 of 1"',
    nexusLabel === 'Phase Nexus Echo 1 of 1', `got: "${nexusLabel}"`);

  // 11. nextOrdinalForBiome assigns 1, 2, 3, 4, 5 in spawn order.
  check('nextOrdinalForBiome(Forest, 0) === 1', echoMod.nextOrdinalForBiome(constantsMod.BIOME_FOREST, 0) === 1);
  check('nextOrdinalForBiome(Forest, 4) === 5', echoMod.nextOrdinalForBiome(constantsMod.BIOME_FOREST, 4) === 5);
  check('nextOrdinalForBiome(Forest, 5) clamps to 5', echoMod.nextOrdinalForBiome(constantsMod.BIOME_FOREST, 5) === 5);

  // 12. Back-compat: echoLoreForKey still works.
  const lCompat = echoMod.echoLoreForKey('test');
  check('echoLoreForKey (legacy) still returns a string',
    typeof lCompat === 'string' && lCompat.length > 0);

  // 13. The lore strings are not empty.
  for (const [biomeId, list] of Object.entries(echoMod.ECHO_LORE_BY_BIOME)) {
    for (const lore of list) {
      check(`Biome ${biomeId} lore is non-empty`, typeof lore === 'string' && lore.length > 10);
    }
  }

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.4 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.4 test crashed:', err);
  process.exit(1);
});
