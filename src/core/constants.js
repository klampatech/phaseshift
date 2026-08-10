/**
 * Phase Shifter - Core Game Constants
 *
 * Centralized constants for game configuration.
 * Import from here in game logic and rendering modules.
 */

// ── Phase Constants ──────────────────────────────────────────────
export const PHASE_ALPHA = 0;
export const PHASE_BETA = 1;
export const PHASE_GAMMA = 2;
export const PHASE_COUNT = 3;

export const PHASE_NAMES = ['Alpha', 'Beta', 'Gamma'];
export const PHASE_COLORS = ['#5aa85a', '#3399e6', '#d9b34c'];
export const PHASE_PHASED = [false, true, true]; // whether phase is active in that phase

// Phase Step constants (used by both player.js and physics.js)
export const PHASE_STEP_THRESHOLD = 3.0;
export const PHASE_STEP_COOLDOWN = 0.5;
export const PHASE_STEP_DURATION = 0.15;

// ── Block Type Constants ─────────────────────────────────────────
export const BLOCK_AIR = 0;
export const BLOCK_STONE = 1;
export const BLOCK_WOOD = 2;
export const BLOCK_CRYSTAL = 3;
export const BLOCK_OBSIDIAN = 4;
export const BLOCK_VOID = 5;
export const BLOCK_RUNE = 6;
export const BLOCK_GRASS = 7;
export const BLOCK_DIRT = 8;
export const BLOCK_SAND = 9;
export const BLOCK_GLASS = 10;
export const BLOCK_IRON = 11;
export const BLOCK_GOLD_ORE = 12;
export const BLOCK_WATER = 13;
export const BLOCK_ENERGY = 14;
export const BLOCK_STABILIZER = 15;
export const BLOCK_ECHO = 17;


// ── Block Names (display) ──────────────────────────────────────
export const BLOCK_NAMES = [
  'Air',      // 0
  'Stone',    // 1
  'Wood',     // 2
  'Crystal',  // 3
  'Obsidian', // 4
  'Void',     // 5
  'Rune',     // 6
  'Grass',    // 7
  'Dirt',     // 8
  'Sand',     // 9
  'Glass',    // 10
  'Iron',     // 11
  'Gold Ore', // 12
  'Water',    // 13
  'Energy',       // 14
  'Stabilizer',   // 15
  'Resonance Core', // 16
  'Echo', // 17
];

// ── Block Properties ─────────────────────────────────────────────
/**
 * Block properties:
 * - color: RGB array for rendering
 * - solid: whether the block blocks movement in its visible phase
 * - phaseSolid: 3-element boolean array [solidInAlpha, solidInBeta, solidInGamma]
 *   defining collision per phase (per spec: phase-relative colliders)
 * - transparent: whether movement passes through the block
 * - phase: array of phases where this block is visible
 */
