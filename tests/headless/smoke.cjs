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

  const summary = {
    http_ok: resp.status() === 200,
    structural_dom_all_present: domOk,
    pause_menu_buttons_present: ['btn-resume','btn-save','btn-inv','btn-opts','btn-quit'].every(id => structural[id]),
    no_unrelated_pageerrors: otherErr.length === 0,
    init_recovered_when_webgl_failed: webglErr.length > 0 ? initRecovered : null,
    click_handlers_work: handlersWork,
    page_errors: pageErrors,
  };
  console.log('\n=== Phase 1.1 ACCEPTANCE SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  await browser.close();
  if (server) server.kill('SIGTERM');
  const webglWorked = summary.init_recovered_when_webgl_failed === null;
  const regression = webglWorked && !summary.click_handlers_work;
  process.exit(summary.structural_dom_all_present && summary.no_unrelated_pageerrors && !regression ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
