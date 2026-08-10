#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 8 — Polish + community.
//
// §8.1 Tutorial skip: clearTutorialAndHidePure returns the right shape
//     and is a no-op when the tutorial is already inactive.
// §8.2 Post-collapse invuln: startInvuln / tickInvuln / isInvulnActive
//     / getInvulnRemaining have the right contract.
// §8.3 Audio restart: forceAudioRestart is callable but requires
//     audioManager; the integration is in main.js.
// §8.4 Settings reset: defaultSettings() returns the canonical 11
//     defaults; main.js wires the settingsReset handler.
// §8.5 Compass distance: integration in main.js (setCompassDistance).
// §8.6 Tutorial re-enter: integration in main.js (tickTutorialPerFrame).
// §8.7 Footstep volume: footstepVolumeForDensity + countNeighbors
//     pure helpers.
// §8.8 KNOWN_ISSUES cleanup: doc-level change, not a code test.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const collapsePath = path.join(ROOT, 'src', 'collapse', 'collapse.js');
const footstepsPath = path.join(ROOT, 'src', 'audio', 'footsteps.js');
const tutorialPath = path.join(ROOT, 'src', 'tutorial', 'tutorial.js');
const settingsPath = path.join(ROOT, 'src', 'settings', 'menu.js');
const mainPath = path.join(ROOT, 'main.js');
const indexPath = path.join(ROOT, 'index.html');
const knownIssuesPath = path.join(ROOT, 'KNOWN_ISSUES.md');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}

