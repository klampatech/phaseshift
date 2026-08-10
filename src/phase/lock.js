/**
 * Phase Shifter - Phase Lock (Phase 3.5)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's `LockOverlay` and the game loop's per-frame lock
 * tick both delegate to the helpers here so the lock duration,
 * the fade math, the lock key format, and the collision helper
 * are all in one place.
 *
 * The §3.5 brief calls for:
 *   - a 10-second lock duration (matching the §2.7 anchor)
 *   - a 3-block radius around the player on phase shift
 *   - the lock makes the block solid in the new phase even if
 *     the block is normally transparent in that phase (e.g.
 *     a Stone block in Alpha becomes solid in Beta after lock)
 *   - a fade window in the last 3 seconds (pulsing opacity)
 *   - the lock expires after LOCK_DURATION, freeing the block
 *     to its normal phase-relative solidity
 *
 * The helpers here are pure functions over plain data. The
 * `lockList` argument is `Array<{ x, y, z, phase, expires }>` -
 * the caller's job to flatten `world._phaseLocks.values()` (or
 * pass the locks directly from a save). Kept as a plain array so
 * the helpers can be unit-tested without loading the World class.
 */

// - Canonical constants -

/** The §3.5 lock duration (seconds). */
export const LOCK_DURATION = 10;

/** The §3.5 fade window (seconds) - the lock pulses in the
 *  last N seconds before expiry (mirror of §2.7 anchor). */
export const LOCK_FADE_WINDOW = 3;

/** The §3.5 lock radius (blocks) - locks the player on phase
 *  shift to blocks within this radius. */
export const LOCK_RADIUS = 3;

/** The §3.5 lock overlay fill color (yellow-white glow). */
export const LOCK_FILL_COLOR = 0xffee88;

/** The §3.5 lock overlay border color (bright yellow). */
export const LOCK_BORDER_COLOR = 0xffcc00;

/** The §3.5 phase-glider fly duration (seconds) when Space is
 *  held in Beta phase. */
export const PHASE_GLIDER_DURATION = 1.2;

/** The §3.5 phase-glider fly speed (blocks per second). */
export const PHASE_GLIDER_SPEED = 6.0;

// - Helpers -

/** Canonical "x,y,z,phase" key for the world's lock map. */
export function lockKey(x, y, z, phase) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (!Number.isFinite(phase)) return null;
  return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)},${Math.floor(phase)}`;
}

/** Create a fresh lock data object. */
export function createLock(x, y, z, phase, now, duration) {
  const dur = (typeof duration === 'number' && Number.isFinite(duration)) ? duration : LOCK_DURATION;
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    phase: Math.floor(phase),
    expires: t + dur,
    duration: dur,
    key: lockKey(x, y, z, phase),
  };
}

/** Is this lock expired at `now`? */
export function isLockExpired(lock, now) {
  if (!lock) return true;
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  return t >= (lock.expires || 0);
}

/** Compute the fade opacity for a lock at `now` (full opacity
 *  until the last LOCK_FADE_WINDOW seconds, then pulses). */
export function lockFadeOpacity(lock, now) {
  if (!lock) return 0;
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  const remaining = (lock.expires || 0) - t;
  if (remaining <= 0) return 0;
  if (remaining > LOCK_FADE_WINDOW) return 1.0;
  // Pulse effect in the fade window
  const t2 = LOCK_FADE_WINDOW - remaining;
  return 0.2 + 0.3 * Math.abs(Math.sin(t2 * Math.PI * 1.5));
}

/** Tick the lock list - returns the list with expired locks removed. */
export function tickLocks(lockList, now) {
  if (!Array.isArray(lockList)) return [];
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  return lockList.filter(l => !isLockExpired(l, t));
}

/** Check if a (x, y, z, phase) cell is locked in the given list. */
export function isLocked(lockList, x, y, z, phase, now) {
  if (!Array.isArray(lockList)) return false;
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  for (let i = 0; i < lockList.length; i++) {
    const l = lockList[i];
    if (!l) continue;
    if (l.x === Math.floor(x) && l.y === Math.floor(y) && l.z === Math.floor(z) && l.phase === Math.floor(phase)) {
      return !isLockExpired(l, t);
    }
  }
  return false;
}

/** Filter the lock list to active (non-expired) locks. */
export function activeLocks(lockList, now) {
  if (!Array.isArray(lockList)) return [];
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  return lockList.filter(l => !isLockExpired(l, t));
}

/** Walk a 3D box around (playerX, playerY, playerZ) and return
 *  the cells to lock - used by the per-frame tick on phase shift. */
export function lockRegion(playerX, playerY, playerZ, radius) {
  const r = (typeof radius === 'number' && Number.isFinite(radius)) ? radius : LOCK_RADIUS;
  const cells = [];
  const px = Math.floor(playerX);
  const py = Math.floor(playerY);
  const pz = Math.floor(playerZ);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -2; dy <= 3; dy++) {
        cells.push({ x: px + dx, y: py + dy, z: pz + dz });
      }
    }
  }
  return cells;
}

/** Phase Glider state machine - returns the new state + a
 *  `gliding: bool` flag. The glider is a brief fly (Space held
 *  in Beta) that lets the player move freely through the air
 *  for PHASE_GLIDER_DURATION seconds. */
export function createGliderState() {
  return {
    gliding: false,
    timer: 0,
    duration: PHASE_GLIDER_DURATION,
    speed: PHASE_GLIDER_SPEED,
    direction: { x: 0, y: 0, z: 0 },
  };
}

/** Start a glider fly in the given direction. */
export function startGlider(state, direction, now) {
  const s = (state && typeof state === 'object') ? state : createGliderState();
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  s.gliding = true;
  s.timer = 0;
  s.direction = (direction && typeof direction === 'object') ? {
    x: (typeof direction.x === 'number') ? direction.x : 0,
    y: (typeof direction.y === 'number') ? direction.y : 0,
    z: (typeof direction.z === 'number') ? direction.z : 0,
  } : { x: 0, y: 0, z: 0 };
  s.startTime = t;
  return s;
}

/** Tick the glider - returns the state + a `done: bool` flag
 *  for the caller to know when to clear. */
export function tickGlider(state, dt) {
  const s = (state && typeof state === 'object') ? state : createGliderState();
  const rawDt = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
  const clampedDt = Math.max(0, Math.min(0.1, rawDt));
  if (!s.gliding) return { state: s, done: false, dx: 0, dy: 0, dz: 0 };
  s.timer += clampedDt;
  if (s.timer >= (s.duration || PHASE_GLIDER_DURATION)) {
    s.gliding = false;
    return { state: s, done: true, dx: 0, dy: 0, dz: 0 };
  }
  // Compute the per-tick delta
  const speed = s.speed || PHASE_GLIDER_SPEED;
  const dx = (s.direction.x || 0) * speed * clampedDt;
  const dy = (s.direction.y || 0) * speed * clampedDt;
  const dz = (s.direction.z || 0) * speed * clampedDt;
  return { state: s, done: false, dx, dy, dz };
}

/** Clear the glider state. */
export function clearGlider(state) {
  if (!state) return createGliderState();
  state.gliding = false;
  state.timer = 0;
  return state;
}

export const PHASE_LOCK_DEFAULTS = Object.freeze({
  duration: LOCK_DURATION,
  fadeWindow: LOCK_FADE_WINDOW,
  radius: LOCK_RADIUS,
  fillColor: LOCK_FILL_COLOR,
  borderColor: LOCK_BORDER_COLOR,
  gliderDuration: PHASE_GLIDER_DURATION,
  gliderSpeed: PHASE_GLIDER_SPEED,
});
