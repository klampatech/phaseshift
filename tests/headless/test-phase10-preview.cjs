#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 10.12 — Phase shift preview (0.5s ghost before commit).
//
// §10.12 acceptance:
// - PREVIEW_SECONDS = 0.5 (ghost duration).
// - PHASE_SHIFT_DURATION = 1.5 (total shift time, matches PhaseManager).
// - PEAK_PREVIEW_AMOUNT = 0.6 (peak ghost intensity, the renderer
//   never reads a value > PEAK_PREVIEW_AMOUNT from previewAmount).
// - previewAmount(progress) returns 0 at p=0, PEAK at p=fadeIn/1, 0
//   at p=1, and the fadeIn / fadeOut curve in between.
// - previewColorFromHex parses #rrggbb to normalized { r, g, b }.
// - previewColor(phase) returns the correct PHASE_COLORS triplet.
// - shouldRunPreview(progress) returns true only for 0 < p < 1.
// - Renderer setupPostProcessing wires a previewPass + an
//   updatePhaseShiftPreview(amount, color) method.
// - main.js imports the preview module + drives the shader pass
//   from updatePhaseShiftPreviewPerFrame + exposes the
//   __phaseShifter__.phaseShiftPreview debug surface.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const previewPath = path.join(ROOT, 'src', 'render', 'phaseShiftPreview.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const mainPath = path.join(ROOT, 'main.js');

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log("  " + (ok ? "OK " : "BAD") + " " + label + (extra ? " — " + extra : ""));
}

