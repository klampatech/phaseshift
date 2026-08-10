/**
 * Phase Shifter - Player Inventory (Phase 3.3)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * per-frame pickup tick in main.js and the save/load round-trip
 * both delegate to the helpers here so the inventory shape is
 * canonical.
 *
 * The §3.3 brief calls for:
 *   - a `collectedEchoes` map (key -> lore string) so the player
 *     can read the lore again later
 *   - an `amplifiers` set (Phase 3.4 wires this up; the §3.3
 *     helper just owns the shape)
 *   - idempotent addEcho (re-collecting is a no-op so the player
 *     can't accidentally double-credit an Echo)
 *   - serialize/deserialize so the inventory survives save/load
 *
 * The state is intentionally tiny: just two collections. The
 * World already owns the position map (and rebuilds it from the
 * save), so the inventory only needs to remember the collected
 * keys + the lore strings (for the lore toast re-display on
 * hover).
 */
import { ECHO_LORE_LIBRARY } from '../collect/echo.js';

// - State factory -

/**
 * Create a fresh inventory. The shape is:
 *   {
 *     collectedEchoes: Map<string, string>,  // key -> lore
 *     amplifiers: Set<string>,              // amplifier names
 *   }
 *
 * Defensive: callers that pass an existing inventory get the same
 * shape back (a no-op re-init). This lets main.js call
 * `createInventory(_inventory)` safely on every reload without
 * resetting collected Echoes.
 */
export function createInventory(existing) {
  if (existing && typeof existing === 'object'
      && existing.collectedEchoes instanceof Map
      && existing.amplifiers instanceof Set) {
    return existing;
  }
  return {
    collectedEchoes: new Map(),
    amplifiers: new Set(),
  };
}

// - Echo helpers -

/**
 * Add an Echo to the inventory. Idempotent: re-collecting the same
 * key is a no-op (the lore string is NOT overwritten - the first
 * collection wins, so reloads show the same lore per Echo).
 *
 * Inputs:
 *   - `inv`: the inventory state (from `createInventory`).
 *   - `key`: the Echo key (the canonical "x,y,z" string).
 *   - `lore`: the lore string the player sees on pickup.
 *
 * Returns `true` if the Echo was newly added, `false` if it was
 * already collected (the caller uses this to drive the lore toast
 * + HUD counter edge detection).
 */
export function addEcho(inv, key, lore) {
  if (!inv || !(inv.collectedEchoes instanceof Map)) return false;
  if (typeof key !== 'string' || key.length === 0) return false;
  if (inv.collectedEchoes.has(key)) return false;
  inv.collectedEchoes.set(key, typeof lore === 'string' ? lore : ECHO_LORE_LIBRARY[0]);
  return true;
}

/**
 * `true` if the player has already collected the Echo at `key`.
 */
export function hasEcho(inv, key) {
  if (!inv || !(inv.collectedEchoes instanceof Map)) return false;
  if (typeof key !== 'string') return false;
  return inv.collectedEchoes.has(key);
}

/**
 * Return the inventory's collected Echoes as an array of
 * `{ key, lore }` objects (the shape the save blob expects).
 * Returns `[]` if the inventory is missing or invalid.
 */
export function listEchoes(inv) {
  if (!inv || !(inv.collectedEchoes instanceof Map)) return [];
  const out = [];
  for (const [key, lore] of inv.collectedEchoes.entries()) {
    out.push({ key, lore });
  }
  return out;
}

/**
 * Remove an Echo from the inventory. Returns `true` if the Echo
 * was removed, `false` if it wasn't there (the caller uses this
 * to drive the lore toast + HUD counter edge detection on a
 * removal, e.g. for the test reset path).
 */
export function removeEcho(inv, key) {
  if (!inv || !(inv.collectedEchoes instanceof Map)) return false;
  if (typeof key !== 'string') return false;
  return inv.collectedEchoes.delete(key);
}

// - Amplifier helpers -

/**
 * Add an amplifier to the inventory. Idempotent: adding the same
 * name twice is a no-op. The Phase 3.4 work uses this to unlock
 * the AB / BG / AG amplifiers from Resonance Core pickups.
 *
 * Returns `true` if the amplifier was newly added, `false` if it
 * was already present.
 */
export function addAmplifier(inv, name) {
  if (!inv || !(inv.amplifiers instanceof Set)) return false;
  if (typeof name !== 'string' || name.length === 0) return false;
  if (inv.amplifiers.has(name)) return false;
  inv.amplifiers.add(name);
  return true;
}

/**
 * `true` if the player has the named amplifier. Phase 3.4 wires
 * this into the phase-shift cost reduction.
 */
export function hasAmplifier(inv, name) {
  if (!inv || !(inv.amplifiers instanceof Set)) return false;
  if (typeof name !== 'string') return false;
  return inv.amplifiers.has(name);
}

// - Serialize / Deserialize -

/**
 * Serialize the inventory to a plain object (the save blob
 * shape). The shape is:
 *   {
 *     collectedEchoes: Array<{ key, lore }>,
 *     amplifiers: Array<string>,
 *   }
 *
 * The arrays are JSON-safe (no Map / Set). The save system
 * embeds this directly under the `inventory` key in the player
 * state blob.
 */
export function serialize(inv) {
  if (!inv || !(inv.collectedEchoes instanceof Map)) {
    return { collectedEchoes: [], amplifiers: [] };
  }
  return {
    collectedEchoes: listEchoes(inv),
    amplifiers: Array.from(inv.amplifiers || []),
  };
}

/**
 * Deserialize a save-blob snapshot back into an inventory. The
 * inverse of `serialize`. Defensive:
 *   - missing / null snapshot returns a fresh inventory
 *   - non-array `collectedEchoes` defaults to []
 *   - non-array `amplifiers` defaults to []
 *   - per-entry malformed data is skipped (non-string keys,
 *     non-string lores, non-string amplifier names)
 */
export function deserialize(snapshot) {
  const inv = createInventory();
  if (!snapshot || typeof snapshot !== 'object') return inv;
  const echoes = Array.isArray(snapshot.collectedEchoes) ? snapshot.collectedEchoes : [];
  for (const entry of echoes) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.key !== 'string' || entry.key.length === 0) continue;
    const lore = typeof entry.lore === 'string' ? entry.lore : ECHO_LORE_LIBRARY[0];
    inv.collectedEchoes.set(entry.key, lore);
  }
  const amps = Array.isArray(snapshot.amplifiers) ? snapshot.amplifiers : [];
  for (const name of amps) {
    if (typeof name !== 'string' || name.length === 0) continue;
    inv.amplifiers.add(name);
  }
  return inv;
}

// - Convenience getters -

/**
 * Return the count of collected Echoes. Useful for the HUD
 * counter (`ECHOES: X / Y`) and the test assertions.
 */
export function collectedCount(inv) {
  if (!inv || !(inv.collectedEchoes instanceof Map)) return 0;
  return inv.collectedEchoes.size;
}

/**
 * Return the count of unlocked amplifiers. Useful for the HUD
 * counter (Phase 3.4) and the test assertions.
 */
export function amplifierCount(inv) {
  if (!inv || !(inv.amplifiers instanceof Set)) return 0;
  return inv.amplifiers.size;
}
