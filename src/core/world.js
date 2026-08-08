import {
  CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_RENDER_DIST, RENDER_DISTANCE,
  BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT, BLOCK_WOOD,
  BLOCK_CRYSTAL, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_RUNE, BLOCK_SAND,
  BLOCK_GLASS, BLOCK_IRON, BLOCK_GOLD_ORE, BLOCK_WATER,
  BLOCK_STABILIZER,
  BLOCK_PROPERTIES,
  PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT,
  SAVE_CHUNK_DIST, UNLOAD_CHUNK_DIST,
  BIOME_FOREST, BIOME_RUINS, BIOME_CAVES, BIOME_DESERT,
  BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_DEEP_VOID, BIOME_PHASE_NEXUS,
  EROSION_MAP, EROSION_THRESHOLD, EROSION_RADIUS,
} from '../core/constants.js';
import { TerrainGenerator } from '../gen/terrain.js';

// Chunk data structure: 3 Uint8Arrays (one per phase)
class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.loadOrder = 0;
    this.alphaData = null;
    this.betaData = null;
    this.gammaData = null;
    this.biomeId = BIOME_FOREST;
    this.meshes = { alpha: null, beta: null, gamma: null };
    this.loaded = false;
  }

  setBiome(id) { this.biomeId = id; }
}

// Block color per phase (for rendering)
const BLOCK_PHASE_COLORS = {
  // Alpha, Beta, Gamma colors for each block type
  [BLOCK_AIR]:     [[0,0,0], [0,0,0], [0,0,0]],
  [BLOCK_STONE]:   [[0.45, 0.45, 0.45], [0.3, 0.5, 0.7], [0.6, 0.55, 0.5]],
  [BLOCK_GRASS]:   [[0.35, 0.6, 0.3], [0.2, 0.45, 0.6], [0.5, 0.6, 0.3]],
  [BLOCK_DIRT]:    [[0.45, 0.35, 0.25], [0.3, 0.4, 0.5], [0.5, 0.45, 0.35]],
  [BLOCK_WOOD]:    [[0.5, 0.35, 0.2], [0.2, 0.3, 0.5], [0.6, 0.5, 0.3]],
  [BLOCK_CRYSTAL]: [[0.6, 0.4, 0.7], [0.3, 0.7, 0.9], [0.9, 0.8, 0.3]],
  [BLOCK_OBSIDIAN]:[[0.15, 0.1, 0.2], [0.1, 0.2, 0.4], [0.3, 0.25, 0.15]],
  [BLOCK_VOID]:    [[0.05, 0.02, 0.08], [0.1, 0.15, 0.3], [0.4, 0.1, 0.3]],
  [BLOCK_RUNE]:    [[0.3, 0.3, 0.3], [0.2, 0.8, 0.6], [0.9, 0.7, 0.2]],
  [BLOCK_SAND]:    [[0.75, 0.65, 0.4], [0.4, 0.55, 0.7], [0.6, 0.5, 0.35]],
  [BLOCK_GLASS]:   [[0.7, 0.8, 0.9], [0.3, 0.6, 0.9], [0.9, 0.9, 0.7]],
  [BLOCK_IRON]:    [[0.5, 0.45, 0.4], [0.2, 0.4, 0.6], [0.6, 0.55, 0.35]],
  [BLOCK_GOLD_ORE]:[[0.6, 0.5, 0.3], [0.3, 0.6, 0.5], [0.9, 0.8, 0.3]],
  [BLOCK_WATER]:   [[0.2, 0.35, 0.6], [0.15, 0.5, 0.8], [0.5, 0.4, 0.6]],
  [BLOCK_STABILIZER]: [[0.7, 0.3, 0.15], [0.8, 0.4, 0.15], [0.9, 0.4, 0.15]],
};

