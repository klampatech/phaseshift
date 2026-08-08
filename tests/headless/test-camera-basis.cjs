#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.2 movement-basis math test. Runs in plain Node (no browser).
// Uses the real Three.js bundle so we test the exact math main.js uses.
//
// In main.js (Phase 1.2):
//   forward = new Vector3(0,0,-1).applyQuaternion(camera.quaternion);
//   right   = new Vector3(1,0, 0).applyQuaternion(camera.quaternion);
//   forward.y = 0; forward.normalize();
//   right.y   = 0; right.normalize();
//   direction = forward*(-moveZ) + right*moveX   (multiplied by speed)
//
// Sign convention rationale: controls.js sets moveZ=-1 for W (forward).
// Three.js camera convention is forward = -Z at identity, so
//   direction = forward * (-moveZ)
// gives W → +forward = -Z at identity. ✓

// Use the cjs build directly. Three r160+ no longer supports the legacy
// `require('three')` resolution path from `package.json: "main"` (it points
// to the deprecated `build/three.js`); the `exports.require` map redirects
// `require('three')` to `build/three.cjs` but only in modern Node — using the
// direct path here keeps this working across Node/Three versions.
const THREE = require(
  require.resolve('three', { paths: [__dirname, '/home/kyle/Development/phaseshift'] })
);

// Mirrors main.js gameLoop movement code exactly.
function computeDirection(yaw, pitch, moveX, moveZ, speed = 1) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitch, yaw, 0, 'YXZ'),
  );
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  fwd.y = 0; fwd.normalize();
  rgt.y = 0; rgt.normalize();
  const d = new THREE.Vector3()
    .addScaledVector(fwd, -moveZ)
    .addScaledVector(rgt, moveX)
    .multiplyScalar(speed);
  return d;
}

function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }
function approxVec(a, b, eps = 1e-6) {
  return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

const cases = [];
function t(label, ok, extra) {
  cases.push({ label, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + JSON.stringify(extra) : ''}`);
}

// Empirical ground truth from Three.js r160:
//   yaw=0      → forward=(0,0,-1),  right=(1,0,0)
//   yaw=+90°   → forward=(-1,0,0),  right=(0,0,-1)
//   yaw=-90°   → forward=(1,0,0),   right=(0,0,1)
//   yaw=180°   → forward=(0,0,1),   right=(-1,0,0)
//   pitch=30°  → forward=(0,0.5,-0.866), right=(1,0,0)   → after y-zero+norm: fwd=(0,0,-1)

// Case 1: identity, W → camera-forward = -Z
t('W with identity look → -Z (camera-forward)',
  approxVec(computeDirection(0, 0, 0, -1, 1), { x: 0, y: 0, z: -1 }));

// Case 2: identity, D → camera-right = +X
t('D with identity look → +X (camera-right)',
  approxVec(computeDirection(0, 0, 1, 0, 1), { x: 1, y: 0, z: 0 }));

// Case 3: identity, A → -X (strafe-left)
t('A with identity look → -X',
  approxVec(computeDirection(0, 0, -1, 0, 1), { x: -1, y: 0, z: 0 }));

// Case 4: identity, S → +Z (camera-backward)
t('S with identity look → +Z',
  approxVec(computeDirection(0, 0, 0, 1, 1), { x: 0, y: 0, z: 1 }));

// Case 5: yaw=+90° (camera looks -X), W → -X
t('W with yaw=+90° → -X (camera-forward after yaw)',
  approxVec(computeDirection(Math.PI / 2, 0, 0, -1, 1), { x: -1, y: 0, z: 0 }));

// Case 6: yaw=+90°, D → -Z (camera-right after yaw is now -Z)
t('D with yaw=+90° → -Z',
  approxVec(computeDirection(Math.PI / 2, 0, 1, 0, 1), { x: 0, y: 0, z: -1 }));

// Case 7: yaw=-90° (camera looks +X), W → +X
t('W with yaw=-90° → +X',
  approxVec(computeDirection(-Math.PI / 2, 0, 0, -1, 1), { x: 1, y: 0, z: 0 }));

// Case 8: yaw=180° (camera looks +Z), W → +Z
t('W with yaw=180° → +Z',
  approxVec(computeDirection(Math.PI, 0, 0, -1, 1), { x: 0, y: 0, z: 1 }));

// Case 9: pitch=30° (camera tilts down), W → still -Z on XZ plane after y-zero + renormalize.
//         Critical: pitch must NOT warp the horizontal basis (this was the main
//         bug in the old atan2() formula).
t('W with pitch=+30° → -Z (horizontal basis unchanged)',
  approxVec(computeDirection(0, Math.PI / 6, 0, -1, 1), { x: 0, y: 0, z: -1 }));

// Case 10: pitch=30° + yaw=90°, W → -X (forward becomes -X; pitch again ignored on XZ plane)
t('W with pitch=+30° yaw=+90° → -X',
  approxVec(computeDirection(Math.PI / 2, Math.PI / 6, 0, -1, 1), { x: -1, y: 0, z: 0 }));

// Case 11: sprint scales magnitude to 1.5
t('W with sprint (speed=1.5) → -Z * 1.5',
  approxVec(computeDirection(0, 0, 0, -1, 1.5), { x: 0, y: 0, z: -1.5 }));

// Case 12: W+D at identity → (1, 0, -1) — magnitude √2 (diagonal speed, not renormalized)
//          Documented behavior: main.js does not pre-normalize moveX/moveZ. If
//          you want unit-length diagonals, normalize at the input stage; that
//          is NOT part of Phase 1.2.
{
  const d = computeDirection(0, 0, 1, -1, 1);
  t('W+D with identity look → (1, 0, -1) [magnitude √2]',
    approxVec(d, { x: 1, y: 0, z: -1 }) && approx(Math.hypot(d.x, d.z), Math.SQRT2, 1e-6));
}

// Case 13: look-straight-down + W — pitch = -PI/2 + tiny epsilon. Forward's
//          XZ component collapses to near-zero. y-zero + normalize would
//          divide by zero. The current implementation does not guard against
//          this; document the edge case.
{
  const d = computeDirection(0, -Math.PI / 2 + 1e-4, 0, -1, 1);
  // After y-zero, forward = (0, 0, ~0) and normalize() will set it to (NaN, 0, NaN)
  // if hypot is 0. Test that we at least don't crash and don't produce infinity.
  t('W with look-straight-down → finite or zero (no crash)',
    Number.isFinite(d.x) || d.x === 0);
}

const failed = cases.filter((c) => !c.ok).length;
const passed = cases.length - failed;
console.log(`\n${passed}/${cases.length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
