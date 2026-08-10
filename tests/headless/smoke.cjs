#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 1.1 headless verification: boots a static server, opens the game in
// headless Chromium, captures screenshots, and asserts structural DOM.
//
// Usage:
//   node tests/headless/smoke.cjs                    # auto-spawn static server
//   BASE=http://host:port node tests/headless/smoke.cjs   # use existing server
//
// Notes:
//   - In the Codex sandbox WebGL fails, so init() throws before
//     setupMenuButtons() runs. The test verifies everything that CAN be
//     verified without a working renderer (DOM, init recovery, screenshots).
//   - On a host with working WebGL the click handler tests pass too.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const playwrightCorePath = path.resolve(__dirname, '..', '..', 'node_modules', 'playwright-core');
const { chromium } = require(playwrightCorePath);

const PORT = parseInt(process.env.PORT || '9877', 10);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = process.env.BASE || `http://${HOST}:${PORT}`;
const DIST = path.resolve(__dirname, '..', '..', 'dist');
const SHOTS = path.resolve(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let server;
let serverReady = false;
if (!process.env.BASE) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`FATAL: ${DIST}/index.html missing. Run 'npm run build' first.`);
    process.exit(1);
  }
  const serverScript = path.resolve(__dirname, 'static-server.cjs');
  // inline static server if not present
  if (!fs.existsSync(serverScript)) {
    fs.writeFileSync(serverScript, `const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=${JSON.stringify(DIST)};
const PORT=${PORT}, HOST=${JSON.stringify(HOST)};
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.map':'application/json'};
function safeJoin(r,u){const p=path.normalize(path.join(r,decodeURIComponent(u.split('?')[0])));return p.startsWith(r)?p:null;}
http.createServer((req,res)=>{let f=safeJoin(ROOT,req.url);if(!f){res.writeHead(403);return res.end();}
fs.stat(f,(e,s)=>{if(e||!s.isFile())f=path.join(ROOT,'index.html');fs.readFile(f,(e,d)=>{if(e){res.writeHead(500);return res.end();}
res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});res.end(d);});});}).listen(PORT,HOST,()=>console.log('[server] http://'+HOST+':'+PORT));
`);
  }
  server = spawn('node', [serverScript], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', d => { if (d.toString().includes('http://')) serverReady = true; });
  server.stderr.on('data', d => process.stderr.write(`[server-err] ${d}`));
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const waitForServer = async () => {
  for (let i = 0; i < 50; i++) { if (serverReady || process.env.BASE) return; await wait(200); }
  throw new Error('server failed to start within 10s');
};

const CHROMIUM_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--enable-webgl', '--ignore-gpu-blocklist',
];

