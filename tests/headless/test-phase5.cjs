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
  check('ACT_ORDER has 3 entries', goals.ACT_ORDER.length === 3);
  check('ACT_OBJECTIVES has 3 strings', Object.keys(goals.ACT_OBJECTIVES).length === 3);

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
  check('currentAct returns null when all complete',
    goals.currentAct({
      collectedEchoCount: 5,
      hasVisitedPhaseNexus: true,
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
    }) === null);

  // currentObjective
  check('currentObjective returns the act 1 string',
    goals.currentObjective({ collectedEchoCount: 0 }) === goals.ACT_OBJECTIVES[goals.ACT_FIND_FIRST_ECHO]);
  check('currentObjective returns "complete" when done',
    goals.currentObjective({
      collectedEchoCount: 5,
      hasVisitedPhaseNexus: true,
      amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
      stabilizerCount: 1,
    }) === 'All complete — explore freely.');

  // objectiveColor
  check('objectiveColor returns cyan for active', goals.objectiveColor({}) === '#88ccff');
  check('objectiveColor returns green for complete', goals.objectiveColor({
    collectedEchoCount: 5,
    hasVisitedPhaseNexus: true,
    amplifiers: ['amplifierAB', 'amplifierBG', 'amplifierAG'],
    stabilizerCount: 1,
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
