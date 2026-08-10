# Phase Shifter — Remediation Plan

> Goal: take the current 3D voxel prototype from "two parallel engines, init throws on load, camera doesn't follow the player" to a playable, stable, and enjoyable game that honors `GAME_SPEC.md`.

This plan is sequenced. Each phase has explicit acceptance criteria and a "definition of done". Stop and re-evaluate at any phase boundary if the criteria aren't met.

---

## Progress

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 — Architectural decision | ✅ Done | `ebfcd07` | Single-engine decision enforced. Orphans quarantined with deprecation banners. See `HANDOFF.md`. |
| 1.1 — Fix init crash | ✅ Done | `8907b61` | Added missing DOM (`#btn-inv`, `#btn-opts`, `#inv-close`, `#inventory-panel`, `#crafting-panel`). Guarded all `addEventListener` calls. Removed `throw e` from init try/catch. `setupMenuButtons()` is now the last call in `init()`. Headless test infra at `tests/headless/` (`smoke.cjs` + `safeOn` unit test) verifies DOM presence + init recovery. |
| 1.2 — Camera follow + movement direction | ✅ Done | `c4c9cd3` | Camera trails player with eye-height offset (`+EYE_HEIGHT=1.6`). Movement basis derived from `camera.quaternion` — old `Math.atan2(camera.position.x - pos.x, …)` formula removed; pitch no longer warps the horizontal basis. 13 unit tests (`test-camera-basis.cjs`) + 17 combined static+behavioral tests (`test-phase12.cjs`) passing. Smoke test extended with source-level static-analysis checks. |
| 1.3 — Safe spawn | ✅ Done | `31d0f48` | Player now spawns via downward raycast from y=CHUNK_HEIGHT-1 within a 3×3 chunk area at (0, 0), falling back to a 5×5 expansion and then to a hard-coded y=30. Added `World.findTopSolidBlock(worldX, worldZ, phase)` helper and extended `World.updateChunks(x, z, radius)` with an optional radius. Init logs `console.info('[Phase Shifter] Spawned at', pos.toArray())`. Headless test `tests/headless/test-phase13.cjs` covers 3 static-analysis checks + 4 behavioral checks (7/7). Smoke test `tests/headless/smoke.cjs` extended with the same Phase 1.3 static-analysis block. |
| 1.4 — Single index scheme | ✅ Done | Working tree | Added canonical `World.index()`, `World.localIndex()`, and `World.unpackIndex()` helpers; migrated world, renderer, scan, and resonance indexing call sites. Added `test-phase14.cjs` (21/21) and Phase 1.4 smoke checks. |
| 1.5 — Chunk lookup + mutation path | ✅ Done | Working tree | Added `World.getChunk(x, z)`, migrated active code to `chunk.cx`/`chunk.cz`, and routed block edits/raycast reads through the World API. Added `test-phase15.cjs` (12/12) and Phase 1.5 smoke checks. |
| 1.6 — SaveSystem API unification | ✅ Done | Working tree | Added `SaveSystem.saveGame/loadGame/getLastSaveInfo`, normalized load + `getLastSaveInfo`, and wired `init()` to restore saved position and phase. `main.js` no longer references `localStorage`/`JSON.stringify`/`JSON.parse`/`Date.now`. Tests: `test-phase16.cjs` 21/21, `smoke.cjs` Phase 1.6 checks green, Playwright suite 31/31. |
| 1.7 — Phase 1 closure (player block memory survives save/load) | ✅ Done | Working tree | `World.exportGlobalState()` / `importGlobalState()` and `SaveSystem.saveSnapshot(x, y, z, phase, worldState)` persist and re-apply player edits. `init()` re-applies the saved state via `world.importGlobalState(_savedState.worldState)`. `#save-info` is guarded. End-to-end Playwright spec `e2e-save-reload.spec.js` proves Pause→Save→reload→restore across page navigation. |
| 1.7 — Phase 1 closure (player block memory survives save/load) | ✅ Done | Working tree | `World.exportGlobalState()` / `importGlobalState()` and `SaveSystem.saveSnapshot(x, y, z, phase, worldState)` persist and re-apply player edits. `init()` re-applies the saved state via `world.importGlobalState(_savedState.worldState)`. `#save-info` is guarded. End-to-end Playwright spec `e2e-save-reload.spec.js` proves Pause→Save→reload→restore across page navigation. |
| 2.2 — Phase-relative collision | ✅ Done | Working tree | Added `World.isBlockSolid(x, y, z, phase)` as the single source of truth for "is this block solid here, now" — reads `BLOCK_PROPERTIES[id].phaseSolid[phase]` with a `.solid` fallback. `PhysicsManager._isBlockSolid` delegates; `World.findTopSolidBlock` delegates. No bare `props.solid` reads remain in `physics.js`. Renderer culling stays visibility-based (`data[ni] !== BLOCK_AIR`). `tests/headless/test-phase22.cjs` 35/35 + smoke.cjs 11 Phase 2.2 static checks; Playwright 33/33 still pass. |
| 2.3 — Per-phase place/break | ✅ Done | Working tree | Added `placeBlock(hit, blockId, context)` in `src/input/placeBlock.js` (testable, exportable). It rejects `no-hit`, `target-not-air`, `overlaps-player`, and `solid-in-player-cell` and writes via `world.setBlock(..., phase, ...)`. Wired RMB disambiguation in `main.js` contextmenu handler: face hit + non-air target + no overlap → place Stone; otherwise cycle phase (existing §2.1 behavior). `placeBlockAt` stays the unvalidated write primitive. `placeAnchor` is stubbed to defer §2.7 (no BLOCK_15 stray write). `spawnPlaceParticles` mirrors `spawnBreakParticles`. `__phaseShifter__.placeBlock(x, y, z, blockType)` debug hook. Breaks survive chunk unload + reload: `World.loadChunk` now applies `_globalStateMap` entries whenever the key exists (including BLOCK_AIR) — the §2.4 acceptance. `tests/headless/test-phase23.cjs` 50/50 + smoke.cjs 19 Phase 2.3 static checks. |
| 2.4 — Phase memory persistence | ✅ Done | Working tree | Extended the §2.4 acceptance to the save → reload round-trip. `World.exportGlobalState()` and `World.importGlobalState()` no longer filter `BLOCK_AIR` — a player break is a real edit and the snapshot is the canonical truth on load. `SaveSystem._coerceWorldState()` accepts `BLOCK_AIR` (id 0) but still rejects NaN / Infinity / fractional / negative / non-number ids. Trade-off: the save blob now records every player AIR edit, but `_globalStateMap` only contains touched cells so untouched generator terrain is not in the snapshot. `tests/headless/test-phase24.cjs` 46/46 (11 static + 35 behavioral incl. 3 §2.4 acceptance scenarios + save/reload round-trip + tampered-blob tests) + `smoke.cjs` 11 Phase 2.4 static checks + Playwright 1 new Phase 2.4 hard-reload test. Phase 1.6 `_coerceWorldState` behavioral test updated for the new contract; all earlier tests still green (1.2 17/17, 1.3 7/7, 1.4 22/22, 1.5 12/12, 1.6 21/21, 1.7 26/26, 2.1 26/26, 2.2 35/35, 2.3 50/50, 2.4 46/46). |
| 2.5 — Phase Lens (E) | ✅ Done | Working tree | Hold E shows colored wireframes around blocks that differ from the current phase + a beam from the camera. New pure module `src/scan/lens.js` with `scanResults`, `phaseLensDrain`, `lensRadius`, `belowDrainThreshold`, `wireframeColorForPhase`, `LENS_WIREFRAME_COLORS`. `World.findPhaseDifferences(px, py, pz, radius, currentPhase)` returns per-cell `{ currentPhaseBlock, otherPhases, mask }` (single-phase non-current blocks included — distinct from the §3.0-minimap `scanNearby`). `src/render/renderer.js` adds a `ScanOverlay` class (separate THREE.Group for wireframes + beam; beam parented to the camera so it tracks the crosshair direction each frame; old meshes disposed on clear). `main.js#performScan` refactored to delegate to `scanResults(...)` (no direct `chunk.alphaData` reads in the scan loop). Per-frame E loop drains energy at `PHASE_LENS_DRAIN_RATE * dt` (0.5/sec), shows colored wireframes per OTHER phase, shows a beam tinted by the current phase. Insufficient energy turns the lens off and emits a one-shot "Insufficient energy" notification. New constants `PHASE_LENS_DRAIN_RATE = 0.5` and `SCAN_RADIUS = 4`. New debug hooks `__phaseShifter__.forceScan()`, `.startPhaseLens()`, `.stopPhaseLens()`, `.getScanOverlayHighlightCount()`, `.getScanOverlayBeamVisible()`. `tests/headless/test-phase25.cjs` 70/70 (36 static + 34 behavioral) + `smoke.cjs` 22 Phase 2.5 static checks + 3 new Phase 2.5 Playwright tests. Phase 1.4 test updated to reflect the new contract (performScan no longer uses `world.index(...)` directly — it delegates to `world.findPhaseDifferences`). All earlier phase tests still pass: 1.2 17/17, 1.3 7/7, 1.4 22/22, 1.5 12/12, 1.6 21/21, 1.7 26/26, 2.1 26/26, 2.2 35/35, 2.3 50/50, 2.4 46/46, 2.5 70/70. |
| 2.7 — Phase Anchor (Shift+LMB) | ✅ Done | Working tree | Press Shift+LMB to place a yellow-glow outline on a block (the §2.7 plan acceptance: "10 seconds the outline disappears"). New pure module `src/anchor/anchor.js` with `placeAnchorAt`, `anchorLifetime`, `anchorFadeOpacity`, `anchorBorderOpacity`, `anchorKey`, `tickAnchors`, `isAnchorExpired`, `cellUnderPlayer`, `snapYForCell`, `playerAABBOverlapsAnchorCell`. New constants `ANCHOR_LIFETIME = 10`, `ANCHOR_FADE_WINDOW = 3`, `ANCHOR_FILL_COLOR = 0xffee88`, `ANCHOR_BORDER_COLOR = 0xffcc00`, `ANCHOR_COST = 0`. `World.createAnchor(x, y, z, phase)` is idempotent (re-pressing refreshes the lifetime); `World.removeAnchor`, `World.tickAnchors(dt)`, `World.findAnchorUnderPlayer(...)`, `World.isAnchorActive(x, y, z, phase)`, `World.exportAnchors()`, `World.importAnchors(snapshot)`, `World.clearAnchors()`. `src/render/renderer.js` adds an `AnchorOverlay` class (separate THREE.Group named "anchorOverlay" — independent of the Phase Lens overlay group, the Resonance pulse group, and the chunk-mesh group; per-anchor BoxGeometry 1.02 + EdgesGeometry + per-anchor fill/edge materials so the pulse-fade in the last 3s is per-anchor; auto-disposes on expiry). `main.js#placeAnchor` rewritten to delegate to `placeAnchorAt(...)` + `world.createAnchor(...)` + `renderer.showAnchor(...)` — no more BLOCK_15 stray write, no more "Anchor placement pending §2.7" stub notification. `onPhaseChanged` extended with snap-to-anchor: after a phase cycle, `findAnchorUnderPlayer` re-snaps the player Y to `anchor.y + 1 + PLAYER_HEIGHT` so the player stays on the block through the shift (the §2.7 contract). Per-frame game loop calls `tickAnchorsPerFrame(deltaTime)` which decrements `remaining` + forwards to `renderer.updateAnchors(snapshot, removedKeys)`. `src/save/system.js` extends `saveSnapshot` / `loadGame` with the anchor list; new `_coerceAnchors` rejects non-finite / out-of-range / negative entries so a tampered save cannot poison the world; legacy §1.7 / §2.4 save blobs (no `anchors` key) still load with an empty array. New debug hooks: `__phaseShifter__.forcePlaceAnchor(x, y, z)`, `.getAnchorCount()`, `.getAnchorMeshCount()`, `.getAnchorKeys()`, `.clearAnchors()`, `.isAnchorAt(x, y, z)`, `.tickAnchors(dt)`, `.findAnchorUnderPlayer()`. `tests/headless/test-phase27.cjs` 107/107 (54 static + 53 behavioral: pure module helpers, World API round-trips, placeAnchorAt against a real World, SaveSystem save/reload with anchors) + `smoke.cjs` 47 Phase 2.7 static-analysis checks + 1 new Phase 2.7 Playwright test. Phase 2.3 test updated (placeAnchor is now a real implementation, not a stub). All earlier phase tests still pass: 1.2 17/17, 1.3 7/7, 1.4 22/22, 1.5 12/12, 1.6 21/21, 1.7 26/26, 2.1 26/26, 2.2 35/35, 2.3 51/51, 2.4 46/46, 2.5 70/70, 2.6 71/71, 2.7 107/107. |
| 2.6 — Resonance (Q) | ✅ Done | Working tree | Press Q (one-shot) to swap phase presence on the blocks in a 3×3×3 area around the player. New pure module `src/resonance/resonate.js` with `resonateResults`, `resonateRadius`, `resonateCost`, `totalSwappedCount`, `resonanceSpherePulse` (the per-frame `{ radius, opacity, color }` shape: expand 0.2 → 1.0 over 0.25s, then opacity 1.0 → 0 over 0.75s, color = PHASE_COLORS[currentPhase]). `World.resonateWithReport(cx, cy, cz, radius, currentPhase)` returns `{ results: Array<{ x, y, z, swappedPhases: number[] }>, count: number }` (the legacy `World.resonate(...)` is preserved for back-compat). `src/render/renderer.js` adds a `ResonancePulse` class (separate THREE.Group for the sphere mesh — independent of the Phase Lens overlay group + the chunk-mesh group; pulse auto-disposes when the lifetime expires). Per-frame Q loop wires the sphere pulse via `renderer.updateResonancePulse(deltaTime)`. `src/audio/manager.js` extends `playResonance(phase = 0)` to take a phase argument (per-phase sweep + triad). `main.js#performResonance` refactored to delegate to `resonateResults(...)` (no direct `chunk.alphaData` reads in the resonance loop — the Phase 1.5 anti-pattern Phase 2.5 refactored out of `performScan` is now also gone from `performResonance`). Insufficient energy → one-shot "Insufficient energy" notification + early return. New constants `RESONANCE_RADIUS = 1` and `RESONANCE_PULSE_DURATION = 1.0`. New debug hooks `__phaseShifter__.forceResonate()`, `.getResonancePulseMeshCount()`, `.getResonancePulseVisible()`, `.clearResonancePulse()`. `tests/headless/test-phase26.cjs` 71/71 (41 static + 30 behavioral) + `smoke.cjs` 34 Phase 2.6 static checks + 1 new Phase 2.6 Playwright test. Phase 1.4 test updated to reflect the new contract (performResonance no longer uses `world.index(...)` directly — it delegates to `world.resonateWithReport`). The smoke test's `scans_use_world_index` check flipped from "at least 2 uses" to "exactly 0 uses". All earlier phase tests still pass: 1.2 17/17, 1.3 7/7, 1.4 22/22, 1.5 12/12, 1.6 21/21, 1.7 26/26, 2.1 26/26, 2.2 35/35, 2.3 50/50, 2.4 46/46, 2.5 70/70, 2.6 71/71. |
| 2.8 — Audio integration | ✅ Done | Working tree | Click blocker → chime on shift, crunch on break, soft click on place, bass pulse on resonance, vacuum sweep on collapse, footsteps every 0.4s while moving and grounded. New pure module `src/audio/footsteps.js` with `footstepInterval`, `shouldPlayFootstep`, `materialFromBlock`, `FOOTSTEP_MATERIALS` (the canonical four: stone/wood/crystal/void, with the "everything else → stone" collapse + `BLOCK_AIR → null` for empty cells). New constant `FOOTSTEP_INTERVAL = 0.4` (the plan's "every 0.4s"). `audioManager.init()` now fires on the blocker click (the user gesture) — not in the subsequent `pointerlockchange` listener (risk register row #12: doing it lazily after pointer lock means the first phase-shift audio is lost). `resume()` stays in the pointerlockchange listener for the suspended-context recovery path. Game loop per-frame footstep tick: `shouldPlayFootstep(footstepTimer, deltaTime, isMoving, isGrounded)` → `world.getBlock(floor(x), floor(y) - 1, floor(z), currentPhase)` → `materialFromBlock(...)` → `audioManager.playFootstep(material)` (the phase-and-block filter; the same module-level `footstepTimer` accumulator pattern as Phase 2.7's anchor lifetime). `audioManager.playBlockBreak()` is wired into `breakBlock()`; `audioManager.playBlockPlace()` is wired into `tryPlaceStoneOnFace()` and `__phaseShifter__.placeBlock()`. `audioManager.playCollapse()` is wired through a new `forcePhaseCollapse()` debug hook (the §2.8 deliverable is the audio call site; the §3.2 stabilizer/collapse state machine is a separate session). `onPhaseChanged` calls `stopAmbientMusic()` BEFORE `startAmbientMusic(phase)` (the §2.8 ordering contract). New debug hooks: `__phaseShifter__.forcePlayFootstep(material)`, `.tickFootsteps(dt, ctx)`, `.getFootstepTimer()`, `.forcePhaseCollapse()`; pass-through wrappers `playBlockBreakDebug`, `playBlockPlaceDebug`, `playShiftDebug(phase)`, `playResonanceDebug(phase)`, `playCollapseDebug`, `playFootstepDebug(material)`, `startAmbientMusicDebug(phase)`, `stopAmbientMusicDebug`. `tests/headless/test-phase28.cjs` 87/87 (53 static + 34 behavioral: pure module helpers, World API phase-and-block filter, accumulator chains across the float-precision boundary, AudioEngine stub no-op friendliness) + `smoke.cjs` 41 Phase 2.8 static-analysis checks + 1 new Phase 2.8 Playwright test. All earlier phase tests still pass: 1.2 17/17, 1.3 7/7, 1.4 22/22, 1.5 12/12, 1.6 21/21, 1.7 26/26, 2.1 26/26, 2.2 35/35, 2.3 51/51, 2.4 46/46, 2.5 70/70, 2.6 71/71, 2.7 107/107, 2.8 87/87. |
All earlier phase tests still pass: 1.2 17/17, 1.3 7/7, 1.4 22/22, 1.5 12/12, 1.6 21/21, 1.7 26/26, 2.1 26/26, 2.2 35/35, 2.3 51/51, 2.4 46/46, 2.5 70/70, 2.6 71/71, 2.7 107/107, 2.8 87/87, 3.1 95/95. |
| 3.2 — Stabilizers | ✅ Done | Working tree | Stabilizers are place-anywhere checkpoints (yellow-glow pulse on place). On phase collapse (or forced via `forcePhaseCollapseToStabilizer`), the player respawns on the nearest stabilizer at full energy. State machine: `place → active → collapse → teleport/respawn → clear`. `tests/headless/test-phase32.cjs`. See `PHASE_3_2_BRIEF.md`. |
| 3.3 — Echoes | ✅ Done | Working tree | Collectible lore fragments scattered across the world. Walking near an Echo collects it (lore toast + counter). 8 lore entries per Act. `tests/headless/test-phase33.cjs`. See `PHASE_3_3_BRIEF.md`. |
| 3.4 — Resonance Cores | ✅ Done | Working tree | Rare blocks in Crystal Caverns that reduce Resonance (Q) cost when standing near them. HUD shows active amplifier status. `tests/headless/test-phase34.cjs`. See `PHASE_3_4_BRIEF.md`. |
| 3.5 — Phase Lock + Phase Glider | ✅ Done | Working tree | Phase Lock: per-phase player lock so they can walk through walls in one phase and stand in another. Phase Glider: brief fly mode in Beta (energy cost). `tests/headless/test-phase35.cjs`. See `PHASE_3_5_BRIEF.md`. |
| 3 — World feel | ✅ Done | Phase 3 closure: `bbce4b8` (3.1–3.6 shipped). Phase 3.1-3.6 shipped. Phase 3 is complete. See `PHASE_3_6_BRIEF.md` for the Tutorial Zone closure. |
| 3.6 — Tutorial Zone | ✅ Done | Working tree | A new player can complete the tutorial without consulting the spec (the §3.6 acceptance). New pure module `src/tutorial/tutorial.js` with `TUTORIAL_RADIUS = 4`, `TUTORIAL_HINT_TEXTS` (8 entries: WASD, Q-shift, Break Stone, Place block, Shift through Obsidian+Void, Collect Echo, Place Stabilizer, Tutorial complete), `TUTORIAL_HINT_DURATION = 8`, `TUTORIAL_TOTAL_DURATION = 64`, `TUTORIAL_STONE_OFFSET / TUTORIAL_PHASE_ROW_OFFSET / TUTORIAL_ECHO_OFFSET / TUTORIAL_STABILIZER_OFFSET`, plus helpers `tutorialPositions(playerX, playerY, playerZ)` (returns `{stone, phaseRow (5 cells alternating Obsidian/Void), echo, stabilizer}`), `hintIndexFor(elapsed)`, `createTutorialState()`, `startTutorial(state, playerPos, now)`, `tickTutorial(state, dt, now)` (dt clamped to 0.1 — same pattern as §3.2 collapse / §2.7 anchor / §3.5 glider; returns `{state, done, hint, hintIndex}`), `clearTutorial(state)`, `getHint(elapsed)`, `isWithinTutorialRing(...)`, `TUTORIAL_DEFAULTS`. `src/ui/hud.js` extends constructor + adds `setTutorialHint(text, hintIndex)` (formats `[N] text` for the 1-based badge, sets `opacity: 1`, starts an 8s fade-out timer; DOM write only fires on text change) + `clearTutorialHint()` (empties text + fades out + clears timer). The constructor queries `#tutorial-hint` once into `this._tutorialHintEl` (defensive: `typeof document !== 'undefined'` + null element no-ops). `index.html` adds `#tutorial-hint` CSS (`position: absolute; bottom: 75px; left: 50%; transform: translateX(-50%); color: #ffee88; opacity: 0; transition: opacity 0.5s; text-shadow: 0 0 8px rgba(255,238,136,0.6); max-width: 70%; text-align: center; z-index: 51`) + `<div id="tutorial-hint"></div>` element. `main.js` adds module-level `let tutorialState = createTutorialState()`, `tickTutorialPerFrame(dt)` (reads `tutorialState.active`, advances via `tickTutorialPure(...)`, calls `hud.setTutorialHint` on advance, calls `hud.clearTutorialHint` + clears the state on `done`), and game-loop call `tickTutorialPerFrame(deltaTime)` after the existing per-frame ticks (echoes, resonance cores, locks, glider). Debug hooks: `forceGenerateTutorial()` (places the ring via `world.setBlock` + spawns the Echo via `world.spawnEcho` + starts the state machine), `tickTutorialPerFrame(dt)` (calls the function + returns state), `getTutorialHint()` (returns `{hint, hintIndex, elapsed}`), `getTutorialState()` (returns `{active, elapsed, currentHint, hintCount}`), `clearTutorial()` (clears state + clears HUD). The original `Date.now()` fallback in the time-source was reverted (the §1.6 "no Date.now" test caught it; the smoke test now passes again with the `performance.now()`-only path). `tests/headless/test-phase36.cjs` 59/59 (≈37 static + 22 behavioral: pure module helpers + World integration + main.js + hud.js + index.html static-analysis) + `smoke.cjs` 29 Phase 3.6 static-analysis keys + `phase36Ok` gate + ACCEPTANCE SUMMARY header update + 1 new Phase 3.6 Playwright test (forceGenerateTutorial + state activation + block placement + tick advancement + HUD wiring + clearTutorial reset). All earlier phase tests still pass. |
| 2 — Core mechanics | ✅ Done | 2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6 + 2.7 + 2.8 ✅ | All eight sub-phases of §2 shipped. Phase 3 (World feel — biomes, echoes, stabilizers, tutorial) is up next. See `PHASE_3_BRIEF.md` (to be written). |
| 4 — Polish | ✅ Done | `434846b` | Data-driven UX (HUD owns DOM) + Settings menu + data-driven minimap + full-state save + 30s autosave + code-splitting. See `PHASE_4_BRIEF.md`. |
| 5 — Enjoyable | ✅ Done | `57c6d68` | Goals (3 Acts) + HUD objective + compass + FOV breathing + reduced-motion accessibility. See `PHASE_5_BRIEF.md`. |
| 6 — Tests | ✅ Done | Working tree | Focused suite replaces the smoke "did the page load" checks. Live debug API (boot invariants + setPosition + cyclePhase + save/load round-trip) + pure-Node unit test (`test-phase6.cjs`, 15/15) + 35 static-analysis keys in `smoke.cjs` (`phase6Ok` gate). See `PHASE_6_BRIEF.md`. |
| 7 — Release prep | ✅ Done | Working tree | README rewrite (description, controls, architecture overview, build + test instructions) + `KNOWN_ISSUES.md` + GitHub Actions CI (`.github/workflows/ci.yml` runs `npm run build` + `npm test` on every PR). See `PHASE_7_BRIEF.md`. |
| 8 — Polish + community | ✅ Done | `6495145` + `1706a94` | Tutorial skip button (§8.1) + 5s post-collapse invuln window (§8.2) + audio context restart on tab-resume (§8.3) + Settings "Reset to defaults" button (§8.4) + compass distance indicator (§8.5) + tutorial hint re-trigger on ring re-enter (§8.6) + footstep volume scaling with block density (§8.7) + KNOWN_ISSUES cleanup (§8.8). Closes the post-1.0 polish arc. See `PHASE_8_BRIEF.md`. |

