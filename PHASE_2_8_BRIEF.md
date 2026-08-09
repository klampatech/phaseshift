# Phase 2.8 — Starting Brief

> **Session goal:** Implement Phase 2.8 — Audio integration — ambient music on phase change, footsteps on phase-and-block-filtered ground, crunch on break, chime on shift, bass pulse on resonance, and `audioManager.init()` only when the user clicks the blocker. The plan's §2.8 acceptance: *moving across Stone in Alpha produces footstep clicks. Breaking a block plays the crunch. Shifting plays the chime. Resonance plays the bass pulse.*
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.8.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 2.7 closure (`dea10c4`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 2.1–2.7 shipped phase shift, phase-relative collision, per-phase place/break, save/reload memory, the Phase Lens, Resonance, and the Phase Anchor. The `src/audio/manager.js#AudioEngine` is mostly written — `playShift(phase)`, `playResonance(phase)`, `playBlockBreak()`, `playBlockPlace()`, `playCollapse()`, `playFootstep(material)`, `startAmbientMusic(phase)`, and `stopAmbientMusic()` all exist as WebAudio primitives. What's missing is the *wiring* — the per-frame call sites in `main.js` and the small pure helpers that make the footstep + interaction sounds obey the plan's spec:

- `audioManager.init()` is currently called inside the `pointerlockchange` handler that fires *after* the user has clicked the blocker. The plan is explicit: `init()` should fire *on the blocker click*, not later, so the AudioContext is up before pointer lock (and so the first user gesture is unambiguously the click). Risk register row #12 calls this out: *audio init ordering — the order of `init()` vs the click handler matters; doing it lazily after pointer lock means the first phase-shift audio is lost*.
- `playShift(phase)` is wired (the `onPhaseChanged` listener fires it on cycle completion), but the ambient music transition only calls `startAmbientMusic(phase)` *after* `stopAmbientMusic()`. The plan's wording — *"`stopAmbientMusic()` before starting the new track"* — is satisfied, but the helper isn't named in a reusable way; a regression test should pin the contract.
- `playBlockBreak()` / `playBlockPlace()` exist on the engine but have *no call sites* in `main.js`. `breakBlock()` and `tryPlaceStoneOnFace()` do the visual + world-state work; the audio cue is silent.
- The footstep loop is the biggest gap. `AudioEngine.footstepTimer` is declared but never decremented; `playFootstep(material)` exists with a material lowpass filter (stone / wood / crystal / void) but has no caller. The plan asks for a 0.4s throttle + a phase-and-block filter — the throttle accumulator, the "moving and grounded" gate, and the "block under feet → material name" lookup all need to be built.
- `playCollapse()` exists but is also uncalled. The active path doesn't currently model a "phase collapse" event at all (the orphan `GameEngine._handlePhaseCollapse` does — that's a §3.2 feature per the plan). §2.8 only needs the *audio call wired* on whatever the active path's energy-zero handler is, even if the event itself is a stub for now.

The §2.8 work is therefore mostly **wiring + a small pure module** — mirroring the Phase 2.5/2.6/2.7 pattern (a pure helper + world API + game-loop call site + renderer forwarding), with a one-line lazy `init()` fix on the blocker.

## Acceptance (from plan §2.8)

