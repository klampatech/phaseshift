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

// src/core/game.js
// 3D Game Engine - Phase Shifter

import * as THREE from 'three';
import { BLOCK_AIR, BLOCK_NAMES, BLOCK_PROPERTIES, BLOCK_STONE, BLOCK_STABILIZER, CHUNK_RENDER_DIST, PHASE_ALPHA, PHASE_BETA, PHASE_COLORS, PHASE_COUNT, MINIMUM_RESPAWN_ENERGY } from './constants.js';
import { World } from '../core/world.js';
import { PhaseManager } from '../core/phaseManager.js';
import { Player } from '../core/player.js';
import { Renderer } from '../render/renderer.js';
import { PhaseLockManager } from '../core/phaseLockManager.js';
import { Controls } from '../input/controls.js';
import { AudioEngine } from '../audio/manager.js';
import { HUD } from '../ui/hud.js';
import { SaveSystem, Settings } from '../save/system.js';
import { ParticleManager } from '../core/particles/particleManager.js';

const RENDER_DISTANCE = CHUNK_RENDER_DIST;

export class GameEngine {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.onStateChange = options.onStateChange || null;
    this.state = 'loading';
    this.forceCyclePhase = () => this.phaseManager.cyclePhase();

    // Create canvas for WebGL rendering
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    this.container.appendChild(canvas);

    // Initialize Three.js scene
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // Create camera
    const aspect = this.width / this.height;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.scene.add(this.camera);

    // Create WebGL renderer with antialiasing
    this.webglRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webglRenderer.setSize(this.width, this.height);
    this.webglRenderer.setClearColor(0x000000, 0);
    this.webglRenderer.shadowMap.enabled = false;

    // Add directional + ambient lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(50, 100, 50);
    this.scene.add(dirLight);
    this.scene.add(new THREE.AmbientLight(0x404040, 0.5));

    // Background
    this.scene.background = new THREE.Color(0x87ceeb);

    // Pause state
    this._paused = false;
    // Inventory panel state
    this._inventoryOpen = false;

    // Init sub-systems
    this._initSystems();