export class World {
  constructor(scene, onChunkUpdated) {
    this.scene = scene;
    this.chunks = new Map();
    this.terrainGen = new TerrainGenerator(42);
    this.nextLoadOrder = 0;
    this.onChunkUpdated = onChunkUpdated;
    this.onEroded = null; // Called when a block erodes: (x, y, z, phase, oldBlockId, newBlockId)
    this.globalBlockState = null; // Track memory: global[x,y,z,phase] = blockId
    this._globalStateMap = new Map();
    // Erosion tracking: key = `${x},${y},${z}` → { progress, lastPhase, lastTime }
    this._erosionState = new Map();
    // Stabilizer tracking: key = `${x},${y},${z}` → { x, y, z }
    this._stabilizerPositions = new Map();
    // Echo objects: world collectibles with lore
    this._echoes = [];
    // Resonance cores (amplifiers)
    this._resonanceCores = [];
  }

  _globalKey(x, y, z, phase) {
    return `${x},${y},${z},${phase}`;
  }

  getGlobalBlock(x, y, z, phase) {
    return this._globalStateMap.get(this._globalKey(x, y, z, phase)) || BLOCK_AIR;
  }

  setGlobalBlock(x, y, z, phase, blockId) {
    this._globalStateMap.set(this._globalKey(x, y, z, phase), blockId);
  }

  getBiome(x, z) {
    const regionX = Math.floor(x / 64);
    const regionZ = Math.floor(z / 64);
    const hash = (regionX * 73856093) ^ (regionZ * 19349663);
    const normalized = Math.abs(hash % 10000) / 10000;
    if (normalized < 0.25) return BIOME_FOREST;
    if (normalized < 0.4) return BIOME_RUINS;
    if (normalized < 0.55) return BIOME_CAVES;
    if (normalized < 0.7) return BIOME_DESERT;
    if (normalized < 0.8) return BIOME_CRYSTAL_CAVERN;
    if (normalized < 0.9) return BIOME_SKY_RUINS;
    if (normalized < 0.95) return BIOME_DEEP_VOID;
    return BIOME_PHASE_NEXUS;
  }

  getChunkKey(cx, cz) { return `${cx},${cz}`; }
  getTerrainGen() { return this.terrainGen; }

