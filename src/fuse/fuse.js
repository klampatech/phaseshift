/**
 * Phase Shifter — Phase Fuse (Phase 10.2)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's `FuseOverlay` and the game loop's per-frame fuse
 * tick both delegate to the helpers here so the cost, the hold
 * duration, the key format, the override set, and the save/load
 * round-trip helpers are all in one place.
 *
 * The §10.2 brief calls for:
 *   - a single-block permanent phase swap (the Memory World pillar)
 *   - hold F for 3 seconds + 30 energy to fuse
 *   - persists across save/load (extends World.exportGlobalState)
 *   - the fused block is marked with a golden outline (distinct
 *     from the anchor's yellow)
 *   - the player can "leave a path" — fuse blocks in Beta to make
 *     a permanent bridge, fuse Echoes in Gamma to make them
 *     visible in Alpha, etc.
 *
 * The "Memory World" enablement comes from storing the per-block
 * override as a map: `Map<key, overridePhase>`. The world resolves
 * the fused phase at look-up time. The default behavior is
 * unaffected (`BLOCK_PROPERTIES[id].phaseSolid[phase]`); the fuse
 * override wins when present.
 */
import { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT } from '../core/constants.js';

// ── Constants ───────────────────────────────────────────────────

/**
 * Cost of a single Phase Fuse (energy). Held for 3 seconds; the
 * cost is debited on commit (not on press) so the player can
 * cancel before the cost hits. The §10.2 brief value is 30.
 */
export const FUSE_COST = 30;

/**
 * Hold duration (seconds). The player must hold F against a
 * block for this long before the fuse commits. The §10.2 brief
 * value is 3 seconds.
 */
export const FUSE_HOLD_SECONDS = 3.0;

/**
 * Outline color (the golden tint distinct from the anchor's
 * yellow). The brief specifies `0xddaa44`.
 */
export const FUSE_OUTLINE_COLOR = 0xddaa44;

/**
 * Outline border color (slightly brighter golden for the edge).
 */
export const FUSE_BORDER_COLOR = 0xffd066;

/**
 * Fuse fade window (seconds-before-commit during which the
 * outline pulse-fades). Mirrors the anchor's 3-second fade.
 */
export const FUSE_FADE_WINDOW = 1.0;

// ── Canonical getters ───────────────────────────────────────────

export function fuseCost() {
  return FUSE_COST;
}

export function fuseHoldSeconds() {
  return FUSE_HOLD_SECONDS;
}

export function fuseOutlineColor() {
  return FUSE_OUTLINE_COLOR;
}

export function fuseBorderColor() {
  return FUSE_BORDER_COLOR;
}

export function fuseFadeWindow() {
  return FUSE_FADE_WINDOW;
}

// ── Key formatter ──────────────────────────────────────────────

/**
 * Canonical "x,y,z" key for the _fuseOverrides map. The same
 * convention as the world's anchor / echo keys. Two fuses at
 * the same cell collapse to one (re-fusing the same cell
 * overrides the previous fuse; the player's first action wins
 * by the cell-key collision check).
 */
export function fuseKey(x, y, z) {
  const fx = Number.isFinite(x) ? Math.floor(x) : 0;
  const fy = Number.isFinite(y) ? Math.floor(y) : 0;
  const fz = Number.isFinite(z) ? Math.floor(z) : 0;
  return `${fx},${fy},${fz}`;
}

// ── State factory ──────────────────────────────────────────────

/**
 * Return a fresh fuse state. The state holds:
 *   - `active`: whether the player is currently holding F
 *   - `target`: the cell being fused (or null)
 *   - `progress`: 0..1 of the hold completion
 *   - `elapsed`: total seconds F has been held
 *   - `playerEnergy`: the player's energy at the start of the
 *     hold (so the fuse can refuse to commit if energy drops
 *     below FUSE_COST mid-hold)
 *   - `lastTick`: the timestamp of the last tick (for frame-
 *     rate-independent accumulation)
 */
export function createFuseState() {
  return {
    active: false,
    target: null,
    progress: 0,
    elapsed: 0,
    playerEnergy: 0,
    lastTick: 0,
  };
}

/**
 * Begin a fuse on the given cell. The state is mutated in place.
 * Returns the same state for convenience.
 *
 * Defensive: invalid cells are normalized to floor coords; null
 * or non-finite inputs leave the state untouched (defensive).
 */
export function startFuse(state, x, y, z, playerEnergy) {
  const s = (state && typeof state === 'object') ? state : createFuseState();
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return s;
  }
  s.active = true;
  s.target = {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  };
  s.progress = 0;
  s.elapsed = 0;
  s.playerEnergy = Number.isFinite(playerEnergy) ? playerEnergy : 0;
  s.lastTick = 0;
  return s;
}

/**
 * Tick the fuse state. Returns the state + a `done` flag + a
 * `progress` value (0..1). The caller decides when to commit
 * (usually when `progress >= 1`). The tick is frame-rate
 * independent: `dt` is in seconds.
 *
 * The fuse state stays active while the player holds F against
 * the same cell. If the player moves away, the caller should
 * call `cancelFuse(state)` to clear the state.
 */
export function tickFuse(state, dt) {
  const s = (state && typeof state === 'object') ? state : createFuseState();
  const rawDt = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
  const clampedDt = Math.max(0, Math.min(0.1, rawDt));
  if (!s.active || !s.target) return { state: s, done: false, progress: 0 };
  s.elapsed += clampedDt;
  s.progress = Math.min(1, s.elapsed / FUSE_HOLD_SECONDS);
  if (s.progress >= 1) {
    return { state: s, done: true, progress: 1 };
  }
  return { state: s, done: false, progress: s.progress };
}

