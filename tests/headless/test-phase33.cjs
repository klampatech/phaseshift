#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 3.3 verification: Echoes - collectible lore objects with
// per-frame pickup loop + HUD counter + lore toast + inventory
// round-trip.
//
//   1) Static-analysis - the pieces exist:
//        - src/collect/echo.js exports PICKUP_RADIUS, ECHO_LORE_LIBRARY,
//          echoLoreForKey, pickupResult, echoKey, floatingOffset,
//          echoColorForBiome
//        - src/inventory/inventory.js exports createInventory,
//          addEcho, hasEcho, listEchoes, removeEcho, addAmplifier,
//          hasAmplifier, serialize, deserialize, collectedCount,
//          amplifierCount
//        - main.js imports PICKUP_RADIUS + ECHO_LORE_LIBRARY + echo
//          helpers from src/collect/echo.js and inventory helpers
//          from src/inventory/inventory.js
//        - main.js declares module-level playerInventory state
//        - main.js#tickEchoesPerFrame is defined and called from game loop
//        - main.js saveGame passes the serialized inventory to saveSnapshot
//        - main.js init() applies saved inventory via deserializeInventory
//        - main.js debug hooks: forceSpawnEcho, forceCollectEcho,
//          getInventory, listEchoes, getEchoCount, getTotalEchoes,
//          getCollectedEchoCount, getEchoCounterText, isEchoAt,
//          tickEchoesPerFrame, clearEchoes, addAmplifier,
//          hasAmplifier, hasEcho, getEchoKeys, getCollectedCount
//        - World has spawnEcho, collectEcho, listEchoes,
//          getTotalEchoes, getUncollectedEchoCount, getCollectedEchoCount,
//          clearEchoes methods
//        - Renderer has EchoOverlay class with showEcho, updateEchoes,
//          clearEcho, clearEchoes methods + thin wrappers
//        - HUD has setEchoCounter + showLoreToast methods
//        - index.html has #echo-counter + #lore-toast elements
//        - SaveSystem._coerceInventory is defined
//   2) Behavior - pure modules:
//        - echoLoreForKey('foo') returns a non-empty string from the library
//        - echoLoreForKey('') returns the first entry (defensive)
//        - echoKey(10, 20, 30) returns '10,20,30'
//        - echoKey(10.4, 20.8, 30.1) returns '10,20,30' (floored)
//        - echoKey(NaN, 5, 5) returns '0,5,5' (defensive)
//        - pickupResult returns null for empty list
//        - pickupResult returns null when nothing in range
//        - pickupResult returns the nearest echo within radius
//        - floatingOffset(t=0) returns y=0, rotY=0
//        - floatingOffset(t=1) returns y in [-0.15, 0.15]
//        - echoColorForBiome returns warm gold for default
//        - echoColorForBiome returns pale blue for Sky Ruins (7)
//        - createInventory() returns a fresh inventory with empty Map + Set
//        - addEcho is idempotent (returns false on second call)
//        - hasEcho returns true after addEcho
//        - removeEcho returns true on first call, false on second
//        - addAmplifier + hasAmplifier round-trip
//        - serialize/deserialize round-trip preserves the inventory
//   3) Behavior - World API:
//        - spawnEcho creates an echo in the world list
//        - collectEcho returns the data and marks the echo collected
//        - collectEcho on a missing key returns null
//        - listEchoes returns uncollected echoes only
//        - getTotalEchoes = uncollected + collected
//        - clearEchoes wipes the world list
//   4) Behavior - inventory round-trip:
//        - createInventory + addEcho + serialize gives a JSON-safe
//          snapshot that deserialize restores

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const hudPath = path.join(ROOT, 'src', 'ui', 'hud.js');
const echoPath = path.join(ROOT, 'src', 'collect', 'echo.js');
const inventoryPath = path.join(ROOT, 'src', 'inventory', 'inventory.js');
const savePath = path.join(ROOT, 'src', 'save', 'system.js');
const htmlPath = path.join(ROOT, 'index.html');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const hudText = fs.readFileSync(hudPath, 'utf8');
const echoText = fs.readFileSync(echoPath, 'utf8');
const inventoryText = fs.readFileSync(inventoryPath, 'utf8');
const saveText = fs.readFileSync(savePath, 'utf8');
const htmlText = fs.readFileSync(htmlPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` - ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 3.3 source checks ===');

  // ── Static analysis (echo.js) ────────────────────────────────
  check('src/collect/echo.js exports PICKUP_RADIUS',
    /export\s+const\s+PICKUP_RADIUS\s*=/.test(echoText));
  check('src/collect/echo.js exports ECHO_LORE_LIBRARY (frozen array)',
    /export\s+const\s+ECHO_LORE_LIBRARY\s*=\s*Object\.freeze/.test(echoText));
  check('src/collect/echo.js exports echoLoreForKey',
    /export\s+function\s+echoLoreForKey/.test(echoText));
  check('src/collect/echo.js exports pickupResult',
    /export\s+function\s+pickupResult/.test(echoText));
  check('src/collect/echo.js exports echoKey',
    /export\s+function\s+echoKey/.test(echoText));
  check('src/collect/echo.js exports floatingOffset',
    /export\s+function\s+floatingOffset/.test(echoText));
  check('src/collect/echo.js exports echoColorForBiome',
    /export\s+function\s+echoColorForBiome/.test(echoText));

  // ── Static analysis (inventory.js) ────────────────────────────
  check('src/inventory/inventory.js exports createInventory',
    /export\s+function\s+createInventory/.test(inventoryText));
  check('src/inventory/inventory.js exports addEcho',
    /export\s+function\s+addEcho/.test(inventoryText));
  check('src/inventory/inventory.js exports hasEcho',
    /export\s+function\s+hasEcho/.test(inventoryText));
  check('src/inventory/inventory.js exports listEchoes',
    /export\s+function\s+listEchoes/.test(inventoryText));
  check('src/inventory/inventory.js exports removeEcho',
    /export\s+function\s+removeEcho/.test(inventoryText));
  check('src/inventory/inventory.js exports addAmplifier',
    /export\s+function\s+addAmplifier/.test(inventoryText));
  check('src/inventory/inventory.js exports hasAmplifier',
    /export\s+function\s+hasAmplifier/.test(inventoryText));
  check('src/inventory/inventory.js exports serialize',
    /export\s+function\s+serialize/.test(inventoryText));
  check('src/inventory/inventory.js exports deserialize',
    /export\s+function\s+deserialize/.test(inventoryText));
  check('src/inventory/inventory.js exports collectedCount',
    /export\s+function\s+collectedCount/.test(inventoryText));
  check('src/inventory/inventory.js exports amplifierCount',
    /export\s+function\s+amplifierCount/.test(inventoryText));

  // ── Constants.js ──────────────────────────────────────────────
  check('constants.js exports BLOCK_ECHO = 17',
    /export\s+const\s+BLOCK_ECHO\s*=\s*17\b/.test(constantsText));
  check('constants.js BLOCK_NAMES includes Echo at index 17',
    /['"]Echo['"]\s*,\s*\/\/\s*17/.test(constantsText));
  check('constants.js exports ECHO_PICKUP_RADIUS = 1.5',
    /export\s+const\s+ECHO_PICKUP_RADIUS\s*=\s*1\.5\b/.test(constantsText));
  check('constants.js exports ECHO_LORE_TTL = 5',
    /export\s+const\s+ECHO_LORE_TTL\s*=\s*5\b/.test(constantsText));

  // ── World.js ──────────────────────────────────────────────────
  check('World.spawnEcho is defined',
    /spawnEcho\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*loreKey\s*,\s*biomeId\s*\)/.test(worldText));
  check('World.collectEcho is defined',
    /collectEcho\s*\(\s*key\s*\)/.test(worldText));
  check('World.listEchoes is defined',
    /listEchoes\s*\(\s*\)/.test(worldText));
  check('World.getTotalEchoes is defined',
    /getTotalEchoes\s*\(\s*\)/.test(worldText));
  check('World.getUncollectedEchoCount is defined',
    /getUncollectedEchoCount\s*\(\s*\)/.test(worldText));
  check('World.getCollectedEchoCount is defined',
    /getCollectedEchoCount\s*\(\s*\)/.test(worldText));
  check('World.clearEchoes is defined',
    /clearEchoes\s*\(\s*\)/.test(worldText));

  // ── Renderer.js (EchoOverlay) ─────────────────────────────────
  check('Renderer exports EchoOverlay class',
    /export\s+class\s+EchoOverlay\b/.test(rendererText));
  check('EchoOverlay has its own group named echoOverlay',
    /class\s+EchoOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]echoOverlay['"]/.test(rendererText));
  check('EchoOverlay.showEcho is defined',
    /class\s+EchoOverlay[\s\S]*?showEcho\s*\(/.test(rendererText));
  check('EchoOverlay.updateEchoes is defined',
    /class\s+EchoOverlay[\s\S]*?updateEchoes\s*\(/.test(rendererText));
  check('EchoOverlay.clearEcho is defined',
    /class\s+EchoOverlay[\s\S]*?clearEcho\s*\(/.test(rendererText));
  check('EchoOverlay.clearEchoes is defined',
    /class\s+EchoOverlay[\s\S]*?clearEchoes\s*\(/.test(rendererText));
  check('Renderer.showEcho forwards to echoOverlay.showEcho',
    /showEcho\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*key\s*,\s*color\s*\)\s*\{[\s\S]*?this\.echoOverlay\.showEcho/.test(rendererText));
  check('Renderer.updateEchoes forwards to echoOverlay.updateEchoes',
    /updateEchoes\s*\(\s*dt\s*,\s*snapshot(?:\s*,\s*currentPhase)?\s*\)\s*\{[\s\S]*?this\.echoOverlay\.updateEchoes/.test(rendererText));
  check('Renderer.clearEcho forwards to echoOverlay.clearEcho',
    /clearEcho\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.echoOverlay\.clearEcho/.test(rendererText));

  // ── HUD.js ────────────────────────────────────────────────────
  check('HUD.setEchoCounter is defined',
    /setEchoCounter\s*\(\s*collected\s*,\s*total\s*\)/.test(hudText));
  check('HUD.showLoreToast is defined',
    /showLoreToast\s*\(\s*text\s*\)/.test(hudText));
  check('HUD queries #echo-counter element in constructor',
    /constructor[\s\S]{0,1500}?#echo-info/.test(hudText) || /constructor[\s\S]{0,3000}?#echo-counter/.test(hudText));
  check('HUD queries #lore-toast element in constructor',
    /constructor[\s\S]{0,1500}?#lore-toast/.test(hudText) || /#lore-toast/.test(hudText));

  // ── index.html ────────────────────────────────────────────────
  check('index.html has #echo-counter element',
    /id\s*=\s*["']echo-counter["']/.test(htmlText));
  check('index.html has #lore-toast element',
    /id\s*=\s*["']lore-toast["']/.test(htmlText));
  check('index.html has #echo-counter CSS',
    /#echo-counter\s*\{/.test(htmlText));
  check('index.html has #lore-toast CSS',
    /#lore-toast\s*\{/.test(htmlText));

  // ── main.js imports ───────────────────────────────────────────
  check('main.js imports ECHO_PICKUP_RADIUS from src/collect/echo.js',
    /import\s*\{[^}]*PICKUP_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/collect\/echo\.js['"]/.test(mainText));
  check('main.js imports echoLoreForKey from src/collect/echo.js',
    /import\s*\{[^}]*echoLoreForKey[^}]*\}\s*from\s*['"]\.\/src\/collect\/echo\.js['"]/.test(mainText));
  check('main.js imports pickupResult from src/collect/echo.js',
    /import\s*\{[^}]*pickupResult[^}]*\}\s*from\s*['"]\.\/src\/collect\/echo\.js['"]/.test(mainText));
  check('main.js imports inventory helpers from src/inventory/inventory.js',
    /import\s*\{[^}]*createInventory[^}]*\}\s*from\s*['"]\.\/src\/inventory\/inventory\.js['"]/.test(mainText));

  // ── main.js state + tick ──────────────────────────────────────
  check('main.js declares module-level playerInventory',
    /let\s+playerInventory\s*=/.test(mainText));
  check('main.js#tickEchoesPerFrame is defined',
    /function\s+tickEchoesPerFrame/.test(mainText));
  check('main.js game loop calls tickEchoesPerFrame',
    /tickEchoesPerFrame\s*\(\s*deltaTime\s*\)/.test(mainText));
  check('main.js#tickEchoesPerFrame reads world.listEchoes',
    /function\s+tickEchoesPerFrame[\s\S]{0,2000}?world\.listEchoes\s*\(/.test(mainText));
  check('main.js#tickEchoesPerFrame drives renderer.updateEchoes',
    /function\s+tickEchoesPerFrame[\s\S]{0,2000}?renderer\.updateEchoes\s*\(/.test(mainText));
  check('main.js#tickEchoesPerFrame uses echoPickupResult',
    /function\s+tickEchoesPerFrame[\s\S]{0,2000}?echoPickupResult\s*\(/.test(mainText));
  check('main.js#tickEchoesPerFrame calls world.collectEcho on hit',
    /function\s+tickEchoesPerFrame[\s\S]{0,2000}?world\.collectEcho\s*\(/.test(mainText));
  check('main.js#tickEchoesPerFrame calls renderer.clearEcho on hit',
    /function\s+tickEchoesPerFrame[\s\S]{0,2000}?renderer\.clearEcho\s*\(/.test(mainText));
  check('main.js#tickEchoesPerFrame calls hud.setEchoCounter',
    /function\s+tickEchoesPerFrame[\s\S]{0,4000}?hud\.setEchoCounter\s*\(/.test(mainText));

  // ── main.js save/load wiring ──────────────────────────────────
  check('main.js saveGame serializes the inventory',
    /function\s+saveGame[\s\S]{0,1000}?serializeInventory\s*\(\s*playerInventory\s*\)/.test(mainText));
  check('main.js saveGame passes inventory to saveSnapshot',
    /saveSystem\.saveSnapshot\([^]*?inventorySnapshot\b/.test(mainText));
  check('main.js init() applies saved inventory via deserializeInventory',
    /function\s+init[\s\S]{0,15000}?deserializeInventory\s*\(\s*_savedState\.inventory\s*\)/.test(mainText));

  // ── main.js debug hooks ───────────────────────────────────────
  for (const hook of [
    'forceSpawnEcho',
    'forceCollectEcho',
    'getInventory',
    'listEchoes',
    'getEchoCount',
    'getTotalEchoes',
    'getCollectedEchoCount',
    'getEchoCounterText',
    'isEchoAt',
    'tickEchoesPerFrame',
    'clearEchoes',
    'addAmplifier',
    'hasAmplifier',
    'hasEcho',
    'getEchoKeys',
  ]) {
    check(`__phaseShifter__.${hook} hook is present`,
      new RegExp(`__phaseShifter__[\\s\\S]*?${hook}\\s*\\(`).test(mainText));
  }

  // ── SaveSystem ────────────────────────────────────────────────
  check('SaveSystem._coerceInventory is defined',
    /_coerceInventory\s*\(\s*value\s*\)/.test(saveText));
  check('SaveSystem.saveSnapshot accepts inventory arg',
    /saveSnapshot\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*worldState\s*,\s*anchors\s*,\s*inventory\b/.test(saveText));
  check('SaveSystem._coerceInventory rejects non-objects',
    /_coerceInventory[\s\S]{0,500}?non-object/.test(saveText) || /_coerceInventory[\s\S]{0,500}?return\s+fresh/.test(saveText));
  check('SaveSystem._normalizeState passes inventory through',
    /_normalizeState[\s\S]{0,1000}?_coerceInventory\s*\(\s*state\.inventory\s*\)/.test(saveText));
  check('SaveSystem.loadGame returns inventory',
    /loadGame[\s\S]{0,2000}?inventory\s*:\s*this\._coerceInventory/.test(saveText));

  // ── Behavior - pure module (echo.js) ──────────────────────────
  console.log('\n=== Phase 3.3 behavior - pure modules ===');
  const echoModule = await import(echoPath.replace(/^.*\/(.*\.js)$/, 'file://' + echoPath.replace(/\\/g, '/')));
  const {
    PICKUP_RADIUS, ECHO_LORE_LIBRARY, echoLoreForKey, pickupResult,
    echoKey, floatingOffset, echoColorForBiome,
  } = echoModule;
  check('PICKUP_RADIUS === 1.5', PICKUP_RADIUS === 1.5);
  // Phase 10.4: 12 random flavor strings -> 36 sequenced narrative (5 per biome x 7 + 1 final Nexus)
  check('ECHO_LORE_LIBRARY has 36 entries (Phase 10.4 sequenced)', ECHO_LORE_LIBRARY.length === 36);
  check('echoLoreForKey("foo") returns a non-empty string',
    typeof echoLoreForKey('foo') === 'string' && echoLoreForKey('foo').length > 0);
  check('echoLoreForKey("") returns first library entry',
    echoLoreForKey('') === ECHO_LORE_LIBRARY[0]);
  check('echoKey(10, 20, 30) returns "10,20,30"', echoKey(10, 20, 30) === '10,20,30');
  check('echoKey(10.4, 20.8, 30.1) returns "10,20,30" (floored)', echoKey(10.4, 20.8, 30.1) === '10,20,30');
  check('echoKey(NaN, 5, 5) returns "0,5,5" (defensive)', echoKey(NaN, 5, 5) === '0,5,5');
  check('pickupResult returns null for empty list',
    pickupResult({ x: 0, y: 0, z: 0 }, []) === null);
  check('pickupResult returns null when nothing in range',
    pickupResult({ x: 0, y: 0, z: 0 }, [{ x: 100, y: 100, z: 100, key: '100,100,100' }]) === null);
  const nearby = [{ x: 1, y: 0, z: 0, key: '1,0,0', loreKey: '1,0,0', biomeId: 0 }];
  const hit = pickupResult({ x: 0, y: 0, z: 0 }, nearby);
  check('pickupResult returns nearest echo within radius', hit && hit.key === '1,0,0' && hit.lore);
  const off0 = floatingOffset(0, 0);
  check('floatingOffset(t=0, ph=0) returns y=0, rotY=0', off0.y === 0 && off0.rotY === 0);
  const off1 = floatingOffset(1, 0);
  check('floatingOffset(t=1, ph=0) returns y in [-0.15, 0.15]', off1.y >= -0.15 && off1.y <= 0.15);
  check('echoColorForBiome(7) (Sky Ruins) returns pale blue',
    echoColorForBiome(7)[2] >= 0.9 && echoColorForBiome(7)[0] <= 0.7);
  check('echoColorForBiome(8) (Phase Nexus) returns deep purple',
    echoColorForBiome(8)[0] <= 0.6 && echoColorForBiome(8)[2] >= 0.8);
  check('echoColorForBiome(99) returns warm gold default',
    echoColorForBiome(99)[0] >= 0.9 && echoColorForBiome(99)[1] >= 0.7);

  // ── Behavior - pure module (inventory.js) ─────────────────────
  console.log('\n=== Phase 3.3 behavior - inventory pure module ===');
  const invModule = await import(inventoryPath.replace(/^.*\/(.*\.js)$/, 'file://' + inventoryPath.replace(/\\/g, '/')));
  const {
    createInventory, addEcho: invAddEcho, hasEcho: invHasEcho,
    listEchoes: invListEchoes, removeEcho: invRemoveEcho,
    addAmplifier, hasAmplifier, serialize, deserialize,
    collectedCount, amplifierCount,
  } = invModule;
  const inv = createInventory();
  check('createInventory returns Map + Set', inv.collectedEchoes instanceof Map && inv.amplifiers instanceof Set);
  check('collectedCount on fresh inventory === 0', collectedCount(inv) === 0);
  check('amplifierCount on fresh inventory === 0', amplifierCount(inv) === 0);
  check('addEcho returns true on first call', invAddEcho(inv, 'a,b,c', 'lore A') === true);
  check('addEcho returns false on second call (idempotent)',
    invAddEcho(inv, 'a,b,c', 'lore B') === false);
  check('hasEcho returns true after add', invHasEcho(inv, 'a,b,c') === true);
  check('hasEcho returns false for unknown key', !invHasEcho(inv, 'x,y,z'));
  check('collectedCount === 1 after one add', collectedCount(inv) === 1);
  check('listEchoes returns the entry',
    invListEchoes(inv).length === 1 && invListEchoes(inv)[0].key === 'a,b,c');
  check('removeEcho returns true on first call', invRemoveEcho(inv, 'a,b,c') === true);
  check('removeEcho returns false on second call', invRemoveEcho(inv, 'a,b,c') === false);
  check('collectedCount === 0 after remove', collectedCount(inv) === 0);
  check('addAmplifier returns true on first call', addAmplifier(inv, 'alpha-beta') === true);
  check('addAmplifier returns false on second call', addAmplifier(inv, 'alpha-beta') === false);
  check('hasAmplifier returns true after add', hasAmplifier(inv, 'alpha-beta'));
  check('amplifierCount === 1 after one add', amplifierCount(inv) === 1);
  // Round-trip
  invAddEcho(inv, 'k1', 'lore 1');
  invAddEcho(inv, 'k2', 'lore 2');
  const snap = serialize(inv);
  check('serialize returns plain object with arrays', Array.isArray(snap.collectedEchoes) && Array.isArray(snap.amplifiers));
  const inv2 = deserialize(snap);
  check('deserialize restores collected Echoes', collectedCount(inv2) === 2);
  check('deserialize restores amplifiers', amplifierCount(inv2) === 1);
  check('deserialize preserves lore strings',
    inv2.collectedEchoes.get('k1') === 'lore 1' && inv2.collectedEchoes.get('k2') === 'lore 2');
  check('deserialize on null returns fresh inventory',
    deserialize(null).collectedEchoes.size === 0 && deserialize(null).amplifiers.size === 0);
  check('deserialize on non-array collectedEchoes returns fresh',
    deserialize({ collectedEchoes: 'foo', amplifiers: 'bar' }).collectedEchoes.size === 0);

  // ── Behavior - World API ──────────────────────────────────────
  console.log('\n=== Phase 3.3 behavior - World echo API ===');
  const { World } = await import(worldPath.replace(/^.*\/(.*\.js)$/, 'file://' + worldPath.replace(/\\/g, '/')));
  const w = new World(() => {});
  // Drain any terrain-gen echoes loaded by `updateChunks(0, 0)` so
  // the API contract tests below operate on a clean world. The
  // §10.11 follow-up made `addEcho` write a `key` field so terrain
  // echoes are well-formed; but the API tests want deterministic
  // counts, so we clear first.
  w.updateChunks(0, 0);
  w.clearEchoes();
  check('World.spawnEcho creates an echo', w.spawnEcho(5, 5, 5, '5,5,5', 4) !== null);
  check('World.listEchoes returns uncollected echoes',
    w.listEchoes().length === 1 && w.listEchoes()[0].key === '5,5,5');
  check('World.getTotalEchoes includes the spawned echo', w.getTotalEchoes() === 1);
  check('World.getUncollectedEchoCount === 1', w.getUncollectedEchoCount() === 1);
  check('World.getCollectedEchoCount === 0', w.getCollectedEchoCount() === 0);
  check('World.collectEcho returns data', w.collectEcho('5,5,5') !== null);
  check('World.listEchoes is empty after collect', w.listEchoes().length === 0);
  check('World.getUncollectedEchoCount === 0 after collect', w.getUncollectedEchoCount() === 0);
  check('World.getCollectedEchoCount === 1 after collect', w.getCollectedEchoCount() === 1);
  check('World.collectEcho on missing key returns null', w.collectEcho('zzz') === null);
  check('World.spawnEcho is idempotent for uncollected cell',
    w.spawnEcho(7, 7, 7, '7,7,7', 4) && w.spawnEcho(7, 7, 7, '7,7,7', 4) && w.listEchoes().length === 1);
  check('World.clearEchoes wipes the list',
    (w.clearEchoes(), w.getTotalEchoes() === 0));

  // ── Summary ───────────────────────────────────────────────────
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n=== Phase 3.3 TOTAL: ${passed}/${total} passed ===`);
  process.exit(passed === total ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
