/**
 * Phase Shifter — Resonance charge-up (Phase 10.13)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * renderer's `ResonancePulse` and the game loop's `performResonance`
 * both delegate to the helpers here so the charge duration, the
 * commit duration, the cancel path, and the energy cost are all in
 * one place.
 *
 * The §10.13 brief calls for:
 *   - 0.5s charge-up window where the player previews the swap
 *   - 1.0s commit window where the swap actually fires (and the
 *     sphere pulse expands to full)
 *   - press Q again during the charge to cancel (no energy refund,
 *     no swap)
 *   - the energy cost is debited on commit, not on press
 *   - the cost moves from 15 to 25 to compensate for the
 *     preview-then-commit flow
 *
 * The state machine is a small 5-state machine:
 *   IDLE → CHARGING → COMMITTING → IDLE
 *             ↓
 *           CANCELLED → IDLE
 *
 * The `ResonancePulse` reads `charge.state` to know which animation
 * to render (smaller / dimmer sphere during CHARGING, full pulse
 * during COMMITTING, no pulse during IDLE / CANCELLED).
 *
 * Helpers are pure functions over plain state objects. The shape:
 *   {
 *     state: 'idle' | 'charging' | 'committing' | 'cancelled',
 *     elapsed: 0,
 *     playerEnergyAtPress: 100,
 *     centerX: 0, centerY: 0, centerZ: 0,
 *     currentPhase: 0,
 *   }
 *
 * Kept as a plain object so the helpers can be unit-tested without
 * loading the World / Three.js / scene.
 */
import { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT } from '../core/constants.js';

// ── Constants ───────────────────────────────────────────────────

/**
 * Phase 10.13: how long the charge window lasts (seconds). The
 * player has this long after pressing Q to decide whether to commit
 * (press Q again) or cancel (also press Q again, but the helper
 * distinguishes via the elapsed time). The §10.13 brief value is 0.5
 * seconds.
 */
export const RESONANCE_CHARGE_SECONDS = 0.5;

/**
 * Phase 10.13: how long the commit phase lasts (seconds). After the
 * charge completes the sphere pulse runs for this long while the
 * swap happens. The total lifetime is therefore
 * `RESONANCE_CHARGE_SECONDS + RESONANCE_COMMIT_SECONDS` ≈ 1.0s.
 * The brief value is 1.0 seconds.
 */
export const RESONANCE_COMMIT_SECONDS = 1.0;

/**
 * Phase 10.13: total pulse lifetime for the renderer
 * (`RESONANCE_PULSE_DURATION`). Re-exported here so callers that
 * import from the charge module don't need a second import for the
 * renderer's total. Note: the constants file currently uses the
 * value for the old one-shot pulse (1.0); we re-derive from the
 * two charge/commit values so the constants stay consistent if a
 * caller wants to bump either one.
 */
export const RESONANCE_TOTAL_DURATION = RESONANCE_CHARGE_SECONDS + RESONANCE_COMMIT_SECONDS;

// ── State factory ───────────────────────────────────────────────

/**
 * Return a fresh, inactive charge state. The defaults are tuned so
 * that `state.state === 'idle'` is the contract for "no charge
 * in progress". The caller (main.js) holds one of these and
 * mutates it through `startCharge` / `tickCharge` / `cancelCharge` /
 * `commitCharge`.
 *
 * Defensive: every numeric field defaults to 0 / `null` so the
 * helper never returns an undefined field (the renderer reads
 * these without null-checking).
 */
export function createChargeState() {
  return {
    state: 'idle', // 'idle' | 'charging' | 'committing' | 'cancelled'
    elapsed: 0,
    playerEnergyAtPress: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    currentPhase: PHASE_ALPHA,
    pendingCommit: false,
  };
}

// ── State transitions ───────────────────────────────────────────

/**
 * Begin a charge cycle. Resets elapsed, stores the player position
 * (for the resonance pulse anchor), the current phase (for the
 * tint), and the player's energy at press time (so we can refund
 * if a future version supports refunds; the §10.13 brief says no
 * refund). Returns the same state object for chaining.
 *
 * Defensive: `x` / `y` / `z` / `phase` are coerced to numbers; the
 * player's energy is clamped to `[0, MAX_ENERGY]` (the renderer
 * never sees a NaN energy).
 */
