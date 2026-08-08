// Settings Manager - wraps localStorage persistence
export class SettingsManager {
  constructor() {
    this.defaults = {
      music: true,
      sfx: true,
      volume: 0.5,
      difficulty: 'normal',
      renderDistance: 4,
      renderMode: 'simple', // simple, advanced
    };
    this.settings = { ...this.defaults };
    this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem('phaseShifterSettings');
      if (saved) {
        this.settings = { ...this.defaults, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  save() {
    try {
      localStorage.setItem('phaseShifterSettings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  }

  get(key) { return this.settings[key]; }
  set(key, value) { this.settings[key] = value; this.save(); }
  getAll() { return { ...this.settings }; }
}
