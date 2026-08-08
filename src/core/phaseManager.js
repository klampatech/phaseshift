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

// Phase management system
import { PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, PHASE_COLORS,
  PHASE_DRAIN_RATE_BETA, PHASE_DRAIN_RATE_GAMMA, PHASE_REGEN_RATE_ALPHA,
  PHASE_SHIFT_COST, MAX_PHASE_ENERGY, AMPLIFIER_AB, AMPLIFIER_BG, AMPLIFIER_AG,
  AMPLIFIER_SHIFT_REDUCTION, AMPLIFIER_DRAIN_REDUCTION } from './constants.js';

export class PhaseManager {
  constructor() {
    this.currentPhase = PHASE_ALPHA;
    this.targetPhase = PHASE_ALPHA;
    this._phaseAtStart = PHASE_ALPHA;
    this.energy = MAX_PHASE_ENERGY;
    this.maxEnergy = MAX_PHASE_ENERGY;
    this.shiftCooldown = 0;
    this.shiftAnimation = 0;
    this.isShifting = false;
    this.biomesDiscovered = new Set();
    this.echoesFound = 0;
    this.unlockedTools = [];
    this.onPhaseChange = null; // Callback for phase changes
  }

  getCurrentPhase() {
    return this.currentPhase;
  }

  getEnergy() {
    return this.energy;
  }

  getMaxEnergy() {
    return this.maxEnergy;
  }

  getTargetPhase() {
    return this.targetPhase;
  }

  getShiftProgress() {
    return this.shiftAnimation;
  }

  getPhaseName() {
    const names = ['ALPHA', 'BETA', 'GAMMA'];
    return names[this.currentPhase];
  }

  getPhaseColor() {
    const c = PHASE_COLORS[this.currentPhase];
    return `rgb(${c.r * 255}, ${c.g * 255}, ${c.b * 255})`;
  }

  getPhaseRGB() {
    return PHASE_COLORS[this.currentPhase];
  }

  shiftPhase(worldBlocks, playerX, playerZ, player) {
    if (this.energy < PHASE_SHIFT_COST) return false;
    if (this.shiftCooldown > 0) return false;

    // Calculate shift cost based on amplifiers
    let shiftCost = PHASE_SHIFT_COST;
    if (player && player.inventory && player.inventory.amplifiers) {
      const existing = player.inventory.amplifiers.filter(a => a.owned);
      for (const amp of existing) {
        const toolId = amp.toolId;
        // Determine if this amplifier applies to the current→next phase transition
        // Phase order: 0 (Alpha) → 1 (Beta) → 2 (Gamma) → 0 (Alpha)
        const fromPhase = this.currentPhase;
        const toPhase = (this.currentPhase + 1) % PHASE_COUNT;
        if (toolId === AMPLIFIER_AB) {
          // Amplifier AB helps with Alpha↔Beta transitions
          if ((fromPhase === PHASE_ALPHA && toPhase === PHASE_BETA) ||
              (fromPhase === PHASE_BETA && toPhase === PHASE_ALPHA)) {
            shiftCost -= AMPLIFIER_SHIFT_REDUCTION;
          }
        } else if (toolId === AMPLIFIER_BG) {
          // Amplifier BG helps with Beta↔Gamma transitions
          if ((fromPhase === PHASE_BETA && toPhase === PHASE_GAMMA) ||
              (fromPhase === PHASE_GAMMA && toPhase === PHASE_BETA)) {
            shiftCost -= AMPLIFIER_SHIFT_REDUCTION;
          }
        } else if (toolId === AMPLIFIER_AG) {
          // Amplifier AG helps with Alpha↔Gamma transitions
          if ((fromPhase === PHASE_ALPHA && toPhase === PHASE_GAMMA) ||
              (fromPhase === PHASE_GAMMA && toPhase === PHASE_ALPHA)) {
            shiftCost -= AMPLIFIER_SHIFT_REDUCTION;
          }
        }
      }
      // Ensure minimum cost doesn't go negative
      shiftCost = Math.max(1, shiftCost);
    }

    // Drain energy (use amplified cost if applicable)
    this.energy = Math.max(0, this.energy - shiftCost);

    // Shift to next phase
    this.currentPhase = (this.currentPhase + 1) % PHASE_COUNT;

    // Set cooldown
    this.shiftCooldown = 60; // frames

    // Start shift animation
    this.shiftAnimation = 1.0;

    // Clear biomes to rediscover
    this.biomesDiscovered.clear();

    // Notify
    if (this.onPhaseChange) {
      this.onPhaseChange(this.currentPhase, this.getPhaseName(), this.energy);
    }

    return true;
  }

  // Set phase directly (for UI selection)
  setPhase(phase) {
    if (phase >= 0 && phase < PHASE_COUNT) {
      this.targetPhase = phase;
      this.isShifting = true;
      this.currentPhase = phase;
      this.energy = Math.max(this.energy, 20); // Minimum energy for any phase
      this.shiftCooldown = 30;
      this.shiftAnimation = 1.0;

      if (this.onPhaseChange) {
        this.onPhaseChange(this.currentPhase, this.getPhaseName(), this.energy);
      }
    }
  }