async function main() {
  const collapseMod = await import('file://' + collapsePath.replace(/\\/g, '/'));
  const footstepsMod = await import('file://' + footstepsPath.replace(/\\/g, '/'));
  const tutorialMod = await import('file://' + tutorialPath.replace(/\\/g, '/'));
  const settingsMod = await import('file://' + settingsPath.replace(/\\/g, '/'));

  const mainText = fs.readFileSync(mainPath, 'utf8');
  const indexText = fs.readFileSync(indexPath, 'utf8');
  const knownText = fs.readFileSync(knownIssuesPath, 'utf8');

  // ── §8.1 Tutorial skip ─────────────────────────────────────
  console.log('\n=== §8.1 Tutorial skip ===');
  check('tutorial.js exports clearTutorialAndHide',
    typeof tutorialMod.clearTutorialAndHide === 'function');
  const active = tutorialMod.createTutorialState();
  // Force active state directly (no time source).
  active.active = true;
  active.elapsed = 10;
  active.currentHint = 1;
  const r1 = tutorialMod.clearTutorialAndHide(active);
  check('clearTutorialAndHide on active state returns ok=true', r1.ok === true);
  check('clearTutorialAndHide on active state returns reason=skipped', r1.reason === 'skipped');
  check('clearTutorialAndHide mutates state to inactive', active.active === false);
  const r2 = tutorialMod.clearTutorialAndHide(tutorialMod.createTutorialState());
  check('clearTutorialAndHide on inactive state returns ok=false', r2.ok === false);
  check('clearTutorialAndHide on inactive state returns reason=inactive', r2.reason === 'inactive');
  check('main.js wires skipTutorial debug hook',
    /skipTutorial\s*\(\s*\)\s*\{/.test(mainText) || /skipTutorial\s*:\s*function/.test(mainText) || /skipTutorial\s*\(/.test(mainText));
  check('main.js wires the skip button click handler',
    /tutorial-skip-btn[\s\S]{0,200}?addEventListener\s*\(\s*['"]click['"]/.test(mainText));

  // ── §8.2 Post-collapse invuln ──────────────────────────────
  console.log('\n=== §8.2 Post-collapse invuln ===');
  check('collapse.js exports POST_COLLAPSE_INVULN_DURATION = 5.0',
    collapseMod.POST_COLLAPSE_INVULN_DURATION === 5.0);
  check('collapse.js exports createInvulnState',
    typeof collapseMod.createInvulnState === 'function');
  const inv = collapseMod.createInvulnState();
  check('createInvulnState returns active=false', inv.active === false);
  check('createInvulnState returns remaining=0', inv.remaining === 0);
  check('collapse.js exports startInvuln', typeof collapseMod.startInvuln === 'function');
  collapseMod.startInvuln(inv);
  check('startInvuln sets active=true', inv.active === true);
  check('startInvuln sets remaining=5.0', inv.remaining === 5.0);
  check('collapse.js exports tickInvuln', typeof collapseMod.tickInvuln === 'function');
  collapseMod.tickInvuln(inv, 1.0);
  check('tickInvuln decrements remaining by dt (clamped to 0.1)', Math.abs(inv.remaining - 4.9) < 0.001);
  check('collapse.js exports isInvulnActive', typeof collapseMod.isInvulnActive === 'function');
  check('isInvulnActive is true after startInvuln', collapseMod.isInvulnActive(inv) === true);
  check('collapse.js exports getInvulnRemaining', typeof collapseMod.getInvulnRemaining === 'function');
  check('getInvulnRemaining returns the timer', Math.abs(collapseMod.getInvulnRemaining(inv) - 4.9) < 0.001);
  // Tick 49 more times to fully deplete the 4.9 remaining
  for (let i = 0; i < 50; i++) collapseMod.tickInvuln(inv, 1.0);
  check('tickInvuln deactivates when remaining <= 0', inv.active === false);
  check('tickInvuln clamps remaining to 0', inv.remaining === 0);
  check('isInvulnActive is false after expiry', collapseMod.isInvulnActive(inv) === false);
  check('main.js wires the invuln check in forcePhaseCollapse',
    /isInvulnActive\s*\(\s*invulnState\s*\)/.test(mainText));
  // Also check the second forcePhaseCollapse-like path has the invuln guard
  check('main.js has at least 2 invulnState references',
    (mainText.match(/invulnState/g) || []).length >= 4);
  check('main.js wires tickInvulnPerFrame in the game loop',
    /tickInvulnPerFrame\s*\(\s*deltaTime\s*\)/.test(mainText));
  // The tickInvulnPerFrame function should be defined
  check('main.js defines tickInvulnPerFrame',
    /function\s+tickInvulnPerFrame\s*\(/.test(mainText));

  // ── §8.3 Audio restart ─────────────────────────────────────
  console.log('\n=== §8.3 Audio restart ===');
  check('main.js has visibilitychange listener',
    /document\.addEventListener\s*\(\s*['"]visibilitychange['"]/.test(mainText));
  check('main.js visibilitychange handler calls startAmbientMusic',
    /visibilitychange[\s\S]{0,500}?startAmbientMusic/.test(mainText));
  check('main.js exposes forceAudioRestart debug hook',
    /forceAudioRestart\s*\(\s*\)\s*\{/.test(mainText) || /forceAudioRestart\s*:\s*function/.test(mainText));

  // ── §8.4 Settings reset ────────────────────────────────────
  console.log('\n=== §8.4 Settings reset ===');
  check('settings/menu.js exports defaultSettings',
    typeof settingsMod.defaultSettings === 'function');
  const defaults = settingsMod.defaultSettings();
  check('defaultSettings returns 11 keys',
    Object.keys(defaults).length === 11);
  check('defaultSettings resolutionScale = 1.0', defaults.resolutionScale === 1.0);
  check('defaultSettings renderDistance = 3', defaults.renderDistance === 3);
  check('defaultSettings masterVolume = 0.5', defaults.masterVolume === 0.5);
  check('defaultSettings musicVolume = 0.3', defaults.musicVolume === 0.3);
  check('defaultSettings sfxVolume = 0.4', defaults.sfxVolume === 0.4);
  check('defaultSettings hudOpacity = 1.0', defaults.hudOpacity === 1.0);
  check('defaultSettings autosave = true', defaults.autosave === true);
  check('defaultSettings postProcessing = true', defaults.postProcessing === true);
  check('defaultSettings reducedMotion = false', defaults.reducedMotion === false);
  check('defaultSettings has keyBindings object', typeof defaults.keyBindings === 'object');
  check('main.js handles settingsReset key',
    /key\s*===\s*['"]settingsReset['"]/.test(mainText));
  check('main.js settingsReset calls settings.setAll',
    /settingsReset[\s\S]{0,500}?settings\.setAll\s*\(\s*defaults\s*\)/.test(mainText));

  // ── §8.5 Compass distance ──────────────────────────────────
  console.log('\n=== §8.5 Compass distance ===');
  check('index.html has #compass-distance element',
    /id\s*=\s*["']compass-distance["']/.test(indexText));
  check('hud.js has setCompassDistance method',
    /setCompassDistance\s*\(\s*distanceBlocks\s*,\s*inRange\s*\)/.test(
      fs.readFileSync(path.join(ROOT, 'src', 'ui', 'hud.js'), 'utf8')));
  check('main.js tickGoalsPerFrame drives setCompassDistance',
    /hud\.setCompassDistance\s*\(\s*distBlocks\s*,\s*inRange\s*\)/.test(mainText));

  // ── §8.6 Tutorial re-enter ─────────────────────────────────
  console.log('\n=== §8.6 Tutorial re-enter ===');
  check('tutorial.js exports isWithinTutorialRing',
    typeof tutorialMod.isWithinTutorialRing === 'function');
  check('main.js tracks wasInTutorialRing',
    /wasInTutorialRing/.test(mainText));
  check('main.js tickTutorialPerFrame checks ring re-enter',
    /tickTutorialPerFrame[\s\S]{0,1500}?isWithinTutorialRing/.test(mainText));
  check('index.html has #tutorial-skip-btn',
    /id\s*=\s*["']tutorial-skip-btn["']/.test(indexText) || /#tutorial-skip-btn/.test(indexText));

  // ── §8.7 Footstep density ──────────────────────────────────
  console.log('\n=== §8.7 Footstep density ===');
  check('footsteps.js exports footstepVolumeForDensity',
    typeof footstepsMod.footstepVolumeForDensity === 'function');
  check('footsteps.js exports countNeighbors',
    typeof footstepsMod.countNeighbors === 'function');
  check('footstepVolumeForDensity(0) = 0.5', Math.abs(footstepsMod.footstepVolumeForDensity(0) - 0.5) < 0.001);
  check('footstepVolumeForDensity(4) = 0.75', Math.abs(footstepsMod.footstepVolumeForDensity(4) - 0.75) < 0.001);
  check('footstepVolumeForDensity(8) = 1.0', Math.abs(footstepsMod.footstepVolumeForDensity(8) - 1.0) < 0.001);
  check('footstepVolumeForDensity(16, 8) clamps to 1.0',
    Math.abs(footstepsMod.footstepVolumeForDensity(16, 8) - 1.0) < 0.001);
  check('footstepVolumeForDensity(-5, 8) clamps to 0.5',
    Math.abs(footstepsMod.footstepVolumeForDensity(-5, 8) - 0.5) < 0.001);
  // countNeighbors with a stub world
  const stubWorld = {
    getBlock: (x, y, z) => {
      // AIR outside the central cell; STONE inside.
      if (x === 0 && z === 0) return 1; // BLOCK_STONE
      return 0; // BLOCK_AIR
    },
  };
  check('countNeighbors returns 0 with all-AIR neighbors',
    footstepsMod.countNeighbors(stubWorld, 0, 0, 0, 0) === 0);
  const stubWorld2 = {
    getBlock: (x, y, z) => 1, // always STONE
  };
  check('countNeighbors returns 8 with all-STONE neighbors',
    footstepsMod.countNeighbors(stubWorld2, 0, 0, 0, 0) === 8);
  check('countNeighbors returns 0 for null world',
    footstepsMod.countNeighbors(null, 0, 0, 0, 0) === 0);
  check('countNeighbors returns 0 for world without getBlock',
    footstepsMod.countNeighbors({}, 0, 0, 0, 0) === 0);
  check('main.js footstep tick uses footstepVolumeForDensity',
    /footstepVolumeForDensity\s*\(\s*neighborCount\s*,\s*8\s*\)/.test(mainText));

  // ── §8.8 KNOWN_ISSUES cleanup ──────────────────────────────
  console.log('\n=== §8.8 KNOWN_ISSUES cleanup ===');
  // The "Quit to Title is a refresh" item should be removed (or marked resolved).
  const hasStaleQuitItem = /Quit to Title.{0,40}refresh/i.test(knownText);
  check('KNOWN_ISSUES no longer lists the stale Quit to Title item', !hasStaleQuitItem);

  console.log(`\n=== Phase 8 TOTAL: ${passed}/${passed + failed} passed ===`);
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
