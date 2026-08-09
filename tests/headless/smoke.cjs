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
  const getSetText = worldText.slice(worldText.indexOf('getBlock('), worldText.indexOf('// Build/update chunk meshes'));
  const phase14 = {
    world_index_defined: /\bindex\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText),
    world_local_index_defined: /\blocalIndex\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/.test(worldText),
    world_unpack_index_defined: /\bunpackIndex\s*\(\s*i\s*\)/.test(worldText),
    get_set_raw_formulas_gone: !/\b(?:lx|x)\s*\+\s*(?:wy|y)\s*\*\s*CHUNK_SIZE\s*\+\s*(?:lz|z)\s*\*\s*CHUNK_SIZE\s*\*\s*CHUNK_HEIGHT/.test(getSetText),
    renderer_uses_index_helpers: /world\.unpackIndex\s*\(\s*i\s*\)/.test(rendererText) && /world\.localIndex\s*\(\s*nx\s*,\s*ny\s*,\s*nz\s*\)/.test(rendererText),
    scans_use_world_index: (srcText.match(/world\.index\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)/g) || []).length >= 2,
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

  // Phase 2.1: phase shift is fully wired end-to-end.
  const audioSrc = path.resolve(__dirname, '..', '..', 'src', 'audio', 'manager.js');
  const hudSrc = path.resolve(__dirname, '..', '..', 'src', 'ui', 'hud.js');
  const htmlSrc = path.resolve(__dirname, '..', '..', 'index.html');
  const audioText2 = fs2.existsSync(audioSrc) ? fs2.readFileSync(audioSrc, 'utf8') : '';
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
  };
  console.log('\n=== Phase 1.1 + 1.2 + 1.3 + 1.4 + 1.5 + 1.6 + 1 closure + 2.1 ACCEPTANCE SUMMARY ===');
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
    phase21Ok ? 0 : 1
  );
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
