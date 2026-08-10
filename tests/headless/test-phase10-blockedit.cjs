#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.7 — Drop LMB/RMB block edit + fix UI labels (Path A).
//
// §10.7 Path A acceptance:
// - LMB no longer breaks blocks (no breakBlock() call in click handler)
// - RMB no longer places blocks (no tryPlaceStoneOnFace() call in contextmenu)
// - The placeBlock helper is kept as a debug hook (Phase 2.3 test-phase23
//   still passes).
// - Blocker UI labels in index.html are accurate:
//   - Q = Resonance (NOT Phase Step)
//   - E = Phase Lens (NOT Phase Walk)
//   - F = Phase Fuse (new mechanic, §10.2)
//   - LMB = no break
//   - RMB = no place
// - Tutorial no longer teaches break/place (3.6 test updated)
// - README Controls section reflects the new verbs

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const htmlPath = path.join(ROOT, 'index.html');
const tutorialPath = path.join(ROOT, 'src', 'tutorial', 'tutorial.js');
const readmePath = path.join(ROOT, 'README.md');
const controlsPath = path.join(ROOT, 'src', 'input', 'controls.js');
const placeBlockPath = path.join(ROOT, 'src', 'input', 'placeBlock.js');

const mainText = fs.readFileSync(mainPath, 'utf8');
const htmlText = fs.readFileSync(htmlPath, 'utf8');
const tutorialText = fs.readFileSync(tutorialPath, 'utf8');
const readmeText = fs.readFileSync(readmePath, 'utf8');
const controlsText = fs.readFileSync(controlsPath, 'utf8');
const placeBlockText = fs.readFileSync(placeBlockPath, 'utf8');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

console.log('=== Phase 10.7 — Drop LMB/RMB block edit + fix UI labels ===\n');

// 1. main.js — LMB click handler does NOT call breakBlock.
check('main.js click handler no longer calls breakBlock()',
  !/addEventListener\(\s*['"]click['"][\s\S]{0,500}?breakBlock\s*\(\s*\)/.test(mainText));

// 2. main.js — contextmenu handler does NOT call tryPlaceStoneOnFace.
check('main.js contextmenu handler no longer calls tryPlaceStoneOnFace',
  !/addEventListener\(\s*['"]contextmenu['"][\s\S]{0,500}?tryPlaceStoneOnFace/.test(mainText));

// 3. main.js — contextmenu still calls cyclePhase (Phase 2.1 contract).
check('main.js contextmenu handler still calls cyclePhase()',
  /addEventListener\(\s*['"]contextmenu['"][\s\S]{0,500}?cyclePhase\s*\(\s*\)/.test(mainText));

// 4. main.js — click handler still calls placeAnchor() (Shift+LMB Phase Anchor).
check('main.js click handler still calls placeAnchor() on Shift+LMB',
  /addEventListener\(\s*['"]click['"][\s\S]{0,500}?placeAnchor\s*\(\s*\)/.test(mainText));

// 5. placeBlock.js — the helper still exists (debug hook path).
check('src/input/placeBlock.js still exports placeBlock',
  /export\s+function\s+placeBlock\s*\(/.test(placeBlockText));

// 6. index.html — blocker UI labels are accurate.
check('index.html: Q is labelled Resonance (not Phase Step)',
  !/Q[\s\S]{0,30}Phase Step/.test(htmlText) && /Q[\s\S]{0,30}Resonance/.test(htmlText));
check('index.html: E is labelled Phase Lens (not Phase Walk)',
  !/E[\s\S]{0,30}Phase Walk/.test(htmlText) && /E[\s\S]{0,30}Phase Lens/.test(htmlText));
check('index.html: F is labelled Phase Fuse',
  /F[\s\S]{0,40}Phase Fuse/.test(htmlText));
check('index.html: no "LMB Break block" label',
  !/LMB[\s\S]{0,40}Break block/.test(htmlText));
check('index.html: no "RMB Place block" label',
  !/RMB[\s\S]{0,40}Place block/.test(htmlText));

// 7. tutorial.js — no break/place steps.
check('tutorial.js no longer teaches "Break the Stone block"',
  !/Break the Stone block/.test(tutorialText));
check('tutorial.js no longer teaches "Place a block with Right Click"',
  !/Place a block with Right Click/.test(tutorialText));
check('tutorial.js teaches Phase Fuse',
  /fuse a block permanently/.test(tutorialText));

// 8. controls.js — F is for fusing, not for toggleAnchor.
check('controls.js: KeyF sets fusing=true (not toggleAnchor)',
  /case\s+['"]KeyF['"]:\s*this\.state\.fusing\s*=\s*true/.test(controlsText) &&
  !/case\s+['"]KeyF['"]:\s*this\.state\.toggleAnchor\s*=\s*true/.test(controlsText));

// 9. README — Controls section reflects the new verbs.
check('README: Controls section mentions Phase Fuse (F hold 3s)',
  /Phase Fuse.*hold 3s/.test(readmeText) || /F.*Phase Fuse/.test(readmeText));
check('README: no "LMB Break block" entry',
  !/LMB[\s\S]{0,40}Break block/.test(readmeText));
check('README: no "RMB Place block" entry',
  !/RMB[\s\S]{0,40}Place block/.test(readmeText));

// Summary.
const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log("\n=== Phase 10.7 TOTAL: " + passed + "/" + results.length + " passed ===");
if (failed > 0) {
  process.exit(1);
}
