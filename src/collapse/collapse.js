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
  };
}

export function startCollapse(state, reason, targetPos, source) {
  const s = (state && typeof state === 'object') ? state : createCollapseState();
  s.isCollapsing = true;
  s.collapseTimer = 0;
  s.reason = (typeof reason === 'string') ? reason : COLLAPSE_REASONS.FORCED;
  s.targetPos = (targetPos && typeof targetPos === 'object' && Number.isFinite(targetPos.x))
    ? { x: targetPos.x, y: targetPos.y, z: targetPos.z, source: source || targetPos.source || 'stabilizer' }
    : null;
  s.inputSuppressed = true;
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
      };
    }
    return {
      state: s,
      done: false,
      targetPos: s.targetPos,
      source: s.targetPos ? s.targetPos.source : null,
      progress: s.collapseTimer / COLLAPSE_DURATION,
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
