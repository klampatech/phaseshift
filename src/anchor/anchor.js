/**
 * Phase Shifter — Phase Anchor (Phase 2.7)
 *
 * Pure module. No Three.js, no globals, no scene access. The renderer's
 * `AnchorOverlay` and the game loop's `placeAnchor` + `onPhaseChanged`
 * snap-to-anchor both delegate to the helpers here so the lifetime, the
 * color palette, the fade window, and the placement rules are all in
 * one place.
 *
 * The brief (PHASE_2_7_BRIEF.md) calls for:
 *   - a 10-second lifetime (the plan's §2.7 acceptance — "After 10
 *     seconds the outline disappears")
 *   - a yellow-glow outline (fill = #ffee88, border = #ffcc00; the
 *     same palette as the orphan PhaseLockManager.LOCKED_BLOCK_COLOR /
 *     LOCKED_BLOCK_BORDER)
 *   - a 3-second pulse-fade before expiry (mirror of the orphan's
 *     last-3-seconds pulsing behavior)
 *   - placement on the cell above the targeted face (same convention
 *     as src/input/placeBlock.js#placeBlock — the anchor is on the
 *     block the player is looking at, not the empty cell in front)
 *   - the cell directly under the player's feet (floor(playerY) - 1)
 *     is the "standing on it" check, used by onPhaseChanged to
 *     re-snap the player's Y so a phase shift doesn't drop them
 *     through
 *   - 0 energy cost to place (anchors are free; the §2.7 spec
 *     mentions no energy)
 *
 * The world arg is anything that exposes `getBlock(x, y, z, phase)`
 * (the canonical `World` class) so `placeAnchorAt` can validate the
 * target cell is solid. Kept as an injected dependency so the helpers
 * can be exercised in a unit test without loading the World class.
 */
import {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  BLOCK_AIR, BLOCK_PROPERTIES,
  ANCHOR_LIFETIME, ANCHOR_FADE_WINDOW, ANCHOR_FILL_COLOR, ANCHOR_BORDER_COLOR,
  ANCHOR_COST,
  PLAYER_HEIGHT, PLAYER_RADIUS,
} from '../core/constants.js';

// ── Constants (canonical getters) ───────────────────────────────

/**
 * Canonical anchor lifetime (seconds). The plan's §2.7 acceptance is
 * "10 seconds the outline disappears." Pure getter so consumers
 * can't accidentally drift the value out of sync.
 */
export function anchorLifetime() {
  return ANCHOR_LIFETIME;
}

/**
 * Canonical anchor fade window (seconds-before-expiry during which
 * the outline pulse-fades). Mirrors the orphan PhaseLockManager's
 * 3-second pulse fade. Pure getter so consumers can't drift the
 * value out of sync.
 */
export function anchorFadeWindow() {
  return ANCHOR_FADE_WINDOW;
}

/**
 * Canonical anchor fill color (number, 0xRRGGBB). Mirrors the
 * orphan's LOCKED_BLOCK_COLOR (0xffee88 — pale yellow). The renderer's
 * AnchorOverlay uses this for the translucent fill mesh.
 */
export function anchorFillColor() {
  return ANCHOR_FILL_COLOR;
}

/**
 * Canonical anchor border color (number, 0xRRGGBB). Mirrors the
 * orphan's LOCKED_BLOCK_BORDER (0xffcc00 — bright gold). The renderer's
 * AnchorOverlay uses this for the bright edge border.
 */
export function anchorBorderColor() {
  return ANCHOR_BORDER_COLOR;
}

/**
 * Canonical anchor cost (energy per place). The §2.7 spec is silent
 * on energy; we treat the anchor as free (cost = 0). Pure getter so
 * the value stays in lockstep with the constant.
 */
