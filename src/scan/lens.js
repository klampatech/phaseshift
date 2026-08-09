/**
 * Phase Shifter — Phase Lens (Phase 2.5)
 *
 * Pure module. No Three.js, no globals, no scene access. The renderer's
 * `ScanOverlay` and the game loop's `performScan` both delegate to the
 * helpers here so the wireframe color, the energy drain rate, and the
 * lens radius are all in one place.
 *
 * The brief (PHASE_2_5_BRIEF.md) calls for:
 *   - a 4-block radius (the plan's §2.5 acceptance)
 *   - 0.5 energy/sec while the lens is held
 *   - colored wireframes per OTHER phase (the cell is outlined in the
 *     color of each phase where the block is non-air but the player is
 *     not — Alpha = green, Beta = blue, Gamma = gold)
 *   - a beam from the camera in the crosshair direction
 *
 * `scanResults` returns the per-cell result the renderer needs to draw
 * wireframes (the block in the current phase + the list of OTHER phases
 * where this cell is non-air). It does NOT draw anything — it just
 * shapes the data.
 */
import {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  PHASE_LENS_DRAIN_RATE, SCAN_RADIUS,
} from '../core/constants.js';

/**
 * Canonical Phase Lens radius (block units, cubic). The §2.5 acceptance
 * is 4 blocks. Pure getter so consumers can't accidentally drift the
 * value out of sync.
 */
export function lensRadius() {
  return SCAN_RADIUS;
}

/**
 * Canonical Phase Lens drain rate (energy per second while held). The
 * §2.5 acceptance is 0.5/sec. Pure getter.
 */
export function lensDrainRate() {
  return PHASE_LENS_DRAIN_RATE;
}

/**
 * Energy to subtract for a single tick of the Phase Lens hold state.
 * The game loop calls this every frame with the latest dt and applies
 * the result to `phaseManager.consumeEnergy(...)`. Clamped to zero so
 * a 0-second tick (e.g. on the press frame) doesn't drain a phantom
 * unit, and indefinite so a long frame doesn't drain more than the
 * player's available energy.
 *
 * The drain is `PHASE_LENS_DRAIN_RATE * dt` per frame — not a fixed
 * cost per press — so 1 second of hold = 0.5 energy, 2 seconds = 1.0,
 * etc. (matches the brief's "0.5/sec" contract).
 */
export function phaseLensDrain(dt) {
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  return PHASE_LENS_DRAIN_RATE * d;
}

/**
 * Compute the Phase Lens scan results for the player at (px, py, pz) in
 * the given current phase. Returns an array of
 *   { x, y, z, currentPhaseBlock, otherPhases, mask }
 * for every cell in the cubic radius that differs from the current
 * phase. `currentPhaseBlock` is the block id in the caller's phase
 * (BLOCK_AIR if the cell is air there). `otherPhases` is the list of
 * phase indexes where this cell is non-air but the player is not —
 * this is what the renderer colors the wireframe with.
 *
 * The `world` argument is anything that exposes
 * `findPhaseDifferences(px, py, pz, radius, currentPhase)` (the
 * canonical `World` class). Kept as an injected dependency so the
 * helpers can be exercised in a unit test without loading the World
 * class or a scene.
 *
 * Returns an empty array if the world doesn't expose the helper
 * (defensive — the brief says main.js#performScan must delegate, but
 * the test suite should still produce a sensible shape on a stub).
 */
export function scanResults(playerX, playerY, playerZ, radius, currentPhase, world) {
  if (!world || typeof world.findPhaseDifferences !== 'function') return [];
  if (currentPhase < PHASE_ALPHA || currentPhase >= PHASE_COUNT) return [];
  const r = Number.isFinite(radius) && radius > 0 ? Math.floor(radius) : SCAN_RADIUS;
  return world.findPhaseDifferences(playerX, playerY, playerZ, r, currentPhase);
}

/**
 * Wireframe color per phase. Mirrors PHASE_COLORS so the outline
 * matches the HUD indicator and the post-FX phase tint. The brief is
 * explicit: Alpha → green, Beta → blue, Gamma → gold.
 */
export const LENS_WIREFRAME_COLORS = ['#5aa85a', '#3399e6', '#d9b34c'];

/**
 * Convenience helper: pick the wireframe color for a phase index.
 * Returns null on out-of-range inputs so the renderer can skip bad
 * data without crashing.
 */
export function wireframeColorForPhase(phase) {
  if (phase < PHASE_ALPHA || phase >= PHASE_COUNT) return null;
  return LENS_WIREFRAME_COLORS[phase];
}

/**
 * Insufficient-energy threshold. The brief says "when the player's
 * energy falls below the per-frame cost, the lens should turn off".
 * The actual gate is `energy < drain(now)` — i.e. the player can hold
 * the lens until the very last tick — but for the "first press below
 * threshold" notification we need a more conservative threshold so
 * the message fires before the lens has a chance to drain the energy
 * to negative. Exposed as a small fraction of the per-second drain
 * so the logic isn't tied to a numeric magic value.
 */
export function belowDrainThreshold(energy, dt) {
  if (!Number.isFinite(energy)) return true;
  return energy < phaseLensDrain(dt);
}

/**
 * Are there any phase-different cells in the scan results? Helper for
 * the renderer — we draw at least one wireframe if any phase other
 * than the current phase is non-air, regardless of whether the cell
 * is also non-air in the current phase.
 */
export function hasDifferences(results) {
  return Array.isArray(results) && results.length > 0;
}

/**
 * Phase 2.5 re-export — the constants the lens touch, so consumers
 * can pick a single import. Keeps the constants file as the
 * single source of truth; this is just a convenience re-export.
 */
export {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  PHASE_LENS_DRAIN_RATE, SCAN_RADIUS,
};
