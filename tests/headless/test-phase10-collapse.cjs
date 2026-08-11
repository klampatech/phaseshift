#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.3 — Collapse penalty (Echo loss on collapse).
//
// §10.3 acceptance:
// - startCollapse accepts a lostEcho argument.
// - The result.done branch surfaces the lostEcho.
// - FALLBACK_ENERGY_PENALTY = 25 is exported from constants.
// - The collapse state tracks lostEcho across the tick.
// - The invuln window is preserved after the loss.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const collapsePath = path.join(ROOT, 'src', 'collapse', 'collapse.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const mainPath = path.join(ROOT, 'main.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.3 — Collapse penalty (Echo loss on collapse) ===\n');

  const collapseMod = await import(pathToFileURL(collapsePath).href);
  const constantsMod = await import(pathToFileURL(constantsPath).href);

  // 1. FALLBACK_ENERGY_PENALTY is exported.
  check('FALLBACK_ENERGY_PENALTY constant exists', constantsMod.FALLBACK_ENERGY_PENALTY === 25);

  // 2. startCollapse accepts a lostEcho.
  const state = collapseMod.createCollapseState();
  collapseMod.startCollapse(state, 'forced', { x: 0, y: 30, z: 0, source: 'stabilizer' }, 'stabilizer', { key: '1,2,3', lore: 'Test echo' });
  check('startCollapse tracks lostEcho', state.lostEcho && state.lostEcho.key === '1,2,3');
  check('startCollapse tracks lostEcho lore', state.lostEcho.lore === 'Test echo');

  // 3. tickCollapse surfaces lostEcho in the result.
  let result = null;
  for (let i = 0; i < 30; i++) {
    result = collapseMod.tickCollapse(state, 0.05);
  }
  check('tickCollapse result.done is true', result.done === true);
  check('tickCollapse result.lostEcho is preserved', result.lostEcho && result.lostEcho.key === '1,2,3');

  // 4. startCollapse without lostEcho defaults to null.
  const state2 = collapseMod.createCollapseState();
  collapseMod.startCollapse(state2, 'forced', { x: 0, y: 30, z: 0, source: 'stabilizer' }, 'stabilizer');
  check('startCollapse without lostEcho.lostEcho === null', state2.lostEcho === null);

  // 5. Defensive: invalid lostEcho is normalized to null.
  const state3 = collapseMod.createCollapseState();
  collapseMod.startCollapse(state3, 'forced', { x: 0, y: 30, z: 0, source: 'stabilizer' }, 'stabilizer', { key: 123, lore: 'bad' });
  check('startCollapse with non-string lostEcho.key === null', state3.lostEcho === null);

  // 6. Defensive: invalid targetPos.
  const state4 = collapseMod.createCollapseState();
  collapseMod.startCollapse(state4, 'forced', null, 'stabilizer', { key: '1,2,3', lore: 'test' });
  check('startCollapse with null targetPos preserves lostEcho', state4.lostEcho && state4.lostEcho.key === '1,2,3');

  // 7. The full collapse tick still works end-to-end with lostEcho.
  const state5 = collapseMod.createCollapseState();
  collapseMod.startCollapse(state5, 'forced', { x: 0, y: 30, z: 0, source: 'stabilizer' }, 'stabilizer', { key: '1,2,3', lore: 'test' });
  let r5 = null;
  for (let i = 0; i < 30; i++) r5 = collapseMod.tickCollapse(state5, 0.05);
  check('end-to-end collapse: done + lostEcho + progress=1',
    r5.done === true && r5.lostEcho && r5.lostEcho.key === '1,2,3' && r5.progress === 1.0);

  // 8. clearCollapse resets lostEcho.
  const state6 = collapseMod.createCollapseState();
  collapseMod.startCollapse(state6, 'forced', { x: 0, y: 30, z: 0, source: 'stabilizer' }, 'stabilizer', { key: '1,2,3', lore: 'test' });
  collapseMod.clearCollapse(state6);
  check('clearCollapse resets lostEcho', state6.lostEcho === null);

  // 9. main.js uses FALLBACK_ENERGY_PENALTY.
  const mainText = fs.readFileSync(mainPath, 'utf8');
  check('main.js references FALLBACK_ENERGY_PENALTY', /FALLBACK_ENERGY_PENALTY/.test(mainText));
  check('main.js defines pickRandomEchoToLose', /function pickRandomEchoToLose/.test(mainText));
  check('main.js forcePhaseCollapse picks a lost Echo', /pickRandomEchoToLose/.test(mainText));

  // 10. The collapse result is used to remove the lost Echo.
  check('main.js tickCollapsePerFrame removes lostEcho on done',
    /result\.lostEcho[\s\S]{0,200}?delete/.test(mainText) || /lostEcho[\s\S]{0,200}?delete/.test(mainText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.3 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.3 test crashed:', err);
  process.exit(1);
});