export function startCharge(state, x, y, z, phase, playerEnergy) {
  if (!state || typeof state !== 'object') return null;
  state.state = 'charging';
  state.elapsed = 0;
  state.centerX = Number.isFinite(x) ? x : 0;
  state.centerY = Number.isFinite(y) ? y : 0;
  state.centerZ = Number.isFinite(z) ? z : 0;
  state.currentPhase = (Number.isFinite(phase) && phase >= 0 && phase < PHASE_COUNT)
    ? Math.floor(phase)
    : PHASE_ALPHA;
  state.playerEnergyAtPress = (Number.isFinite(playerEnergy) && playerEnergy >= 0)
    ? playerEnergy
    : 0;
  state.pendingCommit = false;
  return state;
}

/**
 * Advance the charge state by `dt` seconds. Returns the updated
 * state. The transitions:
 *   - IDLE: no-op (returns state unchanged).
 *   - CHARGING: tick elapsed; if elapsed >= RESONANCE_CHARGE_SECONDS,
 *     transition to COMMITTING. The pendingCommit flag is set so
 *     the game loop can debit the energy and run the swap.
 *   - COMMITTING: tick elapsed; if elapsed >= RESONANCE_COMMIT_SECONDS,
 *     transition to IDLE (the pulse fades naturally).
 *   - CANCELLED: immediate IDLE (no energy debited, no swap).
 *
 * The renderer reads `state.elapsed` to compute the per-frame
 * sphere radius / opacity (see `previewAmount` / `commitAmount`).
 *
 * Defensive: non-finite dt falls back to 0 so a 0-second tick on
 * the press frame doesn't snap the state to COMMITTING.
 */
export function tickCharge(state, dt) {
  if (!state || typeof state !== 'object') return null;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (state.state === 'idle') return state;
  if (state.state === 'cancelled') {
    state.state = 'idle';
    state.elapsed = 0;
    state.pendingCommit = false;
    return state;
  }
  state.elapsed += d;
  if (state.state === 'charging') {
    if (state.elapsed >= RESONANCE_CHARGE_SECONDS) {
      // Promote to COMMITTING. Reset elapsed so the commit phase
      // starts at 0 (not RESONANCE_CHARGE_SECONDS).
      state.state = 'committing';
      state.elapsed = 0;
      state.pendingCommit = true;
    }
  } else if (state.state === 'committing') {
    if (state.elapsed >= RESONANCE_COMMIT_SECONDS) {
      state.state = 'idle';
      state.elapsed = 0;
      state.pendingCommit = false;
    }
  }
  return state;
}

/**
 * Cancel the current charge. No-op if the state is not 'charging'
 * (you can only cancel during the preview, not during the commit).
 * Per the §10.13 brief: "Press Q again within 1.0s to cancel
 * (no energy refund, but no swap)". The energy was never debited
 * during the charge so there's nothing to refund.
 *
 * Returns the same state object for chaining.
 */
export function cancelCharge(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.state !== 'charging') return state;
  state.state = 'cancelled';
  state.elapsed = 0;
  state.pendingCommit = false;
  return state;
}

/**
 * Manually commit the current charge (alternative to waiting for
 * the elapsed time to elapse). The renderer's pulse expands
 * immediately. Used when the player presses Q during the charge
 * window — the press commits the swap early rather than waiting
 * the full 0.5s.
 *
 * Defensive: no-op if not charging.
 */
export function commitCharge(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.state !== 'charging') return state;
  state.state = 'committing';
  state.elapsed = 0;
  state.pendingCommit = true;
  return state;
}

// ── State queries ───────────────────────────────────────────────

/**
 * Is the charge currently active (charging or committing)?
 * Mirrors the §10.13 pulse visibility — while true the renderer
 * shows a sphere mesh.
 */
export function isChargeActive(state) {
  return !!(state && (state.state === 'charging' || state.state === 'committing'));
}

/**
 * Is the charge in the 'charging' phase (the 0.5s preview window)?
 */
