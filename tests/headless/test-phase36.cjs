#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 3.6 verification: Tutorial Zone - safe ring at spawn with
// Stone/Obsidian/Echo/Stabilizer + HUD hints.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const tutorialPath = path.join(ROOT, 'src', 'tutorial', 'tutorial.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const mainPath = path.join(ROOT, 'main.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const htmlPath = path.join(ROOT, 'index.html');

const mainText = fs.readFileSync(mainPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const hudText = fs.readFileSync(hudPath, 'utf8');
const htmlText = fs.readFileSync(htmlPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}

// ── 1) Static analysis ───────────────────────────────────────
console.log('\n=== Phase 3.6 static-analysis (against source files) ===');
check('tutorial.js exists', fs.existsSync(tutorialPath));

// ── 2) Behavior - pure module ─────────────────────────────────
console.log('\n=== Phase 3.6 behavior - tutorial.js pure module ===');
async function main() {
  const tutorialUrl = 'file://' + tutorialPath.replace(/\\/g, '/');
  const worldUrl = 'file://' + worldPath.replace(/\\/g, '/');
  const tutorial = await import(tutorialUrl);
  const { World } = await import(worldUrl);

  // Constants
  check('TUTORIAL_RADIUS === 4', tutorial.TUTORIAL_RADIUS === 4);
  check('TUTORIAL_HINT_DURATION === 8', tutorial.TUTORIAL_HINT_DURATION === 8);
  check('TUTORIAL_HINT_TEXTS has 8 entries', tutorial.TUTORIAL_HINT_TEXTS.length === 8);
  check('TUTORIAL_TOTAL_DURATION === 64', tutorial.TUTORIAL_TOTAL_DURATION === 64);
  check('TUTORIAL_HINT_TEXTS first is WASD', tutorial.TUTORIAL_HINT_TEXTS[0].includes('WASD'));
  check('TUTORIAL_HINT_TEXTS includes Q shift', tutorial.TUTORIAL_HINT_TEXTS.some(t => t.includes('Q')));
  check('TUTORIAL_HINT_TEXTS includes break', tutorial.TUTORIAL_HINT_TEXTS.some(t => t.toLowerCase().includes('break')));
  check('TUTORIAL_HINT_TEXTS includes place', tutorial.TUTORIAL_HINT_TEXTS.some(t => t.toLowerCase().includes('place')));
  check('TUTORIAL_HINT_TEXTS includes echo', tutorial.TUTORIAL_HINT_TEXTS.some(t => t.toLowerCase().includes('echo')));
  check('TUTORIAL_HINT_TEXTS includes stabilizer', tutorial.TUTORIAL_HINT_TEXTS.some(t => t.toLowerCase().includes('stabilizer')));

  // tutorialPositions
  const positions = tutorial.tutorialPositions(0, 30, 0);
  check('tutorialPositions returns stone, phaseRow, echo, stabilizer',
    positions.stone && positions.phaseRow && positions.echo && positions.stabilizer);
  check('tutorialPositions stone at (2, 31, 0)', positions.stone.x === 2 && positions.stone.y === 31 && positions.stone.z === 0);
  check('tutorialPositions phaseRow has 5 cells', positions.phaseRow.length === 5);
  check('tutorialPositions phaseRow alternates obsidian/void',
    positions.phaseRow[0].blockId === 4 && positions.phaseRow[1].blockId === 5);
  check('tutorialPositions echo at (-2, 30, -2)', positions.echo.x === -2 && positions.echo.y === 30 && positions.echo.z === -2);
  check('tutorialPositions stabilizer at (2, 30, -2)', positions.stabilizer.x === 2 && positions.stabilizer.y === 30 && positions.stabilizer.z === -2);

  // hintIndexFor
  check('hintIndexFor 0 returns 0', tutorial.hintIndexFor(0) === 0);
  check('hintIndexFor 4 returns 0', tutorial.hintIndexFor(4) === 0);
  check('hintIndexFor 8 returns 1', tutorial.hintIndexFor(8) === 1);
  check('hintIndexFor 16 returns 2', tutorial.hintIndexFor(16) === 2);
  check('hintIndexFor 100 returns 7 (last)', tutorial.hintIndexFor(100) === 7);
  check('hintIndexFor NaN returns 0', tutorial.hintIndexFor(NaN) === 0);
  check('hintIndexFor negative returns 0', tutorial.hintIndexFor(-5) === 0);

  // createTutorialState
  const s = tutorial.createTutorialState();
  check('createTutorialState returns fresh state',
    s.active === false && s.elapsed === 0 && s.currentHint === 0 && s.generated === false);

  // startTutorial
  const s2 = tutorial.startTutorial(s, { x: 0, y: 30, z: 0 }, 0);
  check('startTutorial sets active=true', s2.active === true);
  check('startTutorial resets elapsed to 0', s2.elapsed === 0);
  check('startTutorial resets currentHint to 0', s2.currentHint === 0);
  check('startTutorial stores playerPos', s2.playerPos.x === 0 && s2.playerPos.y === 30);

  // tickTutorial - the pure module clamps dt to 0.1 (100ms)
  // per call (matches the §3.2 collapse / §2.7 anchor / §3.5
  // glider pattern), so we tick many times to accumulate time.
  let t1 = { done: false, hintIndex: 0, hint: null };
  for (let i = 0; i < 40 && !t1.done; i++) t1 = tutorial.tickTutorial(s2, 0.1, i * 0.1);
  check('tickTutorial before 8s returns done=false', t1.done === false);
  check('tickTutorial before 8s returns hintIndex=0', t1.hintIndex === 0);
  check('tickTutorial before 8s returns hint text', typeof t1.hint === 'string' && t1.hint.length > 0);
  // Continue to hintIndex=1 (need to advance to 8-16s window)
  let t2 = { done: false, hintIndex: 0, hint: null };
  for (let i = 0; i < 100 && t2.hintIndex < 1; i++) t2 = tutorial.tickTutorial(s2, 0.1, i * 0.1);
  check('tickTutorial at 12s returns hintIndex=1', t2.hintIndex === 1);
  // Continue past 64s for done=true
  let t3 = { done: false, hintIndex: 0, hint: null };
  for (let i = 0; i < 1000 && !t3.done; i++) t3 = tutorial.tickTutorial(s2, 0.1, i * 0.1);
  check('tickTutorial past 64s returns done=true', t3.done === true);

  // tickTutorial non-active state
  const s3 = tutorial.createTutorialState();
  const t4 = tutorial.tickTutorial(s3, 1, 1);
  check('tickTutorial non-active returns done=false', t4.done === false);
  check('tickTutorial non-active returns hint=null', t4.hint === null);

  // clearTutorial
  const s4 = tutorial.startTutorial(tutorial.createTutorialState(), { x: 0, y: 30, z: 0 }, 0);
  tutorial.clearTutorial(s4);
  check('clearTutorial sets active=false', s4.active === false);
  check('clearTutorial resets elapsed to 0', s4.elapsed === 0);

  // getHint
  check('getHint(0) returns first hint',
    tutorial.getHint(0).hint === tutorial.TUTORIAL_HINT_TEXTS[0]);
  check('getHint(8) returns second hint',
    tutorial.getHint(8).hint === tutorial.TUTORIAL_HINT_TEXTS[1]);
  check('getHint(100) returns last hint',
    tutorial.getHint(100).hint === tutorial.TUTORIAL_HINT_TEXTS[7]);

  // isWithinTutorialRing
  check('isWithinTutorialRing true for player at center', tutorial.isWithinTutorialRing(0, 30, 0, 0, 30, 0) === true);
  check('isWithinTutorialRing true for player at edge', tutorial.isWithinTutorialRing(4, 30, 0, 0, 30, 0) === true);
  check('isWithinTutorialRing false for player far away', tutorial.isWithinTutorialRing(20, 30, 0, 0, 30, 0) === false);
  check('isWithinTutorialRing false for null inputs', tutorial.isWithinTutorialRing(NaN, 30, 0, 0, 30, 0) === false);

  // TUTORIAL_DEFAULTS
  check('TUTORIAL_DEFAULTS has expected keys',
    tutorial.TUTORIAL_DEFAULTS.radius === 4 &&
    tutorial.TUTORIAL_DEFAULTS.hintDuration === 8 &&
    tutorial.TUTORIAL_DEFAULTS.hintCount === 8);

  // ── 3) Behavior - World integration ────────────────────────
  console.log('\n=== Phase 3.6 behavior - World integration ===');
  const w = new World(() => {});
  w.updateChunks(0, 0, 3);
  // Generate the tutorial at (0, 30, 0)
  const p = tutorial.tutorialPositions(0, 30, 0);
  // Set the stone
  w.setBlock(p.stone.x, p.stone.y, p.stone.z, 0, 1); // Stone in Alpha
  check('Tutorial stone placed', w.getBlock(p.stone.x, p.stone.y, p.stone.z, 0) === 1);
  // Set the phase row
  for (const cell of p.phaseRow) {
    w.setBlock(cell.x, cell.y, cell.z, 0, cell.blockId);
  }
  check('Tutorial phase row first is Obsidian', w.getBlock(p.phaseRow[0].x, p.phaseRow[0].y, p.phaseRow[0].z, 0) === 4);
  check('Tutorial phase row second is Void', w.getBlock(p.phaseRow[1].x, p.phaseRow[1].y, p.phaseRow[1].z, 0) === 5);
  // Set the stabilizer
  w.setBlock(p.stabilizer.x, p.stabilizer.y, p.stabilizer.z, 0, 15); // BLOCK_STABILIZER
  check('Tutorial stabilizer placed', w.getBlock(p.stabilizer.x, p.stabilizer.y, p.stabilizer.z, 0) === 15);

  // ── 4) Static analysis of main.js + hud.js + index.html ─────
  console.log('\n=== Phase 3.6 static-analysis (main + hud + html) ===');
  check('main.js imports tutorial', /import\s*\{[^}]*tutorial[^}]*\}\s*from\s*['"]\.\/src\/tutorial\/tutorial\.js['"]/.test(mainText));
  check('main.js has forceGenerateTutorial hook', /__phaseShifter__[\s\S]*?forceGenerateTutorial\s*\(/.test(mainText));
  check('main.js has tickTutorialPerFrame', /function\s+tickTutorialPerFrame\s*\(\s*dt\s*\)/.test(mainText));
  check('main.js has getTutorialHint', /__phaseShifter__[\s\S]*?getTutorialHint\s*\(/.test(mainText));
  check('main.js tutorialState module-level', /let\s+tutorialState\s*=\s*createTutorialState/.test(mainText));
  check('hud.js has setTutorialHint method', /setTutorialHint\s*\(\s*text/.test(hudText));
  check('hud.js has clearTutorialHint method', /clearTutorialHint\s*\(/.test(hudText));
  check('index.html has #tutorial-hint element', /id\s*=\s*["']tutorial-hint["']/.test(htmlText));
  check('index.html has #tutorial-hint CSS', /#tutorial-hint\s*\{/.test(htmlText));

  console.log(`\n=== Phase 3.6 TOTAL: ${passed}/${passed + failed} passed ===`);
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
