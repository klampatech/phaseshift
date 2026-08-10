/**
 * Phase Shifter - Stabilizers (Phase 3.2)
 *
 * Pure module. No Three.js, no globals, no scene access. The renderer's
 * `CheckpointOverlay` and the game loop's `forcePhaseCollapse`
 * extension both delegate to the helpers here so the search radius, the
 * respawn target, and the overlay palette are all in one place.
 *
 * The brief (PHASE_3_2_BRIEF.md) calls for:
 *   - the BLOCK_STABILIZER (id 15) tracking - the world maintains
 *     `_stabilizerPositions` already, but the respawn target lookup
 *     (and its radius) lives here as a pure helper.
 *   - a 16-block search radius (the section 3.2 brief's "Stabilizer within
 *     reach" - too small and the player can never benefit; too large
 *     and the respawn is essentially "any block on the map").
 *   - a free-placement contract (the section 3.2 brief's "no placement cost"
 *     - the player should be encouraged to seed Stabilizers, not
 *     pay for them).
 *   - a warm-orange checkpoint palette (matching
 *     `BLOCK_STABILIZER.color = [255, 102, 68]` so the overlay
 *     matches the block color the player placed).
 *   - a deterministic key format (`"x,y,z"`) for the world map -
 *     matches `World._stabilizerPositions` so the round-trip
 *     survives a save/reload.
 *
 * The helpers here are pure functions over plain data. The
 * `stabilizerList` argument is `Array<{ x, y, z }>` - the caller's
 * job to flatten `world._stabilizerPositions.values()` (or pass the
 * positions directly from a save). Kept as a plain array so the
 * helpers can be unit-tested without loading the World class.
 */
import { MINIMUM_RESPAWN_ENERGY } from '../core/constants.js';

// - Canonical constants -

/**
 * The section 3.2 search radius (blocks). The player must be within this
 * distance of a Stabilizer to respawn to it; otherwise the
 * `findRespawnTarget` helper falls back to the original spawn
 * point + a "No Stabilizer nearby" warning notification.
 *
 * The number 16 was chosen so a single Stabilizer protects a
 * meaningful region (a 33x33x33 cube around the player) without
 * covering the whole world. Larger than `RESONANCE_RADIUS = 1`
 * (per-cell interaction) but smaller than the map itself.
 */
export const STABILIZER_RADIUS = 16;

/**
 * The section 3.2 placement cost (energy). Mirrors the Phase 2.7 anchor
 * contract - utility blocks are free. The player should be
 * encouraged to seed Stabilizers, not pay for them.
 */
export const STABILIZER_PLACE_COST = 0;

/**
 * The section 3.2 checkpoint overlay tint (warm orange). Matches the
 * `BLOCK_STABILIZER.color = [255, 102, 68]` triplet in
 * `src/core/constants.js` so the visual overlay reads as the same
 * color as the block the player placed.
 */
export const STABILIZER_FALLBACK_COLOR = 0xff8844;

/**
 * The section 3.2 checkpoint overlay ring radius (THREE.js units, blocks).
 * The ring lies flat on top of the block; 0.6 is large enough to
 * see from across the room but small enough not to obscure the
 * block face.
 */
export const STABILIZER_RING_RADIUS = 0.6;

/**
 * The section 3.2 checkpoint overlay ring inner radius. The ring's
 * inner radius is 75% of the outer radius - thin ring, not a
 * filled disk.
 */
export const STABILIZER_RING_INNER_RADIUS = 0.45;

/**
 * The section 3.2 checkpoint overlay crosshair height (blocks above the
 * block top). The crosshair is a sprite at `stabilizer.y + 1 + 1.2`
 * - well above the ring at `stabilizer.y + 1.02`.
 */
export const STABILIZER_CROSSHAIR_HEIGHT = 1.2;

/**
 * Re-export of `MINIMUM_RESPAWN_ENERGY` for callers that want a
 * single import to resolve the section 3.2 contract. The world respawn
 * restores energy to this value (30 by default) so the player can
 * collapse, respawn, collapse again without losing all energy.
 */