1. **`audioManager.init()` only when the user clicks the blocker.** The handler is the `blocker.addEventListener('click', ...)` listener in `main.js#init`. Today, `init()` is called inside the *subsequent* `pointerlockchange` listener that runs after the click — the §2.8 spec moves it to the click. `resume()` stays where it is (the AudioContext is suspended until the click anyway, so the existing call still works).
2. **`startAmbientMusic(phase)` on phase change; `stopAmbientMusic()` before the new track.** Already wired in `onPhaseChanged`. Verify with a static check that the new-track call site follows the stop-then-start ordering.
3. **`playShift(phase)` on phase transition completion.** Already wired in `onPhaseChanged` (the listener fires on cycle completion). Verify with a static check; the Phase 2.1 closure is the regression lock.
4. **`playBlockBreak()` on `breakBlock()`.** Wire the audio call into the existing `breakBlock` body in `main.js` — after `placeBlockAt(hit.blockX, hit.blockY, hit.blockZ, BLOCK_AIR)` and the `updateChunkVisuals()` call, before the notification. The method is already a no-op without an AudioContext, so the headless tests can call it without crashing.
5. **`playBlockPlace()` on the RMB placement path.** Wire into `tryPlaceStoneOnFace(hit)` (the §2.3 RMB-disambiguation helper) and `__phaseShifter__.placeBlock(x, y, z, blockType)` (the §2.3 debug hook). After `spawnPlaceParticles(...)` + `hud.showNotification(...)`.
6. **Footstep throttling: every 0.4s while moving and grounded, with a phase-and-block filter.** Pure helper in `src/audio/footsteps.js`:
   - `FOOTSTEP_INTERVAL = 0.4` (the plan's "every 0.4s").
   - `shouldPlayFootstep(footstepTimer, dt, isMoving, isGrounded)` — decrements the accumulator by `dt`, returns `{ play, remainingTimer }`. `play` is true exactly when the accumulator crosses zero and the player is moving + grounded.
   - `materialFromBlock(blockType, phase)` — maps `BLOCK_PROPERTIES[blockType]` to a material name (`stone` / `wood` / `crystal` / `void` / `air`). `air` means the cell below the player is empty — the function returns `null` in that case so the caller knows to skip the footstep.
   - The *phase-and-block filter*: a stone block in Alpha is solid (so the footstep fires), but in Gamma the same cell is passable (so the player's feet are above air, no footstep). The filter is `world.getBlock(cellX, cellY, cellZ, currentPhase) → materialFromBlock` — the world lookup is per-phase.
   - The game loop's per-frame tick: while `physicsManager.isGrounded` and the player is moving (`moveX !== 0 || moveZ !== 0`), call `shouldPlayFootstep(...)`; if it returns `play === true`, look up the block at `floor(playerX), floor(playerY) - 1, floor(playerZ)` in the current phase, map to material, and call `audioManager.playFootstep(material)`.
7. **`playCollapse()` on phase collapse.** Phase 2.8 doesn't build the §3.2 stabilizer/collapse state machine — that's its own session. The §2.8 deliverable is the *audio call site*: add a `forcePhaseCollapse()` debug hook on `__phaseShifter__` that simulates the event (energy → 0, `phaseManager.setEnergy(0)`, in any non-Alpha phase) and calls `audioManager.playCollapse()`. The Playwright test exercises the hook. The full respawn-to-stabilizer logic stays on the §3.2 backlog.
8. **Audio engine is forgiving.** The WebAudio primitives in `AudioEngine` already short-circuit on `!this.initialized` (the `init()` failure path). The §2.8 wiring uses the same guards — no `playShift(...)` etc. is called on a null engine. The `__phaseShifter__` debug hooks also guard with `audioManager && typeof audioManager.playX === 'function'`.
9. **`audioManager.startAmbientMusic(phase)` is the no-op default** when the engine isn't initialized. Same pattern as `playShift` / `playResonance` — the headless tests can exercise the audio engine against a stub and confirm the methods are callable.
10. **Footstep throttling is dt-based, not Date.now-based.** The orphan `GameEngine` uses `performance.now()` for footstep timing; the new code uses a per-frame `footstepTimer` accumulator (the same pattern as the §2.7 anchor lifetime). Defensive: `dt` is clamped to the same 0.05s cap the game loop uses.
11. **Regression locks.** No `chunk.alphaData` reads added in `main.js` (the §1.5 anti-pattern stays gone). No new direct chunk reads — the footstep material lookup goes through `world.getBlock(...)`. No changes to the save blob shape (the audio settings are runtime-only, persisted by §4.2 settings).
12. **Debug hooks.** New hooks on `__phaseShifter__`: `forcePlayFootstep(material)`, `tickFootsteps(dt, { isMoving, isGrounded, currentPhase })` (returns the per-tick result without playing sound — the test uses this to assert the throttle math), `getFootstepTimer()` (the current accumulator value), `forcePhaseCollapse()` (the §2.8 collapse stub). The pre-existing `playShift` / `playResonance` / `playBlockBreak` / `playBlockPlace` / `playCollapse` calls are also exposed as direct debug hooks (the engine method, not the wiring) so the Playwright test can verify they're callable.

## Fix shape

1. **`src/audio/footsteps.js`** (new) — pure module. Exports:
   - `footstepInterval()` — returns `FOOTSTEP_INTERVAL` (0.4 seconds; the plan's "every 0.4s"). Pure getter.
   - `shouldPlayFootstep(footstepTimer, dt, isMoving, isGrounded)` — decrements `footstepTimer` by `dt`, returns `{ play: boolean, remainingTimer: number }`. `play` is `true` when the accumulator reaches 0 (i.e. the next footstep is due) AND the player is moving + grounded. `remainingTimer` is the post-decrement value (0 when a footstep fired, the new countdown otherwise). Defensive: non-finite `dt` or `footstepTimer` is treated as 0.
   - `materialFromBlock(blockType, phase)` — maps a block id in the current phase to a material name. Reads `BLOCK_PROPERTIES[blockType]?.name` (lowercased) and looks up the audio material table. The mapping is:
     - `Stone` → `stone`, `Wood` → `wood`, `Crystal` → `crystal`, `Void` → `void`
     - everything else (Grass, Dirt, Sand, Obsidian, Iron, Gold Ore, Water, Energy, Stabilizer, Rune, Glass) → `stone` (the closest lowpass signature)
     - `BLOCK_AIR` (id 0) → `null` (no footstep — the cell below the player is empty)
   - `FOOTSTEP_MATERIALS` — the canonical material table (exposed for tests). The four original samples (stone / wood / crystal / void) are the only ones with distinct lowpass filters; everything else collapses to `stone`.
   - The phase-and-block filter: `materialFromBlock(world.getBlock(cellX, cellY, cellZ, currentPhase), currentPhase)` — the lookup is per-phase. In Alpha, Stone at `(0, 0, 0)` returns `stone`; in Gamma, the same cell is air (Stone is `phaseSolid: [true, true, false]` so the chunk-level rendering is the only data there, but `getBlock` returns `BLOCK_AIR` in phases where Stone is invisible, so `materialFromBlock` returns `null` → no footstep). This is the filter the plan calls out.

2. **`src/core/constants.js`** — add `FOOTSTEP_INTERVAL = 0.4` (seconds; the §2.8 "every 0.4s" spec).

3. **`main.js`**:
   - **Lazy `init()`**: move `audioManager.init(); audioManager.resume();` from the `pointerlockchange` listener to the `blocker.addEventListener('click', ...)` listener. Keep the `if (!gameRunning)` guard so a second click while already running doesn't double-init. The `pointerlockchange` listener still calls `audioManager.resume()` on the suspended-context path (defensive — some browsers suspend the context again on blur).
   - **Per-frame footstep tick**: in `gameLoop`, after the physics update, compute `isMoving = (moveX !== 0 || moveZ !== 0)`, `isGrounded = physicsManager.isGrounded`. Call `shouldPlayFootstep(footstepTimer, deltaTime, isMoving, isGrounded)`. If `play === true`, look up the block at `floor(pos.x), floor(pos.y) - 1, floor(pos.z)` in the current phase via `world.getBlock(...)`; if `materialFromBlock(...)` is non-null, call `audioManager.playFootstep(material)`. The `footstepTimer` accumulator is a module-level `let` (mirrors `resonancePulseActive` / `lens_insufficientNotifiedThisPress`).
   - **`playBlockBreak` / `playBlockPlace` call sites**:
     - In `breakBlock()`: after the `placeBlockAt(hit.blockX, hit.blockY, hit.blockZ, BLOCK_AIR)` + `updateChunkVisuals()` + `spawnBreakParticles(...)` block, add `audioManager && audioManager.playBlockBreak()`.
     - In `tryPlaceStoneOnFace(hit)`: after `spawnPlaceParticles(...)` + `hud.showNotification(...)`, add `audioManager && audioManager.playBlockPlace()`.
     - In `__phaseShifter__.placeBlock(x, y, z, blockType)`: after `spawnPlaceParticles(...)` + `hud.showNotification(...)`, add `audioManager && audioManager.playBlockPlace()` (so the debug hook matches the RMB path).
   - **Debug hooks**: add `forcePlayFootstep(material)`, `tickFootsteps(dt, ctx)`, `getFootstepTimer()`, `forcePhaseCollapse()`. The collapse hook: set `phaseManager.setEnergy(0)`, then `audioManager && audioManager.playCollapse()`. (No respawn-to-stabilizer logic — that's §3.2.)
   - **Verification hooks**: add `playBlockBreakDebug()`, `playBlockPlaceDebug()`, `playShiftDebug(phase)`, `playResonanceDebug(phase)`, `playCollapseDebug()`, `playFootstepDebug(material)`, `startAmbientMusicDebug(phase)`, `stopAmbientMusicDebug()` — thin wrappers around the engine methods, guarded for `audioManager` + `audioManager.initialized`. The Playwright test uses these to assert the audio API surface is reachable from the debug surface, since WebAudio fails in the sandbox and the engine returns early on `!this.initialized`.

4. **`src/audio/manager.js`** — minor:
   - Confirm `playFootstep(material)` accepts the five known material names (`stone`, `wood`, `crystal`, `void`) and falls back to `stone` on unknown input (defensive — `materialFromBlock` is a pure helper, but a buggy caller shouldn't crash the audio).
   - Confirm `playShift(phase)` already accepts the phase index (Phase 2.1) — no change needed.
   - No new methods; the §2.8 deliverable is wiring, not engine additions.

5. **`src/core/world.js`** — no API change. The footstep material lookup goes through the existing `world.getBlock(x, y, z, phase)` (the §1.4 single-index-scheme helper). The `phaseAndBlockFilter` is the per-phase read, not a new method.

## Files to touch

- `src/audio/footsteps.js` — new (pure module: `footstepInterval`, `shouldPlayFootstep`, `materialFromBlock`, `FOOTSTEP_MATERIALS`).
- `src/core/constants.js` — add `FOOTSTEP_INTERVAL = 0.4`.
- `main.js`:
  - lazy `init()` on the blocker click (move the existing call from `pointerlockchange` into the `blocker.addEventListener('click', ...)` listener; keep `resume()` in `pointerlockchange` for the suspended-context path).
  - per-frame footstep tick in `gameLoop` (accumulator + `shouldPlayFootstep` + `world.getBlock` + `materialFromBlock` + `audioManager.playFootstep`).
  - `playBlockBreak` in `breakBlock`, `playBlockPlace` in `tryPlaceStoneOnFace` and `__phaseShifter__.placeBlock`.
  - new debug hooks: `forcePlayFootstep`, `tickFootsteps`, `getFootstepTimer`, `forcePhaseCollapse`, plus thin `play*Debug` wrappers.
- `tests/headless/test-phase28.cjs` — new (≥30 checks: ~20 static-analysis + ~10 behavioral).
- `tests/headless/smoke.cjs` — add a Phase 2.8 static-analysis block (≥15 checks). Process-exit gate now also requires Phase 2.8 to pass.
- `tests/gameplay.spec.js` — 1 new Playwright test: `playBlockBreakDebug()`, `playBlockPlaceDebug()`, `playShiftDebug(0)`, `playResonanceDebug(0)`, `playCollapseDebug()`, `playFootstepDebug('stone')`, `startAmbientMusicDebug(0)`, `stopAmbientMusicDebug()` are all callable from the debug surface; the footstep throttle math (`tickFootsteps(0.5, { isMoving: true, isGrounded: true })` returns `{ play: true, remainingTimer: 0 }`, `tickFootsteps(0.2, ...)` returns `{ play: false, remainingTimer: 0.2 }`); `forcePhaseCollapse()` debits energy to 0 and is callable.
- `HANDOFF.md` — Phase 2.8 closure section; "What's next — Phase 3".
- `PROJECT_REMEDIATION_PLAN.md` — Phase 2.8 row ✅ Done; §2 row updated to "2.1 + … + 2.8 ✅".
- `PHASE_3_BRIEF.md` — to be created at the start of the next session (mirrors how the previous phases deferred the next brief).

## How to verify

```bash
node --check main.js
node --check src/audio/footsteps.js
node --check src/audio/manager.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
node tests/headless/test-phase13.cjs   # 7/7 still pass
node tests/headless/test-phase14.cjs   # 22/22 still pass
node tests/headless/test-phase15.cjs   # 12/12 still pass
node tests/headless/test-phase16.cjs   # 21/21 still pass
node tests/headless/test-phase17.cjs   # 26/26 still pass
node tests/headless/test-phase22.cjs   # 35/35 still pass
node tests/headless/test-phase23.cjs   # 51/51 still pass
node tests/headless/test-phase24.cjs   # 46/46 still pass
node tests/headless/test-phase25.cjs   # 70/70 still pass
node tests/headless/test-phase26.cjs   # 71/71 still pass
node tests/headless/test-phase27.cjs   # 107/107 still pass
node tests/headless/test-phase28.cjs   # new — Phase 2.8
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (click the blocker → audio context boots → walk across Stone → hear clicks → break a block → hear crunch → shift → hear chime → press Q → hear bass pulse → press collapse stub → hear vacuum sweep) is the user's responsibility. WebGL + AudioContext fail in the sandbox; the headless tests cover the math + API surface.

## Reference files

- `src/audio/manager.js` — `AudioEngine` class with `playShift(phase)`, `playResonance(phase)`, `playBlockBreak()`, `playBlockPlace()`, `playCollapse()`, `playFootstep(material)`, `startAmbientMusic(phase)`, `stopAmbientMusic()`, `init()`, `resume()`, `setVolume()`. All of the §2.8 deliverables are wiring + a pure helper; no engine additions are needed.
- `src/core/world.js` — `world.getBlock(x, y, z, phase)` (the §1.4 single-index helper) is the footstep material lookup. The phase-and-block filter is the per-phase read.
- `src/core/constants.js` — `PHASE_ALPHA`, `PHASE_BETA`, `PHASE_GAMMA`, `BLOCK_AIR`, `BLOCK_PROPERTIES` are already exported. Add `FOOTSTEP_INTERVAL = 0.4` to the constants block (next to `PHASE_LENS_DRAIN_RATE` / `RESONANCE_RADIUS` / `ANCHOR_LIFETIME` — the "tuning" cluster).
- `src/scan/lens.js` (Phase 2.5) and `src/resonance/resonate.js` (Phase 2.6) — the model for the pure-module pattern: `footsteps.js` is shaped the same way (no Three.js, no globals, no scene access; pure getters + pure helpers; tested in isolation).
- `main.js` — `performScan` (Phase 2.5) and `performResonance` (Phase 2.6) are the model for the per-frame wiring pattern. The footstep tick goes in `gameLoop` after the physics update; the audio call is a guarded `audioManager && audioManager.playX(...)`.
- `PHASE_2_7_BRIEF.md` — the previous brief. The §2.7 contract (no direct chunk reads, single source of truth, pure module, debug hooks, smoke test extension) extends naturally to §2.8.
- `HANDOFF.md` §Sandbox quirks — the git + smoke-test quirks are unchanged. `GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift` for git ops; `sudo -E -n -- node tests/headless/smoke.cjs` for the smoke test (sandbox screenshot dir is root-owned).

## Common pitfalls

- **Don't move `resume()` out of `pointerlockchange`.** Some browsers (Chromium, Firefox) suspend the AudioContext on tab visibility change; `resume()` on the next pointer lock is the recovery path. Only `init()` moves; `resume()` stays.
- **The footstep accumulator is a module-level `let`, not a property of `audioManager`.** Mirrors the `footstepTimer` field that already exists on the engine but is unused. The new code keeps the accumulator in `main.js` (the game loop owns it) so the engine stays scene-agnostic. The test can read the accumulator via the new `getFootstepTimer()` debug hook.
- **The `dt` for the footstep tick is the same `deltaTime` the game loop uses for physics.** The loop already clamps `deltaTime` to `0.05` (5 frames at 60fps) so a tab-switch pause doesn't dump the entire pause into the accumulator. The `shouldPlayFootstep` helper is also defensive — non-finite or negative `dt` is treated as 0.
- **The footstep cell is the block under the player's feet, in the current phase.** `floor(playerY) - 1` is the convention (same as `cellUnderPlayer` from §2.7). The block id in the current phase comes from `world.getBlock(...)`. The material name comes from `materialFromBlock(...)`. The lookup is per-phase — that's the §2.8 "phase-and-block filter".
- **The footstep audio is throttled, not gated on `playFootstep(material)` returning.** The engine method already plays a 0.05s burst; the throttle is at the call site (the accumulator). Don't add per-call throttling to the engine.
- **`playCollapse()` doesn't need a phase-collapse state machine.** The §2.8 deliverable is the audio call site; the respawn-to-stabilizer logic is §3.2. The `forcePhaseCollapse()` debug hook is a stub — it sets energy to 0, calls `audioManager.playCollapse()`, and that's it. The Playwright test asserts the call is reachable, not the respawn behavior.
- **`materialFromBlock(blockType, phase)` is called even when `world.getBlock(...)` returns `BLOCK_AIR`.** It explicitly returns `null` for air so the call site knows to skip the audio. Don't crash on `BLOCK_PROPERTIES[BLOCK_AIR]` — the test asserts `null` for air.
- **The `FOOTSTEP_MATERIALS` table is small (4 entries).** The orphan `AudioEngine.playFootstep(material)` has a `freqs[material] || 200` fallback — same as our table + a sensible default. The `materialFromBlock` helper handles the "everything else → stone" collapse so the engine fallback never fires in practice.
- **The new debug hooks don't return the audio engine's internal state.** The engine is a WebAudio wrapper; its internal state (oscillators, gain nodes) isn't testable without a real AudioContext. The `play*Debug` wrappers are pass-throughs that the Playwright test calls to confirm the wiring; the assertions are `typeof hook === 'function'` and `hook() === undefined` (no throw).
- **The `init()` call on the blocker click is guarded by `if (!gameRunning)`.** A second click while the game is already running (e.g. the user clicks the blocker again after a pause) must NOT re-init the engine — `AudioEngine.init()` already short-circuits on `this.initialized`, but the `gameRunning` guard prevents the AudioContext from being recreated (some browsers throw on a second `new AudioContext()`).
- **The `tickFootsteps(dt, ctx)` debug hook accepts an `isMoving` and `isGrounded` override.** The Playwright test can't drive a real player, so the test asserts the throttle math by calling the hook directly with synthetic state. The production `gameLoop` path uses the real `physicsManager.isGrounded` + `moveX/moveZ` non-zero check.
- **The `playFootstep(material)` engine call is a no-op when `!this.initialized`.** The Playwright sandbox doesn't have WebAudio, so `audioManager.initialized` is `false` after the `init()` try-catch. The debug hooks are still callable; the test asserts the API surface, not the audible output. The user's real browser is where the audio actually plays.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.7 closure (already in the working tree at start of phase).
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 2.7 is already ✅ Done. Phase 2.8 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- `PHASE_3_BRIEF.md` (Make the world feel like a world — biomes, echoes, stabilizers, tutorial, per `PROJECT_REMEDIATION_PLAN.md` §3) will be created at the start of the next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.8: audio integration — lazy init on blocker click + footstep throttle + break/place/collapse audio"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

If the implementation needs a follow-up commit (e.g. a smoke-test tweak discovered after the first push), commit + push again with a `Phase 2.8 follow-up: …` message. After pushing, update `PROJECT_REMEDIATION_PLAN.md` (Phase 2.8 → ✅ Done, §2 row to "2.1 + … + 2.8 ✅"), update `HANDOFF.md` (Phase 2.8 closure, "What's next — Phase 3"), and create `PHASE_3_BRIEF.md` following the same template.
