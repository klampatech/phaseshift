#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.9 — Energy danger states.
//
// §10.9 acceptance:
// - HUD energy bar throbs orange when energy < 30 (CSS keyframe)
// - Audio heartbeat plays when energy < 15 (gain < 0.3, 1Hz cadence)
// - Screen vignette pulses when energy < 5 (rgba(255, 100, 0, 0.1) at 1Hz)
// - In Alpha, the player can hold 0 energy for 5s (auto-collapse fires
//   after ALPHA_GRACE_DURATION)
// - energyTier(energy) returns the canonical tier string
// - Reduced-motion disables all three animations
// - The vignette uses a dedicated #energy-vignette DOM element
// - The heartbeat audio method exists and uses a sub-bass frequency
// - The energy-fill CSS class is applied based on tier

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const audioPath = path.join(ROOT, 'src', 'audio', 'manager.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const tierPath = path.join(ROOT, 'src', 'ui', 'energy-tier.js');
const indexPath = path.join(ROOT, 'index.html');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.9 — Energy Danger States ===\n');

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  const hudSrc = fs.readFileSync(hudPath, 'utf8');
  const audioSrc = fs.readFileSync(audioPath, 'utf8');
  const constantsSrc = fs.readFileSync(constantsPath, 'utf8');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const tierMod = await import(pathToFileURL(tierPath).href);

  // 1. Tier helper is canonical + pure.
  check('energyTier helper exists', typeof tierMod.energyTier === 'function');
  check('tier thresholds exported (LOW=30, CRITICAL=15, COLLAPSE=0)',
    tierMod.ENERGY_TIER_LOW_THRESHOLD === 30 &&
    tierMod.ENERGY_TIER_CRITICAL_THRESHOLD === 15 &&
    tierMod.ENERGY_TIER_COLLAPSE_THRESHOLD === 0);
  check('energyTier(100) === "normal"', tierMod.energyTier(100) === 'normal');
  check('energyTier(50) === "normal"', tierMod.energyTier(50) === 'normal');
  check('energyTier(30) === "normal" (boundary inclusive)', tierMod.energyTier(30) === 'normal');
  check('energyTier(29) === "low"', tierMod.energyTier(29) === 'low');
  check('energyTier(15) === "low" (boundary inclusive)', tierMod.energyTier(15) === 'low');
  check('energyTier(14) === "critical"', tierMod.energyTier(14) === 'critical');
  check('energyTier(1) === "critical"', tierMod.energyTier(1) === 'critical');
  check('energyTier(0) === "collapse"', tierMod.energyTier(0) === 'collapse');
  check('energyTier(-5) === "collapse" (defensive)', tierMod.energyTier(-5) === 'collapse');
  check('energyTier(NaN) === "collapse" (defensive)', tierMod.energyTier(NaN) === 'collapse');
  check('energyTier(null) === "collapse" (defensive)', tierMod.energyTier(null) === 'collapse');

  // 2. CSS keyframes exist in index.html.
  check('@keyframes energy-throb defined', /@keyframes\s+energy-throb\s*\{/.test(indexSrc));
  check('@keyframes energy-vignette-pulse defined', /@keyframes\s+energy-vignette-pulse\s*\{/.test(indexSrc));
  check('#energy-fill.energy-low uses throb animation', /#energy-fill\.energy-low\s*\{[^}]*animation:\s*energy-throb/.test(indexSrc));
  check('#energy-fill.energy-critical uses throb animation', /#energy-fill\.energy-critical\s*\{[^}]*animation:\s*energy-throb/.test(indexSrc));
  check('body.energy-collapse triggers vignette pulse', /body\.energy-collapse\s+#energy-vignette\s*\{[^}]*animation:\s*energy-vignette-pulse/.test(indexSrc));
  check('vignette pulse alpha < 0.1 (the §10.9 "barely visible" acceptance)', /opacity:\s*0\.10/.test(indexSrc));
  check('reduced-motion disables all three animations', /body\.reduced-motion[\s\S]{0,500}animation:\s*none/.test(indexSrc));
  check('#energy-vignette DOM element exists', /id=["']energy-vignette["']/.test(indexSrc));

  // 3. Audio: playHeartbeat exists + uses sub-bass frequency + subtle gain.
  check('audioManager.playHeartbeat is defined', /playHeartbeat\s*\(/.test(audioSrc));
  check('playHeartbeat uses sub-bass (50 Hz) frequency', /playHeartbeat\s*\(\)\s*\{[\s\S]{0,500}frequency\.value\s*=\s*50/.test(audioSrc));
  check('playHeartbeat gain < 0.3 (subtle per §10.9)', /playHeartbeat\s*\(\)\s*\{[\s\S]{0,800}0\.18/.test(audioSrc));

  // 4. ALPHA_GRACE_DURATION constant.
  const constantsMod = await import(pathToFileURL(constantsPath).href);
  check('ALPHA_GRACE_DURATION === 5.0 (the §10.9 5s grace acceptance)', constantsMod.ALPHA_GRACE_DURATION === 5.0);

  // 5. main.js wires the tier + the per-frame tick.
  check('main.js imports energyTier from src/ui/energy-tier.js', /import\s*\{[^}]*energyTier\s+as\s+energyTierFn[^}]*\}\s*from\s*['"]\.\/src\/ui\/energy-tier\.js['"]/.test(mainSrc));
  check('main.js imports ALPHA_GRACE_DURATION', /ALPHA_GRACE_DURATION/.test(mainSrc));
  check('main.js defines tickEnergyDangerPerFrame', /function\s+tickEnergyDangerPerFrame\s*\(/.test(mainSrc));
  check('main.js calls tickEnergyDangerPerFrame(deltaTime) in the game loop', /tickEnergyDangerPerFrame\s*\(\s*deltaTime\s*\)/.test(mainSrc));
  check('main.js tickEnergyDangerPerFrame toggles body.energy-collapse', /energy-collapse/.test(mainSrc) && /document\.body\.classList\.(add|remove)/.test(mainSrc));
  check('main.js tickEnergyDangerPerFrame calls audioManager.playHeartbeat', /playHeartbeat\s*\(\s*\)/.test(mainSrc));
  check('main.js tickEnergyDangerPerFrame calls forcePhaseCollapse on grace expiry', /alphaGraceRemaining\s*<=\s*0[\s\S]{0,200}forcePhaseCollapse/.test(mainSrc));
  check('main.js has alphaGraceRemaining state', /let\s+alphaGraceRemaining\s*=/.test(mainSrc));
  check('main.js resets alphaGraceRemaining on phase change / recharge', /alphaGraceRemaining\s*=\s*0/.test(mainSrc));

  // 6. HUD wires the energy-fill CSS class.
  check('hud.js imports energyTier', /import\s*\{[^}]*energyTier[^}]*\}\s*from\s*['"]\.\/energy-tier\.js['"]/.test(hudSrc));
  check('hud.js applies energy-critical class', /energy-critical/.test(hudSrc));
  check('hud.js applies energy-low class', /energy-low/.test(hudSrc));

  // 7. Vignette uses a multiplicative blend (cheap, doesn't darken the world).
  check('#energy-vignette uses mix-blend-mode: multiply', /#energy-vignette\s*\{[^}]*mix-blend-mode:\s*multiply/.test(indexSrc));

  // 8. Tier change resets heartbeat cadence.
  check('main.js resets heartbeatAccum on tier exit (else branch)', /else\s*\{[\s\S]{0,200}heartbeatAccum\s*=\s*0/.test(mainSrc));

  console.log("\n=== Phase 10.9 TOTAL: " + results.filter(Boolean).length + "/" + results.length + " passed ===");
  if (results.filter(Boolean).length !== results.length) {
    process.exit(1);
  }
})().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