export const BLOCK_PROPERTIES = {
  [BLOCK_AIR]:       { name: 'Air',       color: [0, 0, 0], solid: false, transparent: true,  phase: [], phaseSolid: [false, false, false], isResource: false, immovable: false },
  [BLOCK_STONE]:     { name: 'Stone',     color: [115, 115, 115], solid: true,  transparent: false, phase: [PHASE_ALPHA, PHASE_BETA], phaseSolid: [true, true, false], isResource: true, immovable: false },
  [BLOCK_WOOD]:      { name: 'Wood',      color: [166, 130, 75], solid: true,  transparent: false, phase: [PHASE_ALPHA, PHASE_GAMMA], phaseSolid: [true, false, true], isResource: true, immovable: false },
  [BLOCK_CRYSTAL]:   { name: 'Crystal',   color: [75, 170, 240], solid: true,  transparent: false, phase: [PHASE_BETA], phaseSolid: [false, true, false], isResource: true, immovable: false },
  [BLOCK_OBSIDIAN]:  { name: 'Obsidian',  color: [45, 30, 60], solid: true,  transparent: false, phase: [PHASE_GAMMA], phaseSolid: [false, false, true], isResource: false, immovable: true },
  [BLOCK_VOID]:      { name: 'Void',      color: [40, 40, 40], solid: false, transparent: true,  phase: [PHASE_GAMMA], phaseSolid: [false, false, false], isResource: false, immovable: false },
  [BLOCK_RUNE]:      { name: 'Rune',      color: [187, 135, 75], solid: true,  transparent: false, phase: [PHASE_GAMMA], phaseSolid: [false, false, true], isResource: true, immovable: false },
  [BLOCK_GRASS]:     { name: 'Grass',     color: [75, 170, 75], solid: true,  transparent: false, phase: [PHASE_ALPHA], phaseSolid: [true, false, false], isResource: true, immovable: false },
  [BLOCK_DIRT]:      { name: 'Dirt',      color: [115, 85, 55], solid: true,  transparent: false, phase: [PHASE_ALPHA], phaseSolid: [true, false, false], isResource: true, immovable: false },
  [BLOCK_SAND]:      { name: 'Sand',      color: [210, 195, 140], solid: true, transparent: false, phase: [PHASE_ALPHA], phaseSolid: [true, false, false], isResource: true, immovable: false },
  [BLOCK_GLASS]:     { name: 'Glass',     color: [200, 220, 255], solid: true,  transparent: true,  phase: [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA], phaseSolid: [true, true, true], isResource: true, immovable: false },
  [BLOCK_IRON]:      { name: 'Iron',      color: [180, 180, 180], solid: true,  transparent: false, phase: [PHASE_ALPHA, PHASE_BETA], phaseSolid: [true, true, false], isResource: true, immovable: false },
  [BLOCK_GOLD_ORE]:  { name: 'Gold Ore',  color: [235, 200, 50], solid: true,  transparent: false, phase: [PHASE_ALPHA, PHASE_GAMMA], phaseSolid: [true, false, true], isResource: true, immovable: false },
  [BLOCK_WATER]:     { name: 'Water',     color: [50, 120, 200], solid: true,  transparent: false, phase: [PHASE_ALPHA], phaseSolid: [true, false, false], isResource: false, immovable: false },
  [BLOCK_ENERGY]:    { name: 'Energy',    color: [235, 204, 50], solid: false, transparent: true,  phase: [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA], phaseSolid: [false, false, false], isResource: true, immovable: false },
  [BLOCK_STABILIZER]: { name: 'Stabilizer', color: [255, 102, 68], solid: true,  transparent: false, phase: [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA], phaseSolid: [true, true, true], isResource: false, immovable: true },
  [BLOCK_ECHO]:       { name: 'Echo',       color: [180, 220, 255], solid: false, transparent: true,  phase: [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA], phaseSolid: [false, false, false], isResource: false, immovable: true },
};

// ── Biome Constants ──────────────────────────────────────────────
export const BIOME_FOREST = 1;
export const BIOME_CAVES = 2;
export const BIOME_DEEP_VOID = 3;
export const BIOME_RUINS = 4;
export const BIOME_DESERT = 5;
export const BIOME_CRYSTAL_CAVERN = 6;
export const BIOME_SKY_RUINS = 7;
export const BIOME_PHASE_NEXUS = 8;

export const BIOME_NAMES = ['Forest', 'Caves', 'Deep Void', 'Ruins', 'Desert', 'Crystal Cavern', 'Sky Ruins', 'Phase Nexus'];

