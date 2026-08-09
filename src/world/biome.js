/**
 * Phase Shifter — Biomes (Phase 3.1)
 *
 * Pure module. No Three.js, no globals, no scene access. The renderer's
 * skybox shader and the game loop's per-frame biome tick both delegate
 * to the helpers here so the per-biome color palette, the per-biome fog
 * density, and the smooth cross-biome transition are all in one place.
 *
 * The brief (PHASE_3_1_BRIEF.md) calls for:
 *   - per-biome color (read from BIOME_DATA in src/gen/terrain.js —
 *     the canonical terrain tint)
 *   - per-biome fog density (tuning constants; Forest is lighter than
 *     Deep Void, the desert is open and the cavern is enclosed)
 *   - per-biome label (the canonical "BIOME: <label>" string for the
 *     HUD's `#biome-info` element)
 *   - a smooth 0.5s transition tween when the player walks into a new
 *     biome region (the `lerpBiomeTints` helper)
 *   - the canonical BIOME_FOREST / BIOME_CRYSTAL_CAVERN / etc. constants
 *     re-exported for convenience
 *
 * The world's `getBiome(x, z)` (src/core/world.js) is the deterministic
 * per-region biome assignment. This module does NOT replace it; it
 * reads from the same source and exposes the per-biome visual metadata
 * the game loop needs to tint the scene.
 */
import {
  BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
  BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_PHASE_NEXUS,
  BIOME_NAMES,
} from '../core/constants.js';

// ── BIOME_TINTS — per-biome color + fog density ───────────────────
//
// The `color` is the canonical `biomeColor` from `BIOME_DATA` in
// src/gen/terrain.js (the same RGB triplet the terrain generator uses
// to surface the biome visually). Values are in `[0, 1]` floats, ready
// for `THREE.Color` / shader uniforms / `THREE.FogExp2` density.
//
// The `fogDensity` is a tuning constant (the §3.1 brief's per-biome
// fog). The Forest is light haze (0.006); the Deep Void is thick
// (0.025); the Desert is very light (0.004, the desert is open) and
// the Sky Ruins is light too (0.005, the sky is open). The Phase Nexus
// is heavy (0.018, the nexus is dense).
//
// Object.freeze ensures the tints never drift at runtime — the
// renderer + game loop both read from this map.
export const BIOME_TINTS = Object.freeze({
  [BIOME_FOREST]:         Object.freeze({ color: Object.freeze([0.30, 0.55, 0.30]), fogDensity: 0.006 }),
  [BIOME_CAVES]:          Object.freeze({ color: Object.freeze([0.35, 0.30, 0.35]), fogDensity: 0.012 }),
  [BIOME_DEEP_VOID]:      Object.freeze({ color: Object.freeze([0.10, 0.05, 0.15]), fogDensity: 0.025 }),
  [BIOME_RUINS]:          Object.freeze({ color: Object.freeze([0.50, 0.45, 0.40]), fogDensity: 0.008 }),
  [BIOME_DESERT]:         Object.freeze({ color: Object.freeze([0.80, 0.70, 0.40]), fogDensity: 0.004 }),
  [BIOME_CRYSTAL_CAVERN]: Object.freeze({ color: Object.freeze([0.40, 0.30, 0.50]), fogDensity: 0.014 }),
  [BIOME_SKY_RUINS]:      Object.freeze({ color: Object.freeze([0.40, 0.40, 0.60]), fogDensity: 0.005 }),
  [BIOME_PHASE_NEXUS]:    Object.freeze({ color: Object.freeze([0.60, 0.20, 0.50]), fogDensity: 0.018 }),
});

// ── Canonical getter (defensive) ────────────────────────────────

/**
 * Return the per-biome `{ color, fogDensity }` object for the given
 * biome id. Defensive: out-of-range ids (NaN, negative, > 8) return
 * the Forest default so the scene never shows NaN fog or a black sky.
 */
export function biomeTint(biomeId) {
  if (!isValidBiomeId(biomeId)) return BIOME_TINTS[BIOME_FOREST];
  return BIOME_TINTS[biomeId];
}

/**
 * Return the canonical biome label (e.g. "Forest", "Crystal Cavern",
 * "Deep Void") for the given biome id. Defensive: out-of-range ids
 * return `'Unknown'` so the HUD never shows `BIOME: undefined`.
 */
