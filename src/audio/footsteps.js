/**
 * Phase Shifter — Audio: Footsteps (Phase 2.8)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * game loop's per-frame footstep tick delegates to `shouldPlayFootstep`
 * for the throttle math and `materialFromBlock` for the
 * phase-and-block filter; the call site then asks `audioManager.playFootstep`
 * to play the sound. The accumulator lives in `main.js` (the game loop
 * owns it) so this module stays scene-agnostic and unit-testable.
 *
 * The brief (PHASE_2_8_BRIEF.md) calls for:
 *   - a 0.4s throttle (FOOTSTEP_INTERVAL — the plan's "every 0.4s")
 *   - a phase-and-block filter: a Stone block in Alpha is solid (so
 *     the footstep fires), but in Gamma the same cell is passable
 *     (so the player's feet are above air, no footstep). The filter
 *     is `world.getBlock(cellX, cellY, cellZ, currentPhase) →
 *     materialFromBlock` — the world lookup is per-phase.
 *   - the four canonical material names (stone / wood / crystal /
 *     void) with distinct lowpass filters; everything else collapses
 *     to `stone` (the closest lowpass signature).
 *   - `materialFromBlock` returns `null` for BLOCK_AIR so the call
 *     site knows to skip the audio when the cell below the player is
 *     empty (the player is mid-jump or standing in a void gap).
 *
 * The `world` argument is anything that exposes
 * `getBlock(x, y, z, phase)` (the canonical `World` class) so the
 * per-phase lookup is the same primitive the rest of the game uses.
 * `materialFromBlock` is a pure helper that takes a block id and a
 * phase and returns a material name; the per-phase world lookup is
 * the call-site's responsibility (the §2.8 "phase-and-block filter").
 */
import {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  BLOCK_AIR, BLOCK_STONE, BLOCK_WOOD, BLOCK_CRYSTAL, BLOCK_VOID,
  BLOCK_PROPERTIES,
  FOOTSTEP_INTERVAL,
} from '../core/constants.js';

// ── Constants ────────────────────────────────────────────────────

/**
 * Canonical footstep throttle interval (seconds). Pure getter so
 * consumers can't accidentally drift the value out of sync with the
 * `FOOTSTEP_INTERVAL` constant. The plan's §2.8 acceptance is
 * "every 0.4s".
 */
export function footstepInterval() {
  return FOOTSTEP_INTERVAL;
}

/**
 * The canonical audio material table — block names (lowercased)
 * mapped to the four distinct lowpass filters in the audio engine:
 *   - stone   → 200 Hz lowpass (the default; chunky crunch)
 *   - wood    → 150 Hz lowpass (deeper thud)
 *   - crystal → 400 Hz lowpass (high ping)
 *   - void    → 100 Hz lowpass (sub-bass)
 * Exposed for tests so the canonical mapping is locked.
 */
export const FOOTSTEP_MATERIALS = Object.freeze({
  stone: 'stone',
  wood: 'wood',
  crystal: 'crystal',
  void: 'void',
});

// ── Throttle math ──────────────────────────────────────────────

/**
 * Decrement the footstep accumulator by `dt` and decide whether a
 * footstep should fire on this tick. The accumulator model mirrors
 * the §2.7 anchor lifetime: dt-based, not Date.now-based, so a
 * tab-switch pause doesn't dump the entire pause into the timer
 * (the game loop already clamps `deltaTime` to 0.05s).
 *
 *   - `play === true`            — the accumulator has crossed
 *                                  zero this tick AND the player is
 *                                  moving + grounded. The caller
 *                                  should fire the footstep sound
 *                                  and reset the accumulator to
 *                                  `footstepInterval()` for the
 *                                  next interval.
 *   - `play === false`           — either the player is idle/airborne
 *                                  OR the accumulator hasn't reached
 *                                  zero yet. The caller should store
 *                                  `remainingTimer` as the new
 *                                  accumulator value.
 *   - `remainingTimer` is the post-decrement accumulator value:
 *       0  when a footstep fires (the accumulator was reset)
 *       >0 when the footstep is still counting down
 *
 * Defensive: non-finite or negative `dt` is treated as 0 (no
 * accumulator change). Non-finite `footstepTimer` is treated as 0
 * (the player just landed and the first interval is fresh).
 *
 * Pure function — no globals, no side effects. The accumulator is
 * the caller's responsibility to mutate.
 */
export function shouldPlayFootstep(footstepTimer, dt, isMoving, isGrounded) {
  // Number-EPSILON: small floating-point tolerance so a 0.2 - 0.2
  // drift (which yields ~2.78e-17 instead of 0) still counts as
  // "the accumulator has crossed zero". Without this, real-world
  // accumulator chains (e.g. 0.4 - 0.1 - 0.1 - 0.2) would silently
  // under-fire and the footstep would never sound.
  const EPSILON = 1e-9;
  const d = (Number.isFinite(dt) && dt > 0) ? dt : 0;
  const t0 = (Number.isFinite(footstepTimer) && footstepTimer > 0) ? footstepTimer : 0;
  const next = t0 - d;
  if (next <= EPSILON) {
    // The accumulator has crossed zero. Fire the footstep only if
    // the player is moving AND grounded (the §2.8 "every 0.4s while
    // moving and grounded" gate). When the conditions aren't met,
    // we still reset the accumulator to the interval so the
    // player hears the next footstep right after they start
    // moving again — the alternative (leaving the accumulator at
    // 0) would fire a footstep every frame while they're idle.
    const play = !!(isMoving) && !!(isGrounded);
    return { play, remainingTimer: play ? footstepInterval() : 0 };
  }
  // Accumulator hasn't reached zero yet — never fire.
  return { play: false, remainingTimer: next };
}

