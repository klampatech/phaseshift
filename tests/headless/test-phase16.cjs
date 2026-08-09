#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.6 verification: SaveSystem unified API and main.js centralization.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const savePath = path.join(ROOT, 'src', 'save', 'system.js');
const mainPath = path.join(ROOT, 'main.js');
const saveText = fs.readFileSync(savePath, 'utf8');
const mainText = fs.readFileSync(mainPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 1.6 source checks ===');
  check('SaveSystem.saveGame(x, y, z, phase) defined', /saveGame\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase/.test(saveText));
  check('SaveSystem.loadGame() defined', /loadGame\s*\(\s*\)/.test(saveText));
  check('SaveSystem.getLastSaveInfo() defined', /getLastSaveInfo\s*\(\s*\)/.test(saveText));
  check('main.js has no direct localStorage references', !/localStorage/.test(mainText));
  check('main.js has no direct JSON.stringify/parse save glue', !/JSON\.(?:stringify|parse)/.test(mainText));
  check('main.js has no direct Date.now() save glue', !/Date\.now\s*\(/.test(mainText));
  const saveStart = mainText.indexOf('function saveGame(');
  const saveEnd = mainText.indexOf('\n}', saveStart) + 2;
  const saveFnText = mainText.slice(saveStart, saveEnd);
  check('main.js saveGame() routes through saveSystem.saveSnapshot',
    /saveSystem\.saveSnapshot\s*\(/.test(saveFnText));
  check('main.js exposes refreshSaveInfo helper', /function refreshSaveInfo\s*\(/.test(mainText));

  console.log('\n=== Phase 1.6 behavior ===');
  const { SaveSystem } = await import(pathToFileURL(savePath).href);
  // Provide a minimal localStorage shim so the test can run in plain Node.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
  const sys = new SaveSystem();
  // IndexedDB isn't available in Node; suppress the init warning.
  check('getLastSaveInfo returns null when no save exists', sys.getLastSaveInfo() === null);
  const before = Date.now();
  const saved = sys.saveGame(12.5, 30, -7, 2);
  check('saveGame returns the persisted state object',
    saved && saved.position.x === 12.5 && saved.position.y === 30 && saved.position.z === -7 && saved.phase === 2);
  check('saveGame stamps a finite timestamp', Number.isFinite(saved.timestamp) && saved.timestamp >= before);
  const info = sys.getLastSaveInfo();
  check('getLastSaveInfo returns a non-empty timestamp string after save',
    typeof info === 'string' && info.length > 0);
  const loaded = sys.loadGame();
  check('loadGame round-trips position and phase',
    loaded && loaded.position.x === 12.5 && loaded.position.y === 30 && loaded.position.z === -7 && loaded.phase === 2);
  check('loadGame preserves timestamp', loaded && loaded.timestamp === saved.timestamp);
  // Tamper with the blob to confirm the loader coerces bad data and
  // re-persists a normalized copy so getLastSaveInfo can still recover.
  store.set('phaseshift_save', JSON.stringify({ position: { x: '1', y: null, z: undefined }, phase: 'oops' }));
  const coerced = sys.loadGame();
  check('loadGame coerces malformed position and phase',
    coerced && coerced.position.x === 0 && coerced.position.y === 0 && coerced.position.z === 0 && coerced.phase === 0);
  check('getLastSaveInfo remains a string after a malformed save',
    typeof sys.getLastSaveInfo() === 'string');


  // Phase 1.6 closure: a save → reload round-trip mirrors the runtime
  // init() path, which now calls loadGame() and reads position + phase.
  store.clear();
  const stored = sys.saveGame(-3, 47.25, 9, 1);
  const reloaded = sys.loadGame();
  check('save→load round-trip with fractional coordinates',
    reloaded.position.x === -3 && reloaded.position.y === 47.25 &&
    reloaded.position.z === 9 && reloaded.phase === 1);
  check('stored timestamp survives a reload',
    reloaded.timestamp === stored.timestamp);


  // Phase 1 closure: world block memory persists through saveSnapshot.
  store.clear();
  const ws = { '5,30,7,0': 1, '6,30,7,0': 0, '7,30,8,1': 4 };
  const snap = sys.saveSnapshot(2, 31, 3, 1, ws);
  const restored2 = sys.loadGame();
  check('saveSnapshot stamps the same shape as saveGame',
    snap.position.x === 2 && snap.phase === 1 && snap.worldState['5,30,7,0'] === 1);
  check('loadGame returns the saved worldState', restored2 && restored2.worldState['5,30,7,0'] === 1);
  check('loadGame coerces worldState to integer block ids', (() => {
    store.set('phaseshift_save', JSON.stringify({
      position: { x: 0, y: 0, z: 0 },
      phase: 0,
      worldState: { 'a': 'oops', 'b': -1, 'c': 4, 'd': 2.5, 'e': 0 },
    }));
    const r = sys.loadGame();
    return r && r.worldState.c === 4 && !('a' in r.worldState) && !('b' in r.worldState) && !('d' in r.worldState) && !('e' in r.worldState);
  })());

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 1.6 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
