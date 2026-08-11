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
import {
  anchorKey, tickAnchors as _tickAnchorsPure, cellUnderPlayer as _cellUnderPlayerPure,
  ANCHOR_LIFETIME,
} from '../anchor/anchor.js';
import {
  fuseKey, resolveFuseOverride, applyFuseOverride, removeFuseOverride,
  listFuseOverrides, serializeFuseOverrides, deserializeFuseOverrides,
  fuseOverrideCount,
} from '../fuse/fuse.js';
import {
  pickPhaseDominance, pickDominantPhase, dominanceWeights,
  DEFAULT_PHASE_DOMINANCE_SEED,
} from '../newgameplus/newgameplus.js';
import { getEchoVisibility, wrongPhaseEchoForBiome } from '../collect/echo.js';

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
  constructor(scene, onChunkUpdated, seed, phaseDominanceSeed) {
    this.scene = scene;
    this.chunks = new Map();
    // Phase 10.14: accept a seed + phase-dominance seed for
    // the New Game+ shuffle. The terrain generator gets both.
    // Defaults preserve the §1.3 1.0-ship behavior.
    const _seed = Number.isFinite(seed) ? Math.floor(seed) : 42;
    this.seed = _seed;
    this.terrainGen = new TerrainGenerator(_seed, phaseDominanceSeed);
    // Mirror on the world so save/load + the renderer overlay
    // can read the phase-dominance seed without going through
    // the terrain generator.
    this.phaseDominanceSeed = Number.isFinite(phaseDominanceSeed)
      ? Math.floor(phaseDominanceSeed)
      : 0;
    this.nextLoadOrder = 0;
    this.onChunkUpdated = onChunkUpdated;
    this.onEroded = null; // Called when a block erodes: (x, y, z, phase, oldBlockId, newBlockId)
    this.globalBlockState = null; // Track memory: global[x,y,z,phase] = blockId
    this._globalStateMap = new Map();
    // Phase 10.14: re-apply the phase-dominance seed at
    // runtime. Used by the "Start New Game+" button — the
    // game keeps the same World instance, just swaps the
    // terrain generator so subsequent chunk loads use the
    // new permutation. Chunks already in memory keep their
    // pre-shuffle data (the player will see the shuffle on
    // the next chunk load / chunk reload).
    this.phaseDominancePermutation = null; // updated by getPhaseDominancePermutation()
    // Erosion tracking: key = `${x},${y},${z}` → { progress, lastPhase, lastTime }
    this._erosionState = new Map();
    // Stabilizer tracking: key = `${x},${y},${z}` → { x, y, z }
    this._stabilizerPositions = new Map();
    // Echo objects: world collectibles with lore. Phase 10.11 also
    // tracks a `_hiddenEchoes` map (key -> { hiddenPhase, lore })
    // for the wrong-phase Echoes.
    this._echoes = [];
    // Phase 10.11: wrong-phase Echoes map (key -> { hiddenPhase,
    // lore, biomeId }). Mirrors the standard `_echoes` array so
    // save/load can round-trip the hidden-phase tag.
    this._hiddenEchoes = new Map();
    // Resonance cores (amplifiers)
    this._resonanceCores = [];
    // Phase 2.7: Phase Anchor (Shift+LMB) — the player-placed lock
    // that holds them on a block through a phase shift. Keyed by
    // the canonical `${x},${y},${z},${phase}` string (the same
    // convention as World._globalKey + the anchor helper). Each
    // entry stores the cell + the phase + the remaining seconds
    // (decremented by tickAnchors). The orphan PhaseLockManager used
    // Date.now() for the expiry check; the new API uses a per-frame
    // dt accumulator so the lifetime is sandbox-safe.
    this._anchors = new Map();
    // Phase 10.2: Phase Fuse (F-key, 3s hold, 30 energy) — the
    // player-driven permanent phase swap. The Memory World pillar.
    // Keyed by the canonical `${x},${y},${z}` string (no phase:
    // a fuse is a one-shot edit, not a per-phase lock). Each
    // entry stores the cell + the override phase + the fusedAt
    // timestamp (for the renderer + UI). The fuse overrides
    // win over the per-block phaseSolid mask at isBlockSolid
    // lookup time.
    this._fuseOverrides = new Map();
    // Phase 10.5: Convergence finale state. The Nexus starts
    // sealed; opening it requires all of Act 3 + the Nexus visited.
    // The chamber geometry (5x5x5 cleared stone + wooden floor +
    // glowing ceiling + the final Echo) is revealed when the
    // player has all the prerequisites + the nexusOpen flag is set.
    this._nexusOpen = false;
    this._convergenceComplete = false;
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

  /**
   * Snapshot the player block memory so the save system can persist it.
   * Keys are the canonical `${x},${y},${z},${phase}` string and values are
   * the block id. Phase 2.4: BLOCK_AIR entries ARE included — a player
   * break is a real edit and must survive a save/reload round-trip. The
   * map only contains entries the player has touched, so untouched
   * generator cells are not in the snapshot and the save does not bloat.
   */
  exportGlobalState() {
    const out = {};
    for (const [key, blockId] of this._globalStateMap) {
      out[key] = blockId; // Preserve BLOCK_AIR too: a player break is a real edit.
    }
    return out;
  }

  /**
   * Replace the player block memory from a previously exported snapshot.
   * Used by SaveSystem to re-apply player edits on load. Phase 2.4:
   * BLOCK_AIR entries ARE accepted — a player break is a real edit and
   * the snapshot is the canonical truth on reload. Garbage in the save
   * blob (NaN, fractional, strings) is still rejected via Number.isFinite.
   */
  importGlobalState(snapshot) {
    this._globalStateMap.clear();
    if (!snapshot || typeof snapshot !== 'object') return 0;
    let count = 0;
    for (const [key, blockId] of Object.entries(snapshot)) {
      if (typeof blockId === 'number' && Number.isFinite(blockId)) {
        this._globalStateMap.set(key, blockId);
        count++;
      }
    }
    return count;
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

  /** Return the loaded chunk containing the given absolute world coordinates. */
  getChunk(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    return this.chunks.get(this.getChunkKey(cx, cz));
  }

  getTerrainGen() { return this.terrainGen; }

  // ── Index helpers (Phase 1.4) ─────────────────────────────────────

  /** Linear index for local voxel coordinates within a chunk. */
  index(x, y, z) {
    return x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT;
  }

  /** Semantic alias for call sites indexing chunk-local voxel data. */
  localIndex(x, y, z) {
    return this.index(x, y, z);
  }

  /** Convert a linear chunk-data index back to local voxel coordinates. */
  unpackIndex(i) {
    const x = i % CHUNK_SIZE;
    const z = Math.floor(i / (CHUNK_SIZE * CHUNK_HEIGHT));
    const y = Math.floor(i / CHUNK_SIZE) % CHUNK_HEIGHT;
    return { x, y, z };
  }

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

    // Blend with global state (memory). Phase 2.3 + 2.4: a player break
    // writes BLOCK_AIR to _globalStateMap, and we MUST re-apply it on
    // reload — otherwise the generator's value would resurrect the block
    // (§2.4 acceptance: "break a block, walk far enough to unload the
    // chunk, walk back — the block is still broken"). The presence of
    // the key in the map is the canonical "player has touched this cell"
    // signal; the stored value (AIR or non-air) is what wins on reload.
    for (let p = 0; p < PHASE_COUNT; p++) {
      const data = [chunk.alphaData, chunk.betaData, chunk.gammaData][p];
      for (let i = 0; i < data.length; i++) {
        const { x: bx, y: by, z: bz } = this.unpackIndex(i);
        const wx = cx * CHUNK_SIZE + bx;
        const wy = by;
        const wz = cz * CHUNK_SIZE + bz;

        // Check global state (player memory). The key existence is the
        // signal; the value (including BLOCK_AIR) wins on reload.
        const globalKey = this._globalKey(wx, wy, wz, p);
        if (this._globalStateMap.has(globalKey)) {
          data[i] = this._globalStateMap.get(globalKey);
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

    return data[this.localIndex(lx, wy, lz)];
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

    const idx = this.localIndex(lx, wy, lz);
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

  // ── Phase-relative solidity (Phase 2.2) ───────────────────────────────

  /**
   * Phase-relative "is this block solid here, now" check. Reads
   * BLOCK_PROPERTIES[id].phaseSolid[phase] when the array is defined and
   * falls back to the legacy .solid boolean for any block that doesn't
   * declare a per-phase array (BLOCK_AIR is identical either way; this
   * keeps Phase 1.5's BLOCK_AIR/BLOCK_GLASS/etc. behavior intact).
   *
   * The "phase" is the player's current phase — even while _isShifting is
   * true, we use the from-phase so a mid-air shift never changes collision
   * mid-flight. Air is always non-solid.
   */
  isBlockSolid(x, y, z, phase = PHASE_ALPHA) {
    const block = this.getBlock(x, y, z, phase);
    // Phase 3.5: locked cells are always solid in their locked phase
    // (even if the block would be transparent in that phase normally).
    // This is the §3.5 contract: the lock makes a block "stick" in the
    // new phase for LOCK_DURATION seconds.
    if (Array.isArray(this._phaseLocks) && this._phaseLocks.length > 0) {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), ip = Math.floor(phase);
      for (const l of this._phaseLocks) {
        if (l.x === ix && l.y === iy && l.z === iz && l.phase === ip) {
          const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
          if (l.expires > now) return true;
        }
      }
    }
    // Phase 10.2: Phase Fuse overrides win. The Memory World pillar —
    // a player-fused cell is solid in the fused phase regardless of
    // the block's default phaseSolid mask. The override is keyed by
    // cell (no phase), so the cell is solid in the fused phase and
    // non-solid in the other two phases.
    if (this._fuseOverrides && this._fuseOverrides.size > 0) {
      const override = resolveFuseOverride(this._fuseOverrides, x, y, z, phase);
      if (override === true) return true;
      if (override === false) return false;
     // override === null: no fuse at this cell, fall through to default.
    }
    if (block === BLOCK_AIR) return false;
    const props = BLOCK_PROPERTIES[block];
    if (!props) return false;
    if (props.phaseSolid) return !!props.phaseSolid[phase];
    return !!props.solid;
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
      if (this.isBlockSolid(worldX, y, worldZ, phase)) return y;
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
   * Phase 2.5: scan for blocks that DIFFER from the player's current phase.
   * Returns an array of { x, y, z, currentPhaseBlock, otherPhases, mask }
   * for every cell within the cubic radius that is non-air in at least one
   * OTHER phase (regardless of whether the cell is also non-air in the
   * current phase). This is the radius the Phase Lens overlay needs: a
   * Crystal block that's only visible in Beta should still be highlighted
   * when the player is standing in Alpha, even though the cell is air
   * in Alpha. The returned `currentPhaseBlock` is the block id in the
   * caller's current phase (BLOCK_AIR if the cell is air there).
   *
   * This is distinct from `scanNearby` (which only returns multi-phase
   * blocks for the §3.0 minimap use case). `findPhaseDifferences` is
   * the strictly broader version — it includes single-phase non-current
   * blocks too. Don't break `scanNearby`; the minimap still uses it.
   */
  findPhaseDifferences(playerX, playerY, playerZ, radius, currentPhase) {
    const results = [];
    if (currentPhase < PHASE_ALPHA || currentPhase >= PHASE_COUNT) return results;
    const minX = Math.floor(playerX) - radius;
    const maxX = Math.floor(playerX) + radius;
    const minY = Math.floor(playerY) - radius;
    const maxY = Math.floor(playerY) + radius;
    const minZ = Math.floor(playerZ) - radius;
    const maxZ = Math.floor(playerZ) + radius;

    const otherPhaseMask = ((1 << PHASE_COUNT) - 1) & ~(1 << currentPhase);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const mask = this.getBlockMask(x, y, z);
          if (mask === 0) continue;

          // The cell must differ from the current phase — i.e. at least
          // one OTHER phase has a non-air block here. Single-phase
          // non-current blocks (Crystal in Beta, player in Alpha) are
          // included; multi-phase blocks are included too.
          const crossPhaseMask = mask & otherPhaseMask;
          if (crossPhaseMask === 0) continue;

          const currentPhaseBlock = this.getBlock(x, y, z, currentPhase);
          const otherPhases = [];
          for (let p = 0; p < PHASE_COUNT; p++) {
            if (p !== currentPhase && (mask & (1 << p))) otherPhases.push(p);
          }

          results.push({
            x, y, z,
            currentPhaseBlock,
            otherPhases,
            mask,
          });
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

  /**
   * Phase 2.6: Resonance pulse with swap report. Same inversion logic
   * as `resonate(cx, cy, cz, radius)`, but returns a per-cell report
   * so the renderer + notification can show the swap count without
   * reading chunk data directly. The legacy `resonate(...)` stays
   * for back-compat (and as the write engine behind this method).
   *
   * Returns
   *   `{ results: Array<{ x, y, z, swappedPhases: number[] }>, count: number }`
   * where `swappedPhases` is the list of phase indexes whose block
   * identity at that cell changed during the resonance. The total
   * `count` is the sum of every swappedPhases array length.
   *
   * `currentPhase` is the player's current phase (the pass-through
   * helpers in src/resonance/resonate.js use it to scope the
   * report). When the cell is multi-phase, every non-air phase but
   * the current one is recorded as a swap.
   */
  resonateWithReport(cx, cy, cz, radius, currentPhase) {
    const r = Math.max(0, Math.floor(Number.isFinite(radius) ? radius : 0));
    const phase = Number.isFinite(currentPhase) ? Math.floor(currentPhase) : PHASE_ALPHA;
    const otherPhaseMask = ((1 << PHASE_COUNT) - 1) & ~(1 << phase);

    const minX = cx - r;
    const maxX = cx + r;
    const minY = cy - r;
    const maxY = cy + r;
    const minZ = cz - r;
    const maxZ = cz + r;

    // Collect cells that have at least one non-air phase other than
    // the current phase (the "eligible to swap" cells). The current
    // phase's block is NOT touched — the legacy `resonate` only
    // touches the player's current phase and the inverse phase.
    const eligible = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const mask = this.getBlockMask(x, y, z);
          if (mask === 0) continue;
          const crossPhase = mask & otherPhaseMask;
          if (crossPhase === 0) continue; // nothing to swap
          const swapped = [];
          for (let p = 0; p < PHASE_COUNT; p++) {
            if (p !== phase && (mask & (1 << p))) swapped.push(p);
          }
          if (swapped.length > 0) {
            eligible.push({ x, y, z, swappedPhases: swapped });
          }
        }
      }
    }

    // Now apply the actual swap (the same write path as `resonate`).
    // We do this AFTER the report so the report reflects the pre-
    // swap state (the swapped phases are the ones that were non-air
    // before the press).
    const cell = { x: 0, y: 0, z: 0 };
    for (const r of eligible) {
      cell.x = r.x; cell.y = r.y; cell.z = r.z;
      for (let p = PHASE_ALPHA; p < PHASE_COUNT; p++) {
        const block = this.getBlock(cell.x, cell.y, cell.z, p);
        if (block === BLOCK_AIR) continue;
        const inversePhase = (p + 1) % PHASE_COUNT;
        const oppositeBlock = this.getBlock(cell.x, cell.y, cell.z, inversePhase);
        if (oppositeBlock !== BLOCK_AIR) {
          this.setBlock(cell.x, cell.y, cell.z, p, BLOCK_AIR);
          this.setBlock(cell.x, cell.y, cell.z, inversePhase, block);
        } else {
          this.setBlock(cell.x, cell.y, cell.z, p, BLOCK_AIR);
        }
      }
    }

    const count = eligible.reduce((sum, r) => sum + r.swappedPhases.length, 0);
    return { results: eligible, count };
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
    // Defensive: back-compat with pre-§10.8 saves (the `erosion`
    // key is missing, so the call site passes null/undefined).
    // We no-op rather than throw so the load path stays safe.
    if (!erosionData || typeof erosionData !== 'object' || Array.isArray(erosionData)) return;
    for (const [key, data] of Object.entries(erosionData)) {
      // Defensive per-entry validation: only accept objects with
      // finite numeric progress + integer phase in [0, 2]. Anything
      // else is treated as tampered-blob garbage and skipped.
      if (!data || typeof data !== 'object') continue;
      const progress = data.progress;
      const lastPhase = data.lastPhase;
      if (typeof progress !== 'number' || !Number.isFinite(progress)) continue;
      if (!Number.isInteger(lastPhase) || lastPhase < 0 || lastPhase > 2) continue;
      this._erosionState.set(key, { progress: Math.max(0, progress), lastPhase });
    }
  }

  // ── Phase 10.14: New Game+ helpers ─────────────────
  // The world holds the phase-dominance seed; the helpers
  // here expose the per-biome permutation to the renderer
  // overlay + the save/load path. The permutation is
  // recomputed on every call (cheap — 3-element array) so
  // changes to the seed take effect immediately on the
  // next chunk load.
  getPhaseDominanceSeed() {
    return Number.isFinite(this.phaseDominanceSeed)
      ? Math.floor(this.phaseDominanceSeed)
      : DEFAULT_PHASE_DOMINANCE_SEED;
  }

  /**
   * Return the phase-dominance permutation for the given
   * biome id. The result is a frozen [phase0, phase1, phase2]
   * array. Index 0 is the dominant phase (the biome's
   * "preferred" phase); index 2 is the rare phase (the
   * biome's "avoided" phase). The Phase Nexus is special:
   * the permutation is always the canonical [0, 1, 2]
   * ordering (the §10.5 finale is deterministic).
   */
  getPhaseDominancePermutation(biomeId) {
    return pickPhaseDominance(this.getPhaseDominanceSeed(), biomeId);
  }

  /**
   * Return the dominant phase id (index 0 of the permutation)
   * for the given biome id. The terrain generator uses this
   * to bias per-block phase presence.
   */
  getDominantPhase(biomeId) {
    return pickDominantPhase(this.getPhaseDominanceSeed(), biomeId);
  }

  /**
   * Return the weight set the terrain generator multiplies
   * against the base phaseSolid mask. See
   * `dominanceWeights` in src/newgameplus/newgameplus.js
   * for the canonical shape.
   */
  getDominanceWeights(biomeId) {
    return dominanceWeights(this.getPhaseDominancePermutation(biomeId));
  }

  /**
   * Set the phase-dominance seed at runtime. Used by the
   * "Start New Game+" button — the game keeps the same
   * World instance, just swaps the seed so subsequent
   * chunk loads use the new permutation. Chunks already
   * in memory keep their pre-shuffle data; the player
   * sees the shuffle on the next chunk load / chunk
   * reload.
   */
  setPhaseDominanceSeed(seed) {
    const s = Number.isFinite(seed) ? Math.floor(seed) : DEFAULT_PHASE_DOMINANCE_SEED;
    this.phaseDominanceSeed = s;
    if (this.terrainGen && typeof this.terrainGen === 'object') {
      this.terrainGen.phaseDominanceSeed = s;
    }
    return s;
  }

  // ── Phase Anchor (Phase 2.7) ────────────────────────────────────
  //
  // The Phase Anchor is the player-placed lock that holds the player
  // on a block through a phase shift. The keys are the canonical
  // `${x},${y},${z},${phase}` string (same as World._globalKey). The
  // values are { x, y, z, phase, remaining } where `remaining` is the
  // seconds until the anchor expires (decremented per-frame by
  // tickAnchors). The orphan PhaseLockManager used Date.now() for the
  // expiry check; the new API uses a per-frame dt accumulator so the
  // lifetime is sandbox-safe (no wall-clock dependency).

  /**
   * Create a new anchor at the given (x, y, z) in the given phase.
   * Idempotent: if the key already exists, the `remaining` lifetime
   * is refreshed to ANCHOR_LIFETIME (the §2.7 spec — re-pressing
   * Shift+LMB on the same cell extends the lock). The phase arg is
   * the player's current phase (the anchor lives per-phase, same as
   * per-phase place/break from §2.3).
   *
   * Returns `{ ok: true, refreshed }` where `refreshed` is true when
   * the entry was already present. Returns `{ ok: false, reason }`
   * for invalid input (non-finite coords, out-of-range phase).
   */
  /**
   * Create a new anchor at (x, y, z) in the given phase.
   * Phase 10.6: optional `lifetime` arg (defaults to
   * ANCHOR_LIFETIME). The §10.6 per-biome signature mechanic
   * consults `biomeMultipliers(biomeId).anchorLifetimeMultiplier`
   * — Sky Ruins = 2x, Phase Nexus = 2x, others = 1x — and
   * passes the result in here. Defensive: non-finite /
   * non-positive lifetime values fall back to ANCHOR_LIFETIME
   * so a bad multiplier can't give the player infinite anchors.
   */
  createAnchor(x, y, z, phase, lifetime) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { ok: false, reason: 'bad-input' };
    }
    if (!Number.isInteger(phase) || phase < PHASE_ALPHA || phase >= PHASE_COUNT) {
      return { ok: false, reason: 'bad-input' };
    }
    const useLifetime = (typeof lifetime === 'number' && Number.isFinite(lifetime) && lifetime > 0)
      ? lifetime
      : ANCHOR_LIFETIME;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const key = anchorKey(ix, iy, iz, phase);
    const refreshed = this._anchors.has(key);
    this._anchors.set(key, {
      x: ix, y: iy, z: iz, phase,
      remaining: useLifetime,
    });
    return { ok: true, refreshed, key };
  }

  /**
   * Remove the anchor at the given (x, y, z, phase). Returns
   * `{ ok, removed }` where `removed` is true when an entry was
   * actually deleted. Returns `{ ok: false, reason: 'bad-input' }`
   * for invalid input.
   */
  removeAnchor(x, y, z, phase) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { ok: false, reason: 'bad-input' };
    }
    if (!Number.isInteger(phase) || phase < PHASE_ALPHA || phase >= PHASE_COUNT) {
      return { ok: false, reason: 'bad-input' };
    }
    const key = anchorKey(Math.floor(x), Math.floor(y), Math.floor(z), phase);
    const removed = this._anchors.delete(key);
    return { ok: true, removed, key };
  }

  /**
   * Snapshot the active anchors for the renderer + save system.
   * Returns a fresh array of `{ x, y, z, phase, remaining }` so
   * callers can mutate the result without affecting the world's
   * internal state. Used by main.js#tickAnchors to drive the
   * per-frame overlay update.
   */
  getAnchors() {
    const out = [];
    for (const [, anchor] of this._anchors) {
      out.push({
        x: anchor.x, y: anchor.y, z: anchor.z, phase: anchor.phase,
        remaining: anchor.remaining,
      });
    }
    return out;
  }

  /**
   * Walk the anchors map, decrement `remaining` by `dt`, and remove
   * any that have expired. Returns the list of expired keys so the
   * renderer can remove the corresponding wireframes. The decrement
   * logic is the pure helper in src/anchor/anchor.js#tickAnchors;
   * this method is the world-side effect: it applies the decrement
   * to the map AND collects the expired keys.
   *
   * Mirrors the per-frame update loop of the orphan PhaseLockManager
   * (Date.now() was the orphan's mechanism; dt is the new mechanism).
   */
  tickAnchors(dt) {
    if (!(this._anchors instanceof Map)) return [];
    const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (d === 0) return [];
    const expired = [];
    for (const [key, anchor] of this._anchors) {
      if (!anchor || typeof anchor.remaining !== 'number') {
        expired.push(key);
        continue;
      }
      const next = anchor.remaining - d;
      if (next <= 0) {
        expired.push(key);
      } else {
        anchor.remaining = next;
      }
    }
    for (const key of expired) {
      this._anchors.delete(key);
    }
    return expired;
  }

  /**
   * Find the anchor at the cell directly under the player's feet.
   * Returns `null` if no anchor is present at that cell in the
   * player's current phase. Used by onPhaseChanged to decide
   * whether to snap the player to the anchor (the §2.7 contract:
   * "Standing on it through a phase shift keeps you on the block").
   *
   * The current phase is passed in (not read from a phaseManager)
   * so the helper is phase-agnostic and testable.
   */
  findAnchorUnderPlayer(playerX, playerY, playerZ, currentPhase = PHASE_ALPHA) {
    const cell = _cellUnderPlayerPure(playerX, playerY, playerZ);
    if (!cell) return null;
    if (!Number.isInteger(currentPhase) || currentPhase < PHASE_ALPHA || currentPhase >= PHASE_COUNT) {
      return null;
    }
    const key = anchorKey(cell.x, cell.y, cell.z, currentPhase);
    const anchor = this._anchors.get(key);
    if (!anchor) return null;
    return {
      x: anchor.x, y: anchor.y, z: anchor.z, phase: anchor.phase,
      remaining: anchor.remaining,
    };
  }

  /**
   * Boolean check: is an anchor present at the given cell in the
   * given phase? Used by the physics to make the anchor collision-
   * solid in all phases (the §2.7 contract). Currently not consumed
   * by physics.js (the §2.7 "standing on it through a phase shift"
   * logic is handled by onPhaseChanged in main.js), but exposed
   * for future phases and for tests.
   */
  isAnchorActive(x, y, z, phase) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (!Number.isInteger(phase) || phase < PHASE_ALPHA || phase >= PHASE_COUNT) return false;
    const key = anchorKey(Math.floor(x), Math.floor(y), Math.floor(z), phase);
    return this._anchors.has(key);
  }

  /**
   * Snapshot the active anchors for the save system. Same shape
   * as getAnchors() but kept as a separate API so the save
   * system can be called without dragging the renderer along.
   * The save system also calls this from its `loadSnapshot`
   * round-trip to populate the world's anchor list.
   */
  exportAnchors() {
    return this.getAnchors();
  }

  /**
   * Phase 4.3: export the stabilizer positions (used by the
   * minimap to mark Stabilizers on the top-down view). Returns
   * an array of `x,y,z` keys (the canonical map keys).
   */
  exportStabilizers() {
    const positions = this._stabilizerPositions;
    if (!positions || typeof positions.keys !== 'function') return [];
    return Array.from(positions.keys());
  }

  /**
   * Apply a saved anchor list. Defensive — rejects non-finite /
   * non-integer / out-of-range ids so a tampered save can't
   * poison the world. Mirrors `_coerceWorldState` from
   * src/save/system.js. Returns the number of anchors actually
   * applied. An undefined/null/non-array input clears the
   * anchor list (back-compat with §1.7 / §2.4 save blobs that
   * don't include anchors).
   */
  importAnchors(snapshot) {
    if (!Array.isArray(snapshot)) {
      this._anchors.clear();
      return 0;
    }
    let applied = 0;
    for (const entry of snapshot) {
      if (!entry || typeof entry !== 'object') continue;
      const x = entry.x;
      const y = entry.y;
      const z = entry.z;
      const phase = entry.phase;
      const remaining = entry.remaining;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!Number.isInteger(phase) || phase < PHASE_ALPHA || phase >= PHASE_COUNT) continue;
      if (!Number.isFinite(remaining) || remaining < 0) continue;
      const key = anchorKey(Math.floor(x), Math.floor(y), Math.floor(z), phase);
      this._anchors.set(key, {
        x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), phase,
        remaining: Math.max(0, Math.min(ANCHOR_LIFETIME, remaining)),
      });
      applied++;
    }
    return applied;
  }

  /**
   * Clear all anchors. Used by the debug hook `clearAnchors()`
   * and on scene reload. The orphan's `clearAll` is the model.
   */
  clearAnchors() {
    this._anchors.clear();
  }

  // ── Phase 10.2: Phase Fuse (Memory World) ────────────────────────

  /**
   * Apply a Phase Fuse override at the given cell. The cell becomes
   * solid in the given phase regardless of the block's default
   * phaseSolid mask. Idempotent — re-fusing the same cell updates
   * the phase. Returns `true` on success, `false` on invalid input.
   *
   * The override is keyed by cell (no phase). The Memory World
   * pillar: the player can "leave a path" by fusing blocks in
   * Beta to make a permanent bridge, etc.
   */
  applyFuse(x, y, z, phase) {
    return applyFuseOverride(this._fuseOverrides, x, y, z, phase);
  }

  /**
   * Remove a fuse override at the given cell. Returns `true` if
   * the override was removed, `false` if the cell had no fuse.
   */
  removeFuse(x, y, z) {
    return removeFuseOverride(this._fuseOverrides, x, y, z);
  }

  /**
   * Check if a cell has a fuse override. Returns the override
   * phase (0, 1, or 2) if present, `null` otherwise.
   */
  getFuseAt(x, y, z) {
    if (!this._fuseOverrides || this._fuseOverrides.size === 0) return null;
    const key = fuseKey(x, y, z);
    const entry = this._fuseOverrides.get(key);
    if (!entry || typeof entry !== 'object') return null;
    return Number.isFinite(entry.phase) ? entry.phase : null;
  }

  /**
   * List all fuse overrides as a flat array. Used by the renderer
   * (FuseOverlay) and the save system.
   */
  listFuses() {
    return listFuseOverrides(this._fuseOverrides);
  }

  /**
   * Count of fuse overrides. Used by the HUD counter.
   */
  getFuseCount() {
    return fuseOverrideCount(this._fuseOverrides);
  }

  /**
   * Export the fuse overrides for save. Returns a JSON-safe array
   * of `{ x, y, z, phase, fusedAt }` entries.
   */
  exportFuses() {
    return serializeFuseOverrides(this._fuseOverrides);
  }

  /**
   * Apply a saved fuse list. Defensive — rejects non-finite /
   * non-integer / out-of-range phase values so a tampered save
   * can't poison the world. Returns the number of fuses
   * actually applied. Missing / non-array input clears the
   * fuse list (back-compat with §1.7 / §2.4 / §2.7 save blobs
   * that don't include fuses).
   */
  importFuses(snapshot) {
    if (!Array.isArray(snapshot)) {
      this._fuseOverrides.clear();
      return 0;
    }
    let applied = 0;
    for (const entry of snapshot) {
      if (!entry || typeof entry !== 'object') continue;
      const x = entry.x;
      const y = entry.y;
      const z = entry.z;
      const phase = entry.phase;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!Number.isInteger(phase) || phase < PHASE_ALPHA || phase >= PHASE_COUNT) continue;
      const key = fuseKey(x, y, z);
      this._fuseOverrides.set(key, {
        x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), phase: Math.floor(phase),
      });
      applied++;
    }
    return applied;
  }

  /**
   * Clear all fuse overrides. Used by the debug hook
   * `clearFuses()` and on scene reload.
   */
  clearFuses() {
    this._fuseOverrides.clear();
  }

  // ── Phase 10.5: Convergence finale (Nexus chamber) ─────────────

  /**
   * Open the Nexus chamber. Sets the `_nexusOpen` flag to true.
   * The flag is read by the renderer's NexusChamberOverlay and
   * the goals module's `actCompleted(ACT_CONVERGENCE, state)`.
   * Idempotent.
   */
  openNexus() {
    this._nexusOpen = true;
    return true;
  }

  /**
   * Returns true if the Nexus chamber is open. Used by the
   * goals module + the renderer.
   */
  isNexusOpen() {
    return this._nexusOpen === true;
  }

  /**
   * Mark Convergence complete. Called after the player collects
   * the final Echo in the Nexus chamber. The flag is read by the
   * goals module's `actCompleted(ACT_CONVERGENCE, state)` and
   * triggers the world-shimmer effect.
   */
  markConvergenceComplete() {
    this._convergenceComplete = true;
    return true;
  }

  /**
   * Returns true if Convergence is complete. Used by the goals
   * module + the renderer.
   */
  isConvergenceComplete() {
    return this._convergenceComplete === true;
  }

  /**
   * Reset the Convergence state (used by the New Game+ debug hook).
   */
  resetConvergence() {
    this._nexusOpen = false;
    this._convergenceComplete = false;
    return true;
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

  /** Register an Echo object in the world.
   *  Phase 10.11 follow-up: writes a `key` field (synthesized from
   *  the floored (x,y,z)) so every Echo — whether from terrain
   *  generation via addEcho, the new `spawnEcho` path, or
   *  `applyEchoState` reload — shares the same shape. The listEchoes
   *  helper, the §3.3 pickup loop, and the §10.11 hidden-Echo
   *  visibility check all read `e.key`; the legacy `addEcho` path
   *  leaving it undefined was a long-standing test debt (Phase 3.3
   *  behavior tests for listEchoes.length were failing because
   *  terrain-gen echoes contributed an unbounded count). */
  addEcho(type, x, y, z, lore) {
    // Check for existing echo at this position (don't duplicate)
    const existing = this._echoes.find(e =>
      e.x === x && e.y === y && e.z === z && !e.collected
    );
    if (existing) return existing;
    const echo = {
      type, x, y, z, lore,
      key: `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`,
      loreKey: `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`,
      biomeId: 0,
      collected: false,
    };
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

  /**
   * Save echo state to world state. Phase 10.11 also persists the
   * `hiddenPhase` tag so a save blob round-trips a wrong-phase
   * Echo correctly (the chunk-generation hook re-spawns the
   * hidden Echo at the same coords; the tag tells the world
   * this is the hidden variant).
   */
  getEchoState() {
    return this._echoes.map(e => ({
      type: e.type, x: e.x, y: e.y, z: e.z, lore: e.lore, collected: e.collected,
      hiddenPhase: Number.isFinite(e.hiddenPhase) ? e.hiddenPhase : null,
    }));
  }

  /**
   * Load echo state from save. Phase 10.11: re-applies the
   * `hiddenPhase` tag so the loaded Echo stays hidden in the
   * wrong phase. The `_hiddenEchoes` map is rebuilt from the
   * tagged entries.
   */
  applyEchoState(echoes) {
    for (const e of echoes) {
      this.addEcho(e.type, e.x, e.y, e.z, e.lore);
      if (e.collected) {
        const found = this._echoes.find(ev =>
          ev.x === e.x && ev.y === e.y && ev.z === e.z
        );
        if (found) found.collected = true;
      }
      // Phase 10.11: re-apply the hiddenPhase tag if the save
      // blob has it. The legacy `addEcho` doesn't write a `key`
      // field, so we synthesize one from the (x,y,z) here so
      // the `_hiddenEchoes` map stays consistent.
      if (e && Number.isFinite(e.hiddenPhase)) {
        const found = this._echoes.find(ev =>
          ev.x === e.x && ev.y === e.y && ev.z === e.z
        );
        if (found) {
          found.hiddenPhase = e.hiddenPhase;
          if (!found.key) {
            found.key = `${Math.floor(found.x)},${Math.floor(found.y)},${Math.floor(found.z)}`;
          }
          this._hiddenEchoes.set(found.key, {
            hiddenPhase: e.hiddenPhase,
            lore: found.lore || e.lore || '',
            biomeId: Number.isFinite(found.biomeId) ? found.biomeId : 0,
          });
        }
      }
    }
  }



  // ── Phase 3.3: §3.3 Echo API ─────────────────────────────────
  // Keyed echo map for O(1) pickup lookups + the canonical "x,y,z"
  // string key. The underlying `_echoes` array stays for back-compat
  // with the pre-3.3 lore code path (interactNearbyEcho etc); the
  // §3.3 helpers populate it via addEcho + read via the array.

  /** Spawn an Echo at the given coords. Idempotent (re-spawning the
   *  same cell is a no-op unless the Echo was collected, in which
   *  case the new spawn wins - the brief's "one-shot per Echo"
   *  semantics are owned by `collectEcho`). */
  spawnEcho(x, y, z, loreKey, biomeId) {
    const posKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const existing = this._echoes.find(e =>
      e.x === Math.floor(x) && e.y === Math.floor(y) && e.z === Math.floor(z)
    );
    if (existing && !existing.collected) return existing;
    const echo = {
      type: 'echo',
      x: Math.floor(x), y: Math.floor(y), z: Math.floor(z),
      lore: loreKey || '',
      loreKey: loreKey || posKey,
      biomeId: Number.isFinite(biomeId) ? biomeId : 0,
      collected: false,
      key: posKey,
      // Phase 10.11: a wrong-phase Echo is tagged with its visible
      // phase (`hiddenPhase`). The field is `undefined` for standard
      // Echoes (which are always visible).
      hiddenPhase: undefined,
    };
    if (existing) {
      // overwrite in place
      Object.assign(existing, echo);
      return existing;
    }
    this._echoes.push(echo);
    return echo;
  }

  /**
   * Phase 10.11: spawn a wrong-phase Echo. Identical to
   * `spawnEcho` but the entry is tagged with `hiddenPhase` (the
   * phase where the Echo is visible). The Echo's `lore` field
   * holds the unique lore string unlocked on collection. The
   * `_hiddenEchoes` map mirrors the standard `_echoes` array so
   * save/load can round-trip without losing the hidden-phase tag.
   *
   * The world doesn't enforce visibility — the renderer / game
   * loop reads `getEchoVisibility(key, currentPhase)` to decide
   * whether the Echo should be drawn + whether it can be picked
   * up. This keeps the world storage single-source-of-truth.
   */
  spawnHiddenEcho(x, y, z, hiddenPhase, lore, biomeId) {
    const echo = this.spawnEcho(x, y, z, lore, biomeId);
    if (!echo) return null;
    if (Number.isFinite(hiddenPhase)) {
      echo.hiddenPhase = Math.floor(hiddenPhase);
    }
    this._hiddenEchoes.set(echo.key, {
      hiddenPhase: Number.isFinite(hiddenPhase) ? Math.floor(hiddenPhase) : null,
      lore: lore || '',
      biomeId: Number.isFinite(biomeId) ? biomeId : 0,
    });
    return echo;
  }

  /**
   * Phase 10.11: get the visibility report for an Echo key. The
   * helper delegates to the pure `getEchoVisibility` from
   * `src/collect/echo.js`; this is the thin world wrapper so the
   * game loop doesn't have to know about the echoes array shape.
   *
   * Returns `{ visible, reason, hiddenPhase, lore }`:
   *   - `visible: true`  — Echo can be picked up from the current phase
   *   - `visible: false` — Echo is hidden (wrong phase or not spawned)
   *   - `reason`         — 'standard' | 'wrong-phase-echo' |
   *                        'not-spawned' | 'no-key'
   *   - `hiddenPhase`    — the phase where the Echo is visible (if any)
   *   - `lore`           — the unique lore unlocked on collection
   */
  getEchoVisibility(key, currentPhase) {
    const reports = this._echoes.map(e => ({
      key: e.key,
      loreKey: e.loreKey || e.key,
      biomeId: e.biomeId,
      hiddenPhase: Number.isFinite(e.hiddenPhase) ? e.hiddenPhase : undefined,
    }));
    const result = getEchoVisibility(key, currentPhase, reports);
    if (!result) return { visible: false, reason: 'not-spawned' };
    const echoEntry = this._echoes.find(e => e.key === key || e.loreKey === key);
    return Object.assign({}, result, {
      hiddenPhase: echoEntry && Number.isFinite(echoEntry.hiddenPhase)
        ? echoEntry.hiddenPhase
        : null,
      lore: echoEntry ? echoEntry.lore : '',
    });
  }

  /**
   * Phase 10.11: list the wrong-phase Echoes (for the Echo Hunter
   * panel + Phase Lens highlight). Returns an array of
   * `{ key, hiddenPhase, lore, biomeId, collected }`.
   */
  listHiddenEchoes() {
    return this._echoes
      .filter(e => Number.isFinite(e.hiddenPhase))
      .map(e => ({
        key: e.key,
        hiddenPhase: e.hiddenPhase,
        lore: e.lore,
        biomeId: e.biomeId,
        collected: e.collected,
      }));
  }

  /**
   * Phase 10.11: convenience: get the wrong-phase Echo for a
   * biome (used by the terrain generator to spawn one hidden Echo
   * per non-Nexus biome). Returns `{ biomeId, visiblePhase, lore }`
   * or null for the Phase Nexus (no hidden Echo).
   */
  getHiddenEchoForBiome(biomeId) {
    return wrongPhaseEchoForBiome(biomeId);
  }

  /** Collect an Echo by key. Returns the Echo data (with lore) or
   *  null if no uncollected Echo exists at that key. */
  collectEcho(key) {
    if (typeof key !== 'string' || key.length === 0) return null;
    const e = this._echoes.find(ev => ev.key === key && !ev.collected);
    if (!e) return null;
    e.collected = true;
    return { key: e.key, lore: e.lore, x: e.x, y: e.y, z: e.z, biomeId: e.biomeId };
  }

  /** Return all uncollected Echoes as a plain array (the shape the
   *  §3.3 pickup helper expects). */
  listEchoes() {
    return this._echoes.filter(e => !e.collected).map(e => ({
      key: e.key,
      loreKey: e.loreKey || e.key,
      lore: e.lore,
      x: e.x, y: e.y, z: e.z,
      biomeId: e.biomeId,
    }));
  }

  /** Return the total spawned Echo count (collected + uncollected). */
  getTotalEchoes() {
    return this._echoes.length;
  }

  /** Return the count of uncollected Echoes. */
  getUncollectedEchoCount() {
    return this._echoes.filter(e => !e.collected).length;
  }

  /** Return the count of collected Echoes. */
  getCollectedEchoCount() {
    return this._echoes.filter(e => e.collected).length;
  }

  /** Clear all Echoes (test reset path). */
  clearEchoes() {
    this._echoes = [];
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

  // ── Phase 3.4: §3.4 Resonance Core API (Crystal Caverns amplifiers)
  // The §3.4 work turns Crystal Caverns floating cores into
  // collectible amplifier objects. Each core has:
  //   - x/y/z (int)
  //   - amplifier (string: AMPLIFIER_AB / AMPLIFIER_BG / AMPLIFIER_AG)
  //   - biomeId (int)
  //   - collected (bool - false until pickup)
  //   - key (string - canonical "x,y,z")
  // Mirror of the §3.3 Echo API for the same pick-up pattern.

  /** Spawn a Resonance Core at the given coords. Idempotent unless
   *  the existing core was collected, in which case the new spawn
   *  wins (mirror of `spawnEcho`). */
  spawnResonanceCore(x, y, z, amplifier, biomeId) {
    const posKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    if (!Array.isArray(this._resonanceCores)) this._resonanceCores = [];
    const existing = this._resonanceCores.find(c =>
      c.x === Math.floor(x) && c.y === Math.floor(y) && c.z === Math.floor(z)
    );
    if (existing && !existing.collected) return existing;
    const core = {
      type: 'resonance-core',
      x: Math.floor(x), y: Math.floor(y), z: Math.floor(z),
      amplifier: amplifier || 'amplifierAB',
      biomeId: Number.isFinite(biomeId) ? biomeId : 0,
      collected: false,
      key: posKey,
    };
    if (existing) {
      Object.assign(existing, core);
      return existing;
    }
    this._resonanceCores.push(core);
    return core;
  }

  /** Collect a Resonance Core by key. Returns the Core data (with
   *  amplifier + key) or null if no uncollected Core exists. */
  collectResonanceCore(key) {
    if (typeof key !== 'string' || key.length === 0) return null;
    if (!Array.isArray(this._resonanceCores)) return null;
    const c = this._resonanceCores.find(cv => cv.key === key && !cv.collected);
    if (!c) return null;
    c.collected = true;
    return { key: c.key, amplifier: c.amplifier, x: c.x, y: c.y, z: c.z, biomeId: c.biomeId };
  }

  /** Return all uncollected Resonance Cores as a plain array (the
   *  shape the §3.4 pickup helper expects). */
  listResonanceCores() {
    if (!Array.isArray(this._resonanceCores)) return [];
    return this._resonanceCores.filter(c => !c.collected).map(c => ({
      key: c.key,
      amplifier: c.amplifier,
      x: c.x, y: c.y, z: c.z,
      biomeId: c.biomeId,
    }));
  }

  /** Return the total spawned Resonance Core count (collected + uncollected). */
  getTotalResonanceCores() {
    return Array.isArray(this._resonanceCores) ? this._resonanceCores.length : 0;
  }

  /** Return the count of uncollected Resonance Cores. */
  getUncollectedResonanceCoreCount() {
    if (!Array.isArray(this._resonanceCores)) return 0;
    return this._resonanceCores.filter(c => !c.collected).length;
  }

  /** Return the count of collected Resonance Cores. */
  getCollectedResonanceCoreCount() {
    if (!Array.isArray(this._resonanceCores)) return 0;
    return this._resonanceCores.filter(c => c.collected).length;
  }

  /** Clear all Resonance Cores (test reset path). */
  clearResonanceCores() {
    this._resonanceCores = [];
  }

  // ── Phase 3.5: §3.5 Phase Lock API ───────────────────────────
  // The §3.5 work ports the orphan `PhaseLockManager` logic to
  // the active path. A lock holds a block visible + solid in
  // the new phase for `LOCK_DURATION` (10s) after a phase shift.
  // The lock key is "x,y,z,phase" (phase included so the same
  // cell can be locked in 2 different phases simultaneously).
  // The `isLocked(x, y, z, phase)` helper is consulted by the
  // collision system (overrides `phaseSolid` for the locked cell).

  /** Create a Phase Lock at the given cell + phase. Idempotent
   *  for the same key (re-locking refreshes the duration). */
  createLock(x, y, z, phase, duration) {
    if (!Array.isArray(this._phaseLocks)) this._phaseLocks = [];
    const dur = (typeof duration === 'number' && Number.isFinite(duration)) ? duration : 10;
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), ip = Math.floor(phase);
    const key = `${ix},${iy},${iz},${ip}`;
    const existing = this._phaseLocks.find(l => l.key === key);
    if (existing) {
      existing.expires = now + dur;
      existing.duration = dur;
      return existing;
    }
    const lock = {
      x: ix, y: iy, z: iz, phase: ip,
      expires: now + dur,
      duration: dur,
      key,
    };
    this._phaseLocks.push(lock);
    return lock;
  }

  /** Tick the lock list - removes expired locks. */
  tickLocks(dt) {
    if (!Array.isArray(this._phaseLocks)) return;
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    this._phaseLocks = this._phaseLocks.filter(l => l.expires > now);
  }

  /** Check if a (x, y, z, phase) cell is currently locked. */
  isLocked(x, y, z, phase) {
    if (!Array.isArray(this._phaseLocks)) return false;
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), ip = Math.floor(phase);
    for (const l of this._phaseLocks) {
      if (l.x === ix && l.y === iy && l.z === iz && l.phase === ip) {
        return l.expires > now;
      }
    }
    return false;
  }

  /** Return all active (non-expired) locks as a plain array. */
  listLocks() {
    if (!Array.isArray(this._phaseLocks)) return [];
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    return this._phaseLocks.filter(l => l.expires > now).map(l => ({
      x: l.x, y: l.y, z: l.z, phase: l.phase,
      expires: l.expires,
      duration: l.duration,
      key: l.key,
    }));
  }

  /** Return the total lock count (active only). */
  getLockCount() {
    if (!Array.isArray(this._phaseLocks)) return 0;
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    return this._phaseLocks.filter(l => l.expires > now).length;
  }

  /** Return all lock keys (active only). */
  getLockKeys() {
    if (!Array.isArray(this._phaseLocks)) return [];
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    return this._phaseLocks.filter(l => l.expires > now).map(l => l.key);
  }

  /** Export the lock snapshot for save/load. */
  exportLocks() {
    if (!Array.isArray(this._phaseLocks)) return [];
    return this._phaseLocks.map(l => ({
      x: l.x, y: l.y, z: l.z, phase: l.phase,
      expires: l.expires, duration: l.duration,
    }));
  }

  /** Import a lock snapshot (save/load). Defensive: filters
   *  non-object entries + clamps expires to now + duration. */
  importLocks(snapshot) {
    if (!Array.isArray(snapshot)) { this._phaseLocks = []; return; }
    const now = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : Date.now() / 1000;
    this._phaseLocks = snapshot.filter(l => l && Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.z) && Number.isFinite(l.phase)).map(l => {
      // Defensive: if expires is in the past, push it forward by
      // `duration` so the saved locks are usable after reload.
      const dur = (Number.isFinite(l.duration)) ? l.duration : 10;
      let exp = (Number.isFinite(l.expires)) ? l.expires : (now + dur);
      if (exp < now) exp = now + dur;
      return {
        x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z),
        phase: Math.floor(l.phase),
        expires: exp,
        duration: dur,
        key: `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)},${Math.floor(l.phase)}`,
      };
    });
  }

  /** Clear all locks (test reset path). */
  clearLocks() {
    this._phaseLocks = [];
  }
}
