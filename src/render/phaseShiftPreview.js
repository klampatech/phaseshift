/**
 * Phase Shifter — Phase shift preview (Phase 10.12)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's `PhaseShiftPreviewPass` shader and the game loop's
 * per-frame tick both delegate to the helpers here so the preview
 * duration, the cross-fade shape, the color mix, and the shader
 * uniform contract are all in one place.
 *
 * The §10.12 brief calls for:
 *   - 0.5s ghost of the target phase world (desaturated, tinted by
 *     the target phase's color) before the shift commits
 *   - the current phase renders normally throughout
 *   - the ghost fades to the target phase over the next 1.0s (the
 *     existing 1.5s shift animation)
 *   - the energy cost is unchanged
 *   - the implementation is a post-processing pass — no chunk
 *     rebuild required
 *
 * The visual is implemented as a `ShaderPass` that mixes the current
 * frame with a desaturated version tinted by `PHASE_COLORS[target]`.
 * The mix amount is `previewAmount(progress)`:
 *   - 0 at progress 0 (no preview, current phase unchanged)
 *   - 1 at progress 0.5 / 1.5 (full preview just before commit)
 *   - 0 again at progress 1.0 / 1.5 (target phase fully revealed)
 *
 * The mix is what the renderer reads as the `uPreviewAmount` shader
 * uniform. The target phase's RGB is read from `PHASE_COLORS[target]`
 * via `previewColor(targetPhase)`.
 *
 * Helpers are pure functions over plain inputs. The renderer reads
 * `previewAmount(progress)` + `previewColor(targetPhase)` per frame
 * and feeds them into the shader.
 */
import { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, PHASE_COLORS } from '../core/constants.js';

// ── Constants ───────────────────────────────────────────────────

/**
 * Phase 10.12: total phase-shift duration. The PhaseManager already
 * uses 1.5s for the shift animation; we re-derive here so the
 * preview module owns its own constant rather than reaching into
 * the PhaseManager. The brief's "0.5s preview + 1.0s fade" adds up
 * to exactly this value.
 */
export const PHASE_SHIFT_DURATION = 1.5;

/**
 * Phase 10.12: duration of the ghost preview before the commit
 * (the first 0.5s of the 1.5s shift). During this window the
 * player sees the desaturated target-phase world.
 */
export const PREVIEW_SECONDS = 0.5;

/**
 * Phase 10.12: peak ghost intensity (0..1). 0.6 means the
 * desaturated target phase is mixed in at 60% strength at the
 * peak — enough to read as "the world about to change" without
 * occluding the current phase's geometry. Tuned by eye (the
 * brief gives the duration but not the intensity).
 */
export const PEAK_PREVIEW_AMOUNT = 0.6;

// ── Preview shape ───────────────────────────────────────────────

/**
 * Compute the preview mix amount for the current shift progress.
 * The brief calls for:
 *   - 0 → 1 over the first 0.5s (fade in)
 *   - 1 → 0 over the remaining 1.0s (fade out, the world commits)
 *
 * The output is multiplied by PEAK_PREVIEW_AMOUNT so the renderer
 * doesn't have to multiply twice.
 *
 * Defensive: non-finite `progress` falls back to 0 so the renderer
 * never reads NaN into the shader uniform.
 */
export function previewAmount(progress) {
  const p = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  const fadeIn = PREVIEW_SECONDS / PHASE_SHIFT_DURATION; // ≈ 0.333
  const fadeOut = 1.0; // the remaining 1.0s
  if (p <= 0) return 0;
  if (p < fadeIn) {
    // Fade in: 0 -> PEAK_PREVIEW_AMOUNT.
    const k = p / fadeIn;
    return PEAK_PREVIEW_AMOUNT * k;
  }
  if (p < fadeOut) {
    // Fade out: PEAK_PREVIEW_AMOUNT -> 0.
    const k = (p - fadeIn) / (fadeOut - fadeIn);
    return PEAK_PREVIEW_AMOUNT * (1 - k);
  }
  return 0;
}

/**
 * Convert a hex color string (`PHASE_COLORS[target]` shape, e.g.
 * `"#5aa85a"`) into a normalized RGB triplet `{ r, g, b }` in
 * `[0, 1]`. Used to feed the shader's `uPreviewColor` uniform.
 *
 * Defensive: bad input falls back to white so the shader never
 * reads a NaN color.
 */
export function previewColorFromHex(hex) {
  if (typeof hex !== 'string') return { r: 1, g: 1, b: 1 };
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  if (cleaned.length !== 6) return { r: 1, g: 1, b: 1 };
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return { r: 1, g: 1, b: 1 };
  }
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/**
 * Convenience helper: pick the preview color for a phase index
 * from `PHASE_COLORS`. Returns a normalized RGB triplet. Out-of-
 * range inputs fall back to white so the renderer never reads
 * garbage.
 */
export function previewColor(phase) {
  const phaseClamped = (Number.isFinite(phase) && phase >= 0 && phase < PHASE_COUNT)
    ? Math.floor(phase)
    : PHASE_ALPHA;
  return previewColorFromHex(PHASE_COLORS[phaseClamped]);
}

/**
 * Should the preview pass run right now? Convenience helper for
 * the game loop — returns true when the player is mid-shift and
 * the elapsed time hasn't crossed the commit threshold.
 *
 * The argument is the PhaseManager's `getPhaseShiftProgress()`
 * value (0..1). Returns false when progress is 0 (idle) or 1
 * (commit complete) so the renderer can skip the pass entirely.
 */
export function shouldRunPreview(progress) {
  const p = Number.isFinite(progress) ? progress : 0;
  return p > 0 && p < 1;
}

// ── Re-exports ──────────────────────────────────────────────────

export { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, PHASE_COLORS };
