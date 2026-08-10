#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 3.5 verification: Phase Lock + Phase Glider
// The §3.5 work ports the orphan PhaseLockManager logic to the
// active path. A lock holds a block visible + solid in the new
// phase for LOCK_DURATION (10s) after a phase shift. The Phase
// Glider is a brief fly in Beta via Space.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const lockPath = path.join(ROOT, 'src', 'phase', 'lock.js');

const worldText = fs.readFileSync(worldPath, 'utf8');
const lockText = fs.readFileSync(lockPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}

// ── 1) Static analysis ───────────────────────────────────────
console.log('\n=== Phase 3.5 static-analysis (against source files) ===');
check('lock.js exports LOCK_DURATION = 10', /export\s+const\s+LOCK_DURATION\s*=\s*10\b/.test(lockText));
check('lock.js exports LOCK_FADE_WINDOW = 3', /export\s+const\s+LOCK_FADE_WINDOW\s*=\s*3\b/.test(lockText));
check('lock.js exports LOCK_RADIUS = 3', /export\s+const\s+LOCK_RADIUS\s*=\s*3\b/.test(lockText));
check('lock.js exports LOCK_FILL_COLOR', /export\s+const\s+LOCK_FILL_COLOR\s*=/.test(lockText));
check('lock.js exports LOCK_BORDER_COLOR', /export\s+const\s+LOCK_BORDER_COLOR\s*=/.test(lockText));
check('lock.js exports PHASE_GLIDER_DURATION', /export\s+const\s+PHASE_GLIDER_DURATION\s*=/.test(lockText));
check('lock.js exports PHASE_GLIDER_SPEED', /export\s+const\s+PHASE_GLIDER_SPEED\s*=/.test(lockText));
check('lock.js exports lockKey', /export\s+function\s+lockKey/.test(lockText));
check('lock.js exports createLock', /export\s+function\s+createLock/.test(lockText));
check('lock.js exports isLockExpired', /export\s+function\s+isLockExpired/.test(lockText));
check('lock.js exports lockFadeOpacity', /export\s+function\s+lockFadeOpacity/.test(lockText));
check('lock.js exports tickLocks', /export\s+function\s+tickLocks/.test(lockText));
check('lock.js exports isLocked', /export\s+function\s+isLocked/.test(lockText));
check('lock.js exports activeLocks', /export\s+function\s+activeLocks/.test(lockText));
check('lock.js exports lockRegion', /export\s+function\s+lockRegion/.test(lockText));
check('lock.js exports createGliderState', /export\s+function\s+createGliderState/.test(lockText));
check('lock.js exports startGlider', /export\s+function\s+startGlider/.test(lockText));
check('lock.js exports tickGlider', /export\s+function\s+tickGlider/.test(lockText));
check('lock.js exports clearGlider', /export\s+function\s+clearGlider/.test(lockText));

check('world.js has createLock method', /createLock\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*duration\s*\)/.test(worldText));
check('world.js has tickLocks method', /tickLocks\s*\(\s*dt\s*\)/.test(worldText));
check('world.js has isLocked method', /isLocked\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*\)/.test(worldText));
check('world.js has listLocks method', /listLocks\s*\(\s*\)/.test(worldText));
check('world.js has clearLocks method', /clearLocks\s*\(\s*\)/.test(worldText));
check('world.js has exportLocks method', /exportLocks\s*\(\s*\)/.test(worldText));
check('world.js has importLocks method', /importLocks\s*\(\s*snapshot\s*\)/.test(worldText));
check('world.js isBlockSolid considers locks', /isBlockSolid[\s\S]{0,500}?_phaseLocks/.test(worldText));

