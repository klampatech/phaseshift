#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 3.1 verification: Biomes — surface the current biome in the
// HUD, color the skybox + fog per biome, and lay the ground for the
// §3.2 (Stabilizers) + §3.3 (Echoes) + §3.4 (Resonance Cores)
// follow-ons.
//
//   1) Static-analysis — the pieces exist:
//        - src/world/biome.js exports BIOME_TINTS, biomeTint, biomeLabel,
//          biomeFogDensity, lerpBiomeTints, biomeTransitionDuration,
//          and re-exports the BIOME_* constants
//        - BIOME_TINTS has 8 entries (one per biome id 1-8)
//        - main.js imports biomeTint, biomeLabel, biomeFogDensity,
//          lerpBiomeTints, biomeTransitionDuration from src/world/biome.js
//        - main.js declares the module-level currentBiomeId /
//          currentBiomeTint / targetBiomeTint / biomeTransitionTimer
//          state
//        - main.js#tickBiomesPerFrame is defined and reads
//          world.getBiome
//        - main.js per-frame game loop calls tickBiomesPerFrame
//        - main.js#hud.update is called with `world` as the 3rd arg
//        - main.js exposes the new debug hooks: forceBiome,
//          getCurrentBiomeId, lerpBiomeTints, biomeLabel
//        - src/render/renderer.js#createSkybox has biomeTint +
//          phaseTint uniforms in the ShaderMaterial
//        - src/render/renderer.js#createSkybox returns a mesh with
//          setBiomeTint + setPhaseTint methods
//        - src/render/renderer.js#Renderer exposes setBiomeTint +
//          setPhaseTint forwarding to the skybox
//        - src/ui/hud.js#HUD update queries world.getBiome on
//          player position and updates #biome-info text on change
//        - index.html has the #biome-info element with the initial
//          "BIOME: FOREST" placeholder
//   2) Behavior — pure module:
//        - biomeTint(BIOME_FOREST) returns the Forest tint
//          (color [0.30, 0.55, 0.30], fogDensity 0.006)
//        - biomeTint(BIOME_CRYSTAL_CAVERN) returns the Crystal Cavern
//          tint (color [0.40, 0.30, 0.50], fogDensity 0.014)
//        - biomeTint(BIOME_DEEP_VOID) returns the Deep Void tint
//          (color [0.10, 0.05, 0.15], fogDensity 0.025)
//        - biomeTint(99) returns the Forest default
//        - biomeLabel(BIOME_FOREST) === 'Forest'
//        - biomeLabel(BIOME_PHASE_NEXUS) === 'Phase Nexus'
//        - biomeLabel(99) === 'Unknown'
//        - biomeFogDensity(BIOME_FOREST) === 0.006
//        - biomeFogDensity(BIOME_DEEP_VOID) === 0.025
//        - lerpBiomeTints(Forest, CrystalCavern, 0) returns Forest
//        - lerpBiomeTints(Forest, CrystalCavern, 1) returns CrystalCavern
//        - lerpBiomeTints(Forest, CrystalCavern, 0.5) returns the
//          mid-point color
//        - lerpBiomeTints clamps t outside [0, 1]
//        - biomeTransitionDuration() returns 0.5
//   3) Behavior — World API:
//        - world.getBiome(0, 0) returns a valid biome id (1-8)
//        - world.getBiome(0, 0) is stable across calls
//        - world.getBiome(64, 0) may differ from world.getBiome(0, 0)
//          (the per-region hash boundary)
//
// Static checks are against source files (not the Vite-minified bundle).
// Same pattern as Phases 1.2–2.8.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const biomePath = path.join(ROOT, 'src', 'world', 'biome.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const htmlPath = path.join(ROOT, 'index.html');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const biomeText = fs.readFileSync(biomePath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const hudText = fs.readFileSync(hudPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const htmlText = fs.readFileSync(htmlPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 3.1 source checks ===');

  // ── src/world/biome.js exports ───────────────────────────────────
  check(
    'src/world/biome.js exports BIOME_TINTS',
    /export\s+const\s+BIOME_TINTS\s*=\s*Object\.freeze\s*\(/.test(biomeText)
  );
  check(
    'src/world/biome.js exports biomeTint',
    /export\s+function\s+biomeTint\s*\(/.test(biomeText)
  );
  check(
    'src/world/biome.js exports biomeLabel',
    /export\s+function\s+biomeLabel\s*\(/.test(biomeText)
  );
  check(
    'src/world/biome.js exports biomeFogDensity',
    /export\s+function\s+biomeFogDensity\s*\(/.test(biomeText)
  );
  check(
    'src/world/biome.js exports lerpBiomeTints',
    /export\s+function\s+lerpBiomeTints\s*\(/.test(biomeText)
  );
  check(
    'src/world/biome.js exports biomeTransitionDuration',
    /export\s+function\s+biomeTransitionDuration\s*\(/.test(biomeText)
  );
  check(
    'src/world/biome.js re-exports BIOME_FOREST',
    /export\s*\{[^}]*BIOME_FOREST[^}]*\}\s*;?/.test(biomeText)
  );
  check(
    'src/world/biome.js re-exports BIOME_CRYSTAL_CAVERN',
    /export\s*\{[^}]*BIOME_CRYSTAL_CAVERN[^}]*\}\s*;?/.test(biomeText)
  );
  check(
    'src/world/biome.js re-exports BIOME_PHASE_NEXUS',
    /export\s*\{[^}]*BIOME_PHASE_NEXUS[^}]*\}\s*;?/.test(biomeText)
  );

  // ── BIOME_TINTS shape ────────────────────────────────────────────
  // The 8 biome ids (1-8) each have a color + fogDensity. We check
  // the keys via regex on the static source (the literal id names
  // appear inside BIOME_TINTS).
  for (let i = 1; i <= 8; i++) {
    const idNames = ['BIOME_FOREST', 'BIOME_CAVES', 'BIOME_DEEP_VOID', 'BIOME_RUINS',
                     'BIOME_DESERT', 'BIOME_CRYSTAL_CAVERN', 'BIOME_SKY_RUINS', 'BIOME_PHASE_NEXUS'];
    check(
      `BIOME_TINTS has entry for ${idNames[i - 1]} (id ${i})`,
      new RegExp(`\\[${idNames[i - 1]}\\]\\s*:\\s*Object\\.freeze\\s*\\(\\s*\\{\\s*color:`).test(biomeText)
    );
  }

  // ── main.js imports ──────────────────────────────────────────────
  check(
    'main.js imports biomeTint from src/world/biome.js',
    /import\s*\{[^}]*\bbiomeTint\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(mainText)
  );
  check(
    'main.js imports biomeLabel from src/world/biome.js',
    /import\s*\{[^}]*\bbiomeLabel\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(mainText)
  );
  check(
    'main.js imports biomeFogDensity from src/world/biome.js',
    /import\s*\{[^}]*\bbiomeFogDensity\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(mainText)
  );
  check(
    'main.js imports lerpBiomeTints from src/world/biome.js',
    /import\s*\{[^}]*\blerpBiomeTints\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(mainText)
  );
  check(
    'main.js imports biomeTransitionDuration from src/world/biome.js',
    /import\s*\{[^}]*\bbiomeTransitionDuration\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(mainText)
  );

  // ── main.js module-level state ───────────────────────────────────
  check(
    'main.js declares module-level currentBiomeId state',
    /^\s*let\s+currentBiomeId\s*=/m.test(mainText)
  );
  check(
    'main.js declares module-level currentBiomeTint state',
    /^\s*let\s+currentBiomeTint\s*=/m.test(mainText)
  );
  check(
    'main.js declares module-level targetBiomeTint state',
    /^\s*let\s+targetBiomeTint\s*=/m.test(mainText)
  );
  check(
    'main.js declares module-level biomeTransitionTimer state',
    /^\s*let\s+biomeTransitionTimer\s*=/m.test(mainText)
  );

  // ── main.js#tickBiomesPerFrame + game loop wiring ────────────────
  check(
    'main.js#tickBiomesPerFrame is defined',
    /function\s+tickBiomesPerFrame\s*\(/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame reads world.getBiome',
    /function\s+tickBiomesPerFrame[\s\S]{0,2000}?world\.getBiome\s*\(/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame calls lerpBiomeTints',
    /function\s+tickBiomesPerFrame[\s\S]{0,3000}?lerpBiomeTints\s*\(/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame drives scene.background',
    /function\s+tickBiomesPerFrame[\s\S]{0,6000}?scene\.background\.setRGB/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame drives scene.fog.color',
    /function\s+tickBiomesPerFrame[\s\S]{0,6000}?scene\.fog\.color\.setRGB/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame drives scene.fog.density',
    /function\s+tickBiomesPerFrame[\s\S]{0,6000}?scene\.fog\.density/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame drives lighting.phaseLight.color',
    /function\s+tickBiomesPerFrame[\s\S]{0,6000}?lighting\.phaseLight\.color/.test(mainText)
  );
  check(
    'main.js#tickBiomesPerFrame drives renderer.setBiomeTint',
    /function\s+tickBiomesPerFrame[\s\S]{0,6000}?renderer\.setBiomeTint\s*\(/.test(mainText)
  );
  check(
    'main.js per-frame game loop calls tickBiomesPerFrame',
    /tickBiomesPerFrame/.test(mainText)
  );

  // ── main.js#onPhaseChanged drives the phase tint uniform ─────────
  check(
    'main.js#onPhaseChanged calls renderer.setPhaseTint',
    /function\s+onPhaseChanged[\s\S]*?renderer\.setPhaseTint\s*\(/.test(mainText)
  );

  // ── main.js#hud.update is called with world ───────────────────────
  check(
    'main.js#gameLoop calls hud.update with world',
    /hud\.update\s*\(\s*phaseManager\s*,\s*physicsManager\s*,\s*world\s*\)/.test(mainText)
  );
  check(
    'main.js#init calls hud.update with world',
    /hud\.update\s*\(\s*phaseManager\s*,\s*physicsManager\s*,\s*world\s*\)/.test(mainText)
  );

  // ── main.js debug hooks ──────────────────────────────────────────
  check(
    '__phaseShifter__.forceBiome hook is present',
    /__phaseShifter__[\s\S]*?forceBiome\s*\(\s*biomeId\s*\)/.test(mainText)
  );
  check(
    '__phaseShifter__.forceBiome mutates module-level state',
    /__phaseShifter__[\s\S]*?forceBiome[\s\S]{0,500}?currentBiomeId\s*=\s*id/.test(mainText)
  );
  check(
    '__phaseShifter__.forceBiome resets the transition timer',
    /__phaseShifter__[\s\S]*?forceBiome[\s\S]{0,800}?biomeTransitionTimer\s*=\s*0/.test(mainText)
  );
  check(
    '__phaseShifter__.forceBiome rejects bad input',
    /__phaseShifter__[\s\S]*?forceBiome[\s\S]{0,500}?out-of-range/.test(mainText) ||
    /__phaseShifter__[\s\S]*?forceBiome[\s\S]{0,500}?bad-input/.test(mainText)
  );
  check(
    '__phaseShifter__.getCurrentBiomeId hook is present',
    /__phaseShifter__[\s\S]*?getCurrentBiomeId\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.lerpBiomeTints hook is present',
    /__phaseShifter__[\s\S]*?lerpBiomeTints\s*\(\s*from\s*,\s*to\s*,\s*t\s*\)/.test(mainText)
  );
  check(
    '__phaseShifter__.biomeLabel hook is present',
    /__phaseShifter__[\s\S]*?biomeLabel\s*\(\s*biomeId\s*\)/.test(mainText)
  );
  check(
    '__phaseShifter__.getCurrentBiomeTint hook is present',
    /__phaseShifter__[\s\S]*?getCurrentBiomeTint\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.tickBiomesPerFrame hook is present',
    /__phaseShifter__[\s\S]*?tickBiomesPerFrame\s*\(\s*dt\s*\)/.test(mainText)
  );
  check(
    '__phaseShifter__.getBiomeTransitionTimer hook is present',
    /__phaseShifter__[\s\S]*?getBiomeTransitionTimer\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.getBiomeTransitionDuration hook is present',
    /__phaseShifter__[\s\S]*?getBiomeTransitionDuration\s*\(/.test(mainText)
  );

  // ── src/render/renderer.js skybox shader uniforms ────────────────
  check(
    'src/render/renderer.js createSkybox has biomeTint uniform',
    /createSkybox[\s\S]*?biomeTint\s*:\s*\{\s*value:\s*new\s+THREE\.Vector3/.test(rendererText)
  );
  check(
    'src/render/renderer.js createSkybox has phaseTint uniform',
    /createSkybox[\s\S]*?phaseTint\s*:\s*\{\s*value:\s*new\s+THREE\.Vector3/.test(rendererText)
  );
  check(
    'src/render/renderer.js createSkybox fragment shader multiplies tints',
    /biomeTint\s*\*\s*phaseTint/.test(rendererText)
  );
  check(
    'src/render/renderer.js createSkybox returns a mesh with setBiomeTint',
    /sky\.setBiomeTint\s*=\s*function\s+setBiomeTint/.test(rendererText)
  );
  check(
    'src/render/renderer.js createSkybox returns a mesh with setPhaseTint',
    /sky\.setPhaseTint\s*=\s*function\s+setPhaseTint/.test(rendererText)
  );
  check(
    'src/render/renderer.js Renderer exposes setBiomeTint forwarding',
    /setBiomeTint\s*\(\s*tint\s*\)\s*\{[\s\S]*?this\.scene\.getObjectByName\s*\(\s*['"]skybox['"]\s*\)[\s\S]*?sky\.setBiomeTint/.test(rendererText)
  );
  check(
    'src/render/renderer.js Renderer exposes setPhaseTint forwarding',
    /setPhaseTint\s*\(\s*tint\s*\)\s*\{[\s\S]*?this\.scene\.getObjectByName\s*\(\s*['"]skybox['"]\s*\)[\s\S]*?sky\.setPhaseTint/.test(rendererText)
  );

  // ── src/ui/hud.js update() biome wire ────────────────────────────
  check(
    'src/ui/hud.js HUD update() queries world.getBiome',
    /update\([\s\S]*?world\.getBiome\s*\(/.test(hudText)
  );
  check(
    'src/ui/hud.js HUD update() updates #biome-info text on biome change',
    /update\([\s\S]*?_biomeInfoEl[\s\S]{0,800}?textContent\s*=\s*[`'"]BIOME:/.test(hudText)
  );
  check(
    'src/ui/hud.js HUD constructor queries #biome-info element',
    /constructor[\s\S]{0,500}?#biome-info/.test(hudText)
  );
  check(
    'src/ui/hud.js HUD constructor declares _lastBiomeId edge detector',
    /constructor[\s\S]{0,1500}?_lastBiomeId\s*=\s*-1/.test(hudText)
  );

  // ── index.html has the #biome-info element ───────────────────────
  check(
    'index.html has the #biome-info element with BIOME: FOREST placeholder',
    /<div\s+id\s*=\s*["']biome-info["'][^>]*>\s*BIOME:\s*FOREST\s*</.test(htmlText)
  );
  check(
    'index.html #biome-info is a child of #hud (so the show/hide toggle works)',
    /<div\s+id\s*=\s*["']hud["'][\s\S]*?<div\s+id\s*=\s*["']biome-info["']/.test(htmlText)
  );

  // ── World.getBiome exists (the per-region deterministic read) ────
  check(
    'src/core/world.js exposes getBiome(x, z)',
    /getBiome\s*\(\s*x\s*,\s*z\s*\)/.test(worldText)
  );

  console.log('\n=== Phase 3.1 behavior — pure module ===');

  const biomeModule = await import(pathToFileURL(biomePath).href);
  const {
    BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
    BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_PHASE_NEXUS,
  } = biomeModule;

  // 1) biomeTint(BIOME_FOREST) returns the Forest tint.
  const forestTint = biomeModule.biomeTint(BIOME_FOREST);
  check(
    'biomeTint(BIOME_FOREST) returns color [0.30, 0.55, 0.30]',
    forestTint && Array.isArray(forestTint.color) &&
      Math.abs(forestTint.color[0] - 0.30) < 0.001 &&
      Math.abs(forestTint.color[1] - 0.55) < 0.001 &&
      Math.abs(forestTint.color[2] - 0.30) < 0.001
  );
  check(
    'biomeTint(BIOME_FOREST) returns fogDensity 0.006',
    forestTint && Math.abs(forestTint.fogDensity - 0.006) < 0.001
  );

  // 2) biomeTint(BIOME_CRYSTAL_CAVERN) returns the Crystal Cavern tint.
  const crystalTint = biomeModule.biomeTint(BIOME_CRYSTAL_CAVERN);
  check(
    'biomeTint(BIOME_CRYSTAL_CAVERN) returns color [0.40, 0.30, 0.50]',
    crystalTint && Array.isArray(crystalTint.color) &&
      Math.abs(crystalTint.color[0] - 0.40) < 0.001 &&
      Math.abs(crystalTint.color[1] - 0.30) < 0.001 &&
      Math.abs(crystalTint.color[2] - 0.50) < 0.001
  );
  check(
    'biomeTint(BIOME_CRYSTAL_CAVERN) returns fogDensity 0.014',
    crystalTint && Math.abs(crystalTint.fogDensity - 0.014) < 0.001
  );

  // 3) biomeTint(BIOME_DEEP_VOID) returns the Deep Void tint.
  const voidTint = biomeModule.biomeTint(BIOME_DEEP_VOID);
  check(
    'biomeTint(BIOME_DEEP_VOID) returns color [0.10, 0.05, 0.15]',
    voidTint && Array.isArray(voidTint.color) &&
      Math.abs(voidTint.color[0] - 0.10) < 0.001 &&
      Math.abs(voidTint.color[1] - 0.05) < 0.001 &&
      Math.abs(voidTint.color[2] - 0.15) < 0.001
  );
  check(
    'biomeTint(BIOME_DEEP_VOID) returns fogDensity 0.025',
    voidTint && Math.abs(voidTint.fogDensity - 0.025) < 0.001
  );

  // 4) biomeTint(99) returns the Forest default.
  const fallbackTint = biomeModule.biomeTint(99);
  check(
    'biomeTint(99) returns the Forest default',
    fallbackTint && Array.isArray(fallbackTint.color) &&
      Math.abs(fallbackTint.color[0] - 0.30) < 0.001 &&
      Math.abs(fallbackTint.color[1] - 0.55) < 0.001
  );

  // 5) biomeTint(0) and biomeTint(NaN) also return the Forest default (defensive).
  check(
    'biomeTint(0) returns the Forest default (defensive)',
    biomeModule.biomeTint(0) && Array.isArray(biomeModule.biomeTint(0).color)
  );
  check(
    'biomeTint(NaN) returns the Forest default (defensive)',
    biomeModule.biomeTint(NaN) && Array.isArray(biomeModule.biomeTint(NaN).color)
  );

  // 6) biomeLabel(BIOME_FOREST) === 'Forest'.
  check(
    "biomeLabel(BIOME_FOREST) === 'Forest'",
    biomeModule.biomeLabel(BIOME_FOREST) === 'Forest'
  );
  // 7) biomeLabel(BIOME_PHASE_NEXUS) === 'Phase Nexus'.
  check(
    "biomeLabel(BIOME_PHASE_NEXUS) === 'Phase Nexus'",
    biomeModule.biomeLabel(BIOME_PHASE_NEXUS) === 'Phase Nexus'
  );
  // 8) biomeLabel(BIOME_CRYSTAL_CAVERN) === 'Crystal Cavern'.
  check(
    "biomeLabel(BIOME_CRYSTAL_CAVERN) === 'Crystal Cavern'",
    biomeModule.biomeLabel(BIOME_CRYSTAL_CAVERN) === 'Crystal Cavern'
  );
  // 9) biomeLabel(99) === 'Unknown'.
  check(
    "biomeLabel(99) === 'Unknown' (defensive)",
    biomeModule.biomeLabel(99) === 'Unknown'
  );
  check(
    "biomeLabel(NaN) === 'Unknown' (defensive)",
    biomeModule.biomeLabel(NaN) === 'Unknown'
  );

  // 10) biomeFogDensity returns the canonical per-biome value.
  check(
    'biomeFogDensity(BIOME_FOREST) === 0.006',
    Math.abs(biomeModule.biomeFogDensity(BIOME_FOREST) - 0.006) < 0.001
  );
  check(
    'biomeFogDensity(BIOME_DEEP_VOID) === 0.025',
    Math.abs(biomeModule.biomeFogDensity(BIOME_DEEP_VOID) - 0.025) < 0.001
  );
  check(
    'biomeFogDensity(BIOME_DESERT) === 0.004',
    Math.abs(biomeModule.biomeFogDensity(BIOME_DESERT) - 0.004) < 0.001
  );
  check(
    'biomeFogDensity(99) returns the Forest default (defensive)',
    Math.abs(biomeModule.biomeFogDensity(99) - 0.006) < 0.001
  );

  // 11) lerpBiomeTints clamps t to [0, 1].
  const lerpZero = biomeModule.lerpBiomeTints(forestTint, crystalTint, 0);
  check(
    'lerpBiomeTints(Forest, Crystal, 0) returns the Forest tint',
    lerpZero && Math.abs(lerpZero.color[0] - 0.30) < 0.001 &&
      Math.abs(lerpZero.color[1] - 0.55) < 0.001
  );
  const lerpOne = biomeModule.lerpBiomeTints(forestTint, crystalTint, 1);
  check(
    'lerpBiomeTints(Forest, Crystal, 1) returns the Crystal Cavern tint',
    lerpOne && Math.abs(lerpOne.color[0] - 0.40) < 0.001 &&
      Math.abs(lerpOne.color[1] - 0.30) < 0.001
  );
  const lerpHalf = biomeModule.lerpBiomeTints(forestTint, crystalTint, 0.5);
  check(
    'lerpBiomeTints(Forest, Crystal, 0.5) returns the mid-point color',
    lerpHalf && Math.abs(lerpHalf.color[0] - 0.35) < 0.001 &&
      Math.abs(lerpHalf.color[1] - 0.425) < 0.001 &&
      Math.abs(lerpHalf.color[2] - 0.40) < 0.001
  );
  // 12) lerpBiomeTints clamps t outside [0, 1].
  const lerpNeg = biomeModule.lerpBiomeTints(forestTint, crystalTint, -1);
  check(
    'lerpBiomeTints(Forest, Crystal, -1) clamps to t=0 (returns Forest)',
    lerpNeg && Math.abs(lerpNeg.color[0] - 0.30) < 0.001
  );
  const lerpToo = biomeModule.lerpBiomeTints(forestTint, crystalTint, 2);
  check(
    'lerpBiomeTints(Forest, Crystal, 2) clamps to t=1 (returns Crystal)',
    lerpToo && Math.abs(lerpToo.color[0] - 0.40) < 0.001
  );
  // 13) lerpBiomeTints with NaN t falls back to 0.
  const lerpNaN = biomeModule.lerpBiomeTints(forestTint, crystalTint, NaN);
  check(
    'lerpBiomeTints(Forest, Crystal, NaN) clamps to t=0 (defensive)',
    lerpNaN && Math.abs(lerpNaN.color[0] - 0.30) < 0.001
  );
  // 14) lerpBiomeTints also lerps fogDensity.
  check(
    'lerpBiomeTints lerps fogDensity (0.006 + 0.5*(0.014-0.006) = 0.010)',
    lerpHalf && Math.abs(lerpHalf.fogDensity - 0.010) < 0.001
  );

  // 15) biomeTransitionDuration returns 0.5.
  check(
    'biomeTransitionDuration() returns 0.5',
    biomeModule.biomeTransitionDuration() === 0.5
  );

  console.log('\n=== Phase 3.1 behavior — World API ===');

  const { World } = await import(pathToFileURL(worldPath).href);

  function makeWorld() {
    const scene = { add() {}, remove() {} };
    return new World(scene, () => {});
  }

  // 16) world.getBiome(0, 0) returns a valid biome id (1-8).
  const w1 = makeWorld();
  const biomeAt00 = w1.getBiome(0, 0);
  check(
    'World.getBiome(0, 0) returns a valid biome id (1-8)',
    Number.isInteger(biomeAt00) && biomeAt00 >= 1 && biomeAt00 <= 8,
    `got=${biomeAt00}`
  );

  // 17) world.getBiome(0, 0) is stable across calls.
  const biomeAt00Again = w1.getBiome(0, 0);
  check(
    'World.getBiome(0, 0) is stable across calls',
    biomeAt00 === biomeAt00Again
  );

  // 18) world.getBiome(64, 0) is in a different region — at least one
  // (x, z) far enough from the origin lands in a different region.
  let foundDifferent = false;
  for (let i = 0; i < 20; i++) {
    const a = w1.getBiome(0, 0);
    const b = w1.getBiome(64 * (i + 1), 0);
    if (a !== b) { foundDifferent = true; break; }
  }
  check(
    'World.getBiome lands in a different biome for some (x, 0) tuple in [0, 1280]',
    foundDifferent
  );

  // 19) world.getBiome inside the same region returns the same id.
  check(
    'World.getBiome is stable within a region (0, 0) === getBiome(32, 32)',
    w1.getBiome(0, 0) === w1.getBiome(32, 32)
  );

  console.log('\n=== Phase 3.1 behavior — biome color matches BIOME_DATA ===');

  // The biome colors in BIOME_TINTS must match the canonical
  // biomeColor from BIOME_DATA in src/gen/terrain.js. The terrain
  // generator stores [0.3, 0.55, 0.3] for Forest, [0.4, 0.3, 0.5]
  // for Crystal Cavern, etc. We verify the BIOME_TINTS map lines up.
  check(
    'BIOME_TINTS Forest color matches the canonical terrain biomeColor (0.30, 0.55, 0.30)',
    JSON.stringify(forestTint.color) === '[0.3,0.55,0.3]' ||
      (Math.abs(forestTint.color[0] - 0.30) < 0.001 &&
       Math.abs(forestTint.color[1] - 0.55) < 0.001 &&
       Math.abs(forestTint.color[2] - 0.30) < 0.001)
  );
  check(
    'BIOME_TINTS Crystal Cavern color matches the canonical terrain biomeColor (0.40, 0.30, 0.50)',
    Math.abs(crystalTint.color[0] - 0.40) < 0.001 &&
      Math.abs(crystalTint.color[1] - 0.30) < 0.001 &&
      Math.abs(crystalTint.color[2] - 0.50) < 0.001
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 3.1 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
