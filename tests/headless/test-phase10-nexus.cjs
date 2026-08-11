#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.5 — Act 4 Convergence + Nexus finale.
//
// §10.5 acceptance:
// - New ACT_CONVERGENCE act added.
// - ACT_CONVERGENCE requires all 3 amps + at least 1 Echo + at
//   least 1 Stabilizer + visited Phase Nexus + convergenceUnlocked.
// - The world has openNexus/isNexusOpen/markConvergenceComplete/
//   isConvergenceComplete/resetConvergence methods.
// - The Nexus chamber is sealed until openNexus is called.
// - The Act 4 objective shows "Convergence complete..." when done.
// - The currentAct() returns the first incomplete act.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const goalsPath = path.join(ROOT, 'src', 'progression', 'goals.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.5 — Act 4 Convergence + Nexus finale ===\n');

  const goalsMod = await import(pathToFileURL(goalsPath).href);

  // 1. ACT_CONVERGENCE is exported.
  check('ACT_CONVERGENCE is exported', goalsMod.ACT_CONVERGENCE === 'act4_convergence');

  // 2. ACT_ORDER has 4 entries.
  check('ACT_ORDER has 4 entries', goalsMod.ACT_ORDER.length === 4);

  // 3. ACT_OBJECTIVES has Convergence.
  check('ACT_OBJECTIVES[ACT_CONVERGENCE] is the finale line',
    /Convergence complete/.test(goalsMod.ACT_OBJECTIVES[goalsMod.ACT_CONVERGENCE]));

  // 4. actCompleted(ACT_CONVERGENCE) requires all 3 amps + Echo + Stabilizer + Nexus + convergenceUnlocked.
  const incompleteState = {
    collectedEchoCount: 1,
    amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
    stabilizerCount: 1,
    hasVisitedPhaseNexus: true,
    convergenceUnlocked: false,
  };
  check('actCompleted(ACT_CONVERGENCE) false when convergenceUnlocked is false',
    goalsMod.actCompleted(goalsMod.ACT_CONVERGENCE, incompleteState) === false);

  const completeState = {
    collectedEchoCount: 1,
    amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
    stabilizerCount: 1,
    hasVisitedPhaseNexus: true,
    convergenceUnlocked: true,
  };
  check('actCompleted(ACT_CONVERGENCE) true when all conditions met',
    goalsMod.actCompleted(goalsMod.ACT_CONVERGENCE, completeState) === true);

  // 5. currentAct returns the first incomplete act.
  const stateMid = {
    collectedEchoCount: 1,
    hasVisitedPhaseNexus: false,
    amplifiers: [],
    stabilizerCount: 0,
  };
  check('currentAct(stateMid) === ACT_REACH_PHASE_NEXUS',
    goalsMod.currentAct(stateMid) === goalsMod.ACT_REACH_PHASE_NEXUS);

  // 6. currentObjective returns the finale line when all done.
  check('currentObjective(allComplete) === Convergence line',
    /Convergence complete/.test(goalsMod.currentObjective(completeState)));

  // 7. World has the convergence methods.
  const { World } = await import(pathToFileURL(worldPath).href);
  const world = new World();
  check('World.isNexusOpen() === false initially', world.isNexusOpen() === false);
  check('World.isConvergenceComplete() === false initially', world.isConvergenceComplete() === false);
  check('World.openNexus() returns true', world.openNexus() === true);
  check('World.isNexusOpen() === true after openNexus', world.isNexusOpen() === true);
  check('World.markConvergenceComplete() returns true', world.markConvergenceComplete() === true);
  check('World.isConvergenceComplete() === true after mark', world.isConvergenceComplete() === true);

  // 8. resetConvergence.
  world.resetConvergence();
  check('World.resetConvergence clears nexusOpen', world.isNexusOpen() === false);
  check('World.resetConvergence clears convergenceComplete', world.isConvergenceComplete() === false);

  // 9. The goal state builder surfaces nexusOpen and convergenceUnlocked.
  const state = goalsMod.buildGoalState(
    { collectedEchoes: [{}], amplifiers: new Set(['amplifierAB']) },
    world,
    { phaseNexus: true }
  );
  check('buildGoalState surfaces nexusOpen',
    state.nexusOpen === false);
  check('buildGoalState surfaces convergenceUnlocked',
    state.convergenceUnlocked === false);

  // 10. The nexusOpen in the world flows into the Act 4 predicate.
  world.openNexus();
  const state2 = goalsMod.buildGoalState(
    { collectedEchoes: [{}], amplifiers: new Set(['amplifierAB', 'amplifierBG', 'amplifierAG']) },
    world,
    { phaseNexus: true }
  );
  // After openNexus, the world has nexusOpen=true, but convergenceUnlocked
  // is still false (the player hasn't collected the final Echo yet).
  check('buildGoalState surfaces nexusOpen after openNexus',
    state2.nexusOpen === true);

  // 11. The Convergence objective is the finale line.
  check('ACT_OBJECTIVES[ACT_CONVERGENCE] is shown after completion',
    /Convergence complete/.test(goalsMod.ACT_OBJECTIVES[goalsMod.ACT_CONVERGENCE]));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.5 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.5 test crashed:', err);
  process.exit(1);
});
