// src/input/placeBlock.js
//
// Phase 2.3: per-phase block placement helper.
//
// `placeBlock(hit, blockId, context)` writes a block at the adjacent face
// of the targeted cell. It is the validated twin of main.js#placeBlockAt
// (which is the unvalidated write primitive). The acceptance criteria
// from `PHASE_2_3_BRIEF.md`:
//
//   1. Refuse if the target cell is non-air in the current phase (BLOCK_AIR
//      is the only legal overwrite in §2.3 — placing on top of an existing
//      block would let the player stack arbitrary blocks, which is out of
//      scope).
//   2. Refuse if the target cell would overlap the player's AABB (use
//      PhysicsManager._isBlockSolid / World.isBlockSolid conceptually —
//      here we check AABB overlap directly so the function is testable
//      without instantiating PhysicsManager).
//   3. Refuse if the current phase's solidity mask for `blockId` would
//      put a solid block where the player is standing. (Tied to Phase 2.2's
//      World.isBlockSolid. The AABB-overlap check above covers this case
//      for blocks already solid in the current phase; we re-check via the
//      mask as a defensive double-anchor on the §2.3 contract.)
//   4. Call `world.setBlock(targetX, targetY, targetZ, phase, blockId)`.
//   5. Update chunk visuals (caller's responsibility — the helper does
//      not touch the renderer).
//
// The function is a pure module export — no Three.js, no globals. The
// `context` object bundles the three collaborators the helper needs:
//   - world: a duck-typed World (only getBlock + setBlock are read/written)
//   - phaseManager: anything with getCurrentPhase()
//   - physicsManager: anything with getPos() returning a Vector3-like
//
// Tests construct a tiny fixture (`makeTinyWorld` + a stub PhaseManager +
// a stub PhysicsManager) and pass it in. main.js passes the live
// context as `{ world, phaseManager, physicsManager }`.

import { BLOCK_AIR, BLOCK_PROPERTIES } from '../core/constants.js';

// Player AABB constants — mirror src/core/physics.js PLAYER_WIDTH and
// PLAYER_HEIGHT. The brief specifies the same magic numbers; centralizing
// them here would require a round-trip through physics.js, which is fine
// but not necessary for §2.3.
const PLAYER_WIDTH = 0.6;
const PLAYER_HEIGHT = 1.7;

/**
 * Test whether the player's axis-aligned bounding box overlaps the unit
 * cube at integer cell coordinates (cellX, cellY, cellZ).
 *
 * The player AABB is half-width `PLAYER_WIDTH/2` in X and Z, and
 * `PLAYER_HEIGHT` tall in Y (feet at `playerPos.y - PLAYER_HEIGHT`, top
 * at `playerPos.y` — the pos is the player's eye position in main.js
 * but the physics manager exposes the feet position; we accept whatever
 * the caller passes in).
 *
 * Pure function — no Three.js, no globals.
 */
export function playerAABBOverlapsCell(playerPos, cellX, cellY, cellZ) {
  const hw = PLAYER_WIDTH / 2;
  const minX = playerPos.x - hw;
  const maxX = playerPos.x + hw;
  const minY = playerPos.y - PLAYER_HEIGHT;
  const maxY = playerPos.y;
  const minZ = playerPos.z - hw;
  const maxZ = playerPos.z + hw;

  // AABB overlap test: target cell is a unit cube [cell, cell+1]^3.
  return (
    minX < cellX + 1 && maxX > cellX &&
    minY < cellY + 1 && maxY > cellY &&
    minZ < cellZ + 1 && maxZ > cellZ
  );
}

/**
 * Per-phase place. Returns `{ ok: true, x, y, z, phase }` on success or
 * `{ ok: false, reason: 'no-hit' | 'target-not-air' | 'overlaps-player' |
 * 'solid-in-player-cell' }` on refusal. Reasons are strings so tests can
 * pin the failure mode.
 *
 * @param {object|null} hit - raycast result `{ blockX, blockY, blockZ, face }`
 * @param {number} blockId - block type id from BLOCK_* constants
 * @param {object} context - { world, phaseManager, physicsManager }
 * @returns {object}
 */
export function placeBlock(hit, blockId, context) {
  if (!hit) return { ok: false, reason: 'no-hit' };
  const { world, phaseManager, physicsManager } = context || {};
  if (!world || !phaseManager || !physicsManager) {
    return { ok: false, reason: 'missing-context' };
  }

  const targetX = hit.blockX + hit.face.x;
  const targetY = hit.blockY + hit.face.y;
  const targetZ = hit.blockZ + hit.face.z;
  const phase = phaseManager.getCurrentPhase();

  // (1) Target cell must be air in the current phase. Refuse otherwise.
  const existing = world.getBlock(targetX, targetY, targetZ, phase);
  if (existing !== BLOCK_AIR) {
    return { ok: false, reason: 'target-not-air' };
  }

  // (2) Target cell must not overlap the player's AABB. Refuse otherwise.
  const playerPos = physicsManager.getPos();
  if (playerAABBOverlapsCell(playerPos, targetX, targetY, targetZ)) {
    return { ok: false, reason: 'overlaps-player' };
  }

  // (3) Defensive double-check: if the block's solidity mask marks it
  // solid in the current phase, would the player be standing inside it?
  // The AABB check above already covers this, but the brief specifies
  // both checks. If the block is non-solid in the current phase, this
  // short-circuits and we proceed.
  const props = BLOCK_PROPERTIES[blockId];
  const isSolidInPhase = props
    ? (props.phaseSolid ? !!props.phaseSolid[phase] : !!props.solid)
    : false;
  if (isSolidInPhase && playerAABBOverlapsCell(playerPos, targetX, targetY, targetZ)) {
    return { ok: false, reason: 'solid-in-player-cell' };
  }

  // (4) Place the block in the current phase only. The global state
  // snapshot is updated by world.setBlock (Phase 1.7 contract).
  world.setBlock(targetX, targetY, targetZ, phase, blockId);

  return { ok: true, x: targetX, y: targetY, z: targetZ, phase };
}