**Repo:** https://github.com/klampatech/phaseshift (public, `main`).
**Hand-off doc:** [`HANDOFF.md`](./HANDOFF.md).


---

## 0. Architectural Decision (before any code changes)

**The single biggest reason the project is in its current state is dual code paths.** Before fixing bugs, we must pick one engine. This decision is load-bearing for every subsequent phase.

**Decision: build on the existing `main.js` system, but lift the better pieces from the orphan `GameEngine` code.**

Reasoning:
- `main.js` already loads via `index.html` and is exercised by the test harness (`window.__phaseShifter__`).
- The orphan `GameEngine` (`src/core/game.js`, `src/core/player.js`, `src/core/phaseManager.js`, `src/core/phaseLockManager.js`, `src/core/particles/*`) has more complete features (Particles, Phase Lock, Resonance pulses, Echo collectibles, Phase Collapse). These get ported over time, not as a wholesale swap.
- Wholesale swapping to `GameEngine` would require rewriting the test harness, the save system, the HUD, and the input bindings, and is higher risk for the same amount of work.

**Required actions:**
- Delete `src/main.js` (it just stubs `new GameEngine()` and is unused).
- Mark `src/core/game.js`, `src/core/player.js`, `src/core/phaseManager.js`, `src/core/phaseLockManager.js`, `src/core/particles/*` as the **reference implementation** to port from. Don't import them yet; their bugs aren't fixed either.
- Adopt a single **`PhaseManager`** (`src/core/phase.js`) and a single **`PhysicsManager`** (`src/core/physics.js`). Anything new goes there.
- Define a single **indexing helper** `src/core/world.js#index(x, y, z)` and use it everywhere. No raw arithmetic in `main.js`.

