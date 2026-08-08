import { BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT, BLOCK_SAND, BLOCK_WOOD, BLOCK_CRYSTAL, BLOCK_RUNE, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_GLASS, BLOCK_IRON, BLOCK_GOLD_ORE, CHUNK_SIZE, CHUNK_HEIGHT, BIOME_FOREST, BIOME_RUINS, BIOME_CAVES, BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_DEEP_VOID, BIOME_PHASE_NEXUS, NOISE_SCALE, NOISE_OCTAVES, NOISE_PERSISTENCE, NOISE_LACUNARITY } from '../core/constants.js';
import { NoiseGenerator } from './noise.js';

// Biome definitions with block preferences per phase
const BIOME_DATA = {
  [BIOME_FOREST]: {
    surfaceBlock: BLOCK_GRASS,
    subSurfaceBlock: BLOCK_DIRT,
    depthBlock: BLOCK_STONE,
    woodChance: 0.08,
    crystalChance: 0.005,
    caveChance: 0.04,
    biomeColor: [0.3, 0.55, 0.3],
  },
  [BIOME_RUINS]: {
    surfaceBlock: BLOCK_STONE,
    subSurfaceBlock: BLOCK_STONE,
    depthBlock: BLOCK_STONE,
    woodChance: 0.02,
    crystalChance: 0.015,
    caveChance: 0.02,
    runeChance: 0.003,
    echoChance: 0.001, // Echo collectibles in ruins
    biomeColor: [0.5, 0.45, 0.4],
  },
  [BIOME_CAVES]: {
    surfaceBlock: BLOCK_STONE,
    subSurfaceBlock: BLOCK_STONE,
    depthBlock: BLOCK_STONE,
    woodChance: 0.01,
    crystalChance: 0.025,
    caveChance: 0.12,
    goldOreChance: 0.008,
    biomeColor: [0.35, 0.3, 0.35],
  },
  [BIOME_DESERT]: {
    surfaceBlock: BLOCK_SAND,
    subSurfaceBlock: BLOCK_SAND,
    depthBlock: BLOCK_STONE,
    woodChance: 0.005,
    crystalChance: 0.01,
    caveChance: 0.02,
    biomeColor: [0.8, 0.7, 0.4],
  },
  [BIOME_CRYSTAL_CAVERN]: {
    surfaceBlock: BLOCK_CRYSTAL,
    subSurfaceBlock: BLOCK_CRYSTAL,
    depthBlock: BLOCK_CRYSTAL,
    woodChance: 0.005,
    crystalChance: 0.06,
    caveChance: 0.08,
    glassChance: 0.01,
    resonanceCoreChance: 0.0005, // Resonance cores in crystal caverns
    biomeColor: [0.4, 0.3, 0.5],
  },
  [BIOME_SKY_RUINS]: {
    surfaceBlock: BLOCK_STONE,
    subSurfaceBlock: BLOCK_OBSIDIAN,
    depthBlock: BLOCK_OBSIDIAN,
    woodChance: 0.01,
    crystalChance: 0.03,
    caveChance: 0.03,
    runeChance: 0.005,
    biomeColor: [0.4, 0.4, 0.6],
  },
  [BIOME_DEEP_VOID]: {
    surfaceBlock: BLOCK_VOID,
    subSurfaceBlock: BLOCK_VOID,
    depthBlock: BLOCK_OBSIDIAN,
    woodChance: 0.005,
    crystalChance: 0.02,
    caveChance: 0.01,
    runeChance: 0.008,
    biomeColor: [0.1, 0.05, 0.15],
  },
  [BIOME_PHASE_NEXUS]: {
    surfaceBlock: BLOCK_RUNE,
    subSurfaceBlock: BLOCK_RUNE,
    depthBlock: BLOCK_CRYSTAL,
    woodChance: 0.005,
    crystalChance: 0.04,
    caveChance: 0.01,
    runeChance: 0.015,
    biomeColor: [0.6, 0.2, 0.5],
  },
};

export class TerrainGenerator {
  constructor(seed) {
    this.noise = new NoiseGenerator(seed);
    this.biomeNoise = new NoiseGenerator(seed + 1);
    this.caveNoise = new NoiseGenerator(seed + 2);
  }

