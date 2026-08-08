// Game State Manager - central game state object
import { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT } from '../core/constants.js';

export class GameState {
  constructor(phaseChanger, audioEngine) {
    this.phaseChanger = phaseChanger;
    this.audioEngine = audioEngine;

    // Core game state
    this.currentPhase = PHASE_ALPHA;
    this.energy = 100;
    this.maxEnergy = 100;
    this.isShifting = false;
    this.shiftProgress = 0;

    // World state
    this.blocks = new Map(); // "x,y,z" -> blockType
    this.renderDistance = 4;
    this.chunks = new Map(); // "cx,cz" -> chunk data

    // Player state
    this.player = {
      position: { x: 0, y: 30, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      onGround: false,
      health: 100,
    };

    // Game time
    this.time = 0;
    this.dayTime = 0;
    this.paused = false;
    this.gameOver = false;

    // Audio state (for AudioEngine.update)
    this.audioState = {
      mode: 'normal',
      phaseShift: false,
      resonance: false,
      musicPlaying: false,
    };

    // Event listeners
    this.listeners = [];

    // Inventory
    this.selectedSlot = 0;
    this.hotbar = [null, null, null, null, null, null, null, null, null];
  }

  addListener(fn) { this.listeners.push(fn); }
  notify() { this.listeners.forEach(fn => fn(this)); }

  getCurrentPhase() { return this.currentPhase; }

  setCurrentPhase(phase) {
    this.currentPhase = phase;
    this.audioState.mode = this._getPhaseName(phase);
    this.notify();
  }

  _getPhaseName(phase) {
    const names = [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA];
    return names[phase] || 'alpha';
  }

  getEnergy() { return this.energy; }
  setEnergy(val) { this.energy = Math.max(0, Math.min(this.maxEnergy, val)); }

  // Block manipulation
  setBlock(x, y, z, blockType) {
    const key = `${x},${y},${z}`;
    this.blocks.set(key, blockType);
    this.notify();
  }

  getBlock(x, y, z) {
    return this.blocks.get(`${x},${y},${z}`) || 0;
  }

  update(dt) {
    this.time += dt;
    this.dayTime = (this.dayTime + dt * 0.01) % 1;

    // Update audio state
    if (this.audioEngine) {
      this.audioEngine.update(this.audioState);
    }

    // Update phase shift animation
    if (this.isShifting) {
      this.shiftProgress += dt / 2; // 2 second shift
      if (this.shiftProgress >= 1) {
        this.shiftProgress = 0;
        this.isShifting = false;
        this.currentPhase = this.phaseChanger.getCurrentPhase();
        this.notify();
      }
    }
  }
}