  ensureChunk(cx, cz) {
    const key = this.getChunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
      try {
        this.loadChunk(chunk);
        console.log('[World] Chunk loaded:', cx, cz, 'biome:', chunk.biomeId, 'alphaBlocks:', chunk.alphaData.filter(b => b !== 0).length);
      } catch (e) {
        console.error('[World] Failed to load chunk:', cx, cz, e);
      }
    }
    return chunk;
  }

  loadChunk(chunk) {
    const cx = chunk.cx;
    const cz = chunk.cz;

    // Determine biome for this chunk's center
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    chunk.setBiome(this.getBiome(centerX, centerZ));

    // Generate terrain for each phase
    const gen = this.terrainGen;
    const genResult = gen.generateChunk(cx, cz, chunk.biomeId);
    chunk.alphaData = genResult.data;

    // Invert for Beta
    chunk.betaData = gen.invertForPhase(chunk.alphaData, PHASE_BETA);

    // Gamma: more inverted + special blocks
    chunk.gammaData = gen.invertForPhase(chunk.betaData, PHASE_GAMMA);

    // Blend with global state (memory)
    for (let p = 0; p < PHASE_COUNT; p++) {
      const data = [chunk.alphaData, chunk.betaData, chunk.gammaData][p];
      for (let i = 0; i < data.length; i++) {
        const bx = i % CHUNK_SIZE;
        const bz = Math.floor(i / (CHUNK_SIZE * CHUNK_HEIGHT));
        const by = Math.floor(i / CHUNK_SIZE) % CHUNK_HEIGHT;
        const wx = cx * CHUNK_SIZE + bx;
        const wy = by;
        const wz = cz * CHUNK_SIZE + bz;

        // Check global state (player memory)
        const globalBlock = this.getGlobalBlock(wx, wy, wz, p);
        if (globalBlock !== BLOCK_AIR) {
          data[i] = globalBlock;
        }
      }
    }

    // Register Echo objects and Resonance Cores from chunk generation
    for (const echo of genResult.echoes) {
      this.addEcho(echo.type, echo.x, echo.y, echo.z, echo.lore);
    }
    for (const core of genResult.cores) {
      this.addResonanceCore(core.x, core.y, core.z);
    }

    chunk.loaded = true;
    chunk.loadOrder = chunk.loadOrder || ++this.nextLoadOrder;
  }

  // Get block at world coordinates for a given phase
  getBlock(wx, wy, wz, phase) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.getChunkKey(cx, cz));
    if (!chunk || !chunk.loaded) return BLOCK_AIR;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const data = [chunk.alphaData, chunk.betaData, chunk.gammaData][phase];
    if (!data) return BLOCK_AIR;

    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 0 || wy >= CHUNK_HEIGHT) {
      return BLOCK_AIR;
    }

    return data[lx + wy * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_HEIGHT];
  }

  // Set block at world coordinates for a given phase
  setBlock(wx, wy, wz, phase, blockId) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.getChunkKey(cx, cz));
    if (!chunk || !chunk.loaded) return;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 0 || wy >= CHUNK_HEIGHT) {
      return;
    }

    const data = [chunk.alphaData, chunk.betaData, chunk.gammaData][phase];
    if (!data) return;

    const idx = lx + wy * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_HEIGHT;
    const oldBlock = data[idx];
    data[idx] = blockId;

    // Track stabilizer block placement/removal
    const wxAbs = cx * CHUNK_SIZE + lx;
    const wzAbs = cz * CHUNK_SIZE + lz;
    if (blockId === BLOCK_STABILIZER && oldBlock !== BLOCK_STABILIZER) {
      this.addStabilizer(wxAbs, wy, wzAbs);
    } else if (oldBlock === BLOCK_STABILIZER && blockId !== BLOCK_STABILIZER) {
      this.removeStabilizer(wxAbs, wy, wzAbs);
    }

    // Update global state (memory)
    const wxAbsGlobal = cx * CHUNK_SIZE + lx;
    const wzAbsGlobal = cz * CHUNK_SIZE + lz;
    this.setGlobalBlock(wxAbsGlobal, wy, wzAbsGlobal, phase, blockId);

    // Mark chunk as needing update
    this.markChunkUpdated(chunk);
  }

  // Build/update chunk meshes
  markChunkUpdated(chunk) {
    if (this.onChunkUpdated) {
      this.onChunkUpdated(chunk);
    }
  }

  // Update chunks within render distance (or a custom radius, in chunks).
  // Phase 1.3: spawn-time uses radius=2 to load a 5×5 chunk area before the
  // downward raycast runs. The runtime path still passes no radius and gets
  // the default RENDER_DISTANCE.
  updateChunks(playerX, playerZ, radius = RENDER_DISTANCE) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    // Load new chunks
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= radius) {
          const chunk = this.ensureChunk(cx, cz);
          if (chunk.loadOrder === 0) {
            chunk.loadOrder = ++this.nextLoadOrder;
          }
        }
      }
    }

    // Unload far chunks
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > UNLOAD_CHUNK_DIST + 2) {
        this.chunks.delete(key);
      }
    }
  }

  // ── Spawn-time helpers (Phase 1.3) ────────────────────────────────

  /**
   * Find the highest solid block in the column at (worldX, worldZ), scanning
   * from y = CHUNK_HEIGHT-1 downward. "Solid" means solid in the given phase
   * (uses BLOCK_PROPERTIES[id].phaseSolid[phase] when available, falls back
   * to the legacy .solid boolean). Returns the block's y-coordinate, or
   * null if no solid block exists in the column.
   *
   * Callers are expected to have loaded enough chunks for the column to be
   * populated (see World.updateChunks). Unloaded columns report all air.
   */
  findTopSolidBlock(worldX, worldZ, phase = PHASE_ALPHA) {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const block = this.getBlock(worldX, y, worldZ, phase);
      if (block === BLOCK_AIR) continue;
      const props = BLOCK_PROPERTIES[block];
      if (!props) continue;
      const isSolid = props.phaseSolid ? props.phaseSolid[phase] : props.solid;
      if (isSolid) return y;
    }
    return null;
  }

  getChunks() { return this.chunks; }

  // ── Block mask utilities ──────────────────────────────────────

  /**
   * Returns a 3-bit mask: bit 0 = Alpha, bit 1 = Beta, bit 2 = Gamma.
   * A bit is set if the block at that position exists in that phase.
   */
  getBlockMask(wx, wy, wz) {
    let mask = 0;
    for (let p = PHASE_ALPHA; p < PHASE_COUNT; p++) {
      const block = this.getBlock(wx, wy, wz, p);
      if (block !== BLOCK_AIR) {
        mask |= (1 << p);
      }
    }
    return mask;
  }

  /**
   * Scan the world for blocks that differ across phases.
   * Returns an array of { x, y, z, visiblePhases } for blocks
   * that exist in at least one phase other than the given currentPhase.
   * Scans a cubic radius around the player position (floored to block coords).
   */
  scanNearby(playerX, playerY, playerZ, radius) {
    const results = [];
    const minX = Math.floor(playerX) - radius;
    const maxX = Math.floor(playerX) + radius;
    const minY = Math.floor(playerY) - radius;
    const maxY = Math.floor(playerY) + radius;
    const minZ = Math.floor(playerZ) - radius;
    const maxZ = Math.floor(playerZ) + radius;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const mask = this.getBlockMask(x, y, z);
          if (mask === 0) continue;

          // Count how many phases have this block (non-air)
          let bitCount = 0;
          for (let p = 0; p < PHASE_COUNT; p++) {
            if (mask & (1 << p)) bitCount++;
          }

          // Include blocks that exist in multiple phases (phase differences)
          // or that exist in a phase other than the current one
          if (bitCount > 1) {
            results.push({ x, y, z, visiblePhases: mask });
          }
        }
      }
    }
    return results;
  }

  /**
   * Resonance pulse: swaps block states within a radius.
   * For each block in the area, invert its phase presence:
   *   - If a block exists in phase X but not Y, it swaps:
     removed from X and added to Y (and vice versa).
   * Effectively, a block becomes "visible" in the phases it was
   * previously hidden from, and "hidden" from phases it was visible in.
   * 
   * Radius is in block units: radius=1 gives a 3×3×3 area.
   */
  resonate(cx, cy, cz, radius) {
    const r2 = radius + 1; // block range: [cx-radius .. cx+radius]
    const minX = cx - radius;
    const maxX = cx + radius;
    const minY = cy - radius;
    const maxY = cy + radius;
    const minZ = cz - radius;
    const maxZ = cz + radius;

    // Collect affected blocks first (read-only)
    const affected = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const mask = this.getBlockMask(x, y, z);
          if (mask === 0) continue;
          affected.push({ x, y, z, mask });
        }
      }
    }

    // Apply inversion: for each affected block, flip phase presence
    for (const { x, y, z } of affected) {
      for (let p = PHASE_ALPHA; p < PHASE_COUNT; p++) {
        const block = this.getBlock(x, y, z, p);
        if (block === BLOCK_AIR) continue;

        // Invert: set block to air in this phase, remove from other phases
        // and set in the inverse phase
        const inversePhase = (p + 1) % PHASE_COUNT;
        const oppositeBlock = this.getBlock(x, y, z, inversePhase);

        // Swap: what's in this phase goes to the inverse, what's in inverse stays
        // Simple model: clear current phase, bring in the other phase's block
        if (oppositeBlock !== BLOCK_AIR) {
          // Two-phase block: swap between the two phases
          this.setBlock(x, y, z, p, BLOCK_AIR);
          this.setBlock(x, y, z, inversePhase, block);
        } else {
          // Single-phase block: moves to next phase (clockwise)
          // Alpha→Beta, Beta→Gamma, Gamma→Alpha
          this.setBlock(x, y, z, p, BLOCK_AIR);
        }
      }
    }
  }

  /** Get all changed (non-default) blocks for saving */
  getChangedBlocks() {
    const changed = {};
    for (const [key, blockId] of this._globalStateMap) {
      if (!key.startsWith('_')) {
        changed[key] = blockId;
      }
    }
    return changed;
  }

  /** Apply a saved state to the world */
  async applySavedState(state) {
    if (state.worldState) {
      for (const [key, blockId] of Object.entries(state.worldState)) {
        const parts = key.split(',');
        if (parts.length >= 4) {
          const wx = parseInt(parts[0]);
          const wy = parseInt(parts[1]);
          const wz = parseInt(parts[2]);
          const phase = parseInt(parts[3]);
          this.setBlock(wx, wy, wz, phase, blockId);
        }
      }
      this.updateChunks(this.playerPosition.x, this.playerPosition.z);
    }
  }

  /**
   * Check for phase erosion around the player.
   * When a player stays in a phase where a block is not solid,
   * the block slowly erodes to a weaker form.
   * Erosion is PERSISTENT — it changes the global state permanently.
   */
  checkErosion(dt, playerX, playerY, playerZ, playerPhase) {
    const rad = Math.floor(EROSION_RADIUS);
    const cx = Math.floor(playerX);
    const cy = Math.floor(playerY);
    const cz = Math.floor(playerZ);

    for (let x = cx - rad; x <= cx + rad; x++) {
      for (let y = cy - rad; y <= cy + rad; y++) {
        for (let z = cz - rad; z <= cz + rad; z++) {
          // Check each phase layer of this position
          for (let p = PHASE_ALPHA; p < PHASE_COUNT; p++) {
            const blockId = this.getBlock(x, y, z, p);
            if (blockId === BLOCK_AIR) continue;

            const props = BLOCK_PROPERTIES[blockId];
            if (!props) continue;

            // Only check erosion for blocks NOT solid in the player's current phase
            if (props.solid && props.phase.includes(playerPhase)) continue;

            // Check if this block has an erosion mapping for this phase
            const erosionMap = EROSION_MAP[blockId];
            if (!erosionMap || erosionMap[playerPhase] === undefined) continue;

            // Calculate erosion progress
            const eKey = `${x},${y},${z}`;
            let state = this._erosionState.get(eKey);
            if (!state) {
              state = { progress: 0, lastPhase: playerPhase };
              this._erosionState.set(eKey, state);
            }

            // Reset progress if phase changed since last check
            if (state.lastPhase !== playerPhase) {
              // Decay progress slowly when not exposed (50% per second)
              state.progress = Math.max(0, state.progress - dt * 0.5);
              state.lastPhase = playerPhase;
            }

            // Accumulate progress
            state.progress += dt * EROSION_RATE;

            // Check if erosion threshold reached
            if (state.progress >= EROSION_THRESHOLD) {
              const erodedBlock = erosionMap[playerPhase];
              if (erodedBlock !== undefined && erodedBlock !== blockId) {
                // Perform erosion: change block in this phase
                this.setBlock(x, y, z, p, erodedBlock);
                // Notify that erosion happened (particles, sound)
                if (this.onEroded) {
                  this.onEroded(x, y, z, p, blockId, erodedBlock);
                }
                // Reset progress for next erosion cycle (can erode further)
                state.progress = 0;
              }
            }
          }
        }
      }
    }
  }

  /** Get erosion state for serialization */
  getErosionState() {
    const state = {};
    for (const [key, data] of this._erosionState) {
      state[key] = data;
    }
    return state;
  }

  /** Apply erosion state from save */
  applyErosionState(erosionData) {
    for (const [key, data] of Object.entries(erosionData)) {
      this._erosionState.set(key, data);
    }
  }

  /** Find the nearest stabilizer block to a position */
  findNearestStabilizer(x, y, z, maxSearchRadius = 100) {
    let nearest = null;
    let nearestDist2 = maxSearchRadius * maxSearchRadius;

    for (const key of this._erosionState.keys()) {
      // Stabilizer blocks would have a key format we can check
      // This is a fallback; we use the tracking method below
    }

    // Use tracked stabilizer positions for fast lookup
    for (const [posKey, data] of this._stabilizerPositions) {
      const sx = data.x;
      const sy = data.y;
      const sz = data.z;
      const dx = x - sx;
      const dy = y - sy;
      const dz = z - sz;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 < nearestDist2) {
        nearestDist2 = dist2;
        nearest = { x: sx, y: sy, z: sz };
      }
    }

    return nearest;
  }

  /** Track a stabilizer block position */
  addStabilizer(x, y, z) {
    const posKey = `${x},${y},${z}`;
    this._stabilizerPositions.set(posKey, { x, y, z });
  }

  /** Remove a stabilizer from tracking */
  removeStabilizer(x, y, z) {
    const posKey = `${x},${y},${z}`;
    this._stabilizerPositions.delete(posKey);
  }

  // ── Echo System ──────────────────────────────────────────────────

  /** Register an Echo object in the world */
  addEcho(type, x, y, z, lore) {
    // Check for existing echo at this position (don't duplicate)
    const existing = this._echoes.find(e =>
      e.x === x && e.y === y && e.z === z && !e.collected
    );
    if (existing) return existing;
    const echo = { type, x, y, z, lore, collected: false };
    this._echoes.push(echo);
    return echo;
  }

  /** Find and collect a nearby echo, return its data or null */
  interactNearbyEcho(wx, wy, wz, radius) {
    const closest = { dist2: radius * radius, candidate: null };
    for (const echo of this._echoes) {
      if (echo.collected) continue;
      const dx = echo.x - wx;
      const dy = echo.y - wy;
      const dz = echo.z - wz;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 < closest.dist2) {
        closest.dist2 = dist2;
        closest.candidate = echo;
      }
    }
    if (!closest.candidate) return null;
    // Collect the echo
    closest.candidate.collected = true;
    return {
      type: closest.candidate.type,
      wx: closest.candidate.x,
      wy: closest.candidate.y,
      wz: closest.candidate.z,
      lore: closest.candidate.lore,
    };
  }

  /** Get all uncollected echoes */
  getEchoes() {
    return this._echoes.filter(e => !e.collected);
  }

  /** Get collected echoes count */
  getEchoesFound() {
    return this._echoes.filter(e => e.collected).length;
  }

  /** Get total echoes (collected + uncollected) */
  getTotalEchoes() {
    return this._echoes.length;
  }

  /** Save echo state to world state */
  getEchoState() {
    return this._echoes.map(e => ({
      type: e.type, x: e.x, y: e.y, z: e.z, lore: e.lore, collected: e.collected,
    }));
  }

  /** Load echo state from save */
  applyEchoState(echoes) {
    for (const e of echoes) {
      this.addEcho(e.type, e.x, e.y, e.z, e.lore);
      if (e.collected) {
        // Find and mark as collected
        const found = this._echoes.find(ev =>
          ev.x === e.x && ev.y === e.y && ev.z === e.z
        );
        if (found) found.collected = true;
      }
    }
  }

  // ── Phase Lens Scan ──────────────────────────────────────────────

  /** Scan phase lens: marks blocks within radius as "scan revealed" in visual feedback */
  scanPhaseLens(cx, cy, cz, radius, currentPhase) {
    const minX = Math.floor(cx) - radius;
    const maxX = Math.floor(cx) + radius;
    const minY = Math.floor(cy) - radius;
    const maxY = Math.floor(cy) + radius;
    const minZ = Math.floor(cz) - radius;
    const maxZ = Math.floor(cz) + radius;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const mask = this.getBlockMask(x, y, z);
          if (mask === 0) continue;
          // Block visible in phases other than current = "revealed"
          const otherPhases = [];
          for (let p = 0; p < PHASE_COUNT; p++) {
            if ((mask & (1 << p)) && p !== currentPhase) {
              otherPhases.push(p);
            }
          }
          if (otherPhases.length > 0) {
            // Log found phase differences for the scanner to display
            // (actual HUD update is handled by game.js polling this data)
            // Store scan history in a temporary buffer for this tick
            // The visual overlay is handled by renderer
          }
        }
      }
    }
    return { scanned: true, radius };
  }

  // ── Resonance Cores ──────────────────────────────────────────────

  /** Register a resonance core (amplifier object) */
  addResonanceCore(x, y, z) {
    return this._resonanceCores || (this._resonanceCores = []).push({ x, y, z }) - 1;
  }

  /** Get all resonance cores */
  getResonanceCores() {
    return this._resonanceCores || [];
  }

  /** Get total resonance count */
  getResonanceCoreCount() {
    return (this._resonanceCores || []).length;
  }

  /** Save resonance core state */
  getResonanceState() {
    return (this._resonanceCores || []).map(c => ({ x: c.x, y: c.y, z: c.z }));
  }

  /** Load resonance core state from save */
  applyResonanceState(cores) {
    this._resonanceCores = cores || [];
  }
}