After this decision, every phase below assumes there's a single source of truth.

---

## Phase 1 — Stop the bleeding (must complete before anything else)

**Objective:** make the page load, the canvas render, the player move, and the camera follow.

### 1.1 Fix the init crash
- Either add the missing `#btn-inv` / `#inv-close` / `#options-panel` / `#crafting-panel` DOM elements to `index.html`, or guard the `addEventListener` calls with `if (btn)`. Pick the first option; the menus are referenced by the spec.
- Remove the `throw e` from the global `try/catch` so a non-fatal init error doesn't kill the script. Log + recover.
- Move `setupMenuButtons()` to be the **last** call in `init()` so a failure there can't prevent event listeners from being attached.

**Acceptance:** page loads with no console errors. `window.__phaseShifter__` is set. `chunkCount === 29`. `phase === 0`.

### 1.2 Camera follow + movement direction
- After every physics tick, do `camera.position.copy(physicsManager.getPos())` and apply the mouse-look delta from `controls.yaw`/`controls.pitch` to the camera's Euler/quaternion.
- In the gameLoop, derive the movement basis from `camera.quaternion` (forward = `-z` transformed by the quaternion), not from `Math.atan2(camera.position.x - pos.x, ...)`.
- Add eye-height offset (`y += 1.6`) so the camera is at head height, not feet.

