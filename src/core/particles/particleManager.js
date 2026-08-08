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

// src/core/particles/particleManager.js
// GPU-driven particle system using THREE.Points + custom shaders.
// Handles phase shift FX, dust, resonance pulses, block break FX.

import * as THREE from 'three';
import { particleVertexShader } from './particleVertexShader.js';
import { particleFragmentShader } from './particleFragmentShader.js';

const MAX_PARTICLES = 10000;

// Particle pools for different effects
const pool = {
  positions: new Float32Array(MAX_PARTICLES * 3),
  colors: new Float32Array(MAX_PARTICLES * 3),
  velocities: new Float32Array(MAX_PARTICLES * 3),
  lifetimes: new Float32Array(MAX_PARTICLES),
  sizes: new Float32Array(MAX_PARTICLES),
  alive: new Uint8Array(MAX_PARTICLES),
  timestamps: new Float32Array(MAX_PARTICLES),
};

export class ParticleManager {
  constructor(scene) {
    this.scene = scene;
    this.camera = null;

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(1, 1, 1) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(pool.positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(pool.velocities, 3));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(pool.lifetimes, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(pool.sizes, 1));

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.count = 0;
    this.maxParticles = MAX_PARTICLES;
  }

  setCamera(camera) {
    this.camera = camera;
  }

  update(dt) {
    if (!this.camera) return;

    const now = performance.now() / 1000;
    let writeIdx = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      if (!pool.alive[i]) continue;

      const elapsed = now - pool.timestamps[i];
      pool.lifetimes[writeIdx] = Math.max(0, 1 - elapsed);

      if (pool.lifetimes[writeIdx] <= 0) {
        pool.alive[i] = 0;
        continue;
      }

      // Update position based on velocity
      pool.positions[writeIdx * 3] = pool.positions[i * 3] + pool.velocities[i * 3] * dt;
      pool.positions[writeIdx * 3 + 1] = pool.positions[i * 3 + 1] + pool.velocities[i * 3 + 1] * dt;
      pool.positions[writeIdx * 3 + 2] = pool.positions[i * 3 + 2] + pool.velocities[i * 3 + 2] * dt;

      pool.colors[writeIdx * 3] = pool.colors[i * 3];
      pool.colors[writeIdx * 3 + 1] = pool.colors[i * 3 + 1];
      pool.colors[writeIdx * 3 + 2] = pool.colors[i * 3 + 2];

      pool.velocities[writeIdx * 3] = pool.velocities[i * 3];
      pool.velocities[writeIdx * 3 + 1] = pool.velocities[i * 3 + 1];
      pool.velocities[writeIdx * 3 + 2] = pool.velocities[i * 3 + 2];

      pool.sizes[writeIdx] = pool.sizes[i];
      pool.alive[writeIdx] = 1;
      pool.timestamps[writeIdx] = pool.timestamps[i];

      writeIdx++;
    }

    // Clear remaining particles
    for (let i = writeIdx; i < this.maxParticles; i++) {
      pool.alive[i] = 0;
      pool.positions[i * 3] = 0;
      pool.positions[i * 3 + 1] = -9999; // Hide off-screen
      pool.positions[i * 3 + 2] = 0;
    }

