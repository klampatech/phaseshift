/**
 * Phase Shifter — Echoes (Phase 3.3 + Phase 10.4)
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
 *     NOT respawn the Echo - the world's `_echoes` map removes
 *     the entry on pickup)
 *
 * The §10.4 brief extends the lore library into a 30+ sequenced
 * narrative. Each Echo has a deterministic per-biome ordinal (so
 * "Forest Echo 3 of 5" is shown on pickup) and a unique lore
 * string tied to its biome. The Phase Nexus has a single final
 * Echo that closes the narrative.
 *
 * The helpers here are pure functions over plain data. The
 * `echoList` argument is `Array<{ x, y, z, loreKey, biomeId, ordinal }>` -
 * the caller's job to flatten `world._echoes` (or pass the
 * positions directly from a save). Kept as a plain array so the
 * helpers can be unit-tested without loading the World class.
 */
import { ECHO_PICKUP_RADIUS } from '../core/constants.js';
import {
  BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
  BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_PHASE_NEXUS,
} from '../core/constants.js';

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
 * Phase 10.4: per-biome ordered lore sequence. The lore is the
 * narrative spine of the game — each biome has 5 Echoes that, in
 * order, tell a coherent story. The Phase Nexus has a single
 * final Echo that closes the narrative.
 *
 * The shape is:
 *   { biomeId: [lore1, lore2, lore3, lore4, lore5] }
 *
 * `loreForBiomeOrdinal(biomeId, ordinal)` returns the canonical
 * string for the given biome + ordinal (1-based). Out-of-range
 * ordinals clamp to the last entry. Out-of-range biome ids fall
 * back to the Forest default.
 *
 * The Phase Nexus has a single entry (the final Echo that closes
 * the narrative). The lore message is "You are the next Architect.
 * Build what you must. The phases will remember you."
 */
export const ECHO_LORE_BY_BIOME = Object.freeze({
  [BIOME_FOREST]: Object.freeze([
    'I dreamed of three cities. One is now. One is lost. One is trying to come back.',
    'The Forest remembers what we forgot: the trees were once towers, and the towers once walked.',
    'Before the Architect, the world was one phase. There was no need to shift; nothing changed.',
    'The roots of the Forest drink the same water as the Nexus. The Architect planted both.',
    'We were the first to forget. The Forest decided to remember for us.',
  ]),
  [BIOME_RUINS]: Object.freeze([
    'The Architect built the Mirror City as a gift. The Architect\u2019s name is now on every wall.',
    'The Mirror City did not fall. It chose to become Ruins, so we could learn to build.',
    'A wall is a choice. The Architect chose to make every wall a confession.',
    'We left our tools in the Ruins. We hoped the next Architect would find them.',
    'The Ruins remember the sound of construction. The sound of construction is the sound of grief.',
  ]),
  [BIOME_CAVES]: Object.freeze([
    'Stone dreams. Caves are the dreams of mountains. We live in their dreams.',
    'The Architect carved the first Cave by hand. The Architect\u2019s hands are still here, in the stone.',
    'Caves are patient. They have been waiting longer than we have been lost.',
    'When the Architect stopped speaking, the Caves started. They still speak in low voices.',
    'A Cave is a question the mountain keeps asking itself. The answer is always: be still.',
  ]),
  [BIOME_CRYSTAL_CAVERN]: Object.freeze([
    'The crystals grew from grief. The Architect\u2019s grief. The grief of everyone who stayed.',
    'A crystal is a memory that decided to be hard. The Architect made many of them.',
    'The Caverns sing at night. The song is the same song the Architect used to sing.',
    'Touch a crystal and you touch the moment the Architect finally looked away.',
    'We thought the crystals were power. They are messengers. They carry what we cannot say.',
  ]),
  [BIOME_DESERT]: Object.freeze([
    'It was a sea. The Architect drank it. The sea is now the desert.',
    'The Desert is what happens when you forget to listen. The sand remembers the waves.',
    'Each grain of sand is a word the Architect tried to take back. It is still trying.',
    'The Desert is the only honest place left. It admits it was something else.',
    'Walk far enough in the Desert and you will find the Architect\u2019s footprints. They go in every direction.',
  ]),
  [BIOME_DEEP_VOID]: Object.freeze([
    'The Void is not empty. The Void is the Architect, finally alone.',
    'In the Void, the Architect stopped being a name. The Architect became a silence.',
    'The Void does not echo. It absorbs. This is the Architect\u2019s final lesson.',
    'We thought the Void was the end. It is the Architect\u2019s gift: the freedom to be nothing.',
    'When you reach the Void, you will feel the Architect\u2019s hand on your shoulder. There is no hand. There is only the feeling.',
  ]),
  [BIOME_SKY_RUINS]: Object.freeze([
    'The sky was once ground. We used to walk up here. The Mirror City fell up.',
    'The Sky Ruins are the Mirror City\u2019s last promise. The promise is: you, too, can fall up.',
    'Gravity is a habit. The Architect broke the habit. The Sky Ruins are the scar.',
    'The Sky Ruins taught us that looking down is a choice. The Architect looked down for us.',
    'We will rebuild the Sky Ruins. This time, we will remember to live there.',
  ]),
  [BIOME_PHASE_NEXUS]: Object.freeze([
    'You are the next Architect. Build what you must. The phases will remember you.',
  ]),
});

