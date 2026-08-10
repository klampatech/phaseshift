/**
 * Phase Shifter - Echoes (Phase 3.3)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's `EchoOverlay` and the game loop's per-frame pickup
 * tick both delegate to the helpers here so the pickup radius,
 * the lore library, the key format, and the floating animation
 * are all in one place.
 *
 * The §3.3 brief calls for:
 *   - a small pickup radius (1.5 blocks - the §3.3 "walking within
 *     2 blocks of an Echo collects it" spec)
 *   - a deterministic lore string per Echo (no wall-clock RNG; the
 *     RNG key is the Echo position so reloads produce the same
 *     lore)
 *   - a floating animation (bob + slow rotation) so the Echo
 *     reads as "ancient / floating" rather than "static decoration"
 *   - a one-shot collect (re-entering a chunk after pickup does
 *     NOT respawn the Echo - the world's `_echoPositions` map
 *     removes the key on pickup)
 *
 * The helpers here are pure functions over plain data. The
 * `echoList` argument is `Array<{ x, y, z, loreKey, biomeId }>` -
 * the caller's job to flatten `world._echoPositions.values()` (or
 * pass the positions directly from a save). Kept as a plain array
 * so the helpers can be unit-tested without loading the World
 * class.
 */
import { ECHO_PICKUP_RADIUS } from '../core/constants.js';

// - Canonical constants -

/**
 * The §3.3 pickup radius (blocks, cubic). The player must be
 * within this distance of an Echo to collect it; otherwise the
 * pickup loop skips. 1.5 gives a small grace margin (a 3x3x3 cube
 * around the player) without making the Echo trivially collectible
 * from across the room.
 *
 * Re-exported from constants.js for callers that want a single
 * import to resolve the §3.3 contract.
 */
export const PICKUP_RADIUS = ECHO_PICKUP_RADIUS;

/**
 * The §3.3 lore library. A frozen array of 12 lore strings the
 * player reads on pickup. The `echoLoreForKey` helper picks one
 * deterministically based on the Echo key (the chunk hash), so
 * reloading the game shows the same lore per Echo.
 *
 * The strings are short (1 sentence each) so the lore toast fits
 * on screen without scrolling. They hint at the broader narrative
 * (Phase Nexus, the Mirror City, the Lost Architect) without
 * spelling it out.
 */
export const ECHO_LORE_LIBRARY = Object.freeze([
  'I dreamed of a city made of mirrors.',
  'The Nexus hums tonight.',
  'Three phases, one anchor, no return.',
  'The Architect forgot their name.',
  'Stone forgets; echo remembers.',
  'The Desert once was a sea.',
  'Crystal grows where grief was shed.',
  'Sky Ruins: the sky was once ground.',
  'Phase shift: the cost is breath.',
  'In Beta, the wind speaks backward.',
  'In Gamma, the light leaves first.',
  'The Stabilizer is a promise.',
]);

// - Lore picker -

/**
 * Return the lore string for the given Echo key. The picker uses
 * a simple string-hash modulo the library size, so:
 *   - the same key always picks the same string (deterministic)
 *   - reloading the game shows the same lore per Echo
 *   - adjacent Echoes often have different lore (the hash mixes
 *     well)
 *
 * Defensive: empty / non-string keys return the first entry so
 * the caller always gets a defined string.
 */
export function echoLoreForKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    return ECHO_LORE_LIBRARY[0];
  }
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % ECHO_LORE_LIBRARY.length;
  return ECHO_LORE_LIBRARY[idx];
}

// - Pickup lookup -

/**
 * Find the nearest Echo within `radius` blocks of the player.
 *
 * Inputs:
 *   - `playerPos`: `{ x, y, z }` - the player's position at the
 *     moment of pickup (the `physicsManager.getPos()` value).
 *   - `echoList`: `Array<{ x, y, z, key, loreKey, biomeId }>` - the
 *     world's echo positions (the `world._echoPositions` values,
 *     or the equivalent from a save).
 *   - `radius`: optional override (defaults to `PICKUP_RADIUS`).
 *
 * Returns:
 *   The nearest Echo object (with `key` + `lore` fields populated)
 *   within `radius` blocks, or `null` if no Echo is in range.
 *
 * Defensive:
 *   - empty / missing `playerPos` returns `null`
 *   - non-array `echoList` returns `null`
 *   - `NaN` / non-finite coords in either input are skipped
 *   - tie-breaking uses the first-match (insertion order) so the
 *     behavior is deterministic
 */