**Acceptance:** player moves with WASD, the camera trails, and walking direction matches where the player is looking.

### 1.3 Safe spawn
- Compute spawn by raycasting down from y=63 within the 3×3 chunk area around (0,0) until a solid block is found. Place the player one block above the highest solid block + 1.7 (player height).
- If that fails (no solid blocks), fall back to chunk-generation over a 5×5 area and try again.
- Add a `console.info('[Phase Shifter] Spawned at', pos.toArray())` log so it's easy to verify.

**Acceptance:** player spawns in open air on or near a solid surface, never inside a block.

### 1.4 Single index scheme
- Add `World.index(x, y, z)` and `World.localIndex(cx, cz, x, z)` helpers in `src/core/world.js`.
- Replace the raw formulas in `main.js` (`placeBlockAt`, `raycastBlock`) and `renderer.js` (`ChunkVisual` position extraction, `isSurrounded`) with calls to those helpers.
- Add a unit test that checks `index(x, y, z)` matches the round-trip through `unpackIndex(...)` for a few corner cases.

**Acceptance:** `setBlock` followed by `getBlock` returns the same value for every `(x, y, z)`. The existing `unit.spec.js` block count test still passes.

### 1.5 Add `World.getChunk(x, z)` and stop using `chunk.x`/`chunk.z`
- `getChunk(x, z)` does `Math.floor(x / CHUNK_SIZE)`, etc., and returns the chunk or `undefined`.
- Replace `chunk.x` / `chunk.z` reads with `chunk.cx` / `chunk.cz` everywhere.
- Replace any direct mutation of `chunk.alphaData[...]` (e.g. `placeBlockAt`) with `world.setBlock(x, y, z, phase, type)`, so the global state map and stabilizer tracking fire automatically.

