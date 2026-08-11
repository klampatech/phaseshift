#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.13 — Resonance charge-up (0.5s preview + 1.0s commit + cancel).
//
// §10.13 acceptance:
// - RESONANCE_CHARGE_SECONDS = 0.5 (preview window).
// - RESONANCE_COMMIT_SECONDS = 1.0 (full pulse lifetime).
// - RESONATE_COST bumped from 15 to 25 (debited on commit, not press).
// - createChargeState returns {state: 'idle', elapsed: 0, ...}.
// - startCharge transitions state to 'charging' + stores coords/phase.
// - tickCharge advances elapsed + transitions charging -> committing
//   when elapsed >= CHARGE_SECONDS, committing -> idle when elapsed
//   >= COMMIT_SECONDS.
// - cancelCharge during charging -> 'cancelled' (no debit, no swap).
// - commitCharge manually promotes charging -> committing (used when
//   Q is pressed during the charge window).
// - isPendingCommit is true for exactly one tick on the edge.
// - previewAmount / commitAmount / resonancePulseRadius /
//   resonancePulseOpacity return deterministic shapes per state.
// - Renderer exposes startResonanceCharge + updateResonanceCharge.
// - main.js wires the §10.13 flow (imports from charge module,
//   uses tickResonanceChargePerFrame in the game loop, exposes
//   __phaseShifter__.resonanceCharge debug hooks).
// - forceResonate test hook ends with energyDebited: true when the
//   player had >= 25 energy at press time.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const chargePath = path.join(ROOT, 'src', 'resonance', 'charge.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const mainPath = path.join(ROOT, 'main.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.13 — Resonance charge-up ===\n');

  const charge = await import(pathToFileURL(chargePath).href);
  const constants = await import(pathToFileURL(constantsPath).href);

  // 1. Module exports.
  check('charge module exports RESONANCE_CHARGE_SECONDS',
    charge.RESONANCE_CHARGE_SECONDS === 0.5);
  check('charge module exports RESONANCE_COMMIT_SECONDS',
    charge.RESONANCE_COMMIT_SECONDS === 1.0);
  check('charge module exports RESONANCE_TOTAL_DURATION',
    charge.RESONANCE_TOTAL_DURATION === 1.5);
  check('charge module exports createChargeState',
    typeof charge.createChargeState === 'function');
  check('charge module exports startCharge', typeof charge.startCharge === 'function');
  check('charge module exports tickCharge', typeof charge.tickCharge === 'function');
  check('charge module exports cancelCharge', typeof charge.cancelCharge === 'function');
  check('charge module exports commitCharge', typeof charge.commitCharge === 'function');
  check('charge module exports isChargeActive', typeof charge.isChargeActive === 'function');
  check('charge module exports isCharging', typeof charge.isCharging === 'function');
  check('charge module exports isCommitting', typeof charge.isCommitting === 'function');
  check('charge module exports isPendingCommit', typeof charge.isPendingCommit === 'function');
  check('charge module exports clearPendingCommit', typeof charge.clearPendingCommit === 'function');
  check('charge module exports previewAmount', typeof charge.previewAmount === 'function');
  check('charge module exports commitAmount', typeof charge.commitAmount === 'function');
  check('charge module exports resonancePulseRadius', typeof charge.resonancePulseRadius === 'function');
  check('charge module exports resonancePulseOpacity', typeof charge.resonancePulseOpacity === 'function');

  // 2. Constants.
  check('constants.RESONATE_COST === 25',
    constants.RESONATE_COST === 25);
  check('constants.RESONANCE_CHARGE_SECONDS === 0.5',
    constants.RESONANCE_CHARGE_SECONDS === 0.5);
  check('constants.RESONANCE_COMMIT_SECONDS === 1.0',
    constants.RESONANCE_COMMIT_SECONDS === 1.0);

  // 3. State factory.
  const s = charge.createChargeState();
  check('createChargeState.state === "idle"', s.state === 'idle');
  check('createChargeState.elapsed === 0', s.elapsed === 0);
  check('createChargeState.pendingCommit === false', s.pendingCommit === false);
  check('createChargeState.centerX === 0', s.centerX === 0);

  // 4. startCharge transitions idle -> charging.
  charge.startCharge(s, 10.5, 20.5, 30.5, 1, 100);
  check('startCharge -> state === "charging"', s.state === 'charging');
  check('startCharge -> elapsed === 0', s.elapsed === 0);
  check('startCharge -> centerX === 10.5', s.centerX === 10.5);
  check('startCharge -> centerY === 20.5', s.centerY === 20.5);
  check('startCharge -> centerZ === 30.5', s.centerZ === 30.5);
  check('startCharge -> currentPhase === 1 (BETA)', s.currentPhase === 1);
  check('startCharge -> playerEnergyAtPress === 100', s.playerEnergyAtPress === 100);

  // 5. tickCharge advances elapsed while charging.
  let tickResult = charge.tickCharge(s, 0.1);
  check('tickCharge(0.1s) keeps state === "charging"', tickResult.state === 'charging');
  check('tickCharge(0.1s) elapsed ≈ 0.1',
    Math.abs(tickResult.elapsed - 0.1) < 0.001);
  check('isCharging(s) === true', charge.isCharging(s) === true);
  check('isCommitting(s) === false', charge.isCommitting(s) === false);
  check('isChargeActive(s) === true', charge.isChargeActive(s) === true);

  // 6. tickCharge transitions charging -> committing at 0.5s.
  tickResult = charge.tickCharge(s, 0.5);
  check('tickCharge(0.4s more, total ≈ 0.5) -> state === "committing"',
    tickResult.state === 'committing');
  check('tickCharge promotes with elapsed === 0 (commit phase starts fresh)',
    tickResult.elapsed === 0);
  check('isPendingCommit(s) === true on the edge',
    charge.isPendingCommit(s) === true);

  // 7. previewAmount / commitAmount math.
  check('previewAmount(0) === 0', charge.previewAmount(0) === 0);
  check('previewAmount(0.25) ≈ 0.5', Math.abs(charge.previewAmount(0.25) - 0.5) < 0.001);
  check('previewAmount(0.5) === 1', charge.previewAmount(0.5) === 1);
  check('previewAmount(1.0) === 1 (clamped)', charge.previewAmount(1.0) === 1);
  check('commitAmount(0) === 0', charge.commitAmount(0) === 0);
  check('commitAmount(0.5) ≈ 0.5', Math.abs(charge.commitAmount(0.5) - 0.5) < 0.001);
  check('commitAmount(1.0) === 1', charge.commitAmount(1.0) === 1);

  // 8. resonancePulseRadius during charging.
  charge.startCharge(s, 0, 0, 0, 0, 100);
  const r0 = charge.resonancePulseRadius(s);
  check('pulse radius at start of charge ≈ 0.2',
    Math.abs(r0 - 0.2) < 0.001, `got ${r0}`);
  charge.tickCharge(s, 0.25);
  const rMid = charge.resonancePulseRadius(s);
  check('pulse radius mid-charge ≈ 0.4',
    Math.abs(rMid - 0.4) < 0.001, `got ${rMid}`);
  charge.tickCharge(s, 0.3); // pushes to committing
  const rCommit = charge.resonancePulseRadius(s);
  check('pulse radius at start of commit ≈ 0.6',
    Math.abs(rCommit - 0.6) < 0.001, `got ${rCommit}`);
  charge.tickCharge(s, 0.5);
  const rCommitMid = charge.resonancePulseRadius(s);
  check('pulse radius mid-commit ≈ 0.8',
    Math.abs(rCommitMid - 0.8) < 0.001, `got ${rCommitMid}`);

  // 9. resonancePulseOpacity during committing fades to 0.
  const opStart = charge.resonancePulseOpacity(s);
  check('pulse opacity mid-commit > 0', opStart > 0, `got ${opStart}`);
  charge.tickCharge(s, 1.0); // finishes commit
  check('after full commit, state === "idle"', s.state === 'idle');
  check('after full commit, isChargeActive === false',
    charge.isChargeActive(s) === false);

  // 10. cancelCharge during charging.
  charge.startCharge(s, 0, 0, 0, 0, 100);
  charge.tickCharge(s, 0.2);
  charge.cancelCharge(s);
  check('cancelCharge -> state === "cancelled"',
    s.state === 'cancelled');
  check('cancelCharge -> elapsed === 0', s.elapsed === 0);
  check('cancelCharge -> pendingCommit === false', s.pendingCommit === false);
  // Next tick transitions cancelled -> idle.
  charge.tickCharge(s, 0.01);
  check('tickCharge after cancel -> state === "idle"',
    s.state === 'idle');

  // 11. cancelCharge is no-op outside charging.
  const s2 = charge.createChargeState();
  charge.cancelCharge(s2);
  check('cancelCharge on idle is no-op', s2.state === 'idle');
  charge.startCharge(s2, 0, 0, 0, 0, 100);
  charge.tickCharge(s2, 0.5); // -> committing
  charge.cancelCharge(s2);
  check('cancelCharge on committing is no-op',
    s2.state === 'committing');

  // 12. commitCharge manual promotion.
  const s3 = charge.createChargeState();
  charge.startCharge(s3, 0, 0, 0, 0, 100);
  charge.tickCharge(s3, 0.2);
  charge.commitCharge(s3);
  check('commitCharge -> state === "committing"', s3.state === 'committing');
  check('commitCharge -> elapsed === 0', s3.elapsed === 0);
  check('commitCharge -> pendingCommit === true', s3.pendingCommit === true);

  // 13. clearPendingCommit.
  charge.clearPendingCommit(s3);
  check('clearPendingCommit -> pendingCommit === false',
    s3.pendingCommit === false);

  // 14. Defensive: startCharge with bad coords.
  const s4 = charge.createChargeState();
  charge.startCharge(s4, NaN, NaN, NaN, NaN, NaN);
  check('startCharge with NaN falls back to 0 coords',
    s4.centerX === 0 && s4.centerY === 0 && s4.centerZ === 0);
  check('startCharge with NaN phase falls back to PHASE_ALPHA',
    s4.currentPhase === 0);

  // 15. Defensive: tickCharge with bad dt.
  const s5 = charge.createChargeState();
  charge.startCharge(s5, 0, 0, 0, 0, 100);
  const bad = charge.tickCharge(s5, NaN);
  check('tickCharge with NaN dt does not advance elapsed',
    bad.elapsed === 0);

  // 16. resonancePulseRadius during cancelled returns 0.
  const s6 = charge.createChargeState();
  charge.startCharge(s6, 0, 0, 0, 0, 100);
  charge.tickCharge(s6, 0.2);
  charge.cancelCharge(s6);
  check('pulse radius during cancelled === 0',
    charge.resonancePulseRadius(s6) === 0);
  check('pulse opacity during cancelled === 0',
    charge.resonancePulseOpacity(s6) === 0);

  // 17. Renderer exposes startResonanceCharge + updateResonanceCharge.
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  check('renderer.js exports ResonancePulse class',
    /export\s+class\s+ResonancePulse\s*\{/.test(rendererText));
  check('renderer.js ResonancePulse has startResonanceCharge',
    /startResonanceCharge\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*currentPhase\s*,\s*chargeState\s*\)/.test(rendererText));
  check('renderer.js ResonancePulse has updateResonanceCharge',
    /updateResonanceCharge\s*\(\s*dt\s*,\s*chargeState\s*\)/.test(rendererText));
  check('renderer.js imports from charge module',
    /from\s+['"]\.\.\/resonance\/charge\.js['"]/.test(rendererText));
  check('renderer.js Renderer class has startResonanceCharge wrapper',
    /startResonanceCharge\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*currentPhase\s*,\s*chargeState\s*\)\s*\{[\s\S]*?this\.resonancePulse\.startResonanceCharge/.test(rendererText));
  check('renderer.js Renderer class has updateResonanceCharge wrapper',
    /updateResonanceCharge\s*\(\s*dt\s*,\s*chargeState\s*\)\s*\{[\s\S]*?this\.resonancePulse\.updateResonanceCharge/.test(rendererText));

  // 18. main.js wiring.
  const mainText = fs.readFileSync(mainPath, 'utf8');
  check('main.js imports from src/resonance/charge.js',
    /from\s+['"]\.\/src\/resonance\/charge\.js['"]/.test(mainText));
  check('main.js declares resonanceChargeState',
    /resonanceChargeState\s*=\s*createChargeState/.test(mainText));
  check('main.js performResonance handles charging -> cancel',
    /isCharging\s*\(\s*resonanceChargeState\s*\)\s*\)[^}]*?cancelCharge/.test(mainText));
  check('main.js performResonance handles idle -> start',
    /startCharge\s*\(\s*resonanceChargeState/.test(mainText));
  check('main.js tickResonanceChargePerFrame exists',
    /function\s+tickResonanceChargePerFrame\s*\(/.test(mainText));
  check('main.js game loop calls tickResonanceChargePerFrame',
    /tickResonanceChargePerFrame\s*\(\s*deltaTime\s*\)/.test(mainText));
  check('main.js commitResonanceSwap exists',
    /function\s+commitResonanceSwap\s*\(/.test(mainText));
  check('main.js debits RESONATE_COST in commitResonanceSwap',
    /phaseManager\.consumeEnergy\s*\(\s*resonateCost\s*\(\s*\)\s*\)/.test(mainText));
  check('main.js exports resonanceCharge debug hook',
    /resonanceCharge:\s*\{[\s\S]{0,2000}?getState/.test(mainText));
  check('main.js resonanceCharge.cancel exists',
    /resonanceCharge:\s*\{[\s\S]{0,2000}?cancel\s*\(\s*\)/.test(mainText));
  check('main.js resonanceCharge.commitNow exists',
    /resonanceCharge:\s*\{[\s\S]{0,2000}?commitNow\s*\(\s*\)/.test(mainText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.13 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.13 test crashed:', err);
  process.exit(1);
});
