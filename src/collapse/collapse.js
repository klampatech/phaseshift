/**
 * Phase Shifter - Phase Collapse state machine (Phase 3.2)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's collapse overlay and the game loop's per-frame
 * collapse tick both delegate to the helpers here so the
 * duration, the overlay palette, the notification strings, and
 * the tick math are all in one place.
 */
import { MINIMUM_RESPAWN_ENERGY } from '../core/constants.js';

// Canonical constants

export const COLLAPSE_DURATION = 1.5;
export const COLLAPSE_VIGNETTE_COLOR = 0x440022;
export const COLLAPSE_BANNER_TEXT = 'PHASE COLLAPSE';
export const FALLBACK_WARNING_TEXT = 'No Stabilizer nearby - respawn at spawn';

export const COLLAPSE_REASONS = Object.freeze({
  ENERGY_DEPLETED: 'energy-depleted',
  FORCED: 'forced',
  TEST: 'test',
});

// State factory

export function createCollapseState() {
  return {
    isCollapsing: false,
    collapseTimer: 0,
    reason: null,
    targetPos: null,
    inputSuppressed: false,
    // Phase 10.3: the lost Echo on collapse. The actual removal
    // (and the lore toast) is done by the game loop on `result.done`,
    // but we track the chosen key here so the renderer can preview
    // the loss during the collapse animation.
    lostEcho: null,
  };
}

export function startCollapse(state, reason, targetPos, source, lostEcho) {
  const s = (state && typeof state === 'object') ? state : createCollapseState();
  s.isCollapsing = true;
  s.collapseTimer = 0;
  s.reason = (typeof reason === 'string') ? reason : COLLAPSE_REASONS.FORCED;
  s.targetPos = (targetPos && typeof targetPos === 'object' && Number.isFinite(targetPos.x))
    ? { x: targetPos.x, y: targetPos.y, z: targetPos.z, source: source || targetPos.source || 'stabilizer' }
    : null;
  s.inputSuppressed = true;
  // Phase 10.3: track the lost Echo (the key + lore). Defensive:
  // null / non-object inputs are stored as null.
  s.lostEcho = (lostEcho && typeof lostEcho === 'object' && typeof lostEcho.key === 'string')
    ? { key: lostEcho.key, lore: typeof lostEcho.lore === 'string' ? lostEcho.lore : '' }
    : null;
  return s;
}

export function tickCollapse(state, dt) {
  const s = (state && typeof state === 'object') ? state : createCollapseState();
  const rawDt = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
  const clampedDt = Math.max(0, Math.min(0.05, rawDt));
  if (s.isCollapsing) {
    s.collapseTimer += clampedDt;
    if (s.collapseTimer >= COLLAPSE_DURATION) {
      s.isCollapsing = false;
      s.inputSuppressed = false;
      return {
        state: s,
        done: true,
        targetPos: s.targetPos,
        source: s.targetPos ? s.targetPos.source : null,
        progress: 1.0,
        lostEcho: s.lostEcho,
      };
    }
    return {
      state: s,
      done: false,
      targetPos: s.targetPos,
      source: s.targetPos ? s.targetPos.source : null,
      progress: s.collapseTimer / COLLAPSE_DURATION,
      lostEcho: s.lostEcho,
    };
  }
  return {
    state: s,
    done: false,
    targetPos: s.targetPos,
    source: s.targetPos ? s.targetPos.source : null,
    progress: 0,
  };
}

export function clearCollapse(state) {
  const s = (state && typeof state === 'object') ? state : createCollapseState();
  s.isCollapsing = false;
  s.collapseTimer = 0;
  s.reason = null;
  s.targetPos = null;
  s.inputSuppressed = false;
  // Phase 10.3: also clear the lost Echo so the next collapse
  // starts fresh. The actual removal happens in the game loop
  // before clearCollapse is called (the order is: lose the Echo,
  // then clearCollapse).
  s.lostEcho = null;
  return s;
}

export const COLLAPSE_RESPAWN_ENERGY = MINIMUM_RESPAWN_ENERGY;

export function collapseProgress(state) {
  if (!state || typeof state !== 'object') return 0;
  if (!state.isCollapsing) return 0;
  const t = state.collapseTimer / COLLAPSE_DURATION;
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

// ── Phase 8.2: Post-collapse invuln window ─────────────────────

/** §8.2: 5-second invuln window after a collapse resolves. */
export const POST_COLLAPSE_INVULN_DURATION = 5.0;

/**
 * Phase 8.2: factory for the post-collapse invuln state.
 * Returns `{ active: false, remaining: 0 }`. The game loop owns
 * the singleton; the helper just gives a fresh shape.
 */
export function createInvulnState() {
  return { active: false, remaining: 0 };
}

/**
 * Phase 8.2: start the post-collapse invuln window. Sets
 * `active = true, remaining = POST_COLLAPSE_INVULN_DURATION`.
 * Pure state mutation; no side effects.
 */
export function startInvuln(state) {
  const s = (state && typeof state === 'object') ? state : createInvulnState();
  s.active = true;
  s.remaining = POST_COLLAPSE_INVULN_DURATION;
  return s;
}

/**
 * Phase 8.2: per-frame tick. Decrements `remaining` by `dt`
 * (clamped to `[0, 0.1]` like the other accumulators in this
 * module). Sets `active = false` when `remaining <= 0`.
 */
export function tickInvuln(state, dt) {
  const s = (state && typeof state === 'object') ? state : createInvulnState();
  const rawDt = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
  const clampedDt = Math.max(0, Math.min(0.1, rawDt));
  if (s.active) {
    s.remaining -= clampedDt;
    if (s.remaining <= 0) {
      s.active = false;
      s.remaining = 0;
    }
  }
  return s;
}

/** §8.2: boolean check for the invuln window. */
export function isInvulnActive(state) {
  if (!state || typeof state !== 'object') return false;
  return Boolean(state.active);
}

/** §8.2: remaining seconds (0 if inactive). */
export function getInvulnRemaining(state) {
  if (!state || typeof state !== 'object') return 0;
  return Number.isFinite(state.remaining) ? state.remaining : 0;
}