**Acceptance:** clicking on a block toggles it; the change is visible in the next frame; the change persists across chunks.

### 1.6 Add `SaveSystem.saveGame(x, y, z, phase)` and `getLastSaveInfo()`
- `saveGame(x, y, z, phase)` builds the state object and calls `save(state)`.
- `getLastSaveInfo()` returns a human-readable timestamp from the most recent save (or `null`).
- Add a `loadGame()` that mirrors `saveGame`'s shape.
- Move all `JSON.stringify` / `Date.now` / `localStorage` glue into `SaveSystem` so `main.js` doesn't touch localStorage directly.

**Acceptance:** Pause → Save → Quit → page reload → Start → the save info line shows the saved timestamp. No string concatenation around `Date.now()` in `main.js`.

### 1.7 Outcome of Phase 1
After this phase, the player can:
- Spawn in open air.
- Move with WASD and look with the mouse.
- Walk around and the camera follows.
- Pause and resume.
- Save and reload.

**Phase 1.7 closure (working tree, 2026-08):** save/load now also persists player block edits (broken/placed blocks). Pause → Save → Quit → page reload → Start restores position, phase, and the world's player memory. New Playwright spec `tests/e2e-save-reload.spec.js` proves it.

None of the phase mechanics work yet — that's Phase 2.

---

## Phase 2 — Make the core mechanics work

**Objective:** phase shift, scan, resonance, place, break, save — all functional and visible.

