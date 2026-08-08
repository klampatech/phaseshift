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

import { BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT, BLOCK_WOOD,
  BLOCK_CRYSTAL, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_RUNE, BLOCK_SAND,
  BLOCK_GLASS, BLOCK_IRON, BLOCK_GOLD_ORE, BLOCK_WATER, BLOCK_PROPERTIES,
  PHASE_STEP_THRESHOLD, PHASE_STEP_COOLDOWN, PHASE_STEP_DURATION,
  BLOCK_PHASE_COLORS } from './constants.js';
import * as THREE from 'three';

export class Player {
  constructor(scene, physicsManager, world, lockManager) {
    this.scene = scene;
    this.physicsManager = physicsManager;
    this.world = world;
    this.scene.userData.lockManager = lockManager;

    // Player state
    this.position = new THREE.Vector3(0, 30, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.onGround = false;
    this.width = 0.4;
    this.height = 1.8;

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.copy(this.position);
    this.camera.position.y += 1.6;
    this.lookYaw = 0;
    this.lookPitch = 0;

    // Controls
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.jump = false;
    this.sneak = false;
    this.fly = false; // Cheating

    // Input bindings
    this.keys = {};

    // Player mesh
    this.mesh = null;

    // Inventory
    this.inventory = {
      tools: [
        { toolId: 'phaseAnchor', owned: true, count: 1 }, // Starting tool
      ],
      amplifiers: [],
      echoes: [],
    };

    // Phase Step state
    this.lastPhaseStep = 0;
    this.phaseStepActive = false;
    this.phaseStepTimer = 0;
  }


  learnTool(toolId) {
    const existing = this.inventory.tools.find(t => t.toolId === toolId);
    if (!existing) {
      this.inventory.tools.push({ toolId: toolId, owned: true, count: 1 });
      return true;
    }
    return false;
  }

  /** Add an echo (lore) to inventory. */
  addEcho(lore, type = 'unknown') {
    this.inventory.echoes.push({ lore, type });
  }

  /** Get all collected echoes. */
  getEchoes() {
    return this.inventory.echoes;
  }

  /** Get the index of the currently equipped tool (first owned). */
  getEquippedToolIndex() {
    return this.inventory.tools.findIndex(t => t.owned);
  }

  /** Learn (unlock) an amplifier tool. */
  learnAmplifier(amplifierId) {
    const existing = this.inventory.amplifiers.find(a => a.toolId === amplifierId);
    if (!existing) {
      this.inventory.amplifiers.push({ toolId: amplifierId, owned: true });
      return true;
    }
    return false;
  }

  /** Check if player owns a specific amplifier. */
  hasAmplifier(amplifierId) {
    return this.inventory.amplifiers.some(a => a.toolId === amplifierId && a.owned);
  }

  /** Get owned amplifier IDs. */
  getOwnedAmplifiers() {
    return this.inventory.amplifiers.filter(a => a.owned).map(a => a.toolId);
  }

  /** Get all tools (owned and unowned). */
  getTools() {
    return this.inventory.tools;
  }

  /** Get all amplifiers (owned and unowned). */
  getAmplifiers() {
    return this.inventory.amplifiers;
  }

  createPlayerMesh() {
    const group = new THREE.Group();

    // Body
    const bodyGeom = new THREE.BoxGeometry(0.6, 0.8, 0.4);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.4;
    group.add(body);

    // Head
    const headGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.05;
    group.add(head);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.25, 0.6, 0.25);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x334455 });
    const leftLeg = new THREE.Mesh(legGeom, legMat);
    leftLeg.position.set(-0.15, -0.3, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeom, legMat);
    rightLeg.position.set(0.15, -0.3, 0);
    group.add(rightLeg);

    group.position.copy(this.position);
    this.scene.add(group);
    this.mesh = group;
    this.bodyMesh = body;
    this.headMesh = head;
    this.leftLeg = leftLeg;
    this.rightLeg = rightLeg;
  }

  // Set up keyboard input
  setupInput(keys) {
    this.keys = keys;
  }

  // Get current position
  getPosition() {
    return this.position;
  }

  // Alias for HUD compatibility
  getPos() {
    return this.position;
  }

  // Set position
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.mesh.position.copy(this.position);
    this.camera.position.copy(this.position);
    this.camera.position.y += 1.6;
  }

  // Get world blocks (flat array or per-phase)
  _getBlockData(phase) {
    const chunks = this.world.getChunks();
    const wx = Math.floor(this.position.x);
    const wz = Math.floor(this.position.z);
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const chunkKey = `${cx},${cz}`;
    const chunk = chunks.get(chunkKey);
    if (chunk && chunk[`${['alpha','beta','gamma'][phase]}Data`]) {
      return chunk[`${['alpha','beta','gamma'][phase]}Data`];
    }
    return null;
  }

  // Collision check
  // Phase-relative collision: only collide with blocks solid in current phase
  checkCollision(x, y, z, phase) {
    const world = this.world;
    const halfWidth = this.width / 2;
    const points = [
      [x - halfWidth, y, z - halfWidth],
      [x + halfWidth, y, z - halfWidth],
      [x - halfWidth, y, z + halfWidth],
      [x + halfWidth, y, z + halfWidth],
      [x - halfWidth, y + this.height, z - halfWidth],
      [x + halfWidth, y + this.height, z - halfWidth],
      [x - halfWidth, y + this.height, z + halfWidth],
      [x + halfWidth, y + this.height, z + halfWidth],
    ];
    for (const [px, py, pz] of points) {
      const bx = Math.floor(px);
      const by = Math.floor(py);
      const bz = Math.floor(pz);
      const block = world.getBlock(bx, by, bz, phase);
      const props = BLOCK_PROPERTIES[block];
      if (props && props.phaseSolid && props.phaseSolid[phase]) {
        return true;
      }
    }
    // Check locked blocks (they act as solid blocks in the active phase)
    if (this.scene.userData && this.scene.userData.lockManager) {
      const lm = this.scene.userData.lockManager;
      for (const [px, py, pz] of points) {
        const bx = Math.floor(px);
        const by = Math.floor(py);
        const bz = Math.floor(pz);
        if (lm.isLocked(bx, by, bz, phase)) {
          return true;
        }
      }
    }
    return false;
  }

  // Update player position based on input and physics
  update(dt, phase, isPaused, time = 0) {
    if (isPaused) return;

    const speed = this.sneak ? 3 : 6;
    const dirX = (this.keys.moveRight ? 1 : 0) - (this.keys.moveLeft ? 1 : 0);
    const dirZ = (this.keys.moveBackward ? 1 : 0) - (this.keys.moveForward ? 1 : 0);

    // Normalize diagonal movement
    if (dirX !== 0 || dirZ !== 0) {
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      const moveX = (dirX / len) * speed * dt;
      const moveZ = (dirZ / len) * speed * dt;

      // Rotate movement by camera yaw
      const cos = Math.cos(this.lookYaw);
      const sin = Math.sin(this.lookYaw);
      this.velocity.x += (moveX * cos - moveZ * sin);
      this.velocity.z += (moveX * sin + moveZ * cos);
    }

    // Jump
    if (this.keys.jump && this.onGround) {
      this.velocity.y = 8;
      this.onGround = false;
    }

    // Gravity
    if (!this.fly) {
      this.velocity.y -= 20 * dt;
    }

    // Apply friction
    this.velocity.x *= 0.85;
    this.velocity.z *= 0.85;

    // Simple collision detection
    const oldPos = { x: this.position.x, y: this.position.y, z: this.position.z };
    const newX = this.position.x + this.velocity.x * dt;
    const newY = this.position.y + this.velocity.y * dt;
    const newZ = this.position.z + this.velocity.z * dt;

    // X collision with Phase Step fallback
    if (!this.checkCollision(newX, this.position.y, this.position.z, phase)) {
      this.position.x = newX;
    } else {
      // Try phase step: if moving forward hits a wall in current phase,
      // check if a solid block exists in another phase at the target position
      const phaseStepPhase = this.checkPhaseStep(
        this.position.x, this.position.y, this.position.z,
        phase,
        this.velocity.x * dt,
        0
      );
      if (phaseStepPhase !== null && time - this.lastPhaseStep >= PHASE_STEP_COOLDOWN) {
        // Phase step succeeded: move through the wall, briefly in the alt phase
        this.position.x = newX;
        this.phaseStepActive = true;
        this.phaseStepTimer = PHASE_STEP_DURATION;
        this.lastPhaseStep = time;
        this.velocity.x *= 0.5;
        // Flash the mesh with target phase color
        this._flashPhase(phaseStepPhase);
      } else {
        this.velocity.x = 0;
      }
    }

    // Z collision with Phase Step fallback
    if (!this.checkCollision(this.position.x, this.position.y, newZ, phase)) {
      this.position.z = newZ;
    } else {
      // Try phase step on Z axis
      const phaseStepPhase = this.checkPhaseStep(
        this.position.x, this.position.y, this.position.z,
        phase,
        0,
        this.velocity.z * dt
      );
      if (phaseStepPhase !== null && time - this.lastPhaseStep >= PHASE_STEP_COOLDOWN) {
        this.position.z = newZ;
        this.phaseStepActive = true;
        this.phaseStepTimer = PHASE_STEP_DURATION;
        this.lastPhaseStep = time;
        this.velocity.z *= 0.5;
        this._flashPhase(phaseStepPhase);
      } else {
        this.velocity.z = 0;
      }
    }

    // Y collision (ground)
    const feetY = this.position.y - 1.4;
    if (this.checkCollision(this.position.x, feetY, this.position.z, phase)) {
      this.onGround = true;
      this.position.y = Math.floor(feetY) + 2.4;
      this.velocity.y = 0;
    } else {
      this.onGround = false;
      this.position.y = newY;
    }

    // Clamp to world bounds
    this.position.x = Math.max(-150, Math.min(150, this.position.x));
    this.position.z = Math.max(-150, Math.min(150, this.position.z));

    // Update mesh position
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.lookYaw;

    // Camera follows player
    this.camera.position.copy(this.position);
    this.camera.position.y += 1.6;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.lookYaw;
    this.camera.rotation.x = this.lookPitch;

    // Animate legs
    const walking = Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.z) > 0.1;
    const legAnim = walking ? Math.sin(Date.now() * 0.01) * 0.5 : 0;
    this.leftLeg.rotation.x = legAnim;
    this.rightLeg.rotation.x = -legAnim;
  }

  // ── Phase Step ───────────────────────────────────────────────
  // When moving forward hits a wall in the current phase but a solid
  // block exists in another phase, briefly phase through.
  phaseStep(dt, phase, time) {
    if (this.phaseStepActive) {
      this.phaseStepTimer -= dt;
      if (this.phaseStepTimer <= 0) {
        this.phaseStepActive = false;
        // Flash back to normal
        this._flashPhase(null);
      }
      return this.phaseStepActive;
    }
    return false;
  }

  // Flash player mesh color during phase step
  _flashPhase(targetPhase) {
    if (!this.mesh) return;
    if (targetPhase !== null && BLOCK_PHASE_COLORS[targetPhase]) {
      const c = BLOCK_PHASE_COLORS[targetPhase];
      // Flash the whole player mesh
      this.mesh.traverse(child => {
        if (child.isMesh && child.material) {
          const origColor = child.userData._origColor || child.material.color;
          child.material.emissive.setRGB(c.r * 0.3, c.g * 0.3, c.b * 0.3);
          child.userData._origColor = child.material.color;
        }
      });
    } else {
      // Reset flash - remove emissive
      if (this.mesh) {
        this.mesh.traverse(child => {
          if (child.isMesh && child.material && child.userData._origColor) {
            child.material.emissive.setRGB(0, 0, 0);
            delete child.userData._origColor;
          }
        });
      }
    }
  }

  // Check if a phase step is possible from (x,y,z) in moveX/moveZ direction.
  // Returns the alternative phase to step through, or null.
  checkPhaseStep(x, y, z, phase, moveX, moveZ) {
    const absMx = Math.abs(moveX);
    const absMz = Math.abs(moveZ);
    // Only phase step when moving (not standing still)
    if (absMx < 0.001 && absMz < 0.001) return null;

    // Where we're trying to move to
    const targetX = x + moveX;
    const targetZ = z + moveZ;

    // Get the feet and head y positions
    const feetY = y - 1.4;
    const headY = y + 0.2;

    // Check the target position in other phases for solid blocks
    for (let altPhase = 0; altPhase < 3; altPhase++) {
      if (altPhase === phase) continue;

      // Check if there's a solid block at feet level in the alt phase
      const bx = Math.floor(targetX);
      const by = Math.floor(feetY);
      const bz = Math.floor(targetZ);
      const block = this.world.getBlock(bx, by, bz, altPhase);
      const props = BLOCK_PROPERTIES[block];

      // Look for solid blocks near feet level (within 2 blocks up)
      if (props && props.solid) {
        // Calculate distance from where we are to the block
        // We want blocks that are roughly at our feet level, within threshold
        const distance = Math.sqrt(
          Math.pow(targetX - x, 2) + Math.pow(targetZ - z, 2)
        );
        if (distance <= PHASE_STEP_THRESHOLD) {
          return altPhase;
        }
      }
    }
    return null;
  }

  // Raycast for block placement/removal
  getTargetBlock(phase) {
    const raycaster = new THREE.Raycaster();
    raycaster.set(this.camera.getWorldPosition(), this.camera.getWorldDirection());

    const chunks = this.world.getChunks();
    const allMeshes = [];

    for (const [key, chunk] of chunks) {
      if (chunk.meshes && chunk.meshes[['alpha', 'beta', 'gamma'][phase]]) {
        allMeshes.push(chunk.meshes[['alpha', 'beta', 'gamma'][phase]]);
      }
    }

    const intersects = raycaster.intersectObjects(allMeshes, true);
    if (intersects.length > 0 && intersects[0].distance < this.reachDistance) {
      return {
        point: intersects[0].point,
        normal: intersects[0].face.normal,
        distance: intersects[0].distance
      };
    }
    return null;
  }

  // Update camera angle from mouse movement
  updateCamera(dx, dy) {
    this.lookYaw -= dx * 0.002;
    this.lookPitch -= dy * 0.002;
    this.lookPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.lookPitch));
  }
}
