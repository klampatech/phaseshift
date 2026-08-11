/**
 * Phase Shifter — New Game+ (Phase 10.14)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * pause menu's "Start New Game+" button, the save system, and
 * the terrain generator's per-biome phase-dominance hook all
 * delegate to the helpers here so the canonical "shuffle the
 * phase-dominance per biome" logic + the ironman flag are in
 * one place.
 *
 * The §10.14 brief calls for:
 *   - A `phaseDominanceSeed` in GameState (an integer; defaults
 *     to 0 for the first playthrough).
 *   - A `pickPhaseDominance(phaseDominanceSeed, biomeId)` helper
 *     returning a permutation of `[PHASE_ALPHA, PHASE_BETA,
 *     PHASE_GAMMA]` (i.e. `[0, 1, 2]` shuffled by a stable RNG
 *     keyed on the (seed, biomeId) pair). The permutation is
 *     used by the terrain generator to bias the per-block
 *     phase presence — index 0 of the permutation is the
 *     "dominant" phase (more blocks of this phase), index 1 is
 *     "neutral", index 2 is "rare" (the phase that gets
 *     collapsed to air more often).
 *   - An ironman flag in the save blob (the §10.14 "no manual
 *     saves, no Stabilizer respawns" option). The flag is a
 *     simple boolean — the gameplay code reads it to decide
 *     whether to allow manual saves and whether the collapse
 *     goes to spawn with full Echo loss.
 *   - Save/load round-trip for both the seed and the ironman
 *     flag (extends the §1.7 / §2.4 / §2.7 / §4.4 save contract).
 *
 * The helpers are pure functions over plain data so the headless
 * suite can exercise them without loading the World class or the
 * save system.
 */
import {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA,
} from '../core/constants.js';
import {
  BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
  BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_PHASE_NEXUS,
} from '../core/constants.js';

// - Canonical constants -

/**
 * The default phase-dominance seed for a fresh playthrough.
 * `0` means "no shuffle" (the original phase-dominance
 * distribution). Any non-zero seed produces a deterministic
 * per-biome shuffle.
 */
export const DEFAULT_PHASE_DOMINANCE_SEED = 0;

/**
 * The default ironman flag for a fresh playthrough. `false`
 * means "normal mode" (manual saves + Stabilizer respawns
 * allowed). `true` means "ironman" (no manual saves + full
 * Echo loss on collapse, per the §10.14 spec).
 */
export const DEFAULT_IRONMAN = false;

/**
 * The Phase Nexus is special — it doesn't shuffle. The §10.14
 * spec says "the Nexus is the same", and the §10.5 Act 4
 * finale always plays the "next Architect" line. Locking the
 * Nexus permutation to `[ALPHA, BETA, GAMMA]` makes the
 * finale deterministic.
 */
export const NEXUS_DOMINANCE = Object.freeze([PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA]);

/**
 * The list of all 8 biome ids the shuffle operates over. The
 * `pickPhaseDominance` helper accepts any biome id but the
 * canonical list is exposed here for the main.js debug hook
 * (the pause menu's per-biome preview).
 */
export const SHUFFLABLE_BIOMES = Object.freeze([
  BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
  BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS,
]);

/**
 * Re-exported for convenience. The Phase Nexus is excluded
 * from `SHUFFLABLE_BIOMES` because it never shuffles.
 */
export { BIOME_PHASE_NEXUS };

// - Permutation picker -

/**
 * Phase 10.14: deterministic Fisher-Yates shuffle of
 * `[PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA]` keyed on the
 * (seed, biomeId) pair. Returns a frozen permutation array.
 *
 * Inputs:
 *   - `seed`: integer seed (any non-finite value falls back to 0).
 *   - `biomeId`: integer biome id (any non-finite value falls
 *     back to 0).
 *
 * Returns: `Array<number>` of length 3, a permutation of
 * `[0, 1, 2]`. The Phase Nexus always returns `[0, 1, 2]`
 * (the canonical, unshuffled order). A seed of 0 also returns
 * the unshuffled order (the "first playthrough" default).
 *
 * The helper is pure: the same (seed, biomeId) pair always
 * returns the same permutation. This is the §10.14 acceptance:
 * "the same world seed + the same phase-dominance seed
 * produces the same shuffle, even after a reload".
 */