export function isCharging(state) {
  return !!(state && state.state === 'charging');
}

/**
 * Is the charge in the 'committing' phase (the post-press swap)?
 */
export function isCommitting(state) {
  return !!(state && state.state === 'committing');
}

/**
 * Has the charge completed but the commit hasn't fired yet?
 * Used by the game loop to drive the actual `world.resonateWithReport`
 * call (the §10.13 spec: "the energy cost is debited on commit,
 * not on press").
 */
export function isPendingCommit(state) {
  return !!(state && state.state === 'committing' && state.pendingCommit);
}

/**
 * Clear the pendingCommit flag. Called by the game loop after it
 * has debited the energy + run the swap + fired the audio. The
 * flag stays true for one tick so the game loop can detect the
 * edge transition reliably.
 */
export function clearPendingCommit(state) {
  if (!state || typeof state !== 'object') return null;
  state.pendingCommit = false;
  return state;
}

// ── Renderer helpers ────────────────────────────────────────────

/**
 * Compute the sphere preview amount for the current charging
 * phase. The preview is a small / dim sphere that grows from 0.2
 * → 0.6 over the charge window. Returns a number in `[0, 1]`:
 *   - 0 at the start of charge (sphere is at 0.2 / opacity 0.3)
 *   - 1 at the end of charge (sphere is at 0.6 / opacity 0.7)
 *
 * Pure function over the elapsed time during the 'charging' state.
 * Returns 0 outside the charging state (the renderer ignores the
 * value when not charging).
 */
export function previewAmount(elapsed) {
  const e = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  if (e >= RESONANCE_CHARGE_SECONDS) return 1;
  return Math.max(0, e / RESONANCE_CHARGE_SECONDS);
}

/**
 * Compute the sphere commit amount for the current committing
 * phase. The commit is the full pulse: expands from 0.6 → 1.0
 * over the commit window, opacity 0.7 → 0 (mirrors the old one-
 * shot pulse).
 *
 * Returns a number in `[0, 1]`:
 *   - 0 at the start of commit
 *   - 1 at the end of commit
 *
 * Pure function over the elapsed time during the 'committing' state.
 */
export function commitAmount(elapsed) {
  const e = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  if (e >= RESONANCE_COMMIT_SECONDS) return 1;
  return Math.max(0, e / RESONANCE_COMMIT_SECONDS);
}

/**
 * Compute the per-frame radius for the sphere pulse given the
 * charge state + elapsed time. During CHARGING the sphere scales
 * from 0.2 → 0.6 (the preview). During COMMITTING the sphere
 * scales from 0.6 → 1.0 (the full pulse). During IDLE / CANCELLED
 * the sphere is invisible — the renderer should hide its mesh.
 *
 * Pure function — deterministic for any (state, elapsed) pair.
 */
export function resonancePulseRadius(state) {
  if (!state || state.state === 'idle' || state.state === 'cancelled') return 0;
  if (state.state === 'charging') {
    const k = previewAmount(state.elapsed);
    return 0.2 + (0.6 - 0.2) * k;
  }
  // committing
  const k = commitAmount(state.elapsed);
  return 0.6 + (1.0 - 0.6) * k;
}

/**
 * Compute the per-frame opacity for the sphere pulse given the
 * charge state + elapsed time. Mirrors `resonancePulseRadius`:
 *   - CHARGING: opacity 0.3 → 0.7 (the preview glow)
 *   - COMMITTING: opacity 0.7 → 0 (the full pulse fade)
 *   - IDLE / CANCELLED: 0
 *
 * Pure function — deterministic for any (state, elapsed) pair.
 */
export function resonancePulseOpacity(state) {
  if (!state || state.state === 'idle' || state.state === 'cancelled') return 0;
  if (state.state === 'charging') {
    const k = previewAmount(state.elapsed);
    return 0.3 + (0.7 - 0.3) * k;
  }
  // committing: start at 0.7, fade to 0
  const k = commitAmount(state.elapsed);
  return 0.7 * (1 - k);
}

// ── Re-exports ──────────────────────────────────────────────────

export { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT };
