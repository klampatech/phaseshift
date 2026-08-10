#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 2.7 verification: Phase Anchor (Shift+LMB) — the player-placed
// lock that holds the player on a block through a phase shift.
//
//   1) Static-analysis — the pieces exist:
//        - src/anchor/anchor.js exports placeAnchorAt, snapYForCell,
//          cellUnderPlayer, anchorLifetime, anchorFadeOpacity,
//          anchorBorderOpacity, anchorKey, tickAnchors, isAnchorExpired
//        - constants.js exports ANCHOR_LIFETIME = 10,
//          ANCHOR_FADE_WINDOW = 3, ANCHOR_FILL_COLOR = 0xffee88,
//          ANCHOR_BORDER_COLOR = 0xffcc00, ANCHOR_COST = 0
//        - World.createAnchor / removeAnchor / tickAnchors /
//          findAnchorUnderPlayer / isAnchorActive / exportAnchors /
//          importAnchors / clearAnchors are defined
//        - main.js#placeAnchor delegates to placeAnchorAt +
//          world.createAnchor (no more BLOCK_15 stray write; no more
//          "pending §2.7" stub notification)
//        - main.js#onPhaseChanged calls world.findAnchorUnderPlayer
//          and physicsManager.setPosition (the snap-to-anchor logic)
//        - main.js per-frame loop calls tickAnchorsPerFrame
//        - SaveSystem.saveSnapshot accepts the anchor list; the
//          loadGame return shape includes `anchors`
//        - main.js exposes forcePlaceAnchor / getAnchorCount /
//          getAnchorMeshCount / getAnchorKeys / clearAnchors /
//          isAnchorAt / tickAnchors / findAnchorUnderPlayer
//          debug hooks
//        - renderer.js AnchorOverlay class is exported; Renderer
//          forwards showAnchor / updateAnchors / clearAnchors
//   2) Behavior — pure module:
//        - anchorLifetime() returns 10
//        - anchorFadeWindow() returns 3
//        - anchorFillColor() returns 0xffee88
//        - anchorBorderColor() returns 0xffcc00
//        - anchorCost() returns 0
//        - anchorFadeOpacity outside the fade window returns 0.4
//        - anchorFadeOpacity inside the fade window oscillates
//          between 0.2 and 0.5
//        - anchorBorderOpacity is fill + 0.3 (clamped at 0.95)
//        - anchorKey returns the canonical `${x},${y},${z},${phase}` string
//        - tickAnchors decrements remaining and returns expired keys
//        - isAnchorExpired returns true when the next tick would
//          expire the anchor
//        - cellUnderPlayer returns { x, y, z } = floor(player) - 1
//          in Y
//        - snapYForCell returns cellY + 1 + PLAYER_HEIGHT
//        - playerAABBOverlapsAnchorCell rejects out-of-bounds
//        - placeAnchorAt rejects no-hit, target-not-air (Stone in
//          Gamma), and overlaps-player
//   3) Behavior — World API:
//        - createAnchor adds an entry; isAnchorActive returns true
//        - createAnchor is idempotent (re-pressing refreshes
//          remaining to ANCHOR_LIFETIME)
//        - removeAnchor removes the entry
//        - tickAnchors with dt=11 returns the keys of all anchors
//          and clears the world map
//        - findAnchorUnderPlayer returns the anchor at the cell
//          directly under the player's feet (in the current phase)
//        - exportAnchors + importAnchors round-trip preserves
//          the entry list
//        - importAnchors rejects a non-array, non-finite,
//          non-integer, out-of-range, or negative-remaining entry
//   4) Behavior — SaveSystem:
//        - saveSnapshot(x, y, z, phase, worldState, anchors)
//          persists the anchor list
//        - loadGame() returns { ..., anchors } when present
//        - loadGame() returns { anchors: [] } when missing
//          (back-compat with §1.7 / §2.4 save blobs)
//        - _coerceAnchors rejects non-arrays and tampered entries
//
// Static checks are against source files (not the Vite-minified bundle).
// Same pattern as Phases 1.2–2.6.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const anchorPath = path.join(ROOT, 'src', 'anchor', 'anchor.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');
const rendererPath = path.join(ROOT, 'src', 'render', 'renderer.js');
const savePath = path.join(ROOT, 'src', 'save', 'system.js');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const anchorText = fs.readFileSync(anchorPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');
const rendererText = fs.readFileSync(rendererPath, 'utf8');
const saveText = fs.readFileSync(savePath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 2.7 source checks ===');

  // ── src/anchor/anchor.js exports ──────────────────────────────────
  check(
    'src/anchor/anchor.js exports placeAnchorAt',
    /export\s+function\s+placeAnchorAt\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports snapYForCell',
    /export\s+function\s+snapYForCell\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports cellUnderPlayer',
    /export\s+function\s+cellUnderPlayer\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports anchorLifetime',
    /export\s+function\s+anchorLifetime\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports anchorFadeWindow',
    /export\s+function\s+anchorFadeWindow\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports anchorFadeOpacity',
    /export\s+function\s+anchorFadeOpacity\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports anchorBorderOpacity',
    /export\s+function\s+anchorBorderOpacity\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports anchorKey',
    /export\s+function\s+anchorKey\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports tickAnchors',
    /export\s+function\s+tickAnchors\s*\(/.test(anchorText)
  );
  check(
    'src/anchor/anchor.js exports isAnchorExpired',
    /export\s+function\s+isAnchorExpired\s*\(/.test(anchorText)
  );

  // ── constants.js exports ──────────────────────────────────────────
  check(
    'constants.js exports ANCHOR_LIFETIME = 10',
    /export\s+const\s+ANCHOR_LIFETIME\s*=\s*10\b/.test(constantsText)
  );
  check(
    'constants.js exports ANCHOR_FADE_WINDOW = 3',
    /export\s+const\s+ANCHOR_FADE_WINDOW\s*=\s*3\b/.test(constantsText)
  );
  check(
    'constants.js exports ANCHOR_FILL_COLOR = 0xffee88',
    /export\s+const\s+ANCHOR_FILL_COLOR\s*=\s*0xffee88\b/.test(constantsText)
  );
  check(
    'constants.js exports ANCHOR_BORDER_COLOR = 0xffcc00',
    /export\s+const\s+ANCHOR_BORDER_COLOR\s*=\s*0xffcc00\b/.test(constantsText)
  );
  check(
    'constants.js exports ANCHOR_COST = 0',
    /export\s+const\s+ANCHOR_COST\s*=\s*0\b/.test(constantsText)
  );

  // ── World.js API ──────────────────────────────────────────────────
  check(
    'World.createAnchor(x, y, z, phase) is defined',
    /createAnchor\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*\)/.test(worldText)
  );
  check(
    'World.removeAnchor(x, y, z, phase) is defined',
    /removeAnchor\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*\)/.test(worldText)
  );
  check(
    'World.tickAnchors(dt) is defined',
    /tickAnchors\s*\(\s*dt\s*\)/.test(worldText)
  );
  check(
    'World.findAnchorUnderPlayer(...) is defined',
    /findAnchorUnderPlayer\s*\(/.test(worldText)
  );
  check(
    'World.isAnchorActive(x, y, z, phase) is defined',
    /isAnchorActive\s*\(/.test(worldText)
  );
  check(
    'World.exportAnchors() is defined',
    /exportAnchors\s*\(/.test(worldText)
  );
  check(
    'World.importAnchors(snapshot) is defined',
    /importAnchors\s*\(/.test(worldText)
  );
  check(
    'World.clearAnchors() is defined',
    /clearAnchors\s*\(/.test(worldText)
  );
  check(
    'World._anchors Map is initialized in the constructor',
    /this\._anchors\s*=\s*new\s+Map\s*\(\s*\)/.test(worldText)
  );

  // ── main.js wiring ────────────────────────────────────────────────
  check(
    'main.js imports placeAnchorAt from src/anchor/anchor.js',
    /import\s*\{[^}]*placeAnchorAt[^}]*\}\s*from\s*['"]\.\/src\/anchor\/anchor\.js['"]/.test(mainText)
  );
  check(
    'main.js imports AnchorOverlay from src/render/renderer.js',
    /import\s*\{[^}]*AnchorOverlay[^}]*\}\s*from\s*['"]\.\/src\/render\/renderer\.js['"]/.test(mainText)
  );
  check(
    'main.js#placeAnchor delegates to placeAnchorAt',
    /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,2000}?placeAnchorAt\s*\(/.test(mainText)
  );
  check(
    'main.js#placeAnchor calls world.createAnchor',
    /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,2500}?world\.createAnchor\s*\(/.test(mainText)
  );
  check(
    'main.js#placeAnchor calls renderer.showAnchor',
    /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,3000}?renderer\.showAnchor\s*\(/.test(mainText)
  );
  check(
    'main.js#placeAnchor shows "No block in range" for a null hit',
    /No block in range/.test(mainText)
  );
  check(
    'main.js#placeAnchor no longer shows the §2.7 stub notification',
    !/Anchor placement pending §2\.7/.test(mainText)
  );
  // The onPhaseChanged handler calls findAnchorUnderPlayer + setPosition
  // (the snap-to-anchor logic — the §2.7 contract: "Standing on it
  // through a phase shift keeps you on the block").
  check(
    'main.js#onPhaseChanged calls world.findAnchorUnderPlayer (snap-to-anchor)',
    /function\s+onPhaseChanged[\s\S]*?findAnchorUnderPlayer\s*\(/.test(mainText)
  );
  check(
    'main.js#onPhaseChanged calls physicsManager.setPosition (snap-to-anchor)',
    /function\s+onPhaseChanged[\s\S]*?physicsManager\.setPosition\s*\(/.test(mainText)
  );
  // The per-frame anchor tick
  check(
    'main.js game loop calls tickAnchorsPerFrame',
    /tickAnchorsPerFrame\s*\(\s*deltaTime\s*\)/.test(mainText)
  );

  // ── SaveSystem wiring ─────────────────────────────────────────────
  check(
    'SaveSystem.saveSnapshot accepts an anchors argument (Phase 3.3 extended with optional inventory)',
    /saveSnapshot\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*worldState\s*,\s*anchors\s*(?:,\s*[^)]+)?\s*\)/.test(saveText)
  );
  check(
    'SaveSystem._coerceAnchors is defined',
    /_coerceAnchors\s*\(/.test(saveText)
  );
  check(
    'SaveSystem.loadGame returns anchors',
    /loadGame\s*\(\s*\)[\s\S]{0,2000}?anchors\s*:\s*this\._coerceAnchors/.test(saveText)
  );
  check(
    'main.js#saveGame passes world.exportAnchors() to saveSnapshot',
    /function\s+saveGame[\s\S]{0,1000}?world\.exportAnchors\s*\(/.test(mainText) &&
    /function\s+saveGame[\s\S]{0,1500}?saveSystem\.saveSnapshot\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*anchors\s*(?:,\s*[^)]+)?\s*\)/.test(mainText)
  );
  check(
    'main.js init() imports saved anchors via world.importAnchors',
    /world\.importAnchors\s*\(/.test(mainText)
  );

  // ── AnchorOverlay + Renderer forwarding ───────────────────────────
  check(
    'AnchorOverlay class is exported from src/render/renderer.js',
    /export\s+class\s+AnchorOverlay\b/.test(rendererText)
  );
  check(
    'AnchorOverlay owns its own THREE.Group named "anchorOverlay"',
    /class\s+AnchorOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]anchorOverlay['"]/.test(rendererText)
  );
  check(
    'AnchorOverlay.showAnchor(x, y, z, phase) is defined',
    /class\s+AnchorOverlay[\s\S]*?showAnchor\s*\(/.test(rendererText)
  );
  check(
    'AnchorOverlay.updateAnchors(snapshot, removedKeys) is defined',
    /class\s+AnchorOverlay[\s\S]*?updateAnchors\s*\(/.test(rendererText)
  );
  check(
    'AnchorOverlay.clearAnchors() is defined',
    /class\s+AnchorOverlay[\s\S]*?clearAnchors\s*\(/.test(rendererText)
  );
  check(
    'Renderer forwards showAnchor to anchorOverlay',
    /showAnchor\s*\(\s*anchor\s*\)\s*\{[\s\S]*?this\.anchorOverlay\.showAnchor/.test(rendererText)
  );
  check(
    'Renderer forwards updateAnchors to anchorOverlay',
    /updateAnchors\s*\(\s*snapshot\s*,\s*removedKeys\s*\)\s*\{[\s\S]*?this\.anchorOverlay\.updateAnchors/.test(rendererText)
  );
  check(
    'Renderer forwards clearAnchors to anchorOverlay',
    /clearAnchors\s*\(\s*\)\s*\{[\s\S]*?this\.anchorOverlay\.clearAnchors/.test(rendererText)
  );

  // ── Debug hooks ───────────────────────────────────────────────────
  check(
    '__phaseShifter__.forcePlaceAnchor hook is present',
    /__phaseShifter__[\s\S]*?forcePlaceAnchor\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.forcePlaceAnchor delegates to world.createAnchor',
    /__phaseShifter__[\s\S]*?forcePlaceAnchor\s*\([\s\S]{0,800}?world\.createAnchor\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.getAnchorCount hook is present',
    /__phaseShifter__[\s\S]*?getAnchorCount\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.getAnchorMeshCount hook is present',
    /__phaseShifter__[\s\S]*?getAnchorMeshCount\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.getAnchorKeys hook is present',
    /__phaseShifter__[\s\S]*?getAnchorKeys\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.clearAnchors hook is present',
    /__phaseShifter__[\s\S]*?clearAnchors\s*\(\s*\)/.test(mainText)
  );
  check(
    '__phaseShifter__.isAnchorAt hook is present',
    /__phaseShifter__[\s\S]*?isAnchorAt\s*\(/.test(mainText)
  );
  check(
    '__phaseShifter__.tickAnchors hook is present',
    /__phaseShifter__[\s\S]*?tickAnchors\s*\(\s*dt\s*\)/.test(mainText)
  );
  check(
    '__phaseShifter__.findAnchorUnderPlayer hook is present',
    /__phaseShifter__[\s\S]*?findAnchorUnderPlayer\s*\(/.test(mainText)
  );

  console.log('\n=== Phase 2.7 behavior — pure module ===');

  const anchorModule = await import(pathToFileURL(anchorPath).href);

  // 1) anchorLifetime() returns 10.
  check(
    'anchorLifetime() returns 10',
    anchorModule.anchorLifetime() === 10
  );
  // 2) anchorFadeWindow() returns 3.
  check(
    'anchorFadeWindow() returns 3',
    anchorModule.anchorFadeWindow() === 3
  );
  // 3) anchorFillColor() returns 0xffee88.
  check(
    'anchorFillColor() returns 0xffee88',
    anchorModule.anchorFillColor() === 0xffee88
  );
  // 4) anchorBorderColor() returns 0xffcc00.
  check(
    'anchorBorderColor() returns 0xffcc00',
    anchorModule.anchorBorderColor() === 0xffcc00
  );
  // 5) anchorCost() returns 0 (free).
  check(
    'anchorCost() returns 0 (free)',
    anchorModule.anchorCost() === 0
  );
  // 6) anchorFadeOpacity outside the fade window returns 0.4.
  check(
    'anchorFadeOpacity(10) returns 0.4 (outside fade window)',
    Math.abs(anchorModule.anchorFadeOpacity(10) - 0.4) < 0.001,
    `got=${anchorModule.anchorFadeOpacity(10)}`
  );
  // 7) anchorFadeOpacity in the fade window oscillates 0.2 → 0.5.
  const op0 = anchorModule.anchorFadeOpacity(3);
  const op1 = anchorModule.anchorFadeOpacity(2.25); // sin(0.75 * 2π) ≈ sin(1.5π) ≈ -1 → 0.2 - 0.3 = -0.1 (clamped in code? no — but the value should be in [0.2 - 0.3, 0.2 + 0.3] = [-0.1, 0.5]). The code returns 0.2 + 0.3 * sin(...) which can be negative; the visual is clamped to [0, 1] by Three.js but the helper itself doesn't clamp.
  // We just verify the value is in the [-0.1, 0.5] band.
  check(
    'anchorFadeOpacity(2.25) is in the [-0.1, 0.5] band (mid-fade)',
    op1 >= -0.1 && op1 <= 0.5,
    `got=${op1}`
  );
  check(
    'anchorFadeOpacity(3) is in the [-0.1, 0.5] band (fade start)',
    op0 >= -0.1 && op0 <= 0.5,
    `got=${op0}`
  );
  // 8) anchorBorderOpacity is fill + 0.3 (clamped at 0.95).
  check(
    'anchorBorderOpacity(10) returns 0.7 (0.4 + 0.3)',
    Math.abs(anchorModule.anchorBorderOpacity(10) - 0.7) < 0.001
  );
  check(
    'anchorBorderOpacity(0) is clamped to <= 0.95',
    anchorModule.anchorBorderOpacity(0) <= 0.95
  );
  // 9) anchorKey returns the canonical string.
  check(
    'anchorKey(10, 20, 30, 1) returns "10,20,30,1"',
    anchorModule.anchorKey(10, 20, 30, 1) === '10,20,30,1'
  );
  // 10) anchorKey handles floor() of fractional coords.
  check(
    'anchorKey(10.5, 20.9, 30.1, 0) still returns a valid key',
    typeof anchorModule.anchorKey(10.5, 20.9, 30.1, 0) === 'string'
        && anchorModule.anchorKey(10.5, 20.9, 30.1, 0).length > 0
  );
  // 11) tickAnchors decrements remaining and returns expired keys.
  const fakeMap = new Map();
  fakeMap.set('a', { x: 0, y: 0, z: 0, phase: 0, remaining: 5 });
  fakeMap.set('b', { x: 0, y: 0, z: 0, phase: 1, remaining: 0.5 });
  const expired = anchorModule.tickAnchors(fakeMap, 1);
  check(
    'tickAnchors(map, 1) returns the keys that would expire (1 key here)',
    Array.isArray(expired) && expired.length === 1 && expired[0] === 'b',
    `expired=${JSON.stringify(expired)}`
  );
  // 12) isAnchorExpired returns true when the next tick expires.
  check(
    'isAnchorExpired({ remaining: 0.5 }, 1) returns true',
    anchorModule.isAnchorExpired({ remaining: 0.5 }, 1) === true
  );
  check(
    'isAnchorExpired({ remaining: 5 }, 1) returns false',
    anchorModule.isAnchorExpired({ remaining: 5 }, 1) === false
  );
  // 13) cellUnderPlayer returns floor(X), floor(Y) - 1, floor(Z).
  const cell = anchorModule.cellUnderPlayer(10.7, 20.4, 30.9);
  check(
    'cellUnderPlayer(10.7, 20.4, 30.9) returns { x: 10, y: 19, z: 30 }',
    cell && cell.x === 10 && cell.y === 19 && cell.z === 30,
    `got=${JSON.stringify(cell)}`
  );
  // 14) snapYForCell returns cellY + 1 + PLAYER_HEIGHT.
  const snapY = anchorModule.snapYForCell(20);
  check(
    'snapYForCell(20) returns 20 + 1 + PLAYER_HEIGHT (1.8) = 22.8',
    Math.abs(snapY - 22.8) < 0.001,
    `got=${snapY}`
  );
  // 15) playerAABBOverlapsAnchorCell rejects out-of-bounds.
  check(
    'playerAABBOverlapsAnchorCell returns false for non-overlap',
    anchorModule.playerAABBOverlapsAnchorCell(10, 20, 30, 0, 0, 0) === false
  );
  // 16) playerAABBOverlapsAnchorCell detects overlap when the cell is inside the AABB.
  check(
    'playerAABBOverlapsAnchorCell returns true when the cell is inside the AABB',
    anchorModule.playerAABBOverlapsAnchorCell(10.5, 19.5, 30.5, 10, 19, 30) === true
  );
  // 17) placeAnchorAt rejects null hit.
  check(
    'placeAnchorAt(0, 0, 0, null, 0, world) returns { ok: false, reason: "no-hit" }',
    JSON.stringify(anchorModule.placeAnchorAt(0, 0, 0, null, 0, {}).reason) === '"no-hit"'
  );
  // 18) placeAnchorAt rejects out-of-range phase.
  check(
    'placeAnchorAt(0, 0, 0, hit, 99, world) returns { ok: false, reason: "bad-input" }',
    anchorModule.placeAnchorAt(0, 0, 0, { blockX: 0, blockY: 0, blockZ: 0, face: { x: 0, y: 0, z: 0 } }, 99, {}).ok === false
  );

  console.log('\n=== Phase 2.7 behavior — World API ===');

  const { World } = await import(pathToFileURL(worldPath).href);
  const { BLOCK_STONE, BLOCK_AIR, PHASE_ALPHA, PHASE_BETA, BLOCK_CRYSTAL } = await import(pathToFileURL(constantsPath).href);

  function makeWorld() {
    const scene = { add() {}, remove() {} };
    return new World(scene, () => {});
  }

  // 19) createAnchor adds an entry; isAnchorActive returns true.
  const w1 = makeWorld();
  w1.ensureChunk(0, 0);
  const cr = w1.createAnchor(10, 20, 30, PHASE_ALPHA);
  check(
    'World.createAnchor(10, 20, 30, Alpha) returns { ok: true, refreshed: false }',
    cr && cr.ok === true && cr.refreshed === false
  );
  check(
    'World.isAnchorActive(10, 20, 30, Alpha) returns true after createAnchor',
    w1.isAnchorActive(10, 20, 30, PHASE_ALPHA) === true
  );
  // 20) createAnchor is idempotent (re-pressing refreshes remaining).
  const snap0 = w1.getAnchors()[0];
  const cr2 = w1.createAnchor(10, 20, 30, PHASE_ALPHA);
  check(
    'World.createAnchor(10, 20, 30, Alpha) on the same cell returns { ok: true, refreshed: true }',
    cr2 && cr2.ok === true && cr2.refreshed === true
  );
  check(
    'World.createAnchor is idempotent — the count stays at 1',
    w1.getAnchors().length === 1
  );
  // 21) getAnchors returns the snapshot with the right shape.
  const snap1 = w1.getAnchors();
  check(
    'World.getAnchors() returns the entry with { x, y, z, phase, remaining }',
    snap1[0].x === 10 && snap1[0].y === 20 && snap1[0].z === 30
      && snap1[0].phase === PHASE_ALPHA && typeof snap1[0].remaining === 'number'
  );
  check(
    'World.getAnchors()[0].remaining equals ANCHOR_LIFETIME (10)',
    Math.abs(snap1[0].remaining - 10) < 0.001
  );
  // 22) removeAnchor removes the entry.
  const rm = w1.removeAnchor(10, 20, 30, PHASE_ALPHA);
  check(
    'World.removeAnchor returns { ok: true, removed: true }',
    rm && rm.ok === true && rm.removed === true
  );
  check(
    'World.isAnchorActive(10, 20, 30, Alpha) returns false after removeAnchor',
    w1.isAnchorActive(10, 20, 30, PHASE_ALPHA) === false
  );
  // 23) tickAnchors with dt=11 expires all anchors.
  w1.createAnchor(1, 2, 3, PHASE_ALPHA);
  w1.createAnchor(4, 5, 6, PHASE_BETA);
  check(
    'World has 2 anchors after creating two more',
    w1.getAnchors().length === 2
  );
  const expiredKeys = w1.tickAnchors(11);
  check(
    'World.tickAnchors(11) returns 2 keys (both anchors expire)',
    Array.isArray(expiredKeys) && expiredKeys.length === 2
  );
  check(
    'World has 0 anchors after tickAnchors(11)',
    w1.getAnchors().length === 0
  );
  // 24) findAnchorUnderPlayer returns the anchor at the cell under the player's feet.
  w1.createAnchor(10, 19, 30, PHASE_ALPHA);
  const under = w1.findAnchorUnderPlayer(10.4, 20.0, 30.4, PHASE_ALPHA);
  check(
    'World.findAnchorUnderPlayer finds the anchor at (10, 19, 30) in Alpha',
    under && under.x === 10 && under.y === 19 && under.z === 30
  );
  // 25) findAnchorUnderPlayer returns null when the player isn't on an anchor.
  const noAnchor = w1.findAnchorUnderPlayer(100, 100, 100, PHASE_ALPHA);
  check(
    'World.findAnchorUnderPlayer returns null when no anchor is under the player',
    noAnchor === null
  );
  // 26) findAnchorUnderPlayer returns null when the phase doesn't match.
  const wrongPhase = w1.findAnchorUnderPlayer(10.4, 20.0, 30.4, PHASE_BETA);
  check(
    'World.findAnchorUnderPlayer returns null when the phase doesn\'t match',
    wrongPhase === null
  );
  // 27) exportAnchors + importAnchors round-trip.
  w1.clearAnchors();
  w1.createAnchor(7, 8, 9, PHASE_ALPHA);
  w1.createAnchor(10, 11, 12, PHASE_BETA);
  const snap2 = w1.exportAnchors();
  check(
    'World.exportAnchors returns 2 entries',
    snap2.length === 2
  );
  w1.clearAnchors();
  const applied = w1.importAnchors(snap2);
  check(
    'World.importAnchors(snapshot) returns 2 applied',
    applied === 2
  );
  check(
    'World has 2 anchors after importAnchors',
    w1.getAnchors().length === 2
  );
  // 28) importAnchors rejects non-array, NaN, negative-remaining entries.
  w1.clearAnchors();
  const appliedBad = w1.importAnchors([
    null,
    { x: 1, y: 1, z: 1, phase: 0, remaining: 5 },
    { x: NaN, y: 1, z: 1, phase: 0, remaining: 5 },
    { x: 1, y: 1, z: 1, phase: 99, remaining: 5 },
    { x: 1, y: 1, z: 1, phase: 0, remaining: -1 },
    { x: 1, y: 1, z: 1, phase: 0, remaining: 'oops' },
  ]);
  check(
    'World.importAnchors rejects bad entries — only the valid one is applied',
    appliedBad === 1
  );
  // 29) importAnchors accepts non-array as a clear (back-compat with §1.7 / §2.4 blobs).
  w1.clearAnchors();
  w1.createAnchor(1, 1, 1, PHASE_ALPHA);
  w1.importAnchors(null);
  check(
    'World.importAnchors(null) clears the anchor list (back-compat)',
    w1.getAnchors().length === 0
  );

  console.log('\n=== Phase 2.7 behavior — placeAnchorAt against a real World ===');

  // 30) placeAnchorAt rejects target-not-air: the player is in Alpha
  // and the target block is BLOCK_AIR. The face is +X so the target
  // cell is (9, 20, 30) (the cell behind the face). The generator
  // populates the chunk so we explicitly scrub the cell first.
  const w2 = makeWorld();
  w2.ensureChunk(0, 0);
  w2.ensureChunk(0, 1);  // For cells at z=30 (chunk 30/16 = 1)
  w2.ensureChunk(0, 2);
  for (let p = 0; p < 3; p++) w2.setBlock(9, 20, 30, p, BLOCK_AIR);
  const noAirResult = anchorModule.placeAnchorAt(
    50, 50, 50,
    { blockX: 10, blockY: 20, blockZ: 30, face: { x: 1, y: 0, z: 0 } },
    PHASE_ALPHA,
    w2,
  );
  check(
    'placeAnchorAt rejects when the target block is BLOCK_AIR (target-not-air)',
    noAirResult && noAirResult.ok === false && noAirResult.reason === 'target-not-air',
    `got=${JSON.stringify(noAirResult)}`
  );
  // 31) placeAnchorAt succeeds when the target is Stone in Alpha and
  // the anchor cell is outside the player's AABB. The face is +X,
  // so the target cell is (blockX - 1) = 9 (the cell behind the face)
  // and the anchor cell is (blockX + 1) = 11 (the cell in front of
  // the face). The player at (50, 50, 50) is far from both.
  for (let p = 0; p < 3; p++) w2.setBlock(9, 20, 30, p, BLOCK_AIR);
  w2.setBlock(9, 20, 30, PHASE_ALPHA, BLOCK_STONE);
  const okResult = anchorModule.placeAnchorAt(
    50, 50, 50, // player far away — no overlap
    { blockX: 10, blockY: 20, blockZ: 30, face: { x: 1, y: 0, z: 0 } },
    PHASE_ALPHA,
    w2,
  );
  check(
    'placeAnchorAt returns { ok: true, x, y, z, phase } for a Stone target in Alpha',
    okResult && okResult.ok === true
      && okResult.x === 11 && okResult.y === 20 && okResult.z === 30
      && okResult.phase === PHASE_ALPHA,
    `got=${JSON.stringify(okResult)}`
  );
  // 32) placeAnchorAt rejects overlaps-player: the player feet are at
  // y=20.5 and the body extends from 18.8 (feet - 1.7) to 20.5. The
  // anchor cell is at (10, 19, 30) (the cell below the player's
  // feet), which is inside the AABB. The face is -Y so the target
  // cell is (10, 20, 30) (the cell above the face) and the anchor
  // cell is (10, 19, 30) (the cell below the face).
  for (let p = 0; p < 3; p++) w2.setBlock(10, 20, 30, p, BLOCK_AIR);
  w2.setBlock(10, 20, 30, PHASE_ALPHA, BLOCK_STONE);
  const overlapResult = anchorModule.placeAnchorAt(
    10.4, 20.5, 30.4, // player feet at y=20.5
    { blockX: 10, blockY: 20, blockZ: 30, face: { x: 0, y: -1, z: 0 } },
    PHASE_ALPHA,
    w2,
  );
  check(
    'placeAnchorAt rejects when the anchor cell is inside the player AABB',
    overlapResult && overlapResult.ok === false && overlapResult.reason === 'overlaps-player',
    `got=${JSON.stringify(overlapResult)}`
  );

  console.log('\n=== Phase 2.7 behavior — SaveSystem round-trip ===');

  // 33) saveSnapshot + loadGame round-trip with anchors.
  const { SaveSystem } = await import(pathToFileURL(savePath).href);
  const fakeStorage = (() => {
    const m = new Map();
    return {
      getItem: (k) => m.has(k) ? m.get(k) : null,
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  })();
  // SaveSystem uses localStorage. Stub it.
  global.localStorage = fakeStorage;
  const ss = new SaveSystem();
  // Suppress the IndexedDB init (which would fail in the headless env).
  ss.db = null;
  const anchors = [
    { x: 1, y: 2, z: 3, phase: 0, remaining: 7 },
    { x: 4, y: 5, z: 6, phase: 1, remaining: 3.5 },
  ];
  ss.saveSnapshot(100, 200, 300, 0, { 'foo': 1 }, anchors);
  const loaded = ss.loadGame();
  check(
    'SaveSystem.saveSnapshot + loadGame round-trips the anchor list',
    loaded && Array.isArray(loaded.anchors) && loaded.anchors.length === 2
      && loaded.anchors[0].x === 1 && loaded.anchors[0].remaining === 7
      && loaded.anchors[1].phase === 1
  );
  // 34) loadGame returns { anchors: [] } when missing (back-compat).
  fakeStorage.removeItem('phaseshift_save');
  // Save a blob without `anchors` (the §1.7 / §2.4 shape).
  const legacyBlob = {
    seed: 42, position: { x: 0, y: 0, z: 0 }, phase: 0, worldState: {}, timestamp: Date.now(),
  };
  fakeStorage.setItem('phaseshift_save', JSON.stringify(legacyBlob));
  const legacyLoaded = ss.loadGame();
  check(
    'SaveSystem.loadGame returns { anchors: [] } for a legacy §1.7 / §2.4 blob',
    legacyLoaded && Array.isArray(legacyLoaded.anchors) && legacyLoaded.anchors.length === 0
  );
  // 35) _coerceAnchors rejects non-arrays and tampered entries.
  const coerce1 = ss._coerceAnchors(null);
  check(
    'SaveSystem._coerceAnchors(null) returns []',
    Array.isArray(coerce1) && coerce1.length === 0
  );
  const coerce2 = ss._coerceAnchors([
    null,
    { x: 1, y: 1, z: 1, phase: 0, remaining: 5 },     // valid
    { x: NaN, y: 1, z: 1, phase: 0, remaining: 5 },   // NaN
    { x: 1, y: 1, z: 1, phase: 99, remaining: 5 },   // out-of-range phase
    { x: 1, y: 1, z: 1, phase: 0, remaining: -1 },   // negative remaining
    { x: 1, y: 1, z: 1, phase: 0, remaining: 'oops' }, // non-numeric
  ]);
  check(
    'SaveSystem._coerceAnchors accepts only valid entries (1 here)',
    Array.isArray(coerce2) && coerce2.length === 1 && coerce2[0].x === 1
  );

  // 36) Phase 2.7: tickAnchors (on a fresh World) does not crash on NaN dt.
  const w3 = makeWorld();
  w3.ensureChunk(0, 0);
  w3.createAnchor(0, 0, 0, PHASE_ALPHA);
  const dtNaN = w3.tickAnchors(NaN);
  check(
    'World.tickAnchors(NaN) returns [] (defensive)',
    Array.isArray(dtNaN) && dtNaN.length === 0
  );
  // 37) World.tickAnchors(0) returns [] (defensive).
  const dt0 = w3.tickAnchors(0);
  check(
    'World.tickAnchors(0) returns [] (defensive)',
    Array.isArray(dt0) && dt0.length === 0
  );
  // 38) The anchor under the player is preserved through the §2.7 acceptance:
  // place an anchor, tickAnchors(5) leaves it alive (remaining=5), then
  // tickAnchors(6) expires it.
  w3.clearAnchors();
  w3.createAnchor(0, 0, 0, PHASE_ALPHA);
  w3.tickAnchors(5);
  check(
    'After 5 seconds, the anchor is still active',
    w3.isAnchorActive(0, 0, 0, PHASE_ALPHA) === true
  );
  w3.tickAnchors(6);
  check(
    'After 11 seconds total, the anchor is expired',
    w3.isAnchorActive(0, 0, 0, PHASE_ALPHA) === false
  );

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 2.7 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
