import * as THREE from 'three';
import {
  CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE,
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  BLOCK_PROPERTIES, PHASE_STEP_THRESHOLD, PHASE_STEP_COOLDOWN,
} from './constants.js';

const GRAVITY = 25.0;
const JUMP_VELOCITY = 8.0;
const MOVE_SPEED = 4.0;
const FLY_SPEED = 8.0;
const PLAYER_HEIGHT = 1.7;
const PLAYER_WIDTH = 0.6;

export class PhysicsManager {
  constructor(world, phaseManager, lockManager = null) {
    this._world = world;
    this._phaseManager = phaseManager;
    this._lockManager = lockManager;
    this._pos = new THREE.Vector3(0, 20, 0);
    this._vel = new THREE.Vector3(0, 0, 0);
    this._isGrounded = false;
    this._groundedTimer = 0;
    this._isFlying = false;
    // Phase Step state
    this._phaseStepCooldown = 0;
    this._phaseStepping = false;
    this._phaseStepTimer = 0;
    this._phaseStepTargetPos = null;
  }

  setPosition(x, y, z) {
    this._pos.set(x, y, z);
    this._vel.set(0, 0, 0);
    this._isGrounded = false;
  }

  getPos() {
    return this._pos;
  }

  getVelocity() {
    return this._vel;
  }

  get isGrounded() {
    return this._isGrounded;
  }

  get isPhaseStepping() {
    return this._phaseStepping;
  }

  get phaseStepCooldown() {
    return this._phaseStepCooldown;
  }

  setFlying(flying) {
    this._isFlying = flying;
  }

  isFlying() {
    return this._isFlying;
  }

