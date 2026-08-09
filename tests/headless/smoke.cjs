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
  const saveSrc = path.resolve(__dirname, '..', '..', 'src', 'save', 'system.js');
  const saveText = fs2.existsSync(saveSrc) ? fs2.readFileSync(saveSrc, 'utf8') : '';
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
    save_snapshot_defined: /saveSnapshot\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*phase\s*,\s*worldState\s*\)/.test(saveText),
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
    place_anchor_shows_deferred_notification: /placeAnchor[\s\S]{0,400}?Anchor placement pending §2\.7/.test(srcText),
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
    phase23_place_anchor_shows_deferred_notification: phase23.place_anchor_shows_deferred_notification,
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
  };
  console.log('\n=== Phase 1.1 + 1.2 + 1.3 + 1.4 + 1.5 + 1.6 + 1 closure + 2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6 ACCEPTANCE SUMMARY ===');
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
    phase26Ok ? 0 : 1
  );
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