export const STABILIZER_RESPAWN_ENERGY = MINIMUM_RESPAWN_ENERGY;

// - Respawn target lookup -

/**
 * Find the respawn target position for a collapsing player.
 *
 * Inputs:
 *   - `playerPos`: `{ x, y, z }` - the player's position at the
 *     moment of collapse (the `physicsManager.getPos()` value).
 *   - `stabilizerList`: `Array<{ x, y, z }>` - the world's
 *     stabilizer positions (the `world._stabilizerPositions`
 *     values, or the equivalent from a save).
 *   - `options`: optional `{ radius, fallback }` overrides. The
 *     default `radius` is `STABILIZER_RADIUS` (16 blocks). The
 *     default `fallback` is `null` (the caller - typically
 *     main.js - passes the original spawn point).
 *
 * Returns:
 *   `{ x, y, z, source: 'stabilizer' | 'spawn' }` where:
 *     - `source: 'stabilizer'` means the nearest Stabilizer
 *       within `radius` is the respawn target. The returned
 *       position is the Stabilizer cell (the `x, y, z` from the
 *       list - the caller adds the +1 Y for the player's feet).
 *     - `source: 'spawn'` means no Stabilizer was within
 *       `radius`; the caller should fall back to the original
 *       spawn point (typically `physicsManager._spawnPoint` or
 *       the world spawn coords) and emit the "No Stabilizer
 *       nearby" warning.
 *
 * Defensive:
 *   - empty / missing `playerPos` returns `{ source: 'spawn' }`
 *     (the caller can re-substitute the fallback coords)
 *   - non-array `stabilizerList` returns `{ source: 'spawn' }`
 *   - `NaN` / non-finite coords in either input are skipped
 *     (not matched, not crashed on)
 *   - tie-breaking uses the first-match (insertion order) so
 *     the behavior is deterministic
 */
export function findRespawnTarget(playerPos, stabilizerList, options) {
  const radius = (options && Number.isFinite(options.radius) && options.radius > 0)
    ? options.radius
    : STABILIZER_RADIUS;
  const fallback = (options && options.fallback && typeof options.fallback === 'object')
    ? options.fallback
    : null;

  // Defensive: empty / missing player position - spawn fallback.
  if (!playerPos || typeof playerPos !== 'object'
      || !Number.isFinite(playerPos.x)
      || !Number.isFinite(playerPos.y)
      || !Number.isFinite(playerPos.z)) {
    if (fallback) {
      return {
        x: Number.isFinite(fallback.x) ? fallback.x : 0,
        y: Number.isFinite(fallback.y) ? fallback.y : 0,
        z: Number.isFinite(fallback.z) ? fallback.z : 0,
        source: 'spawn',
      };
    }
    return { x: 0, y: 0, z: 0, source: 'spawn' };
  }

  // Defensive: non-array stabilizer list - spawn fallback.
  if (!Array.isArray(stabilizerList) || stabilizerList.length === 0) {
    if (fallback) {
      return {
        x: Number.isFinite(fallback.x) ? fallback.x : 0,
        y: Number.isFinite(fallback.y) ? fallback.y : 0,
        z: Number.isFinite(fallback.z) ? fallback.z : 0,
        source: 'spawn',
      };
    }
    return {
      x: playerPos.x,
      y: playerPos.y,
      z: playerPos.z,
      source: 'spawn',
    };
  }

  // Linear search - O(n) is fine for n in the low thousands. The
  // walk over each candidate is branchless once `isWithinRadius`
  // returns true (the `distSq` early-exit pattern).
  let nearest = null;
  let nearestDistSq = radius * radius;
  for (const s of stabilizerList) {
    if (!s || typeof s !== 'object') continue;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) continue;
    if (!isWithinRadius(playerPos, s, radius)) continue;
    const dx = s.x - playerPos.x;
    const dy = s.y - playerPos.y;
    const dz = s.z - playerPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = s;
    }
  }

  if (nearest) {
    return {
      x: nearest.x,
      y: nearest.y,
      z: nearest.z,
      source: 'stabilizer',
    };
  }

  // No Stabilizer within radius - spawn fallback.
  if (fallback) {
    return {
      x: Number.isFinite(fallback.x) ? fallback.x : 0,
      y: Number.isFinite(fallback.y) ? fallback.y : 0,
      z: Number.isFinite(fallback.z) ? fallback.z : 0,
      source: 'spawn',
    };
  }
  return {
    x: playerPos.x,
    y: playerPos.y,
    z: playerPos.z,
    source: 'spawn',
  };
}

