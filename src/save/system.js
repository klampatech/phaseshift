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
    try {
      // Try localStorage first
      const data = localStorage.getItem(SAVE_KEY);
      if (data) {
        return JSON.parse(data);
      }

      // Fallback to IndexedDB
      if (this.db) {
        return new Promise((resolve) => {
          const transaction = this.db.transaction(['world'], 'readonly');
          const store = transaction.objectStore('world');
          const req = store.get('gameState');
          req.onsuccess = () => resolve(req.result || this._getFreshState());
          req.onerror = () => resolve(this._getFreshState());
        });
      }
    } catch (e) {
      console.warn('Load failed:', e);
    }

    return this._getFreshState();
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
