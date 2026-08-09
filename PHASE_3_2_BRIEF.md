# Phase 3.2 — Starting Brief

> **Session goal:** Implement Phase 3.2 — Stabilizers — turn the `BLOCK_STABILIZER` block into a working checkpoint system. Placing a Stabilizer spawns a checkpoint graphic; on Phase Collapse (energy depletes in a non-Alpha phase), the player teleports to the nearest Stabilizer with `MINIMUM_RESPAWN_ENERGY` (30) restored. If no Stabilizer exists, the player respawns at the original spawn point with a warning.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §3.2.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 3.1 closure (`3c68b70`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–3.1 shipped the core mechanics and the per-biome visual layer. The world now has biomes (the player sees the Forest/Crystal Cavern contrast), audio cues fire on break/place/collapse/resonance/shift/footstep, and Phase Lens / Resonance / Anchor give the player a reason to interact. But Phase Collapse — the energy-depletes-in-Beta sequence — is still a Phase 2.8 audio stub. The `forcePhaseCollapse()` debug hook sets `phaseManager.setEnergy(0)` and calls `audioManager.playCollapse()`, but the player doesn't actually respawn anywhere. There's no penalty for energy depletion, and there's no progression mechanic for finding Stabilizer blocks (which are placeable but inert).

The plan's §3.2 ("Stabilizers") is the first session-sized piece of the "Make the world feel like a world" arc. The acceptance math is:

> **Acceptance (from plan §3.2):** depleting energy in Beta teleports the player to a nearby Stabilizer with a "PHASE COLLAPSE" notification.

The codebase has substantial scaffolding already in place:

1. **`BLOCK_STABILIZER = 15`** in `src/core/constants.js` — the block type id. The block properties row says `color: [255, 102, 68]` (warm orange), `solid: true`, `phase: [PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA]`, `phaseSolid: [true, true, true]` (solid in all phases), `isResource: false`, `immovable: true`. The block is registered in `World.BLOCK_PROPERTIES` for terrain-gen + collision.
2. **`MINIMUM_RESPAWN_ENERGY = 30`** in `src/core/constants.js` — the energy floor on respawn. The player collapses, then wakes up at the nearest Stabilizer (or original spawn) with this much energy.
3. **`World.findNearestStabilizer(x, y, z, maxSearchRadius)`** in `src/core/world.js` — returns the nearest tracked stabilizer position within the search radius. Uses the `this._stabilizerPositions` map (set via `_trackStabilizer(x, y, z)` / `_untrackStabilizer(x, y, z)`, called from `setBlock` when the block transitions to/from `BLOCK_STABILIZER`).
4. **`audioManager.playCollapse()`** — wired by Phase 2.8. Already called by `__phaseShifter__.forcePhaseCollapse()`.
5. **The original spawn point** — captured in `physicsManager._spawnPoint` (a `THREE.Vector3` set when the player spawns). Used by the §3.2 fallback path (no Stabilizer within range → respawn at spawn).
6. **`physicsManager.setPos(x, y, z)`** — used by the Phase 2.7 snap-to-anchor and Phase 2.1 camera-follow code. The §3.2 work uses this to teleport the player to the Stabilizer position (with `y = stabilizer.y + 1 + PLAYER_HEIGHT` so the player is standing on top of the block — the same Y-snap pattern as the anchor snap in `onPhaseChanged`).
7. **`phaseManager.setEnergy(0)`** and `phaseManager.setEnergy(MINIMUM_RESPAWN_ENERGY)` — already exposed. The collapse path sets energy to 0 (the precondition); the respawn path sets energy to `MINIMUM_RESPAWN_ENERGY` after the teleport.

What's missing for §3.2:

- A pure helper module `src/world/stabilizer.js` that:
  - Computes the respawn target position (Stabilizer or fallback) given the player's current position + the world's stabilizer list.
  - Returns the canonical `STABILIZER_RADIUS` search radius (the §3.2 brief's tuning constant — 16 blocks feels right; the Stabilizer must be within `STABILIZER_RADIUS` of the player or the fallback path fires).
  - Exports the canonical `STABILIZER_PLACE_COST` (0 — the plan says Stabilizers are free to place).
  - Returns the checkpoint graphic metadata (the wireframe color + the radius + the lifetime) so the renderer can draw the checkpoint overlay.
- A new pure module `src/collapse/collapse.js` that:
  - Owns the Phase Collapse state machine: `collapseReason` (`'energy-depleted'` / `'forced'` / `'test'`), `isCollapsing` (boolean), `collapseTimer` (the dt-based accumulator for the collapse animation).
  - Drives the per-frame collapse tick: while `isCollapsing` is true, increment the timer, suppress input (the player can't move or shift during the collapse), then on `collapseTimer >= COLLAPSE_DURATION` (1.5s, the §3.2 brief's "vacuum sweep" duration matching the audio length), call the respawn helper.
  - The respawn helper either teleports to the nearest Stabilizer or falls back to the original spawn + emits a "No Stabilizer nearby" warning.
- A new checkpoint overlay (similar pattern to the Phase Anchor overlay from §2.7):
  - A `CheckpointOverlay` class in `src/render/checkpoint.js` (or inline in `src/render/renderer.js`).
  - Yellow-glow ring + crosshair above each Stabilizer position.
  - `showCheckpoint(x, y, z)` / `updateCheckpoints(dt)` / `clearCheckpoints()` API on the `Renderer` class.
- A per-frame collapse tick in `main.js`:
  - Reads the `collapseState.isCollapsing` flag each frame.
  - If collapsing, suppress input + advance the timer + drive the collapse overlay (a vignette / screen tint / "PHASE COLLAPSE" banner — the §3.2 brief's notification).
  - On completion, teleport the player via `physicsManager.setPos(...)` and restore energy to `MINIMUM_RESPAWN_ENERGY`.
- A new debug hook `__phaseShifter__.forcePhaseCollapseToStabilizer(x, y, z)` (force-collapse with a pre-pinned target, so the Playwright test can verify the teleport without depending on the world.findNearestStabilizer search).
- A new debug hook `__phaseShifter__.getCollapseState()` (returns `{ isCollapsing, collapseTimer, collapseDuration, reason }` for the test).
- The §3.2 acceptance math: when `phaseManager.energy === 0` in Beta (either via the per-frame drain or via `forcePhaseCollapse`), the player teleports to the nearest Stabilizer within `STABILIZER_RADIUS` blocks. If no Stabilizer is in range, the player teleports to the original spawn point with `MINIMUM_RESPAWN_ENERGY` and a "No Stabilizer nearby" notification fires.

## Acceptance (from plan §3.2)

1. **Placing a Stabilizer spawns a checkpoint graphic.** The wireframe ring + the crosshair above the block. The graphic persists until the Stabilizer is broken (or the chunk unloads). Mirrors the Phase 2.7 anchor overlay lifetime / persistence pattern.
2. **Phase Collapse teleports to the nearest Stabilizer.** When `phaseManager.energy === 0` in a non-Alpha phase (the Phase 2.8 collapse precondition), the player teleports to the nearest Stabilizer within `STABILIZER_RADIUS` blocks. The player Y is `stabilizer.y + 1 + PLAYER_HEIGHT` (standing on top of the block, the §3.2 contract).
3. **`MINIMUM_RESPAWN_ENERGY` is restored.** After the teleport, `phaseManager.setEnergy(MINIMUM_RESPAWN_ENERGY)` fires (30 by default). The player can collapse-shift-collapse immediately to verify the cycle works.
4. **Fallback respawn at the original spawn.** If no Stabilizer is within `STABILIZER_RADIUS` blocks, the player respawns at `physicsManager._spawnPoint` (or the world spawn coords) with `MINIMUM_RESPAWN_ENERGY` and a "No Stabilizer nearby" warning notification fires.
5. **The collapse animation is ~1.5s.** The Phase 2.8 `playCollapse()` audio is the "vacuum sweep"; the §3.2 visual matches the audio length. During the 1.5s, input is suppressed (the player can't move or shift). After the 1.5s, the teleport + energy restore fires.
6. **A "PHASE COLLAPSE" notification fires.** Mirrors the §2.7 "ANCHOR PLACED" / §2.8 "Insufficient energy" notification pattern. Uses the existing notification helper (the `notify(...)` function the §1.x notification system already exposes).
7. **The collapse is a debug hook.** `__phaseShifter__.forcePhaseCollapse()` (already present from §2.8) — the §3.2 work extends this so the audio + teleport + respawn all fire on the hook call. The Playwright test asserts the post-collapse state.
8. **The collapse is dt-based, not Date.now-based.** Same accumulator pattern as §2.7's anchor lifetime + §2.8's footstep timer + §3.1's biome transition tween. The `collapseTimer` is a module-level `let` (the game loop owns it). Defensive: `dt` is clamped to 0.05s.
9. **No regression locks.** Phase 2.8's `forcePhaseCollapse()` audio wiring stays intact (the collapse audio fires before the teleport — the §3.2 ordering). The §3.1 biome tick is unaffected (the teleport doesn't change the biome region; the player's new position is `stabilizer.x, ?, stabilizer.z`, and the next biome tick will read `world.getBiome(stabilizer.x, stabilizer.z)`).
10. **The save/restore persists Stabilizers.** `World.exportGlobalState()` + `World.importGlobalState()` already track `BLOCK_STABILIZER` blocks via the existing per-cell serialization (Phase 1.5 + 1.6 + 1.7 save chain). The `_stabilizerPositions` map is rebuilt on import (already done in the existing `importGlobalState` path). The §3.2 work verifies this round-trip.
11. **No placement cost.** Stabilizers are free (the §3.2 brief's "Place a Stabilizer" — the plan doesn't add an energy cost; the §2.7 anchor was also free, and Stabilizers are a similar utility block).

## Fix shape

1. **`src/world/stabilizer.js`** (new — pure module). Exports:
   - `STABILIZER_RADIUS = 16` — the §3.2 brief's search radius (the player can be 16 blocks away from a Stabilizer and still respawn to it).
   - `STABILIZER_PLACE_COST = 0` — the §3.2 brief's free-placement contract.
   - `STABILIZER_FALLBACK_COLOR = 0xff8844` — the checkpoint overlay tint (warm orange, matching `BLOCK_STABILIZER.color = [255, 102, 68]`).
   - `findRespawnTarget(playerPos, stabilizerList)` — returns `{ x, y, z, source: 'stabilizer' | 'spawn' }`. Defensive: empty / missing inputs fall back to spawn.
   - `isWithinRadius(playerPos, stabilizerPos, radius)` — helper for the search loop. `radius` defaults to `STABILIZER_RADIUS`.
   - `stabilizerKey(x, y, z)` — returns the canonical `"x,y,z"` key for the `_stabilizerPositions` map.

2. **`src/collapse/collapse.js`** (new — pure module). Exports:
   - `COLLAPSE_DURATION = 1.5` — the §3.2 brief's animation duration (matches `audioManager.playCollapse` length).
   - `COLLAPSE_VIGNETTE_COLOR = 0x440022` — the screen-tint color during the collapse (deep purple — matches the Crystal Cavern / Phase Nexus visual language).
   - `COLLAPSE_BANNER_TEXT = 'PHASE COLLAPSE'` — the notification string.
   - `FALLBACK_WARNING_TEXT = 'No Stabilizer nearby — respawn at spawn'` — the §3.2 fallback warning.
   - `createCollapseState()` — returns a fresh `{ isCollapsing: false, collapseTimer: 0, reason: null, targetPos: null, source: null }` (the game loop owns the singleton).
   - `startCollapse(state, reason, targetPos, source)` — sets `isCollapsing = true`, resets `collapseTimer = 0`, stores the target + source. Pure state mutation; no side effects.
   - `tickCollapse(state, dt)` — advances the timer, returns the new state + a `{ done: boolean, targetPos, source }` payload. When `collapseTimer >= COLLAPSE_DURATION`, `done: true` and the caller does the teleport + energy restore.
   - `clearCollapse(state)` — resets the state to `{ isCollapsing: false, collapseTimer: 0, reason: null, ... }`. Called after the teleport completes.

3. **`src/render/renderer.js`** (extend). Add a `CheckpointOverlay` class (separate THREE.Group named "checkpointOverlay" — independent of the Phase Anchor overlay, the Phase Lens overlay, the Resonance pulse group, and the chunk-mesh group). Per-Stabilizer:
   - A `RingGeometry(0.45, 0.6, 16)` at the block top (`stabilizer.y + 1.02`), rotated -π/2 on X so it lies flat.
   - A `Sprite` crosshair 1.2 blocks above the block.
   - The ring + sprite use `STABILIZER_FALLBACK_COLOR` (warm orange).
   - Methods: `showCheckpoint(x, y, z, key)` / `updateCheckpoints(snapshot)` / `clearCheckpoint(key)`.

4. **`main.js`** (extend). Per-frame collapse tick:
   - After the existing biome tick, check `collapseState.isCollapsing`. If true, call `tickCollapse(collapseState, deltaTime)`. When `done`, call `physicsManager.setPos(targetPos.x, targetPos.y, targetPos.z)` and `phaseManager.setEnergy(MINIMUM_RESPAWN_ENERGY)` and `clearCollapse(collapseState)`.
   - Drive the collapse overlay: `renderer.updateCollapseOverlay(collapseState.collapseTimer / COLLAPSE_DURATION)` (lerps the vignette opacity).
   - Drive the collapse banner: when `isCollapsing && wasNotCollapsingLastFrame`, call `notify(COLLAPSE_BANNER_TEXT)` (the §3.2 contract — the banner fires on the collapse edge, not every frame).
   - Suppress input during the collapse: a module-level `inputSuppressed` flag set by the collapse tick; the keyboard / mouse handlers no-op while `inputSuppressed`.

   Existing `forcePhaseCollapse()` extended: after the audio fires + energy set to 0, look up the respawn target via `findRespawnTarget(...)` and call `startCollapse(collapseState, 'forced', targetPos, source)`. The per-frame tick drives the rest.

5. **`src/ui/hud.js`** (extend). The existing `#phase-name` + `#phase-indicator` + `#biome-info` elements are unaffected. The §3.2 work adds nothing to the HUD; the "PHASE COLLAPSE" banner is a notification overlay (the §1.x notification system handles this).

6. **`index.html`** — no change. The notification overlay element is already there (the §1.x work added it).

7. **`tests/headless/test-phase32.cjs`** (new) — at least 30 checks (≥15 static-analysis + ≥15 behavioral):
   - Static: `src/world/stabilizer.js` exports `STABILIZER_RADIUS` / `STABILIZER_PLACE_COST` / `findRespawnTarget` / `isWithinRadius` / `stabilizerKey`; `src/collapse/collapse.js` exports `COLLAPSE_DURATION` / `createCollapseState` / `startCollapse` / `tickCollapse` / `clearCollapse`; main.js imports `findRespawnTarget` / `startCollapse` / `tickCollapse`; main.js#tickCollapsePerFrame is defined and called from the game loop; main.js#onEnergyDepleted or equivalent hook is wired to `startCollapse`; the renderer has a `CheckpointOverlay` class; the renderer forwards `showCheckpoint` / `updateCheckpoints` / `clearCheckpoint`; `forcePhaseCollapse` debug hook now also starts a collapse state machine.
   - Behavioral: `findRespawnTarget(player, [])` returns `{ source: 'spawn' }`; `findRespawnTarget(player, [stabilizerWithinRadius])` returns `{ source: 'stabilizer', ...stabilizerPos }`; `findRespawnTarget(player, [stabilizerBeyondRadius])` returns `{ source: 'spawn' }`; `isWithinRadius(...)` returns true for nearby / false for far; `tickCollapse(state, 0.75)` (half the 1.5s) returns `{ done: false }`; `tickCollapse(state, 2.0)` returns `{ done: true }`; `MINIMUM_RESPAWN_ENERGY` is exactly 30; `COLLAPSE_DURATION` is exactly 1.5; the world.findNearestStabilizer round-trip works (place a Stabilizer, search for it, find it; break the Stabilizer, search again, miss); the save/restore round-trip preserves the `_stabilizerPositions` map.

8. **`tests/headless/smoke.cjs`** — add a Phase 3.2 static-analysis block (≥15 checks). The process-exit gate now also requires Phase 3.2 to pass.

9. **`tests/gameplay.spec.js`** — 1 new Playwright test:
   - Place a Stabilizer at a known position (via `forcePlaceStabilizer` debug hook or `world.setBlock(x, y, z, BLOCK_STABILIZER, phase)`).
   - Call `forcePhaseCollapse()` in Beta.
   - Assert `physicsManager.getPos()` lands on top of the Stabilizer.
   - Assert `phaseManager.getEnergy() === MINIMUM_RESPAWN_ENERGY` (30).
   - Repeat the collapse with no Stabilizer in range — assert the player lands on `physicsManager._spawnPoint` and the "No Stabilizer nearby" warning notification fires.
   - Assert `getCollapseState()` returns `{ isCollapsing: false, ... }` after the collapse completes (the state machine clears).

## Files to touch

- `src/world/stabilizer.js` (new — pure module: STABILIZER_RADIUS, findRespawnTarget, isWithinRadius, stabilizerKey).
- `src/collapse/collapse.js` (new — pure module: COLLAPSE_DURATION, createCollapseState, startCollapse, tickCollapse, clearCollapse).
- `src/render/renderer.js` (add CheckpointOverlay class + showCheckpoint / updateCheckpoints / clearCheckpoint forwarding).
- `main.js` (per-frame collapse tick + input suppression + extended `forcePhaseCollapse` debug hook + new debug hooks `forcePlaceStabilizer`, `getCollapseState`, `getRespawnTarget`).
- `index.html` (no change — the notification overlay already exists).
- `tests/headless/test-phase32.cjs` (new — ≥30 checks).
- `tests/headless/smoke.cjs` (add Phase 3.2 static-analysis block + extend process-exit gate).
- `tests/gameplay.spec.js` (1 new Playwright test).
- `HANDOFF.md` (Phase 3.2 closure section; "What's next — Phase 3.3").
- `PROJECT_REMEDIATION_PLAN.md` (Phase 3.2 row ✅ Done; §3 row updated to "3.1 ✅ + 3.2 ✅").
- `PHASE_3_3_BRIEF.md` (to be created at the start of the next session — Echoes / collectibles).

## How to verify

```bash
node --check main.js
node --check src/world/stabilizer.js
node --check src/collapse/collapse.js
node --check src/render/renderer.js
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
node tests/headless/test-phase28.cjs   # 87/87 still pass
node tests/headless/test-phase31.cjs   # 95/95 still pass
node tests/headless/test-phase32.cjs   # new — Phase 3.2
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (place a Stabilizer → force-collapse in Beta → see the player teleport to the Stabilizer with energy restored → repeat with no Stabilizer in range → see the player respawn at spawn with the warning notification) is the user's responsibility. WebGL + the collapse overlay + the checkpoint overlay fail in the sandbox; the headless tests cover the math + API surface.

## Reference files

- `src/core/constants.js` — `BLOCK_STABILIZER = 15`, `MINIMUM_RESPAWN_ENERGY = 30`, `PHASE_ALPHA` / `PHASE_BETA` / `PHASE_GAMMA`.
- `src/core/world.js` — `findNearestStabilizer(x, y, z, maxSearchRadius)`, `_stabilizerPositions` map, `_trackStabilizer` / `_untrackStabilizer` (called from `setBlock`).
- `main.js` — the Phase 2.7 anchor snap in `onPhaseChanged` is the model for the §3.2 teleport (same `physicsManager.setPos` + Y-snap pattern).
- `src/anchor/anchor.js` (Phase 2.7) and `src/audio/footsteps.js` (Phase 2.8) and `src/world/biome.js` (Phase 3.1) — the pure-module pattern: each is shaped the same way (no Three.js, no globals, no scene access; pure getters + pure helpers; tested in isolation). `src/world/stabilizer.js` and `src/collapse/collapse.js` follow this pattern.
- `main.js#forcePhaseCollapse` (Phase 2.8) — the audio call site. The §3.2 work extends this so the audio + teleport + respawn all fire on the hook call.
- `physicsManager._spawnPoint` — the §3.2 fallback respawn position. Set when the player spawns.
- `HANDOFF.md` — Phase 3.1 closure section (the model for the §3.2 closure section).

## Common pitfalls

- **The collapse audio fires BEFORE the teleport.** The Phase 2.8 `audioManager.playCollapse()` is the "vacuum sweep"; the §3.2 visual matches the audio length. The collapse state machine starts after the audio fires; the teleport happens when the timer reaches `COLLAPSE_DURATION`. Reordering these would either fire the audio after the teleport (wrong — the audio is the "you're collapsing" cue, not the "you've respawned" cue) or skip the audio (wrong — Phase 2.8 regression).
- **The player Y is `stabilizer.y + 1 + PLAYER_HEIGHT`.** Standing on top of the block, not embedded in it. The Phase 2.7 anchor snap in `onPhaseChanged` uses the same pattern. If the Y is wrong, the player ends up inside the block and the per-frame collision step pushes them out (the §3.2 visual is "teleport onto the block", not "teleport into the block").
- **The Stabilizer search radius is `STABILIZER_RADIUS = 16` blocks.** Smaller than the §3.2 brief's "the entire region" — the player has to actually place a Stabilizer reasonably nearby to use it. Larger than `RESONANCE_RADIUS = 1` — the Stabilizer is a per-region utility, not a per-cell interaction. The constant is exported from `src/world/stabilizer.js` so the renderer + the test can both read it.
- **The collapse state machine is dt-based.** `collapseTimer += dt` (clamped to 0.05s). The state is a module-level singleton in main.js (`const collapseState = createCollapseState()`); the game loop owns it. Same accumulator pattern as §2.7's anchor lifetime + §2.8's footstep timer + §3.1's biome transition tween.
- **Input suppression is critical.** During the 1.5s collapse animation, the player can't move or shift. Without this, the player can shift phases mid-collapse, fire resonance mid-collapse, etc — and the state machine can't make guarantees about the post-collapse position. The §3.2 work adds an `inputSuppressed` flag that the keyboard + mouse handlers check.
- **The fallback warning is a one-shot notification.** When the player collapses with no Stabilizer in range, the "No Stabilizer nearby — respawn at spawn" notification fires ONCE on the collapse edge, not every frame. The HUD's existing `notify(...)` helper handles the edge detection.
- **The `_stabilizerPositions` map is rebuilt on import.** The Phase 1.5 + 1.6 + 1.7 save chain already round-trips per-cell block data. The §3.2 work verifies that on `importGlobalState`, the map is rebuilt (the existing code in `World.setBlock` already calls `_trackStabilizer` when the block id is `BLOCK_STABILIZER`, so a save → reload sequence rebuilds the map automatically). The test asserts the round-trip.
- **The collapse state machine must NOT interrupt the §3.1 biome tick.** The biome tick reads `world.getBiome(playerPos.x, playerPos.z)` per frame; if the player teleports mid-frame, the next biome tick will see the new biome. The §3.2 work ensures the teleport happens at the END of the collapse state machine (after the 1.5s timer), so the biome tick reads the OLD biome for the duration of the collapse animation (which is correct — the visual skybox should hold the OLD biome while the collapse vignette overlays it).
- **The collapse hook sets energy to 0 first, then starts the state machine.** The energy = 0 is the precondition for the collapse (Phase 2.8); the state machine is the §3.2 layer on top. If the energy is somehow restored before the state machine starts (e.g., the player picks up a phantom energy block mid-collapse), the collapse still completes — the §3.2 contract is "you collapsed, you respawn, deal with it".
- **The save snapshot must include the collapse state.** If the player collapses → saves → reloads, the save should be in a consistent state (the player at the Stabilizer with `MINIMUM_RESPAWN_ENERGY` restored). The §3.2 work ensures the collapse completes BEFORE the save fires (the save hook no-ops while `isCollapsing`).

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 3.1 closure (already in the working tree at start of phase).
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 3.1 is already ✅ Done. Phase 3.2 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- `PHASE_3_3_BRIEF.md` (Echoes — Ruins collectibles with lore strings + counter in HUD) will be created at the start of the next session. Phase 3.2 ships the `BLOCK_STABILIZER` block + the checkpoint graphic + the collapse state machine; §3.3 is the per-biome collectible layer on top of the §3.1 visual scaffold.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 3.2: stabilizers — checkpoint graphic + collapse state machine + teleport respawn"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

If the implementation needs a follow-up commit (e.g. a smoke-test tweak discovered after the first push), commit + push again with a `Phase 3.2 follow-up: …` message. After pushing, update `PROJECT_REMEDIATION_PLAN.md` (Phase 3.2 → ✅ Done, §3 row to "3.1 ✅ + 3.2 ✅"), update `HANDOFF.md` (Phase 3.2 closure, "What's next — Phase 3.3"), and create `PHASE_3_3_BRIEF.md` following the same template.