  // Cycle through phases in order: 0 → 1 → 2 → 0
  cyclePhase() {
    const next = (this.currentPhase + 1) % PHASE_COUNT;
    this.setPhase(next);
  }

  // Track phase at start for waiting (called before phase shift)
  startPhaseWatch() {
    this._phaseAtStart = this.currentPhase;
  }

  // Check if phase has changed since watch started
  phaseChanged() {
    return this.currentPhase !== this._phaseAtStart;
  }

  update(dt, player) {
    // Phase cooldown
    if (this.shiftCooldown > 0) this.shiftCooldown -= 60 * dt;

    // Shift animation (progress from 1.0 to 0.0 during shift)
    if (this.shiftAnimation > 0) {
      this.shiftAnimation -= dt * 2;
      if (this.shiftAnimation <= 0) {
        this.shiftAnimation = 0;
        this.isShifting = false;
        // Reset current phase to match target when shift completes
        if (this.targetPhase !== this.currentPhase) {
          this.currentPhase = this.targetPhase;
        }
      }
    }

    // Calculate amplifier drain reduction
    let drainReduction = 0;
    if (player && player.inventory && player.inventory.amplifiers) {
      const existing = player.inventory.amplifiers.filter(a => a.owned);
      for (const amp of existing) {
        const toolId = amp.toolId;
        // Amplifier AB reduces drain when in Beta phase (Beta↔Alpha transitions)
        if (toolId === AMPLIFIER_AB && this.currentPhase === PHASE_BETA) {
          drainReduction += AMPLIFIER_DRAIN_REDUCTION;
        }
        // Amplifier BG reduces drain when in Gamma phase (Gamma↔Beta transitions)
        else if (toolId === AMPLIFIER_BG && this.currentPhase === PHASE_GAMMA) {
          drainReduction += AMPLIFIER_DRAIN_REDUCTION;
        }
        // Amplifier AG reduces drain when in Gamma phase (Gamma↔Alpha transitions)
        else if (toolId === AMPLIFIER_AG && this.currentPhase === PHASE_GAMMA) {
          drainReduction += AMPLIFIER_DRAIN_REDUCTION;
        }
      }
    }

    // Energy management based on current phase
    if (this.currentPhase === PHASE_ALPHA) {
      // Regen energy in alpha (base rate)
      const regenRate = PHASE_REGEN_RATE_ALPHA + (this._resonanceBoost || 0);
      this.energy = Math.min(this.maxEnergy, this.energy + regenRate * dt);
    } else if (this.currentPhase === PHASE_BETA) {
      // Drain in beta (reduced by amplifiers)
      const effectiveDrain = Math.max(0.05, PHASE_DRAIN_RATE_BETA - drainReduction);
      this.energy = Math.max(0, this.energy - effectiveDrain * dt);
    } else {
      // Drain faster in gamma (reduced by amplifiers)
      const effectiveDrain = Math.max(0.1, PHASE_DRAIN_RATE_GAMMA - drainReduction);
      this.energy = Math.max(0, this.energy - effectiveDrain * dt);
    }

    // Force return to alpha if energy depleted
    if (this.energy <= 0 && this.currentPhase !== PHASE_ALPHA) {
      this.currentPhase = PHASE_ALPHA;
      if (this.onPhaseChange) {
        this.onPhaseChange(this.currentPhase, this.getPhaseName(), 0);
      }
    }
  }

  unlockTool(toolName) {
    if (!this.unlockedTools.includes(toolName)) {
      this.unlockedTools.push(toolName);
      if (this.onPhaseChange) {
        this.onPhaseChange(this.currentPhase, this.getPhaseName(), this.energy, toolName);
      }
    }
  }

  hasTool(toolName) {
    return this.unlockedTools.includes(toolName);
  }

  addBiomeDiscovered(biomeId) {
    this.biomesDiscovered.add(biomeId);
  }

  /** Update resonance boost based on nearby resonance cores */
  updateResonanceBoost(world, playerX, playerY, playerZ) {
    const cores = world.getResonanceCores();
    if (cores.length === 0) {
      this._resonanceBoost = 0;
      return;
    }
    // Calculate boost based on number of nearby resonance cores
    const RANGE = 10;
    let boost = 0;
    for (const core of cores) {
      const dx = playerX - core.x;
      const dy = playerY - core.y;
      const dz = playerZ - core.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < RANGE) {
        boost += (1 - dist / RANGE) * 0.02; // 0.02 extra per nearby core, scaled by proximity
      }
    }
    this._resonanceBoost = boost;
  }

  hasBiomeDiscovered(biomeId) {
    return this.biomesDiscovered.has(biomeId);
  }

  addEcho() {
    this.echoesFound++;
  }

  getUnlockedTools() {
    return [...this.unlockedTools];
  }

  getBiomeCount() {
    return this.biomesDiscovered.size;
  }
}
