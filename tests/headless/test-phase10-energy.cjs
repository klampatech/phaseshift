#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.1 — Energy economy rebalance.
//
// §10.1 acceptance:
// - PHASE_SHIFT_COST = 15 (was 5)
// - PHASE_REGEN_RATE_ALPHA = 2.0 (was 0.5)
// - PHASE_DRAIN_RATE_BETA = 0.5 (was 0.2)
// - PHASE_DRAIN_RATE_GAMMA = 1.0 (was 0.4)
// - The `dt * 60` multiplier is removed from phaseManager.update()
// - PhaseManager is now real-time: regen/drain in per-real-second values
// - Amplifiers reduce the shift cost by AMPLIFIER_SHIFT_REDUCTION (1.5 per)
// - README updated to match the new numbers
// - All previous tests still pass

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const phasePath = path.join(ROOT, 'src', 'core', 'phase.js');
const mainPath = path.join(ROOT, 'main.js');
const readmePath = path.join(ROOT, 'README.md');

const constantsText = fs.readFileSync(constantsPath, 'utf8');
const phaseText = fs.readFileSync(phasePath, 'utf8');
const mainText = fs.readFileSync(mainPath, 'utf8');
const readmeText = fs.readFileSync(readmePath, 'utf8');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.1 — Energy economy rebalance ===\n');

  // 1. Constants — the new values exist.
  check('PHASE_SHIFT_COST = 15 (was 5)',
    /export const PHASE_SHIFT_COST = 15;/.test(constantsText));
  check('PHASE_REGEN_RATE_ALPHA = 2.0 (was 0.5)',
    /export const PHASE_REGEN_RATE_ALPHA = 2\.0;/.test(constantsText));
  check('PHASE_DRAIN_RATE_BETA = 0.5 (was unset / 0.2)',
    /export const PHASE_DRAIN_RATE_BETA = 0\.5;/.test(constantsText));
  check('PHASE_DRAIN_RATE_GAMMA = 1.0 (was unset / 0.4)',
    /export const PHASE_DRAIN_RATE_GAMMA = 1\.0;/.test(constantsText));

  // 2. phase.js — the `dt * 60` multiplier is gone in the regen path.
  const hasDt60 = /this\._energy\s*=\s*Math\.min\(MAX_ENERGY,\s*this\._energy\s*\+\s*this\._energyRegenRate\s*\*\s*dt\s*\*\s*60\)/.test(phaseText);
  check('phaseManager.update() no longer multiplies by dt * 60 (regen path)',
    !hasDt60);
  const hasAlphaDt60 = /this\._energy\s*=\s*Math\.min\(MAX_ENERGY,\s*this\._energy\s*\+\s*this\._alphaRegenRate\s*\*\s*dt\s*\*\s*60\)/.test(phaseText);
  check('phaseManager.update() no longer multiplies by dt * 60 (alpha regen path)',
    !hasAlphaDt60);

  // 3. phase.js — the new per-second drain is in place.
  check('phaseManager.update() references PHASE_DRAIN_RATE_BETA',
    /PHASE_DRAIN_RATE_BETA/.test(phaseText));
  check('phaseManager.update() references PHASE_DRAIN_RATE_GAMMA',
    /PHASE_DRAIN_RATE_GAMMA/.test(phaseText));

  // 4. Import the constants module and assert the canonical values.
  const constantsMod = await import(pathToFileURL(constantsPath).href);
  check('constants.PHASE_SHIFT_COST === 15', constantsMod.PHASE_SHIFT_COST === 15);
  check('constants.PHASE_REGEN_RATE_ALPHA === 2.0', constantsMod.PHASE_REGEN_RATE_ALPHA === 2.0);
  check('constants.PHASE_DRAIN_RATE_BETA === 0.5', constantsMod.PHASE_DRAIN_RATE_BETA === 0.5);
  check('constants.PHASE_DRAIN_RATE_GAMMA === 1.0', constantsMod.PHASE_DRAIN_RATE_GAMMA === 1.0);

  // 5. PhaseManager behavioral — real-time drain in Beta.
  const { PhaseManager } = await import(pathToFileURL(phasePath).href);
  const pm = new PhaseManager();
  pm.setEnergy(100);
  pm.setPhase(1); // BETA
  // Run 10 seconds of game time at 60fps. Expect 100 - 0.5*10 = 95.
  for (let i = 0; i < 600; i++) {
    pm.update(1 / 60);
  }
  check('PhaseManager in Beta: 100 - 0.5/s*10s ≈ 95',
    Math.abs(pm.getEnergy() - 95) < 0.5, "energy=" + pm.getEnergy());

  // 6. PhaseManager behavioral — real-time drain in Gamma.
  const pm2 = new PhaseManager();
  pm2.setEnergy(100);
  pm2.setPhase(2); // GAMMA
  for (let i = 0; i < 600; i++) {
    pm2.update(1 / 60);
  }
  check('PhaseManager in Gamma: 100 - 1.0/s*10s ≈ 90',
    Math.abs(pm2.getEnergy() - 90) < 0.5, "energy=" + pm2.getEnergy());

  // 7. PhaseManager behavioral — real-time regen in Alpha.
  const pm3 = new PhaseManager();
  pm3.setEnergy(0);
  // Run 25 seconds at 60fps. Expect 0 + 2.0*25 = 50.
  for (let i = 0; i < 1500; i++) {
    pm3.update(1 / 60);
  }
  check('PhaseManager in Alpha: 0 + 2.0/s*25s ≈ 50',
    Math.abs(pm3.getEnergy() - 50) < 0.5, "energy=" + pm3.getEnergy());

  // 8. PhaseManager — clamp to 0 (no negative energy).
  // Use setPhase(0) first to bypass the min-energy pad that setPhase
  // applies (the in-game pad is a "guarantee you can shift at least
  // once" safety net; for the clamp test we want raw drain behavior).
  const pm4 = new PhaseManager();
  pm4.setPhase(0); // ALPHA — setPhase pads to >= 20
  pm4.setEnergy(5); // then drop to 5
  // Bypass setPhase to enter Gamma without the min-energy pad.
  pm4._currentPhase = 2;
  for (let i = 0; i < 600; i++) {
    pm4.update(1 / 60);
  }
  check('PhaseManager clamps energy to 0 (no negative)',
    pm4.getEnergy() === 0, "energy=" + pm4.getEnergy());

  // 9. PhaseManager — clamp to MAX_ENERGY (no overflow).
  const pm5 = new PhaseManager();
  pm5.setEnergy(100);
  for (let i = 0; i < 600; i++) {
    pm5.update(1 / 60);
  }
  check('PhaseManager clamps energy to MAX_ENERGY (no overflow)',
    pm5.getEnergy() === 100, "energy=" + pm5.getEnergy());

  // 10. PhaseManager — energy invariant under frame rate variation.
  const a = new PhaseManager();
  a.setEnergy(100);
  a.setPhase(1); // BETA
  for (let i = 0; i < 60; i++) a.update(1 / 60); // 1s at 60fps
  const b = new PhaseManager();
  b.setEnergy(100);
  b.setPhase(1);
  for (let i = 0; i < 30; i++) b.update(1 / 30); // 1s at 30fps
  check('PhaseManager: 1s at 60fps == 1s at 30fps (frame-independent)',
    Math.abs(a.getEnergy() - b.getEnergy()) < 0.1,
    "60fps=" + a.getEnergy() + " 30fps=" + b.getEnergy());
  const c = new PhaseManager();
  c.setEnergy(100);
  c.setPhase(1);
  for (let i = 0; i < 120; i++) c.update(1 / 120); // 1s at 120fps
  check('PhaseManager: 1s at 60fps == 1s at 120fps (frame-independent)',
    Math.abs(a.getEnergy() - c.getEnergy()) < 0.1,
    "60fps=" + a.getEnergy() + " 120fps=" + c.getEnergy());

  // 11. PhaseManager — shift cost debit.
  const pm6 = new PhaseManager();
  pm6.setEnergy(100);
  pm6.cyclePhase();
  check('PhaseManager.cyclePhase() debits PHASE_SHIFT_COST (15)',
    pm6.getEnergy() === 100 - 15, "energy=" + pm6.getEnergy());

  // 12. PhaseManager — only ~6 shifts from full energy in Alpha.
  const pm7 = new PhaseManager();
  pm7.setEnergy(100);
  let successful = 0;
  for (let i = 0; i < 10; i++) {
    if (pm7.cyclePhase()) {
      successful++;
      pm7.completeShift();
    }
  }
  check('PhaseManager: 6 shifts succeed from full energy in Alpha',
    successful === 6, "successful=" + successful + " remaining=" + pm7.getEnergy());

  // 13. main.js — getShiftCost debug hook uses the new constant.
  check('main.js references PHASE_SHIFT_COST (not hardcoded 5)',
    /PHASE_SHIFT_COST/.test(mainText));

  // 14. README — no longer claims the old "30 energy per shift" lie.
  check('README no longer claims "30 energy per shift"',
    !/30 energy per shift/.test(readmeText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.1 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.1 test crashed:', err);
  process.exit(1);
});