/**
 * `true` if the candidate position is within `radius` blocks
 * (Chebyshev / cube distance - the section 3.2 contract: "within
 * `STABILIZER_RADIUS` blocks", which is the same shape the
 * Resonance + Phase Lens use). The cube distance matches the
 * cubic-radius pattern (`RESONANCE_RADIUS`, `SCAN_RADIUS`) so
 * the player sees a consistent "the ring around me" feel.
 *
 * Used by the search loop in `findRespawnTarget` and exposed as
 * a public helper so the test can exercise the math without
 * running the search.
 */
export function isWithinRadius(playerPos, candidatePos, radius) {
  if (!playerPos || !candidatePos) return false;
  if (!Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y) || !Number.isFinite(playerPos.z)) return false;
  if (!Number.isFinite(candidatePos.x) || !Number.isFinite(candidatePos.y) || !Number.isFinite(candidatePos.z)) return false;
  const r = (typeof radius === 'number' && Number.isFinite(radius) && radius > 0)
    ? radius
    : STABILIZER_RADIUS;
  const dx = Math.abs(playerPos.x - candidatePos.x);
  const dy = Math.abs(playerPos.y - candidatePos.y);
  const dz = Math.abs(playerPos.z - candidatePos.z);
  return dx <= r && dy <= r && dz <= r;
}

// - Key formatter -

/**
 * Return the canonical `"x,y,z"` key for the
 * `_stabilizerPositions` map. Mirrors `World._stabilizerPositions`
 * (which uses the same key format for `addStabilizer` /
 * `removeStabilizer`). The integer-floor convention matches the
 * world map: a Stabilizer at (10.4, 12.8, 10.4) is the same
 * entry as (10, 12, 10).
 *
 * Defensive: non-finite coords floor to 0 so the helper never
 * returns `NaN` keys (which would silently break the world map).
 */
export function stabilizerKey(x, y, z) {
  const fx = Number.isFinite(x) ? Math.floor(x) : 0;
  const fy = Number.isFinite(y) ? Math.floor(y) : 0;
  const fz = Number.isFinite(z) ? Math.floor(z) : 0;
  return `${fx},${fy},${fz}`;
}

// - Player Y snap (matches Phase 2.7 anchor pattern) -

/**
 * Return the player's Y after respawning onto a Stabilizer cell.
 * The section 3.2 contract: the player Y is `stabilizer.y + 1 +
 * PLAYER_HEIGHT` (standing on top of the block, the same Y-snap
 * pattern as the Phase 2.7 anchor snap in `onPhaseChanged`).
 *
 * `stabilizerY` is the integer cell Y of the Stabilizer block
 * (the `y` from `_stabilizerPositions`). `PLAYER_HEIGHT` is
 * 1.8 (from `src/core/constants.js`) - the player's physics
 * height (feet to head). The +1 puts the player's feet on the
 * top surface of the block.
 *
 * Defensive: non-finite `stabilizerY` returns 0 so the caller
 * never teleports to `NaN`.
 */
export function snapYForStabilizerCell(stabilizerY) {
  if (!Number.isFinite(stabilizerY)) return 0;
  return Math.floor(stabilizerY) + 1 + 1.8;
}