    this.count = writeIdx;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aVelocity.needsUpdate = true;
    geometry.attributes.aLife.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.setDrawRange(0, this.count);
  }

  emitBurst(x, y, z, count, color, options = {}) {
    const {
      speed = 3,
      size = 0.06,
      life = 0.8,
      spread = 1.5,
    } = options;

    let emitted = 0;
    for (let i = 0; i < this.maxParticles && emitted < count; i++) {
      if (pool.alive[i]) continue;

      const dx = (Math.random() - 0.5) * 2 * spread;
      const dy = (Math.random() - 0.5) * 2 * spread;
      const dz = (Math.random() - 0.5) * 2 * spread;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

      pool.positions[i * 3] = x;
      pool.positions[i * 3 + 1] = y;
      pool.positions[i * 3 + 2] = z;

      pool.velocities[i * 3] = (dx / len) * speed;
      pool.velocities[i * 3 + 1] = (dy / len) * speed;
      pool.velocities[i * 3 + 2] = (dz / len) * speed;

      pool.colors[i * 3] = color[0];
      pool.colors[i * 3 + 1] = color[1];
      pool.colors[i * 3 + 2] = color[2];

      pool.lifetimes[i] = 1;
      pool.sizes[i] = size;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;

      emitted++;
    }
  }

  emitPhaseShift(x, y, z, fromPhase, toPhase) {
    // Phase shift burst - expanding ring in the transition plane
    const phases = [
      new THREE.Color('#5aa85a'),  // Alpha - green
      new THREE.Color('#3399e6'),  // Beta - blue
      new THREE.Color('#d9b34c'),  // Gamma - gold
    ];

    const targetColor = phases[toPhase] || phases[0];
    const count = 100;

    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || i >= count) continue;

      const angle = (i / count) * Math.PI * 2;
      const radius = 3 + Math.random() * 0.5;

      pool.positions[i * 3] = x + Math.cos(angle) * radius;
      pool.positions[i * 3 + 1] = y + Math.sin(angle * 0.3) * 0.3;  // Slight vertical oscillation
      pool.positions[i * 3 + 2] = z + Math.sin(angle) * radius;

      // Move inward toward center
      const vx = (x - pool.positions[i * 3]) * 2;
      const vy = (y - pool.positions[i * 3 + 1]) * 2 + 1;
      const vz = (z - pool.positions[i * 3 + 2]) * 2;

      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;

      pool.velocities[i * 3] = (vx / len) * 2.5;
      pool.velocities[i * 3 + 1] = (vy / len) * 2.5;
      pool.velocities[i * 3 + 2] = (vz / len) * 2.5;

      pool.colors[i * 3] = targetColor.r;
      pool.colors[i * 3 + 1] = targetColor.g;
      pool.colors[i * 3 + 2] = targetColor.b;

      pool.lifetimes[i] = 1;
      pool.sizes[i] = 0.08;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }

  emitBlockBreak(x, y, z, color) {
    // Block break explosion
    const count = 20;
    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || i >= count) continue;

      pool.positions[i * 3] = x + (Math.random() - 0.5) * 0.8;
      pool.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.8;
      pool.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;

      const vx = (Math.random() - 0.5) * 2;
      const vy = Math.random() * 2 + 0.5;
      const vz = (Math.random() - 0.5) * 2;

      pool.velocities[i * 3] = vx;
      pool.velocities[i * 3 + 1] = vy;
      pool.velocities[i * 3 + 2] = vz;

      pool.colors[i * 3] = color[0] / 255;
      pool.colors[i * 3 + 1] = color[1] / 255;
      pool.colors[i * 3 + 2] = color[2] / 255;

      pool.lifetimes[i] = 1;
      pool.sizes[i] = 0.05;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }

  /** Emit block placement particles (small upward puffs). */
  emitBlockPlace(x, y, z, color) {
    const count = 8;
    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || i >= count) continue;

      pool.positions[i * 3] = x + (Math.random() - 0.5) * 0.5;
      pool.positions[i * 3 + 1] = y + 0.3;
      pool.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;

      pool.velocities[i * 3] = (Math.random() - 0.5) * 0.5;
      pool.velocities[i * 3 + 1] = Math.random() * 1.5 + 0.5;
      pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;

      pool.colors[i * 3] = color[0] / 255;
      pool.colors[i * 3 + 1] = color[1] / 255;
      pool.colors[i * 3 + 2] = color[2] / 255;

      pool.lifetimes[i] = 0.6;
      pool.sizes[i] = 0.04;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }

  emitResonancePulse(x, y, z, phase) {
    const phases = [
      new THREE.Color('#5aa85a'),  // Alpha
      new THREE.Color('#3399e6'),  // Beta
      new THREE.Color('#d9b34c'),  // Gamma
    ];

    const phaseColor = phases[phase] || phases[0];
    const count = 40;

    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || i >= count) continue;

      // Spherical shell expanding outward
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const radius = 0.5 + Math.random() * 0.5;

      pool.positions[i * 3] = x + radius * Math.sin(phi) * Math.cos(theta);
      pool.positions[i * 3 + 1] = y + radius * Math.sin(phi) * Math.sin(theta);
      pool.positions[i * 3 + 2] = z + radius * Math.cos(phi);

      // Expand outward
      const vx = pool.positions[i * 3] - x;
      const vy = pool.positions[i * 3 + 1] - y;
      const vz = pool.positions[i * 3 + 2] - z;

      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;

      pool.velocities[i * 3] = (vx / len) * 3;
      pool.velocities[i * 3 + 1] = (vy / len) * 3;
      pool.velocities[i * 3 + 2] = (vz / len) * 3;

      pool.colors[i * 3] = phaseColor.r;
      pool.colors[i * 3 + 1] = phaseColor.g;
      pool.colors[i * 3 + 2] = phaseColor.b;

      pool.lifetimes[i] = 1;
      pool.sizes[i] = 0.04;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }

  /** Emit collapse burst: dramatic implosion then outward burst. */
  emitCollapseBurst(x, y, z) {
    const count = 200;
    const now = performance.now() / 1000;

    for (let i = 0; i < this.maxParticles && i < count; i++) {
      if (pool.alive[i]) continue;

      // Phase 1: implosion (particles on a sphere move inward)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const radius = 3 + Math.random() * 2;

      pool.positions[i * 3] = x + radius * Math.sin(phi) * Math.cos(theta);
      pool.positions[i * 3 + 1] = y + radius * Math.sin(phi) * Math.sin(theta);
      pool.positions[i * 3 + 2] = z + radius * Math.cos(phi);

      // Velocity: toward center (implosion)
      const vx = (x - pool.positions[i * 3]) * 4;
      const vy = (y - pool.positions[i * 3 + 1]) * 4;
      const vz = (z - pool.positions[i * 3 + 2]) * 4;

      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;

      pool.velocities[i * 3] = (vx / len) * 6;
      pool.velocities[i * 3 + 1] = (vy / len) * 6;
      pool.velocities[i * 3 + 2] = (vz / len) * 6;

      // Dark purple/red colors for collapse
      pool.colors[i * 3] = 0.4 + Math.random() * 0.2;
      pool.colors[i * 3 + 1] = 0.05;
      pool.colors[i * 3 + 2] = 0.3 + Math.random() * 0.3;

      pool.lifetimes[i] = 2.0;
      pool.sizes[i] = 0.08 + Math.random() * 0.04;
      pool.alive[i] = 1;
      pool.timestamps[i] = now;
    }
  }

  emitDustTrail(x, y, z) {
    // Small trail of dust particles
    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || Math.random() > 0.1) continue;

      pool.positions[i * 3] = x + (Math.random() - 0.5) * 0.15;
      pool.positions[i * 3 + 1] = y;
      pool.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.15;

      pool.velocities[i * 3] = (Math.random() - 0.5) * 0.3;
      pool.velocities[i * 3 + 1] = 0.2;
      pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;

      pool.colors[i * 3] = 0.6;
      pool.colors[i * 3 + 1] = 0.5;
      pool.colors[i * 3 + 2] = 0.4;

      pool.lifetimes[i] = 1;
      pool.sizes[i] = 0.03;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }

  /** Emit erosion particles: crumbling block particles that drift downward. */
  emitErosionParticle(x, y, z, oldColor, newColor) {
    const count = 12;
    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || i >= count) continue;

      pool.positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      pool.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      pool.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;

      // Slow drift downward (erosion = crumbling to dust)
      pool.velocities[i * 3] = (Math.random() - 0.5) * 0.2;
      pool.velocities[i * 3 + 1] = -(Math.random() * 0.5 + 0.1);
      pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;

      // Blend between old and new color (decay gradient)
      const blend = Math.random();
      pool.colors[i * 3] = oldColor[0] / 255 * blend + newColor[0] / 255 * (1 - blend);
      pool.colors[i * 3 + 1] = oldColor[1] / 255 * blend + newColor[1] / 255 * (1 - blend);
      pool.colors[i * 3 + 2] = oldColor[2] / 255 * blend + newColor[2] / 255 * (1 - blend);

      pool.lifetimes[i] = 1.5;
      pool.sizes[i] = 0.04;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }

  emitAmbientParticles(playerX, playerY, playerZ) {
    // Subtle floating particles in the environment
    for (let i = 0; i < this.maxParticles; i++) {
      if (pool.alive[i] || Math.random() > 0.002) continue;

      const dx = (Math.random() - 0.5) * 20;
      const dy = Math.random() * 10 - 2;
      const dz = (Math.random() - 0.5) * 20;

      pool.positions[i * 3] = playerX + dx;
      pool.positions[i * 3 + 1] = playerY + dy;
      pool.positions[i * 3 + 2] = playerZ + dz;

      pool.velocities[i * 3] = (Math.random() - 0.5) * 0.1;
      pool.velocities[i * 3 + 1] = 0.05;
      pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;

      pool.colors[i * 3] = 0.7 + Math.random() * 0.3;
      pool.colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
      pool.colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;

      pool.lifetimes[i] = 1;
      pool.sizes[i] = 0.02;
      pool.alive[i] = 1;
      pool.timestamps[i] = performance.now() / 1000;
    }
  }
}
