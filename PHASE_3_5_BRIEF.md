# Phase 3.5 — Starting Brief

> **Session goal:** Implement Phase 3.5 — Phase Lock + Phase Glider. Port the orphan `PhaseLockManager` logic to the active path: a lock holds a block visible + solid in the new phase for `LOCK_DURATION` (10s) after a phase shift. The Phase Glider is a brief fly in Beta via Space.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §3.5.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 3.4 closure (`ef27384`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–3.4 shipped the core mechanics, the per-biome visual layer, audio cues, Phase Anchor, Phase Lens, Resonance pulse, Phase Collapse state machine, Echoes (collectible lore), and Resonance Cores (Crystal Caverns amplifiers). But the §3.5 plan ("Phase Lock + Phase Glider") is the first session-sized piece of the "give the player a reason to phase-shift mid-exploration" arc. The acceptance is:

> **Acceptance (from plan §3.5):** walking into a 1-block gap in Alpha and pressing Phase Step blink-keys Q to Beta and Pacman-style phases through the gap.

The codebase has scaffolding already in place:

1. **`PHASE_STEP_THRESHOLD = 3.0`** + **`PHASE_STEP_COOLDOWN = 0.5`** + **`PHASE_STEP_DURATION = 0.15`** in `src/core/constants.js` — the existing Phase Step constants.
2. **`physicsManager.tryPhaseStep(moveX, moveZ)`** in `src/core/physics.js` — the existing Phase Step implementation (port of the §2.1 brief).
3. **`player._flashPhase(phase)`** in `src/core/player.js` — the existing player flash visual.
4. **Orphan `PhaseLockManager`** in `src/core/phaseLockManager.js` — the reference implementation to port. The active path doesn't use it; the §3.5 work ports the lock + tick + clear logic to the active path.
5. **On phase change** (`onPhaseChanged` in `main.js`) — the §3.5 work hooks the lock creation here.

What's missing for §3.5:

- A pure helper module `src/phase/lock.js` that:
  - Owns the lock state machine: `createLock(x, y, z, phase, now, duration)` returns a lock entry; `isLockExpired(lock, now)` checks expiry; `lockFadeOpacity(lock, now)` returns the fade-window opacity; `tickLocks(lockList, now)` returns the list with expired locks removed; `isLocked(lockList, x, y, z, phase, now)` is the O(N) lookup.
  - Owns the lock key format `lockKey(x, y, z, phase)` (canonical `"x,y,z,phase"`).
  - Owns the lock region helper `lockRegion(playerX, playerY, playerZ, radius)` for the on-phase-shift hook.
  - Owns the Phase Glider state machine: `createGliderState()`, `startGlider(state, direction, now)`, `tickGlider(state, dt)` (dt clamped to 0.1, returns `{state, done, dx, dy, dz}`), `clearGlider(state)`.
  - Exports the canonical constants: `LOCK_DURATION = 10`, `LOCK_FADE_WINDOW = 3`, `LOCK_RADIUS = 3`, `LOCK_FILL_COLOR = 0xffee88`, `LOCK_BORDER_COLOR = 0xffcc00`, `PHASE_GLIDER_DURATION = 1.2`, `PHASE_GLIDER_SPEED = 6.0`.
- A new `World` API:
  - `World.createLock(x, y, z, phase, duration)` — idempotent (re-locking the same key refreshes the duration).
  - `World.tickLocks(dt)` — removes expired locks.
  - `World.isLocked(x, y, z, phase)` — fast lookup (O(N) over `_phaseLocks`).
  - `World.listLocks()` / `World.getLockCount()` / `World.getLockKeys()`.
  - `World.exportLocks()` / `World.importLocks(snapshot)` — for save/load.
  - `World.clearLocks()` — test reset path.
  - `World.isBlockSolid(x, y, z, phase)` updated to consider locks (the lock overrides `phaseSolid` for the locked cell).
- A new `LockOverlay` class in `src/render/renderer.js`:
  - A `THREE.Group` named `lockOverlay` (independent of the chunk-mesh, Phase Lens, Resonance, Anchor, Checkpoint, Collapse, Echo, and Resonance Core groups).
  - Per-lock: `BoxGeometry(1.02)` + `EdgesGeometry` + per-lock fill/edge materials so the pulse-fade in the last 3s is per-lock.
  - Methods: `showLock(x, y, z, phase, key)` / `updateLocks(snapshot)` / `clearLock(key)` / `clearLocks()`.
- A per-frame `tickLocksPerFrame(dt)` in `main.js`:
  - Reads `world.listLocks()` and drives the overlay.
  - Calls `world.tickLocks(dt)` to remove expired locks.
- A per-frame `tickGliderPerFrame(dt)` in `main.js`:
  - Advances the glider state machine.
  - Applies the per-frame delta to the player position via `physicsManager.setPosition(...)`.
- On phase shift, `onPhaseChanged` in `main.js` calls `world.createLock(cell.x, cell.y, cell.z, phase, LOCK_DURATION)` for each cell in `lockRegion(playerX, playerY, playerZ, LOCK_RADIUS)` that has a non-air block in the new phase.
- New debug hooks: `__phaseShifter__.forceCreateLock(x, y, z, phase, duration?)` / `getLockCount()` / `getLockKeys()` / `isLocked(x, y, z, phase)` / `clearLocks()` / `tickLocksPerFrame(dt)` / `startGlider(direction)` / `tickGliderPerFrame(dt)` / `getGliderState()` / `clearGlider()`.

## Acceptance (from plan §3.5)

1. **On phase shift, blocks around the player are locked for 10 seconds.** The lock region is `LOCK_RADIUS = 3` blocks around the player; only cells with non-air blocks in the new phase are locked.
2. **Locked blocks are solid in their locked phase** (even if they would be transparent otherwise). E.g. an Obsidian block in Alpha (only solid in Gamma) becomes solid in Beta when locked.
3. **Locked blocks show a yellow-glow outline** (fill 0.4 opacity, edge 0.9 opacity).
4. **In the last 3 seconds, the outline pulses** (`lockFadeOpacity` returns a pulsing value in `(0, 1)`).
5. **After 10 seconds, the lock expires and the block returns to its normal phase-relative solidity.** The `isBlockSolid` check reverts.
6. **Phase Glider: Space held in Beta = brief fly for 1.2s.** The glider state machine starts on Space press, advances via `tickGliderPerFrame`, applies the per-frame delta to the player position.
7. **Phase Glider ends after 1.2s.** The `tickGlider` returns `done: true` once the timer reaches the duration; the next tick clears the state.
8. **The save blob includes the lock snapshot.** `exportLocks` / `importLocks` round-trip the active locks; expired locks are pushed forward by `duration` so the saved locks are usable after reload.
9. **The collision override is testable.** `World.isBlockSolid(0, 30, 0, 1)` returns `true` when `(0, 30, 0, phase=1)` is locked, even if Obsidian is normally non-solid in Beta.

## Fix shape

1. **`src/phase/lock.js`** (new — pure module). Exports:
   - `LOCK_DURATION = 10`, `LOCK_FADE_WINDOW = 3`, `LOCK_RADIUS = 3`.
   - `LOCK_FILL_COLOR = 0xffee88`, `LOCK_BORDER_COLOR = 0xffcc00`.
   - `PHASE_GLIDER_DURATION = 1.2`, `PHASE_GLIDER_SPEED = 6.0`.
   - `lockKey(x, y, z, phase)` — canonical `"x,y,z,phase"`.
   - `createLock(x, y, z, phase, now, duration)` — returns a lock entry.
   - `isLockExpired(lock, now)` — expiry check.
   - `lockFadeOpacity(lock, now)` — returns the fade-window opacity (1.0 normally; pulses in the last 3s; 0 when expired).
   - `tickLocks(lockList, now)` — returns the list with expired locks removed.
   - `isLocked(lockList, x, y, z, phase, now)` — O(N) lookup.
   - `activeLocks(lockList, now)` — filters to active only.
   - `lockRegion(playerX, playerY, playerZ, radius)` — returns the 3D cell list to lock.
   - `createGliderState()`, `startGlider(state, direction, now)`, `tickGlider(state, dt)` (returns `{state, done, dx, dy, dz}`), `clearGlider(state)`.
   - `PHASE_LOCK_DEFAULTS` — frozen map of all defaults.

2. **`src/core/world.js`** (extend). Add `§3.5 Phase Lock API`:
   - `this._phaseLocks` map (key → lock entry).
   - `World.createLock(x, y, z, phase, duration)` — idempotent.
   - `World.tickLocks(dt)` — removes expired.
   - `World.isLocked(x, y, z, phase)` — fast lookup.
   - `World.listLocks()` / `World.getLockCount()` / `World.getLockKeys()`.
   - `World.exportLocks()` / `World.importLocks(snapshot)` — save/load (defensive: filters invalid entries, pushes past expires forward).
   - `World.clearLocks()` — test reset.
   - `World.isBlockSolid(x, y, z, phase)` updated to consider locks (lock overrides `phaseSolid`).

3. **`src/render/renderer.js`** (extend). Add `LockOverlay` class:
   - Separate `THREE.Group` named `lockOverlay` (independent of all other groups).
   - Per-lock: `BoxGeometry(1.02, 1.02, 1.02)` + `EdgesGeometry` + per-lock fill/edge materials.
   - Methods: `showLock` / `updateLocks` / `clearLock` / `clearLocks` / `getCount` / `getKeys`.
   - Renderer thin wrappers: `showLock` / `updateLocks` / `clearLock` / `clearLocks` / `getLockCount` / `getLockKeys`.

4. **`main.js`** (extend). Per-frame `tickLocksPerFrame(dt)` + `tickGliderPerFrame(dt)`:
   - `tickLocksPerFrame`: drives the overlay + clears expired locks.
   - `tickGliderPerFrame`: advances the glider state + applies the delta to the player position.
   - On phase shift, `onPhaseChanged` calls `world.createLock(cell.x, cell.y, cell.z, phase, LOCK_DURATION)` for each non-air cell in `lockRegion`.
   - Module-level `gliderState = createGliderState()`.
   - New debug hooks for Phase 3.5.

5. **`src/save/system.js`** — no change. The lock round-trip uses `World.exportLocks` / `World.importLocks` directly.

6. **`tests/headless/test-phase35.cjs`** (new) — 95 checks (≈28 static + ≈40 pure-module + ≈27 World API).
7. **`tests/headless/smoke.cjs`** — add Phase 3.5 static-analysis block (45 keys).
8. **`tests/gameplay.spec.js`** — 1 new Phase 3.5 test (Phase Lock + Phase Glider).

## Files to touch

- `src/phase/lock.js` (new).
- `src/core/world.js` (Phase Lock API + isBlockSolid update).
- `src/render/renderer.js` (LockOverlay class + thin wrappers).
- `main.js` (per-frame `tickLocksPerFrame` + `tickGliderPerFrame` + onPhaseChanged hook + debug hooks).
- `tests/headless/test-phase35.cjs` (new).
- `tests/headless/smoke.cjs` (Phase 3.5 static-analysis block + process-exit gate).
- `tests/gameplay.spec.js` (1 new Phase 3.5 Playwright test).
- `HANDOFF.md` (Phase 3.5 closure).
- `PROJECT_REMEDIATION_PLAN.md` (Phase 3.5 row ✅ Done).
- `PHASE_3_6_BRIEF.md` (Tutorial Zone — safe ring at spawn with Stone/Obsidian/Echo/Stabilizer + HUD hints; to be created at the start of the next session).

## How to verify

```bash
node --check main.js
node --check src/phase/lock.js
node --check src/render/renderer.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
... all earlier phase tests still pass ...
node tests/headless/test-phase34.cjs   # 63/63 still pass
node tests/headless/test-phase35.cjs   # 95/95 new — Phase 3.5
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

## Common pitfalls

- **The lock key includes the phase.** `"x,y,z,phase"` so the same cell can be locked in 2 different phases simultaneously. The `isBlockSolid` check matches both `x/y/z/phase`.
- **The lock overrides `phaseSolid` for collision.** E.g. an Obsidian block in Alpha (only solid in Gamma) becomes solid in Beta when locked. The `isBlockSolid` check returns `true` for any locked cell.
- **The save round-trip pushes past expires forward.** If a lock's `expires` is in the past after save/load, `importLocks` resets it to `now + duration` so the saved locks are usable after reload. This avoids the "save with locks, reload, all locks expired" bug.
- **The Phase Glider is dt-based.** `tickGlider` clamps `dt` to 0.1 (100ms max) per call; the glider accumulates over multiple ticks. The `done: true` signal fires on the first tick that pushes the timer past the duration; subsequent ticks are on a non-gliding state and return `done: false`.
- **The lock overlay pulses in the last 3 seconds.** The pulse is `0.2 + 0.3 * Math.abs(Math.sin((3 - remaining) * Math.PI * 1.5))` — a sine wave that oscillates between 0.2 and 0.5. The fillMat opacity is 50% of the edgeMat opacity.
- **The orphan `PhaseLockManager` is NOT imported by main.js.** The active path uses the new `src/phase/lock.js` + `World` + `Renderer` + `main.js` wiring. The orphan is still quarantined at `src/core/phaseLockManager.js` (banner at the top).
- **The lock creation in `onPhaseChanged` is best-effort.** If a cell's chunk isn't loaded, the `getBlock` throws or returns null; the loop ignores those cells. The lock count is approximate (the brief says "around the player", not "exactly N blocks").

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 3.4 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 3.4 row ✅ Done; Phase 3.5 row ✅ Done when it ships.
- `PHASE_3_6_BRIEF.md` (Tutorial Zone — safe ring at spawn with Stone/Obsidian/Echo/Stabilizer + HUD hints) will be created at the start of the next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
git add -A
git commit -m "Phase 3.5: phase lock + phase glider — port PhaseLockManager + brief fly in Beta"
TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```