    // Set up chunk update callback
    this.world.onChunkUpdated = (chunk) => {
      this.renderer.updateChunk(chunk);
    };
    // Set up block interaction callback
    this.world.onBlockModified = (wx, wy, wz, phase, blockId) => {
      const props = BLOCK_PROPERTIES[blockId];
      const color = props ? (props.color || [128, 128, 128]) : [128, 128, 128];
      this.particles.emitBurst(wx + 0.5, wy + 0.5, wz + 0.5, 15, color, {
        speed: 1.0, size: 0.08, life: 0.6, spread: 0.5,
      });
    };
    // Set up erosion callback (emits particles when blocks erode)
    this.world.onEroded = (x, y, z, phase, oldBlockId, newBlockId) => {
      const oldProps = BLOCK_PROPERTIES[oldBlockId];
      const newProps = BLOCK_PROPERTIES[newBlockId];
      if (oldProps && newProps) {
        const oldColor = oldProps.color || [128, 128, 128];
        const newColor = newProps.color || [128, 128, 128];
        this.particles.emitErosionParticle(x + 0.5, y + 0.5, z + 0.5, oldColor, newColor);
      }
    };
  }

  _initSystems() {
    // World (creates its own terrain generator)
    this.world = new World(this.scene, () => {});

    // Phase manager (manages player phase state)
    this.phaseManager = new PhaseManager();

    // Player (physics, block interaction) - passes this phaseManager for reference
    this.player = new Player(this.scene, null, this.world, this.lockManager);

    // Renderer (passes WebGL renderer for post-processing)
    this.renderer = new Renderer(this.world, this.scene, this.camera, this.phaseManager, this.webglRenderer);

    // Phase Lock Manager
    this.lockManager = new PhaseLockManager(this.scene, this.renderer);

    // Controls (keyboard/mouse) - wraps the controls for game loop
    this.controls = new Controls(this.camera, this.container);

    // Audio
    this.audio = new AudioEngine();

    // Save/Load (auto-saves every 30 seconds, manual save on F12)
    this.saveSystem = new SaveSystem();

    // Particles (GPU-driven)
    this.particles = new ParticleManager(this.scene);

    // HUD
    this.hud = new HUD(this.container);

    // Time tracking
    this._time = 0;
  }

  async start() {
    // Initialize audio on user gesture
    this.audio.init();

    // Request pointer lock
    this.container.requestPointerLock();

    // Generate world chunks around spawn
    this.world.updateChunks(8, 8);

    // Place player
    const spawnY = 32;
    this.player.position.set(8, spawnY, 8);

    // Start game
    this.state = 'running';
    if (this.onStateChange) this.onStateChange(this.state);

    // Start game loop
    this._gameLoop();

    // Save shortcut (F5):
    const saveBtn = document.querySelector('#save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.saveSystem.save();
        this.hud.showNotification('Game saved!', '#4a4');
      });
    }

    // Load shortcut (F9):
    const loadBtn = document.querySelector('#load-btn');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        if (this.saveSystem.load()) {
          this.hud.showNotification('Game loaded!', '#4a4');
        }
      });
    }
  }

  _gameLoop() {
    requestAnimationFrame(this._gameLoop.bind(this));

    const dt = this.clock.getDelta();
    this._time += dt;

    if (this.state !== 'running') return;

    // ── Pause (ESC) ────────────────────────────────────────────
    const state = this.controls.getState();
    const justPressed = this.controls.getJustPressed();

    if (justPressed.paused) {
      // Toggle pause on ESC press (one-shot)
      this._paused = !this._paused;
      if (this._paused) {
        document.exitPointerLock();
        this.hud.showNotification('Paused', '#ffffff');
      } else {
        this.container.requestPointerLock();
        this.hud.showNotification('Resumed', '#ffffff');
      }
      this.hud.setPaused(this._paused);
      this.renderer.render(this.phaseManager.getCurrentPhase());
      this.audio.update({ phaseShift: false, resonance: false, musicPlaying: true });
      return;
    }
    if (this._paused) {
      this.hud.setPaused(true);
      this.renderer.render(this.phaseManager.getCurrentPhase());
      this.audio.update({ phaseShift: false, resonance: false, musicPlaying: true });
      return;
    }
    this.hud.setPaused(false);

    // Inventory (I): toggle inventory panel
    if (justPressed.toggleInventory) {
      this._inventoryOpen = !this._inventoryOpen;
      this.hud.showInventory(this.player, this._inventoryOpen);
      if (this._inventoryOpen) {
        this.hud.showNotification('Inventory', '#88aaff');
      }
    }
    if (this._inventoryOpen) {
      this.hud.showInventory(this.player, true);
    }

    const playerPhase = this.phaseManager.getCurrentPhase();
    const playerPos = this.player.position;

    // Scan (E): highlight nearby phase differences
    if (state.scanning) {
      const scanResults = this.world.scanNearby(playerPos.x, playerPos.y, playerPos.z, 4);
      // Highlight visible phase differences (render as emissive blocks)
      this.renderer.showScanResults(scanResults);
    } else {
      this.renderer.clearScanHighlights();
    }

    // Phase Lens (E): energy-costing scan revealing phase differences within a radius
    if (state.scanning) {
      const energyCost = 2.5; // cost per second
      if (this.phaseManager.getEnergy() > energyCost * dt) {
        this.phaseManager.setEnergy(this.phaseManager.getEnergy() - energyCost * dt);
        const cx = Math.floor(playerPos.x);
        const cy = Math.floor(playerPos.y);
        const cz = Math.floor(playerPos.z);
        this.world.scanPhaseLens(cx, cy, cz, 5, playerPhase);
        this.particles.emitPhaseLens(playerPos.x, playerPos.y, playerPos.z);
      }
    }

    // Echo interaction (T): activate nearby Echo objects (collectibles in Gamma)
    if (justPressed.toggleEcho) {
      const result = this.world.interactNearbyEcho(
        Math.floor(playerPos.x),
        Math.floor(playerPos.y),
        Math.floor(playerPos.z),
        4
      );
      if (result) {
        const { type, wx, wy, wz, lore } = result;
        this.player.addEcho(lore, type);
        this.hud.showNotification(
          lore ? `Echo: ${lore}` : `Echo of ${type} collected!`,
          '#88ccff'
        );
        this.world.setGlobalBlock(wx, wy, wz, playerPhase, BLOCK_AIR);
      }
    }

    // Phase Glider (Space in Gamma): gliding through Gamma phase void spaces
    if (state.jump && playerPhase === PHASE_GAMMA && !this.phaseManager.isShifting) {
      const vy = this.player.velocity.y || 0;
      if (vy < 0 || (this.player.onGround && vy >= 0)) {
        // Apply gravity reduced (gliding) instead of normal gravity
        const gliderGravity = 1.5; // normal gravity is 20
        this.player.velocity.y += (gliderGravity - 20) * dt;
        // Slow fall in Gamma (gliding effect)
        const speedMult = 0.6; // gliding reduces effective fall speed
        if (this.player.velocity.y < 0) {
          this.player.velocity.y *= (1 - (1 - speedMult) * dt * 2);
        }
        // Emit gliding particles
        this.particles.emitGlideTrail(playerPos.x, playerPos.y - 1.5, playerPos.z);
      }
    }

    // Resonate (Q): phase pulse swapping block states in 3×3×3 radius
    if (state.resonating) {
      const cx = Math.floor(playerPos.x);
      const cy = Math.floor(playerPos.y);
      const cz = Math.floor(playerPos.z);
      this.world.resonate(cx, cy, cz, 1);
      this.particles.emitResonancePulse(cx + 0.5, cy + 0.5, cz + 0.5, playerPhase);
    }

    // Phase shift (Shift+Space or right-click): shift to next phase (one-shot)
    if (justPressed.shifting) {
      this.phaseManager.shiftPhase(this.world, Math.floor(playerPos.x), Math.floor(playerPos.z), player);
    }

    // Direct phase select (1/2/3 keys): jump to specific phase
    if (state.phaseDirect !== null) {
      this.phaseManager.setPhase(state.phaseDirect);
    }

    // Save (F12): save current game state
    if (state.saveGame) {
      this._saveGame();
    }

    // Load (F9): load last saved game
    if (state.loadGame) {
      this._loadGame();
    }

    // Phase Anchor (F): place a temporary anchor block in front of player
    if (state.toggleAnchor) {
      this._placePhaseAnchor(playerPos);
    }

    // Update player
    this.player.update(dt, playerPhase, false, this.clock.getElapsedTime());

    // Phase management
    const phaseWasShifting = this.phaseManager.isShifting;
    const prevPhase = this.phaseManager.currentPhase;
    const energyBeforeUpdate = this.phaseManager.getEnergy();
    this.phaseManager.update(dt, player);
    // Apply resonance core proximity boost to energy regen
    this.phaseManager.updateResonanceBoost(
      this.world,
      playerPos.x,
      playerPos.y,
      playerPos.z
    );

    // Phase Collapse: if energy hit 0 during update and was not in Alpha, trigger collapse
    const currentEnergy = this.phaseManager.getEnergy();
    if (this.phaseManager.currentPhase !== PHASE_ALPHA && energyBeforeUpdate > 0 && currentEnergy <= 0) {
      this._handlePhaseCollapse();
    }

    // Erosion: erode blocks that have been exposed in their non-solid phase
    const ppos = this.player.position;
    this.world.checkErosion(dt, ppos.x, ppos.y, ppos.z, this.phaseManager.currentPhase);

    // Phase lock: register locks when phase shifts
    if (phaseWasShifting && prevPhase !== this.phaseManager.currentPhase) {
      const ppos = this.player.position;
      this.particles.emitPhaseShift(ppos.x, ppos.y, ppos.z, this.phaseManager.currentPhase, this.phaseManager.targetPhase);
      this.lockManager.registerShift(ppos.x, ppos.y, ppos.z, prevPhase, this.phaseManager.currentPhase);
    }

    // Update phase locks (expiry + fade)
    this.lockManager.update(dt);

    // Update world (chunk management)
    const ppos = this.player.position;
    this.world.updateChunks(ppos.x, ppos.z);

    // Update particles
    this.particles.update(dt);

    // Handle block interaction (left click = break, right click = place)
    this._handleBlockInteraction(playerPos, playerPhase, justPressed);
    this._handleResonance(playerPhase, justPressed);

    // Render
    this.renderer.render(playerPhase);

    // Audio
    this.audio.update({ phaseShift: phaseWasShifting, resonance: state.resonating, musicPlaying: true });

    // Show paused overlay when paused
    this.hud.setPaused(this._paused);

    // Ambient particles (subtle background effect)
    this.particles.emitAmbientParticles(ppos.x, ppos.y, ppos.z);

    // Movement dust (when moving)
    if (state.movingForward || state.movingBackward || state.movingLeft || state.movingRight) {
      const p = this.player.position;
      this.particles.emitDustTrail(p.x, p.y - 0.1, p.z);
    }

    // HUD update
    this.hud.update(this.phaseManager, this.player, this.world);
  }

  /**
   * Place a phase anchor block in front of the player.
   * Places at face distance of 3 blocks, in the direction of camera.
   */
  _placePhaseAnchor(pos) {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    const anchorDist = 3;

    // Check blocks from 1 to 3 blocks away along camera direction
    const bx = Math.floor(pos.x + dir.x * anchorDist);
    const by = Math.floor(pos.y - 1.4 + dir.y * anchorDist);
    const bz = Math.floor(pos.z + dir.z * anchorDist);

    const phase = this.phaseManager.getCurrentPhase();

    // Don't place if block already exists in this phase (use phase where it's empty)
    const existing = this.world.getBlock(bx, by, bz, phase);
    if (existing !== BLOCK_AIR) {
      // Find a phase where the position is empty
      let placed = false;
      for (let p = 0; p < PHASE_COUNT; p++) {
        if (this.world.getBlock(bx, by, bz, p) === BLOCK_AIR) {
          this.lockManager.createLock(bx, by, bz, p);
          this.hud.showNotification('Phase Anchor placed', '#ffee88');
          this.particles.emitBurst(bx + 0.5, by + 0.5, bz + 0.5, 30, [1, 0.9, 0.5], {
            speed: 1.5, size: 0.12, life: 1.0, spread: 0.8,
          });
          placed = true;
          break;
        }
      }
      if (!placed) {
        this.hud.showNotification('No valid anchor position', '#ff4444');
      }
      return;
    }

    // Place anchor in current phase
    this.lockManager.createLock(bx, by, bz, phase);
    this.hud.showNotification('Phase Anchor placed', '#ffee88');
  }

  _saveGame() {
    const state = {
      seed: this.world.worldSeed,
      position: this.player.position,
      phase: this.phaseManager.getCurrentPhase(),
      energy: this.phaseManager.getEnergy(),
      unlockedTools: this.player.unlockedTools || [],
      biomesDiscovered: this.world.biomesDiscovered || [],
      echoesFound: 0,
      worldState: this.world.getChangedBlocks && this.world.getChangedBlocks(),
    };
    this.saveSystem.save(state);
    this.hud.showNotification('Game saved (F12)', '#44ff44');
  }

  async _loadGame() {
    const savedState = await this.saveSystem.load();
    if (!savedState || !savedState.position) {
      this.hud.showNotification('No save found', '#ff8844');
      return;
    }
    // Restore player position
    this.player.position.set(savedState.position.x, savedState.position.y, savedState.position.z);
    // Restore phase
    this.phaseManager.setPhase(savedState.phase);
    // Restore energy
    this.phaseManager.energy = Math.min(savedState.energy, 100);
    // Restore unlocked tools
    if (savedState.unlockedTools) {
      this.player.unlockedTools = savedState.unlockedTools;
    }
    // Rebuild world with saved state
    await this.world.applySavedState(savedState);
    this.hud.showNotification('Game loaded', '#4488ff');
  }

  _handlePhaseCollapse() {
    const px = Math.floor(this.player.position.x);
    const py = Math.floor(this.player.position.y);
    const pz = Math.floor(this.player.position.z);

    // Find nearest stabilizer
    const nearest = this.world.findNearestStabilizer(px, py, pz);

    if (nearest) {
      // Teleport player to nearest stabilizer
      const dist = Math.sqrt(
        (px - nearest.x) ** 2 +
        (py - nearest.y) ** 2 +
        (pz - nearest.z) ** 2
      );

      // Restore energy and respawn
      this.phaseManager.energy = MINIMUM_RESPAWN_ENERGY;
      this.player.position.set(nearest.x + 0.5, nearest.y + 2, nearest.z + 0.5);

      // Collapse particles at old position
      this.particles.emitCollapseBurst(px + 0.5, py + 0.5, pz + 0.5);

      // Audio warning
      this.audio.playCollapse();

      this.hud.showNotification(
        `Phase collapse! Teleported ${Math.floor(dist)} blocks to stabilizer.`,
        '#ff4444'
      );
    } else {
      // No stabilizer nearby - respawn at spawn
      const spawnY = 32;
      this.player.position.set(8, spawnY, 8);
      this.phaseManager.energy = MINIMUM_RESPAWN_ENERGY;

      // Big collapse effect
      this.particles.emitCollapseBurst(px + 0.5, py + 0.5, pz + 0.5);
      this.particles.emitCollapseBurst(8.5, spawnY + 0.5, 8.5);

      this.audio.playCollapse();

      this.hud.showNotification(
        'Phase collapse! No stabilizer nearby. Respawned at origin.',
        '#ff0000'
      );
    }
  }

  // ── Block Interaction (raycast + mouse clicks) ───────────────
  /**
   * Voxel DDA raycast through the world.
   * Returns the first non-air block hit, or null.
   * { blockX, blockY, blockZ, phase, faceX, faceY, faceZ }
   */
  _raycastWorld(phase, origin, direction, maxDistance) {
    let x = origin.x;
    let y = origin.y;
    let z = origin.z;

    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    // Step size (fraction of a block per step)
    const step = 0.05;
    const maxSteps = Math.ceil(maxDistance / step);

    let prevX = Math.floor(x);
    let prevY = Math.floor(y);
    let prevZ = Math.floor(z);

    for (let i = 0; i < maxSteps; i++) {
      x += dx * step;
      y += dy * step;
      z += dz * step;

      const bx = Math.floor(x);
      const by = Math.floor(y);
      const bz = Math.floor(z);

      // Check if we crossed into a new voxel
      if (bx !== prevX || by !== prevY || bz !== prevZ) {
        const block = this.world.getBlock(bx, by, bz, phase);
        if (block !== BLOCK_AIR) {
          // Compute face normal: direction from previous block center to hit block center
          let faceX = bx - prevX;
          let faceY = by - prevY;
          let faceZ = bz - prevZ;
          // If multiple axes changed, use the one that changed most (surface normal)
          const absX = Math.abs(faceX);
          const absY = Math.abs(faceY);
          const absZ = Math.abs(faceZ);
          if (absX >= absY && absX >= absZ) faceY = faceZ = 0;
          else if (absY >= absX && absY >= absZ) faceX = faceZ = 0;
          else faceX = faceY = 0;

          return {
            blockX: bx,
            blockY: by,
            blockZ: bz,
            phase: phase,
            faceX,
            faceY,
            faceZ,
            blockId: block,
          };
        }
        prevX = bx;
        prevY = by;
        prevZ = bz;
      }
    }
    return null;
  }

  /**
   * Handle mouse clicks for block breaking and placing.
   */
  _handleBlockInteraction(playerPos, phase, justPressed) {
    if (justPressed.mouseClickLeft) {
      this._breakBlock(playerPos, phase);
    }
    if (justPressed.mouseClickRight) {
      this._placeBlock(playerPos, phase);
    }
  }

  /**
   * Break block at crosshair (left click).
   */
  _breakBlock(playerPos, phase) {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    const origin = new THREE.Vector3(
      playerPos.x,
      playerPos.y - 1.5,
      playerPos.z
    );

    const hit = this._raycastWorld(phase, origin, dir, 6);
    if (!hit) {
      this.hud.showNotification('Nothing to break', '#aaaaaa');
      return;
    }

    const { blockX: bx, blockY: by, blockZ: bz, blockId: bId } = hit;

    // Can't break immovable blocks (stabilizers, obsidian, phase anchors)
    const props = BLOCK_PROPERTIES[bId];
    if (props && props.immovable) {
      this.hud.showNotification(`Can't break ${props.name}`, '#ff4444');
      return;
    }

    // Break the block
    this.world.setGlobalBlock(bx, by, bz, phase, BLOCK_AIR);

    // Particle burst
    const color = props ? (props.color || [128, 128, 128]) : [128, 128, 128];
    this.particles.emitBurst(bx + 0.5, by + 0.5, bz + 0.5, 15, color, {
      speed: 0.8, size: 0.08, life: 0.5, spread: 0.4,
    });

    // Audio feedback
    this.audio.playBlockBreak();

    this.hud.showNotification(`${props ? props.name : 'Block'} broken`, '#ffaa44');
  }

  /**
   * Place block at crosshair (right click).
   * Defaults to placing stone blocks.
   */
  _placeBlock(playerPos, phase) {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    const origin = new THREE.Vector3(
      playerPos.x,
      playerPos.y - 1.5,
      playerPos.z
    );

    const hit = this._raycastWorld(phase, origin, dir, 6);
    if (!hit) {
      this.hud.showNotification('Can\'t place there', '#aaaaaa');
      return;
    }

    // Place on the face (adjacent to the hit block)
    const px = hit.blockX + hit.faceX;
    const py = hit.blockY + hit.faceY;
    const pz = hit.blockZ + hit.faceZ;

    // Don't place inside the player
    const playerEyeY = playerPos.y - 1.5;
    const playerBoxHalfWidth = 0.3;
    if (
      Math.abs(px - playerPos.x) <= 0.8 &&
      Math.abs(pz - playerPos.z) <= 0.8 &&
      py >= playerEyeY - 1.7 && py <= playerEyeY + 0.3
    ) {
      this.hud.showNotification('Can\'t place there (player in way)', '#ff4444');
      return;
    }

    // Check nothing already exists in this phase
    const existing = this.world.getBlock(px, py, pz, phase);
    if (existing !== BLOCK_AIR) {
      this.hud.showNotification('Position occupied', '#ff4444');
      return;
    }

    // Place stone block
    this.world.setGlobalBlock(px, py, pz, phase, BLOCK_STONE);

    // Particle burst
    this.particles.emitBurst(px + 0.5, py + 0.5, pz + 0.5, 8, [115, 115, 115], {
      speed: 0.5, size: 0.06, life: 0.4, spread: 0.3,
    });

    // Audio feedback
    this.audio.playBlockPlace();

    this.hud.showNotification('Stone placed', '#88cc88');
  }

  // ── Resonance (Q key) ─────────────────────────────────────────
  _handleResonance(phase, justPressed) {
    if (!this.player.mesh) return;

    // Resonate (Q key): Phase pulse that swaps block states in a 3×3×3 radius
    // Per spec: "Resonance Pulses: Swaps block states based on adjacency rules"
    if (justPressed.resonating) {
      const resonanceRange = 3;
      const playerPos = this.player.position;
      const px = Math.floor(playerPos.x);
      const py = Math.floor(playerPos.y);
      const pz = Math.floor(playerPos.z);

      let swapped = 0;
      for (let dx = -resonanceRange; dx <= resonanceRange; dx++) {
        for (let dy = -resonanceRange; dy <= resonanceRange; dy++) {
          for (let dz = -resonanceRange; dz <= resonanceRange; dz++) {
            const bx = px + dx;
            const by = py + dy;
            const bz = pz + dz;

            // Check distance (octagonal)
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > resonanceRange * 1.5) continue;

            // Swap block state: for each phase, move block to next phase
            for (let p = 0; p < 3; p++) {
              const block = this.world.getBlock(bx, by, bz, p);
              if (block === BLOCK_AIR) continue;

              // Move to next phase (cyclical swap)
              const nextPhase = (p + 1) % 3;
              const existing = this.world.getBlock(bx, by, bz, nextPhase);
              if (existing === BLOCK_AIR) {
                this.world.setGlobalBlock(bx, by, bz, p, BLOCK_AIR);
                this.world.setGlobalBlock(bx, by, bz, nextPhase, block);
                swapped++;
              } else if (existing !== block) {
                // Swap: exchange blocks between adjacent phases
                this.world.setGlobalBlock(bx, by, bz, p, existing);
                this.world.setGlobalBlock(bx, by, bz, nextPhase, block);
                swapped++;
              }
            }
          }
        }
      }

      if (swapped > 0) {
        // Energy cost for resonance
        const energyCost = swapped * 0.5;
        if (this.player.energy >= energyCost) {
          this.player.energy = Math.max(0, this.player.energy - energyCost);
          this.hud.showNotification(`Resonance: ${swapped} blocks swapped`, '#ff00ff');
          this.audio.playResonance(this.player.position);
        } else {
          this.hud.showNotification('Not enough energy for resonance', '#ff4444');
        }
      } else {
        this.hud.showNotification('Nothing to resonate', '#aaaaaa');
      }
    }
  }

  // ── Pause ─────────────────────────────────────────────────────
  togglePause() {
    if (this.state !== 'running') return;
    this._paused = !this._paused;
    if (this._paused) {
      document.exitPointerLock();
      this.hud.showNotification('Paused', '#ffffff');
    } else {
      this.container.requestPointerLock();
      this.hud.showNotification('Resumed', '#ffffff');
    }
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const aspect = this.width / this.height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(this.width, this.height);
  }
}

export default GameEngine;
