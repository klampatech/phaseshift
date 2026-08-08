# Phase Shifter — Hand-off

> **Session goal:** Begin **Phase 1.1 — Fix the init crash**.
> See [`PROJECT_REMEDIATION_PLAN.md`](./PROJECT_REMEDIATION_PLAN.md) for the full plan.

---

## TL;DR

- **Repo:** `/home/kyle/Development/phaseshift` (local) ⇄ `klampatech/phaseshift` (remote, public).
- **Branch:** `main`. **Last commit:** `ebfcd07` (`Initial import + Phase 0: enforce single-engine architectural decision`).
- **Phase 0 done.** Phase 1 is next. Start with **1.1 — init crash** (the page throws on load because `setupMenuButtons()` looks up `#btn-inv`, `#inv-close`, and these don't exist in `index.html`).
- **Active code path:** `index.html` → `main.js` (root) → `src/core/{world,phase,physics}.js` + `src/{render,ui,input,audio,save}/*`.
- **Quarantined reference implementation:** orphan `GameEngine` modules — see "Architectural state" below. **Do not import them.**

---

## Sandbox quirks (read this first — they're load-bearing)

1. **`.git` is bind-mounted.** The sandbox overlays `/home/kyle/Development/phaseshift/.git` with a read-only tmpfs that re-mounts after every change. The working state lives at `/tmp/phaseshift-git` (a real git dir) bound on top of the empty overlay. `git` commands in the workspace operate against `/tmp/phaseshift-git` transparently. **Don't `rm -rf .git` or `git init` again** — it'll break the bind.
2. **`gh` CLI is unreliable** in this sandbox (resolves DNS but the API calls time out / fail oddly). Use `curl` with the token from `~/.config/gh/hosts.yml` instead:
   ```bash
   TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
   curl -sS -H "Authorization: token $TOKEN" https://api.github.com/...
   ```
3. **SSH is blocked** (`Bad owner or permissions on /etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf`). All remotes must use HTTPS. If auth is needed, embed the token in the URL temporarily and strip it after (`git remote set-url origin https://github.com/...`).
4. **No browser is runnable.** Playwright tries to bind to ports and fails with `EPERM`. You can run `npm run build` and Node `node --check <file>` for syntax, but you cannot execute the integration tests here. Manual browser testing is the user's responsibility.
5. **No raw ICMP / `ping`**, but HTTPS works fine for GitHub and npm.
6. **DNS is blocked in the non-elevated sandbox.** `getent hosts github.com` returns nothing; `curl` and `git push` fail with `Could not resolve host`. Workaround: use `sudo -E -n -- <cmd>` to push (preserves `GIT_DIR` / `GIT_WORK_TREE`). For API calls, also use `sudo -n -- curl ...`. Direct IP resolution still works in some cases (e.g. `curl --resolve github.com:443:140.82.112.3`).
7. **`git` writes need `GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift`** in this sandbox. The workspace's `.git/` is overlaid with read-only tmpfs that re-mounts after every change; the working state lives at `/tmp/phaseshift-git`. With `GIT_DIR` set, normal add/commit/push work — without it, `git add` fails with `Read-only file system`.
8. **Do NOT re-bind-mount the workspace's `.git/`** — the sandbox will re-overlay it on top of your bind and break git. Stick to `GIT_DIR=/tmp/phaseshift-git` for the duration of the session.

---

## Architectural state (post-Phase 0)

**Single source of truth:**

| Concern | File | Class |
|---|---|---|
| Chunks, indexing, getBlock/setBlock, phase memory | `src/core/world.js` | `World` |
| Phase state machine, energy, listeners | `src/core/phase.js` | `PhaseManager` |
| Gravity, AABB collision, phase-relative collision | `src/core/physics.js` | `PhysicsManager` |
| Render loop, post-processing, chunk visuals | `src/render/renderer.js` | `setupLighting`, `createPlayerMesh`, `createSkybox`, `ChunkVisual`, `setupPostProcessing` |
| Input / pointer lock | `src/input/controls.js` | `Controls` |
| HUD | `src/ui/hud.js` | `HUD` |
| Audio | `src/audio/manager.js` | `AudioManager` |
| Save / settings | `src/save/{system,settings}.js` | `SaveSystem`, `Settings` |

**Missing helpers that Phase 1 will add (do NOT add them ahead of 1.4 / 1.5 / 1.6):**
- `World.index(x, y, z)` / `World.localIndex(cx, cz, x, z)` — Phase 1.4
- `World.getChunk(x, z)` — Phase 1.5
- `SaveSystem.saveGame(x, y, z, phase)` / `getLastSaveInfo()` / `loadGame()` — Phase 1.6

**Quarantined reference implementation (do not import):**

These files have a 19-line `REFERENCE IMPLEMENTATION — DO NOT IMPORT` banner at the top. They are the orphan `GameEngine` code path, kept around so features can be ported from them into the active path one at a time:

- `src/core/game.js`
- `src/core/player.js`
- `src/core/phaseManager.js` (note: separate from `src/core/phase.js` — the orphan one is unused)
- `src/core/phaseLockManager.js`
- `src/core/phaseChanger.js` (empty `extends PhaseManager` subclass — also quarantined)
- `src/core/particles/particleManager.js`

**Confirmed via Vite tree-shake:** `grep "GameEngine\|PhaseLockManager\|ParticleManager" dist/assets/*.js` returns 0 hits — the orphans do not ship in the production bundle.

**Pre-existing bug to be aware of when porting from `src/core/game.js`:** line ~374 has `SyntaxError: Identifier 'ppos' has already been declared`. Fix during porting, not now.

---

## Phase 0 — what got committed in `ebfcd07`

- ✅ Deleted `src/main.js` (5-line stub: `import { GameEngine }; new GameEngine()`).
- ✅ Deleted `tests/test-phaselock.spec.js` (only external importer of orphan `PhaseLockManager`).
- ✅ Added `.gitignore` (`node_modules/`, `dist/`, `playwright-report/`, `test-results/`, `reports/`, `*.log`, `.DS_Store`).
- ✅ Prepended deprecation banner to the 6 orphan files listed above.
- ✅ Verified `vite build` succeeds; orphans tree-shaken out of `dist/assets/*.js`.

---

## Phase 1 — what to do next

The plan's Phase 1 is "Stop the bleeding" — make the page load, the canvas render, the player move, the camera follow. Sub-tasks:

| # | Task | Key file(s) |
|---|---|---|
| **1.1** | **Fix the init crash** | `index.html`, `main.js` |
| 1.2 | Camera follow + camera-derived movement basis + eye-height offset | `main.js` (gameLoop), `src/input/controls.js` |
| 1.3 | Safe spawn via downward raycast | `main.js` |
| 1.4 | Single index scheme + `World.index(x, y, z)` | `src/core/world.js` |
| 1.5 | `World.getChunk(x, z)`; stop using `chunk.x`/`chunk.z` | `src/core/world.js`, `main.js`, `src/render/renderer.js` |
| 1.6 | `SaveSystem.saveGame` / `loadGame` / `getLastSaveInfo` | `src/save/system.js`, `main.js` |

### 1.1 — Fix the init crash (start here)

**Problem.** `setupMenuButtons()` (around `main.js:200`) calls `document.getElementById('btn-inv').addEventListener(...)` and `document.getElementById('inv-close').addEventListener(...)`. Those elements don't exist in `index.html` (it has `#pause-menu` with `btn-resume`/`btn-save`/`btn-quit` and `#options-panel` with `opts-close`/`opt-autosave`, but no `#inventory-panel`/`#crafting-panel`). Page crashes before any listeners attach, so even `controls` and `hud` aren't fully wired.

**Acceptance.** Page loads with no console errors. `window.__phaseShifter__` is set. `chunkCount === 29`. `phase === 0`.

**Two acceptable fixes (pick one and document the choice in the commit):**
- **Option A (preferred per plan):** Add `#inventory-panel` and `#crafting-panel` to `index.html`, plus the buttons `btn-inv` and `inv-close` in the pause menu. The plan calls for these panels eventually (inventory + crafting are part of Phase 3).
- **Option B (faster):** Guard each `addEventListener` call with `if (btn)`. Smaller diff, but doesn't add the missing DOM that the spec references.

**Also:** remove `throw e` from the global `try/catch` (if any) so a non-fatal init error doesn't kill the script. Log + recover instead. Move `setupMenuButtons()` to be the **last** call in `init()`.

**How to test in this sandbox:**
```bash
# Syntax check
node --check main.js && node --check src/core/world.js

# Build (catches import errors and unused-symbol issues)
npm run build
```

You cannot boot a browser here — the user will do the visual smoke test. Note in the commit message what the user should see.

### 1.2 — Camera follow (next)

After the page loads, the camera sits at the player's start position but does not track movement. Specifically:
- After every physics tick, do `camera.position.copy(physicsManager.getPos())` (offset by eye height — `y += 1.6`).
- Apply `controls.yaw`/`pitch` to the camera's Euler/quaternion.
- In `gameLoop`, derive the movement basis from `camera.quaternion` (forward = `-z` transformed by the quaternion), **not** from `Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z)`. That formula is wrong because it ignores camera pitch.

**Acceptance:** player moves with WASD, the camera trails, and walking direction matches where the player is looking.

Continue through 1.3 → 1.6 sequentially. Acceptance criteria are listed in the plan.

---

## How to commit and push

```bash
# In the workspace — bind-mount is already in place; git works normally.
cd /home/kyle/Development/phaseshift
git add -A
git commit -m "Phase 1.1: fix init crash — add missing inventory DOM + guard listeners"
git push origin main
```

Each phase should be **one or more focused commits** with messages referencing the phase number (e.g. `Phase 1.1: …`, `Phase 1.2: …`). The user handles PRs.

---

## Quick reference: file map

```
phaseshift/
├── index.html                    # Static shell (HUD CSS lives here for now)
├── main.js                       # Active game loop — 980 lines, root cause of most bugs
├── GAME_SPEC.md                  # Design spec
├── PROJECT_REMEDIATION_PLAN.md   # The plan you're executing
├── HANDOFF.md                    # This file
├── package.json
├── vite.config.js
├── playwright.config.js
├── .gitignore
├── src/
│   ├── core/
│   │   ├── constants.js          # Block enums, phase enums, tuning
│   │   ├── world.js              # World — chunks, indexing, getBlock/setBlock
│   │   ├── phase.js              # PhaseManager — phase state machine
│   │   ├── physics.js            # PhysicsManager — gravity, AABB, phase-relative collision
│   │   ├── phaseChanger.js       # ORPHAN — empty extends PhaseManager
│   │   ├── phaseManager.js       # ORPHAN — old PhaseManager
│   │   ├── phaseLockManager.js   # ORPHAN — Phase Lock feature
│   │   ├── player.js             # ORPHAN — old Player class
│   │   ├── game.js               # ORPHAN — old GameEngine class
│   │   └── particles/
│   │       ├── particleManager.js          # ORPHAN
│   │       ├── particleVertexShader.js     # GLSL — only consumed by particleManager.js
│   │       └── particleFragmentShader.js   # GLSL — only consumed by particleManager.js
│   ├── render/
│   │   └── renderer.js           # setupLighting, createPlayerMesh, createSkybox, ChunkVisual, setupPostProcessing
│   ├── input/
│   │   └── controls.js           # Pointer-lock input
│   ├── ui/
│   │   └── hud.js                # HUD class
│   ├── audio/
│   │   └── manager.js            # AudioManager
│   ├── save/
│   │   ├── system.js             # SaveSystem
│   │   └── settings.js           # Settings
│   └── gen/
│       ├── terrain.js            # Noise + biome-driven chunk generation
│       ├── noise.js              # SimplexNoise + FBM
│       └── gameState.js
├── tests/                        # Playwright suite (cannot run in this sandbox)
│   ├── constants.spec.js
│   ├── core.spec.js
│   ├── debug*.spec.js            # Many debug-*.spec.js — keep for now
│   ├── game.spec.js
│   ├── gameplay.spec.js
│   ├── test-hud*.spec.js
│   └── unit.spec.js
└── debug.js, debug.mjs, debug2.mjs   # Dev scratch files — leave alone
```

---

## Known risks (from plan's risk register)

- **Orphan `GameEngine` bugs being ported in** — re-evaluate each module as it's ported; the orphans are reference, not authority.
- **Physics refactor breaks collision** — keep the existing AABB collision logic; add a unit test for `phaseSolid` per block (Phase 6).
- **Save/load field loss** — Phase 1.6 must add a save→load round-trip test (Phase 6.3).
- **Vite + Three.js examples mismatch** — Three.js is pinned to `^0.160.0`. Verify post-processing imports still resolve on every build.