/**
 * Phase 10.4: backward-compat alias. The §3.3 tests still import
 * `ECHO_LORE_LIBRARY` for the random-picker behavior. We keep an
 * array of all lore strings (flattened) so the legacy 12-string
 * array is still iterable. The new picker is
 * `loreForBiomeOrdinal(biomeId, ordinal)`.
 */
export const ECHO_LORE_LIBRARY = Object.freeze([
  // Forest (5)
  ...ECHO_LORE_BY_BIOME[BIOME_FOREST],
  // Ruins (5)
  ...ECHO_LORE_BY_BIOME[BIOME_RUINS],
  // Caves (5)
  ...ECHO_LORE_BY_BIOME[BIOME_CAVES],
  // Crystal Cavern (5)
  ...ECHO_LORE_BY_BIOME[BIOME_CRYSTAL_CAVERN],
  // Desert (5)
  ...ECHO_LORE_BY_BIOME[BIOME_DESERT],
  // Deep Void (5)
  ...ECHO_LORE_BY_BIOME[BIOME_DEEP_VOID],
  // Sky Ruins (5)
  ...ECHO_LORE_BY_BIOME[BIOME_SKY_RUINS],
  // Nexus (1) — the final
  ...ECHO_LORE_BY_BIOME[BIOME_PHASE_NEXUS],
]);

// - Lore picker -

/**
 * Phase 10.4: return the lore string for the given biome + ordinal.
 * `ordinal` is 1-based (the first Echo in a biome is ordinal 1).
 *
 * Behavior:
 *   - biomeId out of range → Forest default
 *   - ordinal out of range → clamps to the last entry in the biome
 *   - Empty biome list → Forest first string
 *
 * The function is deterministic: the same `(biomeId, ordinal)` pair
 * always returns the same string. This is the spine of the §10.4
 * narrative — the player reads the story in order as they explore.
 */
export function loreForBiomeOrdinal(biomeId, ordinal) {
  const list = ECHO_LORE_BY_BIOME[biomeId] || ECHO_LORE_BY_BIOME[BIOME_FOREST];
  if (!Array.isArray(list) || list.length === 0) {
    return ECHO_LORE_BY_BIOME[BIOME_FOREST][0];
  }
  const idx = Math.max(0, Math.min(list.length - 1, (ordinal || 1) - 1));
  return list[idx];
}

