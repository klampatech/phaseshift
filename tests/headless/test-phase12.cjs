#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.2 standalone runner. Two parts:
//   1) Static-analysis of main.js (no browser needed) — checks the old broken
//      atan2() camera formula is gone and the new follow + quaternion basis
//      are present.
//   2) Behavioral test of the movement-basis math using real Three.js.
//
// The full Playwright smoke test (tests/headless/smoke.cjs) also runs the
// same static-analysis checks; this file is for fast local verification.
//
// Usage:
//   node tests/headless/test-phase12.cjs
//   sudo -E -n node tests/headless/test-phase12.cjs   # if dist/ is read-restricted

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const mainSrc = path.join(ROOT, 'main.js');
const srcText = fs.readFileSync(mainSrc, 'utf8');

console.log('=== Phase 1.2 static-analysis (main.js) ===');

const checks = [];

// Old broken formula: atan2(camera.position.x - pos.x, camera.position.z - pos.z)
const OLD = /atan2\s*\(\s*camera\.position\.x\s*-\s*pos\.x/;
// New camera-follow: camera.position.set(p.x, p.y + EYE_HEIGHT, p.z)
const NEW_FOLLOW = /camera\.position\.set\s*\(\s*_camFollowPos\.x\s*,\s*_camFollowPos\.y\s*\+\s*EYE_HEIGHT\s*,\s*_camFollowPos\.z\s*\)/;
// New quaternion-derived basis: applyQuaternion(camera.quaternion)
const NEW_BASIS = /applyQuaternion\s*\(\s*camera\.quaternion\s*\)/;
// Sprint speed multiplier (sanity)
const SPRINT = /ctrlState\.sprint\s*\?\s*1\.5\s*:\s*1/;
// EYE_HEIGHT defined
const EYE_DEF = /\bEYE_HEIGHT\s*=\s*1\.6\b/;

function check(label, ok, extra) {
  checks.push({ label, ok });
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ' — ' + extra : ''}`);
}

check('old atan2(camera.position.x - ...) removed',
  !OLD.test(srcText), srcText.match(OLD)?.[0]);
check('camera.position.set(p.x, p.y + EYE_HEIGHT, p.z) present',
  NEW_FOLLOW.test(srcText), srcText.match(NEW_FOLLOW)?.[0]);
check('applyQuaternion(camera.quaternion) used for basis',
  NEW_BASIS.test(srcText), srcText.match(NEW_BASIS)?.[0]);
check('EYE_HEIGHT = 1.6 constant defined',
  EYE_DEF.test(srcText), srcText.match(EYE_DEF)?.[0]);
check('sprint multiplier 1.5 still present',
  SPRINT.test(srcText));

const fail = checks.filter(c => !c.ok).length;
console.log(`  → ${checks.length - fail}/${checks.length} static-analysis checks passed`);

// ── Behavioral test (real Three.js) ──────────────────────────────────────
console.log('\n=== Phase 1.2 movement-basis math (real Three.js) ===');

const THREE = require(require.resolve('three', { paths: [ROOT] }));

function computeDirection(yaw, pitch, moveX, moveZ, speed = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  fwd.y = 0; fwd.normalize();
  rgt.y = 0; rgt.normalize();
  return new THREE.Vector3()
    .addScaledVector(fwd, -moveZ)
    .addScaledVector(rgt,  moveX)
    .multiplyScalar(speed);
}

function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }
function approxVec(a, b, eps = 1e-6) {
  return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

const math = [];
function m(label, ok) {
  math.push({ label, ok });
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}`);
}

m('W (moveZ=-1) at identity → -Z', approxVec(computeDirection(0, 0, 0, -1), {x:0,y:0,z:-1}));
m('D (moveX=+1) at identity → +X', approxVec(computeDirection(0, 0, 1, 0), {x:1,y:0,z:0}));
m('A (moveX=-1) at identity → -X', approxVec(computeDirection(0, 0, -1, 0), {x:-1,y:0,z:0}));
m('S (moveZ=+1) at identity → +Z', approxVec(computeDirection(0, 0, 0, 1), {x:0,y:0,z:1}));
m('W with yaw=+90° → -X (camera-forward)', approxVec(computeDirection(Math.PI/2, 0, 0, -1), {x:-1,y:0,z:0}));
m('D with yaw=+90° → -Z (camera-right)',   approxVec(computeDirection(Math.PI/2, 0, 1, 0),  {x:0,y:0,z:-1}));
m('W with yaw=-90° → +X',                  approxVec(computeDirection(-Math.PI/2, 0, 0, -1), {x:1,y:0,z:0}));
m('W with yaw=180° → +Z',                  approxVec(computeDirection(Math.PI, 0, 0, -1), {x:0,y:0,z:1}));
m('W with pitch=+30° → -Z (pitch must NOT warp horizontal basis)',
  approxVec(computeDirection(0, Math.PI/6, 0, -1), {x:0,y:0,z:-1}));
m('W with pitch=+30° yaw=+90° → -X',
  approxVec(computeDirection(Math.PI/2, Math.PI/6, 0, -1), {x:-1,y:0,z:0}));
m('Sprint (speed=1.5) scales magnitude to 1.5',
  approxVec(computeDirection(0, 0, 0, -1, 1.5), {x:0,y:0,z:-1.5}));
m('W+D at identity → (1, 0, -1) magnitude √2 (diagonal-speed, not renormalized — out of scope for Phase 1.2)',
  approxVec(computeDirection(0, 0, 1, -1), {x:1,y:0,z:-1}) &&
  approx(Math.hypot(1, 0, -1), Math.SQRT2));

const mathFail = math.filter(c => !c.ok).length;
console.log(`  → ${math.length - mathFail}/${math.length} math checks passed`);

const allFail = fail + mathFail;
console.log(`\n=== Phase 1.2 TOTAL: ${checks.length + math.length - allFail}/${checks.length + math.length} passed ===`);
process.exit(allFail === 0 ? 0 : 1);