/**
 * Cancel an in-progress fuse. Returns the state + a `cancelled`
 * flag. The state is cleared; no energy is debited (the cost is
 * only debited on commit).
 */
export function cancelFuse(state) {
  const s = (state && typeof state === 'object') ? state : createFuseState();
  s.active = false;
  s.target = null;
  s.progress = 0;
  s.elapsed = 0;
  s.playerEnergy = 0;
  s.lastTick = 0;
  return s;
}

/**
 * Clear the fuse state (factory reset). The fuse map (the
 * committed fuses) is held separately in the World; this
 * helper just resets the *active* fuse state.
 */
export function clearFuse(state) {
  return createFuseState();
}

// ── Fuse override resolution ───────────────────────────────────

/**
 * Resolve the effective phase presence of a block at (x, y, z)
 * in the given phase. If the world's `fuseOverrides` map has
 * an entry for this cell, the override wins. Otherwise the
 * default per-block phaseSolid mask is used.
 *
 * The caller (World.getBlockPhaseSolid) wraps this with the
 * default BLOCK_PROPERTIES lookup. We're just the resolver.
 *
 * Returns:
 *   - `true` if the block is solid in `phase` (override or
 *     default)
 *   - `false` if the block is non-solid in `phase`
 *   - `null` if the override is for a different phase (the
 *     caller should fall back to the default)
 *
 * Defensive: missing / non-object `fuseOverrides` returns null.
 */
export function resolveFuseOverride(fuseOverrides, x, y, z, phase) {
  if (!(fuseOverrides instanceof Map)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (!Number.isFinite(phase) || phase < 0 || phase >= PHASE_COUNT) return null;
  const key = fuseKey(x, y, z);
  const entry = fuseOverrides.get(key);
  if (!entry || typeof entry !== 'object') return null;
  // The override is "this block is solid in phase X regardless of default".
  // We return true if the requested phase matches the override phase;
  // false if the explicit override is for a different phase; null
  // if the override is for the same phase (treating it as "this is
  // the canonical truth").
  if (entry.phase === phase) return true;
  // The override is for a different phase. The block is solid in
  // that other phase but NOT in this one. Return false.
  return false;
}

/**
 * Apply a fuse override to a cell. Idempotent (re-fusing the
 * same cell updates the phase).
 */
export function applyFuseOverride(fuseOverrides, x, y, z, phase) {
  if (!(fuseOverrides instanceof Map)) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (!Number.isFinite(phase) || phase < 0 || phase >= PHASE_COUNT) return false;
  const key = fuseKey(x, y, z);
  fuseOverrides.set(key, {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    phase: Math.floor(phase),
    fusedAt: Date.now(),
  });
  return true;
}

/**
 * Remove a fuse override. Returns `true` if the override was
 * removed, `false` if the cell had no override.
 */
export function removeFuseOverride(fuseOverrides, x, y, z) {
  if (!(fuseOverrides instanceof Map)) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  const key = fuseKey(x, y, z);
  return fuseOverrides.delete(key);
}

/**
 * List all fuse overrides as a flat array. Used by the
 * save/load round-trip and by the renderer's FuseOverlay.
 */
export function listFuseOverrides(fuseOverrides) {
  if (!(fuseOverrides instanceof Map)) return [];
  const out = [];
  for (const entry of fuseOverrides.values()) {
    if (!entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.z)) continue;
    out.push({
      x: entry.x,
      y: entry.y,
      z: entry.z,
      phase: Number.isFinite(entry.phase) ? entry.phase : PHASE_ALPHA,
      fusedAt: Number.isFinite(entry.fusedAt) ? entry.fusedAt : 0,
    });
  }
  return out;
}

// ── Serialization ──────────────────────────────────────────────

/**
 * Serialize the fuse overrides to a save-blob-ready array. The
 * shape is `Array<{ x, y, z, phase, fusedAt }>` — JSON-safe.
 */
export function serializeFuseOverrides(fuseOverrides) {
  return listFuseOverrides(fuseOverrides);
}

/**
 * Deserialize a save-blob array into a fuse overrides map.
 * Defensive: missing / non-array input returns an empty map.
 * Per-entry malformed data is skipped.
 */
export function deserializeFuseOverrides(snapshot, fuseOverrides) {
  const map = (fuseOverrides instanceof Map) ? fuseOverrides : new Map();
  if (!Array.isArray(snapshot)) return map;
  for (const entry of snapshot) {
    if (!entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.z)) continue;
    if (!Number.isFinite(entry.phase) || entry.phase < 0 || entry.phase >= PHASE_COUNT) continue;
    const key = fuseKey(entry.x, entry.y, entry.z);
    map.set(key, {
      x: Math.floor(entry.x),
      y: Math.floor(entry.y),
      z: Math.floor(entry.z),
      phase: Math.floor(entry.phase),
      fusedAt: Number.isFinite(entry.fusedAt) ? entry.fusedAt : 0,
    });
  }
  return map;
}

/**
 * Return the count of fuse overrides. Used by the HUD
 * counter and the test assertions.
 */
export function fuseOverrideCount(fuseOverrides) {
  return (fuseOverrides instanceof Map) ? fuseOverrides.size : 0;
}

// ── Defaults ────────────────────────────────────────────────────

export const FUSE_DEFAULTS = Object.freeze({
  cost: FUSE_COST,
  holdSeconds: FUSE_HOLD_SECONDS,
  outlineColor: FUSE_OUTLINE_COLOR,
  borderColor: FUSE_BORDER_COLOR,
  fadeWindow: FUSE_FADE_WINDOW,
});