export const BIOME_PREFERENCES = {
  [BIOME_FOREST]: { preferredStone: BLOCK_WOOD, preferredWood: BLOCK_STONE, label: 'Forest' },
  [BIOME_CAVES]:  { preferredStone: BLOCK_OBSIDIAN, preferredWood: BLOCK_STONE,  label: 'Caves' },
  [BIOME_DEEP_VOID]: { preferredStone: BLOCK_VOID, preferredWood: BLOCK_VOID, label: 'Deep Void' },
  [BIOME_RUINS]: { preferredStone: BLOCK_STONE, preferredWood: BLOCK_WOOD, label: 'Ruins' },
  [BIOME_DESERT]: { preferredStone: BLOCK_SAND, preferredWood: BLOCK_SAND, label: 'Desert' },
  [BIOME_CRYSTAL_CAVERN]: { preferredStone: BLOCK_CRYSTAL, preferredWood: BLOCK_CRYSTAL, label: 'Crystal Cavern' },
  [BIOME_SKY_RUINS]: { preferredStone: BLOCK_GLASS, preferredWood: BLOCK_STONE, label: 'Sky Ruins' },
  [BIOME_PHASE_NEXUS]: { preferredStone: BLOCK_RUNE, preferredWood: BLOCK_ENERGY, label: 'Phase Nexus' },
};

// ── Amplifier Constants ─────────────────────────────────────────
export const AMPLIFIER_AB = 'amplifierAB';
export const AMPLIFIER_BG = 'amplifierBG';
export const AMPLIFIER_AG = 'amplifierAG';

/** Amplifier names for display */
export const AMPLIFIER_NAMES = {
  [AMPLIFIER_AB]: 'Phase Amplifier (Alpha↔Beta)',
  [AMPLIFIER_BG]: 'Phase Amplifier (Beta↔Gamma)',
  [AMPLIFIER_AG]: 'Phase Amplifier (Alpha↔Gamma)',
};

/** Shift cost reduction per matching amplifier */
export const AMPLIFIER_SHIFT_REDUCTION = 1.5;

/** Drain rate reduction per matching amplifier */
export const AMPLIFIER_DRAIN_REDUCTION = 0.05;

// ── Player / Movement Constants ──────────────────────────────────
export const COLS = 20;
export const ROWS = 20;
export const TILE_SIZE = 32;
export const PLAYER_SPEED = 1;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_SPRINT_SPEED = 1.5;
export const PLAYER_CROUCH_SPEED = 0.5;
export const PLAYER_START = { x: 8, y: 8 };
export const INITIAL_ENERGY = 100;
export const MAX_ENERGY = 100;
export const PHASE_SHIFT_COST = 5;
export const PHASE_SHIFT_SPEED = 0.3;
export const JUMP_VELOCITY = 6;
export const NOISE_SCALE = 0.01;
export const NOISE_OCTAVES = 4;
export const NOISE_PERSISTENCE = 0.5;
export const NOISE_LACUNARITY = 2.0;
export const NOISE_SEED = 42;
export const WORLD_SEED = 12345;

