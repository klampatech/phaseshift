/**
 * Phase 5.1 — Goals and progression (Acts + objective + compass)
 *
 * Pure module. The game has 3 "Acts" (the §5.1 brief's "three Acts"):
 *   1. Act 1: Find the First Echo — collect your first Echo.
 *   2. Act 2: Reach the Phase Nexus — explore the Phase Nexus biome.
 *   3. Act 3: Master All Phases — collect all 3 amplifiers + visit
 *      all 3 phases + place a Stabilizer.
 *
 * Each Act has a completion predicate + a one-line objective string.
 * The HUD's `setObjective(text, color)` shows the current objective;
 * the compass points to the nearest unfinished objective marker.
 *
 * The §5.1 acceptance is:
 *   - Three "Acts": Find the First Echo, Reach the Phase Nexus,
 *     Master All Phases.
 *   - A persistent HUD objective ("Find the Stabilizer in the
 *     Ruins") shown above the crosshair.
 *   - Compass direction to the nearest Echo / Stabilizer / Core.
 */

// ── Act / Goal definitions ─────────────────────────────────────

export const ACT_FIND_FIRST_ECHO = 'act1_find_first_echo';
export const ACT_REACH_PHASE_NEXUS = 'act2_reach_phase_nexus';
export const ACT_MASTER_ALL_PHASES = 'act3_master_all_phases';

export const ACT_ORDER = Object.freeze([
  ACT_FIND_FIRST_ECHO,
  ACT_REACH_PHASE_NEXUS,
  ACT_MASTER_ALL_PHASES,
]);

/** The objective strings (one per act; shown above the crosshair). */
export const ACT_OBJECTIVES = Object.freeze({
  [ACT_FIND_FIRST_ECHO]: 'Explore the world and collect your first Echo.',
  [ACT_REACH_PHASE_NEXUS]: 'Find the Phase Nexus biome and walk into it.',
  [ACT_MASTER_ALL_PHASES]: 'Unlock all 3 amplifiers. Place a Stabilizer.',
});

/** The completion predicates (run on every goal-state update). */
export function actCompleted(act, state) {
  const s = (state && typeof state === 'object') ? state : {};
  switch (act) {
    case ACT_FIND_FIRST_ECHO:
      return (s.collectedEchoCount || 0) >= 1;
    case ACT_REACH_PHASE_NEXUS:
      return s.hasVisitedPhaseNexus === true;
    case ACT_MASTER_ALL_PHASES:
      const amps = Array.isArray(s.amplifiers) ? s.amplifiers : [];
      const allAmps = ['amplifierAB', 'amplifierBG', 'amplifierAG']
        .every((a) => amps.includes(a));
      return allAmps && (s.stabilizerCount || 0) >= 1;
    default:
      return false;
  }
}

/** Get the current act (first incomplete one; null if all complete). */
export function currentAct(state) {
  for (const act of ACT_ORDER) {
    if (!actCompleted(act, state)) return act;
  }
  return null;
}

/** Get the current objective string (or "All complete!" if all done). */
export function currentObjective(state) {
  const act = currentAct(state);
  if (!act) return 'All complete — explore freely.';
  return ACT_OBJECTIVES[act] || 'Explore.';
}

/** Get the active objective color (green for active, gold for next). */
export function objectiveColor(state) {
  const act = currentAct(state);
  if (!act) return '#88ff88';
  return '#88ccff';
}

// ── Compass ────────────────────────────────────────────────────

/** §5.1: target kinds (which world marker the compass points to). */
export const TARGET_NEAREST_ECHO = 'nearestEcho';
export const TARGET_NEAREST_STABILIZER = 'nearestStabilizer';
export const TARGET_NEAREST_CORE = 'nearestCore';
export const TARGET_PHASE_NEXUS = 'phaseNexus';

/** A marker = `{ key: string, x: number, y: number, z: number }`. */
export function markerKey(x, y, z) {
  return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

/** Compute the compass bearing from playerPos to the nearest marker. */
export function compassBearing(playerPos, targetPos, yawRadians) {
  if (!playerPos || !targetPos) return null;
  if (!Number.isFinite(playerPos.x) || !Number.isFinite(targetPos.x)) return null;
  const dx = targetPos.x - playerPos.x;
  const dz = targetPos.z - playerPos.z;
  const worldAngle = Math.atan2(dx, dz); // 0 = north (+z), +pi/2 = east (+x)
  // Player's yaw is the look direction. We want to return the angle
  // relative to the player's look direction (in radians; 0 = on-screen
  // ahead, +pi/2 = right, -pi/2 = left).
  const playerYaw = Number.isFinite(yawRadians) ? yawRadians : 0;
  let rel = worldAngle - playerYaw;
  // Normalize to [-pi, pi]
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return rel;
}

/**
 * Find the nearest marker of a given kind from a list of marker
 * positions. Returns the marker (or null if list is empty).
 */
export function nearestMarker(playerPos, markers) {
  if (!Array.isArray(markers) || markers.length === 0) return null;
  if (!playerPos || !Number.isFinite(playerPos.x)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const m of markers) {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
    const dx = m.x - playerPos.x;
    const dz = m.z - playerPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist) {
      bestDist = d2;
      best = m;
    }
  }
  return best;
}

/** Compute the goal-state snapshot from player inventory + world state. */
export function buildGoalState(playerInventory, world, biomesVisited) {
  const inv = (playerInventory && typeof playerInventory === 'object') ? playerInventory : {};
  const w = world || {};
  const bv = (biomesVisited && typeof biomesVisited === 'object') ? biomesVisited : {};
  const echoes = Array.isArray(inv.collectedEchoes) ? inv.collectedEchoes : [];
  const amplifiers = Array.isArray(inv.amplifiers) ? inv.amplifiers : [];
  return {
    collectedEchoCount: echoes.length,
    amplifiers,
    hasVisitedPhaseNexus: !!bv.phaseNexus,
    stabilizerCount: (typeof w.getStabilizerCount === 'function')
      ? w.getStabilizerCount()
      : 0,
  };
}

export const GOAL_DEFAULTS = Object.freeze({
  acts: ACT_ORDER,
  objectives: ACT_OBJECTIVES,
  targetKinds: [TARGET_NEAREST_ECHO, TARGET_NEAREST_STABILIZER, TARGET_NEAREST_CORE, TARGET_PHASE_NEXUS],
});
