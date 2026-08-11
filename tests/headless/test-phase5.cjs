#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 5 verification: Goals & Progression (5.1) + Audio polish
// (5.3) + Visual polish (5.4) + Accessibility (5.5).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const goalsPath = path.join(ROOT, 'src', 'progression', 'goals.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const mainPath = path.join(ROOT, 'main.js');
const indexHtmlPath = path.join(ROOT, 'index.html');

const hudText = fs.readFileSync(hudPath, 'utf8');
const mainText = fs.readFileSync(mainPath, 'utf8');
const htmlText = fs.readFileSync(indexHtmlPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}

async function main() {
  // ── 1) Static analysis ─────────────────────────────────
  console.log('\n=== Phase 5 static-analysis (against source files) ===');
  check('src/progression/goals.js exists', fs.existsSync(goalsPath));

  // ── 2) Behavior - goals pure module ───────────────────────
  console.log('\n=== Phase 5 behavior - goals.js pure module ===');
  const goalsUrl = 'file://' + goalsPath.replace(/\\/g, '/');
  const goals = await import(goalsUrl);

  // Constants
  check('ACT_FIND_FIRST_ECHO defined', goals.ACT_FIND_FIRST_ECHO === 'act1_find_first_echo');
  check('ACT_REACH_PHASE_NEXUS defined', goals.ACT_REACH_PHASE_NEXUS === 'act2_reach_phase_nexus');
  check('ACT_MASTER_ALL_PHASES defined', goals.ACT_MASTER_ALL_PHASES === 'act3_master_all_phases');
  // Phase 10.5: ACT_ORDER grew from 3 → 4 entries (Act 4 Convergence
  // is the new finale; the existing 3 acts are unchanged). The
  // Acceptance bullet for §10.5: "After Convergence, the world gains
  // a subtle shimmer tint and the player avatar a faint glow."
  check('ACT_ORDER has 4 entries (Act 1-3 + Act 4 Convergence)', goals.ACT_ORDER.length === 4);
  check('ACT_OBJECTIVES has 4 strings (one per act)', Object.keys(goals.ACT_OBJECTIVES).length === 4);

  // actCompleted predicates
  check('Act 1 incomplete when no echoes',
    goals.actCompleted(goals.ACT_FIND_FIRST_ECHO, { collectedEchoCount: 0 }) === false);
  check('Act 1 complete with 1 echo',
    goals.actCompleted(goals.ACT_FIND_FIRST_ECHO, { collectedEchoCount: 1 }) === true);
  check('Act 2 incomplete by default',
    goals.actCompleted(goals.ACT_REACH_PHASE_NEXUS, {}) === false);
  check('Act 2 complete when Phase Nexus visited',
    goals.actCompleted(goals.ACT_REACH_PHASE_NEXUS, { hasVisitedPhaseNexus: true }) === true);
  check('Act 3 incomplete without all amps',
    goals.actCompleted(goals.ACT_MASTER_ALL_PHASES, {
      amplifiers: ['amplifierAB'],
      stabilizerCount: 1,
    }) === false);
  check('Act 3 complete with all amps + stabilizer',
    goals.actCompleted(goals.ACT_MASTER_ALL_PHASES, {
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
    }) === true);
  check('Act 3 incomplete without stabilizer',
    goals.actCompleted(goals.ACT_MASTER_ALL_PHASES, {
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 0,
    }) === false);
  check('actCompleted unknown act returns false',
    goals.actCompleted('unknown_act', {}) === false);

  // currentAct
  check('currentAct returns ACT_FIND_FIRST_ECHO initially',
    goals.currentAct({ collectedEchoCount: 0 }) === goals.ACT_FIND_FIRST_ECHO);
  check('currentAct returns ACT_REACH_PHASE_NEXUS after act 1',
    goals.currentAct({ collectedEchoCount: 1 }) === goals.ACT_REACH_PHASE_NEXUS);
  check('currentAct returns ACT_MASTER_ALL_PHASES after act 2',
    goals.currentAct({ collectedEchoCount: 1, hasVisitedPhaseNexus: true }) === goals.ACT_MASTER_ALL_PHASES);
  // Phase 10.5: "all complete" now requires convergenceUnlocked=true
  // (the §10.5 finale isn't free — the player must walk into the
  // Nexus chamber after meeting the Act 3 conditions).
  check('currentAct returns null when all complete',
    goals.currentAct({
      collectedEchoCount: 5,
      hasVisitedPhaseNexus: true,
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
      convergenceUnlocked: true,
    }) === null);

  // currentObjective
  check('currentObjective returns the act 1 string',
    goals.currentObjective({ collectedEchoCount: 0 }) === goals.ACT_OBJECTIVES[goals.ACT_FIND_FIRST_ECHO]);
  // Phase 10.5: once Convergence is unlocked, currentObjective returns
  // the "phases remember you" line instead of the legacy "explore
  // freely" line. The legacy line is still shown if Convergence is
  // NOT unlocked but everything else is complete.
  check('currentObjective returns Convergence text when all complete',
    goals.currentObjective({
      collectedEchoCount: 5,
      hasVisitedPhaseNexus: true,
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
      convergenceUnlocked: true,
    }) === goals.ACT_OBJECTIVES[goals.ACT_CONVERGENCE]);

  // objectiveColor
  check('objectiveColor returns cyan for active', goals.objectiveColor({}) === '#88ccff');
  // Phase 10.5: green is still the "complete" color, but only when
  // the player has unlocked Convergence. While Act 4 is still locked
  // (i.e. the player has all amps + stabilizer + Echo + visited the
  // Nexus but hasn't walked into the Nexus chamber), the color is
  // gold (#ddaa44) — the §10.5 finale-call color.
  check('objectiveColor returns gold while Convergence is locked',
    goals.objectiveColor({
      collectedEchoCount: 5,
      hasVisitedPhaseNexus: true,
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
    }) === '#ddaa44');
  check('objectiveColor returns green for complete (Convergence unlocked)',
    goals.objectiveColor({
      collectedEchoCount: 5,
      hasVisitedPhaseNexus: true,
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
      convergenceUnlocked: true,
    }) === '#88ff88');

  // markerKey
  // Math.floor(-2.5) === -3 in JS (rounds toward -Infinity)
  check('markerKey formats correctly', goals.markerKey(1.5, 30.5, 2.5) === '1,30,2');
  check('markerKey handles negative coords', goals.markerKey(-1.5, 30.5, -2.5) === '-2,30,-3');

  // compassBearing
  check('compassBearing null for missing inputs',
    goals.compassBearing(null, { x: 0, z: 0 }, 0) === null);
  check('compassBearing null for non-finite inputs',
    goals.compassBearing({ x: NaN, z: 0 }, { x: 0, z: 0 }, 0) === null);
  check('compassBearing returns 0 when target is north and yaw is 0',
    Math.abs(goals.compassBearing({ x: 0, z: 0 }, { x: 0, z: 1 }, 0)) < 1e-6);
  check('compassBearing returns pi/2 when target is east and yaw is 0',
    Math.abs(goals.compassBearing({ x: 0, z: 0 }, { x: 1, z: 0 }, 0) - Math.PI / 2) < 1e-6);

  // nearestMarker
  check('nearestMarker returns null for empty list',
    goals.nearestMarker({ x: 0, z: 0 }, []) === null);
  check('nearestMarker returns null for missing player',
    goals.nearestMarker(null, [{ x: 0, z: 0 }]) === null);
  check('nearestMarker picks the closest marker',
    goals.nearestMarker({ x: 0, z: 0 }, [
      { x: 5, z: 5 }, { x: 1, z: 1 }, { x: 10, z: 10 },
    ]).x === 1);
  check('nearestMarker skips invalid entries',
    goals.nearestMarker({ x: 0, z: 0 }, [
      null, { x: 5, z: 5 }, undefined, { x: NaN, z: 0 },
    ]).x === 5);

  // buildGoalState
  check('buildGoalState handles missing inventory',
    goals.buildGoalState(null, null, null).collectedEchoCount === 0);
  check('buildGoalState counts echoes',
    goals.buildGoalState({ collectedEchoes: [{ key: 'k', lore: 'l' }] }, null, null).collectedEchoCount === 1);
  check('buildGoalState passes amplifiers through',
    goals.buildGoalState({ amplifiers: ['amplifierAB'] }, null, null).amplifiers[0] === 'amplifierAB');
  check('buildGoalState reads biomesVisited',
    goals.buildGoalState(null, null, { phaseNexus: true }).hasVisitedPhaseNexus === true);
  check('buildGoalState reads world.getStabilizerCount',
    goals.buildGoalState(null, { getStabilizerCount: () => 3 }, null).stabilizerCount === 3);
  check('GOAL_DEFAULTS frozen', Object.isFrozen(goals.GOAL_DEFAULTS));

  // ── 3) HUD extensions ─────────────────────────────────────
  console.log('\n=== Phase 5 behavior - HUD updateObjective + updateCompass ===');
  check('HUD.updateObjective method', /updateObjective\s*\(\s*goalState\s*\)/.test(hudText));
  check('HUD.updateCompass method', /updateCompass\s*\(/.test(hudText));
  check('HUD imports goals module', /from\s+['"]\.\.\/progression\/goals\.js['"]/.test(hudText));

  // ── 4) HTML element + CSS ────────────────────────────────
  console.log('\n=== Phase 5 HTML element + CSS ===');
  check('index.html has #compass-arrow element', /id\s*=\s*["']compass-arrow["']/.test(htmlText));
  check('index.html has #compass-arrow CSS', /#compass-arrow\s*\{/.test(htmlText));

  // ── 5) main.js wiring ─────────────────────────────────────
  console.log('\n=== Phase 5 main.js wiring ===');
  check('main.js imports goals module', /from\s+['"]\.\/src\/progression\/goals\.js['"]/.test(mainText));
  check('main.js tickGoalsPerFrame function', /function\s+tickGoalsPerFrame\s*\(/.test(mainText));
  check('main.js calls tickGoalsPerFrame', /tickGoalsPerFrame\s*\(\s*deltaTime\s*\)/.test(mainText));
  check('main.js builds goal state', /buildGoalState/.test(mainText));
  check('main.js finds nearest marker', /nearestMarker/.test(mainText));
  check('main.js updates HUD objective', /hud\.updateObjective/.test(mainText));
  check('main.js updates HUD compass', /hud\.updateCompass/.test(mainText));
  check('main.js exports buildGoalState hook', /__phaseShifter__[\s\S]*?buildGoalState\s*\(/.test(mainText));
  check('main.js exports getCurrentAct hook', /__phaseShifter__[\s\S]*?getCurrentAct\s*\(/.test(mainText));
  check('main.js exports listStabilizers hook', /__phaseShifter__[\s\S]*?listStabilizers\s*\(/.test(mainText));

  // ── 6) Phase 5.4 FOV breathing ───────────────────────────
  check('main.js has tickFovBreathingPerFrame', /function\s+tickFovBreathingPerFrame/.test(mainText));
  check('main.js calls tickFovBreathingPerFrame', /tickFovBreathingPerFrame\s*\(\s*deltaTime\s*\)/.test(mainText));
  check('main.js onPhaseChanged starts FOV breathing', /fovBreathingActive\s*=\s*true/.test(mainText));

  // ── 7) Phase 5.5 reduced-motion ──────────────────────────
  check('main.js respects reduced-motion', /getReducedMotion/.test(mainText));
  check('Settings.setReducedMotion method', /setReducedMotion\s*\(/.test(fs.readFileSync(path.join(ROOT, 'src', 'save', 'system.js'), 'utf8')));

  console.log(`\n=== Phase 5 TOTAL: ${passed}/${passed + failed} passed ===`);
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