// Block phase colors (interpolated during shift)
export const BLOCK_PHASE_COLORS = {
  0: { r: 0.55, g: 0.72, b: 0.55 },  // Alpha - green
  1: { r: 0.25, g: 0.65, b: 0.92 },  // Beta - blue
  2: { r: 0.95, g: 0.78, b: 0.35 },  // Gamma - gold
};
export const MAX_PHASE_ENERGY = 100;
export const PHASE_REGEN_RATE_ALPHA = 0.5;
export const PHASE_DRAIN_RATE_BETA = 0.2;
export const PHASE_DRAIN_RATE_GAMMA = 0.4;
export const MAX_FATIGUE = 100;
export const SCAN_COST = 3;
export const RESONATE_COST = 15;
// Phase 2.5: Phase Lens hold-drain (energy per second while E is held).
export const PHASE_LENS_DRAIN_RATE = 0.5;
// Phase 2.5: scan radius (block units, cubic). The plan's §2.5 acceptance
// calls for a 4-block radius. Used by both the one-shot press (E) and
// the Phase Lens hold (E).
export const SCAN_RADIUS = 4;
// Phase 2.6: Resonance (Q) — the one-shot press that swaps phase
// presence on the blocks around the player. The radius is in block
// units (cubic) — radius=1 gives a 3×3×3 area around the player. The
// pulse duration is the total sphere-pulse lifetime (0.25s expand +
// 0.75s fade) so the renderer can decide when to dispose the mesh.
export const RESONANCE_RADIUS = 1;
export const RESONANCE_PULSE_DURATION = 1.0;
// Phase 2.7: Phase Anchor (Shift+LMB) — the player-placed lock that
// holds them on a block through a phase shift. The lifetime is the
// number of seconds before the outline disappears (the plan's §2.7
// acceptance). The fade window is the seconds-before-expiry during
// which the outline pulse-fades (mirrors the orphan PhaseLockManager
// behavior). The fill + border colors are the yellow-glow palette
// from the orphan. The cost is 0 (anchors are free; the §2.7 spec
// is just "10 seconds the outline disappears" with no energy mention).
export const ANCHOR_LIFETIME = 10;
export const ANCHOR_FADE_WINDOW = 3;
export const ANCHOR_FILL_COLOR = 0xffee88;
export const ANCHOR_BORDER_COLOR = 0xffcc00;
export const ANCHOR_COST = 0;
// Phase 2.8: how often the footstep sound fires while the player is
// moving and grounded (seconds). The plan's §2.8 acceptance is
// "every 0.4s". The game loop uses a per-frame accumulator (the
// same pattern as Phase 2.7's anchor lifetime) so a tab-switch
// pause doesn't dump the entire pause into the timer. The footstep
// is also gated by isMoving && isGrounded and a phase-and-block
// filter (the cell under the player's feet in the current phase
// must be a non-air block — see src/audio/footsteps.js).
export const FOOTSTEP_INTERVAL = 0.4;
export const ENERGY_REGEN_RATE = 0.005;
export const PHASE_DRAIN_RATE = 0.02;
export const WATER_DRAIN = 0.15;

// ── Phase Erosion Constants ──────────────────────────────────────
export const EROSION_THRESHOLD = 3.0;  // seconds of exposure before erosion triggers
export const EROSION_TICK = 0.1;  // progress per second of exposure
export const EROSION_RADIUS = 5;  // blocks around player to check for erosion
export const EROSION_RATE = 0.02;  // erosion progress per tick (seconds of exposure accumulated per game second)

// Erosion map: erosionMap[blockType][wrongPhase] = erodedBlockType
// Only blocks NOT solid in the specified phase erode when observed there
export const EROSION_MAP = {
  [BLOCK_STONE]:     { [PHASE_GAMMA]: BLOCK_DIRT },  // stone in Gamma → dirt (weakens)
  [BLOCK_WOOD]:      { [PHASE_BETA]: BLOCK_DIRT },   // wood in Beta → dirt (rot)
  [BLOCK_GRASS]:     { [PHASE_BETA]: BLOCK_DIRT },   // grass in Beta → dirt
  [BLOCK_DIRT]:      { [PHASE_GAMMA]: BLOCK_AIR },   // dirt in Gamma → erodes to air (dust)
  [BLOCK_SAND]:      { [PHASE_GAMMA]: BLOCK_AIR },   // sand in Gamma → disperses
  [BLOCK_IRON]:      { [PHASE_GAMMA]: BLOCK_GOLD_ORE }, // iron in Gamma → rusts to gold ore
  [BLOCK_GOLD_ORE]:  { [PHASE_BETA]: BLOCK_STONE },  // gold ore in Beta → calcifies to stone
  [BLOCK_RUNE]:      { [PHASE_ALPHA]: BLOCK_GLASS }, // rune in Alpha → fades to glass
  // Blocks NOT listed here are erosion-immune (crystal, obsidian, glass, void, energy)
};