// ── 2) Behavior - pure module ─────────────────────────────────
console.log('\n=== Phase 3.5 behavior - lock.js pure module ===');
async function main() {
  const lockUrl = 'file://' + lockPath.replace(/\\/g, '/');
  const worldUrl = 'file://' + worldPath.replace(/\\/g, '/');
  const lock = await import(lockUrl);
  const { World } = await import(worldUrl);

  // Constants
  check('LOCK_DURATION === 10', lock.LOCK_DURATION === 10);
  check('LOCK_FADE_WINDOW === 3', lock.LOCK_FADE_WINDOW === 3);
  check('LOCK_RADIUS === 3', lock.LOCK_RADIUS === 3);
  check('LOCK_FILL_COLOR === 0xffee88', lock.LOCK_FILL_COLOR === 0xffee88);
  check('LOCK_BORDER_COLOR === 0xffcc00', lock.LOCK_BORDER_COLOR === 0xffcc00);
  check('PHASE_GLIDER_DURATION > 0', lock.PHASE_GLIDER_DURATION > 0);
  check('PHASE_GLIDER_SPEED > 0', lock.PHASE_GLIDER_SPEED > 0);

  // lockKey
  check('lockKey returns canonical "x,y,z,phase"',
    lock.lockKey(1.4, 2.6, 3.8, 1) === '1,2,3,1');
  check('lockKey returns null for non-finite', lock.lockKey(NaN, 2, 3, 1) === null);
  check('lockKey returns null for non-finite phase', lock.lockKey(1, 2, 3, NaN) === null);

  // createLock signature: createLock(x, y, z, phase, now, duration)
  const l1 = lock.createLock(0, 30, 0, 1, 100, 50);
  check('createLock returns canonical shape',
    l1.x === 0 && l1.y === 30 && l1.z === 0 && l1.phase === 1 && l1.expires === 150 && l1.key === '0,30,0,1' && l1.duration === 50);
  check('createLock uses default duration when not provided',
    lock.createLock(0, 30, 0, 1, 0).duration === 10);
  check('createLock uses default now when not provided',
    lock.createLock(0, 30, 0, 1).expires === lock.LOCK_DURATION);

  // isLockExpired
  check('isLockExpired true at expiry', lock.isLockExpired({ expires: 100 }, 100) === true);
  check('isLockExpired true after expiry', lock.isLockExpired({ expires: 100 }, 200) === true);
  check('isLockExpired false before expiry', lock.isLockExpired({ expires: 100 }, 50) === false);
  check('isLockExpired true for null lock', lock.isLockExpired(null, 50) === true);

  // lockFadeOpacity
  check('lockFadeOpacity is 1.0 when remaining > fade window',
    lock.lockFadeOpacity({ expires: 100 }, 96) === 1.0);
  check('lockFadeOpacity in (0, 1) when in fade window',
    lock.lockFadeOpacity({ expires: 100 }, 98.5) > 0 && lock.lockFadeOpacity({ expires: 100 }, 98.5) < 1);
  check('lockFadeOpacity is 0 when expired',
    lock.lockFadeOpacity({ expires: 100 }, 100) === 0);
  check('lockFadeOpacity is 0 for null lock', lock.lockFadeOpacity(null, 0) === 0);

  // tickLocks
  const locks = [
    { x: 0, y: 0, z: 0, phase: 0, expires: 100, key: '0,0,0,0' },
    { x: 1, y: 0, z: 0, phase: 0, expires: 50, key: '1,0,0,0' },
    { x: 2, y: 0, z: 0, phase: 0, expires: 200, key: '2,0,0,0' },
  ];
  const ticked = lock.tickLocks(locks, 75);
  check('tickLocks removes expired (75 vs 50)', ticked.length === 2);
  check('tickLocks keeps active', ticked[0].x === 0 && ticked[1].x === 2);
  check('tickLocks empty list returns empty', lock.tickLocks([], 0).length === 0);
  check('tickLocks non-array returns empty', lock.tickLocks(null, 0).length === 0);

  // isLocked
  check('isLocked true for present + active',
    lock.isLocked(locks, 0, 0, 0, 0, 50) === true);
  check('isLocked false for present + expired',
    lock.isLocked(locks, 1, 0, 0, 0, 75) === false);
  check('isLocked false for absent',
    lock.isLocked(locks, 99, 0, 0, 0, 50) === false);
  check('isLocked false for null list', lock.isLocked(null, 0, 0, 0, 0, 0) === false);

  // activeLocks
  check('activeLocks filters expired', lock.activeLocks(locks, 75).length === 2);
  check('activeLocks empty list returns empty', lock.activeLocks([], 0).length === 0);

  // lockRegion
  const region = lock.lockRegion(0, 0, 0, 1);
  check('lockRegion has correct cell count for radius 1',
    region.length === 3 * 3 * 6); // 3x3 (xy/z=1) * 6 Y range (-2 to +3)
  check('lockRegion includes (0,0,0)', region.some(c => c.x === 0 && c.y === 0 && c.z === 0));
  check('lockRegion includes (1,1,1)', region.some(c => c.x === 1 && c.y === 1 && c.z === 1));

  // createGliderState
  const gs = lock.createGliderState();
  check('createGliderState returns fresh state',
    gs.gliding === false && gs.timer === 0 && gs.duration > 0 && gs.speed > 0);

  // startGlider
  const gs2 = lock.startGlider(gs, { x: 1, y: 0, z: 0 }, 0);
  check('startGlider sets gliding=true', gs2.gliding === true);
  check('startGlider resets timer to 0', gs2.timer === 0);
  check('startGlider sets direction', gs2.direction.x === 1);
  check('startGlider handles null direction', lock.startGlider({}, null, 0).direction.x === 0);

  // tickGlider - the pure module clamps dt to 0.1 (100ms) per
  // call (matches the §3.2 collapse / §2.7 anchor pattern), so
  // we tick many times to accumulate time. The first tick is
  // expected to be done=false with dx > 0.
  let t1 = { done: false, dx: 0 };
  for (let i = 0; i < 5; i++) t1 = lock.tickGlider(gs2, 0.1);
  check('tickGlider before duration returns done=false', t1.done === false);
  check('tickGlider before duration returns dx > 0', t1.dx > 0);
  check('tickGlider advances timer', gs2.timer >= 0.5 - 0.0001 && gs2.timer <= 0.5 + 0.0001);
  // Continue ticking past the duration (1.2s default). Capture
  // the FIRST tick that reports done=true (subsequent ticks are
  // on a non-gliding state).
  let t2 = { done: false, dx: 0 };
  for (let i = 0; i < 20 && !t2.done; i++) t2 = lock.tickGlider(gs2, 0.1);
  check('tickGlider after duration returns done=true', t2.done === true);
  check('tickGlider after duration returns dx = 0', t2.dx === 0);

  // tickGlider on non-gliding state
  const gs3 = lock.createGliderState();
  const t3 = lock.tickGlider(gs3, 0.5);
  check('tickGlider non-gliding returns done=false', t3.done === false);
  check('tickGlider non-gliding returns dx=0', t3.dx === 0);

  // clearGlider
  const gs4 = lock.startGlider(lock.createGliderState(), { x: 1, y: 0, z: 0 }, 0);
  lock.clearGlider(gs4);
  check('clearGlider sets gliding=false', gs4.gliding === false);

  // PHASE_LOCK_DEFAULTS
  check('PHASE_LOCK_DEFAULTS has expected keys',
    lock.PHASE_LOCK_DEFAULTS.duration === 10 &&
    lock.PHASE_LOCK_DEFAULTS.fadeWindow === 3 &&
    lock.PHASE_LOCK_DEFAULTS.radius === 3);

  // ── 3) Behavior - World API ───────────────────────────────────
  console.log('\n=== Phase 3.5 behavior - World phase lock API ===');
  const w = new World(() => {});
  w.updateChunks(0, 0);
  const lock1 = w.createLock(0, 30, 0, 1);
  check('World.createLock creates a lock', lock1 !== null && lock1.key === '0,30,0,1' && lock1.phase === 1);
  check('World.isLocked true after createLock', w.isLocked(0, 30, 0, 1) === true);
  check('World.isLocked false for other cell', w.isLocked(99, 30, 0, 1) === false);
  check('World.isLocked false for other phase', w.isLocked(0, 30, 0, 0) === false);
  check('World.getLockCount === 1', w.getLockCount() === 1);
  check('World.getLockKeys includes the key', w.getLockKeys().includes('0,30,0,1'));
  check('World.listLocks returns the lock', w.listLocks().length === 1);
  // Idempotent: re-locking the same cell refreshes duration
  const lock2 = w.createLock(0, 30, 0, 1);
  check('World.createLock idempotent for same key', lock2 !== null && lock2.key === '0,30,0,1');
  // Different phase on same cell
  w.createLock(0, 30, 0, 0);
  check('World.createLock allows different phase on same cell', w.getLockCount() === 2);
  // export + import
  const snap = w.exportLocks();
  check('World.exportLocks returns array', Array.isArray(snap) && snap.length === 2);
  const w2 = new World(() => {});
  w2.importLocks(snap);
  check('World.importLocks restores locks', w2.getLockCount() === 2);
  // importLocks defensive
  w2.importLocks(null);
  check('World.importLocks(null) clears locks', w2.getLockCount() === 0);
  w2.importLocks('not-an-array');
  check('World.importLocks("not-an-array") clears locks', w2.getLockCount() === 0);
  w2.importLocks([{ x: NaN, y: 30, z: 0, phase: 1 }]);
  check('World.importLocks filters invalid entries', w2.getLockCount() === 0);
  w2.importLocks([{ x: 5, y: 30, z: 5, phase: 1, expires: 0, duration: 10 }]);
  check('World.importLocks pushes past expires forward', w2.getLockCount() === 1);
  // clearLocks
  w.clearLocks();
  check('World.clearLocks wipes all locks', w.getLockCount() === 0);
  // tickLocks
  w.createLock(0, 30, 0, 1, 10);
  w.createLock(1, 30, 0, 1, 10);
  w.tickLocks(0.016);
  check('World.tickLocks keeps active locks', w.getLockCount() === 2);
  // Lock affects collision: place an Obsidian (only solid in Gamma),
  // then lock the cell in Beta (where Obsidian is normally non-solid).
  // Then isBlockSolid(0, 30, 0, 1) should be true (locked overrides).
  w.clearLocks(); // remove any leftover locks from earlier sections
  w.setBlock(0, 30, 0, 0, 4); // Obsidian (id 4) in Alpha
  check('Obsidian is not solid in Beta normally', w.isBlockSolid(0, 30, 0, 1) === false);
  w.createLock(0, 30, 0, 1);
  check('Locked Obsidian is solid in Beta', w.isBlockSolid(0, 30, 0, 1) === true);
  w.clearLocks();
  check('Unlocked Obsidian is not solid in Beta again', w.isBlockSolid(0, 30, 0, 1) === false);

  console.log(`\n=== Phase 3.5 TOTAL: ${passed}/${passed + failed} passed ===`);
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
