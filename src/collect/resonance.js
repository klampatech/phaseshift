/**
 * Phase Shifter - Resonance Cores (Phase 3.4)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's `ResonanceCoreOverlay` and the game loop's per-frame
 * pickup tick both delegate to the helpers here so the pickup
 * radius, the amplifier mapping, the key format, and the floating
 * animation are all in one place.
 *
 * The §3.4 brief calls for:
 *   - 3 amplifiers (AB, BG, AG) keyed by the transition they
 *     cover (alpha<->beta, beta<->gamma, alpha<->gamma).
 *   - Each amplifier reduces the energy cost of its matching
 *     transition by `AMPLIFIER_SHIFT_REDUCTION` (1.5 per
 *     amplifier in `src/core/constants.js`).
 *   - Resonance Cores are placed in Crystal Caverns biomes.
 *   - Walking within `AMPLIFIER_PICKUP_RADIUS` (1.5 blocks) of a
 *     Core collects it and unlocks the matching amplifier.
 *   - The inventory grows (one entry per collected Core).
 *   - The HUD's `#amplifier-status` lights up the matching
 *     amplifier (AB/BG/AG).
 */
import {
  AMPLIFIER_AB,
  AMPLIFIER_BG,
  AMPLIFIER_AG,
  AMPLIFIER_TRANSITIONS,
  AMPLIFIER_PICKUP_RADIUS,
  BLOCK_RESONANCE_CORE,
} from '../core/constants.js';

// - Canonical constants -

/** The §3.4 pickup radius (blocks, cubic). Mirror of PICKUP_RADIUS in echo.js. */
export const PICKUP_RADIUS = AMPLIFIER_PICKUP_RADIUS;

/** The §3.4 core key format - matches the World's `_resonanceCorePositions` map. */
export function resonanceCoreKey(x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

/** Map a Core's assigned transition (AB/BG/AG) to a per-biome core color. */
export function resonanceCoreColorForBiome(biomeId) {
  if (biomeId === 5) return 0xd9b34c; // Desert - amber
  if (biomeId === 6) return 0x88ccff; // Crystal Cavern - pale blue
  if (biomeId === 7) return 0x88ff88; // Phase Nexus - green
  return 0xffffff; // default white
}

/**
 * Pick a transition (AB / BG / AG) for a Core at a given (x, y, z).
 * Deterministic: same chunk seed -> same amplifier.
 */
export function pickAmplifierForKey(key) {
  if (typeof key !== 'string' || key.length === 0) return AMPLIFIER_AB;
  // Hash the key to a stable 0-2 pick
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % 3;
  return [AMPLIFIER_AB, AMPLIFIER_BG, AMPLIFIER_AG][idx];
}

/** Check if an amplifier applies to a transition from phase `a` to phase `b`. */
export function amplifierApplies(ampName, fromPhase, toPhase) {
  if (!ampName) return false;
  const phases = AMPLIFIER_TRANSITIONS[ampName];
  if (!phases) return false;
  return phases.indexOf(fromPhase) !== -1 && phases.indexOf(toPhase) !== -1;
}

/** Cubic distance compare (matches the Echo / Stabilizer / Anchor pickup pattern). */
export function isWithinRadius(playerPos, corePos, radius) {
  radius = (typeof radius === 'number' && Number.isFinite(radius)) ? radius : PICKUP_RADIUS;
  if (!playerPos || !corePos) return false;
  const dx = Math.abs((playerPos.x || 0) - (corePos.x || 0));
  const dy = Math.abs((playerPos.y || 0) - (corePos.y || 0));
  const dz = Math.abs((playerPos.z || 0) - (corePos.z || 0));
  return dx <= radius && dy <= radius && dz <= radius;
}

/** Walk the core list, return the nearest Core within radius (or null). */
export function pickupResult(playerPos, coreList, radius) {
  radius = (typeof radius === 'number' && Number.isFinite(radius)) ? radius : PICKUP_RADIUS;
  if (!playerPos || !Array.isArray(coreList) || coreList.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < coreList.length; i++) {
    const c = coreList[i];
    if (!c) continue;
    if (c.collected) continue;
    if (!isWithinRadius(playerPos, c, radius)) continue;
    const dx = (playerPos.x || 0) - (c.x || 0);
    const dy = (playerPos.y || 0) - (c.y || 0);
    const dz = (playerPos.z || 0) - (c.z || 0);
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** Floating animation: bob + slow rotation, mirrors echo.js's floatingOffset. */
export function floatingOffset(t, phase) {
  const tt = (typeof t === 'number' && Number.isFinite(t)) ? t : 0;
  const ph = (typeof phase === 'number' && Number.isFinite(phase)) ? phase : 0;
  return {
    y: Math.sin((tt * 1.5) + ph) * 0.15,
    rotY: tt * 0.6 + ph,
  };
}

/** Map a `BLOCK_RESONANCE_CORE` block to the World data shape. */
export function coreToWorldData(x, y, z, amplifier, biomeId) {
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    amplifier: amplifier || AMPLIFIER_AB,
    biomeId: Number.isFinite(biomeId) ? biomeId : 0,
    loreKey: resonanceCoreKey(x, y, z),
    collected: false,
    blockId: BLOCK_RESONANCE_CORE,
  };
}

export const RESONANCE_CORE_AMPLIFIERS = [AMPLIFIER_AB, AMPLIFIER_BG, AMPLIFIER_AG];

export function isResonanceCoreBlock(blockId) {
  return blockId === BLOCK_RESONANCE_CORE;
}
