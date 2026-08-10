// Save/Load system using localStorage and IndexedDB

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

  // Save game state
  save(gameState) {
    const saveData = {
      seed: gameState.seed,
      position: { x: gameState.position.x, y: gameState.position.y, z: gameState.position.z },
      phase: gameState.phase,
      energy: gameState.energy,
      unlockedTools: gameState.unlockedTools || [],
      biomesDiscovered: gameState.biomesDiscovered || [],
      echoesFound: gameState.echoesFound || 0,
      worldState: gameState.worldState, // Block changes
      // Phase 2.7: include the anchor list in the save blob so placed
      // anchors survive a save → reload round-trip. The §1.7 / §2.4
      // save blob (without `anchors`) is still loadable — _normalizeState
      // defaults anchors to an empty array.
      anchors: Array.isArray(gameState.anchors) ? gameState.anchors : [],
      timestamp: Date.now(),
    };

    try {
      // localStorage for simple data
      localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));

      // IndexedDB for larger world state
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
      inventory: this._coerceInventory(state.inventory),
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
      inventory: { collectedEchoes: [], amplifiers: [] },
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

  // Auto-save interval (every 30 seconds)
  autoSave(gameState) {
    setInterval(() => this.save(gameState), 30000);
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
  saveSnapshot(x, y, z, phase, worldState, anchors, inventory) {
    return this.saveGame(x, y, z, phase, {
      worldState: worldState || {},
      anchors: this._coerceAnchors(anchors),
      inventory: this._coerceInventory(inventory),
    });
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

// Settings management
export class Settings {
  constructor() {
    this.settings = this._load();
  }

  _load() {
    try {
      const data = localStorage.getItem('phaseshift_settings');
      if (data) return JSON.parse(data);
    } catch (e) {}
    return this._defaultSettings();
  }

  _defaultSettings() {
    return {
      volume: 0.5,
      musicVolume: 0.3,
      sfxVolume: 0.4,
      renderDistance: 4,
      postProcessing: true,
      controls: {
        mouseSensitivity: 0.002,
        keyBindings: {},
      },
    };
  }

  get(key) { return this.settings[key]; }
  set(key, value) { this.settings[key] = value; this._save(); }
  getAll() { return { ...this.settings }; }
  _save() {
    try {
      localStorage.setItem('phaseshift_settings', JSON.stringify(this.settings));
    } catch (e) {}
  }
}
