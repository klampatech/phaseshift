/**
 * Phase 4.3 — Minimap (data-driven; reads actual world blocks)
 *
 * Pure module. No DOM, no Three.js. The HUD calls
 * `buildMinimapSnapshot(world, player, opts)` every frame to
 * get a 32×32 cell matrix (each cell is `{ phaseColor, marker }`).
 * The HUD then renders the matrix to the existing `#minimap`
 * canvas.
 *
 * The §4.3 acceptance is:
 *   - 32×32 area sampled around the player.
 *   - Per-phase overlays (Alpha green, Beta blue, Gamma gold).
 *   - Player triangle pointing in the look direction.
 *   - Echoes + Stabilizers as small icons.
 */

// ── Canonical constants ────────────────────────────────────────

/** §4.3: minimap area (cells per side). 32×32 matches the plan. */
export const MINIMAP_SIZE = 32;

/** §4.3: each cell samples `floor(cameraX) + (dx - center)` etc. */
export const MINIMAP_RANGE = 16; // half-size

/** §4.3: phase → cell color (rgba string). */
export const PHASE_OVERLAY_COLORS = Object.freeze({
  0: 'rgba(90, 168, 90, 0.55)',   // ALPHA green
  1: 'rgba(51, 153, 230, 0.55)',  // BETA blue
  2: 'rgba(217, 179, 76, 0.55)',  // GAMMA gold
});

/** §4.3: marker color for echo (cyan). */
export const ECHO_MARKER_COLOR = 'rgba(170, 230, 255, 1.0)';
/** §4.3: marker color for stabilizer (orange). */
export const STABILIZER_MARKER_COLOR = 'rgba(255, 136, 68, 1.0)';
/** §4.3: marker color for resonance core (purple). */
export const RESONANCE_MARKER_COLOR = 'rgba(217, 119, 230, 1.0)';

/** §4.3: marker types. */
export const MARKER_NONE = 0;
export const MARKER_ECHO = 1;
export const MARKER_STABILIZER = 2;
export const MARKER_RESONANCE_CORE = 3;

// ── Helpers ────────────────────────────────────────────────────

/** Build a 32×32 snapshot of the world around the player. */
export function buildMinimapSnapshot(world, player, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const size = Number.isInteger(o.size) && o.size > 0 ? Math.min(64, o.size) : MINIMAP_SIZE;
  const half = Math.floor(size / 2);

  const pos = (player && typeof player.getPos === 'function')
    ? player.getPos()
    : (player && typeof player === 'object') ? player : null;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
    return {
      size,
      half,
      cells: new Array(size * size).fill(null),
      playerCellX: half,
      playerCellY: half,
      playerYaw: 0,
      hasWorld: false,
    };
  }

  const cells = new Array(size * size).fill(null);
  const centerX = Math.floor(pos.x);
  const centerZ = Math.floor(pos.z);
  const phase = (o.phase && Number.isInteger(o.phase)) ? o.phase : 0;

  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) {
      const wx = centerX + (dx - half);
      const wz = centerZ + (dz - half);
      let block = 0;
      if (world && typeof world.getBlock === 'function') {
        const b = world.getBlock(wx, 0, wz, phase);
        block = Number.isInteger(b) ? b : 0;
      }
      const i = dz * size + dx;
      cells[i] = {
        worldX: wx,
        worldZ: wz,
        block,
        color: PHASE_OVERLAY_COLORS[phase] || PHASE_OVERLAY_COLORS[0],
        marker: MARKER_NONE,
      };
    }
  }

  // Mark echoes, stabilizers, resonance cores if lists are provided.
  if (Array.isArray(o.echoKeys)) markType(cells, size, half, o.echoKeys, centerX, centerZ, MARKER_ECHO);
  if (Array.isArray(o.stabilizerKeys)) markType(cells, size, half, o.stabilizerKeys, centerX, centerZ, MARKER_STABILIZER);
  if (Array.isArray(o.resonanceCoreKeys)) markType(cells, size, half, o.resonanceCoreKeys, centerX, centerZ, MARKER_RESONANCE_CORE);

  return {
    size,
    half,
    cells,
    playerCellX: half,
    playerCellY: half,
    playerYaw: (player && typeof player.yaw === 'number') ? player.yaw
      : (player && typeof player.cameraYaw === 'number') ? player.cameraYaw
      : 0,
    hasWorld: !!(world && typeof world.getBlock === 'function'),
  };
}

/** Mark cells that contain echoes, stabilizers, or resonance cores. */
function markType(cells, size, half, keys, centerX, centerZ, markerType) {
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0) continue;
    const parts = key.split(',');
    if (parts.length < 3) continue;
    const wx = Number(parts[0]);
    const wz = Number(parts[2]);
    if (!Number.isFinite(wx) || !Number.isFinite(wz)) continue;
    const dx = wx - centerX + half;
    const dz = wz - centerZ + half;
    if (dx < 0 || dx >= size || dz < 0 || dz >= size) continue;
    const i = dz * size + dx;
    cells[i] = { ...cells[i], marker: markerType };
  }
}

/** Convert a marker type to its display color. */
export function markerColor(markerType) {
  if (markerType === MARKER_ECHO) return ECHO_MARKER_COLOR;
  if (markerType === MARKER_STABILIZER) return STABILIZER_MARKER_COLOR;
  if (markerType === MARKER_RESONANCE_CORE) return RESONANCE_MARKER_COLOR;
  return null;
}

export const MINIMAP_DEFAULTS = Object.freeze({
  size: MINIMAP_SIZE,
  range: MINIMAP_RANGE,
  phaseColors: PHASE_OVERLAY_COLORS,
  markerColors: {
    [MARKER_ECHO]: ECHO_MARKER_COLOR,
    [MARKER_STABILIZER]: STABILIZER_MARKER_COLOR,
    [MARKER_RESONANCE_CORE]: RESONANCE_MARKER_COLOR,
  },
});