export function anchorCost() {
  return ANCHOR_COST;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Canonical anchor key. Same convention as the orphan + World._globalKey:
 * `"${x},${y},${z},${phase}"`. Two anchors at the same (x, y, z, phase)
 * collapse to one (re-pressing on the same cell refreshes the lifetime
 * rather than stacking). The key is what the renderer's wireframe Map
 * and the World's anchor Map both key on.
 */
export function anchorKey(x, y, z, phase) {
  return `${x},${y},${z},${phase}`;
}

/**
 * Compute the anchor's translucent fill opacity for the given
 * remaining seconds. Mirrors the orphan PhaseLockManager's behavior:
 *   - when `remaining > fadeWindow`, the fill opacity is the
 *     constant default (0.4) — the lock looks steady
 *   - when `remaining <= fadeWindow`, the fill opacity oscillates
 *     between 0.2 and 0.5: `0.2 + 0.3 * sin((fadeWindow - remaining) * 2π)`
 *     — the lock pulses faster as it approaches expiry
 *
 * Pure function — deterministic for any (remaining, phase) pair.
 * Defensive: non-finite or negative inputs clamp to the steady state.
 */
export function anchorFadeOpacity(remainingSeconds) {
  const fade = anchorFadeWindow();
  const r = Number.isFinite(remainingSeconds) ? remainingSeconds : 0;
  if (r > fade) return 0.4;
  if (r < 0) return 0.0;
  // Last `fade` seconds: oscillate 0.2 → 0.5 → 0.2 → 0.5 (sine).
  // At r=0 (just expired) the sine is 0 → opacity 0.2.
  // At r=fade/4 (just entered the fade window) the sine is 1 → opacity 0.5.
  return 0.2 + 0.3 * Math.sin((fade - r) * Math.PI * 2);
}

/**
 * Compute the anchor's edge border opacity for the given remaining
 * seconds. Mirrors the orphan: border opacity = fill opacity + 0.3,
 * clamped to 0.95 so the border never goes fully opaque (it would
 * visually dominate the fill).
 */
export function anchorBorderOpacity(remainingSeconds) {
  const fill = anchorFadeOpacity(remainingSeconds);
  return Math.min(0.95, fill + 0.3);
}

/**
 * Walk the `anchors` map (Map<key, { x, y, z, phase, remaining }>)
 * and decrement each `remaining` by `dt`. Returns the list of keys
 * that have expired (remaining <= 0). The caller is expected to
 * delete the expired keys from the map and forward the list to
 * the renderer for wireframe cleanup.
 *
 * Pure function — does not mutate the input map. The caller mutates.
 * This is the model Phase 2.5/2.6 used for `findPhaseDifferences` /
 * `resonateWithReport`: a pure read-side helper + a world method
 * that applies the side effects.
 */
export function tickAnchors(anchors, dt) {
  if (!(anchors instanceof Map)) return [];
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const expired = [];
  for (const [key, anchor] of anchors) {
    if (!anchor || typeof anchor.remaining !== 'number') continue;
    const next = anchor.remaining - d;
    if (next <= 0) {
      expired.push(key);
    }
  }
  return expired;
}

/**
 * Defensive single-anchor check. Returns true when decrementing
 * `dt` from the anchor's `remaining` would expire it. Used by
 * unit tests to assert the `tickAnchors` boundary behavior.
 */
export function isAnchorExpired(anchor, dt) {
  if (!anchor || typeof anchor.remaining !== 'number') return true;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  return (anchor.remaining - d) <= 0;
}

/**
 * Compute the cell directly under the player's feet. Returns
 * `null` if the player position is non-finite. The Y offset is
 * the top of the player body to the cell below the feet (1 block
 * down). This is the canonical "standing on it" lookup for the
 * §2.7 onPhaseChanged snap-to-anchor logic.
 */
export function cellUnderPlayer(playerX, playerY, playerZ) {
  if (!Number.isFinite(playerX) || !Number.isFinite(playerY) || !Number.isFinite(playerZ)) {
    return null;
  }
  return {
    x: Math.floor(playerX),
    y: Math.floor(playerY) - 1,
    z: Math.floor(playerZ),
  };
}

/**
 * Compute the Y position the player should snap to when standing
 * on an anchor. The cell under the player's feet is at world
 * coordinates (cellX, cellY, cellZ); the player stands on TOP of
 * that cell, so their feet are at Y = cellY + 1 and their eye
 * height is at Y = cellY + 1 + PLAYER_HEIGHT. This is the same
 * convention as the Phase 1.3 spawn raycast.
 */
export function snapYForCell(cellY) {
  if (!Number.isFinite(cellY)) return null;
  return cellY + 1 + PLAYER_HEIGHT;
}

/**
 * Check whether the player AABB overlaps the given world cell.
 * Mirrors `playerAABBOverlapsCell` from src/input/placeBlock.js
 * (the §2.3 helper). Returns true when any corner of the player's
 * AABB (PLAYER_RADIUS around the player X/Z, feet at playerY,
 * head at playerY + PLAYER_HEIGHT) is inside the cell.
 */
export function playerAABBOverlapsAnchorCell(playerX, playerY, playerZ, cellX, cellY, cellZ) {
  if (!Number.isFinite(playerX) || !Number.isFinite(playerY) || !Number.isFinite(playerZ)) return false;
  if (!Number.isFinite(cellX) || !Number.isFinite(cellY) || !Number.isFinite(cellZ)) return false;
  const minX = playerX - PLAYER_RADIUS;
  const maxX = playerX + PLAYER_RADIUS;
  const minY = playerY - PLAYER_HEIGHT;
  const maxY = playerY;
  const minZ = playerZ - PLAYER_RADIUS;
  const maxZ = playerZ + PLAYER_RADIUS;
  return (
    maxX > cellX && minX < cellX + 1
    && maxY > cellY && minY < cellY + 1
    && maxZ > cellZ && minZ < cellZ + 1
  );
}

/**
 * Pure placement helper. Mirrors `placeBlock` from
 * src/input/placeBlock.js (the §2.3 helper). Rejects:
 *   - `no-hit`               — `hit` is null/undefined
 *   - `target-not-air`       — the targeted block is not visible in
 *                              the current phase (the player can't
 *                              anchor a block they can't see)
 *   - `overlaps-player`      — the anchor cell would be inside the
 *                              player's AABB
 * Returns:
 *   - `{ ok: false, reason: 'no-hit' | 'target-not-air' | 'overlaps-player' | 'bad-input' }`
 *   - `{ ok: true, x, y, z, phase }` — the anchor cell. The anchor
 *     is placed at the cell above the targeted face (same convention
 *     as `placeBlockAtTarget` — the anchor is on the block the
 *     player is looking at, not the empty cell in front of it).
 *
 * The `world` argument is anything that exposes
 * `getBlock(x, y, z, phase)`. Kept as an injected dependency so
 * the helper can be exercised in a unit test without loading the
 * World class.
 */
export function placeAnchorAt(playerX, playerY, playerZ, hit, currentPhase, world) {
  if (!hit) return { ok: false, reason: 'no-hit' };
  if (currentPhase < PHASE_ALPHA || currentPhase >= PHASE_COUNT) return { ok: false, reason: 'bad-input' };
  if (!world || typeof world.getBlock !== 'function') return { ok: false, reason: 'bad-input' };

  const face = (hit.face && typeof hit.face === 'object') ? hit.face : { x: 0, y: 0, z: 0 };
  const fx = (Number.isFinite(face.x) ? Math.sign(face.x) : 0);
  const fy = (Number.isFinite(face.y) ? Math.sign(face.y) : 0);
  const fz = (Number.isFinite(face.z) ? Math.sign(face.z) : 0);

  // The targeted block is at (blockX, blockY, blockZ). The face
  // normal points to the empty cell the player is looking at, so
  // the cell with the block is (blockX - fx, blockY - fy, blockZ - fz).
  const targetX = Math.floor(hit.blockX - fx);
  const targetY = Math.floor(hit.blockY - fy);
  const targetZ = Math.floor(hit.blockZ - fz);

  // The anchor is placed at the cell above the targeted face
  // (the same convention as placeBlockAtTarget).
  const ax = Math.floor(hit.blockX + fx);
  const ay = Math.floor(hit.blockY + fy);
  const az = Math.floor(hit.blockZ + fz);

  // Refuse if the targeted block is air in the current phase
  // (the player can't anchor a block they can't see).
  const targetBlock = world.getBlock(targetX, targetY, targetZ, currentPhase);
  if (targetBlock === BLOCK_AIR) {
    return { ok: false, reason: 'target-not-air', targetX, targetY, targetZ };
  }

  // Refuse if the target block isn't visible in the current phase
  // (defensive — covers blocks like Obsidian in Alpha/Beta where
  // getBlock returns the underlying id but it's not visible).
  const props = BLOCK_PROPERTIES[targetBlock];
  if (props && Array.isArray(props.phase) && !props.phase.includes(currentPhase)) {
    return { ok: false, reason: 'target-not-air', targetX, targetY, targetZ };
  }

  // Refuse if the anchor cell would overlap the player's AABB
  // (the player can't anchor the block they're standing inside).
  if (playerAABBOverlapsAnchorCell(playerX, playerY, playerZ, ax, ay, az)) {
    return { ok: false, reason: 'overlaps-player', x: ax, y: ay, z: az };
  }

  return { ok: true, x: ax, y: ay, z: az, phase: currentPhase, targetX, targetY, targetZ };
}

/**
 * Phase 2.7 re-export — the constants the anchor touches, so
 * consumers can pick a single import. Keeps the constants file as
 * the single source of truth; this is just a convenience re-export.
 */
export {
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  ANCHOR_LIFETIME, ANCHOR_FADE_WINDOW, ANCHOR_FILL_COLOR, ANCHOR_BORDER_COLOR,
  ANCHOR_COST, PLAYER_HEIGHT, PLAYER_RADIUS,
};
