// ============================================================================
// REFERENCE IMPLEMENTATION — DO NOT IMPORT.
//
// This module is the orphan "GameEngine" code path (see
// PROJECT_REMEDIATION_PLAN.md, Phase 0). The active game loads from
// `main.js` at the repo root, which wires `src/core/world.js`,
// `src/core/phase.js`, and `src/core/physics.js` as the single source of
// truth. The features in this file (Particles, Phase Lock, Resonance
// pulses, Echo collectibles, Phase Collapse) are ported into the active
// path one at a time; this file is the *reference* for those ports, not
// the authority.
//
// Policy:
//   - Do not add `import { ... } from '...this file...'` anywhere.
//   - If a feature here is needed, port it into the active path first
//     and add tests, then delete or further quarantine this file.
//   - If you need to delete or rename this file, do so as a separate PR.
// ============================================================================

// Phase Lock Manager — anchors blocks when player shifts phases,
// creating temporary bridges/stairs that persist until expiry.

import * as THREE from 'three';
import { BLOCK_AIR } from './constants.js';

// Color for locked/anchored blocks: bright yellow-white glow
const LOCKED_BLOCK_COLOR = 0xffee88;
const LOCKED_BLOCK_BORDER = 0xffcc00;

export class PhaseLockManager {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.locks = new Map(); // "x,y,z,phase" -> { bx, by, bz, phase, expires, mesh }
    this.lockedVisuals = new THREE.Group();
    this.lockedVisuals.name = 'phaseLocks';
    this.scene.add(this.lockedVisuals);

    // Lock duration (seconds)
    this.lockDuration = 10;
    // Whether phase locking is enabled
    this.enabled = true;
  }

  // Called when a phase shift occurs
  // Checks if player is on/near a block that should be locked
  registerShift(playerX, playerY, playerZ, oldPhase, newPhase) {
    if (!this.enabled) return;

    // Lock blocks near the player during phase transition
    // Check a small radius around the player for blocks that exist in the new phase
    const lockRadius = 3;
    const lockYStart = Math.floor(playerY - 2);
    const lockYEnd = Math.floor(playerY + 3);

    for (let dx = -lockRadius; dx <= lockRadius; dx++) {
      for (let dz = -lockRadius; dz <= lockRadius; dz++) {
        for (let by = lockYStart; by <= lockYEnd; by++) {
          const bx = Math.floor(playerX) + dx;
          const bz = Math.floor(playerZ) + dz;

          // Only lock blocks that exist in the new phase
          // and are not already locked
          const key = `${bx},${by},${bz},${newPhase}`;
          if (this.locks.has(key)) continue;

          // Only lock if renderer.world exists (otherwise no block data to check)
          if (!this.renderer || !this.renderer.world) continue;

          const block = this.renderer.world.getBlock(bx, by, bz, newPhase);
          if (block === BLOCK_AIR) continue;

          // Lock this block — prioritize blocks closer to player's feet level
          const distY = Math.abs(by - Math.floor(playerY - 1.4));
          if (distY <= 2) {
            this.createLock(bx, by, bz, newPhase);
          }
        }
      }
    }
  }

  // Create a locked block visual and store the lock entry
  createLock(bx, by, bz, phase) {
    const key = `${bx},${by},${bz},${phase}`;

    // Create visual for the locked block
    const boxGeom = new THREE.BoxGeometry(1.02, 1.02, 1.02);

    // Solid yellow fill
    const fillMat = new THREE.MeshBasicMaterial({
      color: LOCKED_BLOCK_COLOR,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    const fillMesh = new THREE.Mesh(boxGeom, fillMat);
    fillMesh.position.set(bx + 0.5, by + 0.5, bz + 0.5);

    // Bright edge border
    const edges = new THREE.EdgesGeometry(boxGeom);
    const edgeMat = new THREE.LineBasicMaterial({
      color: LOCKED_BLOCK_BORDER,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
    });
    const edgesMesh = new THREE.LineSegments(edges, edgeMat);
    edgesMesh.position.set(bx + 0.5, by + 0.5, bz + 0.5);

    const group = new THREE.Group();
    group.add(fillMesh);
    group.add(edgesMesh);
    group.position.set(0, 0, 0);

    this.lockedVisuals.add(group);

    // Store the lock with expiry
    this.locks.set(key, {
      bx, by, bz, phase,
      expires: Date.now() + this.lockDuration * 1000,
      group,
      fillMat,
      edgeMat,
    });
  }

  // Clean up expired locks
  update(dt) {
    const now = Date.now();
    const expired = [];

    for (const [key, lock] of this.locks) {
      if (now >= lock.expires) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.removeLock(key);
    }

    // Fade locks that are about to expire (last 3 seconds)
    for (const [key, lock] of this.locks) {
      const remaining = (lock.expires - now) / 1000;
      if (remaining > 0 && remaining < 3) {
        // Pulse effect: oscillate opacity
        const pulse = 0.2 + 0.3 * Math.sin((3 - remaining) * Math.PI * 2);
        lock.fillMat.opacity = pulse;
        lock.edgeMat.opacity = pulse + 0.3;
      }
    }
  }

  // Remove a single lock
  removeLock(key) {
    const lock = this.locks.get(key);
    if (!lock) return;

    this.locks.delete(key);

    // Dispose resources
    if (lock.group) {
      this.lockedVisuals.remove(lock.group);
      if (lock.fillMat) lock.fillMat.dispose();
      if (lock.edgeMat) lock.edgeMat.dispose();
      lock.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
    }
  }

  // Clear all locks
  clearAll() {
    for (const key of [...this.locks.keys()]) {
      this.removeLock(key);
    }
  }

  // Check if a block coordinate is currently locked (for collision)
  isLocked(bx, by, bz, phase) {
    const key = `${bx},${by},${bz},${phase}`;
    const lock = this.locks.get(key);
    if (!lock) return false;

    // Clean up if expired
    if (Date.now() >= lock.expires) {
      this.removeLock(key);
      return false;
    }

    return true;
  }

  // Get all active lock keys (for collision checking)
  getActiveLockKeys() {
    return [...this.locks.keys()];
  }

  // Number of active locks
  count() {
    return this.locks.size;
  }
}