export function pickupResult(playerPos, echoList, radius) {
  const r = (typeof radius === 'number' && Number.isFinite(radius) && radius > 0)
    ? radius
    : PICKUP_RADIUS;

  if (!playerPos || typeof playerPos !== 'object'
      || !Number.isFinite(playerPos.x)
      || !Number.isFinite(playerPos.y)
      || !Number.isFinite(playerPos.z)) {
    return null;
  }
  if (!Array.isArray(echoList) || echoList.length === 0) {
    return null;
  }

  let nearest = null;
  let nearestDistSq = r * r;
  for (const e of echoList) {
    if (!e || typeof e !== 'object') continue;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) continue;
    const dx = e.x - playerPos.x;
    const dy = e.y - playerPos.y;
    const dz = e.z - playerPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq <= nearestDistSq) {
      nearestDistSq = distSq;
      nearest = e;
    }
  }
  if (!nearest) return null;
  // Decorate with the lore string so the caller doesn't need a
  // second helper call.
  const lore = nearest.lore || (nearest.loreKey ? echoLoreForKey(nearest.loreKey) : echoLoreForKey(nearest.key || ''));
  return Object.assign({}, nearest, { lore });
}

// - Key formatter -

/**
 * Return the canonical `"x,y,z"` key for the `_echoPositions` map.
 * Mirrors `World._echoPositions` (the same key format used for
 * addEcho / collectEcho). Integer-floor convention matches the
 * world map: an Echo at (10.4, 12.8, 10.4) is the same entry as
 * (10, 12, 10).
 *
 * Defensive: non-finite coords floor to 0 so the helper never
 * returns `NaN` keys (which would silently break the world map).
 */
export function echoKey(x, y, z) {
  const fx = Number.isFinite(x) ? Math.floor(x) : 0;
  const fy = Number.isFinite(y) ? Math.floor(y) : 0;
  const fz = Number.isFinite(z) ? Math.floor(z) : 0;
  return `${fx},${fy},${fz}`;
}

// - Floating animation -

/**
 * Return the floating-animation offsets for an Echo at time `t`
 * (seconds). The animation is a slow bob (vertical sinusoid, ±0.15
 * blocks) plus a slow rotation (the Echo spins at 0.4 rad/s). The
 * `phase` argument is a per-Echo offset (radians) so adjacent
 * Echoes bob out-of-sync - the player sees a field of crystals
 * rather than a marching band.
 *
 * Defensive: non-finite `t` / `phase` fall back to 0 so the caller
 * never reads NaN positions.
 */
export function floatingOffset(t, phase) {
  const tt = Number.isFinite(t) ? t : 0;
  const ph = Number.isFinite(phase) ? phase : 0;
  return {
    y: Math.sin(tt * 1.5 + ph) * 0.15,
    rotY: tt * 0.4 + ph,
  };
}

// - Per-biome color picker -

/**
 * Return the canonical Echo color (RGB triplet, 0-1 range) for the
 * given biome id. The §3.3 brief calls out per-biome colors:
 *   - Ruins: warm gold (0.95, 0.78, 0.35)
 *   - Sky Ruins: pale blue (0.65, 0.85, 0.95)
 *   - Phase Nexus: deep purple (0.55, 0.35, 0.85)
 *   - other biomes: warm gold (the default)
 *
 * Defensive: out-of-range / NaN biome ids return the warm gold
 * default.
 */
export function echoColorForBiome(biomeId) {
  if (biomeId === 7) return [0.65, 0.85, 0.95]; // Sky Ruins
  if (biomeId === 8) return [0.55, 0.35, 0.85]; // Phase Nexus
  return [0.95, 0.78, 0.35]; // warm gold (Ruins default)
}