  // Check if a block position is solid in a given phase (phase-relative collision)
  _isBlockSolid(x, y, z, phase) {
    phase = phase ?? this._phaseManager.getCurrentPhase();
    const block = this._world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z), phase);
    if (block === BLOCK_AIR) return false;
    const props = BLOCK_PROPERTIES[block];
    if (!props) return false;
    // Use phase-specific solid mask (from constants.js phaseSolid array)
    if (props.phaseSolid) {
      return props.phaseSolid[phase];
    }
    // Fallback to legacy single boolean solid
    return props.solid;
  }

  // Check if a lock exists at position (for collision)
  _isLockSolid(x, y, z) {
    if (!this._lockManager) return false;
    const phase = this._phaseManager.getCurrentPhase();
    return this._lockManager.isLocked(
      Math.floor(x), Math.floor(y), Math.floor(z), phase
    );
  }

  // AABB collision check for player at position with velocity
  // Phase-relative: checks blocks in the current active phase
  // Also checks phase locks (anchored blocks)
  _checkCollision(x, y, z, vx, vy, vz) {
    const hw = PLAYER_WIDTH / 2;
    const minX = Math.floor(x - hw);
    const maxX = Math.floor(x + hw);
    const minY = Math.floor(y - PLAYER_HEIGHT);
    const maxY = Math.floor(y);
    const minZ = Math.floor(z - hw);
    const maxZ = Math.floor(z + hw);

    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (this._isBlockSolid(bx, by, bz)) {
            return true;
          }
          if (this._isLockSolid(bx, by, bz)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Check if a block at (x,y,z) is a "gap" in the current phase but
  // solid in another phase → candidate for phase step
  _findPhaseStepBlock(x, y, z) {
    const currentPhase = this._phaseManager.getCurrentPhase();
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);

    // If already solid in current phase, no phase step needed
    if (this._isBlockSolid(fx, fy, fz, currentPhase)) {
      return null;
    }

    // Check other phases for a solid block
    for (let p = 0; p < PHASE_COUNT; p++) {
      if (p === currentPhase) continue;
      if (this._isBlockSolid(fx, fy, fz, p)) {
        return { x: fx, y: fy, z: fz, phase: p };
      }
    }
    return null;
  }

  // Try to perform a phase step: bridge a gap by temporarily shifting phase
  tryPhaseStep(moveX, moveZ) {
    if (this._phaseStepCooldown > 0 || this._phaseStepping) return false;
    if (this._isFlying) return false;

    const hw = PLAYER_WIDTH / 2;
    // Point ahead in the movement direction
    const aheadX = this._pos.x + moveX * 0.8;
    const aheadZ = this._pos.z + moveZ * 0.8;
    const aheadY = this._pos.y - PLAYER_HEIGHT + 0.5;

    const step = this._findPhaseStepBlock(aheadX, aheadY, aheadZ);
    if (!step) return false;

    // Check distance threshold
    const dx = step.x + 0.5 - this._pos.x;
    const dz = step.z + 0.5 - this._pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > PHASE_STEP_THRESHOLD) return false;

    // Phase step valid — lock it in
    this._phaseStepping = true;
    this._phaseStepTimer = 0;
    // Target position: at the face of the step block
    const tx = step.x + (moveX >= 0 ? 0 : 1);
    const tz = step.z + (moveZ >= 0 ? 0 : 1);
    this._phaseStepTargetPos = new THREE.Vector3(tx + 0.5, this._pos.y, tz + 0.5);
    return true;
  }

  updatePhaseStep(dt) {
    if (!this._phaseStepping) return;
    this._phaseStepTimer += dt;
    // Complete the phase step (move player to target position)
    if (this._phaseStepTargetPos) {
      this._pos.x = this._phaseStepTargetPos.x;
      this._pos.z = this._phaseStepTargetPos.z;
    }
    this._phaseStepping = false;
    this._phaseStepCooldown = PHASE_STEP_COOLDOWN;
    this._phaseStepTargetPos = null;
  }

  update(dt, moveX, moveZ) {
    if (!moveX && !moveZ) {
      moveX = 0;
      moveZ = 0;
    }

    const speed = this._isFlying ? FLY_SPEED : MOVE_SPEED;
    const activePhase = this._phaseManager.getCurrentPhase();

    // Only collide with blocks solid in current phase
    const isPhaseActive = this._phaseManager.isPhaseActive();

    // Apply gravity (only in non-active phases)
    if (!isPhaseActive && !this._isFlying) {
      this._vel.y -= GRAVITY * dt;
    }

    // Phase Step: process pending phase step
    if (this._phaseStepping) {
      this.updatePhaseStep(dt);
    }
    // Cooldown countdown
    if (this._phaseStepCooldown > 0) {
      this._phaseStepCooldown -= dt;
      if (this._phaseStepCooldown < 0) this._phaseStepCooldown = 0;
    }

    // Flying mode: use horizontal velocity directly
    if (this._isFlying) {
      this._vel.x = moveX * speed;
      this._vel.z = moveZ * speed;
      this._vel.y = 0;
      this._pos.x += this._vel.x * dt;
      this._pos.y += this._vel.y * dt;
      this._pos.z += this._vel.z * dt;
      return;
    }

    // Phase Step: try a phase step if moving
    if (moveX !== 0 || moveZ !== 0) {
      if (this.tryPhaseStep(moveX, moveZ)) {
        // Phase step triggered — just position update, no further physics this frame
        return;
      }
    }

    // Set horizontal velocity from input
    this._vel.x = moveX * speed;
    this._vel.z = moveZ * speed;

    // Move X
    let newX = this._pos.x + this._vel.x * dt;
    if (!this._checkCollision(newX, this._pos.y, this._pos.z, this._vel.x, 0, 0)) {
      this._pos.x = newX;
    } else {
      this._vel.x = 0;
    }

    // Move Z
    let newZ = this._pos.z + this._vel.z * dt;
    if (!this._checkCollision(this._pos.x, this._pos.y, newZ, 0, 0, this._vel.z)) {
      this._pos.z = newZ;
    } else {
      this._vel.z = 0;
    }

    // Move Y (gravity + jump)
    let newY = this._pos.y + this._vel.y * dt;
    if (this._vel.y < 0) {
      // Falling
      if (!this._checkCollision(this._pos.x, newY, this._pos.z, 0, this._vel.y, 0)) {
        this._pos.y = newY;
        this._isGrounded = false;
      } else {
        // Land on something
        // Snap to top of block below
        this._pos.y = Math.floor(newY) + PLAYER_HEIGHT;
        this._vel.y = 0;
        this._isGrounded = true;
        this._groundedTimer = 0;
      }
    } else {
      // Rising (jumping)
      if (!this._checkCollision(this._pos.x, newY, this._pos.z, 0, this._vel.y, 0)) {
        this._pos.y = newY;
        this._isGrounded = false;
      } else {
        // Hit ceiling
        this._pos.y -= 0.1;
        this._vel.y = 0;
      }
    }

    // Keep player in bounds (don't fall below world)
    if (this._pos.y < 0) {
      this._pos.y = 30;
      this._vel.y = 0;
    }
  }

  jump() {
    if (!this._isGrounded) return;
    this._vel.y = JUMP_VELOCITY;
    this._isGrounded = false;
  }

  setGrounded(grounded) {
    this._isGrounded = grounded;
  }
}