  generateChunk(chunkX, chunkZ, biomeId) {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const biome = BIOME_DATA[biomeId] || BIOME_DATA[BIOME_FOREST];
    const scale = NOISE_SCALE;
    const seed = this.noise.seed;

    // Collect world objects for this chunk
    const echoes = [];
    const cores = [];
    const loreSnippets = [
      'Phase history echoes remain. The world shifts in layers unseen.',
      'Ancient builders moved through phases. Their memory lingers here.',
      'When the three phases aligned, the world was whole.',
      'A stabilizer stands guard. Its purpose: to anchor existence itself.',
      'Echoes of other worlds whisper of possibilities unfulfilled.',
      'The crystal sings a song of phase resonance.',
      'Rune-worked stone, attuned to Gamma phase. Power waits to be unlocked.',
      'In the deep void, phase-shifting is the only way through.',
    ];

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const worldX = chunkX * CHUNK_SIZE + x;
        const worldZ = chunkZ * CHUNK_SIZE + z;

        // Heightmap
        const baseHeight = this.noise.fbm.noise3D(worldX * scale, 0, worldZ * scale);

        // Biome variation
        const biomeVal = this.biomeNoise.fbm.noise3D(worldX * scale * 0.5, 0, worldZ * scale * 0.5);

        // Height varies by biome
        let heightFactor = 0.4 + baseHeight * 0.6;
        if (biomeId === BIOME_DEEP_VOID) heightFactor *= 0.5;
        if (biomeId === BIOME_SKY_RUINS) heightFactor = 0.6 + baseHeight * 0.4;

        const surfaceY = Math.floor(heightFactor * (CHUNK_HEIGHT * 0.6)) + CHUNK_HEIGHT * 0.3;

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = this.index(x, y, z);

          if (y === 0) {
            data[idx] = BLOCK_STONE; // Bedrock
            continue;
          }

          if (y > surfaceY + 8) {
            data[idx] = biome.depthBlock;
          } else if (y > surfaceY + 3) {
            data[idx] = biome.subSurfaceBlock;
          } else if (y > surfaceY) {
            data[idx] = biome.surfaceBlock;
          } else {
            // Underground - use cave noise
            const caveVal = this.caveNoise.fbm.noise3D(
              worldX * scale * 2, y * scale * 3, worldZ * scale * 2
            );

            if (caveVal > (1 - biome.caveChance) * 0.7) {
              data[idx] = BLOCK_AIR;
            } else {
              // Random special blocks
              const rand = Math.abs(hash(worldX, y, worldZ)) / 2147483647;
              if (biome.runeChance && rand < biome.runeChance) {
                data[idx] = BLOCK_RUNE;
              } else if (biome.crystalChance && rand < biome.crystalChance * 2) {
                data[idx] = BLOCK_CRYSTAL;
              } else if (biome.woodChance && rand < biome.woodChance * 2) {
                data[idx] = BLOCK_WOOD;
              } else if (biome.goldOreChance && rand < biome.goldOreChance * 1.5) {
                data[idx] = BLOCK_GOLD_ORE;
              } else if (biome.glassChance && rand < biome.glassChance * 2) {
                data[idx] = BLOCK_GLASS;
              } else if (biome.resonanceCoreChance && rand < biome.resonanceCoreChance * 0.5) {
                data[idx] = BLOCK_RESONANCE_CORE;
              } else {
                data[idx] = biome.subSurfaceBlock;
              }
            }
          }
        }

        // Add surface vegetation/features
        for (let y = Math.max(0, surfaceY - 3); y <= surfaceY; y++) {
          const idx = this.index(x, y, z);
          const worldY = 0 * CHUNK_HEIGHT + y;
          const rand = Math.abs(hash(worldX, worldY, worldZ)) / 2147483647;
          if (biome.woodChance && rand < biome.woodChance && y === surfaceY) {
            data[idx] = BLOCK_WOOD;
          }
        }

        // Place Echo collectibles in Ruins biome
        if (biome.echoChance) {
          const worldY = surfaceY + 1; // Just above surface
          const rand = Math.abs(hash(worldX, worldY, worldZ)) / 2147483647;
          if (rand < biome.echoChance) {
            const loreIdx = (worldX + chunkZ * 7) % loreSnippets.length;
            echoes.push({
              type: 'Echo',
              x: x + chunkX * CHUNK_SIZE,
              y: worldY,
              z: z + chunkZ * CHUNK_SIZE,
              lore: loreSnippets[loreIdx >= 0 ? loreIdx : 0],
            });
          }
        }

        // Place Resonance Cores in Crystal Cavern biome
        if (biome.resonanceCoreChance) {
          const worldY = CHUNK_HEIGHT * 0.5; // Mid-height in cavern
          const rand = Math.abs(hash(worldX, worldY, worldZ)) / 2147483647;
          if (rand < biome.resonanceCoreChance) {
            cores.push({
              type: 'ResonanceCore',
              x: x + chunkX * CHUNK_SIZE,
              y: worldY,
              z: z + chunkZ * CHUNK_SIZE,
            });
          }
        }
      }
    }

    return { data, echoes, cores };
  }

  // Apply phase inversion for Beta/Gamma
  invertForPhase(chunkData, targetPhase) {
    const inverted = new Uint8Array(chunkData.length);
    for (let i = 0; i < chunkData.length; i++) {
      const block = chunkData[i];
      if (block === BLOCK_AIR) {
        inverted[i] = targetPhase === 2 ? BLOCK_STONE : BLOCK_AIR;
      } else if (block === BLOCK_STONE) {
        inverted[i] = targetPhase === 1 ? BLOCK_AIR : BLOCK_STONE;
      } else if (block === BLOCK_WOOD) {
        inverted[i] = targetPhase === 1 ? BLOCK_AIR : targetPhase === 2 ? BLOCK_OBSIDIAN : BLOCK_WOOD;
      } else if (block === BLOCK_CRYSTAL) {
        inverted[i] = targetPhase === 2 ? BLOCK_CRYSTAL : BLOCK_AIR;
      } else if (block === BLOCK_VOID) {
        inverted[i] = targetPhase === 2 ? BLOCK_AIR : BLOCK_VOID;
      } else if (block === BLOCK_RUNE) {
        inverted[i] = targetPhase === 1 ? BLOCK_RUNE : BLOCK_AIR;
      } else {
        inverted[i] = block;
      }
    }
    return inverted;
  }

  index(x, y, z) {
    return x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT;
  }
}

function hash(x, y, z) {
  return (((x * 374761393) ^ (y * 668265263)) ^ (z * 374761393)) | 0;
}