(async () => {
  await waitForServer();
  await wait(300);

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push('[pageerror] ' + err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      pageErrors.push('[console] ' + msg.text());
      console.log(`[page:error] ${msg.text()}`);
    }
  });

  console.log(`→ ${BASE}`);
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log(`HTTP ${resp.status()}`);
  await wait(4000);
  await page.screenshot({ path: path.join(SHOTS, '01-blocker.png') });

  const structural = await page.evaluate(() => {
    const ids = ['btn-resume','btn-save','btn-inv','btn-opts','btn-quit',
                 'inv-close','craft-close','opts-close','opt-autosave',
                 'inventory-panel','crafting-panel'];
    return Object.fromEntries(ids.map(id => [id, !!document.getElementById(id)]));
  });
  console.log('\n=== DOM elements (Phase 1.1 must all be true) ===');
  let domOk = true;
  for (const [k, v] of Object.entries(structural)) {
    console.log(`  ${v ? 'OK ' : 'MISS'} ${k}`);
    if (!v) domOk = false;
  }

  await page.evaluate(() => {
    const b = document.getElementById('blocker'); if (b) b.style.display = 'none';
    const pm = document.getElementById('pause-menu'); if (pm) pm.style.display = 'flex';
  });
  await wait(200);
  await page.screenshot({ path: path.join(SHOTS, '02-pause-menu.png') });

  const triggers = [
    ['btn-inv',    'inventory-panel', 'flex'],
    ['inv-close',  'inventory-panel', 'none'],
    ['btn-opts',   'options-panel',   'flex'],
    ['opts-close', 'options-panel',   'none'],
  ];
  const clickResults = [];
  for (const [btnId, panelId, expected] of triggers) {
    if (expected === 'flex') {
      await page.evaluate(() => {
        const pm = document.getElementById('pause-menu'); if (pm) pm.style.display = 'flex';
      });
      await wait(100);
    }
    const triggered = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }, btnId);
    await wait(200);
    const actual = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return el ? getComputedStyle(el).display : null;
    }, panelId);
    clickResults.push({ btnId, panelId, expected, actual, triggered });
  }
  console.log('\n=== click handler results ===');
  for (const r of clickResults) console.log(JSON.stringify(r));

  const webglErr = pageErrors.filter(e => /webgl/i.test(e));
  const otherErr = pageErrors.filter(e => !/webgl/i.test(e));
  const initRecovered = pageErrors.some(e => /Init failed \(recovered\)/.test(e));
  const handlersWork = clickResults.every(r => r.actual === r.expected);

  // ── Phase 1.2 static-analysis checks (against source main.js) ──────────
  // Source-level checks are robust to Vite minification (which renames every
  // identifier). Bundle-level checks were tried first and abandoned because
  // `camera` becomes `Qt`, `EYE_HEIGHT` becomes `Ym`, etc. — too brittle.
  const fs2 = require('fs');
  const mainSrc = path.resolve(__dirname, '..', '..', 'main.js');
  const worldSrc = path.resolve(__dirname, '..', '..', 'src', 'core', 'world.js');
  const srcText = fs2.existsSync(mainSrc) ? fs2.readFileSync(mainSrc, 'utf8') : '';
  const worldText = fs2.existsSync(worldSrc) ? fs2.readFileSync(worldSrc, 'utf8') : '';
  // Old broken formula: atan2(camera.position.x - pos.x, ...)
  const OLD_BROKEN = /atan2\s*\(\s*camera\.position\.x\s*-\s*pos\.x/;
  // New camera-follow: camera.position.set(... + EYE_HEIGHT, ...)
  const NEW_FOLLOW = /camera\.position\.set\s*\([^)]*\+\s*EYE_HEIGHT\b/;
  // New quaternion-derived basis: applyQuaternion(camera.quaternion)
  const NEW_BASIS = /applyQuaternion\s*\(\s*camera\.quaternion\s*\)/;
  const phase12 = {
    old_atan2_gone: srcText ? !OLD_BROKEN.test(srcText) : null,
    new_camera_follow_present: srcText ? NEW_FOLLOW.test(srcText) : null,
    new_quaternion_basis_present: srcText ? NEW_BASIS.test(srcText) : null,
  };
  console.log('\n=== Phase 1.2 static-analysis (against main.js) ===');
  console.log(JSON.stringify(phase12, null, 2));

  // Phase 1.3: hard-coded spawn gone, raycast helper present, log wired.
  const PH13_HARDCODED = /physicsManager\.setPosition\s*\(\s*0\s*,\s*20\s*,\s*0\s*\)/;
  const PH13_HELPER = /(?:findTopSolidBlock|findHighestSolid|raycastDown)/;
  const PH13_LOG = /console\.info\s*\(\s*['"`]\[Phase Shifter\] Spawned at['"`]/;
  const phase13 = {
    hardcoded_setposition_y20_gone: srcText ? !PH13_HARDCODED.test(srcText) : null,
    downward_raycast_helper_present:
      (srcText && PH13_HELPER.test(srcText)) || (worldText && PH13_HELPER.test(worldText)),
    spawn_info_log_wired: srcText ? PH13_LOG.test(srcText) : null,
  };
  console.log('\n=== Phase 1.3 static-analysis (against main.js + src/core/world.js) ===');
  console.log(JSON.stringify(phase13, null, 2));

  // Phase 1.4: indexing is centralized on World and consumers use helpers.
  const rendererSrc = path.resolve(__dirname, '..', '..', 'src', 'render', 'renderer.js');
  const rendererText = fs2.existsSync(rendererSrc) ? fs2.readFileSync(rendererSrc, 'utf8') : '';
  const rendererText2 = rendererText;
  const constantsSrc = path.resolve(__dirname, '..', '..', 'src', 'core', 'constants.js');
  const constantsText = fs2.existsSync(constantsSrc) ? fs2.readFileSync(constantsSrc, 'utf8') : '';
  const getSetText = worldText.slice(worldText.indexOf('getBlock('), worldText.indexOf('// Build/update chunk meshes'));
  const phase14 = {
    world_index_defined: /\bindex\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText),
    world_local_index_defined: /\blocalIndex\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText),
    world_unpack_index_defined: /\bunpackIndex\s*\(\s*i\s*\)/.test(worldText),
    get_set_raw_formulas_gone: !/\b(?:lx|x)\s*\+\s*(?:wy|y)\s*\*\s*CHUNK_SIZE\s*\+\s*(?:lz|z)\s*\*\s*CHUNK_SIZE\s*\*\s*CHUNK_HEIGHT/.test(getSetText),
    renderer_uses_index_helpers: /world\.unpackIndex\s*\(\s*i\s*\)/.test(rendererText) && /world\.localIndex\s*\(\s*nx\s*,\s*ny\s*,\s*nz\s*\)/.test(rendererText),
    // Phase 1.4 + 2.5 + 2.6: performScan (via scanResults) and
    // performResonance (via resonateResults) BOTH delegate to world
    // APIs. No direct world.index calls in main.js — the legacy
    // assertion was "at least 2 uses" (performScan + performResonance
    // hand-rolled chunks). The new contract: 0 uses.
    scans_use_world_index: (srcText.match(/world\.index\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/g) || []).length === 0,
  };
  console.log('\n=== Phase 1.4 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase14, null, 2));

  // Phase 1.5: chunk lookup uses world coordinates and writes use World.setBlock.
  const placeStart = srcText.indexOf('function placeBlockAt(');
  const placeEnd = srcText.indexOf('\n}', placeStart) + 2;
  const placeText = srcText.slice(placeStart, placeEnd);
  const phase15 = {
    world_get_chunk_defined: /getChunk\s*\(\s*x\s*,\s*z\s*\)/.test(worldText),
    legacy_chunk_coordinates_gone: !/\bchunk\.(?:x|z)\b/.test(srcText),
    direct_chunk_data_writes_gone: !/chunk\.(?:alpha|beta|gamma)Data\s*\[[^\]]+\]\s*=/.test(srcText),
    place_block_uses_set_block: /world\.setBlock\s*\(/.test(placeText),
  };
  console.log('\n=== Phase 1.5 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase15, null, 2));

  // Phase 1.6: SaveSystem exposes unified save/load + metadata, and main.js
  // does not touch localStorage / JSON / Date.now directly.
  const saveSrc2 = path.resolve(__dirname, "..", "..", "src", "save", "system.js");
  const saveText = fs2.existsSync(saveSrc2) ? fs2.readFileSync(saveSrc2, 'utf8') : '';
  const phaseSrc = path.resolve(__dirname, '..', '..', 'src', 'core', 'phase.js');
  const phaseText = fs2.existsSync(phaseSrc) ? fs2.readFileSync(phaseSrc, 'utf8') : '';
  const saveFnStart = srcText.indexOf('function saveGame(');
  const saveFnEnd = srcText.indexOf('\n}', saveFnStart) + 2;
  const saveFnText = srcText.slice(saveFnStart, saveFnEnd);
  const phase16 = {
    save_game_defined: /saveGame\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase/.test(saveText),
    load_game_defined: /loadGame\s*\(\s*\)/.test(saveText),
    last_save_info_defined: /getLastSaveInfo\s*\(\s*\)/.test(saveText),
    no_direct_localstorage: !/localStorage/.test(srcText),
    no_direct_json_save_glue: !/JSON\.(?:stringify|parse)/.test(srcText),
    no_direct_date_now: !/Date\.now\s*\(/.test(srcText),
    main_save_routes_via_api: /saveSystem\.saveSnapshot\s*\(/.test(saveFnText),
  };
  console.log('\n=== Phase 1.6 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase16, null, 2));

  // Phase 1 closure: World exports/imports global state and main.js re-applies
  // it on init via the save system.
  const phase17 = {
    world_exports_global_state: /exportGlobalState\s*\(\s*\)/.test(worldText),
    world_imports_global_state: /importGlobalState\s*\(\s*snapshot\s*\)/.test(worldText),
    // Phase 2.7: saveSnapshot now takes an optional anchors argument.
    // The §1.7 / §2.4 contract is "worldState" only; the new contract
    // is "worldState, anchors". Both signatures are valid (the anchors
    // argument is optional, defaults to undefined). The check accepts
    // either signature.
    save_snapshot_defined: /saveSnapshot\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*worldState\s*(?:,\s*anchors\s*)?\)/.test(saveText),
    init_applies_saved_state: /importGlobalState\(_savedState\.worldState\)/.test(srcText),
  };
  console.log('\n=== Phase 1 closure static-analysis (against source files) ===');
  console.log(JSON.stringify(phase17, null, 2));

  // Phase 2.2: phase-relative collision. World.isBlockSolid is the single
  // source of truth for "is this block solid here, now" — it reads
  // BLOCK_PROPERTIES[id].phaseSolid[phase] with a .solid fallback.
  // PhysicsManager._isBlockSolid delegates to it; the renderer must NOT
  // reach into phaseSolid for culling (visibility is per-phase data).
  // Phase 2.3: per-phase place/break. placeBlock is extracted to
  // src/input/placeBlock.js with a (hit, blockId, context) signature so
  // it's testable without Three.js. main.js imports it from there and
  // wires the contextmenu handler to do the RMB disambiguation:
  //   - face hit + non-air target + no overlap → place Stone, skip cycle
  //   - otherwise → cyclePhase() (existing §2.1 behavior)
  // placeAnchor is stubbed (no BLOCK_15 stray write — §2.7 will replace
  // it). World.loadChunk applies _globalStateMap entries on reload so
  // breaks survive chunk unload (the §2.4 acceptance).
  const placeBlockSrc = path.resolve(__dirname, '..', '..', 'src', 'input', 'placeBlock.js');
  const placeBlockText = fs2.existsSync(placeBlockSrc) ? fs2.readFileSync(placeBlockSrc, 'utf8') : '';
  const phase23 = {
    place_block_module_exports_place_block: /export\s+function\s+placeBlock\s*\(/.test(placeBlockText),
    place_block_module_exports_aabb_helper: /export\s+function\s+playerAABBOverlapsCell\s*\(/.test(placeBlockText),
    main_imports_place_block: /import\s*\{[^}]*placeBlock[^}]*\}\s*from\s*['"]\.\/src\/input\/placeBlock\.js['"]/.test(srcText),
    place_block_signature_is_hit_block_id_context: /export\s+function\s+placeBlock\s*\(\s*hit\s*,\s*blockId\s*,\s*context\s*\)/.test(placeBlockText),
    place_block_reads_current_phase: /phaseManager\.getCurrentPhase\s*\(/.test(placeBlockText),
    place_block_writes_via_set_block: /world\.setBlock\s*\(\s*targetX\s*,\s*targetY\s*,\s*targetZ\s*,\s*phase\s*,\s*blockId\s*\)/.test(placeBlockText),
    place_block_refuses_no_hit: /reason:\s*['"]no-hit['"]/.test(placeBlockText),
    place_block_refuses_non_air_target: /existing\s*!==\s*BLOCK_AIR[\s\S]{0,200}?reason:\s*['"]target-not-air['"]/.test(placeBlockText),
    place_block_refuses_player_overlap: /playerAABBOverlapsCell[\s\S]{0,200}?reason:\s*['"]overlaps-player['"]/.test(placeBlockText),
    contextmenu_calls_place_block_with_stone: /addEventListener\(\s*['"]contextmenu['"][\s\S]*?placeBlockAtTarget\s*\([^,]+,\s*BLOCK_STONE/.test(srcText),
    contextmenu_falls_back_to_cycle_phase: /addEventListener\(\s*['"]contextmenu['"][\s\S]*?phaseManager\.cyclePhase\s*\(\s*\)/.test(srcText),
    place_anchor_no_stray_block_15: !/placeBlockAt\s*\([^)]*,\s*15\s*\)/.test(srcText),
    // Phase 2.7: placeAnchor is now a real implementation; the §2.3
    // "deferred notification" stub is gone. This check now verifies
    // the new contract: placeAnchor delegates to placeAnchorAt and
    // calls world.createAnchor.
    place_anchor_no_longer_defers_to_stub: !/placeAnchor[\s\S]{0,400}?Anchor placement pending §2\.7/.test(srcText),
    place_anchor_delegates_to_place_anchor_at: /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,2000}?placeAnchorAt\s*\(/.test(srcText),
    place_anchor_calls_world_create_anchor: /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,2500}?world\.createAnchor\s*\(/.test(srcText),
    spawn_place_particles_defined: /function\s+spawnPlaceParticles\s*\(\s*blockX\s*,\s*blockY\s*,\s*blockZ\s*,\s*blockType\s*\)/.test(srcText),
    place_block_debug_hook_present: /__phaseShifter__[\s\S]*?placeBlock\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*blockType\s*\)/.test(srcText),
    force_cycle_phase_hook_intact: /__phaseShifter__[\s\S]*?forceCyclePhase\s*\(/.test(srcText),
    load_chunk_applies_air_from_global_state: /this\._globalStateMap\.has\s*\(\s*globalKey\s*\)/.test(worldText),
    main_unvalidated_write_primitive_intact: /function\s+placeBlockAt\s*\([^)]*\)[\s\S]*?world\.setBlock\s*\(/.test(srcText),
  };
  console.log('\n=== Phase 2.3 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase23, null, 2));

  // Phase 2.4: phase memory persistence across save/reload. BLOCK_AIR
  // is now a first-class player edit — a break is a real edit and must
  // survive a save → reload round-trip (the wider §2.4 acceptance). The
  // export and import sides no longer filter AIR; the snapshot is the
  // canonical truth on load. SaveSystem._coerceWorldState accepts
  // BLOCK_AIR (id 0) but still rejects NaN / Infinity / fractional /
  // negative / non-numbers.
  const phase24 = {
    export_global_state_preserves_block_air:
      /exportGlobalState[\s\S]{0,400}?out\[key\]\s*=\s*blockId\s*;\s*\/\/\s*Preserve\s+BLOCK_AIR/.test(worldText)
        || /exportGlobalState[\s\S]{0,200}?out\[key\]\s*=\s*blockId\s*;/.test(worldText)
          && !/exportGlobalState[\s\S]*?blockId\s*!==\s*BLOCK_AIR/.test(worldText),
    export_global_state_docstring_phase_2_4:
      /\/\*\*[\s\S]*?exportGlobalState[\s\S]*?Phase 2\.4[\s\S]*?\*\//.test(worldText),
    export_global_state_no_longer_filters_block_air:
      !/exportGlobalState\s*\(\s*\)\s*\{[\s\S]*?blockId\s*!==\s*BLOCK_AIR/.test(worldText),
    import_global_state_preserves_block_air:
      /importGlobalState[\s\S]{0,400}?_globalStateMap\.set\(\s*key\s*,\s*blockId\s*\)/.test(worldText),
    import_global_state_keeps_number_is_finite_guard:
      /importGlobalState[\s\S]{0,400}?Number\.isFinite\s*\(\s*blockId\s*\)/.test(worldText),
    import_global_state_no_longer_filters_block_air:
      !/importGlobalState\s*\(\s*snapshot\s*\)\s*\{[\s\S]*?blockId\s*!==\s*BLOCK_AIR/.test(worldText),
    coerce_world_state_accepts_block_air:
      !/_coerceWorldState[\s\S]*?blockId\s*<=\s*0/.test(saveText),
    coerce_world_state_still_rejects_non_finite:
      /_coerceWorldState[\s\S]*?Number\.isFinite\s*\(\s*blockId\s*\)/.test(saveText),
    coerce_world_state_still_rejects_fractional:
      /_coerceWorldState[\s\S]*?Number\.isInteger\s*\(\s*blockId\s*\)/.test(saveText),
    coerce_world_state_still_rejects_negative:
      /_coerceWorldState[\s\S]*?blockId\s*<\s*0/.test(saveText),
    load_chunk_still_applies_global_state:
      /this\._globalStateMap\.has\s*\(\s*globalKey\s*\)/.test(worldText),
  };
  console.log('\n=== Phase 2.4 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase24, null, 2));

  // Phase 2.5: Phase Lens (hold E to highlight phase-different blocks +
  // beam + energy drain). The new pure module src/scan/lens.js exports
  // the helpers; main.js refactors performScan to delegate to
  // world.findPhaseDifferences (no direct chunk.alphaData reads in
  // the scan loop); the ScanOverlay class lives in src/render/renderer.js
  // and exposes showScanHighlights / clearScanHighlights / showScanBeam
  // / hideScanBeam. New constants PHASE_LENS_DRAIN_RATE = 0.5 and
  // SCAN_RADIUS = 4 are in src/core/constants.js.
  const lensSrc = path.resolve(__dirname, '..', '..', 'src', 'scan', 'lens.js');
  const lensText = fs2.existsSync(lensSrc) ? fs2.readFileSync(lensSrc, 'utf8') : '';
  const phase25 = {
    // Constants
    phase_lens_drain_rate_defined: /export\s+const\s+PHASE_LENS_DRAIN_RATE\s*=\s*0\.5\b/.test(constantsText),
    scan_radius_defined: /export\s+const\s+SCAN_RADIUS\s*=\s*4\b/.test(constantsText),
    // src/scan/lens.js module exports
    lens_module_exports_scan_results: /export\s+function\s+scanResults\s*\(/.test(lensText),
    lens_module_exports_phase_lens_drain: /export\s+function\s+phaseLensDrain\s*\(/.test(lensText),
    lens_module_exports_lens_radius: /export\s+function\s+lensRadius\s*\(/.test(lensText),
    lens_module_exports_below_drain_threshold: /export\s+function\s+belowDrainThreshold\s*\(/.test(lensText),
    lens_module_exports_wireframe_colors: /export\s+const\s+LENS_WIREFRAME_COLORS\s*=\s*\[/.test(lensText),
    // World.findPhaseDifferences
    world_find_phase_differences_defined: /findPhaseDifferences\s*\(\s*playerX\s*,\s*playerY\s*,\s*playerZ\s*,\s*radius\s*,\s*currentPhase\s*\)/.test(worldText),
    world_find_phase_differences_returns_current_phase_block: /findPhaseDifferences[\s\S]{0,1500}?currentPhaseBlock[\s,]+/.test(worldText),
    world_find_phase_differences_returns_other_phases: /findPhaseDifferences[\s\S]{0,1500}?otherPhases[\s,:]+/.test(worldText),
    world_find_phase_differences_excludes_current_phase: /findPhaseDifferences[\s\S]{0,1500}?p\s*!==\s*currentPhase/.test(worldText),
    // main.js wiring
    main_imports_scan_results: /import\s*\{[^}]*scanResults[^}]*\}\s*from\s*['"]\.\/src\/scan\/lens\.js['"]/.test(srcText),
    main_imports_scan_overlay: /import\s*\{[^}]*ScanOverlay[^}]*\}\s*from\s*['"]\.\/src\/render\/renderer\.js['"]/.test(srcText),
    main_imports_phase_lens_drain_rate: /import\s*\{[^}]*PHASE_LENS_DRAIN_RATE[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(srcText),
    // The new performScan delegates to scanResults and does NOT read
    // chunk.alphaData directly (the Phase 1.5 anti-pattern is gone).
    main_perform_scan_no_chunk_alpha_data: (() => {
      const m = srcText.match(/function\s+performScan\s*\([^)]*\)\s*\{[\s\S]*?scanResults\s*\(/);
      return m && !/chunk\.alphaData/.test(m[0]);
    })(),
    // Per-frame lens loop drains energy per dt.
    main_drains_energy_per_dt: /phaseLensDrain\s*\(\s*deltaTime\s*\)[\s\S]{0,200}?consumeEnergy\s*\(\s*drain\s*\)/.test(srcText),
    // Insufficient-energy branch
    main_insufficient_energy_notify: /Insufficient energy/.test(srcText),
    // Debug hooks
    debug_force_scan_hook: /__phaseShifter__[\s\S]*?forceScan\s*\(\s*\)\s*\{[\s\S]*?scanResults\s*\(/.test(srcText),
    debug_start_phase_lens_hook: /__phaseShifter__[\s\S]*?startPhaseLens\s*\(\s*\)/.test(srcText),
    debug_stop_phase_lens_hook: /__phaseShifter__[\s\S]*?stopPhaseLens\s*\(\s*\)/.test(srcText),
    // ScanOverlay API
    scan_overlay_show_scan_highlights: /class\s+ScanOverlay[\s\S]*?showScanHighlights\s*\(\s*results\s*,\s*currentPhase\s*\)/.test(rendererText),
    scan_overlay_clear_scan_highlights: /class\s+ScanOverlay[\s\S]*?clearScanHighlights\s*\(\s*\)/.test(rendererText),
    scan_overlay_show_scan_beam: /class\s+ScanOverlay[\s\S]*?showScanBeam\s*\(\s*camera\s*,\s*currentPhase\s*\)/.test(rendererText),
    scan_overlay_hide_scan_beam: /class\s+ScanOverlay[\s\S]*?hideScanBeam\s*\(\s*\)/.test(rendererText),
    scan_overlay_beam_parented_to_camera: /beam\.parent\s*=\s*camera/.test(rendererText),
    scan_overlay_disposes_geometry: /clearWireframes[\s\S]{0,600}?\.geometry\s*\.dispose\s*\(/.test(rendererText),
  };
  console.log('\n=== Phase 2.5 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase25, null, 2));

  // Phase 2.6: audio source (needed for the AudioManager.playResonance
  // check). Declared ahead of the Phase 2.6 block so it's in scope.
  const audioSrc = path.resolve(__dirname, '..', '..', 'src', 'audio', 'manager.js');
  const audioText2 = fs2.existsSync(audioSrc) ? fs2.readFileSync(audioSrc, 'utf8') : '';

  // Phase 2.6: Resonance (Q) — the one-shot press that swaps phase
  // presence on the blocks around the player. The new pure module
  // src/resonance/resonate.js exports the helpers; main.js
  // refactors performResonance to delegate to world.resonateWithReport
  // (no direct chunk.alphaData reads in the resonance loop). The
  // ResonancePulse class lives in src/render/renderer.js and exposes
  // showResonancePulse / updateResonancePulse / clearResonancePulse.
  // New constants RESONANCE_RADIUS = 1 and RESONANCE_PULSE_DURATION
  // = 1.0 are in src/core/constants.js.
  const resonateSrc = path.resolve(__dirname, '..', '..', 'src', 'resonance', 'resonate.js');
  const resonateText = fs2.existsSync(resonateSrc) ? fs2.readFileSync(resonateSrc, 'utf8') : '';
  const phase26 = {
    // Constants
    resonance_radius_defined: /export\s+const\s+RESONANCE_RADIUS\s*=\s*1\b/.test(constantsText),
    resonance_pulse_duration_defined: /export\s+const\s+RESONANCE_PULSE_DURATION\s*=\s*1\.0\b/.test(constantsText),
    // src/resonance/resonate.js module exports
    resonate_module_exports_resonate_results: /export\s+function\s+resonateResults\s*\(/.test(resonateText),
    resonate_module_exports_resonate_radius: /export\s+function\s+resonateRadius\s*\(/.test(resonateText),
    resonate_module_exports_resonate_cost: /export\s+function\s+resonateCost\s*\(/.test(resonateText),
    resonate_module_exports_total_swapped_count: /export\s+function\s+totalSwappedCount\s*\(/.test(resonateText),
    resonate_module_exports_resonance_sphere_pulse: /export\s+function\s+resonanceSpherePulse\s*\(/.test(resonateText),
    // World.resonateWithReport
    world_resonate_with_report_defined: /resonateWithReport\s*\(\s*cx\s*,\s*cy\s*,\s*cz\s*,\s*radius\s*,\s*currentPhase\s*\)/.test(worldText),
    world_resonate_with_report_returns_results: /resonateWithReport[\s\S]{0,3000}?return\s*\{[^}]*results:/.test(worldText),
    world_resonate_with_report_returns_count: /resonateWithReport[\s\S]{0,3000}?return\s*\{[^}]*,\s*count\s*\}/.test(worldText),
    world_resonate_with_report_per_cell_has_swapped_phases: /resonateWithReport[\s\S]{0,2000}?swappedPhases/.test(worldText),
    // main.js wiring
    main_imports_resonate_results: /import\s*\{[^}]*resonateResults[^}]*\}\s*from\s*['"]\.\/src\/resonance\/resonate\.js['"]/.test(srcText),
    main_imports_resonance_pulse: /import\s*\{[^}]*ResonancePulse[^}]*\}\s*from\s*['"]\.\/src\/render\/renderer\.js['"]/.test(srcText),
    main_imports_resonance_radius: /import\s*\{[^}]*RESONANCE_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(srcText),
    // The new performResonance delegates to resonateResults and does
    // NOT read chunk.alphaData directly (the Phase 1.5 anti-pattern
    // is gone — same fix Phase 2.5 made for performScan).
    main_perform_resonance_no_chunk_alpha_data: (() => {
      // Locate the function body by scanning from the function header.
      // The body may contain nested braces, so we count braces by
      // looking for the closing brace of the function declaration.
      const headerIdx = srcText.indexOf('function performResonance(');
      if (headerIdx === -1) return false;
      // Find the closing brace by tracking brace depth.
      let depth = 0;
      let sawOpen = false;
      let end = headerIdx;
      for (let i = headerIdx; i < srcText.length; i++) {
        const c = srcText[i];
        if (c === '{') { depth++; sawOpen = true; }
        else if (c === '}') { depth--; if (sawOpen && depth === 0) { end = i + 1; break; } }
      }
      const body = srcText.slice(headerIdx, end);
      return body.includes('resonateResults') && !/chunk\.alphaData/.test(body);
    })(),
    main_perform_resonance_uses_resonate_results: /function\s+performResonance[\s\S]*?resonateResults\s*\(/.test(srcText),
    main_perform_resonance_uses_resonate_cost: /function\s+performResonance[\s\S]*?resonateCost\s*\(\s*\)/.test(srcText),
    main_perform_resonance_uses_resonate_radius: /function\s+performResonance[\s\S]*?resonateRadius\s*\(\s*\)/.test(srcText),
    main_perform_resonance_consumes_energy: /function\s+performResonance[\s\S]*?phaseManager\.consumeEnergy\s*\(\s*resonateCost\s*\(\s*\)\s*\)/.test(srcText),
    // Insufficient-energy branch
    main_insufficient_energy_notify: /resonance_insufficientNotifiedThisPress/.test(srcText) && /Insufficient energy/.test(srcText),
    // Per-frame pulse update
    main_advances_resonance_pulse_per_frame: /renderer\.updateResonancePulse\s*\(\s*deltaTime\s*\)/.test(srcText),
    // Debug hooks
    debug_force_resonate_hook: /__phaseShifter__[\s\S]*?forceResonate\s*\(\s*\)\s*\{[\s\S]*?resonateResults\s*\(/.test(srcText),
    debug_get_resonance_pulse_mesh_count: /__phaseShifter__[\s\S]*?getResonancePulseMeshCount\s*\(\s*\)/.test(srcText),
    debug_get_resonance_pulse_visible: /__phaseShifter__[\s\S]*?getResonancePulseVisible\s*\(\s*\)/.test(srcText),
    debug_clear_resonance_pulse: /__phaseShifter__[\s\S]*?clearResonancePulse\s*\(\s*\)/.test(srcText),
    // ResonancePulse class API
    resonance_pulse_show: /class\s+ResonancePulse[\s\S]*?showResonancePulse\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*currentPhase\s*\)/.test(rendererText),
    resonance_pulse_update: /class\s+ResonancePulse[\s\S]*?updateResonancePulse\s*\(\s*dt\s*\)/.test(rendererText),
    resonance_pulse_clear: /class\s+ResonancePulse[\s\S]*?clearResonancePulse\s*\(\s*\)/.test(rendererText),
    resonance_pulse_own_group: /class\s+ResonancePulse[\s\S]*?this\.group\.name\s*=\s*['"]resonancePulse['"]/.test(rendererText),
    resonance_pulse_auto_disposes: /class\s+ResonancePulse[\s\S]*?updateResonancePulse[\s\S]*?clearResonancePulse\s*\(\s*\)/.test(rendererText),
    // Renderer forwarding
    renderer_show_resonance_pulse_forwards: /showResonancePulse\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*currentPhase\s*\)\s*\{[\s\S]*?this\.resonancePulse\.showResonancePulse/.test(rendererText),
    renderer_update_resonance_pulse_forwards: /updateResonancePulse\s*\(\s*dt\s*\)\s*\{[\s\S]*?this\.resonancePulse\.updateResonancePulse/.test(rendererText),
    renderer_clear_resonance_pulse_forwards: /clearResonancePulse\s*\(\s*\)\s*\{[\s\S]*?this\.resonancePulse\.clearResonancePulse/.test(rendererText),
    // AudioManager.playResonance(phase)
    audio_play_resonance_with_phase: /playResonance\s*\(\s*phase\s*\)/.test(audioText2) || /playResonance\s*\(\s*phase\s*=\s*0\s*\)/.test(audioText2),
  };

  // Phase 2.7: Phase Anchor (Shift+LMB) — the player-placed lock that
  // holds the player on a block through a phase shift. The new pure
  // module src/anchor/anchor.js exports placeAnchorAt, snapYForCell,
  // cellUnderPlayer, anchorLifetime, anchorFadeOpacity,
  // anchorBorderOpacity, anchorKey, tickAnchors, isAnchorExpired.
  // The new ANCHOR_LIFETIME / ANCHOR_FADE_WINDOW / ANCHOR_FILL_COLOR /
  // ANCHOR_BORDER_COLOR / ANCHOR_COST constants are in
  // src/core/constants.js. World gains createAnchor / removeAnchor /
  // tickAnchors / findAnchorUnderPlayer / isAnchorActive /
  // exportAnchors / importAnchors / clearAnchors. main.js#placeAnchor
  // is now a real implementation (replaces the Phase 2.3 stub).
  // onPhaseChanged calls findAnchorUnderPlayer + setPosition
  // (the §2.7 snap-to-anchor logic). The per-frame game loop calls
  // tickAnchorsPerFrame(deltaTime). SaveSystem.saveSnapshot accepts
  // an anchor list. The new AnchorOverlay class in
  // src/render/renderer.js owns its own THREE.Group named
  // 'anchorOverlay'.
  const anchorSrc = path.resolve(__dirname, '..', '..', 'src', 'anchor', 'anchor.js');
  const anchorText = fs2.existsSync(anchorSrc) ? fs2.readFileSync(anchorSrc, 'utf8') : '';
  const saveSrc3 = path.resolve(__dirname, "..", "..", "src", "save", "system.js");
  const saveText3 = fs2.existsSync(saveSrc3) ? fs2.readFileSync(saveSrc3, 'utf8') : '';
  const phase27 = {
    // Constants
    anchor_lifetime_defined: /export\s+const\s+ANCHOR_LIFETIME\s*=\s*10\b/.test(constantsText),
    anchor_fade_window_defined: /export\s+const\s+ANCHOR_FADE_WINDOW\s*=\s*3\b/.test(constantsText),
    anchor_fill_color_defined: /export\s+const\s+ANCHOR_FILL_COLOR\s*=\s*0xffee88\b/.test(constantsText),
    anchor_border_color_defined: /export\s+const\s+ANCHOR_BORDER_COLOR\s*=\s*0xffcc00\b/.test(constantsText),
    anchor_cost_zero: /export\s+const\s+ANCHOR_COST\s*=\s*0\b/.test(constantsText),
    // src/anchor/anchor.js module exports
    anchor_module_exports_place_anchor_at: /export\s+function\s+placeAnchorAt\s*\(/.test(anchorText),
    anchor_module_exports_snap_y_for_cell: /export\s+function\s+snapYForCell\s*\(/.test(anchorText),
    anchor_module_exports_cell_under_player: /export\s+function\s+cellUnderPlayer\s*\(/.test(anchorText),
    anchor_module_exports_anchor_lifetime: /export\s+function\s+anchorLifetime\s*\(/.test(anchorText),
    anchor_module_exports_anchor_fade_opacity: /export\s+function\s+anchorFadeOpacity\s*\(/.test(anchorText),
    anchor_module_exports_anchor_key: /export\s+function\s+anchorKey\s*\(/.test(anchorText),
    anchor_module_exports_tick_anchors: /export\s+function\s+tickAnchors\s*\(/.test(anchorText),
    // World API
    world_create_anchor_defined: /createAnchor\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*\)/.test(worldText),
    world_remove_anchor_defined: /removeAnchor\s*\(/.test(worldText),
    world_tick_anchors_defined: /tickAnchors\s*\(\s*dt\s*\)/.test(worldText),
    world_find_anchor_under_player_defined: /findAnchorUnderPlayer\s*\(/.test(worldText),
    world_is_anchor_active_defined: /isAnchorActive\s*\(/.test(worldText),
    world_export_anchors_defined: /exportAnchors\s*\(/.test(worldText),
    world_import_anchors_defined: /importAnchors\s*\(/.test(worldText),
    world_anchors_map_initialized: /this\._anchors\s*=\s*new\s+Map\s*\(\s*\)/.test(worldText),
    // main.js wiring
    main_imports_place_anchor_at: /import\s*\{[^}]*placeAnchorAt[^}]*\}\s*from\s*['"]\.\/src\/anchor\/anchor\.js['"]/.test(srcText),
    main_imports_anchor_overlay: /import\s*\{[^}]*AnchorOverlay[^}]*\}\s*from\s*['"]\.\/src\/render\/renderer\.js['"]/.test(srcText),
    main_place_anchor_delegates: /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,2000}?placeAnchorAt\s*\(/.test(srcText),
    main_place_anchor_creates: /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,2500}?world\.createAnchor\s*\(/.test(srcText),
    main_place_anchor_shows: /function\s+placeAnchor\s*\(\s*\)\s*\{[\s\S]{0,3000}?renderer\.showAnchor\s*\(/.test(srcText),
    main_place_anchor_no_block_15: !/placeBlockAt\s*\([^)]*,\s*15\s*\)/.test(srcText),
    main_place_anchor_no_deferred_notification: !/Anchor placement pending §2\.7/.test(srcText),
    main_on_phase_changed_snap_to_anchor: /function\s+onPhaseChanged[\s\S]*?findAnchorUnderPlayer\s*\(/.test(srcText) && /function\s+onPhaseChanged[\s\S]*?physicsManager\.setPosition\s*\(/.test(srcText),
    main_per_frame_tick_anchors: /tickAnchorsPerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    main_save_game_passes_anchors: /function\s+saveGame[\s\S]{0,1500}?saveSystem\.saveSnapshot\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*anchors\s*\)/.test(srcText),
    main_init_imports_saved_anchors: /world\.importAnchors\s*\(/.test(srcText),
    // SaveSystem wiring
    save_snapshot_accepts_anchors: /saveSnapshot\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*worldState\s*,\s*anchors\s*\)/.test(saveText),
    save_coerce_anchors_defined: /_coerceAnchors\s*\(/.test(saveText),
    save_load_game_returns_anchors: /loadGame\s*\(\s*\)[\s\S]{0,2000}?anchors\s*:\s*this\._coerceAnchors/.test(saveText),
    // AnchorOverlay + Renderer forwarding
    anchor_overlay_class_exported: /export\s+class\s+AnchorOverlay\b/.test(rendererText),
    anchor_overlay_own_group: /class\s+AnchorOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]anchorOverlay['"]/.test(rendererText),
    renderer_show_anchor_forwards: /showAnchor\s*\(\s*anchor\s*\)\s*\{[\s\S]*?this\.anchorOverlay\.showAnchor/.test(rendererText),
    renderer_update_anchors_forwards: /updateAnchors\s*\(\s*snapshot\s*,\s*removedKeys\s*\)\s*\{[\s\S]*?this\.anchorOverlay\.updateAnchors/.test(rendererText),
    renderer_clear_anchors_forwards: /clearAnchors\s*\(\s*\)\s*\{[\s\S]*?this\.anchorOverlay\.clearAnchors/.test(rendererText),
    // Debug hooks
    debug_force_place_anchor: /__phaseShifter__[\s\S]*?forcePlaceAnchor\s*\(/.test(srcText),
    debug_get_anchor_count: /__phaseShifter__[\s\S]*?getAnchorCount\s*\(/.test(srcText),
    debug_get_anchor_mesh_count: /__phaseShifter__[\s\S]*?getAnchorMeshCount\s*\(/.test(srcText),
    debug_get_anchor_keys: /__phaseShifter__[\s\S]*?getAnchorKeys\s*\(/.test(srcText),
    debug_clear_anchors: /__phaseShifter__[\s\S]*?clearAnchors\s*\(\s*\)/.test(srcText),
    debug_is_anchor_at: /__phaseShifter__[\s\S]*?isAnchorAt\s*\(/.test(srcText),
    debug_tick_anchors_hook: /__phaseShifter__[\s\S]*?tickAnchors\s*\(\s*dt\s*\)/.test(srcText),
    debug_find_anchor_under_player_hook: /__phaseShifter__[\s\S]*?findAnchorUnderPlayer\s*\(/.test(srcText),
  };

  // Phase 2.8: Audio integration — ambient music on phase change,
  // footsteps on phase-and-block-filtered ground, crunch on break,
  // chime on shift, bass pulse on resonance, and
  // audioManager.init() only when the user clicks the blocker.
  //
  // The new pure module src/audio/footsteps.js exports
  // footstepInterval, shouldPlayFootstep, materialFromBlock,
  // FOOTSTEP_MATERIALS. The new constants FOOTSTEP_INTERVAL = 0.4
  // is in src/core/constants.js. main.js#blocker click listener
  // calls audioManager.init() (the lazy init — the §2.8 acceptance
  // is that init() fires on the user gesture, not in the subsequent
  // pointerlockchange handler). The per-frame game loop calls
  // shouldPlayFootstep + audioManager.playFootstep (the footstep
  // throttle path). breakBlock calls audioManager.playBlockBreak;
  // tryPlaceStoneOnFace and __phaseShifter__.placeBlock call
  // audioManager.playBlockPlace. onPhaseChanged calls
  // stopAmbientMusic BEFORE startAmbientMusic (the §2.8 ordering
  // contract).
  const footstepsSrc = path.resolve(__dirname, '..', '..', 'src', 'audio', 'footsteps.js');
  const footstepsText = fs2.existsSync(footstepsSrc) ? fs2.readFileSync(footstepsSrc, 'utf8') : '';
  const phase28 = {
    // Constants
    footstep_interval_defined: /export\s+const\s+FOOTSTEP_INTERVAL\s*=\s*0\.4\b/.test(constantsText),
    // src/audio/footsteps.js module exports
    footsteps_module_exports_footstep_interval: /export\s+function\s+footstepInterval\s*\(/.test(footstepsText),
    footsteps_module_exports_should_play_footstep: /export\s+function\s+shouldPlayFootstep\s*\(/.test(footstepsText),
    footsteps_module_exports_material_from_block: /export\s+function\s+materialFromBlock\s*\(/.test(footstepsText),
    footsteps_module_exports_footstep_materials: /export\s+const\s+FOOTSTEP_MATERIALS\b/.test(footstepsText),
    // AudioEngine API
    audio_play_shift_defined: /playShift\s*\(\s*phase\s*\)/.test(audioText2),
    audio_play_resonance_defined: /playResonance\s*\(\s*phase\s*(?:=\s*0)?\s*\)/.test(audioText2),
    audio_play_block_break_defined: /playBlockBreak\s*\(\s*\)/.test(audioText2),
    audio_play_block_place_defined: /playBlockPlace\s*\(\s*\)/.test(audioText2),
    audio_play_collapse_defined: /playCollapse\s*\(\s*\)/.test(audioText2),
    audio_play_footstep_defined: /playFootstep\s*\(\s*material[^)]*\)/.test(audioText2),
    audio_start_ambient_music_defined: /startAmbientMusic\s*\(\s*phase\s*\)/.test(audioText2),
    audio_stop_ambient_music_defined: /stopAmbientMusic\s*\(\s*\)/.test(audioText2),
    audio_play_footstep_has_fallback: /freqs\[material\]\s*\|\|\s*\d+/.test(audioText2),
    // main.js wiring
    main_imports_should_play_footstep: /import\s*\{[^}]*shouldPlayFootstep[^}]*\}\s*from\s*['"]\.\/src\/audio\/footsteps\.js['"]/.test(srcText),
    main_imports_material_from_block: /import\s*\{[^}]*materialFromBlock[^}]*\}\s*from\s*['"]\.\/src\/audio\/footsteps\.js['"]/.test(srcText),
    main_imports_footstep_interval: /import\s*\{[^}]*FOOTSTEP_INTERVAL[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(srcText),
    // Lazy init: audioManager.init() fires on the blocker click, not in the pointerlockchange listener.
    main_blocker_click_listener_calls_init: (() => {
      const start = srcText.indexOf("blocker.addEventListener('click'");
      const end2 = srcText.indexOf("addEventListener('pointerlockchange'");
      if (start < 0 || end2 <= start) return false;
      const body = srcText.slice(start, end2);
      return /audioManager\.init\s*\(\s*\)/.test(body);
    })(),
    main_blocker_click_listener_calls_resume: (() => {
      const start = srcText.indexOf("blocker.addEventListener('click'");
      const end2 = srcText.indexOf("addEventListener('pointerlockchange'");
      if (start < 0 || end2 <= start) return false;
      const body = srcText.slice(start, end2);
      return /audioManager\.resume\s*\(\s*\)/.test(body);
    })(),
    main_pointerlockchange_listener_no_init: (() => {
      const start = srcText.indexOf("addEventListener('pointerlockchange'");
      const end2 = srcText.indexOf('// HUD', start);
      if (start < 0 || end2 <= start) return false;
      const body = srcText.slice(start, end2);
      return !/audioManager\.init\s*\(\s*\)/.test(body);
    })(),
    main_pointerlockchange_listener_calls_resume: (() => {
      const start = srcText.indexOf("addEventListener('pointerlockchange'");
      const end2 = srcText.indexOf('// HUD', start);
      if (start < 0 || end2 <= start) return false;
      const body = srcText.slice(start, end2);
      return /audioManager\.resume\s*\(\s*\)/.test(body);
    })(),
    // Per-frame footstep tick
    main_game_loop_calls_should_play_footstep: /function\s+gameLoop[\s\S]*?shouldPlayFootstep\s*\(/.test(srcText),
    main_game_loop_calls_play_footstep: /function\s+gameLoop[\s\S]*?audioManager\.playFootstep\s*\(/.test(srcText),
    main_game_loop_calls_material_from_block: /function\s+gameLoop[\s\S]*?materialFromBlock\s*\(/.test(srcText),
    main_game_loop_uses_world_get_block_per_phase: /function\s+gameLoop[\s\S]*?world\.getBlock\s*\([^)]*phaseManager\.getCurrentPhase\s*\(\s*\)/.test(srcText),
    main_footstep_tick_no_chunk_alpha_data: (() => {
      const tickMatch = srcText.match(/Phase 2\.8: footstep tick[\s\S]*?Camera follow \(Phase 1\.2\)/);
      return tickMatch ? !/chunk\.alphaData/.test(tickMatch[0]) : false;
    })(),
    // playBlockBreak / playBlockPlace call sites
    main_break_block_calls_play_block_break: /function\s+breakBlock[\s\S]*?audioManager\.playBlockBreak\s*\(/.test(srcText),
    main_try_place_stone_on_face_calls_play_block_place: /function\s+tryPlaceStoneOnFace[\s\S]*?audioManager\.playBlockPlace\s*\(/.test(srcText),
    main_place_block_debug_hook_calls_play_block_place: /__phaseShifter__[\s\S]*?placeBlock\s*\([\s\S]*?audioManager\.playBlockPlace\s*\(/.test(srcText),
    // onPhaseChanged ordering
    main_on_phase_changed_stop_before_start: /function\s+onPhaseChanged[\s\S]*?audioManager\.stopAmbientMusic\s*\(\s*\)[\s\S]*?audioManager\.startAmbientMusic\s*\(\s*phase\s*\)/.test(srcText),
    main_on_phase_changed_calls_play_shift: /function\s+onPhaseChanged[\s\S]*?audioManager\.playShift\s*\(\s*phase\s*\)/.test(srcText),
    // Debug hooks
    debug_force_play_footstep_hook: /__phaseShifter__[\s\S]*?forcePlayFootstep\s*\(/.test(srcText),
    debug_tick_footsteps_hook: /__phaseShifter__[\s\S]*?tickFootsteps\s*\(\s*dt\s*,\s*ctx\s*\)/.test(srcText),
    debug_get_footstep_timer_hook: /__phaseShifter__[\s\S]*?getFootstepTimer\s*\(/.test(srcText),
    debug_force_phase_collapse_hook: /__phaseShifter__[\s\S]*?forcePhaseCollapse\s*\(/.test(srcText),
    debug_play_block_break_debug_hook: /__phaseShifter__[\s\S]*?playBlockBreakDebug\s*\(/.test(srcText),
    debug_play_block_place_debug_hook: /__phaseShifter__[\s\S]*?playBlockPlaceDebug\s*\(/.test(srcText),
    debug_play_shift_debug_hook: /__phaseShifter__[\s\S]*?playShiftDebug\s*\(\s*phase\s*\)/.test(srcText),
    debug_play_resonance_debug_hook: /__phaseShifter__[\s\S]*?playResonanceDebug\s*\(\s*phase\s*\)/.test(srcText),
    debug_play_collapse_debug_hook: /__phaseShifter__[\s\S]*?playCollapseDebug\s*\(/.test(srcText),
    debug_play_footstep_debug_hook: /__phaseShifter__[\s\S]*?playFootstepDebug\s*\(\s*material\s*\)/.test(srcText),
    debug_start_ambient_music_debug_hook: /__phaseShifter__[\s\S]*?startAmbientMusicDebug\s*\(\s*phase\s*\)/.test(srcText),
    debug_stop_ambient_music_debug_hook: /__phaseShifter__[\s\S]*?stopAmbientMusicDebug\s*\(/.test(srcText),
  };


  const physicsSrc = path.resolve(__dirname, '..', '..', 'src', 'core', 'physics.js');
  const physicsText2 = fs2.existsSync(physicsSrc) ? fs2.readFileSync(physicsSrc, 'utf8') : '';
  const phase22 = {
    world_is_block_solid_defined: /isBlockSolid\s*\(\s*x\s*,\s*y\s*,\s*z\s*(?:,\s*phase[^)]*)?\s*\)/.test(worldText),
    world_is_block_solid_reads_phase_solid: /props\.phaseSolid\s*\[\s*phase\s*\]/.test(worldText),
    world_is_block_solid_falls_back_to_solid: /props\.phaseSolid[\s\S]{0,200}?props\.solid/.test(worldText),
    world_is_block_solid_not_legacy_only: !/isBlockSolid[\s\S]*?return\s+props\.solid\s*;/.test(worldText),
    physics_delegates_to_world_is_block_solid: /_isBlockSolid[\s\S]{0,200}?this\._world\.isBlockSolid\s*\(/.test(physicsText2),
    physics_has_no_bare_props_solid_reads: !/\bprops\.solid\b/.test(physicsText2),
    physics_check_collision_uses_is_block_solid: (physicsText2.match(/_isBlockSolid\s*\(/g) || []).length >= 3,
    renderer_does_not_use_phase_solid: !/phaseSolid/.test(rendererText),
    renderer_uses_phase_data_for_culling: /data\s*\[\s*ni\s*\]\s*!==\s*BLOCK_AIR/.test(rendererText),
    renderer_is_surrounded_does_not_consult_block_properties: !/isSurrounded[\s\S]*?BLOCK_PROPERTIES/.test(rendererText),
    physics_does_not_redefine_phase_cycling: !/cyclePhase\s*\(/.test(physicsText2) && !/forceCyclePhase/.test(physicsText2),
  };
  console.log('\n=== Phase 2.2 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase22, null, 2));

  // Phase 2.1: hud / html sources. (audioText2 is declared above the
  // Phase 2.6 block so it's in scope for both phases.)
  const hudSrc = path.resolve(__dirname, '..', '..', 'src', 'ui', 'hud.js');
  const htmlSrc = path.resolve(__dirname, '..', '..', 'index.html');
  const hudText2 = fs2.existsSync(hudSrc) ? fs2.readFileSync(hudSrc, 'utf8') : '';
  const htmlText2 = fs2.existsSync(htmlSrc) ? fs2.readFileSync(htmlSrc, 'utf8') : '';
  const phase21 = {
    audio_play_shift_defined: /playShift\s*\(\s*phase\s*\)/.test(audioText2),
    post_processing_set_phase_alias: /setPhase\s*\(\s*phase\s*\)\s*\{[\s\S]*?uPhase\.value\s*=\s*phase/.test(rendererText),
    post_processing_update_phase_present: /updatePhase\s*\(\s*phase\s*,\s*resonating\s*\)/.test(rendererText),
    cycle_phase_spam_guard: /if\s*\(\s*this\._isShifting\s*\|\|\s*this\._energy\s*<\s*PHASE_SHIFT_COST\s*\)\s*\{\s*return\s+false/.test(phaseText),
    html_phase_indicator_present: /id\s*=\s*["']phase-indicator["']/.test(htmlText2),
    html_phase_shift_overlay_present: /id\s*=\s*["']phase-shift-overlay["']/.test(htmlText2),
    main_phase_indicator_color_wired: /phaseIndicatorEl\.style\.backgroundColor/.test(srcText),
    hud_phase_indicator_color_wired: /(?:phase-indicator|phaseIndicator)[\s\S]{0,400}?style\.backgroundColor/.test(hudText2),
    main_on_phase_changed_calls_set_phase: /postProcessing\.setPhase\s*\(\s*phase\s*\)/.test(srcText),
    main_drives_shift_overlay: /updatePhaseShiftOverlay\s*\(/.test(srcText) &&
      /phase-shift-overlay["']/.test(srcText) && /getPhaseShiftProgress\s*\(/.test(srcText),
    force_cycle_phase_hook_intact: /__phaseShifter__[\s\S]*?forceCyclePhase\s*\(/.test(srcText),
    contextmenu_prevent_default_intact: /addEventListener\(\s*['"]contextmenu['"][\s\S]*?e\.preventDefault\(\)[\s\S]{0,400}?cyclePhase\s*\(\s*\)/.test(srcText),
  };
  console.log('\n=== Phase 2.1 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase21, null, 2));


  // ── Phase 3.1 (Biomes) ────────────────────────────────────────
  // The Phase 3.1 work surfaces the current biome in the HUD, tints
  // the skybox + fog per biome, and lays the ground for §3.2-3.4.
  // The pure module src/world/biome.js exports BIOME_TINTS (8 entries)
  // + biomeTint / biomeLabel / biomeFogDensity / lerpBiomeTints /
  // biomeTransitionDuration. main.js wires the per-frame biome tick
  // (tickBiomesPerFrame) and the debug hooks (forceBiome,
  // getCurrentBiomeId, etc). The renderer's skybox shader now blends
  // a per-biome tint with a per-phase tint multiplicatively. The HUD
  // updates the #biome-info DOM element on the change edge.
  const biomeSrc = path.resolve(__dirname, '..', '..', 'src', 'world', 'biome.js');
  const biomeText = fs2.existsSync(biomeSrc) ? fs2.readFileSync(biomeSrc, 'utf8') : '';
  const phase31 = {
    // src/world/biome.js module shape
    biome_module_exports_biome_tints: /export\s+const\s+BIOME_TINTS\s*=\s*Object\.freeze\s*\(/.test(biomeText),
    biome_module_exports_biome_tint_fn: /export\s+function\s+biomeTint\s*\(/.test(biomeText),
    biome_module_exports_biome_label_fn: /export\s+function\s+biomeLabel\s*\(/.test(biomeText),
    biome_module_exports_biome_fog_density_fn: /export\s+function\s+biomeFogDensity\s*\(/.test(biomeText),
    biome_module_exports_lerp_biome_tints_fn: /export\s+function\s+lerpBiomeTints\s*\(/.test(biomeText),
    biome_module_exports_biome_transition_duration_fn: /export\s+function\s+biomeTransitionDuration\s*\(/.test(biomeText),
    biome_module_re_exports_biome_forest: /export\s*\{[^}]*\bBIOME_FOREST\b[^}]*\}\s*;?/.test(biomeText),
    biome_module_re_exports_biome_crystal_cavern: /export\s*\{[^}]*\bBIOME_CRYSTAL_CAVERN\b[^}]*\}\s*;?/.test(biomeText),
    biome_module_re_exports_biome_phase_nexus: /export\s*\{[^}]*\bBIOME_PHASE_NEXUS\b[^}]*\}\s*;?/.test(biomeText),
    biome_module_re_exports_biome_names: /export\s*\{[^}]*\bBIOME_NAMES\b[^}]*\}\s*;?/.test(biomeText),
    // BIOME_TINTS shape (8 entries, each with color + fogDensity)
    biome_tints_has_forest_entry: /\[BIOME_FOREST\][\s\S]{0,80}?fogDensity:\s*0\.006/.test(biomeText),
    biome_tints_has_caves_entry: /\[BIOME_CAVES\][\s\S]{0,80}?fogDensity:\s*0\.012/.test(biomeText),
    biome_tints_has_deep_void_entry: /\[BIOME_DEEP_VOID\][\s\S]{0,80}?fogDensity:\s*0\.025/.test(biomeText),
    biome_tints_has_ruins_entry: /\[BIOME_RUINS\][\s\S]{0,80}?fogDensity:\s*0\.008/.test(biomeText),
    biome_tints_has_desert_entry: /\[BIOME_DESERT\][\s\S]{0,80}?fogDensity:\s*0\.004/.test(biomeText),
    biome_tints_has_crystal_cavern_entry: /\[BIOME_CRYSTAL_CAVERN\][\s\S]{0,80}?fogDensity:\s*0\.014/.test(biomeText),
    biome_tints_has_sky_ruins_entry: /\[BIOME_SKY_RUINS\][\s\S]{0,80}?fogDensity:\s*0\.005/.test(biomeText),
    biome_tints_has_phase_nexus_entry: /\[BIOME_PHASE_NEXUS\][\s\S]{0,80}?fogDensity:\s*0\.018/.test(biomeText),
    // main.js imports from src/world/biome.js
    main_imports_biome_tint_from_biome_module: /import\s*\{[^}]*\bbiomeTint\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(srcText),
    main_imports_biome_label_from_biome_module: /import\s*\{[^}]*\bbiomeLabel\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(srcText),
    main_imports_biome_fog_density_from_biome_module: /import\s*\{[^}]*\bbiomeFogDensity\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(srcText),
    main_imports_lerp_biome_tints_from_biome_module: /import\s*\{[^}]*\blerpBiomeTints\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(srcText),
    main_imports_biome_transition_duration_from_biome_module: /import\s*\{[^}]*\bbiomeTransitionDuration\b[^}]*\}\s*from\s*['"]\.\/src\/world\/biome\.js['"]/.test(srcText),
    // main.js module-level state
    main_module_level_current_biome_id_decl: /^\s*let\s+currentBiomeId\s*=/m.test(srcText),
    main_module_level_current_biome_tint_decl: /^\s*let\s+currentBiomeTint\s*=/m.test(srcText),
    main_module_level_target_biome_tint_decl: /^\s*let\s+targetBiomeTint\s*=/m.test(srcText),
    main_module_level_biome_transition_timer_decl: /^\s*let\s+biomeTransitionTimer\s*=/m.test(srcText),
    // main.js tickBiomesPerFrame + game loop wiring
    main_tick_biomes_per_frame_defined: /function\s+tickBiomesPerFrame\s*\(/.test(srcText),
    main_tick_biomes_per_frame_reads_world_get_biome: /function\s+tickBiomesPerFrame[\s\S]{0,2000}?world\.getBiome\s*\(/.test(srcText),
    main_tick_biomes_per_frame_uses_lerp_biome_tints: /function\s+tickBiomesPerFrame[\s\S]{0,2000}?lerpBiomeTints\s*\(/.test(srcText),
    main_tick_biomes_per_frame_drives_scene_background: /function\s+tickBiomesPerFrame[\s\S]{0,6000}?scene\.background\.setRGB/.test(srcText),
    main_tick_biomes_per_frame_drives_scene_fog_color: /function\s+tickBiomesPerFrame[\s\S]{0,6000}?scene\.fog\.color\.setRGB/.test(srcText),
    main_tick_biomes_per_frame_drives_scene_fog_density: /function\s+tickBiomesPerFrame[\s\S]{0,6000}?scene\.fog\.density/.test(srcText),
    main_tick_biomes_per_frame_drives_phase_light_color: /function\s+tickBiomesPerFrame[\s\S]{0,6000}?lighting\.phaseLight\.color/.test(srcText),
    main_tick_biomes_per_frame_drives_renderer_set_biome_tint: /function\s+tickBiomesPerFrame[\s\S]{0,6000}?renderer\.setBiomeTint\s*\(/.test(srcText),
    main_game_loop_calls_tick_biomes_per_frame: /tickBiomesPerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    // main.js onPhaseChanged drives the phase tint uniform
    main_on_phase_changed_calls_set_phase_tint: /function\s+onPhaseChanged[\s\S]*?renderer\.setPhaseTint\s*\(/.test(srcText),
    // main.js hud.update passes world
    main_game_loop_calls_hud_update_with_world: /hud\.update\s*\(\s*phaseManager\s*,\s*physicsManager\s*,\s*world\s*\)/.test(srcText),
    main_init_calls_hud_update_with_world: /function\s+init[\s\S]{0,15000}?hud\.update\s*\(\s*phaseManager\s*,\s*physicsManager\s*,\s*world\s*\)/.test(srcText),
    // main.js debug hooks
    debug_force_biome_hook_present: /__phaseShifter__[\s\S]*?forceBiome\s*\(\s*biomeId\s*\)/.test(srcText),
    debug_force_biome_rejects_bad_input: /__phaseShifter__[\s\S]*?forceBiome[\s\S]{0,500}?bad-input/.test(srcText) || /__phaseShifter__[\s\S]*?forceBiome[\s\S]{0,500}?out-of-range/.test(srcText),
    debug_get_current_biome_id_hook_present: /__phaseShifter__[\s\S]*?getCurrentBiomeId\s*\(/.test(srcText),
    debug_lerp_biome_tints_hook_present: /__phaseShifter__[\s\S]*?lerpBiomeTints\s*\(\s*from\s*,\s*to\s*,\s*t\s*\)/.test(srcText),
    debug_biome_label_hook_present: /__phaseShifter__[\s\S]*?biomeLabel\s*\(\s*biomeId\s*\)/.test(srcText),
    debug_get_current_biome_tint_hook_present: /__phaseShifter__[\s\S]*?getCurrentBiomeTint\s*\(/.test(srcText),
    debug_tick_biomes_per_frame_hook_present: /__phaseShifter__[\s\S]*?tickBiomesPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    debug_get_biome_transition_timer_hook_present: /__phaseShifter__[\s\S]*?getBiomeTransitionTimer\s*\(/.test(srcText),
    debug_get_biome_transition_duration_hook_present: /__phaseShifter__[\s\S]*?getBiomeTransitionDuration\s*\(/.test(srcText),
    // src/render/renderer.js skybox shader uniforms
    renderer_create_skybox_has_biome_tint_uniform: /createSkybox[\s\S]*?biomeTint\s*:\s*\{\s*value:\s*new\s+THREE\.Vector3/.test(rendererText),
    renderer_create_skybox_has_phase_tint_uniform: /createSkybox[\s\S]*?phaseTint\s*:\s*\{\s*value:\s*new\s+THREE\.Vector3/.test(rendererText),
    renderer_create_skybox_fragment_shader_multiplies_tints: /biomeTint\s*\*\s*phaseTint/.test(rendererText),
    renderer_create_skybox_mesh_has_set_biome_tint: /sky\.setBiomeTint\s*=\s*function\s+setBiomeTint/.test(rendererText),
    renderer_create_skybox_mesh_has_set_phase_tint: /sky\.setPhaseTint\s*=\s*function\s+setPhaseTint/.test(rendererText),
    renderer_create_skybox_mesh_named_skybox: /sky\.name\s*=\s*['"]skybox['"]/.test(rendererText),
    renderer_renderer_class_set_biome_tint_forwards: /setBiomeTint\s*\(\s*tint\s*\)\s*\{[\s\S]*?this\.scene\.getObjectByName\s*\(\s*['"]skybox['"]\s*\)[\s\S]*?sky\.setBiomeTint/.test(rendererText),
    renderer_renderer_class_set_phase_tint_forwards: /setPhaseTint\s*\(\s*tint\s*\)\s*\{[\s\S]*?this\.scene\.getObjectByName\s*\(\s*['"]skybox['"]\s*\)[\s\S]*?sky\.setPhaseTint/.test(rendererText),
    // src/ui/hud.js biome wire
    hud_constructor_queries_biome_info_element: /constructor[\s\S]{0,1500}?#biome-info/.test(hudText2),
    hud_constructor_initializes_last_biome_id: /constructor[\s\S]{0,2000}?_lastBiomeId\s*=\s*-1/.test(hudText2),
    hud_update_queries_world_get_biome: /update\([\s\S]*?world\.getBiome\s*\(/.test(hudText2),
    hud_update_writes_biome_info_text: /update\([\s\S]*?_biomeInfoEl[\s\S]{0,800}?textContent\s*=\s*[`'"]BIOME:/.test(hudText2),
    // index.html has the #biome-info element
    html_biome_info_element_present: /<div\s+id\s*=\s*["']biome-info["'][^>]*>\s*BIOME:\s*FOREST\s*</.test(htmlText2),
    html_biome_info_inside_hud_container: /<div\s+id\s*=\s*["']hud["'][\s\S]*?<div\s+id\s*=\s*["']biome-info["']/.test(htmlText2),
    // World.getBiome exists (the per-region deterministic read)
    world_get_biome_method_present: /getBiome\s*\(\s*x\s*,\s*z\s*\)/.test(worldText),
  };

  // Phase 3.2: Stabilizers (3.2 section 3.2 in PHASE_3_2_BRIEF.md)
  // - per-Stabilizer checkpoint graphic (warm-orange ring +
  //   crosshair above the placed block)
  // - Phase Collapse state machine (1.5s animation + input
  //   suppression + teleport to nearest Stabilizer or fallback to
  //   spawn)
  // - pure modules src/world/stabilizer.js + src/collapse/collapse.js
  const stabilizerSrc = path.resolve(__dirname, '..', '..', 'src', 'world', 'stabilizer.js');
  const stabilizerText = fs2.existsSync(stabilizerSrc) ? fs2.readFileSync(stabilizerSrc, 'utf8') : '';
  const collapseSrc = path.resolve(__dirname, '..', '..', 'src', 'collapse', 'collapse.js');
  const collapseText = fs2.existsSync(collapseSrc) ? fs2.readFileSync(collapseSrc, 'utf8') : '';
  const echoSrc = path.resolve(__dirname, '..', '..', 'src', 'collect', 'echo.js');
  const echoText2 = fs2.existsSync(echoSrc) ? fs2.readFileSync(echoSrc, 'utf8') : '';
  const inventorySrc = path.resolve(__dirname, '..', '..', 'src', 'inventory', 'inventory.js');
  const inventoryText = fs2.existsSync(inventorySrc) ? fs2.readFileSync(inventorySrc, 'utf8') : '';
  const phase32 = {
    // src/world/stabilizer.js exports
    stabilizer_module_exports_stabilizer_radius: /export\s+const\s+STABILIZER_RADIUS\s*=\s*16\b/.test(stabilizerText),
    stabilizer_module_exports_stabilizer_place_cost: /export\s+const\s+STABILIZER_PLACE_COST\s*=\s*0\b/.test(stabilizerText),
    stabilizer_module_exports_stabilizer_fallback_color: /export\s+const\s+STABILIZER_FALLBACK_COLOR\s*=\s*0xff8844\b/.test(stabilizerText),
    stabilizer_module_exports_find_respawn_target: /export\s+function\s+findRespawnTarget\s*\(/.test(stabilizerText),
    stabilizer_module_exports_is_within_radius: /export\s+function\s+isWithinRadius\s*\(/.test(stabilizerText),
    stabilizer_module_exports_stabilizer_key: /export\s+function\s+stabilizerKey\s*\(/.test(stabilizerText),
    stabilizer_module_exports_snap_y_for_stabilizer_cell: /export\s+function\s+snapYForStabilizerCell\s*\(/.test(stabilizerText),
    // src/collapse/collapse.js exports
    collapse_module_exports_collapse_duration: /export\s+const\s+COLLAPSE_DURATION\s*=\s*1\.5\b/.test(collapseText),
    collapse_module_exports_collapse_banner_text: /export\s+const\s+COLLAPSE_BANNER_TEXT\s*=\s*['"]PHASE COLLAPSE['"]/.test(collapseText),
    collapse_module_exports_fallback_warning_text: /export\s+const\s+FALLBACK_WARNING_TEXT\s*=/.test(collapseText),
    collapse_module_exports_collapse_reasons: /export\s+const\s+COLLAPSE_REASONS\s*=/.test(collapseText),
    collapse_module_exports_create_collapse_state: /export\s+function\s+createCollapseState\s*\(/.test(collapseText),
    collapse_module_exports_start_collapse: /export\s+function\s+startCollapse\s*\(/.test(collapseText),
    collapse_module_exports_tick_collapse: /export\s+function\s+tickCollapse\s*\(/.test(collapseText),
    collapse_module_exports_clear_collapse: /export\s+function\s+clearCollapse\s*\(/.test(collapseText),
    // constants.js
    constants_minimum_respawn_energy: /export\s+const\s+MINIMUM_RESPAWN_ENERGY\s*=\s*30\b/.test(constantsText),
    constants_block_stabilizer: /export\s+const\s+BLOCK_STABILIZER\s*=\s*15\b/.test(constantsText),
    // main.js imports
    main_imports_find_respawn_target: /import\s*\{[^}]*findRespawnTarget[^}]*\}\s*from\s*['"]\.\/src\/world\/stabilizer\.js['"]/.test(srcText),
    main_imports_start_collapse: /import\s*\{[^}]*startCollapse[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(srcText),
    main_imports_tick_collapse: /import\s*\{[^}]*tickCollapse[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(srcText),
    main_imports_create_collapse_state: /import\s*\{[^}]*createCollapseState[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(srcText),
    main_imports_minimum_respawn_energy: /import\s*\{[^}]*MINIMUM_RESPAWN_ENERGY[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(srcText),
    main_imports_block_stabilizer: /import\s*\{[^}]*BLOCK_STABILIZER[^}]*\}\s*from\s*['"]\.\/src\/core\/constants\.js['"]/.test(srcText),
    main_imports_stabilizer_radius: /import\s*\{[^}]*STABILIZER_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/world\/stabilizer\.js['"]/.test(srcText),
    main_imports_collapse_duration: /import\s*\{[^}]*COLLAPSE_DURATION[^}]*\}\s*from\s*['"]\.\/src\/collapse\/collapse\.js['"]/.test(srcText),
    // main.js per-frame collapse tick
    main_tick_collapse_per_frame_defined: /function\s+tickCollapsePerFrame\s*\(/.test(srcText),
    main_compute_respawn_target_defined: /function\s+computeRespawnTarget\s*\(/.test(srcText),
    main_game_loop_calls_tick_collapse_per_frame: /tickCollapsePerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    // main.js forcePhaseCollapse extension
    main_force_phase_collapse_starts_state_machine: /forcePhaseCollapse\s*\(\s*\)\s*\{[\s\S]{0,2000}?startCollapse\s*\(/.test(srcText),
    main_force_phase_collapse_calls_compute_respawn_target: /forcePhaseCollapse\s*\(\s*\)\s*\{[\s\S]{0,2000}?computeRespawnTarget\s*\(/.test(srcText),
    main_force_phase_collapse_to_stabilizer_hook: /forcePhaseCollapseToStabilizer\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(srcText),
    // main.js input suppression
    main_input_suppressed_flag_declared: /let\s+inputSuppressed\s*=/.test(srcText),
    main_keydown_gates_on_input_suppressed: /keydown[\s\S]*?pointerLockElement\s*\|\|\s*inputSuppressed/.test(srcText),
    main_contextmenu_gates_on_input_suppressed: /contextmenu[\s\S]{0,400}?pointerLockElement\s*\|\|\s*inputSuppressed/.test(srcText),
    main_click_gates_on_input_suppressed: /addEventListener\(['"]click['"][\s\S]{0,500}?gamePaused\s*\|\|\s*inputSuppressed/.test(srcText),
    // main.js debug hooks
    debug_force_place_stabilizer: /__phaseShifter__[\s\S]*?forcePlaceStabilizer\s*\(/.test(srcText),
    debug_break_stabilizer: /__phaseShifter__[\s\S]*?breakStabilizer\s*\(/.test(srcText),
    debug_get_collapse_state: /__phaseShifter__[\s\S]*?getCollapseState\s*\(/.test(srcText),
    debug_tick_collapse_per_frame_hook: /__phaseShifter__[\s\S]*?tickCollapsePerFrame\s*\(\s*dt\s*\)/.test(srcText),
    debug_get_respawn_target: /__phaseShifter__[\s\S]*?getRespawnTarget\s*\(/.test(srcText),
    debug_get_spawn_point: /__phaseShifter__[\s\S]*?getSpawnPoint\s*\(/.test(srcText),
    debug_get_stabilizer_snapshot: /__phaseShifter__[\s\S]*?getStabilizerSnapshot\s*\(/.test(srcText),
    debug_get_stabilizer_count: /__phaseShifter__[\s\S]*?getStabilizerCount\s*\(/.test(srcText),
    debug_clear_stabilizers: /__phaseShifter__[\s\S]*?clearStabilizers\s*\(/.test(srcText),
    debug_get_checkpoint_mesh_count: /__phaseShifter__[\s\S]*?getCheckpointMeshCount\s*\(/.test(srcText),
    debug_get_checkpoint_keys: /__phaseShifter__[\s\S]*?getCheckpointKeys\s*\(/.test(srcText),
    debug_is_checkpoint_at: /__phaseShifter__[\s\S]*?isCheckpointAt\s*\(/.test(srcText),
    // CheckpointOverlay
    renderer_checkpoint_overlay_class_exported: /export\s+class\s+CheckpointOverlay\b/.test(rendererText2),
    renderer_checkpoint_overlay_own_group: /class\s+CheckpointOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]checkpointOverlay['"]/.test(rendererText2),
    renderer_checkpoint_overlay_show_checkpoint: /class\s+CheckpointOverlay[\s\S]*?showCheckpoint\s*\(/.test(rendererText2),
    renderer_checkpoint_overlay_update_checkpoints: /class\s+CheckpointOverlay[\s\S]*?updateCheckpoints\s*\(/.test(rendererText2),
    renderer_checkpoint_overlay_clear_checkpoint: /class\s+CheckpointOverlay[\s\S]*?clearCheckpoint\s*\(/.test(rendererText2),
    renderer_show_checkpoint_forwards: /showCheckpoint\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*key\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.showCheckpoint/.test(rendererText2),
    renderer_update_checkpoints_forwards: /updateCheckpoints\s*\(\s*snapshot\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.updateCheckpoints/.test(rendererText2),
    renderer_clear_checkpoint_forwards: /clearCheckpoint\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.clearCheckpoint/.test(rendererText2),
    renderer_clear_checkpoints_forwards: /clearCheckpoints\s*\(\s*\)\s*\{[\s\S]*?this\.checkpointOverlay\.clearCheckpoints/.test(rendererText2),
    renderer_collapse_overlay_class_exported: /export\s+class\s+CollapseOverlay\b/.test(rendererText2),
    renderer_update_collapse_overlay_forwards: /updateCollapseOverlay\s*\(\s*progress\s*\)\s*\{[\s\S]*?this\.collapseOverlay\.updateCollapseOverlay/.test(rendererText2),
    renderer_clear_collapse_overlay_forwards: /clearCollapseOverlay\s*\(\s*\)\s*\{[\s\S]*?this\.collapseOverlay\.clearCollapseOverlay/.test(rendererText2),
    // World API
    world_find_nearest_stabilizer_defined: /findNearestStabilizer\s*\(/.test(worldText),
    world_add_stabilizer_defined: /addStabilizer\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText),
    world_remove_stabilizer_defined: /removeStabilizer\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText),
    world_stabilizer_positions_map_initialized: /this\._stabilizerPositions\s*=\s*new\s+Map\s*\(\s*\)/.test(worldText),
    // index.html
    html_phase_collapse_overlay_element: /<div\s+id\s*=\s*["']phase-collapse-overlay["']\s*><\s*\/div\s*>/.test(htmlText2),
    html_phase_collapse_overlay_css: /#phase-collapse-overlay\s*\{/.test(htmlText2),
  };
  console.log('\n=== Phase 3.2 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase32, null, 2));

console.log('\n=== Phase 3.1 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase31, null, 2));


  const phase33 = {
    // ── Phase 3.3 (Echoes) ────────────────────────────────
    // The Phase 3.3 work turns Ruins-biome floating crystals
    // into collectible lore objects with an inventory counter
    // src/collect/echo.js exports
    // and HUD label. The pure module src/collect/echo.js owns
    // the pickup radius + lore library + key formatter.
    // src/inventory/inventory.js owns the inventory state.
    // main.js wires the per-frame pickup loop + the debug hooks.
    phase33_echo_module_exports_pickup_radius: /export\s+const\s+PICKUP_RADIUS\s*=/.test(echoText2),
    phase33_echo_module_exports_echo_lore_library: /export\s+const\s+ECHO_LORE_LIBRARY\s*=\s*Object\.freeze/.test(echoText2),
    phase33_echo_module_exports_echo_lore_for_key: /export\s+function\s+echoLoreForKey/.test(echoText2),
    phase33_echo_module_exports_pickup_result: /export\s+function\s+pickupResult/.test(echoText2),
    phase33_echo_module_exports_echo_key: /export\s+function\s+echoKey/.test(echoText2),
    phase33_echo_module_exports_floating_offset: /export\s+function\s+floatingOffset/.test(echoText2),
    phase33_echo_module_exports_echo_color_for_biome: /export\s+function\s+echoColorForBiome/.test(echoText2),
    phase33_inventory_module_exports_create_inventory: /export\s+function\s+createInventory/.test(inventoryText),
    phase33_inventory_module_exports_add_echo: /export\s+function\s+addEcho/.test(inventoryText),
    phase33_inventory_module_exports_has_echo: /export\s+function\s+hasEcho/.test(inventoryText),
    phase33_inventory_module_exports_list_echoes: /export\s+function\s+listEchoes/.test(inventoryText),
    phase33_inventory_module_exports_remove_echo: /export\s+function\s+removeEcho/.test(inventoryText),
    phase33_inventory_module_exports_add_amplifier: /export\s+function\s+addAmplifier/.test(inventoryText),
    phase33_inventory_module_exports_has_amplifier: /export\s+function\s+hasAmplifier/.test(inventoryText),
    phase33_inventory_module_exports_serialize: /export\s+function\s+serialize/.test(inventoryText),
    phase33_inventory_module_exports_deserialize: /export\s+function\s+deserialize/.test(inventoryText),
    phase33_inventory_module_exports_collected_count: /export\s+function\s+collectedCount/.test(inventoryText),
    phase33_inventory_module_exports_amplifier_count: /export\s+function\s+amplifierCount/.test(inventoryText),
    phase33_constants_block_echo: /export\s+const\s+BLOCK_ECHO\s*=\s*17\b/.test(constantsText),
    phase33_constants_echo_pickup_radius: /export\s+const\s+ECHO_PICKUP_RADIUS\s*=\s*1\.5\b/.test(constantsText),
    phase33_world_spawn_echo_defined: /spawnEcho\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*loreKey\s*,\s*biomeId\s*\)/.test(worldText),
    phase33_world_collect_echo_defined: /collectEcho\s*\(\s*key\s*\)/.test(worldText),
    phase33_world_list_echoes_defined: /listEchoes\s*\(\s*\)/.test(worldText),
    phase33_world_get_total_echoes_defined: /getTotalEchoes\s*\(\s*\)/.test(worldText),
    phase33_world_clear_echoes_defined: /clearEchoes\s*\(\s*\)/.test(worldText),
    phase33_renderer_echo_overlay_class_exported: /export\s+class\s+EchoOverlay\b/.test(rendererText),
    phase33_renderer_echo_overlay_own_group: /class\s+EchoOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]echoOverlay['"]/.test(rendererText),
    phase33_renderer_show_echo_forwards: /showEcho\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*key\s*,\s*color\s*\)\s*\{[\s\S]*?this\.echoOverlay\.showEcho/.test(rendererText),
    phase33_renderer_update_echoes_forwards: /updateEchoes\s*\(\s*dt\s*,\s*snapshot\s*\)\s*\{[\s\S]*?this\.echoOverlay\.updateEchoes/.test(rendererText),
    phase33_renderer_clear_echo_forwards: /clearEcho\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.echoOverlay\.clearEcho/.test(rendererText),
    phase33_renderer_clear_echoes_forwards: /clearEchoes\s*\(\s*\)\s*\{[\s\S]*?this\.echoOverlay\.clearEchoes/.test(rendererText),
    phase33_hud_set_echo_counter_defined: /setEchoCounter\s*\(\s*collected\s*,\s*total\s*\)/.test(hudText2),
    phase33_hud_show_lore_toast_defined: /showLoreToast\s*\(\s*text\s*\)/.test(hudText2),
    phase33_html_echo_counter_element: /id\s*=\s*["']echo-counter["']/.test(htmlText2),
    phase33_html_echo_counter_css: /#echo-counter\s*\{/.test(htmlText2),
    phase33_html_lore_toast_element: /id\s*=\s*["']lore-toast["']/.test(htmlText2),
    phase33_html_lore_toast_css: /#lore-toast\s*\{/.test(htmlText2),
    phase33_main_imports_pickup_radius: /import\s*\{[^}]*PICKUP_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/collect\/echo\.js['"]/.test(srcText),
    phase33_main_imports_inventory_helpers: /import\s*\{[^}]*createInventory[^}]*\}\s*from\s*['"]\.\/src\/inventory\/inventory\.js['"]/.test(srcText),
    phase33_main_player_inventory_decl: /let\s+playerInventory\s*=/.test(srcText),
    phase33_main_tick_echoes_per_frame_defined: /function\s+tickEchoesPerFrame/.test(srcText),
    phase33_main_game_loop_calls_tick_echoes: /tickEchoesPerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    phase33_main_tick_echoes_reads_world_list_echoes: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?world\.listEchoes/.test(srcText),
    phase33_main_tick_echoes_drives_renderer_update_echoes: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?renderer\.updateEchoes/.test(srcText),
    phase33_main_tick_echoes_uses_echo_pickup_result: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?echoPickupResult/.test(srcText),
    phase33_main_tick_echoes_calls_world_collect_echo: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?world\.collectEcho/.test(srcText),
    phase33_main_tick_echoes_calls_hud_set_echo_counter: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?hud\.setEchoCounter/.test(srcText),
    phase33_main_save_game_serializes_inventory: /function\s+saveGame[\s\S]{0,1000}?serializeInventory\s*\(\s*playerInventory\s*\)/.test(srcText),
    phase33_main_save_game_passes_inventory_to_save: /saveSystem\.saveSnapshot\([^)]*inventorySnapshot\s*\)/.test(srcText),
    phase33_main_init_applies_saved_inventory: /function\s+init[\s\S]{0,15000}?deserializeInventory\s*\(\s*_savedState\.inventory\s*\)/.test(srcText),
    phase33_debug_force_spawn_echo: /__phaseShifter__[\s\S]*?forceSpawnEcho\s*\(/.test(srcText),
    phase33_debug_force_collect_echo: /__phaseShifter__[\s\S]*?forceCollectEcho\s*\(/.test(srcText),
    phase33_debug_get_inventory: /__phaseShifter__[\s\S]*?getInventory\s*\(/.test(srcText),
    phase33_debug_list_echoes: /__phaseShifter__[\s\S]*?listEchoes\s*\(/.test(srcText),
    phase33_debug_get_echo_count: /__phaseShifter__[\s\S]*?getEchoCount\s*\(/.test(srcText),
    phase33_debug_get_echo_keys: /__phaseShifter__[\s\S]*?getEchoKeys\s*\(/.test(srcText),
    phase33_debug_get_echo_counter_text: /__phaseShifter__[\s\S]*?getEchoCounterText\s*\(/.test(srcText),
    phase33_debug_tick_echoes_per_frame_hook: /__phaseShifter__[\s\S]*?tickEchoesPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase33_debug_clear_echoes: /__phaseShifter__[\s\S]*?clearEchoes\s*\(/.test(srcText),
    phase33_debug_add_amplifier: /__phaseShifter__[\s\S]*?addAmplifier\s*\(/.test(srcText),
    phase33_save_coerce_inventory_defined: /_coerceInventory\s*\(\s*value\s*\)/.test(saveText),
    phase33_save_coerce_inventory_rejects_non_object: /_coerceInventory[\s\S]{0,500}?return\s+fresh/.test(saveText),
    phase33_save_normalize_state_passes_inventory: /_normalizeState[\s\S]{0,1000}?_coerceInventory\s*\(\s*state\.inventory\s*\)/.test(saveText),
    phase33_save_load_game_returns_inventory: /loadGame[\s\S]{0,2000}?inventory\s*:\s*this\._coerceInventory/.test(saveText)  };

  const summary = {
    http_ok: resp.status() === 200,
    structural_dom_all_present: domOk,
    pause_menu_buttons_present: ['btn-resume','btn-save','btn-inv','btn-opts','btn-quit'].every(id => structural[id]),
    no_unrelated_pageerrors: otherErr.length === 0,
    init_recovered_when_webgl_failed: webglErr.length > 0 ? initRecovered : null,
    click_handlers_work: handlersWork,
    page_errors: pageErrors,
    phase12_old_atan2_gone: phase12.old_atan2_gone,
    phase12_new_camera_follow_present: phase12.new_camera_follow_present,
    phase12_new_quaternion_basis_present: phase12.new_quaternion_basis_present,
    phase13_hardcoded_setposition_y20_gone: phase13.hardcoded_setposition_y20_gone,
    phase13_downward_raycast_helper_present: phase13.downward_raycast_helper_present,
    phase13_spawn_info_log_wired: phase13.spawn_info_log_wired,
    phase14_world_index_defined: phase14.world_index_defined,
    phase14_world_local_index_defined: phase14.world_local_index_defined,
    phase14_world_unpack_index_defined: phase14.world_unpack_index_defined,
    phase14_get_set_raw_formulas_gone: phase14.get_set_raw_formulas_gone,
    phase14_renderer_uses_index_helpers: phase14.renderer_uses_index_helpers,
    phase14_scans_use_world_index: phase14.scans_use_world_index,
    phase15_world_get_chunk_defined: phase15.world_get_chunk_defined,
    phase15_legacy_chunk_coordinates_gone: phase15.legacy_chunk_coordinates_gone,
    phase15_direct_chunk_data_writes_gone: phase15.direct_chunk_data_writes_gone,
    phase15_place_block_uses_set_block: phase15.place_block_uses_set_block,
    phase16_save_game_defined: phase16.save_game_defined,
    phase16_load_game_defined: phase16.load_game_defined,
    phase16_last_save_info_defined: phase16.last_save_info_defined,
    phase16_no_direct_localstorage: phase16.no_direct_localstorage,
    phase16_no_direct_json_save_glue: phase16.no_direct_json_save_glue,
    phase16_no_direct_date_now: phase16.no_direct_date_now,
    phase16_main_save_routes_via_api: phase16.main_save_routes_via_api,
    phase17_world_exports_global_state: phase17.world_exports_global_state,
    phase17_world_imports_global_state: phase17.world_imports_global_state,
    phase17_save_snapshot_defined: phase17.save_snapshot_defined,
    phase17_init_applies_saved_state: phase17.init_applies_saved_state,
    phase22_world_is_block_solid_defined: phase22.world_is_block_solid_defined,
    phase22_world_is_block_solid_reads_phase_solid: phase22.world_is_block_solid_reads_phase_solid,
    phase22_world_is_block_solid_falls_back_to_solid: phase22.world_is_block_solid_falls_back_to_solid,
    phase22_world_is_block_solid_not_legacy_only: phase22.world_is_block_solid_not_legacy_only,
    phase22_physics_delegates_to_world_is_block_solid: phase22.physics_delegates_to_world_is_block_solid,
    phase22_physics_has_no_bare_props_solid_reads: phase22.physics_has_no_bare_props_solid_reads,
    phase22_physics_check_collision_uses_is_block_solid: phase22.physics_check_collision_uses_is_block_solid,
    phase22_renderer_does_not_use_phase_solid: phase22.renderer_does_not_use_phase_solid,
    phase22_renderer_uses_phase_data_for_culling: phase22.renderer_uses_phase_data_for_culling,
    phase22_renderer_is_surrounded_does_not_consult_block_properties: phase22.renderer_is_surrounded_does_not_consult_block_properties,
    phase22_physics_does_not_redefine_phase_cycling: phase22.physics_does_not_redefine_phase_cycling,
    phase21_audio_play_shift_defined: phase21.audio_play_shift_defined,
    phase21_post_processing_set_phase_alias: phase21.post_processing_set_phase_alias,
    phase21_post_processing_update_phase_present: phase21.post_processing_update_phase_present,
    phase21_cycle_phase_spam_guard: phase21.cycle_phase_spam_guard,
    phase21_html_phase_indicator_present: phase21.html_phase_indicator_present,
    phase21_html_phase_shift_overlay_present: phase21.html_phase_shift_overlay_present,
    phase21_main_phase_indicator_color_wired: phase21.main_phase_indicator_color_wired,
    phase21_hud_phase_indicator_color_wired: phase21.hud_phase_indicator_color_wired,
    phase21_main_on_phase_changed_calls_set_phase: phase21.main_on_phase_changed_calls_set_phase,
    phase21_main_drives_shift_overlay: phase21.main_drives_shift_overlay,
    phase21_force_cycle_phase_hook_intact: phase21.force_cycle_phase_hook_intact,
    phase21_contextmenu_prevent_default_intact: phase21.contextmenu_prevent_default_intact,
    phase23_place_block_module_exports_place_block: phase23.place_block_module_exports_place_block,
    phase23_place_block_module_exports_aabb_helper: phase23.place_block_module_exports_aabb_helper,
    phase23_main_imports_place_block: phase23.main_imports_place_block,
    phase23_place_block_signature_is_hit_block_id_context: phase23.place_block_signature_is_hit_block_id_context,
    phase23_place_block_reads_current_phase: phase23.place_block_reads_current_phase,
    phase23_place_block_writes_via_set_block: phase23.place_block_writes_via_set_block,
    phase23_place_block_refuses_no_hit: phase23.place_block_refuses_no_hit,
    phase23_place_block_refuses_non_air_target: phase23.place_block_refuses_non_air_target,
    phase23_place_block_refuses_player_overlap: phase23.place_block_refuses_player_overlap,
    phase23_contextmenu_calls_place_block_with_stone: phase23.contextmenu_calls_place_block_with_stone,
    phase23_contextmenu_falls_back_to_cycle_phase: phase23.contextmenu_falls_back_to_cycle_phase,
    phase23_place_anchor_no_stray_block_15: phase23.place_anchor_no_stray_block_15,
    phase23_place_anchor_no_longer_defers_to_stub: phase23.place_anchor_no_longer_defers_to_stub,
    phase23_place_anchor_delegates_to_place_anchor_at: phase23.place_anchor_delegates_to_place_anchor_at,
    phase23_place_anchor_calls_world_create_anchor: phase23.place_anchor_calls_world_create_anchor,
    phase23_spawn_place_particles_defined: phase23.spawn_place_particles_defined,
    phase23_place_block_debug_hook_present: phase23.place_block_debug_hook_present,
    phase23_force_cycle_phase_hook_intact: phase23.force_cycle_phase_hook_intact,
    phase23_load_chunk_applies_air_from_global_state: phase23.load_chunk_applies_air_from_global_state,
    phase23_main_unvalidated_write_primitive_intact: phase23.main_unvalidated_write_primitive_intact,
    phase24_export_global_state_preserves_block_air: phase24.export_global_state_preserves_block_air,
    phase24_export_global_state_docstring_phase_2_4: phase24.export_global_state_docstring_phase_2_4,
    phase24_export_global_state_no_longer_filters_block_air: phase24.export_global_state_no_longer_filters_block_air,
    phase24_import_global_state_preserves_block_air: phase24.import_global_state_preserves_block_air,
    phase24_import_global_state_keeps_number_is_finite_guard: phase24.import_global_state_keeps_number_is_finite_guard,
    phase24_import_global_state_no_longer_filters_block_air: phase24.import_global_state_no_longer_filters_block_air,
    phase24_coerce_world_state_accepts_block_air: phase24.coerce_world_state_accepts_block_air,
    phase24_coerce_world_state_still_rejects_non_finite: phase24.coerce_world_state_still_rejects_non_finite,
    phase24_coerce_world_state_still_rejects_fractional: phase24.coerce_world_state_still_rejects_fractional,
    phase24_coerce_world_state_still_rejects_negative: phase24.coerce_world_state_still_rejects_negative,
    phase24_load_chunk_still_applies_global_state: phase24.load_chunk_still_applies_global_state,
    phase25_phase_lens_drain_rate_defined: phase25.phase_lens_drain_rate_defined,
    phase25_scan_radius_defined: phase25.scan_radius_defined,
    phase25_lens_module_exports_scan_results: phase25.lens_module_exports_scan_results,
    phase25_lens_module_exports_phase_lens_drain: phase25.lens_module_exports_phase_lens_drain,
    phase25_lens_module_exports_lens_radius: phase25.lens_module_exports_lens_radius,
    phase25_lens_module_exports_wireframe_colors: phase25.lens_module_exports_wireframe_colors,
    phase25_world_find_phase_differences_defined: phase25.world_find_phase_differences_defined,
    phase25_world_find_phase_differences_returns_current_phase_block: phase25.world_find_phase_differences_returns_current_phase_block,
    phase25_world_find_phase_differences_returns_other_phases: phase25.world_find_phase_differences_returns_other_phases,
    phase25_world_find_phase_differences_excludes_current_phase: phase25.world_find_phase_differences_excludes_current_phase,
    phase25_main_imports_scan_results: phase25.main_imports_scan_results,
    phase25_main_imports_scan_overlay: phase25.main_imports_scan_overlay,
    phase25_main_perform_scan_no_chunk_alpha_data: phase25.main_perform_scan_no_chunk_alpha_data,
    phase25_main_drains_energy_per_dt: phase25.main_drains_energy_per_dt,
    phase25_main_insufficient_energy_notify: phase25.main_insufficient_energy_notify,
    phase25_debug_force_scan_hook: phase25.debug_force_scan_hook,
    phase25_debug_start_phase_lens_hook: phase25.debug_start_phase_lens_hook,
    phase25_debug_stop_phase_lens_hook: phase25.debug_stop_phase_lens_hook,
    phase25_scan_overlay_show_scan_highlights: phase25.scan_overlay_show_scan_highlights,
    phase25_scan_overlay_clear_scan_highlights: phase25.scan_overlay_clear_scan_highlights,
    phase25_scan_overlay_show_scan_beam: phase25.scan_overlay_show_scan_beam,
    phase25_scan_overlay_hide_scan_beam: phase25.scan_overlay_hide_scan_beam,
    phase25_scan_overlay_beam_parented_to_camera: phase25.scan_overlay_beam_parented_to_camera,
    phase25_scan_overlay_disposes_geometry: phase25.scan_overlay_disposes_geometry,
    phase26_resonance_radius_defined: phase26.resonance_radius_defined,
    phase26_resonance_pulse_duration_defined: phase26.resonance_pulse_duration_defined,
    phase26_resonate_module_exports_resonate_results: phase26.resonate_module_exports_resonate_results,
    phase26_resonate_module_exports_resonate_radius: phase26.resonate_module_exports_resonate_radius,
    phase26_resonate_module_exports_resonate_cost: phase26.resonate_module_exports_resonate_cost,
    phase26_resonate_module_exports_total_swapped_count: phase26.resonate_module_exports_total_swapped_count,
    phase26_resonate_module_exports_resonance_sphere_pulse: phase26.resonate_module_exports_resonance_sphere_pulse,
    phase26_world_resonate_with_report_defined: phase26.world_resonate_with_report_defined,
    phase26_world_resonate_with_report_returns_results: phase26.world_resonate_with_report_returns_results,
    phase26_world_resonate_with_report_returns_count: phase26.world_resonate_with_report_returns_count,
    phase26_world_resonate_with_report_per_cell_has_swapped_phases: phase26.world_resonate_with_report_per_cell_has_swapped_phases,
    phase26_main_imports_resonate_results: phase26.main_imports_resonate_results,
    phase26_main_imports_resonance_pulse: phase26.main_imports_resonance_pulse,
    phase26_main_imports_resonance_radius: phase26.main_imports_resonance_radius,
    phase26_main_perform_resonance_no_chunk_alpha_data: phase26.main_perform_resonance_no_chunk_alpha_data,
    phase26_main_perform_resonance_uses_resonate_results: phase26.main_perform_resonance_uses_resonate_results,
    phase26_main_perform_resonance_uses_resonate_cost: phase26.main_perform_resonance_uses_resonate_cost,
    phase26_main_perform_resonance_uses_resonate_radius: phase26.main_perform_resonance_uses_resonate_radius,
    phase26_main_perform_resonance_consumes_energy: phase26.main_perform_resonance_consumes_energy,
    phase26_main_insufficient_energy_notify: phase26.main_insufficient_energy_notify,
    phase26_main_advances_resonance_pulse_per_frame: phase26.main_advances_resonance_pulse_per_frame,
    phase26_debug_force_resonate_hook: phase26.debug_force_resonate_hook,
    phase26_debug_get_resonance_pulse_mesh_count: phase26.debug_get_resonance_pulse_mesh_count,
    phase26_debug_get_resonance_pulse_visible: phase26.debug_get_resonance_pulse_visible,
    phase26_debug_clear_resonance_pulse: phase26.debug_clear_resonance_pulse,
    phase26_resonance_pulse_show: phase26.resonance_pulse_show,
    phase26_resonance_pulse_update: phase26.resonance_pulse_update,
    phase26_resonance_pulse_clear: phase26.resonance_pulse_clear,
    phase26_resonance_pulse_own_group: phase26.resonance_pulse_own_group,
    phase26_resonance_pulse_auto_disposes: phase26.resonance_pulse_auto_disposes,
    phase26_renderer_show_resonance_pulse_forwards: phase26.renderer_show_resonance_pulse_forwards,
    phase26_renderer_update_resonance_pulse_forwards: phase26.renderer_update_resonance_pulse_forwards,
    phase26_renderer_clear_resonance_pulse_forwards: phase26.renderer_clear_resonance_pulse_forwards,
    phase26_audio_play_resonance_with_phase: phase26.audio_play_resonance_with_phase,
    phase27_anchor_lifetime_defined: phase27.anchor_lifetime_defined,
    phase27_anchor_fade_window_defined: phase27.anchor_fade_window_defined,
    phase27_anchor_fill_color_defined: phase27.anchor_fill_color_defined,
    phase27_anchor_border_color_defined: phase27.anchor_border_color_defined,
    phase27_anchor_cost_zero: phase27.anchor_cost_zero,
    phase27_anchor_module_exports_place_anchor_at: phase27.anchor_module_exports_place_anchor_at,
    phase27_anchor_module_exports_snap_y_for_cell: phase27.anchor_module_exports_snap_y_for_cell,
    phase27_anchor_module_exports_cell_under_player: phase27.anchor_module_exports_cell_under_player,
    phase27_anchor_module_exports_anchor_lifetime: phase27.anchor_module_exports_anchor_lifetime,
    phase27_anchor_module_exports_anchor_fade_opacity: phase27.anchor_module_exports_anchor_fade_opacity,
    phase27_anchor_module_exports_anchor_key: phase27.anchor_module_exports_anchor_key,
    phase27_anchor_module_exports_tick_anchors: phase27.anchor_module_exports_tick_anchors,
    phase27_world_create_anchor_defined: phase27.world_create_anchor_defined,
    phase27_world_remove_anchor_defined: phase27.world_remove_anchor_defined,
    phase27_world_tick_anchors_defined: phase27.world_tick_anchors_defined,
    phase27_world_find_anchor_under_player_defined: phase27.world_find_anchor_under_player_defined,
    phase27_world_is_anchor_active_defined: phase27.world_is_anchor_active_defined,
    phase27_world_export_anchors_defined: phase27.world_export_anchors_defined,
    phase27_world_import_anchors_defined: phase27.world_import_anchors_defined,
    phase27_world_anchors_map_initialized: phase27.world_anchors_map_initialized,
    phase27_main_imports_place_anchor_at: phase27.main_imports_place_anchor_at,
    phase27_main_imports_anchor_overlay: phase27.main_imports_anchor_overlay,
    phase27_main_place_anchor_delegates: phase27.main_place_anchor_delegates,
    phase27_main_place_anchor_creates: phase27.main_place_anchor_creates,
    phase27_main_place_anchor_shows: phase27.main_place_anchor_shows,
    phase27_main_place_anchor_no_block_15: phase27.main_place_anchor_no_block_15,
    phase27_main_place_anchor_no_deferred_notification: phase27.main_place_anchor_no_deferred_notification,
    phase27_main_on_phase_changed_snap_to_anchor: phase27.main_on_phase_changed_snap_to_anchor,
    phase27_main_per_frame_tick_anchors: phase27.main_per_frame_tick_anchors,
    phase27_main_save_game_passes_anchors: phase27.main_save_game_passes_anchors,
    phase27_main_init_imports_saved_anchors: phase27.main_init_imports_saved_anchors,
    phase27_save_snapshot_accepts_anchors: phase27.save_snapshot_accepts_anchors,
    phase27_save_coerce_anchors_defined: phase27.save_coerce_anchors_defined,
    phase27_save_load_game_returns_anchors: phase27.save_load_game_returns_anchors,
    phase27_anchor_overlay_class_exported: phase27.anchor_overlay_class_exported,
    phase27_anchor_overlay_own_group: phase27.anchor_overlay_own_group,
    phase27_renderer_show_anchor_forwards: phase27.renderer_show_anchor_forwards,
    phase27_renderer_update_anchors_forwards: phase27.renderer_update_anchors_forwards,
    phase27_renderer_clear_anchors_forwards: phase27.renderer_clear_anchors_forwards,
    phase27_debug_force_place_anchor: phase27.debug_force_place_anchor,
    phase27_debug_get_anchor_count: phase27.debug_get_anchor_count,
    phase27_debug_get_anchor_mesh_count: phase27.debug_get_anchor_mesh_count,
    phase27_debug_get_anchor_keys: phase27.debug_get_anchor_keys,
    phase27_debug_clear_anchors: phase27.debug_clear_anchors,
    phase27_debug_is_anchor_at: phase27.debug_is_anchor_at,
    phase27_debug_tick_anchors_hook: phase27.debug_tick_anchors_hook,
    phase27_debug_find_anchor_under_player_hook: phase27.debug_find_anchor_under_player_hook,
    phase28_footstep_interval_defined: phase28.footstep_interval_defined,
    phase28_footsteps_module_exports_footstep_interval: phase28.footsteps_module_exports_footstep_interval,
    phase28_footsteps_module_exports_should_play_footstep: phase28.footsteps_module_exports_should_play_footstep,
    phase28_footsteps_module_exports_material_from_block: phase28.footsteps_module_exports_material_from_block,
    phase28_footsteps_module_exports_footstep_materials: phase28.footsteps_module_exports_footstep_materials,
    phase28_audio_play_shift_defined: phase28.audio_play_shift_defined,
    phase28_audio_play_resonance_defined: phase28.audio_play_resonance_defined,
    phase28_audio_play_block_break_defined: phase28.audio_play_block_break_defined,
    phase28_audio_play_block_place_defined: phase28.audio_play_block_place_defined,
    phase28_audio_play_collapse_defined: phase28.audio_play_collapse_defined,
    phase28_audio_play_footstep_defined: phase28.audio_play_footstep_defined,
    phase28_audio_start_ambient_music_defined: phase28.audio_start_ambient_music_defined,
    phase28_audio_stop_ambient_music_defined: phase28.audio_stop_ambient_music_defined,
    phase28_audio_play_footstep_has_fallback: phase28.audio_play_footstep_has_fallback,
    phase28_main_imports_should_play_footstep: phase28.main_imports_should_play_footstep,
    phase28_main_imports_material_from_block: phase28.main_imports_material_from_block,
    phase28_main_imports_footstep_interval: phase28.main_imports_footstep_interval,
    phase28_main_blocker_click_listener_calls_init: phase28.main_blocker_click_listener_calls_init,
    phase28_main_blocker_click_listener_calls_resume: phase28.main_blocker_click_listener_calls_resume,
    phase28_main_pointerlockchange_listener_no_init: phase28.main_pointerlockchange_listener_no_init,
    phase28_main_pointerlockchange_listener_calls_resume: phase28.main_pointerlockchange_listener_calls_resume,
    phase28_main_game_loop_calls_should_play_footstep: phase28.main_game_loop_calls_should_play_footstep,
    phase28_main_game_loop_calls_play_footstep: phase28.main_game_loop_calls_play_footstep,
    phase28_main_game_loop_calls_material_from_block: phase28.main_game_loop_calls_material_from_block,
    phase28_main_game_loop_uses_world_get_block_per_phase: phase28.main_game_loop_uses_world_get_block_per_phase,
    phase28_main_footstep_tick_no_chunk_alpha_data: phase28.main_footstep_tick_no_chunk_alpha_data,
    phase28_main_break_block_calls_play_block_break: phase28.main_break_block_calls_play_block_break,
    phase28_main_try_place_stone_on_face_calls_play_block_place: phase28.main_try_place_stone_on_face_calls_play_block_place,
    phase28_main_place_block_debug_hook_calls_play_block_place: phase28.main_place_block_debug_hook_calls_play_block_place,
    phase28_main_on_phase_changed_stop_before_start: phase28.main_on_phase_changed_stop_before_start,
    phase28_main_on_phase_changed_calls_play_shift: phase28.main_on_phase_changed_calls_play_shift,
    phase28_debug_force_play_footstep_hook: phase28.debug_force_play_footstep_hook,
    phase28_debug_tick_footsteps_hook: phase28.debug_tick_footsteps_hook,
    phase28_debug_get_footstep_timer_hook: phase28.debug_get_footstep_timer_hook,
    phase28_debug_force_phase_collapse_hook: phase28.debug_force_phase_collapse_hook,
    phase28_debug_play_block_break_debug_hook: phase28.debug_play_block_break_debug_hook,
    phase28_debug_play_block_place_debug_hook: phase28.debug_play_block_place_debug_hook,
    phase28_debug_play_shift_debug_hook: phase28.debug_play_shift_debug_hook,
    phase28_debug_play_resonance_debug_hook: phase28.debug_play_resonance_debug_hook,
    phase28_debug_play_collapse_debug_hook: phase28.debug_play_collapse_debug_hook,
    phase28_debug_play_footstep_debug_hook: phase28.debug_play_footstep_debug_hook,
    phase28_debug_start_ambient_music_debug_hook: phase28.debug_start_ambient_music_debug_hook,
    phase28_debug_stop_ambient_music_debug_hook: phase28.debug_stop_ambient_music_debug_hook,
    phase31_biome_module_exports_biome_tints: phase31.biome_module_exports_biome_tints,
    phase31_biome_module_exports_biome_tint_fn: phase31.biome_module_exports_biome_tint_fn,
    phase31_biome_module_exports_biome_label_fn: phase31.biome_module_exports_biome_label_fn,
    phase31_biome_module_exports_biome_fog_density_fn: phase31.biome_module_exports_biome_fog_density_fn,
    phase31_biome_module_exports_lerp_biome_tints_fn: phase31.biome_module_exports_lerp_biome_tints_fn,
    phase31_biome_module_exports_biome_transition_duration_fn: phase31.biome_module_exports_biome_transition_duration_fn,
    phase31_biome_module_re_exports_biome_forest: phase31.biome_module_re_exports_biome_forest,
    phase31_biome_module_re_exports_biome_crystal_cavern: phase31.biome_module_re_exports_biome_crystal_cavern,
    phase31_biome_module_re_exports_biome_phase_nexus: phase31.biome_module_re_exports_biome_phase_nexus,
    phase31_biome_module_re_exports_biome_names: phase31.biome_module_re_exports_biome_names,
    phase31_biome_tints_has_forest_entry: phase31.biome_tints_has_forest_entry,
    phase31_biome_tints_has_caves_entry: phase31.biome_tints_has_caves_entry,
    phase31_biome_tints_has_deep_void_entry: phase31.biome_tints_has_deep_void_entry,
    phase31_biome_tints_has_ruins_entry: phase31.biome_tints_has_ruins_entry,
    phase31_biome_tints_has_desert_entry: phase31.biome_tints_has_desert_entry,
    phase31_biome_tints_has_crystal_cavern_entry: phase31.biome_tints_has_crystal_cavern_entry,
    phase31_biome_tints_has_sky_ruins_entry: phase31.biome_tints_has_sky_ruins_entry,
    phase31_biome_tints_has_phase_nexus_entry: phase31.biome_tints_has_phase_nexus_entry,
    phase31_main_imports_biome_tint_from_biome_module: phase31.main_imports_biome_tint_from_biome_module,
    phase31_main_imports_biome_label_from_biome_module: phase31.main_imports_biome_label_from_biome_module,
    phase31_main_imports_biome_fog_density_from_biome_module: phase31.main_imports_biome_fog_density_from_biome_module,
    phase31_main_imports_lerp_biome_tints_from_biome_module: phase31.main_imports_lerp_biome_tints_from_biome_module,
    phase31_main_imports_biome_transition_duration_from_biome_module: phase31.main_imports_biome_transition_duration_from_biome_module,
    phase31_main_module_level_current_biome_id_decl: phase31.main_module_level_current_biome_id_decl,
    phase31_main_module_level_current_biome_tint_decl: phase31.main_module_level_current_biome_tint_decl,
    phase31_main_module_level_target_biome_tint_decl: phase31.main_module_level_target_biome_tint_decl,
    phase31_main_module_level_biome_transition_timer_decl: phase31.main_module_level_biome_transition_timer_decl,
    phase31_main_tick_biomes_per_frame_defined: phase31.main_tick_biomes_per_frame_defined,
    phase31_main_tick_biomes_per_frame_reads_world_get_biome: phase31.main_tick_biomes_per_frame_reads_world_get_biome,
    phase31_main_tick_biomes_per_frame_uses_lerp_biome_tints: phase31.main_tick_biomes_per_frame_uses_lerp_biome_tints,
    phase31_main_tick_biomes_per_frame_drives_scene_background: phase31.main_tick_biomes_per_frame_drives_scene_background,
    phase31_main_tick_biomes_per_frame_drives_scene_fog_color: phase31.main_tick_biomes_per_frame_drives_scene_fog_color,
    phase31_main_tick_biomes_per_frame_drives_scene_fog_density: phase31.main_tick_biomes_per_frame_drives_scene_fog_density,
    phase31_main_tick_biomes_per_frame_drives_phase_light_color: phase31.main_tick_biomes_per_frame_drives_phase_light_color,
    phase31_main_tick_biomes_per_frame_drives_renderer_set_biome_tint: phase31.main_tick_biomes_per_frame_drives_renderer_set_biome_tint,
    phase31_main_game_loop_calls_tick_biomes_per_frame: phase31.main_game_loop_calls_tick_biomes_per_frame,
    phase31_main_on_phase_changed_calls_set_phase_tint: phase31.main_on_phase_changed_calls_set_phase_tint,
    phase31_main_game_loop_calls_hud_update_with_world: phase31.main_game_loop_calls_hud_update_with_world,
    phase31_main_init_calls_hud_update_with_world: phase31.main_init_calls_hud_update_with_world,
    phase31_debug_force_biome_hook_present: phase31.debug_force_biome_hook_present,
    phase31_debug_force_biome_rejects_bad_input: phase31.debug_force_biome_rejects_bad_input,
    phase31_debug_get_current_biome_id_hook_present: phase31.debug_get_current_biome_id_hook_present,
    phase31_debug_lerp_biome_tints_hook_present: phase31.debug_lerp_biome_tints_hook_present,
    phase31_debug_biome_label_hook_present: phase31.debug_biome_label_hook_present,
    phase31_debug_get_current_biome_tint_hook_present: phase31.debug_get_current_biome_tint_hook_present,
    phase31_debug_tick_biomes_per_frame_hook_present: phase31.debug_tick_biomes_per_frame_hook_present,
    phase31_debug_get_biome_transition_timer_hook_present: phase31.debug_get_biome_transition_timer_hook_present,
    phase31_debug_get_biome_transition_duration_hook_present: phase31.debug_get_biome_transition_duration_hook_present,
    phase31_renderer_create_skybox_has_biome_tint_uniform: phase31.renderer_create_skybox_has_biome_tint_uniform,
    phase31_renderer_create_skybox_has_phase_tint_uniform: phase31.renderer_create_skybox_has_phase_tint_uniform,
    phase31_renderer_create_skybox_fragment_shader_multiplies_tints: phase31.renderer_create_skybox_fragment_shader_multiplies_tints,
    phase31_renderer_create_skybox_mesh_has_set_biome_tint: phase31.renderer_create_skybox_mesh_has_set_biome_tint,
    phase31_renderer_create_skybox_mesh_has_set_phase_tint: phase31.renderer_create_skybox_mesh_has_set_phase_tint,
    phase31_renderer_create_skybox_mesh_named_skybox: phase31.renderer_create_skybox_mesh_named_skybox,
    phase31_renderer_renderer_class_set_biome_tint_forwards: phase31.renderer_renderer_class_set_biome_tint_forwards,
    phase31_renderer_renderer_class_set_phase_tint_forwards: phase31.renderer_renderer_class_set_phase_tint_forwards,
    phase31_hud_constructor_queries_biome_info_element: phase31.hud_constructor_queries_biome_info_element,
    phase31_hud_constructor_initializes_last_biome_id: phase31.hud_constructor_initializes_last_biome_id,
    phase31_hud_update_queries_world_get_biome: phase31.hud_update_queries_world_get_biome,
    phase31_hud_update_writes_biome_info_text: phase31.hud_update_writes_biome_info_text,
    phase31_html_biome_info_element_present: phase31.html_biome_info_element_present,
    phase31_html_biome_info_inside_hud_container: phase31.html_biome_info_inside_hud_container,
    phase31_world_get_biome_method_present: phase31.world_get_biome_method_present,
    phase32_stabilizer_module_exports_stabilizer_radius: phase32.stabilizer_module_exports_stabilizer_radius,
    phase32_stabilizer_module_exports_stabilizer_place_cost: phase32.stabilizer_module_exports_stabilizer_place_cost,
    phase32_stabilizer_module_exports_stabilizer_fallback_color: phase32.stabilizer_module_exports_stabilizer_fallback_color,
    phase32_stabilizer_module_exports_find_respawn_target: phase32.stabilizer_module_exports_find_respawn_target,
    phase32_stabilizer_module_exports_is_within_radius: phase32.stabilizer_module_exports_is_within_radius,
    phase32_stabilizer_module_exports_stabilizer_key: phase32.stabilizer_module_exports_stabilizer_key,
    phase32_stabilizer_module_exports_snap_y_for_stabilizer_cell: phase32.stabilizer_module_exports_snap_y_for_stabilizer_cell,
    phase32_collapse_module_exports_collapse_duration: phase32.collapse_module_exports_collapse_duration,
    phase32_collapse_module_exports_collapse_banner_text: phase32.collapse_module_exports_collapse_banner_text,
    phase32_collapse_module_exports_fallback_warning_text: phase32.collapse_module_exports_fallback_warning_text,
    phase32_collapse_module_exports_collapse_reasons: phase32.collapse_module_exports_collapse_reasons,
    phase32_collapse_module_exports_create_collapse_state: phase32.collapse_module_exports_create_collapse_state,
    phase32_collapse_module_exports_start_collapse: phase32.collapse_module_exports_start_collapse,
    phase32_collapse_module_exports_tick_collapse: phase32.collapse_module_exports_tick_collapse,
    phase32_collapse_module_exports_clear_collapse: phase32.collapse_module_exports_clear_collapse,
    phase32_constants_minimum_respawn_energy: phase32.constants_minimum_respawn_energy,
    phase32_constants_block_stabilizer: phase32.constants_block_stabilizer,
    phase32_main_imports_find_respawn_target: phase32.main_imports_find_respawn_target,
    phase32_main_imports_start_collapse: phase32.main_imports_start_collapse,
    phase32_main_imports_tick_collapse: phase32.main_imports_tick_collapse,
    phase32_main_imports_create_collapse_state: phase32.main_imports_create_collapse_state,
    phase32_main_imports_minimum_respawn_energy: phase32.main_imports_minimum_respawn_energy,
    phase32_main_imports_block_stabilizer: phase32.main_imports_block_stabilizer,
    phase32_main_imports_stabilizer_radius: phase32.main_imports_stabilizer_radius,
    phase32_main_imports_collapse_duration: phase32.main_imports_collapse_duration,
    phase32_main_tick_collapse_per_frame_defined: phase32.main_tick_collapse_per_frame_defined,
    phase32_main_compute_respawn_target_defined: phase32.main_compute_respawn_target_defined,
    phase32_main_game_loop_calls_tick_collapse_per_frame: phase32.main_game_loop_calls_tick_collapse_per_frame,
    phase32_main_force_phase_collapse_starts_state_machine: phase32.main_force_phase_collapse_starts_state_machine,
    phase32_main_force_phase_collapse_calls_compute_respawn_target: phase32.main_force_phase_collapse_calls_compute_respawn_target,
    phase32_main_force_phase_collapse_to_stabilizer_hook: phase32.main_force_phase_collapse_to_stabilizer_hook,
    phase32_main_input_suppressed_flag_declared: phase32.main_input_suppressed_flag_declared,
    phase32_main_keydown_gates_on_input_suppressed: phase32.main_keydown_gates_on_input_suppressed,
    phase32_main_contextmenu_gates_on_input_suppressed: phase32.main_contextmenu_gates_on_input_suppressed,
    phase32_main_click_gates_on_input_suppressed: phase32.main_click_gates_on_input_suppressed,
    phase32_debug_force_place_stabilizer: phase32.debug_force_place_stabilizer,
    phase32_debug_break_stabilizer: phase32.debug_break_stabilizer,
    phase32_debug_get_collapse_state: phase32.debug_get_collapse_state,
    phase32_debug_tick_collapse_per_frame_hook: phase32.debug_tick_collapse_per_frame_hook,
    phase32_debug_get_respawn_target: phase32.debug_get_respawn_target,
    phase32_debug_get_spawn_point: phase32.debug_get_spawn_point,
    phase32_debug_get_stabilizer_snapshot: phase32.debug_get_stabilizer_snapshot,
    phase32_debug_get_stabilizer_count: phase32.debug_get_stabilizer_count,
    phase32_debug_clear_stabilizers: phase32.debug_clear_stabilizers,
    phase32_debug_get_checkpoint_mesh_count: phase32.debug_get_checkpoint_mesh_count,
    phase32_debug_get_checkpoint_keys: phase32.debug_get_checkpoint_keys,
    phase32_debug_is_checkpoint_at: phase32.debug_is_checkpoint_at,
    phase32_renderer_checkpoint_overlay_class_exported: phase32.renderer_checkpoint_overlay_class_exported,
    phase32_renderer_checkpoint_overlay_own_group: phase32.renderer_checkpoint_overlay_own_group,
    phase32_renderer_checkpoint_overlay_show_checkpoint: phase32.renderer_checkpoint_overlay_show_checkpoint,
    phase32_renderer_checkpoint_overlay_update_checkpoints: phase32.renderer_checkpoint_overlay_update_checkpoints,
    phase32_renderer_checkpoint_overlay_clear_checkpoint: phase32.renderer_checkpoint_overlay_clear_checkpoint,
    phase32_renderer_show_checkpoint_forwards: phase32.renderer_show_checkpoint_forwards,
    phase32_renderer_update_checkpoints_forwards: phase32.renderer_update_checkpoints_forwards,
    phase32_renderer_clear_checkpoint_forwards: phase32.renderer_clear_checkpoint_forwards,
    phase32_renderer_clear_checkpoints_forwards: phase32.renderer_clear_checkpoints_forwards,
    phase32_renderer_collapse_overlay_class_exported: phase32.renderer_collapse_overlay_class_exported,
    phase32_renderer_update_collapse_overlay_forwards: phase32.renderer_update_collapse_overlay_forwards,
    phase32_renderer_clear_collapse_overlay_forwards: phase32.renderer_clear_collapse_overlay_forwards,
    phase32_world_find_nearest_stabilizer_defined: phase32.world_find_nearest_stabilizer_defined,
    phase32_world_add_stabilizer_defined: phase32.world_add_stabilizer_defined,
    phase32_world_remove_stabilizer_defined: phase32.world_remove_stabilizer_defined,
    phase32_world_stabilizer_positions_map_initialized: phase32.world_stabilizer_positions_map_initialized,
    phase32_html_phase_collapse_overlay_element: phase32.html_phase_collapse_overlay_element,
    phase32_html_phase_collapse_overlay_css: phase32.html_phase_collapse_overlay_css,

    // ── Phase 3.3 (Echoes) ────────────────────────────────
    // The Phase 3.3 work turns Ruins-biome floating crystals
    // into collectible lore objects with an inventory counter
    // src/collect/echo.js exports
    // and HUD label. The pure module src/collect/echo.js owns
    // the pickup radius + lore library + key formatter.
    // src/inventory/inventory.js owns the inventory state.
    // main.js wires the per-frame pickup loop + the debug hooks.
    phase33_echo_module_exports_pickup_radius: /export\s+const\s+PICKUP_RADIUS\s*=/.test(echoText2),
    phase33_echo_module_exports_echo_lore_library: /export\s+const\s+ECHO_LORE_LIBRARY\s*=\s*Object\.freeze/.test(echoText2),
    phase33_echo_module_exports_echo_lore_for_key: /export\s+function\s+echoLoreForKey/.test(echoText2),
    phase33_echo_module_exports_pickup_result: /export\s+function\s+pickupResult/.test(echoText2),
    phase33_echo_module_exports_echo_key: /export\s+function\s+echoKey/.test(echoText2),
    phase33_echo_module_exports_floating_offset: /export\s+function\s+floatingOffset/.test(echoText2),
    phase33_echo_module_exports_echo_color_for_biome: /export\s+function\s+echoColorForBiome/.test(echoText2),
    phase33_inventory_module_exports_create_inventory: /export\s+function\s+createInventory/.test(inventoryText),
    phase33_inventory_module_exports_add_echo: /export\s+function\s+addEcho/.test(inventoryText),
    phase33_inventory_module_exports_has_echo: /export\s+function\s+hasEcho/.test(inventoryText),
    phase33_inventory_module_exports_list_echoes: /export\s+function\s+listEchoes/.test(inventoryText),
    phase33_inventory_module_exports_remove_echo: /export\s+function\s+removeEcho/.test(inventoryText),
    phase33_inventory_module_exports_add_amplifier: /export\s+function\s+addAmplifier/.test(inventoryText),
    phase33_inventory_module_exports_has_amplifier: /export\s+function\s+hasAmplifier/.test(inventoryText),
    phase33_inventory_module_exports_serialize: /export\s+function\s+serialize/.test(inventoryText),
    phase33_inventory_module_exports_deserialize: /export\s+function\s+deserialize/.test(inventoryText),
    phase33_inventory_module_exports_collected_count: /export\s+function\s+collectedCount/.test(inventoryText),
    phase33_inventory_module_exports_amplifier_count: /export\s+function\s+amplifierCount/.test(inventoryText),
    phase33_constants_block_echo: /export\s+const\s+BLOCK_ECHO\s*=\s*17\b/.test(constantsText),
    phase33_constants_echo_pickup_radius: /export\s+const\s+ECHO_PICKUP_RADIUS\s*=\s*1\.5\b/.test(constantsText),
    phase33_world_spawn_echo_defined: /spawnEcho\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*loreKey\s*,\s*biomeId\s*\)/.test(worldText),
    phase33_world_collect_echo_defined: /collectEcho\s*\(\s*key\s*\)/.test(worldText),
    phase33_world_list_echoes_defined: /listEchoes\s*\(\s*\)/.test(worldText),
    phase33_world_get_total_echoes_defined: /getTotalEchoes\s*\(\s*\)/.test(worldText),
    phase33_world_clear_echoes_defined: /clearEchoes\s*\(\s*\)/.test(worldText),
    phase33_renderer_echo_overlay_class_exported: /export\s+class\s+EchoOverlay\b/.test(rendererText),
    phase33_renderer_echo_overlay_own_group: /class\s+EchoOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]echoOverlay['"]/.test(rendererText),
    phase33_renderer_show_echo_forwards: /showEcho\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*key\s*,\s*color\s*\)\s*\{[\s\S]*?this\.echoOverlay\.showEcho/.test(rendererText),
    phase33_renderer_update_echoes_forwards: /updateEchoes\s*\(\s*dt\s*,\s*snapshot\s*\)\s*\{[\s\S]*?this\.echoOverlay\.updateEchoes/.test(rendererText),
    phase33_renderer_clear_echo_forwards: /clearEcho\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.echoOverlay\.clearEcho/.test(rendererText),
    phase33_renderer_clear_echoes_forwards: /clearEchoes\s*\(\s*\)\s*\{[\s\S]*?this\.echoOverlay\.clearEchoes/.test(rendererText),
    phase33_hud_set_echo_counter_defined: /setEchoCounter\s*\(\s*collected\s*,\s*total\s*\)/.test(hudText2),
    phase33_hud_show_lore_toast_defined: /showLoreToast\s*\(\s*text\s*\)/.test(hudText2),
    phase33_html_echo_counter_element: /id\s*=\s*["']echo-counter["']/.test(htmlText2),
    phase33_html_echo_counter_css: /#echo-counter\s*\{/.test(htmlText2),
    phase33_html_lore_toast_element: /id\s*=\s*["']lore-toast["']/.test(htmlText2),
    phase33_html_lore_toast_css: /#lore-toast\s*\{/.test(htmlText2),
    phase33_main_imports_pickup_radius: /import\s*\{[^}]*PICKUP_RADIUS[^}]*\}\s*from\s*['"]\.\/src\/collect\/echo\.js['"]/.test(srcText),
    phase33_main_imports_inventory_helpers: /import\s*\{[^}]*createInventory[^}]*\}\s*from\s*['"]\.\/src\/inventory\/inventory\.js['"]/.test(srcText),
    phase33_main_player_inventory_decl: /let\s+playerInventory\s*=/.test(srcText),
    phase33_main_tick_echoes_per_frame_defined: /function\s+tickEchoesPerFrame/.test(srcText),
    phase33_main_game_loop_calls_tick_echoes: /tickEchoesPerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    phase33_main_tick_echoes_reads_world_list_echoes: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?world\.listEchoes/.test(srcText),
    phase33_main_tick_echoes_drives_renderer_update_echoes: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?renderer\.updateEchoes/.test(srcText),
    phase33_main_tick_echoes_uses_echo_pickup_result: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?echoPickupResult/.test(srcText),
    phase33_main_tick_echoes_calls_world_collect_echo: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?world\.collectEcho/.test(srcText),
    phase33_main_tick_echoes_calls_hud_set_echo_counter: /function\s+tickEchoesPerFrame[\s\S]{0,2000}?hud\.setEchoCounter/.test(srcText),
    phase33_main_save_game_serializes_inventory: /function\s+saveGame[\s\S]{0,1000}?serializeInventory\s*\(\s*playerInventory\s*\)/.test(srcText),
    phase33_main_save_game_passes_inventory_to_save: /saveSystem\.saveSnapshot\([^)]*inventorySnapshot\s*\)/.test(srcText),
    phase33_main_init_applies_saved_inventory: /function\s+init[\s\S]{0,15000}?deserializeInventory\s*\(\s*_savedState\.inventory\s*\)/.test(srcText),
    phase33_debug_force_spawn_echo: /__phaseShifter__[\s\S]*?forceSpawnEcho\s*\(/.test(srcText),
    phase33_debug_force_collect_echo: /__phaseShifter__[\s\S]*?forceCollectEcho\s*\(/.test(srcText),
    phase33_debug_get_inventory: /__phaseShifter__[\s\S]*?getInventory\s*\(/.test(srcText),
    phase33_debug_list_echoes: /__phaseShifter__[\s\S]*?listEchoes\s*\(/.test(srcText),
    phase33_debug_get_echo_count: /__phaseShifter__[\s\S]*?getEchoCount\s*\(/.test(srcText),
    phase33_debug_get_echo_keys: /__phaseShifter__[\s\S]*?getEchoKeys\s*\(/.test(srcText),
    phase33_debug_get_echo_counter_text: /__phaseShifter__[\s\S]*?getEchoCounterText\s*\(/.test(srcText),
    phase33_debug_tick_echoes_per_frame_hook: /__phaseShifter__[\s\S]*?tickEchoesPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase33_debug_clear_echoes: /__phaseShifter__[\s\S]*?clearEchoes\s*\(/.test(srcText),
    phase33_debug_add_amplifier: /__phaseShifter__[\s\S]*?addAmplifier\s*\(/.test(srcText),
    phase33_save_coerce_inventory_defined: /_coerceInventory\s*\(\s*value\s*\)/.test(saveText),
    phase33_save_coerce_inventory_rejects_non_object: /_coerceInventory[\s\S]{0,500}?return\s+fresh/.test(saveText),
    phase33_save_normalize_state_passes_inventory: /_normalizeState[\s\S]{0,1000}?_coerceInventory\s*\(\s*state\.inventory\s*\)/.test(saveText),
    phase33_save_load_game_returns_inventory: /loadGame[\s\S]{0,2000}?inventory\s*:\s*this\._coerceInventory/.test(saveText),
  };

  console.log('\n=== Phase 1.1 + 1.2 + 1.3 + 1.4 + 1.5 + 1.6 + 1 closure + 2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6 + 2.7 + 2.8 + 3.1 + 3.2 + 3.3 ACCEPTANCE SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  await browser.close();
  if (server) server.kill('SIGTERM');
  const webglWorked = summary.init_recovered_when_webgl_failed === null;
  const regression = webglWorked && !summary.click_handlers_work;
  const phase12Ok =
    summary.phase12_old_atan2_gone !== false &&
    summary.phase12_new_camera_follow_present !== false &&
    summary.phase12_new_quaternion_basis_present !== false;
  const phase13Ok =
    summary.phase13_hardcoded_setposition_y20_gone !== false &&
    summary.phase13_downward_raycast_helper_present !== false &&
    summary.phase13_spawn_info_log_wired !== false;
  const phase14Ok = Object.values(phase14).every(Boolean);
  const phase15Ok = Object.values(phase15).every(Boolean);
  const phase16Ok = Object.values(phase16).every(Boolean);
  const phase17Ok = Object.values(phase17).every(Boolean);
  const phase21Ok = Object.values(phase21).every(Boolean);
  const phase22Ok = Object.values(phase22).every(Boolean);
  const phase23Ok = Object.values(phase23).every(Boolean);
  const phase24Ok = Object.values(phase24).every(Boolean);
  const phase25Ok = Object.values(phase25).every(Boolean);
  const phase26Ok = Object.values(phase26).every(Boolean);
  const phase27Ok = Object.values(phase27).every(Boolean);
  const phase28Ok = Object.values(phase28).every(Boolean);
  const phase31Ok = Object.values(phase31).every(Boolean);
  const phase32Ok = Object.values(phase32).every(Boolean);
  // ── Phase 3.4 (Resonance Cores / Crystal Caverns amplifiers) ─
  // The Phase 3.4 work turns Crystal Caverns floating cores into
  // collectible amplifier objects (AB / BG / AG) that reduce the
  // energy cost of the matching phase shift. The pure module
  // src/collect/resonance.js owns the pickup radius, the
  // amplifier mapping, and the floating animation. main.js wires
  // the per-frame pickup loop + the debug hooks.
  const resonanceSrc = path.resolve(__dirname, '..', '..', 'src', 'collect', 'resonance.js');
  const resonanceText2 = fs2.existsSync(resonanceSrc) ? fs2.readFileSync(resonanceSrc, 'utf8') : '';
  const phase34 = {
    // src/collect/resonance.js exports
    phase34_resonance_module_exports_pickup_radius: /export\s+const\s+PICKUP_RADIUS\s*=/.test(resonanceText2),
    phase34_resonance_module_exports_resonance_core_key: /export\s+function\s+resonanceCoreKey/.test(resonanceText2),
    phase34_resonance_module_exports_resonance_core_color_for_biome: /export\s+function\s+resonanceCoreColorForBiome/.test(resonanceText2),
    phase34_resonance_module_exports_pick_amplifier_for_key: /export\s+function\s+pickAmplifierForKey/.test(resonanceText2),
    phase34_resonance_module_exports_pickup_result: /export\s+function\s+pickupResult/.test(resonanceText2),
    phase34_resonance_module_exports_is_within_radius: /export\s+function\s+isWithinRadius/.test(resonanceText2),
    phase34_resonance_module_exports_floating_offset: /export\s+function\s+floatingOffset/.test(resonanceText2),
    phase34_resonance_module_exports_core_to_world_data: /export\s+function\s+coreToWorldData/.test(resonanceText2),
    phase34_resonance_module_exports_is_resonance_core_block: /export\s+function\s+isResonanceCoreBlock/.test(resonanceText2),
    phase34_resonance_module_exports_amplifier_applies: /export\s+function\s+amplifierApplies/.test(resonanceText2),
    // src/core/constants.js
    phase34_constants_block_resonance_core: /export\s+const\s+BLOCK_RESONANCE_CORE\s*=\s*16\b/.test(constantsText),
    phase34_constants_amplifier_pickup_radius: /export\s+const\s+AMPLIFIER_PICKUP_RADIUS\s*=\s*1\.5\b/.test(constantsText),
    phase34_constants_amplifier_transitions: /export\s+const\s+AMPLIFIER_TRANSITIONS\s*=/.test(constantsText),
    phase34_constants_amplifier_unlock_text: /export\s+const\s+AMPLIFIER_UNLOCK_TEXT\s*=/.test(constantsText),
    phase34_block_properties_has_resonance_core: /\[BLOCK_RESONANCE_CORE\]:\s*\{/.test(constantsText),
    // src/core/world.js
    phase34_world_spawn_resonance_core: /spawnResonanceCore\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*amplifier\s*,\s*biomeId\s*\)/.test(worldText),
    phase34_world_collect_resonance_core: /collectResonanceCore\s*\(\s*key\s*\)/.test(worldText),
    phase34_world_list_resonance_cores: /listResonanceCores\s*\(\s*\)/.test(worldText),
    phase34_world_clear_resonance_cores: /clearResonanceCores\s*\(\s*\)/.test(worldText),
    phase34_world_get_total_resonance_cores: /getTotalResonanceCores\s*\(\s*\)/.test(worldText),
    // src/render/renderer.js
    phase34_renderer_resonance_core_overlay_class_exported: /export\s+class\s+ResonanceCoreOverlay\b/.test(rendererText),
    phase34_renderer_resonance_core_overlay_own_group: /class\s+ResonanceCoreOverlay[\s\S]{0,2500}?this\.group\.name\s*=\s*['"]resonanceCoreOverlay['"]/.test(rendererText),
    phase34_renderer_show_resonance_core_forwards: /showResonanceCore\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*key\s*,\s*color\s*,\s*amplifier\s*\)\s*\{[\s\S]*?this\.resonanceCoreOverlay\.showResonanceCore/.test(rendererText),
    phase34_renderer_update_resonance_cores_forwards: /updateResonanceCores\s*\(\s*dt\s*,\s*snapshot\s*\)\s*\{[\s\S]*?this\.resonanceCoreOverlay\.updateResonanceCores/.test(rendererText),
    phase34_renderer_clear_resonance_core_forwards: /clearResonanceCore\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.resonanceCoreOverlay\.clearResonanceCore/.test(rendererText),
    phase34_renderer_clear_resonance_cores_forwards: /clearResonanceCores\s*\(\s*\)\s*\{[\s\S]*?this\.resonanceCoreOverlay\.clearResonanceCores/.test(rendererText),
    phase34_renderer_get_resonance_core_count: /getResonanceCoreCount\s*\(\s*\)/.test(rendererText),
    // src/ui/hud.js
    phase34_hud_constructor_queries_amp_status: /querySelector\(['"]#amplifier-status['"]\)/.test(hudText2),
    phase34_hud_set_amplifier_status_method: /setAmplifierStatus\s*\(\s*unlocked\s*\)/.test(hudText2),
    // index.html
    phase34_html_amplifier_status_element: /id\s*=\s*["']amplifier-status["']/.test(htmlText2),
    phase34_html_amplifier_status_css: /#amplifier-status\s*\{/.test(htmlText2),
    // main.js
    phase34_main_imports_resonance: /import\s*\{[^}]*resonanceCoreKey[^}]*\}\s*from\s*['"]\.\/src\/collect\/resonance\.js['"]/.test(srcText),
    phase34_main_tick_resonance_cores_per_frame: /function\s+tickResonanceCoresPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase34_main_tick_resonance_cores_per_frame_called: /tickResonanceCoresPerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    phase34_main_force_spawn_resonance_core: /__phaseShifter__[\s\S]*?forceSpawnResonanceCore\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*amplifier\s*,\s*biomeId\s*\)/.test(srcText),
    phase34_main_force_collect_resonance_core: /__phaseShifter__[\s\S]*?forceCollectResonanceCore\s*\(\s*key\s*\)/.test(srcText),
    phase34_main_get_resonance_cores: /__phaseShifter__[\s\S]*?getResonanceCores\s*\(\s*\)/.test(srcText),
    phase34_main_get_resonance_core_count: /__phaseShifter__[\s\S]*?getResonanceCoreCount\s*\(\s*\)/.test(srcText),
    phase34_main_get_amplifier_status_text: /__phaseShifter__[\s\S]*?getAmplifierStatusText\s*\(\s*\)/.test(srcText),
    phase34_main_get_shift_cost: /__phaseShifter__[\s\S]*?getShiftCost\s*\(\s*from\s*,\s*to\s*\)/.test(srcText),
    phase34_debug_tick_resonance_cores_per_frame_hook: /__phaseShifter__[\s\S]*?tickResonanceCoresPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase34_main_hud_set_amplifier_status_wired: /hud\.setAmplifierStatus\s*\(\s*playerInventory\.amplifiers\s*\)/.test(srcText),
  };

  console.log('\n=== Phase 3.4 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase34, null, 2));
  console.log('\n=== Phase 3.3 static-analysis (against source files) ===');
  console.log(JSON.stringify(phase33, null, 2));
  // ── Phase 3.5 (Phase Lock + Phase Glider) ───────────────
  // The §3.5 work ports the orphan PhaseLockManager to the
  // active path. A lock holds a block visible + solid in the
  // new phase for LOCK_DURATION (10s). The Phase Glider is a
  // brief fly in Beta via Space.
  const phaseLockSrc = path.resolve(__dirname, '..', '..', 'src', 'phase', 'lock.js');
  const phaseLockText = fs2.existsSync(phaseLockSrc) ? fs2.readFileSync(phaseLockSrc, 'utf8') : '';
  const phase35 = {
    // src/phase/lock.js exports
    phase35_lock_module_exports_lock_duration: /export\s+const\s+LOCK_DURATION\s*=\s*10\b/.test(phaseLockText),
    phase35_lock_module_exports_lock_fade_window: /export\s+const\s+LOCK_FADE_WINDOW\s*=\s*3\b/.test(phaseLockText),
    phase35_lock_module_exports_lock_radius: /export\s+const\s+LOCK_RADIUS\s*=\s*3\b/.test(phaseLockText),
    phase35_lock_module_exports_lock_fill_color: /export\s+const\s+LOCK_FILL_COLOR\s*=/.test(phaseLockText),
    phase35_lock_module_exports_lock_border_color: /export\s+const\s+LOCK_BORDER_COLOR\s*=/.test(phaseLockText),
    phase35_lock_module_exports_phase_glider_duration: /export\s+const\s+PHASE_GLIDER_DURATION\s*=/.test(phaseLockText),
    phase35_lock_module_exports_phase_glider_speed: /export\s+const\s+PHASE_GLIDER_SPEED\s*=/.test(phaseLockText),
    phase35_lock_module_exports_lock_key: /export\s+function\s+lockKey/.test(phaseLockText),
    phase35_lock_module_exports_create_lock: /export\s+function\s+createLock/.test(phaseLockText),
    phase35_lock_module_exports_is_lock_expired: /export\s+function\s+isLockExpired/.test(phaseLockText),
    phase35_lock_module_exports_lock_fade_opacity: /export\s+function\s+lockFadeOpacity/.test(phaseLockText),
    phase35_lock_module_exports_tick_locks: /export\s+function\s+tickLocks/.test(phaseLockText),
    phase35_lock_module_exports_is_locked: /export\s+function\s+isLocked/.test(phaseLockText),
    phase35_lock_module_exports_lock_region: /export\s+function\s+lockRegion/.test(phaseLockText),
    phase35_lock_module_exports_create_glider_state: /export\s+function\s+createGliderState/.test(phaseLockText),
    phase35_lock_module_exports_start_glider: /export\s+function\s+startGlider/.test(phaseLockText),
    phase35_lock_module_exports_tick_glider: /export\s+function\s+tickGlider/.test(phaseLockText),
    phase35_lock_module_exports_clear_glider: /export\s+function\s+clearGlider/.test(phaseLockText),
    // src/core/world.js
    phase35_world_create_lock: /createLock\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*duration\s*\)/.test(worldText),
    phase35_world_tick_locks: /tickLocks\s*\(\s*dt\s*\)/.test(worldText),
    phase35_world_is_locked: /isLocked\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*\)/.test(worldText),
    phase35_world_list_locks: /listLocks\s*\(\s*\)/.test(worldText),
    phase35_world_clear_locks: /clearLocks\s*\(\s*\)/.test(worldText),
    phase35_world_export_locks: /exportLocks\s*\(\s*\)/.test(worldText),
    phase35_world_import_locks: /importLocks\s*\(\s*snapshot\s*\)/.test(worldText),
    phase35_world_get_lock_count: /getLockCount\s*\(\s*\)/.test(worldText),
    phase35_world_is_block_solid_considers_locks: /isBlockSolid[\s\S]{0,500}?_phaseLocks/.test(worldText),
    // src/render/renderer.js
    phase35_renderer_lock_overlay_class_exported: /export\s+class\s+LockOverlay\b/.test(rendererText),
    phase35_renderer_lock_overlay_own_group: /class\s+LockOverlay[\s\S]{0,2000}?this\.group\.name\s*=\s*['"]lockOverlay['"]/.test(rendererText),
    phase35_renderer_show_lock_forwards: /showLock\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*key\s*\)\s*\{[\s\S]*?this\.lockOverlay\.showLock/.test(rendererText),
    phase35_renderer_update_locks_forwards: /updateLocks\s*\(\s*snapshot\s*\)\s*\{[\s\S]*?this\.lockOverlay\.updateLocks/.test(rendererText),
    phase35_renderer_clear_lock_forwards: /clearLock\s*\(\s*key\s*\)\s*\{[\s\S]*?this\.lockOverlay\.clearLock/.test(rendererText),
    phase35_renderer_clear_locks_forwards: /clearLocks\s*\(\s*\)\s*\{[\s\S]*?this\.lockOverlay\.clearLocks/.test(rendererText),
    phase35_renderer_get_lock_count: /getLockCount\s*\(\s*\)/.test(rendererText),
    // main.js
    phase35_main_imports_lock: /import\s*\{[^}]*LOCK_DURATION[^}]*\}\s*from\s*['"]\.\/src\/phase\/lock\.js['"]/.test(srcText),
    phase35_main_tick_locks_per_frame: /function\s+tickLocksPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase35_main_tick_locks_per_frame_called: /tickLocksPerFrame\s*\(\s*deltaTime\s*\)/.test(srcText),
    phase35_main_glider_state: /let\s+gliderState\s*=\s*createGliderState/.test(srcText),
    phase35_main_tick_glider_per_frame: /function\s+tickGliderPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase35_main_on_phase_changed_creates_locks: /onPhaseChanged[\s\S]{0,3000}?world\.createLock/.test(srcText),
    phase35_main_force_create_lock: /__phaseShifter__[\s\S]*?forceCreateLock\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*duration\s*\)/.test(srcText),
    phase35_main_get_lock_count: /__phaseShifter__[\s\S]*?getLockCount\s*\(\s*\)/.test(srcText),
    phase35_main_is_locked: /__phaseShifter__[\s\S]*?isLocked\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*\)/.test(srcText),
    phase35_main_clear_locks: /__phaseShifter__[\s\S]*?clearLocks\s*\(\s*\)/.test(srcText),
    phase35_debug_tick_locks_per_frame_hook: /__phaseShifter__[\s\S]*?tickLocksPerFrame\s*\(\s*dt\s*\)/.test(srcText),
    phase35_main_start_glider: /__phaseShifter__[\s\S]*?startGlider\s*\(\s*direction\s*\)/.test(srcText),
    phase35_main_get_glider_state: /__phaseShifter__[\s\S]*?getGliderState\s*\(\s*\)/.test(srcText),
  };

  const phase35Ok = Object.values(phase35).every(Boolean);
  const phase34Ok = Object.values(phase34).every(Boolean);
  const phase33Ok = Object.values(phase33).every(Boolean);
  const phase34Ok_ = phase34Ok;
  const phase35Ok_ = phase35Ok;
  process.exit(
    summary.structural_dom_all_present &&
    summary.no_unrelated_pageerrors &&
    !regression &&
    phase12Ok &&
    phase13Ok &&
    phase14Ok &&
    phase15Ok &&
    phase16Ok &&
    phase17Ok &&
    phase21Ok &&
    phase22Ok &&
    phase23Ok &&
    phase24Ok &&
    phase25Ok &&
    phase26Ok &&
    phase27Ok &&
    phase28Ok &&
    phase31Ok &&
    phase32Ok &&
    phase33Ok && phase34Ok_ && phase35Ok_ ? 0 : 1
  );
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