export function pickPhaseDominance(seed, biomeId) {
  const s = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const b = Number.isFinite(biomeId) ? Math.floor(biomeId) : -1;
  if (s === 0) return NEXUS_DOMINANCE;
  if (b === BIOME_PHASE_NEXUS) return NEXUS_DOMINANCE;

  // Mix the (seed, biomeId) pair into a per-biome RNG state.
  // The mix is a 32-bit LCG recipe (same multiplier + increment
  // as Numerical Recipes) so the output is stable across reloads
  // regardless of host platform.
  const state = (Math.imul(s, 374761393) ^ Math.imul(b + 1, 668265263)) >>> 0;
  const arr = [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA];
  let st = state;
  // Fisher-Yates shuffle (3-element array, so this is 2 swaps).
  for (let i = arr.length - 1; i > 0; i--) {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    const j = st % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return Object.freeze(arr);
}

/**
 * Phase 10.14: return the "dominant" phase (index 0 of the
 * permutation) for the given (seed, biomeId) pair. The
 * terrain generator uses this to bias the per-block phase
 * presence in the chunk.
 *
 * Defensive: NaN / out-of-range biome ids fall back to
 * PHASE_ALPHA (the canonical default).
 */
export function pickDominantPhase(seed, biomeId) {
  const p = pickPhaseDominance(seed, biomeId);
  return Number.isFinite(p[0]) ? p[0] : PHASE_ALPHA;
}

/**
 * Phase 10.14: the canonical weight set the terrain
 * generator multiplies against the base `phaseSolid` mask.
 * Given a dominance permutation, the helper returns:
 *   dominantPhase: 1.0 (the "most common" phase)
 *   middlePhase:   0.5 (the "neutral" phase)
 *   rarePhase:     0.25 (the "collapsed to air" phase)
 *
 * The helper is a thin lookup — the caller decides whether
 * to multiply these weights against the base phaseSolid
 * mask or to use them as probabilities for the per-block
 * roll.
 *
 * Returns: `{ dominant, middle, rare, dominantPhase,
 * middlePhase, rarePhase }`.
 */
export function dominanceWeights(permutation) {
  const perm = Array.isArray(permutation) && permutation.length === 3
    ? permutation
    : [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA];
  return Object.freeze({
    dominant: 1.0,
    middle: 0.5,
    rare: 0.25,
    dominantPhase: perm[0],
    middlePhase: perm[1],
    rarePhase: perm[2],
  });
}

// - State factory -

/**
 * Create a fresh New Game+ state. The shape is:
 *   {
 *     phaseDominanceSeed: number,  // 0 = no shuffle
 *     ironman: boolean,            // true = ironman
 *   }
 *
 * Defensive: callers that pass an existing state get the
 * same shape back (a no-op re-init). This lets main.js call
 * `createNewGamePlusState(_state)` safely on every reload
 * without resetting the seed.
 */
export function createNewGamePlusState(existing) {
  if (existing && typeof existing === 'object'
      && Number.isFinite(existing.phaseDominanceSeed)
      && typeof existing.ironman === 'boolean') {
    return existing;
  }
  return {
    phaseDominanceSeed: DEFAULT_PHASE_DOMINANCE_SEED,
    ironman: DEFAULT_IRONMAN,
  };
}

// - Ironman helpers -

/**
 * Toggle the ironman flag. Returns the new value.
 * Mutates the input state in place (mirror of the §3.3
 * `addEcho` / `addAmplifier` pattern).
 */
export function setIronman(state, enabled) {
  if (!state || typeof state !== 'object') return DEFAULT_IRONMAN;
  state.ironman = Boolean(enabled);
  return state.ironman;
}

/**
 * Roll a new phase-dominance seed. Returns the new seed.
 * Mutates the input state in place. Uses `Math.random()` —
 * this is the "click Start New Game+" path, not a
 * deterministic reload. The seed is then used as input to
 * `pickPhaseDominance` so the per-biome shuffle is
 * deterministic from this point on.
 */
export function rollPhaseDominanceSeed(state) {
  if (!state || typeof state !== 'object') return DEFAULT_PHASE_DOMINANCE_SEED;
  const seed = Math.floor(Math.random() * 0x7fffffff) + 1;
  state.phaseDominanceSeed = seed;
  return seed;
}

/**
 * `true` if ironman is on. Convenience for the save path
 * (ironman playthroughs refuse manual saves + skip the
 * Stabilizer respawn, per the §10.14 spec).
 */
export function isIronman(state) {
  return Boolean(state && typeof state === 'object' && state.ironman === true);
}

/**
 * `true` if the given (seed, biomeId) pair produces a
 * non-identity permutation (i.e. the shuffle is active).
 * Used by the pause menu to render the "Shuffled" label.
 */
export function isShuffled(seed, biomeId) {
  const perm = pickPhaseDominance(seed, biomeId);
  return perm[0] !== PHASE_ALPHA || perm[1] !== PHASE_BETA || perm[2] !== PHASE_GAMMA;
}

// - Serialize / Deserialize -

/**
 * Serialize the New Game+ state to a plain object (the save
 * blob shape). The shape is:
 *   {
 *     phaseDominanceSeed: number,
 *     ironman: boolean,
 *   }
 *
 * The values are JSON-safe (no Map / Set). The save system
 * embeds this directly under the `newGamePlus` key in the
 * player state blob.
 */
export function serialize(state) {
  const safe = createNewGamePlusState(state);
  return {
    phaseDominanceSeed: safe.phaseDominanceSeed,
    ironman: safe.ironman,
  };
}

/**
 * Deserialize a save-blob snapshot back into a New Game+
 * state. The inverse of `serialize`. Defensive:
 *   - missing / null snapshot returns the default state
 *   - non-integer `phaseDominanceSeed` defaults to 0
 *   - non-boolean `ironman` defaults to `false`
 */
export function deserialize(snapshot) {
  const state = createNewGamePlusState();
  if (!snapshot || typeof snapshot !== 'object') return state;
  if (Number.isFinite(snapshot.phaseDominanceSeed)) {
    const seed = Math.floor(snapshot.phaseDominanceSeed);
    state.phaseDominanceSeed = Math.max(0, seed);
  }
  if (typeof snapshot.ironman === 'boolean') {
    state.ironman = snapshot.ironman;
  }
  return state;
}
