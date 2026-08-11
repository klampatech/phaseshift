/**
 * Phase 10.9 — Energy danger tier helper.
 *
 * The brief calls for "energy as a feeling" — a tiered visual + audio
 * response to low energy. The 4 tiers are:
 *   - 'normal'    (energy >= 30) — default visuals, no audio cue
 *   - 'low'       (energy <  30) — HUD throb orange + no audio yet
 *   - 'critical'  (energy <  15) — heartbeat audio + faster throb
 *   - 'collapse'  (energy <= 0) — screen vignette pulse + louder
 *                                  heartbeat (the §3.2 collapse
 *                                  timer takes over within 1.5s)
 *
 * The helper is a pure function so the same tier can be computed
 * from the renderer's energy readout (UI) and the main.js game
 * loop (audio + vignette). The thresholds are also exported as
 * constants for the static-analysis tests.
 *
 * Defensive: non-finite or negative energy values clamp to the
 * 'collapse' tier so the screen vignette fires even on a corrupt
 * save.
 */

// The thresholds the brief explicitly calls out. Stored as constants
// so the static-analysis tests can assert on them + so the renderer
// and game loop can't drift out of sync.
export const ENERGY_TIER_LOW_THRESHOLD = 30;       // < 30 → 'low' (orange throb)
export const ENERGY_TIER_CRITICAL_THRESHOLD = 15;  // < 15 → 'critical' (heartbeat)
export const ENERGY_TIER_COLLAPSE_THRESHOLD = 0;   // <= 0 → 'collapse' (vignette)

/**
 * Return the energy tier for the given energy value. Pure function.
 *
 * @param {number} energy - current energy in [0, 100]
 * @returns {'normal'|'low'|'critical'|'collapse'}
 */
export function energyTier(energy) {
  if (typeof energy !== 'number' || !Number.isFinite(energy) || energy < 0) {
    return 'collapse';
  }
  if (energy <= ENERGY_TIER_COLLAPSE_THRESHOLD) return 'collapse';
  if (energy < ENERGY_TIER_CRITICAL_THRESHOLD) return 'critical';
  if (energy < ENERGY_TIER_LOW_THRESHOLD) return 'low';
  return 'normal';
}
