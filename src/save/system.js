// Save/Load system using localStorage and IndexedDB
import { buildSettings, deserializeSettings, serializeSettings, SETTINGS_STORAGE_KEY, getSetting, setSetting } from '../settings/menu.js';

const SAVE_KEY = 'phaseshift_save';

export class SaveSystem {
  constructor() {
    this.db = null;
    this._initDB();
  }

  _initDB() {
    try {
      const request = indexedDB.open('phaseshift_db', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('world')) {
          db.createObjectStore('world');
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
      };
    } catch (e) {
      console.warn('IndexedDB not available, using localStorage');
    }
  }

  // Get current world seed
  getWorldSeed() {
    try {
      const data = localStorage.getItem(SAVE_KEY + '_meta');
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.seed || 42;
      }
    } catch (e) {}
    return 42;
  }

  /**
   * Phase 4.4: persist the full game state. Pass-through shape:
   * { seed, position, phase, energy, unlockedTools, biomesDiscovered,
   *   echoesFound, worldState, anchors, inventory, velocity, lookYaw,
   *   lookPitch, fatigue, timestamp }.
   * Back-compat: legacy §1.7 / §2.4 / §2.7 / §3.3 blobs without the
   * Phase 4.4 fields still load (the new fields default to safe
   * values via _normalizeState).
   */
  save(gameState) {
    const s = (gameState && typeof gameState === 'object') ? gameState : {};
    const pos = s.position || { x: 0, y: 20, z: 0 };
    const saveData = {
      seed: Number.isFinite(s.seed) ? s.seed : 42,
      position: { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 },
      phase: Number.isFinite(s.phase) ? s.phase : 0,
      energy: Number.isFinite(s.energy) ? s.energy : 100,
      unlockedTools: Array.isArray(s.unlockedTools) ? s.unlockedTools : [],
      biomesDiscovered: Array.isArray(s.biomesDiscovered) ? s.biomesDiscovered : [],
      echoesFound: Number.isFinite(s.echoesFound) ? s.echoesFound : 0,
      worldState: s.worldState || {},
      anchors: Array.isArray(s.anchors) ? s.anchors : [],
      fuses: Array.isArray(s.fuses) ? s.fuses : [],
      inventory: (s.inventory && typeof s.inventory === 'object') ? s.inventory : { collectedEchoes: [], amplifiers: [] },
      velocity: this._coerceVelocity(s.velocity),
      lookYaw: Number.isFinite(s.lookYaw) ? s.lookYaw : 0,
      lookPitch: Number.isFinite(s.lookPitch) ? s.lookPitch : 0,
      fatigue: Number.isFinite(s.fatigue) ? Math.max(0, Math.min(1, s.fatigue)) : 0,
      timestamp: Date.now(),
    };

    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));

      if (this.db) {
        const transaction = this.db.transaction(['world'], 'readwrite');
        const store = transaction.objectStore('world');
        store.put(saveData.worldState || {}, 'worldBlocks');
        store.put(saveData, 'gameState');
      }
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  // Load game state
  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn('Save failed to parse, returning fresh state:', e);
      }
      if (parsed && typeof parsed === 'object') {
        const normalized = this._normalizeState(parsed);
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(normalized)); } catch (e) {}
        return normalized;
      }
    }

    // Fallback to IndexedDB
    if (this.db) {
      return new Promise((resolve) => {
        const transaction = this.db.transaction(['world'], 'readonly');
        const store = transaction.objectStore('world');
        const req = store.get('gameState');
        req.onsuccess = () => resolve(this._normalizeState(req.result));
        req.onerror = () => resolve(this._getFreshState());
      });
    }

    const fresh = this._getFreshState();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  /**
   * Phase 4.4: normalize a save blob (defensive — fills in
   * missing fields with safe defaults). Preserves the velocity,
   * look angles, energy, and fatigue fields added in §4.4 so the
   * player can resume exactly where they left off.
   */
  _normalizeState(state) {
    if (!state || typeof state !== 'object') return this._getFreshState();
    const pos = state.position || {};
    return {
      seed: Number.isFinite(state.seed) ? state.seed : 42,
      position: {
        x: Number.isFinite(pos.x) ? pos.x : 0,
        y: Number.isFinite(pos.y) ? pos.y : 0,
        z: Number.isFinite(pos.z) ? pos.z : 0,
      },
      phase: Number.isFinite(state.phase) ? state.phase : 0,
      worldState: this._coerceWorldState(state.worldState),
      anchors: this._coerceAnchors(state.anchors),
      fuses: this._coerceFuses(state.fuses),
      inventory: this._coerceInventory(state.inventory),
      velocity: this._coerceVelocity(state.velocity),
      lookYaw: Number.isFinite(state.lookYaw) ? state.lookYaw : 0,
      lookPitch: Number.isFinite(state.lookPitch) ? state.lookPitch : 0,
      energy: Number.isFinite(state.energy) ? Math.max(0, state.energy) : 100,
      fatigue: Number.isFinite(state.fatigue) ? Math.max(0, Math.min(1, state.fatigue)) : 0,
      timestamp: Number.isFinite(state.timestamp) ? state.timestamp : Date.now(),
    };
  }

  _getFreshState() {
    return {
      seed: 42,
      position: { x: 0, y: 20, z: 0 },
      phase: 0,
      energy: 100,
      unlockedTools: [],
      biomesDiscovered: [],
      echoesFound: 0,
      worldState: {},
      anchors: [],
      fuses: [],
      inventory: { collectedEchoes: [], amplifiers: [] },
      velocity: null,
      lookYaw: 0,
      lookPitch: 0,
      fatigue: 0,
      timestamp: Date.now(),
    };
  }

  // Save specific world block changes
  saveWorldBlocks(worldBlocks) {
    if (this.db) {
      const transaction = this.db.transaction(['world'], 'readwrite');
      const store = transaction.objectStore('world');
      store.put(worldBlocks, 'worldBlocks');
    }
  }

  // Load world blocks
  loadWorldBlocks() {
    return new Promise((resolve) => {
      if (this.db) {
        const transaction = this.db.transaction(['world'], 'readonly');
        const store = transaction.objectStore('world');
        const req = store.get('worldBlocks');
        req.onsuccess = () => resolve(req.result || {});
        req.onerror = () => resolve({});
      } else {
        resolve({});
      }
    });
  }

  // Delete save
  deleteSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      if (this.db) {
        const transaction = this.db.transaction(['world'], 'readwrite');
        const store = transaction.objectStore('world');
        store.delete('gameState');
        store.delete('worldBlocks');
      }
    } catch (e) {}
  }

  // Check if save exists
  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return false;
    }
  }

  /**
   * Phase 4.4: periodic autosave (every 30 seconds). The
   * `gameState` argument is the current game state object (same
   * shape as `save()`). The interval is idempotent — calling
   * `autoSave()` again cancels the prior interval. The §4.4
   * acceptance: "periodic autosave (every 30s)".
   */
  autoSave(gameState) {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
    this._autoSaveState = gameState;
    this._autoSaveTimer = setInterval(() => {
      if (!this._autoSaveState) return;
      try {
        this.save(this._autoSaveState);
      } catch (e) {}
    }, 30000);
    return this._autoSaveTimer;
  }

  /** Phase 4.4: stop the autosave interval (if any). */
  stopAutoSave() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
    this._autoSaveState = null;
    return true;
  }

  // ── Phase 1.6 unified save API ────────────────────────────────────

  /**
   * Serialize the current player position and phase, then persist it.
   * Returns the saved state object for tests.
   */
  saveGame(x, y, z, phase, extra) {
    // Phase 2.7: anchors are passed through `extra.anchors` (the
    // canonical save shape is { worldState, anchors } from the §1.7
    // and §2.7 save blobs). Back-compat: a §1.7 / §2.4 save without
    // anchors still loads cleanly (anchors defaults to an empty array).
    const state = {
      seed: this.getWorldSeed(),
      position: { x, y, z },
      phase,
      timestamp: Date.now(),
      ...(extra || {}),
    };
    if (!('anchors' in state)) state.anchors = [];
    this.save(state);
    return state;
  }

  /**
   * Persist the full game snapshot: player position, phase, and the world
   * block memory produced by World.exportGlobalState(). The snapshot
   * survives across reloads via loadGame().
   */
  /**
   * Phase 4.4: persist the full game snapshot (player position,
   * phase, world block memory, anchors, inventory, velocity, look
   * angles, energy, fatigue). The snapshot survives across
   * reloads via loadGame().
   *
   * The `extras` parameter is an optional object with:
   *   - velocity: { x, y, z }
   *   - lookYaw: number (radians)
   *   - lookPitch: number (radians)
   *   - energy: number (0..max)
   *   - fatigue: number (0..1)
   * Back-compat: missing keys default to safe values (the §4.4
   * acceptance: "the player can save, quit, reload, and resume
   * exactly where they left off").
   */
  saveSnapshot(x, y, z, phase, worldState, anchors, inventory, extras, fuses) {
    const e = (extras && typeof extras === 'object') ? extras : {};
    return this.saveGame(x, y, z, phase, {
      worldState: worldState || {},
      anchors: this._coerceAnchors(anchors),
      inventory: this._coerceInventory(inventory),
      velocity: this._coerceVelocity(e.velocity),
      lookYaw: Number.isFinite(e.lookYaw) ? e.lookYaw : 0,
      lookPitch: Number.isFinite(e.lookPitch) ? e.lookPitch : 0,
      energy: Number.isFinite(e.energy) ? Math.max(0, e.energy) : 100,
      fatigue: Number.isFinite(e.fatigue) ? Math.max(0, Math.min(1, e.fatigue)) : 0,
      fuses: this._coerceFuses(fuses),
    });
  }

  /** Phase 10.2: coerce the fuse list from a save blob. Defensive —
   * rejects non-arrays, non-finite / non-integer / out-of-range phase
   * values so a tampered save can't poison the world. Mirrors
   * `_coerceAnchors` for the fuse shape: `{ x, y, z, phase }`.
   * Missing / null / non-array input returns an empty array
   * (back-compat with §1.7 / §2.4 / §2.7 / §4.4 blobs that don't
   * include fuses). */
  _coerceFuses(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const x = entry.x;
      const y = entry.y;
      const z = entry.z;
      const phase = entry.phase;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!Number.isInteger(phase) || phase < 0 || phase > 2) continue;
      out.push({
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z),
        phase,
      });
    }
    return out;
  }

  /** Phase 4.4: coerce velocity { x, y, z } (defensive — returns null on bad input). */
  _coerceVelocity(value) {
    if (!value || typeof value !== 'object') return null;
    const x = value.x, y = value.y, z = value.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z };
  }

  /**
   * Apply a previously persisted state. Returns the state object (or null).
   * Phase is coerced to a finite number and position values are coerced so
   * callers receive a stable shape.
   */
  loadGame() {
    const raw = this.load();
    if (!raw) return null;
    const pos = raw.position || {};
    const stamp = Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now();
    return {
      seed: Number.isFinite(raw.seed) ? raw.seed : 42,
      phase: Number.isFinite(raw.phase) ? raw.phase : 0,
      position: {
        x: Number.isFinite(pos.x) ? pos.x : 0,
        y: Number.isFinite(pos.y) ? pos.y : 0,
        z: Number.isFinite(pos.z) ? pos.z : 0,
      },
      worldState: this._coerceWorldState(raw.worldState),
      anchors: this._coerceAnchors(raw.anchors),
      inventory: this._coerceInventory(raw.inventory),
      fuses: this._coerceFuses(raw.fuses),
      velocity: this._coerceVelocity(raw.velocity),
      lookYaw: Number.isFinite(raw.lookYaw) ? raw.lookYaw : 0,
      lookPitch: Number.isFinite(raw.lookPitch) ? raw.lookPitch : 0,
      energy: Number.isFinite(raw.energy) ? raw.energy : 100,
      fatigue: Number.isFinite(raw.fatigue) ? raw.fatigue : 0,
      timestamp: stamp,
    };
  }

  _coerceWorldState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, blockId] of Object.entries(value)) {
      // Phase 2.4: BLOCK_AIR (id 0) is a valid value — a player break
      // is a real edit and the snapshot is the canonical truth on load.
      // We still reject NaN / Infinity / fractional / negative ids
      // (those are tampered-blob garbage), and non-numbers.
      if (typeof blockId !== 'number' || !Number.isFinite(blockId)) continue;
      if (!Number.isInteger(blockId) || blockId < 0) continue;
      out[key] = blockId;
    }
    return out;
  }

  /**
   * Phase 2.7: coerce the anchor list from a save blob. Defensive —
   * rejects non-arrays, non-finite / non-integer / out-of-range ids
   * so a tampered save can't poison the world. Mirrors
   * `_coerceWorldState` (Phase 2.4) but for the anchor shape:
   *   `{ x, y, z, phase, remaining }` per entry.
   *
   * Phase ranges 0–2 (PHASE_ALPHA–PHASE_GAMMA). Remaining ranges
   * 0–ANCHOR_LIFETIME (clamped). Missing / null / non-array input
   * returns an empty array (back-compat with §1.7 / §2.4 blobs
   * that don't include anchors).
   */
  _coerceAnchors(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const x = entry.x;
      const y = entry.y;
      const z = entry.z;
      const phase = entry.phase;
      const remaining = entry.remaining;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!Number.isInteger(phase) || phase < 0 || phase > 2) continue;
      if (!Number.isFinite(remaining) || remaining < 0) continue;
      out.push({
        x: Math.floor(x),
        y: Math.floor(y),
        z: Math.floor(z),
        phase,
        remaining: Math.min(10, remaining), // ANCHOR_LIFETIME = 10
      });
    }
    return out;
  }


  /**
   * Phase 3.3: coerce the inventory from a save blob. Defensive —
   * rejects non-objects, malformed collectedEchoes entries, and
   * malformed amplifier names so a tampered save can't poison the
   * inventory. Mirrors `_coerceAnchors` for the inventory shape:
   *   { collectedEchoes: [{ key, lore }], amplifiers: [name] }.
   *
   * Missing / null / non-object input returns a fresh empty
   * inventory (back-compat with §1.7 / §2.4 / §2.7 blobs that
   * don't include inventory).
   */
  _coerceInventory(value) {
    const fresh = { collectedEchoes: [], amplifiers: [] };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fresh;
    const echoes = Array.isArray(value.collectedEchoes) ? value.collectedEchoes : [];
    const filtered = [];
    for (const e of echoes) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.key !== 'string' || e.key.length === 0) continue;
      const lore = typeof e.lore === 'string' ? e.lore : '';
      filtered.push({ key: e.key, lore });
    }
    const amps = Array.isArray(value.amplifiers) ? value.amplifiers : [];
    const filteredAmps = [];
    for (const a of amps) {
      if (typeof a !== 'string' || a.length === 0) continue;
      filteredAmps.push(a);
    }
    return { collectedEchoes: filtered, amplifiers: filteredAmps };
  }

  /** Human-readable timestamp of the most recent save, or null. */
  getLastSaveInfo() {
    const data = this._readRaw();
    if (!data || !Number.isFinite(data.timestamp)) return null;
    return new Date(data.timestamp).toLocaleString();
  }

  _readRaw() {
    try {
      const data = localStorage.getItem(SAVE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }
}

// ── Phase 4.2 ──────────────────────────────────────────────────
// Settings management. The new settings module
// (src/settings/menu.js) owns the canonical defaults + the
// validation helpers; this class is the persistence layer.
// localStorage key is `phaseshift_settings_v1` (the §4.2
// "single key" contract).
export class Settings {
  constructor() {
    this.settings = this._load();
    this._autoSave = getSetting(this.settings, 'autosave');
  }

  _load() {
    try {
      const data = (typeof localStorage !== 'undefined')
        ? localStorage.getItem(SETTINGS_STORAGE_KEY)
        : null;
      if (typeof data === 'string' && data.length > 0) {
        return deserializeSettings(data);
      }
    } catch (e) {}
    return buildSettings();
  }

  _save() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(this.settings));
      }
    } catch (e) {}
  }

  // ── Phase 4.2 setters/getters (typed, validated, persisted) ──

  get(key) {
    return getSetting(this.settings, key);
  }

  set(key, value) {
    this.settings = setSetting(this.settings, key, value);
    this._save();
    return this.settings[key];
  }

  getAll() { return { ...this.settings }; }

  /** Convenience: mouse sensitivity in radians per pixel. */
  getMouseSensitivity() {
    return getSetting(this.settings, 'mouseSensitivity');
  }

  /** Convenience: render distance in chunks (clamped 1..5). */
  getRenderDistance() {
    return getSetting(this.settings, 'renderDistance');
  }

  /** Convenience: master volume (0..1). */
  getMasterVolume() {
    return getSetting(this.settings, 'masterVolume');
  }

  /** Convenience: HUD opacity (0..1). */
  getHudOpacity() {
    return getSetting(this.settings, 'hudOpacity');
  }

  /** Phase 4.2: autosave enabled (persists to localStorage). */
  getAutoSave() {
    return Boolean(getSetting(this.settings, 'autosave'));
  }

  setAutoSave(enabled) {
    this.settings = setSetting(this.settings, 'autosave', Boolean(enabled));
    this._autoSave = Boolean(enabled);
    this._save();
    return this._autoSave;
  }

  /** Phase 4.2: reduced-motion (persists). */
  getReducedMotion() { return Boolean(getSetting(this.settings, 'reducedMotion')); }
  setReducedMotion(enabled) {
    this.settings = setSetting(this.settings, 'reducedMotion', Boolean(enabled));
    this._save();
    return Boolean(enabled);
  }
}
