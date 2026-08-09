/**
 * Phase Shifter — Resonance (Phase 2.6)
 *
 * Pure module. No Three.js, no globals, no scene access. The renderer's
 * `ResonancePulse` and the game loop's `performResonance` both delegate
 * to the helpers here so the radius, the energy cost, and the sphere-
 * pulse lifetime are all in one place.
 *
 * The brief (PHASE_2_6_BRIEF.md) calls for:
 *   - a 1-block radius (the plan's §2.6 acceptance — 3×3×3 area)
 *   - 15 energy per press (the one-shot debit on Q)
 *   - a phase-colored sphere pulse on the player (radius 0.2 → 1.0
 *     block over 0.25s, then opacity 1.0 → 0 over 0.75s)
 *   - a `resonateResults` helper that returns the cells that DO have
 *     phase differences and were swapped — the renderer and the
 *     notification use this for the swap count
 *
 * The world arg is anything that exposes
 * `resonateWithReport(cx, cy, cz, radius, currentPhase)` (the
 * canonical `World` class). Kept as an injected dependency so the
 * helpers can be exercised in a unit test without loading the World
 * class or a scene.
 */
import {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  PHASE_COLORS, RESONATE_COST, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION,
} from '../core/constants.js';

/**
 * Canonical Resonance radius (block units, cubic). The §2.6 acceptance
 * is radius=1 (a 3×3×3 area). Pure getter so consumers can't accidentally
 * drift the value out of sync.
 */
export function resonateRadius() {
  return RESONANCE_RADIUS;
}

/**
 * Canonical Resonance energy cost. The §2.6 acceptance is 15 energy
 * per press. Mirrors `RESONATE_COST` so the call site can pick a
 * single source of truth.
 */
export function resonateCost() {
  return RESONATE_COST;
}

/**
 * Compute the Resonance results for the player at (px, py, pz) in
 * the given current phase. Returns
 *   `{ x, y, z, swappedPhases: number[] }[]`
 * for every cell in the cubic radius that differs from the current
 * phase. `swappedPhases` is the list of phase indexes where the cell
 * was non-air but the player is not — the phases that flipped during
 * the resonance (the "swap count" is the total length of these
 * arrays).
 *
 * The `world` argument is anything that exposes
 * `resonateWithReport(px, py, pz, radius, currentPhase)` (the
 * canonical `World` class). Kept as an injected dependency so the
 * helper can be exercised in a unit test without loading the World
 * class or a scene.
 *
 * Returns an empty array if the world doesn't expose the helper
 * (defensive — the brief says main.js#performResonance must delegate,
 * but the test suite should still produce a sensible shape on a stub).
 */
export function resonateResults(playerX, playerY, playerZ, radius, currentPhase, world) {
  if (!world || typeof world.resonateWithReport !== 'function') return [];
  if (currentPhase < PHASE_ALPHA || currentPhase >= PHASE_COUNT) return [];
  const r = Number.isFinite(radius) && radius > 0 ? Math.floor(radius) : RESONANCE_RADIUS;
  const report = world.resonateWithReport(playerX, playerY, playerZ, r, currentPhase);
  if (!report || !Array.isArray(report.results)) return [];
  return report.results;
}

/**
 * Total number of phase cells swapped during a resonance, summed
 * across the per-cell result. Each cell with N swapped phases
 * contributes N to the count. A cell where the only non-air phase
 * was the current phase (and the player toggled back) contributes 0.
 * Pure helper for the notification ("Resonance: N phase-cells").
 */
export function totalSwappedCount(results) {
  if (!Array.isArray(results)) return 0;
  let total = 0;
  for (const r of results) {
    if (r && Array.isArray(r.swappedPhases)) total += r.swappedPhases.length;
  }
  return total;
}

/**
 * Convert the elapsed seconds (since the resonance was fired) into a
 * per-frame sphere parameter `{ radius, opacity, color }` for the
 * renderer. The brief says:
 *   - the sphere starts at the player position
 *   - the radius expands from 0.2 → 1.0 block over the first 0.25s
 *   - the opacity fades from 1.0 → 0 over the following 0.75s
 *   - the color is `PHASE_COLORS[currentPhase]`
 * Returns `null` when the pulse has fully expired (t >= duration).
 *
 * The shape is `{ radius, opacity, color }` so the renderer can read
 * it directly without knowing the timing constants. Pure function —
 * deterministic for any (t, phase) pair.
 */
export function resonanceSpherePulse(t, currentPhase) {
  const elapsed = Number.isFinite(t) && t > 0 ? t : 0;
  const duration = RESONANCE_PULSE_DURATION;
  if (elapsed >= duration) return null;

  const color = PHASE_COLORS[currentPhase] || '#ffffff';
  const expandSteps = 0.25;
  const fadeSteps = 0.75;

  let radius;
  if (elapsed <= expandSteps) {
    // Expand phase: 0.2 → 1.0 over the first 0.25s.
    const k = elapsed / expandSteps;
    radius = 0.2 + (1.0 - 0.2) * k;
  } else {
    // After expand, hold at 1.0 — the fade handles the visual exit.
    radius = 1.0;
  }
  // Opacity: 1.0 over the first 0.25s, then 1.0 → 0 over the remaining 0.75s.
  let opacity;
  if (elapsed <= expandSteps) {
    opacity = 1.0;
  } else {
    const k = (elapsed - expandSteps) / fadeSteps;
    opacity = Math.max(0, 1.0 - k);
  }
  return { radius, opacity, color };
}

/**
 * Phase 2.6 re-export — the constants the resonance touches, so
 * consumers can pick a single import. Keeps the constants file as
 * the single source of truth; this is just a convenience re-export.
 */
export {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  PHASE_COLORS, RESONATE_COST, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION,
};
