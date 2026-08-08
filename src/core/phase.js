import { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, PHASE_NAMES, PHASE_PHASED, PHASE_COLORS, PHASE_SHIFT_COST, INITIAL_ENERGY, MAX_ENERGY, PHASE_REGEN_RATE_ALPHA, ENERGY_REGEN_RATE } from './constants.js';

export class PhaseManager {
  constructor() {
    this._currentPhase = PHASE_ALPHA;
    this._energy = INITIAL_ENERGY;
    this._isShifting = false;
    this._targetPhase = PHASE_ALPHA;
    this._shiftProgress = 0;
    this._shiftDuration = 1.5; // seconds
    this._energyRegenRate = ENERGY_REGEN_RATE;
    this._alphaRegenRate = PHASE_REGEN_RATE_ALPHA;
    this._listeners = [];
  }

  getCurrentPhase() {
    return this._currentPhase;
  }

  getEnergy() {
    return this._energy;
  }

  getMaxEnergy() {
    return MAX_ENERGY;
  }

  getTargetPhase() {
    return this._targetPhase;
  }

  getPhaseRGB() {
    return PHASE_COLORS[this._currentPhase] || '#ffffff';
  }

  // Public accessors for direct property usage
  get isShifting() { return this._isShifting; }
  get currentPhase() { return this._currentPhase; }
  get energy() { return this._energy; }
  get targetPhase() { return this._targetPhase; }

  setEnergy(energy) {
    this._energy = Math.max(0, Math.min(MAX_ENERGY, energy));
  }

  setPhase(phase) {
    if (phase >= 0 && phase < PHASE_COUNT) {
      this._currentPhase = phase;
      this._targetPhase = phase;
      this._isShifting = false;
      this._shiftProgress = 0;
      this._energy = Math.max(this._energy, 20);
      this._notifyListeners();
    }
  }

  notify() {
    this._notifyListeners();
  }

  isPhaseActive() {
    return PHASE_PHASED[this._currentPhase];
  }

  getPhaseColor() {
    const colors = ['#5aa85a', '#3399e6', '#d9b34c'];
    return colors[this._currentPhase] || '#ffffff';
  }

  getPhaseName() {
    return PHASE_NAMES[this._currentPhase] || 'Unknown';
  }

  cyclePhase() {
    if (this._isShifting || this._energy < PHASE_SHIFT_COST) {
      return false;
    }
    this._targetPhase = (this._currentPhase + 1) % PHASE_COUNT;
    this._isShifting = true;
    this._shiftProgress = 0;
    this._energy -= PHASE_SHIFT_COST;
    return true;
  }

  /**
   * Immediately complete a phase shift (for testing / force mode).
   */
  completeShift() {
    if (!this._isShifting) return;
    this._currentPhase = this._targetPhase;
    this._isShifting = false;
    this._shiftProgress = 1;
    this._notifyListeners();
  }

  addListener(listener) {
    if (typeof listener === 'function') {
      this._listeners.push(listener);
    }
  }

  _notifyListeners() {
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (e) {
        console.error('[PhaseManager] Listener error:', e);
      }
    }
  }

  update(dt) {
    if (this._isShifting) {
      this._shiftProgress += dt / this._shiftDuration;
      if (this._shiftProgress >= 1.0) {
        this._currentPhase = this._targetPhase;
        this._isShifting = false;
        this._shiftProgress = 0;
        this._notifyListeners();
      }
    } else {
      // Regen energy
      this._energy = Math.min(MAX_ENERGY, this._energy + this._energyRegenRate * dt * 60);
      // Extra regen in Alpha phase
      if (this._currentPhase === PHASE_ALPHA) {
        this._energy = Math.min(MAX_ENERGY, this._energy + this._alphaRegenRate * dt * 60);
      }
    }
  }

  consumeEnergy(amount) {
    if (this._energy >= amount) {
      this._energy -= amount;
      return true;
    }
    return false;
  }

  regenEnergy() {
    this._energy = Math.min(MAX_ENERGY, this._energy + this._energyRegenRate * 60);
  }

  getPhaseShiftProgress() {
    return this._isShifting ? this._shiftProgress : 0;
  }

  getCycleDuration() {
    return this._shiftDuration;
  }

  canPhaseShift() {
    return !this._isShifting && this._energy >= PHASE_SHIFT_COST;
  }

  reset() {
    this._currentPhase = PHASE_ALPHA;
    this._energy = INITIAL_ENERGY;
    this._isShifting = false;
    this._targetPhase = PHASE_ALPHA;
    this._shiftProgress = 0;
  }

  // --- Additional tools for UI & gameplay ---

  getBiomeCount() {
    return 0; // biome tracking not in this implementation
  }

  getUnlockedTools() {
    return []; // tool unlocking not in this implementation
  }

  hasTool(toolName) {
    return false;
  }

  unlockTool(toolName) {
    return false;
  }

  addEcho() {
    return false;
  }
}