### 2.1 Phase shift
- Right-click (`Pointer Lock` mode) cycles phases. The handler is on `mousedown`/`contextmenu` inside `Controls` and the gameLoop polls `state.phaseCycleRequested`.
- While `phaseManager.isShifting`, ignore further cycle requests (no spam).
- Display the phase name and color in the existing `#phase-name` div and `#phase-indicator` dot.
- Update the post-processing shader's `uPhase` uniform so the world tint visibly changes.
- Trigger `audioManager.playShift(phase)` on cycle completion.

**Acceptance:** right-click swaps Alpha → Beta → Gamma → Alpha. The shift takes ~1.5s with a visible color transition. The HUD shows the current phase name and color.

### 2.2 Phase-relative collision
- Physics already uses `props.phaseSolid[phase]`. Verify by reading `BLOCK_PROPERTIES` — confirmed for each block.
- Add a `BLOCK_PROPERTIES` lookup fallback for `phaseSolid` so the renderer and physics agree.

**Acceptance:** standing on a Stone block in Alpha, pressing Q to cycle to Beta, the player falls through (Stone is `phaseSolid: [true, true, false]`). Pressing Q again to Gamma, the player lands on the Stone block again (Gamma is solid... wait, no: `phaseSolid: [true, true, false]` means Stone is solid in Alpha and Beta only — verify it's actually walkable in Gamma, or fix the table).

### 2.3 Block place / break
- LMB = break the crosshair block (only if `BLOCK_PROPERTIES[block].phase.includes(currentPhase)`).
- RMB = place Stone on the adjacent face of the crosshair block.
- Resolution order: raycast → check existing block → write via `world.setBlock` → update chunk visual.
- Cap break distance at 6 blocks; show the `#block-hint` overlay with the block name + visible/solid state.

**Acceptance:** the player can dig a 1-blocks-deep hole in front of themselves and refill it. The change is persisted in `_globalStateMap` and survives a chunk reload.

### 2.4 Phase memory
- `World.setBlock(x, y, z, phase, id)` already writes to `_globalStateMap`. Verify `loadChunk` reads that map and applies it back, so unloading/reloading a chunk preserves player changes.
- (Phase 2.4) Extend the same contract to the save → reload round-trip: a player break is a real edit, so the export and import sides must preserve `BLOCK_AIR`. `SaveSystem._coerceWorldState` accepts `BLOCK_AIR` (id 0) but still rejects NaN / Infinity / fractional / negative / non-number ids.

**Acceptance:** break a block, walk far enough to unload the chunk, walk back — the block is still broken. Save → reload — the broken cell is still `BLOCK_AIR` (not the generator's resurrected value).

### 2.5 Scan (E)
- Hold E to highlight phase-different blocks in a 4-block radius. The `Renderer` (port from `src/core/game.js`) draws colored wireframes per phase.
- Energy cost: `0.5/sec` while held. PhaseLens drains energy too.
- Beam from the camera in the crosshair direction.

**Acceptance:** holding E in a dense Forest shows colored wireframes around blocks that differ from the current phase. The energy bar ticks down.

### 2.6 Resonance (Q)
- One-shot on Q press (not hold). Apply `world.resonate(x, y, z, radius=1)`.
- Visual: a phase-colored sphere pulse on the player (port from `ParticleManager.emitResonancePulse`).
- Cost: 15 energy. Refuse if insufficient.

**Acceptance:** pressing Q in a chunk with mixed phase blocks visibly swaps them. The audio plays the resonance chord. The energy bar drops by 15.

### 2.7 Phase Anchor (Shift+LMB)
- Requires a `lockManager` (port from `src/core/phaseLockManager.js`).
- Visual: a glowing yellow box outline around the block.
- The lock lasts 10 seconds, then expires.

**Acceptance:** Shift+LMB on a block shows a glowing outline. Standing on it through a phase shift keeps you on the block. After 10 seconds the outline disappears.

**Status:** ✅ Shipped (Phase 2.7 closure). See `PHASE_2_7_BRIEF.md` for the canonical starting brief and the implementation report.

### 2.8 Audio integration

**Status:** ✅ Shipped (Phase 2.8 closure). See `PHASE_2_8_BRIEF.md` for the canonical starting brief and the implementation report.
- `audioManager.init()` only when the user clicks the blocker.
- `startAmbientMusic(phase)` on phase change; `stopAmbientMusic()` before starting the new track.
- `playShift(phase)` on phase transition completion.
- `playBlockBreak()` / `playBlockPlace()` on break/place.
- Footstep throttling: every 0.4s while moving and grounded, with a phase-and-block filter for the original sample.
- `playCollapse()` on phase collapse.

**Acceptance:** moving across Stone in Alpha produces footstep clicks. Breaking a block plays the crunch. Shifting plays the chime. Resonance plays the bass pulse.

### 2.9 Outcome of Phase 2
After this phase, the player can:
- Walk around a real chunk.
- Cycle phases with visible color and audio feedback.
- Stand on a block, shift to another phase, fall through.
- Break, place, scan, resonate, anchor.
- Save and resume from the same state.

The game is now mechanically playable. It's not yet **enjoyable**, because there's no goal, no progression, and no reason to play.

---

## Phase 3 — Make the world feel like a world

**Objective:** biomes, echoes, stabilizers, resources, hazards, and a tutorial that teaches the mechanic.

### 3.1 Biomes
- 8 biome definitions exist in `terrain.js`. Surface them on the world map.
- Color the skybox / fog per biome.
- Display the current biome in `#biome-info` (read from `world.getBiome(playerPos.x, playerPos.z)`).
- Render Echo collectibles and Resonance Cores as floating/pulsing meshes (port from `Renderer._updateEchoVisuals` / `_updateCoreVisuals`).

**Acceptance:** walking from a Forest biome into a Crystal Cavern visibly changes the sky color and the floating object set.

### 3.2 Stabilizers
- Place a Stabilizer block spawns a checkpoint graphic.
- On Phase Collapse (energy depletes), the player teleports to the nearest Stabilizer with `MINIMUM_RESPAWN_ENERGY` (30) restored.
- If no Stabilizer, respawn at the original spawn point with the warning.

**Acceptance:** depleting energy in Beta teleports the player to a nearby Stabilizer with a "PHASE COLLAPSE" notification.

### 3.3 Echoes (collectibles)
- Echoes are placed in Ruins biomes (already in `terrain.js`).
- Walking within 2 blocks of an Echo collects it.
- Collected Echoes show up in the inventory panel with their lore string.
- An Echo counter in the HUD shows "X / Y".

**Acceptance:** entering a Ruins biome produces floating crystals. Walking close to one collects it and the inventory shows the lore.

### 3.4 Resonance Cores
- Cores are placed in Crystal Caverns (already in `terrain.js`).
- Each collected core unlocks one amplifier (AB / BG / AG).
- Amplifiers reduce the energy cost of phase shifts in their transition.

**Acceptance:** collecting a Resonance Core lights up the corresponding amplifier in the inventory. Costs of phase shifts in that transition decrease.

### 3.5 Phase Lock + Phase Glider
- Port the `PhaseLockManager` from the orphan code; wire it to phase-shift events.
- Keep the existing `tryPhaseStep` in `physics.js` but rename to "Phase Step" in the controls and add a clear visual cue (flash the player mesh, see the existing `Player._flashPhase`).

**Acceptance:** walking into a 1-block gap in Alpha and pressing Phase Step blink-keys Q to Beta and Pacman-style phases through the gap.

### 3.6 Tutorial zone
- Generate a small "tutorial ring" of safe-to-walk terrain at the spawn point. The ring contains:
  - 1 Stone block at chest height (teaches break/place).
  - 1 row of Obsidian and Void blocks (teaches phase-shifting).
  - 1 Echo (teaches collect).
  - 1 Stabilizer (teaches checkpoint).
- A HUD hint walks the player through the first 60 seconds.

**Acceptance:** a new player can complete the tutorial without consulting the spec.

### 3.7 Outcome of Phase 3
After this phase, the player has a reason to do anything other than press Q and walk. They've collected an Echo, found a Stabilizer, died from energy depletion, and unlocked an amplifier.

---

## Phase 4 — Make it feel good

**Objective:** eliminate jank, polish UX, and fix the architectural debt that bloats the build.

### 4.1 Data-driven UX
- Replace the hard-coded HTML in `index.html` with a small React-free templating system inside `HUD`. The HUD owns its DOM.
- All button IDs (`btn-resume`, `btn-save`, `btn-quit`, etc.) get registered via `addEventListener` only if the element exists.
- Pause menu is rendered by `HUD`, not a static HTML file.

**Acceptance:** modifying the menu does not require editing `index.html`. The HUD is unit-testable.

### 4.2 Settings
- Add a real Settings menu (resolution scale, render distance, mouse sensitivity, audio volume, keybindings).
- Settings persist in `localStorage` under a single key.
- Live-apply: changes take effect on the next frame.

**Acceptance:** changing render distance immediately affects how many chunks are loaded.

### 4.3 Minimap
- Read the actual world around the player (sample `world.getBlockMask` in a 32×32 area).
- Render per-phase overlays: Alpha in green, Beta in blue, Gamma in gold.
- Mark the player with a triangle pointing in the look direction.
- Mark Echoes and Stabilizers as small icons.

**Acceptance:** the minimap is recognizable as a top-down view of the world rather than a generic noise grid.

### 4.4 Save/load polish
- The save state should include:
  - Player position, velocity, look angles.
  - Current phase, energy, fatigue.
  - Unlocked amplifiers and collected echoes.
  - `_globalStateMap` (the player's memory of the world).
  - Erosion state.
- Periodic autosave (every 30s).
- "Save and quit" confirmed in the menu.

**Acceptance:** the player can save, quit, reload the page, and resume exactly where they left off, with all their progress intact.

### 4.5 Performance
- Use `InstancedMesh` per chunk per block type (or per phase per block type), as the spec calls for.
- Add frustum culling at the chunk level (don't update `ChunkVisual.updateMeshes` for off-screen chunks).
- Dispose old `BufferGeometry` and `Material` when a chunk is rebuilt.
- Cap draw distance to 3 chunks but allow up to 5 via Settings.
- Profile with the browser dev tools; the target is 60fps on integrated graphics.

**Acceptance:** `vite build` produces a chunk under 300 KB. The game holds 60fps in a 3-chunk render distance with a normal browser window.

### 4.6 Code-splitting
- Vite manualChunks: separate `three` into its own chunk, separate `audio` into its own.
- Code-split the boot screen, the play screen, and the post-processing setup.
- Lazy-load the heavier gameplay modules (Particles, Phase Lock Manager) only when first used.

**Acceptance:** initial JS load is under 200 KB gzipped.

### 4.7 Outcome of Phase 4
The game has menus, settings, a real minimap, a real save system, and a smaller bundle. It's now a product, not a prototype.

---

## Phase 5 — Make it enjoyable

**Objective:** give the player a reason to keep playing.

### 5.1 Goals and progression
- Three "Acts": Find the First Echo, Reach the Phase Nexus, Master All Phases.
- A persistent HUD objective ("Find the Stabilizer in the Ruins") shown above the crosshair.
- Compass direction to the nearest Echo / Stabilizer / Core.

**Acceptance:** the player feels directed without being hand-held.

### 5.2 Puzzles
- Multi-step phase puzzles: a block that becomes passable only after a Resonance Pulse in a different phase.
- Phase Lock races: timer-based puzzles where the player must stand on a platform long enough to lock it.
- Erosion puzzles: stand in a phase where Stone degrades to test timing.

**Acceptance:** there are at least 3 hand-designed puzzles in the world seed.

### 5.3 Audio polish
- Procedural ambient music per phase (already started in `AudioEngine`).
- Footstep audio with phase-specific material filters.
- Phase shift audio with pitch dependent on cycle direction (forward vs backward).
- Spatial audio for Echoes and Resonances.

**Acceptance:** the audio is distinguishable per phase and per action.

### 5.4 Visual polish
- Per-phase fog color (already partially done).
- Per-phase skybox tints.
- Particle effects on phase shift (use a stable `ParticleManager` — port and fix the compaction bug from the orphan).
- Chromatic aberration during shift animation.
- FOV breathing during shift (~75 → 80 → 75 over 1.5s).

**Acceptance:** Phase shifting feels like a transition, not a flag flip.

### 5.5 Accessibility
- Keybinding remapping.
- Color-blind-friendly phase indicators (icon + text, not just color).
- Optional HUD opacity slider.
- Reduced-motion mode (disable FOV breathing, disable chromatic aberration).

**Acceptance:** all menu controls can be reached from the keyboard alone.

---

## Phase 6 — Test it

**Objective:** keep the test suite useful and stop hiding regressions.

### 6.1 Replace the existing smoke tests
- The current `tests/*.spec.js` mostly checks "did the page load." Replace with a focused smoke suite that:
  - Boot the page.
  - Wait for `window.__phaseShifter__` to exist.
  - Assert `chunkCount === 29`.
  - Assert `phase === 0`.

### 6.2 Add a behavioral test
- Spawn the game, simulate a click on the blocker, send a `keydown` for `KeyW`, advance the game loop by 16ms via `requestAnimationFrame`, then assert the player position changed.
- Send a `click` for break and assert the block changed.

### 6.3 Add a unit test layer
- Use Node's `import.meta` to run `src/core/world.js`, `src/core/phase.js`, `src/core/physics.js` directly in tests.
- Test `World.index(x, y, z)` round-trip.
- Test phase-relative collision: stone is solid in Alpha and Beta, not in Gamma.
- Test `phaseManager.cyclePhase()` runs through ALPHA → BETA → GAMMA → ALPHA.

### 6.4 Add a behavior-driven gameplay test
- Spawn a known seed, take a screenshot of the world, save the buffer, simulate a few seconds of input, take another screenshot, assert they differ.
- This is brittle but catches renderer regressions.

### 6.5 Pre-PR checklist
- Run all tests.
- Run `vite build` and check bundle size.
- Visual spot-check in a real browser.

---

## Phase 7 — Release prep

**Objective:** ship to GitHub Pages or Netlify.

### 7.1 README
- Game description.
- Controls.
- Architecture overview (one paragraph).
- Build instructions.
- Test instructions.

### 7.2 Known issues
- Document any remaining TODOs in `KNOWN_ISSUES.md`.
- Be explicit about Android/iOS support (likely out of scope without further work).

### 7.3 CI
- GitHub Actions: run `npm run build` and `npm test` on every PR.

---

## Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| The orphan `GameEngine` code has its own bugs that get ported in | High | Re-evaluate each module as it's ported. Treat the orphan code as a reference, not authoritative. |
| Physics refactor breaks collision | High | Keep the existing AABB collision logic; add a unit test for `phaseSolid` per block. |
| Player progression state is lost on save/load | High | Add a save→load round-trip test that asserts every persisted field. |
| Bundle size regresses during polish | Medium | Set a budget; track on every build. |
| Vite version mismatch with Three.js examples imports | Medium | Pin Three.js r0.161 (or whatever the current LTS is) and verify the post-processing imports. |
| Memory leak in chunk meshes | High | Write a test that loads 100 chunks, unloads them, asserts `BufferGeometry` count returned to initial. |
| Init() throw becomes a hard crash under different DOM | Low | Smoke test that boots the page with various DOM mutations. |

---

## Definition of "done" for the whole project

1. The page loads with no console errors on `vite preview`.
2. The player can spawn, move, look, jump, break, place, and shift phases with visible feedback.
3. The player can save, quit, and resume the game with all progress intact.
4. The player has a tutorial zone, a goal, and a reason to explore.
5. `npm test` runs 100+ assertions and 0 failures.
6. `vite build` produces a bundle under 300 KB.
7. The game ships to a static host with no build-time environment variables.

---

## Appendix A — Mapping from review findings to plan phases

| Review finding | Phase |
|---|---|
| #1 init() throws | 1.1 |
| #2 camera doesn't follow | 1.2 |
| #3 movement direction ignores camera | 1.2 |
| #4 player spawns inside solid blocks | 1.3 |
| #5 world.getChunk missing | 1.5 |
| #6 index scheme mismatch | 1.4 |
| #7 chunk.x vs chunk.cx | 1.5 |
| #8 PHASE_PHASED inverted | 2.2 |
| #9 BLOCK_RESONANCE_CORE undefined | 3.4 |
| #10 globalBlockState dead | 0 (decision) |
| #11 applySavedState uses undefined playerPosition | 1.6 |
| #12 audio init ordering | 2.8 |
| #13 save/load API mismatch | 1.6 |
| #14 HUD reads wrong property | 4.1 |
| #15 setPhase doesn't notify | 1.1 |
| #16 shifting while holding Space | 2.1 |
| #17 isGrounded logic | 1.2 (after camera, fixed via raycast) |
| Renderer never disposes meshes | 4.5 |
| ParticleManager compaction bug | 5.4 (when ported) |
| Two parallel engines | 0 (architectural decision) |
| No entity/component model | 0+4 (architectural decision) |
| No tutorial | 3.6 |
| No progression | 3.4 |
| No goal | 5.1 |
| No InstancedMesh | 4.5 |
| Tests don't catch regressions | 6 |

---

## Appendix B — Suggested file layout after Phase 0

```
src/
  core/
    constants.js       (single source for enums and tuning)
    world.js           (chunks, indexing, getBlock/setBlock, save state)
    phase.js           (PhaseManager, single implementation)
    physics.js         (PhysicsManager, single implementation)
    player.js          (PlayerController, facades Controls + Physics)
    phaseLockManager.js (port from orphan, fix lifecycle)
    particles/
      manager.js       (port from orphan, fix compaction)
  render/
    renderer.js        (renderer class, post-processing, lighting)
    chunkVisual.js     (ChunkVisual, InstancedMesh)
  input/
    controls.js        (input + keybindings)
  ui/
    hud.js             (HUD class, builds its own DOM)
    menus.js           (pause / settings / inventory)
  audio/
    manager.js         (AudioEngine + AudioManager as alias)
  save/
    system.js          (SaveSystem, single API)
    settings.js        (Settings, single API)
  gen/
    terrain.js         (Noise + Biome-driven)
    noise.js           (SimplexNoise + FBM)
  game.js              (GameEngine, optional: only if needed)
  main.js              (boot script: load() then start())
index.html             (minimal shell, no UI markup)
main.js                (deletes; combine with src/main.js)
```

---

## Appendix C — Order of operations cheat sheet

1. **Day 1 morning:** Phase 0 (decided), Phase 1.1–1.2 (crash + camera).
2. **Day 1 afternoon:** Phase 1.3–1.5 (spawn + index + getChunk). Phase 1.6–1.7 (save/load + closure) followed.
3. **Day 2:** Phase 1.6 (save/load), Phase 2.1–2.4 (phase mechanics).
4. **Day 3:** Phase 2.5–2.8 (scan/resonance/anchor/audio).
5. **Day 4:** Phase 3 (biomes, echoes, stabilizers, tutorial).
6. **Day 5:** Phase 4 (data-driven HUD, settings, minimap, perf).
7. **Day 6:** Phase 5 (progression, puzzles, polish).
8. **Day 7:** Phase 6 (tests), Phase 7 (release).

If you have less time, the minimum viable product is Phases 0–2. If you have more, push into Phase 5 before polishing.