// ── Phase-and-block filter ────────────────────────────────────

/**
 * Map a block id in the current phase to an audio material name.
 * The mapping is:
 *   - Stone      → 'stone'
 *   - Wood       → 'wood'
 *   - Crystal    → 'crystal'
 *   - Void       → 'void'
 *   - everything else (Grass, Dirt, Sand, Obsidian, Iron, Gold Ore,
 *     Water, Energy, Stabilizer, Rune, Glass) → 'stone' (the closest
 *     lowpass signature — the engine's `freqs[material] || 200`
 *     fallback never fires in practice)
 *   - BLOCK_AIR (id 0) → `null` (the cell below the player is
 *     empty — the caller should skip the footstep)
 *
 * The `phase` argument is currently unused (the mapping is global),
 * but it's part of the signature so the call site can be reasoned
 * about as a per-phase read (the §2.8 "phase-and-block filter").
 * The actual per-phase lookup happens at the call site via
 * `world.getBlock(cellX, cellY, cellZ, currentPhase)`.
 *
 * Defensive: out-of-range block ids, unknown block types, and
 * missing name properties all collapse to 'stone' (defensive —
 * the engine's `freqs[material] || 200` fallback will never see
 * a `null` here).
 */
export function materialFromBlock(blockType, phase) {
  // Accept any of the phase enums; default to Alpha if the call
  // site passes a non-finite or out-of-range value (defensive).
  const p = (Number.isFinite(phase) && phase >= PHASE_ALPHA && phase < PHASE_COUNT)
    ? phase
    : PHASE_ALPHA;
  // BLOCK_AIR explicitly returns null — the cell below the player
  // is empty, so the caller should skip the footstep audio. This
  // covers the player mid-jump, standing in a void gap, or standing
  // on a passable block in another phase.
  if (blockType === BLOCK_AIR) return null;
  // The four canonical materials map directly by block id. Use
  // constants so the mapping is locked to the constants file.
  if (blockType === BLOCK_STONE) return 'stone';
  if (blockType === BLOCK_WOOD) return 'wood';
  if (blockType === BLOCK_CRYSTAL) return 'crystal';
  if (blockType === BLOCK_VOID) return 'void';
  // Everything else collapses to 'stone' (closest lowpass). Try the
  // BLOCK_PROPERTIES name lookup first so an unknown block id
  // returns 'stone' rather than null (defensive — the engine's
  // fallback is the same value).
  const props = BLOCK_PROPERTIES[blockType];
  if (props && typeof props.name === 'string') {
    const lower = props.name.toLowerCase();
    if (lower === 'stone') return 'stone';
    if (lower === 'wood') return 'wood';
    if (lower === 'crystal') return 'crystal';
    if (lower === 'void') return 'void';
  }
  return 'stone';
}

// ── Phase 2.8 re-exports ────────────────────────────────────────

/**
 * Phase 2.8 re-export — the constants the footstep helper touches,
 * so consumers can pick a single import. Keeps the constants file as
 * the single source of truth; this is just a convenience re-export.
 */
export {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  BLOCK_AIR, BLOCK_STONE, BLOCK_WOOD, BLOCK_CRYSTAL, BLOCK_VOID,
  BLOCK_PROPERTIES,
  FOOTSTEP_INTERVAL,
};

// ── Phase 8.7: Density-aware footstep volume ────────────────────

/**
 * Phase 8.7: compute a volume multiplier in `[0.5, 1.0]` based on
 * the count of solid neighbors around the player's feet cell.
 *
 *   - `neighborCount` — how many of the 8 horizontal neighbor cells
 *                        are non-AIR.
 *   - `total`         — total neighbor cells considered (default 8).
 *
 * The formula is a linear lerp: `0.5 + 0.5 * (neighborCount / total)`.
 * Defensive: clamps `neighborCount` to `[0, total]` and clamps the
 * result to `[0.5, 1.0]` so a malformed call can't produce a >1.0
 * multiplier (the audio engine would clip).
 */
export function footstepVolumeForDensity(neighborCount, total = 8) {
  const t = Math.max(0, Number(total) || 8);
  const n = Math.max(0, Math.min(t, Number(neighborCount) || 0));
  const ratio = t > 0 ? (n / t) : 0;
  return Math.max(0.5, Math.min(1.0, 0.5 + 0.5 * ratio));
}

/**
 * Phase 8.7: count the 8 horizontal neighbors of the cell at
 * `(x, y, z)` that are non-AIR in the given phase. Vertical
 * neighbors are excluded (the player is on top of a block; the
 * 8 horizontal cells are the "around" cells).
 *
 * `world` is anything exposing `getBlock(x, y, z, phase)`. Returns
 * an integer in `[0, 8]`. Defensive: invalid input returns 0.
 */
export function countNeighbors(world, x, y, z, phase) {
  if (!world || typeof world.getBlock !== 'function') return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  const p = (typeof phase === 'number' && Number.isFinite(phase)) ? phase : 0;
  const offsets = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];
  let count = 0;
  for (let i = 0; i < offsets.length; i++) {
    const dx = offsets[i][0];
    const dz = offsets[i][1];
    const block = world.getBlock(Math.floor(x) + dx, Math.floor(y), Math.floor(z) + dz, p);
    if (block && block !== BLOCK_AIR) count++;
  }
  return count;
}
