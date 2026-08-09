#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 2.1 verification: phase shift is fully wired end-to-end.
//
//   1) Static-analysis — the pieces exist:
//        - audioManager.playShift(phase) defined in src/audio/manager.js
//        - post-processing exposes setPhase(phase) (or updatePhase) on the
//          handle returned by setupPostProcessing
//        - src/core/phase.js#cyclePhase early-returns when _isShifting
//        - #phase-indicator dot exists in index.html and is wired in main.js
//        - main.js#onPhaseChanged drives postProcessing.setPhase
//        - main.js drives the #phase-shift-overlay background
//   2) Behavior — PhaseManager:
//        - two cyclePhase() calls in one tick produce exactly one shift
//          and consume PHASE_SHIFT_COST once
//        - completeShift() flips currentPhase to targetPhase and clears
//          _isShifting, freeing subsequent cycles
//
// All static checks are against source files (not the Vite-minified
// bundle). Same pattern as Phases 1.2–1.7.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const audioPath = path.join(ROOT, 'src', 'audio', 'manager.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const phasePath = path.join(ROOT, 'src', 'core', 'phase.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const htmlPath = path.join(ROOT, 'index.html');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');

const mainText = fs.readFileSync(mainPath, 'utf8');
const audioText = fs.readFileSync(audioPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const phaseText = fs.readFileSync(phasePath, 'utf8');
const hudText = fs.readFileSync(hudPath, 'utf8');
const htmlText = fs.readFileSync(htmlPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 2.1 source checks ===');
  // Audio: AudioManager has a playShift(phase) method.
  check(
    'AudioManager.playShift(phase) is defined in src/audio/manager.js',
    /playShift\s*\(\s*phase\s*\)/.test(audioText)
  );
  // Post-processing: setupPostProcessing returns an object with a
  // setPhase or updatePhase method that drives the uPhase uniform.
  check(
    'setupPostProcessing exposes setPhase(phase) alias on its handle',
    /setPhase\s*\(\s*phase\s*\)\s*\{[\s\S]*?phasePass\.uniforms\.uPhase\.value\s*=\s*phase/.test(rendererText)
  );
  check(
    'setupPostProcessing exposes updatePhase(phase, resonating) on its handle',
    /updatePhase\s*\(\s*phase\s*,\s*resonating\s*\)[\s\S]*?uPhase\.value\s*=\s*phase/.test(rendererText)
  );
  // PhaseManager: cyclePhase early-returns when _isShifting.
  check(
    'PhaseManager.cyclePhase early-returns while _isShifting',
    /if\s*\(\s*this\._isShifting\s*\|\|\s*this\._energy\s*<\s*PHASE_SHIFT_COST\s*\)\s*\{\s*return\s+false\s*;?\s*\}/.test(phaseText)
  );
  // HTML: phase indicator + overlay are present.
  check(
    'index.html declares #phase-indicator',
    /id\s*=\s*["']phase-indicator["']/.test(htmlText)
  );
  check(
    'index.html declares #phase-shift-overlay (visible ~1.5s color pulse)',
    /id\s*=\s*["']phase-shift-overlay["']/.test(htmlText)
  );
  // main.js: onPhaseChanged drives the indicator and the post-FX uniform.
  check(
    'main.js#onPhaseChanged updates #phase-indicator backgroundColor',
    /phaseIndicatorEl\.style\.backgroundColor/.test(mainText) ||
      /phase-indicator["'][\s\S]{0,400}?style\.backgroundColor/.test(mainText)
  );
  check(
    'main.js#onPhaseChanged calls postProcessing.setPhase(phase)',
    /postProcessing\.setPhase\s*\(\s*phase\s*\)/.test(mainText)
  );
  check(
    'main.js drives #phase-shift-overlay background per frame',
    /updatePhaseShiftOverlay\s*\(/.test(mainText) &&
      /phase-shift-overlay["']/.test(mainText) &&
      /getPhaseShiftProgress\s*\(/.test(mainText)
  );
  // HUD also drives the indicator (covers the case where onPhaseChanged
  // doesn't fire but the manager's state changes via setPhase).
  check(
    'src/ui/hud.js updates #phase-indicator backgroundColor',
    /(?:phase-indicator|phaseIndicator)[\s\S]{0,400}?style\.backgroundColor/.test(hudText)
  );
  // Don't break the Playwright forceCyclePhase debug hook.
  check(
    'main.js still exposes __phaseShifter__.forceCyclePhase',
    /__phaseShifter__[\s\S]*?forceCyclePhase\s*\(/.test(mainText)
  );
  // contextmenu listener still calls cyclePhase and preventDefault.
  check(
    'main.js right-click handler still calls e.preventDefault() + cyclePhase',
    /addEventListener\(\s*['"]contextmenu['"][\s\S]*?e\.preventDefault\(\)[\s\S]{0,400}?cyclePhase\s*\(\s*\)/.test(mainText)
  );

  console.log('\n=== Phase 2.1 behavior ===');
  // Spin up a PhaseManager in isolation and exercise the spam guard.
  const { PhaseManager } = await import(pathToFileURL(phasePath).href);
  const { PHASE_SHIFT_COST } = await import(pathToFileURL(constantsPath).href);

  const pm = new PhaseManager();
  const startEnergy = pm.getEnergy();
  const startPhase = pm.getCurrentPhase();

  // Two cyclePhase calls in the same tick: the first should succeed,
  // the second must be ignored because _isShifting is true.
  const first = pm.cyclePhase();
  const second = pm.cyclePhase();
  check('cyclePhase() returns true on first call while idle', first === true);
  check('cyclePhase() returns false on second call while shifting', second === false);
  check(
    'PhaseManager consumed PHASE_SHIFT_COST exactly once across two calls',
    pm.getEnergy() === startEnergy - PHASE_SHIFT_COST,
    `start=${startEnergy} now=${pm.getEnergy()} cost=${PHASE_SHIFT_COST}`
  );
  check(
    'PhaseManager.currentPhase unchanged (still mid-shift)',
    pm.getCurrentPhase() === startPhase
  );
  check(
    'PhaseManager.targetPhase is the next phase (shift started)',
    pm.getTargetPhase() === (startPhase + 1) % 3
  );
  check('PhaseManager.isShifting is true after a successful cycle', pm.isShifting === true);

  // Add a listener and confirm a third call also returns false while
  // still mid-shift (multiple spam clicks).
  const third = pm.cyclePhase();
  check('cyclePhase() returns false on third call while still shifting', third === false);
  check(
    'Energy still unchanged after a third call while shifting',
    pm.getEnergy() === startEnergy - PHASE_SHIFT_COST
  );

  // Force-complete the shift and confirm normal cycling resumes.
  let listenerCalls = 0;
  pm.addListener(() => { listenerCalls += 1; });
  pm.completeShift();
  check('completeShift() advances currentPhase to targetPhase', pm.getCurrentPhase() === (startPhase + 1) % 3);
  check('completeShift() clears _isShifting', pm.isShifting === false);
  check('completeShift() notifies listeners', listenerCalls >= 1, `calls=${listenerCalls}`);

  // After completion, cyclePhase should work again.
  const after = pm.cyclePhase();
  check('cyclePhase() works again after completeShift()', after === true);
  check(
    'Energy has been decremented twice (initial cycle + post-complete cycle)',
    pm.getEnergy() === startEnergy - (PHASE_SHIFT_COST * 2),
    `start=${startEnergy} now=${pm.getEnergy()}`
  );

  // Insufficient-energy guard: drain energy to below PHASE_SHIFT_COST and
  // confirm cyclePhase returns false (already implemented, but we lock it
  // in with a regression test).
  pm.setEnergy(1);
  const drained = pm.cyclePhase();
  check('cyclePhase() returns false when energy < PHASE_SHIFT_COST', drained === false);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 2.1 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