// ── World / Chunk Constants ──────────────────────────────────────
export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;
export const CHUNK_RENDER_DIST = 3;
export const RENDER_DISTANCE = CHUNK_RENDER_DIST;
export const SAVE_CHUNK_DIST = 2;
export const UNLOAD_CHUNK_DIST = 1;
export const INITIAL_CHUNKS = 1;
export const MINIMUM_RESPAWN_ENERGY = 30;
// Phase 3.3: Echo pickup radius (blocks, cubic). The §3.3 acceptance
// is "walking within 2 blocks of an Echo collects it"; 1.5 gives
// the player a small grace margin and matches the §2.7 anchor snap
// pattern (a 1-cell radius around the player's feet).
export const ECHO_PICKUP_RADIUS = 1.5;
// Phase 3.3: Echo lore toast duration (seconds). The §3.3 brief
// specifies a 5-second display window before the lore toast fades.
export const ECHO_LORE_TTL = 5;


// ── Tool Constants ───────────────────────────────────────────────
export const TOOLS = {
  PHASE_ANCHOR: 'phaseAnchor',
  PHASE_LENS: 'phaseLens',
  PHASE_GLIDER: 'phaseGlider',
  STABILIZER: 'stabilizer',
};

export const TOOL_DESCRIPTIONS = {
  [TOOLS.PHASE_ANCHOR]: 'Place anchor points to phase-lock blocks. Shift+click to place/remove.',
  [TOOLS.PHASE_LENS]: 'See through walls in current phase. Hold E.',
  [TOOLS.PHASE_GLIDER]: 'Fly briefly through void spaces. Press Space in Beta.',
  [TOOLS.STABILIZER]: 'Place checkpoint. Restores energy on phase collapse.',
};

// ── Amplifier / Artifact Constants ───────────────────────────────
export const AMPLIFIER_TYPES = {
  RESONANCE_CORE: 'ResonanceCore',
  STABILIZER: 'Stabilizer',
  ECHO: 'Echo',
};

export const AMPLIFIER_INFO = {
  [AMPLIFIER_TYPES.RESONANCE_CORE]: { name: 'Resonance Core', desc: 'Boosts resonance radius. Found in Gamma biome.', icon: '◆', color: '#d9b34c' },
  [AMPLIFIER_TYPES.STABILIZER]: { name: 'Stabilizer', desc: 'Checkpoint. Restores energy on respawn.', icon: '◆', color: '#ff6644' },
  [AMPLIFIER_TYPES.ECHO]: { name: 'Echo', desc: 'Lore/memory recording. Collect to unlock story.', icon: '●', color: '#88ccff' },
};

// ── Game State Constants ─────────────────────────────────────────
export const GAME_STATE = {
  LOADING: 'loading',
  RUNNING: 'running',
  PAUSED: 'paused',
  MENU: 'menu',
};

export const ACTION = {
  SHIFT_PHASE: 'shiftPhase',
  SCAN: 'scan',
  RESONATE: 'resonate',
  COLLECT: 'collect',
  ANCHOR: 'anchor',
  JUMP: 'jump',
  PHASE_STEP: 'phaseStep',
};

// ── Rendering Constants ──────────────────────────────────────────
export const RENDER_DIST = 12; // render distance in tiles
export const MARGIN = 3; // extra tiles for phase shift visual
export const GRID = [COLS, ROWS];

// ── World Constants ──────────────────────────────────────────────
export const WORLD_RADIUS = 20;
export const WORLD_SIZE = WORLD_RADIUS * 2;

// ── Amplifier Info (for UI display) ──────────────────────────────
export const AMPLIFIER_EQUIPMENT_INFO = {
  [AMPLIFIER_AB]: {
    name: 'Alpha↔Beta Resonator',
    desc: 'Reduces phase shift cost and drain rate for Alpha↔Beta transitions.',
    icon: '🟢🔵',
  },
  [AMPLIFIER_BG]: {
    name: 'Beta↔Gamma Resonator',
    desc: 'Reduces phase shift cost and drain rate for Beta↔Gamma transitions.',
    icon: '🔵🟡',
  },
  [AMPLIFIER_AG]: {
    name: 'Alpha↔Gamma Resonator',
    desc: 'Reduces phase shift cost and drain rate for Alpha↔Gamma transitions.',
    icon: '🟢🟡',
  },
};