(async () => {
  console.log('=== Phase 10.12 — Phase shift preview ===\n');

  const pv = await import(pathToFileURL(previewPath).href);
  const constants = await import(pathToFileURL(constantsPath).href);

  // 1. Module exports.
  check('preview module exports PHASE_SHIFT_DURATION',
    pv.PHASE_SHIFT_DURATION === 1.5);
  check('preview module exports PREVIEW_SECONDS',
    pv.PREVIEW_SECONDS === 0.5);
  check('preview module exports PEAK_PREVIEW_AMOUNT',
    pv.PEAK_PREVIEW_AMOUNT === 0.6);
  check('preview module exports previewAmount',
    typeof pv.previewAmount === 'function');
  check('preview module exports previewColorFromHex',
    typeof pv.previewColorFromHex === 'function');
  check('preview module exports previewColor',
    typeof pv.previewColor === 'function');
  check('preview module exports shouldRunPreview',
    typeof pv.shouldRunPreview === 'function');

  // 2. previewAmount math.
  check('previewAmount(0) === 0', pv.previewAmount(0) === 0);
  const fadeIn = pv.PREVIEW_SECONDS / pv.PHASE_SHIFT_DURATION; // ≈ 0.333
  check('previewAmount(fadeIn/2) ≈ PEAK_PREVIEW/2',
    Math.abs(pv.previewAmount(fadeIn / 2) - pv.PEAK_PREVIEW_AMOUNT / 2) < 0.001,
    `got ${pv.previewAmount(fadeIn / 2)}`);
  check('previewAmount(fadeIn) ≈ PEAK_PREVIEW_AMOUNT',
    Math.abs(pv.previewAmount(fadeIn) - pv.PEAK_PREVIEW_AMOUNT) < 0.001,
    `got ${pv.previewAmount(fadeIn)}`);
  // Peak should be at fadeIn (≈ 0.333), then fade out.
  const midPoint = (fadeIn + 1.0) / 2;
  check('previewAmount(midPoint) is between 0 and PEAK',
    pv.previewAmount(midPoint) > 0
      && pv.previewAmount(midPoint) < pv.PEAK_PREVIEW_AMOUNT,
    `got ${pv.previewAmount(midPoint)}`);
  check('previewAmount(1) === 0', pv.previewAmount(1) === 0);
  check('previewAmount(1.1) === 0 (clamped past end)',
    pv.previewAmount(1.1) === 0);

  // Defensive.
  check('previewAmount(NaN) === 0', pv.previewAmount(NaN) === 0);
  check('previewAmount(-1) === 0', pv.previewAmount(-1) === 0);

  // 3. previewColorFromHex.
  const green = pv.previewColorFromHex('#5aa85a');
  check('previewColorFromHex("#5aa85a") r ≈ 0.353',
    Math.abs(green.r - 0x5a / 255) < 0.001);
  check('previewColorFromHex("#5aa85a") g ≈ 0.659',
    Math.abs(green.g - 0xa8 / 255) < 0.001);
  check('previewColorFromHex("#5aa85a") b ≈ 0.353',
    Math.abs(green.b - 0x5a / 255) < 0.001);

  // Defensive.
  check('previewColorFromHex(123) falls back to white',
    pv.previewColorFromHex(123).r === 1
      && pv.previewColorFromHex(123).g === 1
      && pv.previewColorFromHex(123).b === 1);
  check('previewColorFromHex("#xyz") falls back to white',
    pv.previewColorFromHex('#xyz').r === 1);

  // 4. previewColor(phase).
  const alphaC = pv.previewColor(0);
  const betaC = pv.previewColor(1);
  const gammaC = pv.previewColor(2);
  check('previewColor(0) matches PHASE_COLORS[0]',
    Math.abs(alphaC.r - 0x5a / 255) < 0.001);
  check('previewColor(1) matches PHASE_COLORS[1]',
    Math.abs(betaC.r - 0x33 / 255) < 0.001);
  check('previewColor(2) matches PHASE_COLORS[2]',
    Math.abs(gammaC.r - 0xd9 / 255) < 0.001);

  // Defensive.
  check('previewColor(NaN) falls back to PHASE_COLORS[0]',
    pv.previewColor(NaN).r === alphaC.r);
  check('previewColor(99) falls back to PHASE_COLORS[0]',
    pv.previewColor(99).r === alphaC.r);

  // 5. shouldRunPreview.
  check('shouldRunPreview(0) === false', pv.shouldRunPreview(0) === false);
  check('shouldRunPreview(0.5) === true', pv.shouldRunPreview(0.5) === true);
  check('shouldRunPreview(1) === false', pv.shouldRunPreview(1) === false);
  check('shouldRunPreview(NaN) === false', pv.shouldRunPreview(NaN) === false);

  // 6. Constants module.
  check('PHASE_COLORS has 3 entries',
    Array.isArray(constants.PHASE_COLORS) && constants.PHASE_COLORS.length === 3);

  // 7. Renderer wiring.
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  check('renderer.js setupPostProcessing wires previewPass',
    /previewPass\s*=\s*new\s+ShaderPass\(previewShader\)/.test(rendererText));
  check('renderer.js has uPreviewAmount uniform',
    /uPreviewAmount:\s*\{\s*value:\s*0\.0\s*\}/.test(rendererText));
  check('renderer.js has uPreviewColor uniform',
    /uPreviewColor:\s*\{\s*value:\s*new\s+THREE\.Vector3/.test(rendererText));
  check('renderer.js shader pass returns previewPass',
    /return\s*\{[\s\S]{0,400}?previewPass,/.test(rendererText));
  check('renderer.js exposes updatePhaseShiftPreview(amount, color)',
    /updatePhaseShiftPreview\s*\(\s*amount\s*,\s*color\s*\)/.test(rendererText));
  check('renderer.js updatePhaseShiftPreview sets uPreviewAmount',
    /updatePhaseShiftPreview\s*\(\s*amount\s*,\s*color\s*\)\s*\{[\s\S]{0,500}?uPreviewAmount\.value\s*=/.test(rendererText));

  // 8. main.js wiring.
  const mainText = fs.readFileSync(mainPath, 'utf8');
  check('main.js imports from src/render/phaseShiftPreview.js',
    /from\s+['"]\.\/src\/render\/phaseShiftPreview\.js['"]/.test(mainText));
  check('main.js imports previewAmount',
    /import\s*\{[^}]*previewAmount[^}]*\}\s*from\s+['"]\.\/src\/render\/phaseShiftPreview\.js['"]/.test(mainText));
  check('main.js imports previewColor',
    /import\s*\{[^}]*previewColor[^}]*\}\s*from\s+['"]\.\/src\/render\/phaseShiftPreview\.js['"]/.test(mainText));
  check('main.js imports shouldRunPreview',
    /import\s*\{[^}]*shouldRunPreview[^}]*\}\s*from\s+['"]\.\/src\/render\/phaseShiftPreview\.js['"]/.test(mainText));
  check('main.js has updatePhaseShiftPreviewPerFrame function',
    /function\s+updatePhaseShiftPreviewPerFrame\s*\(/.test(mainText));
  check('main.js game loop calls updatePhaseShiftPreviewPerFrame',
    /updatePhaseShiftPreviewPerFrame\s*\(\s*\)/.test(mainText));
  check('main.js updatePhaseShiftPreviewPerFrame reads _isShifting',
    /updatePhaseShiftPreviewPerFrame[\s\S]{0,1000}?_isShifting/.test(mainText));
  check('main.js updatePhaseShiftPreviewPerFrame uses previewAmount',
    /updatePhaseShiftPreviewPerFrame[\s\S]{0,1000}?previewAmount\(/.test(mainText));
  check('main.js updatePhaseShiftPreviewPerFrame uses previewColor',
    /updatePhaseShiftPreviewPerFrame[\s\S]{0,1500}?previewColor\(/.test(mainText));
  check('main.js exports phaseShiftPreview debug hook',
    /phaseShiftPreview:\s*\{[\s\S]{0,2000}?getProgress/.test(mainText));
  check('main.js phaseShiftPreview.getPreviewAmount exists',
    /phaseShiftPreview:\s*\{[\s\S]{0,2000}?getPreviewAmount/.test(mainText));
  check('main.js phaseShiftPreview.forcePreviewForTest exists',
    /phaseShiftPreview:\s*\{[\s\S]{0,2000}?forcePreviewForTest/.test(mainText));

  // Summary.
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log("\n=== Phase 10.12 TOTAL: " + passed + "/" + results.length + " passed ===");
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('Phase 10.12 test crashed:', err);
  process.exit(1);
});
