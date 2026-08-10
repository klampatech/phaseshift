/**
 * Phase Shifter - Tutorial Zone (Phase 3.6)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * per-frame `tickTutorialPerFrame` in main.js and the
 * `forceGenerateTutorial` debug hook both delegate to the
 * helpers here so the ring radius, the hint texts, the hint
 * timing, and the placement logic are all in one place.
 *
 * The §3.6 brief calls for:
 *   - a small "tutorial ring" of safe-to-walk terrain at the
 *     spawn point. The ring contains:
 *     - 1 Stone block at chest height (teaches break/place)
 *     - 1 row of Obsidian + Void blocks (teaches phase-shifting)
 *     - 1 Echo (teaches collect)
 *     - 1 Stabilizer (teaches checkpoint)
 *   - A HUD hint walks the player through the first 60 seconds.
 *
 * The helpers here are pure functions over plain data. The
 * `world` argument is a World instance (the caller has the
 * reference); the per-frame tick calls these helpers with the
 * player's current position + collected counts.
 */

// - Canonical constants -

/** The §3.6 tutorial ring radius (blocks). */
export const TUTORIAL_RADIUS = 4;

/** The §3.6 Stone block chest height (Y offset from player feet). */
export const TUTORIAL_STONE_OFFSET = { x: 2, y: 1, z: 0 };

/** The §3.6 Obsidian + Void row position (5 blocks in a row, E-W). */
export const TUTORIAL_PHASE_ROW_OFFSET = { x: -2, y: 0, z: 2, count: 5 };

/** The §3.6 Echo position (NW of the player). */
export const TUTORIAL_ECHO_OFFSET = { x: -2, y: 0, z: -2 };

/** The §3.6 Stabilizer position (NE of the player). */
export const TUTORIAL_STABILIZER_OFFSET = { x: 2, y: 0, z: -2 };

/** The §3.6 hint text array (one per hint, in display order). */
export const TUTORIAL_HINT_TEXTS = Object.freeze([
  'WASD to move, Space to jump',
  'Q to shift phases (Alpha <-> Beta <-> Gamma)',
  'Break the Stone block with Left Click',
  'Place a block with Right Click (RMB)',
  'Shift through the Obsidian + Void row (E to scan first)',
  'Collect the Echo (walk close)',
  'Place a Stabilizer (Right Click) to set a checkpoint',
  'Tutorial complete! Explore the world.',
]);

/** The §3.6 hint display time (seconds per hint). */
export const TUTORIAL_HINT_DURATION = 8;

/** The §3.6 hint total time (60s for 8 hints). */
export const TUTORIAL_TOTAL_DURATION = TUTORIAL_HINT_TEXTS.length * TUTORIAL_HINT_DURATION;

/** Block IDs used in the tutorial ring. */
import { BLOCK_STONE, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_STABILIZER, BLOCK_ECHO, BLOCK_AIR } from '../core/constants.js';

// - Helpers -

/** Compute the placement positions for the tutorial ring. */
export function tutorialPositions(playerX, playerY, playerZ) {
  const px = Math.floor(playerX);
  const py = Math.floor(playerY);
  const pz = Math.floor(playerZ);
  return {
    stone: { x: px + TUTORIAL_STONE_OFFSET.x, y: py + TUTORIAL_STONE_OFFSET.y, z: pz + TUTORIAL_STONE_OFFSET.z },
    phaseRow: (() => {
      const out = [];
      for (let i = 0; i < TUTORIAL_PHASE_ROW_OFFSET.count; i++) {
        out.push({
          x: px + TUTORIAL_PHASE_ROW_OFFSET.x + i,
          y: py + TUTORIAL_PHASE_ROW_OFFSET.y,
          z: pz + TUTORIAL_PHASE_ROW_OFFSET.z,
          blockId: (i % 2 === 0) ? BLOCK_OBSIDIAN : BLOCK_VOID,
        });
      }
      return out;
    })(),
    echo: { x: px + TUTORIAL_ECHO_OFFSET.x, y: py + TUTORIAL_ECHO_OFFSET.y, z: pz + TUTORIAL_ECHO_OFFSET.z },
    stabilizer: { x: px + TUTORIAL_STABILIZER_OFFSET.x, y: py + TUTORIAL_STABILIZER_OFFSET.y, z: pz + TUTORIAL_STABILIZER_OFFSET.z },
  };
}

/** Compute the next hint index from the elapsed time. */
export function hintIndexFor(elapsed) {
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.min(
    TUTORIAL_HINT_TEXTS.length - 1,
    Math.floor(elapsed / TUTORIAL_HINT_DURATION)
  );
}

/** Create a fresh tutorial state. */
export function createTutorialState() {
  return {
    active: false,
    startTime: 0,
    elapsed: 0,
    currentHint: 0,
    generated: false,
    playerPos: null,
  };
}

/** Start the tutorial. `now` is seconds (e.g. performance.now() / 1000). */
export function startTutorial(state, playerPos, now) {
  const s = (state && typeof state === 'object') ? state : createTutorialState();
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  s.active = true;
  s.startTime = t;
  s.elapsed = 0;
  s.currentHint = 0;
  s.generated = false;
  s.playerPos = (playerPos && typeof playerPos === 'object')
    ? { x: playerPos.x, y: playerPos.y, z: playerPos.z }
    : null;
  return s;
}

/** Tick the tutorial state. Returns the state + a `{ done, hint }` payload. */
export function tickTutorial(state, dt, now) {
  const s = (state && typeof state === 'object') ? state : createTutorialState();
  const rawDt = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
  const clampedDt = Math.max(0, Math.min(0.1, rawDt));
  const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
  if (!s.active) return { state: s, done: false, hint: null, hintIndex: -1 };
  s.elapsed += clampedDt;
  s.currentHint = hintIndexFor(s.elapsed);
  if (s.elapsed >= TUTORIAL_TOTAL_DURATION) {
    s.active = false;
    return { state: s, done: true, hint: null, hintIndex: -1 };
  }
  return {
    state: s,
    done: false,
    hint: TUTORIAL_HINT_TEXTS[s.currentHint],
    hintIndex: s.currentHint,
  };
}

/** Clear the tutorial state. */
export function clearTutorial(state) {
  if (!state) return createTutorialState();
  state.active = false;
  state.elapsed = 0;
  state.currentHint = 0;
  return state;
}

/** Return the current hint text for the elapsed time (helper). */
export function getHint(elapsed) {
  const idx = hintIndexFor(elapsed);
  return { hint: TUTORIAL_HINT_TEXTS[idx], hintIndex: idx };
}

/** Check if a position is within the tutorial ring. */
export function isWithinTutorialRing(playerX, playerY, playerZ, ringCenterX, ringCenterY, ringCenterZ) {
  if (!Number.isFinite(playerX) || !Number.isFinite(ringCenterX)) return false;
  const dx = Math.abs(Math.floor(playerX) - Math.floor(ringCenterX));
  const dy = Math.abs(Math.floor(playerY) - Math.floor(ringCenterY));
  const dz = Math.abs(Math.floor(playerZ) - Math.floor(ringCenterZ));
  return dx <= TUTORIAL_RADIUS && dy <= TUTORIAL_RADIUS && dz <= TUTORIAL_RADIUS;
}

export const TUTORIAL_DEFAULTS = Object.freeze({
  radius: TUTORIAL_RADIUS,
  hintDuration: TUTORIAL_HINT_DURATION,
  totalDuration: TUTORIAL_TOTAL_DURATION,
  hintCount: TUTORIAL_HINT_TEXTS.length,
});