export function biomeLabel(biomeId) {
  if (!isValidBiomeId(biomeId)) return 'Unknown';
  // The array is 0-indexed but the constants are 1-indexed.
  return BIOME_NAMES[biomeId - 1] || 'Unknown';
}

/**
 * Return the per-biome fog density (a scalar, the §3.1 brief's
 * tuning constant). Defensive: out-of-range ids return the Forest
 * default.
 */
export function biomeFogDensity(biomeId) {
  if (!isValidBiomeId(biomeId)) return BIOME_TINTS[BIOME_FOREST].fogDensity;
  return BIOME_TINTS[biomeId].fogDensity;
}

/**
 * Return the per-biome color triplet (the canonical `biomeColor`
 * from BIOME_DATA, in `[0, 1]` floats). Convenience for callers
 * that only need the color and not the density. Returns a fresh
 * shallow copy so the caller can't mutate the frozen entry.
 */
export function biomeColor(biomeId) {
  const tint = biomeTint(biomeId);
  return [tint.color[0], tint.color[1], tint.color[2]];
}

// ── Transition tween ───────────────────────────────────────────

/**
 * Linearly interpolate between two biome tints by `t ∈ [0, 1]`.
 * Returns a new `{ color, fogDensity }` object. The color is
 * component-wise lerped on the RGB channels; the fog density is
 * also lerped. Used by the game loop's per-frame transition tween
 * (the §3.1 0.5s smooth fade from one biome to the next).
 *
 * Pure function — no mutation of `from` or `to`. Defensive:
 *   - non-finite `t` clamps to [0, 1]
 *   - non-tint `from`/`to` fall back to the Forest default
 *
 * At `t = 0` the result is `from`; at `t = 1` the result is `to`.
 * Mid-flight chaining works correctly: if the player walks through
 * two biome regions in 0.5s, the second transition starts from the
 * current lerped state (the renderer's current color), not from the
 * original biome's target.
 */
export function lerpBiomeTints(from, to, t) {
  const a = (from && typeof from === 'object') ? from : BIOME_TINTS[BIOME_FOREST];
  const b = (to && typeof to === 'object') ? to : BIOME_TINTS[BIOME_FOREST];
  const k = clampT(t);
  const ar = (a.color && Number.isFinite(a.color[0])) ? a.color[0] : 0;
  const ag = (a.color && Number.isFinite(a.color[1])) ? a.color[1] : 0;
  const ab = (a.color && Number.isFinite(a.color[2])) ? a.color[2] : 0;
  const br = (b.color && Number.isFinite(b.color[0])) ? b.color[0] : 0;
  const bg = (b.color && Number.isFinite(b.color[1])) ? b.color[1] : 0;
  const bb = (b.color && Number.isFinite(b.color[2])) ? b.color[2] : 0;
  const ad = Number.isFinite(a.fogDensity) ? a.fogDensity : BIOME_TINTS[BIOME_FOREST].fogDensity;
  const bd = Number.isFinite(b.fogDensity) ? b.fogDensity : BIOME_TINTS[BIOME_FOREST].fogDensity;
  return {
    color: [
      ar + (br - ar) * k,
      ag + (bg - ag) * k,
      ab + (bb - ab) * k,
    ],
    fogDensity: ad + (bd - ad) * k,
  };
}

/**
 * The canonical biome transition duration (seconds). The §3.1 brief
 * says "the transition is a 0.5s smooth tween" — instant transitions
 * feel janky. Pure getter so consumers can't drift the value out of
 * sync.
 */
export function biomeTransitionDuration() {
  return 0.5;
}

// ── Internal helpers ────────────────────────────────────────────

/**
 * Defensive id validator. The biome constants are 1-indexed
 * (BIOME_FOREST = 1, BIOME_PHASE_NEXUS = 8). Returns true for any
 * integer in [1, 8]. Used by the public getters so out-of-range ids
 * fall back to the Forest default.
 */
function isValidBiomeId(id) {
  if (!Number.isFinite(id)) return false;
  const n = Math.floor(id);
  return n >= 1 && n <= 8;
}

/**
 * Defensive t-clamper for the lerp helper. `t = NaN` or non-finite
 * returns 0 (the "from" side). `t < 0` clamps to 0; `t > 1` clamps
 * to 1.
 */
function clampT(t) {
  if (!Number.isFinite(t)) return 0;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

// ── Re-exports (convenience) ────────────────────────────────────

export {
  BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
  BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_PHASE_NEXUS,
  BIOME_NAMES,
};
