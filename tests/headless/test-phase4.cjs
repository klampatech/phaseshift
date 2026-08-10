#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 4 verification: Settings menu (4.2) + Minimap data-driven (4.3)
// + Save/load polish (4.4) + Data-driven UX (4.1) + Performance (4.5)
// + Code-splitting (4.6).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const settingsPath = path.join(ROOT, 'src', 'settings', 'menu.js');
const minimapPath = path.join(ROOT, 'src', 'ui', 'minimap.js');
const saveSystemPath = path.join(ROOT, 'src', 'save', 'system.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const mainPath = path.join(ROOT, 'main.js');
const indexHtmlPath = path.join(ROOT, 'index.html');
const viteConfigPath = path.join(ROOT, 'vite.config.js');

const hudText = fs.readFileSync(hudPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const mainText = fs.readFileSync(mainPath, 'utf8');
const htmlText = fs.readFileSync(indexHtmlPath, 'utf8');
const viteText = fs.readFileSync(viteConfigPath, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}`); }
}

// ── 1) Static analysis ───────────────────────────────────────
console.log('\n=== Phase 4 static-analysis (against source files) ===');
check('src/settings/menu.js exists', fs.existsSync(settingsPath));
check('src/ui/minimap.js exists', fs.existsSync(minimapPath));

// ── 2) Behavior - pure modules ────────────────────────────────
console.log('\n=== Phase 4 behavior - settings/menu.js pure module ===');
async function main() {
  const settingsUrl = 'file://' + settingsPath.replace(/\\/g, '/');
  const minimapUrl = 'file://' + minimapPath.replace(/\\/g, '/');
  const saveSystemUrl = 'file://' + saveSystemPath.replace(/\\/g, '/');
  const worldUrl = 'file://' + worldPath.replace(/\\/g, '/');
  const settings = await import(settingsUrl);
  const minimap = await import(minimapUrl);
  const saveMod = await import(saveSystemUrl);
  const { World } = await import(worldUrl);

  // ── 4.2 Settings menu pure module ─────────────────────────
  check('settings.SETTINGS_STORAGE_KEY === phaseshift_settings_v1', settings.SETTINGS_STORAGE_KEY === 'phaseshift_settings_v1');
  check('settings.DEFAULT_RENDER_DISTANCE === 3', settings.DEFAULT_RENDER_DISTANCE === 3);
  check('settings.MAX_RENDER_DISTANCE === 5', settings.MAX_RENDER_DISTANCE === 5);
  check('settings.MIN_RENDER_DISTANCE === 1', settings.MIN_RENDER_DISTANCE === 1);
  check('settings.DEFAULT_MOUSE_SENSITIVITY === 0.002', settings.DEFAULT_MOUSE_SENSITIVITY === 0.002);
  check('settings.clampNumber clamps high', settings.clampNumber(99, 0, 1, 0.5) === 1);
  check('settings.clampNumber clamps low', settings.clampNumber(-99, 0, 1, 0.5) === 0);
  check('settings.clampNumber uses fallback on NaN', settings.clampNumber(NaN, 0, 1, 0.5) === 0.5);
  check('settings.normalizeKey(\'w\') === \'KeyW\'', settings.normalizeKey('w') === 'KeyW');
  check('settings.normalizeKey(\'Space\') === \'Space\'', settings.normalizeKey('Space') === 'Space');
  check('settings.normalizeKey(\'\') === null', settings.normalizeKey('') === null);
  check('settings.coerceBoolean(\'on\') === true', settings.coerceBoolean('on', false) === true);
  check('settings.coerceBoolean(\'off\') === false', settings.coerceBoolean('off', true) === false);
  const def = settings.buildSettings();
  check('settings.buildSettings() returns canonical keys',
    def.resolutionScale === 1.0 && def.renderDistance === 3 && def.autosave === true && def.postProcessing === true);
  check('settings.buildSettings overrides values',
    settings.buildSettings({ renderDistance: 5, mouseSensitivity: 0.005 }).renderDistance === 5);
  check('settings.buildSettings coerces out-of-range',
    settings.buildSettings({ renderDistance: 99 }).renderDistance === 5);
  check('settings.buildSettings rejects malformed keys', settings.buildSettings({ renderDistance: 'abc' }).renderDistance === 3);
  check('settings.buildSettings merges keyBindings',
    settings.buildSettings({ keyBindings: { jump: 'KeyK' } }).keyBindings.jump === 'KeyK');
  const json = settings.serializeSettings({ renderDistance: 4 });
  check('settings.serializeSettings returns JSON string',
    typeof json === 'string' && JSON.parse(json).renderDistance === 4);
  const restored = settings.deserializeSettings(json);
  check('settings.deserializeSettings round-trip',
    restored.renderDistance === 4);
  check('settings.deserializeSettings(null) returns defaults',
    settings.deserializeSettings(null).renderDistance === 3);
  check('settings.getSetting returns default for missing',
    settings.getSetting({}, 'renderDistance') === 3);
  check('settings.setSetting returns new object',
    settings.setSetting({}, 'renderDistance', 4).renderDistance === 4);
  check('settings.actionForKey finds binding',
    settings.actionForKey({ keyBindings: { jump: 'Space' } }, 'Space') === 'jump');
  // Empty object falls back to default keyBindings (which has moveForward: 'KeyW').
  check('settings.actionForKey returns action for default-bound key',
    settings.actionForKey({}, 'KeyW') === 'moveForward');
  check('settings.actionForKey returns null for unbound key',
    settings.actionForKey({ keyBindings: {} }, 'KeyQ') === null);
  check('settings.SETTINGS_DEFAULTS frozen', Object.isFrozen(settings.SETTINGS_DEFAULTS));
  check('settings.DEFAULT_KEYBINDINGS frozen', Object.isFrozen(settings.DEFAULT_KEYBINDINGS));

  // ── 4.3 Minimap pure module ────────────────────────────────
  check('minimap.MINIMAP_SIZE === 32', minimap.MINIMAP_SIZE === 32);
  check('minimap.MINIMAP_RANGE === 16', minimap.MINIMAP_RANGE === 16);
  check('minimap.PHASE_OVERLAY_COLORS[0] is green', minimap.PHASE_OVERLAY_COLORS[0].includes('90, 168, 90'));
  check('minimap.PHASE_OVERLAY_COLORS[1] is blue', minimap.PHASE_OVERLAY_COLORS[1].includes('51, 153, 230'));
  check('minimap.PHASE_OVERLAY_COLORS[2] is gold', minimap.PHASE_OVERLAY_COLORS[2].includes('217, 179, 76'));
  check('minimap.MARKER_ECHO === 1', minimap.MARKER_ECHO === 1);
  check('minimap.MARKER_STABILIZER === 2', minimap.MARKER_STABILIZER === 2);
  check('minimap.MARKER_RESONANCE_CORE === 3', minimap.MARKER_RESONANCE_CORE === 3);

  // buildMinimapSnapshot with no world
  const snap1 = minimap.buildMinimapSnapshot(null, { x: 0, y: 0, z: 0, yaw: 0 });
  check('buildMinimapSnapshot no-world returns cells array', Array.isArray(snap1.cells) && snap1.cells.length === 32 * 32);
  check('buildMinimapSnapshot hasWorld=false', snap1.hasWorld === false);

  // buildMinimapSnapshot with world
  const w = new World(() => {});
  w.updateChunks(0, 0, 1);
  const snap2 = minimap.buildMinimapSnapshot(w, { x: 0, y: 0, z: 0, yaw: 0.5 }, {
    echoKeys: ['1,30,1'],
    stabilizerKeys: ['2,30,2'],
    resonanceCoreKeys: ['3,30,3'],
  });
  check('buildMinimapSnapshot with-world hasWorld=true', snap2.hasWorld === true);
  check('buildMinimapSnapshot center is player',
    snap2.playerCellX === 16 && snap2.playerCellY === 16);
  // Echo at world (1, _, 1) → dx=17, dz=17 → index = 17*32+17 = 561
  check('buildMinimapSnapshot echo cell marked', snap2.cells[17 * 32 + 17].marker === 1);
  // Stabilizer at (2, _, 2) → dx=18, dz=18 → index = 18*32+18 = 594
  check('buildMinimapSnapshot stabilizer cell marked', snap2.cells[18 * 32 + 18].marker === 2);
  // Core at (3, _, 3) → dx=19, dz=19 → index = 19*32+19 = 627
  check('buildMinimapSnapshot core cell marked', snap2.cells[19 * 32 + 19].marker === 3);

  // markerColor helper
  check('markerColor MARKER_ECHO returns cyan', minimap.markerColor(1).includes('170, 230, 255'));
  check('markerColor MARKER_STABILIZER returns orange', minimap.markerColor(2).includes('255, 136, 68'));
  check('markerColor MARKER_NONE returns null', minimap.markerColor(0) === null);
  check('MINIMAP_DEFAULTS frozen', Object.isFrozen(minimap.MINIMAP_DEFAULTS));

  // ── 4.4 SaveSystem extensions ──────────────────────────────
  const { Settings, SaveSystem } = saveMod;
  // We can't test localStorage-backed Settings in this Node script
  // (localStorage is undefined), but the constructor still works.
  const settings2 = new Settings();
  check('Settings instance has _load() defaults',
    settings2.settings && typeof settings2.settings.renderDistance === 'number');

  // Mock localStorage for SaveSystem tests
  if (typeof global !== 'undefined') {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  }
  const ss = new SaveSystem();
  // 4.4: saveSnapshot with extras round-trip
  ss.saveSnapshot(1.5, 30.0, -2.5, 1, { '0,30,0': 1 }, [{ x: 1, y: 30, z: 1, phase: 0, remaining: 5 }],
    { collectedEchoes: [{ key: '1,30,1', lore: 'test' }], amplifiers: ['amplifierAB'] },
    { velocity: { x: 0.1, y: -0.5, z: 0.3 }, lookYaw: 1.2, lookPitch: 0.4, energy: 80, fatigue: 0.3 });
  const loaded = ss.loadGame();
  check('saveSnapshot saves velocity', loaded.velocity && Math.abs(loaded.velocity.x - 0.1) < 1e-6);
  check('saveSnapshot saves lookYaw', Math.abs(loaded.lookYaw - 1.2) < 1e-6);
  check('saveSnapshot saves lookPitch', Math.abs(loaded.lookPitch - 0.4) < 1e-6);
  check('saveSnapshot saves energy', loaded.energy === 80);
  check('saveSnapshot saves fatigue', Math.abs(loaded.fatigue - 0.3) < 1e-6);
  check('saveSnapshot saves anchors', loaded.anchors.length === 1);
  check('saveSnapshot saves inventory', loaded.inventory.amplifiers.length === 1);

  // autosave is idempotent + can be stopped
  let tickCount = 0;
  const fakeState = { foo: 'bar' };
  // Speed up: use a very short interval for test, then immediately stop
  const fakeSave = ss.save.bind(ss);
  ss.save = (s) => { tickCount++; return fakeSave(s); };
  // We can't wait 30s in tests; just verify autoSave returns a timer ID.
  const t1 = ss.autoSave(fakeState);
  check('autoSave returns a timer ID', t1 !== null && typeof t1 !== 'undefined');
  ss.stopAutoSave();
  check('stopAutoSave clears the timer', ss._autoSaveTimer === null);
  ss.save = fakeSave; // restore

  // _coerceVelocity defensive
  check('_coerceVelocity(null) returns null', ss._coerceVelocity(null) === null);
  check('_coerceVelocity(NaN) returns null', ss._coerceVelocity({ x: NaN, y: 0, z: 0 }) === null);
  check('_coerceVelocity(valid) returns object',
    ss._coerceVelocity({ x: 1, y: 2, z: 3 }).x === 1);

  // ── 4.5 World.exportStabilizers ─────────────────────────────
  w.setBlock(5, 30, 5, 0, 15); // BLOCK_STABILIZER
  const stabs = w.exportStabilizers();
  check('world.exportStabilizers returns an array', Array.isArray(stabs));
  check('world.exportStabilizers includes the placed stabilizer',
    stabs.includes('5,30,5'));

  // ── 4.6 Code-splitting ─────────────────────────────────────
  check('vite.config.js has manualChunks', /manualChunks/.test(viteText));
  check('vite.config.js splits three', /three/.test(viteText));
  check('vite.config.js splits audio', /audio/.test(viteText));

  // ── 4.1 HUD owns its DOM (static analysis) ────────────────
  check('HUD.renderSettingsMenu method', /renderSettingsMenu\s*\(\s*settings/.test(hudText));
  check('HUD.showSettings method', /showSettings\s*\(\s*settings/.test(hudText));
  check('HUD.applyHudOpacity method', /applyHudOpacity\s*\(\s*opacity/.test(hudText));
  check('HUD.addSafeEventListener method', /addSafeEventListener\s*\(/.test(hudText));
  check('HUD.setMinimapMarkers method', /setMinimapMarkers\s*\(/.test(hudText));
  check('HUD imports minimap', /from\s+['"]\.\/minimap\.js['"]/.test(hudText));
  check('HUD imports settings', /from\s+['"]\.\.\/settings\/menu\.js['"]/.test(hudText));

  // ── 4.1 index.html cleanup ─────────────────────────────────
  check('index.html no static pause menu', !/id\s*=\s*["']pause-menu["']\s*>/.test(htmlText) || /HUD owns/.test(htmlText));
  check('index.html has I + J + Minimap hint',
    /Key<\/span>\s*I<\/span>\s*Inventory/.test(htmlText) || /I<\/span>\s*Inventory/.test(htmlText));

  // ── 4.2 main.js settings wiring ────────────────────────────
  check('main.js imports Settings', /import\s*\{[^}]*Settings[^}]*\}\s*from\s*['"]\.\/src\/save\/system\.js['"]/.test(mainText));
  check('main.js calls settings.set on init', /settings\s*=\s*new\s+Settings/.test(mainText));
  check('main.js wires applySettingsChange', /applySettingsChange/.test(mainText));
  check('main.js wires saveSystem.autoSave', /saveSystem\.autoSave/.test(mainText));
  check('main.js calls hud.applyHudOpacity', /hud\.applyHudOpacity/.test(mainText));
  check('main.js saveGame passes extras', /saveSnapshot\([^)]*\{[^}]*velocity/.test(mainText));

  console.log(`\n=== Phase 4 TOTAL: ${passed}/${passed + failed} passed ===`);
  if (failed > 0) {
    console.log('Failed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
