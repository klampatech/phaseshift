# Phase Shifter — Remediation Plan

> Goal: take the current 3D voxel prototype from "two parallel engines, init throws on load, camera doesn't follow the player" to a playable, stable, and enjoyable game that honors `GAME_SPEC.md`.

This plan is sequenced. Each phase has explicit acceptance criteria and a "definition of done". Stop and re-evaluate at any phase boundary if the criteria aren't met.

---

## Progress

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 — Architectural decision | ✅ Done | `ebfcd07` | Single-engine decision enforced. Orphans quarantined with deprecation banners. See `HANDOFF.md`. |
| 1 — Stop the bleeding | ⏳ Next | — | Begin with 1.1 (init crash). |
| 2 — Core mechanics | Pending | — | |
| 3 — World feel | Pending | — | |
| 4 — Polish | Pending | — | |
| 5 — Enjoyable | Pending | — | |
| 6 — Tests | Pending | — | |
| 7 — Release prep | Pending | — | |

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

**Acceptance:** break a block, walk far enough to unload the chunk, walk back — the block is still broken.

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

### 2.8 Audio integration
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
2. **Day 1 afternoon:** Phase 1.3–1.5 (spawn + index + getChunk).
3. **Day 2:** Phase 1.6 (save/load), Phase 2.1–2.4 (phase mechanics).
4. **Day 3:** Phase 2.5–2.8 (scan/resonance/anchor/audio).
5. **Day 4:** Phase 3 (biomes, echoes, stabilizers, tutorial).
6. **Day 5:** Phase 4 (data-driven HUD, settings, minimap, perf).
7. **Day 6:** Phase 5 (progression, puzzles, polish).
8. **Day 7:** Phase 6 (tests), Phase 7 (release).

If you have less time, the minimum viable product is Phases 0–2. If you have more, push into Phase 5 before polishing.