/**
 * Phase 10.4: return the count of Echoes in a biome (so the HUD
 * can show "Forest Echo 3 of 5"). Defensive: out-of-range ids
 * fall back to the Forest count.
 */
export function loreCountForBiome(biomeId) {
  const list = ECHO_LORE_BY_BIOME[biomeId] || ECHO_LORE_BY_BIOME[BIOME_FOREST];
  return Array.isArray(list) ? list.length : 0;
}

/**
 * Back-compat alias. The §3.3 tests still call `echoLoreForKey(key)`.
 * We keep the hash-based picker for the legacy 12-string array, but
 * the new recommended entry point is `loreForBiomeOrdinal(biomeId, ordinal)`.
 */
export function echoLoreForKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    return ECHO_LORE_BY_BIOME[BIOME_FOREST][0];
  }
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  // Flat fallback across the whole library (the legacy 37-string picker).
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
 *   - `echoList`: `Array<{ x, y, z, key, loreKey, biomeId, ordinal }>` - the
 *     world's echo positions (the `world._echoes` values,
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
  // Decorate with the lore string. Phase 10.4: prefer the biome
  // ordinal lookup (which is deterministic and ordered); fall back
  // to the legacy hash-based picker for backward compat.
  let lore = nearest.lore;
  if (!lore && Number.isFinite(nearest.biomeId) && Number.isFinite(nearest.ordinal)) {
    lore = loreForBiomeOrdinal(nearest.biomeId, nearest.ordinal);
  } else if (!lore) {
    lore = nearest.loreKey
      ? echoLoreForKey(nearest.loreKey)
      : echoLoreForKey(nearest.key || '');
  }
  return Object.assign({}, nearest, { lore });
}

// - Key formatter -

/**
 * Return the canonical `"x,y,z"` key for the `_echoes` map.
 * Mirrors `World._echoes` (the same key format used for
 * spawnEcho / collectEcho). Integer-floor convention matches the
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

/**
 * Phase 10.4: compute the ordinal for a fresh Echo in a biome.
 * The terrain generator calls this the first time it spawns an
 * Echo in a biome — it returns 1, 2, 3, 4, 5 in spawn order.
 * The helper is just a clamp + offset utility; the caller
 * (terrain.js) is responsible for the per-biome counter.
 */
export function nextOrdinalForBiome(biomeId, currentCount) {
  const cap = loreCountForBiome(biomeId);
  if (cap <= 0) return 1;
  return Math.max(1, Math.min(cap, (currentCount || 0) + 1));
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
  // Phase 10.4: per-biome color assortment so the Echoes are
  // visually distinct. The default warm gold is the Ruins color.
  if (biomeId === 1) return [0.6, 0.85, 0.6]; // Forest: green
  if (biomeId === 2) return [0.75, 0.7, 0.75]; // Caves: pale gray
  if (biomeId === 3) return [0.4, 0.3, 0.6]; // Deep Void: violet
  if (biomeId === 5) return [0.95, 0.85, 0.5]; // Desert: sand
  if (biomeId === 6) return [0.6, 0.4, 0.85]; // Crystal Cavern: amethyst
  return [0.95, 0.78, 0.35]; // warm gold (Ruins default)
}

/**
 * Phase 10.4: format the HUD label for an Echo. Returns
 * "Forest Echo 3 of 5" (or "Nexus Echo 1 of 1" for the final).
 * The biome label is the human-readable name from BIOME_NAMES.
 *
 * Defensive: out-of-range biome ids fall back to "Unknown".
 */
export function echoOrdinalLabel(biomeId, biomeLabel, ordinal) {
  const label = (typeof biomeLabel === 'string' && biomeLabel.length > 0)
    ? biomeLabel
    : 'Unknown';
  const total = loreCountForBiome(biomeId);
  const o = Number.isFinite(ordinal) ? ordinal : 1;
  return `${label} Echo ${o} of ${total}`;
}
