# Phase 3.6 — Starting Brief

> **Session goal:** Implement Phase 3.6 — Tutorial Zone. Build a small "tutorial ring" of safe-to-walk terrain at the spawn point containing 1 Stone (break/place), 1 row of Obsidian + Void (phase-shifting), 1 Echo (collect), 1 Stabilizer (checkpoint). A HUD hint walks the player through the first 60 seconds.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §3.6.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 3.5 closure (`95ae8ca`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–3.5 shipped the core mechanics, the per-biome visual layer, audio cues, Phase Anchor, Phase Lens, Resonance pulse, Phase Collapse state machine, Echoes (collectible lore), Resonance Cores (Crystal Caverns amplifiers), Phase Lock + Phase Glider. The §3.6 plan ("Tutorial Zone") is the final piece of the Phase 3 "Make the world feel like a world" arc. The acceptance is:

> **Acceptance (from plan §3.6):** a new player can complete the tutorial without consulting the spec.

The codebase has substantial scaffolding already in place:

1. **`BLOCK_STONE = 1`**, **`BLOCK_OBSIDIAN = 4`**, **`BLOCK_VOID = 5`**, **`BLOCK_STABILIZER = 15`**, **`BLOCK_ECHO = 14`** in `src/core/constants.js` — all block type ids used in the tutorial ring.
2. **`World.setBlock(x, y, z, phase, blockId)`** — used to place the Stone + Obsidian + Void + Stabilizer blocks.
3. **`World.spawnEcho(x, y, z, key, biomeId)`** — used to place the Echo (Phase 3.3).
4. **`audioManager.playCollapse()`** + **`MINIMUM_RESPAWN_ENERGY = 30`** — for the Phase Collapse + Stabilizer flow (the §3.2 wiring).
5. **`physicsManager.getPos()`** — to anchor the tutorial ring to the player's current position.
6. **`hud.setLoreToast(text)`** + **`hud.setEchoCounter(collected, total)`** + **`hud.showNotification(text, color)`** — the §3.3 notification primitives.
7. **`phaseManager.getCurrentPhase()`** + **`phaseManager.energy`** + **`phaseManager.setEnergy(n)`** — the per-frame collapse precondition.

What's missing for §3.6:

- A pure helper module `src/tutorial/tutorial.js` that:
  - Owns the canonical constants: `TUTORIAL_RADIUS = 4`, `TUTORIAL_HINT_TEXTS` (8 entries), `TUTORIAL_HINT_DURATION = 8`, `TUTORIAL_TOTAL_DURATION = 64`, `TUTORIAL_STONE_OFFSET`, `TUTORIAL_PHASE_ROW_OFFSET`, `TUTORIAL_ECHO_OFFSET`, `TUTORIAL_STABILIZER_OFFSET`.
  - Computes the placement positions: `tutorialPositions(playerX, playerY, playerZ)` returns `{stone, phaseRow (5 cells, alternating Obsidian/Void), echo, stabilizer}`.
  - Owns the hint state machine: `createTutorialState()` / `startTutorial(state, playerPos, now)` / `tickTutorial(state, dt, now)` (dt clamped to 0.1, returns `{state, done, hint, hintIndex}`) / `clearTutorial(state)`.
  - Computes the hint index from elapsed time: `hintIndexFor(elapsed)`.
  - Reads the current hint text: `getHint(elapsed)`.
  - Checks ring membership: `isWithinTutorialRing(playerX, playerY, playerZ, ringCenterX, ringCenterY, ringCenterZ)`.
- A new HUD method on `src/ui/hud.js`:
  - `hud.setTutorialHint(text, hintIndex)` — query `#tutorial-hint` (the bottom-of-screen rotating hint banner).
  - `hud.clearTutorialHint()` — fade-out reset.
- A new `#tutorial-hint` element + CSS in `index.html` — the bottom-of-screen banner (positioned above `#phase-step-container` so the player sees the hint while playing).
- A per-frame `tickTutorialPerFrame(dt)` in `main.js`:
  - Reads `tutorialState.active`. If true, advances via `tickTutorialPure(...)`.
  - When `done`, clears the state + clears the HUD.
  - On hint advance, calls `hud.setTutorialHint(result.hint, result.hintIndex)`.
- New debug hooks: `__phaseShifter__.forceGenerateTutorial()` / `getTutorialHint()` / `getTutorialState()` / `tickTutorialPerFrame(dt)` / `clearTutorial()`.

## Acceptance (from plan §3.6)

1. **`forceGenerateTutorial()` places 4 kinds of objects at the spawn point.** 1 Stone at chest height (offset +2 X, +1 Y), 1 row of 5 blocks alternating Obsidian + Void (offset −2 X, +2 Z), 1 Echo (offset −2 X, −2 Z), 1 Stabilizer (offset +2 X, −2 Z).
2. **`forceGenerateTutorial()` starts the tutorial state machine.** `getTutorialState().active === true` immediately after the call.
3. **The first hint is shown immediately.** `getTutorialHint().hintIndex === 0` and `getTutorialHint().hint` is the WASD hint.
4. **`tickTutorialPerFrame(dt)` advances the hint index after 8 seconds.** Ticking with dt=0.1 for 90 ticks (=9s) advances from hintIndex=0 to hintIndex=1.
5. **After 64 seconds the tutorial completes.** `tickTutorialPerFrame` calls `clearTutorial`, `getTutorialState().active === false`, and `hud.clearTutorialHint` is called.
6. **`#tutorial-hint` DOM element exists in index.html** with the matching CSS rule.
7. **`hud.setTutorialHint(text, hintIndex)` updates the DOM** (the text appears in `#tutorial-hint`).
8. **`hud.clearTutorialHint()` empties the DOM** (the text is cleared).
9. **No regression locks.** Phase 3.2/3.3/3.4/3.5 wiring stays intact. The `Date.now` fallback that I added was reverted (the §1.6 "no Date.now" test caught it; the smoke test now passes again with the `performance.now()`-only path).

## Fix shape

1. **`src/tutorial/tutorial.js`** (new — pure module). Exports:
   - `TUTORIAL_RADIUS = 4` — the §3.6 ring radius (blocks).
   - `TUTORIAL_STONE_OFFSET = {x: 2, y: 1, z: 0}` — Stone at chest height.
   - `TUTORIAL_PHASE_ROW_OFFSET = {x: -2, y: 0, z: 2, count: 5}` — 5-cell E-W row.
   - `TUTORIAL_ECHO_OFFSET = {x: -2, y: 0, z: -2}` — Echo NW of the player.
   - `TUTORIAL_STABILIZER_OFFSET = {x: 2, y: 0, z: -2}` — Stabilizer NE of the player.
   - `TUTORIAL_HINT_TEXTS` (8 entries): WASD, Q-shift, Break Stone, Place block, Shift through Obsidian+Void, Collect Echo, Place Stabilizer, Tutorial complete.
   - `TUTORIAL_HINT_DURATION = 8` — seconds per hint.
   - `TUTORIAL_TOTAL_DURATION = TUTORIAL_HINT_TEXTS.length * TUTORIAL_HINT_DURATION = 64`.
   - `tutorialPositions(playerX, playerY, playerZ)` — returns `{stone, phaseRow, echo, stabilizer}`.
   - `hintIndexFor(elapsed)` — floor(elapsed / 8), clamped to `[0, 7]`.
   - `createTutorialState()` / `startTutorial(state, playerPos, now)` / `tickTutorial(state, dt, now)` / `clearTutorial(state)`.
   - `getHint(elapsed)` — `{hint, hintIndex}`.
   - `isWithinTutorialRing(playerX, playerY, playerZ, ringCenterX, ringCenterY, ringCenterZ)`.
   - `TUTORIAL_DEFAULTS` — frozen map of `{radius, hintDuration, totalDuration, hintCount}`.

2. **`src/ui/hud.js`** (extend). Add `setTutorialHint(text, hintIndex)` + `clearTutorialHint()` methods:
   - Constructor queries `#tutorial-hint` once into `this._tutorialHintEl`.
   - `setTutorialHint(text, hintIndex)` writes `[N] text` to the element (the `[N]` is `hintIndex + 1` so the player sees a 1-based badge), sets `opacity: 1`, and starts an 8s fade-out timer. The DOM write only fires when the text changes (cheap: one DOM write per hint advance).
   - `clearTutorialHint()` empties the text + fades out + clears the timer.
   - The methods are defensive: if `typeof document === 'undefined'` or the element doesn't exist, they're no-ops.

3. **`index.html`** (extend). Add `#tutorial-hint` CSS + element:
   - CSS: `position: absolute; bottom: 75px; left: 50%; transform: translateX(-50%); color: #ffee88; opacity: 0; transition: opacity 0.5s; text-shadow: 0 0 8px rgba(255,238,136,0.6); max-width: 70%; text-align: center;`. z-index 51 (above the phase-step bar so it doesn't get clipped).
   - Element: `<div id="tutorial-hint"></div>` placed in the HUD container.

4. **`main.js`** (extend). Wire the per-frame tutorial tick + debug hooks:
   - Import the helpers from `./src/tutorial/tutorial.js`.
   - Module-level `let tutorialState = createTutorialState()`.
   - `tickTutorialPerFrame(dt)` function: reads `tutorialState.active`, advances via `tickTutorialPure(...)`, calls `hud.setTutorialHint` on advance, calls `hud.clearTutorialHint` + clears the state on `done`.
   - Game loop calls `tickTutorialPerFrame(deltaTime)` after the existing per-frame ticks (echoes, resonance cores, locks, glider).
   - Debug hooks: `forceGenerateTutorial()` (places the ring + spawns the Echo + starts the state machine), `tickTutorialPerFrame(dt)` (calls the function + returns state), `getTutorialHint()` (returns `{hint, hintIndex, elapsed}`), `getTutorialState()` (returns `{active, elapsed, currentHint, hintCount}`), `clearTutorial()` (clears state + clears HUD).

5. **`tests/headless/test-phase36.cjs`** (new). Pure module + World integration + static-analysis tests:
   - Pure module: `TUTORIAL_RADIUS`, `TUTORIAL_HINT_TEXTS.length`, `tutorialPositions(...)`, `hintIndexFor(...)`, `createTutorialState()`, `startTutorial(...)`, `tickTutorial(...)` (loops 0.1 ticks to accumulate 8s/64s), `clearTutorial(...)`, `getHint(...)`, `isWithinTutorialRing(...)`, `TUTORIAL_DEFAULTS`.
   - World integration: `setBlock` for Stone, Obsidian, Void, Stabilizer; `getBlock` round-trip.
   - Static analysis: main.js has `forceGenerateTutorial`, `tickTutorialPerFrame`, `getTutorialHint`, `getTutorialState`, `clearTutorial` hooks; hud.js has `setTutorialHint`, `clearTutorialHint` methods; index.html has `#tutorial-hint` element + CSS.

6. **`tests/headless/smoke.cjs`** (extend). Add `phase36` static-analysis block (29 assertions): pure module exports (13), HUD methods (3), HTML element + CSS (2), main.js imports + state + tick + hooks + wiring (11).

7. **`tests/gameplay.spec.js`** (extend). Add a Phase 3.6 Playwright test that asserts: `forceGenerateTutorial()` returns `{ok, stone, echo, stabilizer, phaseRowCount:5}`, the blocks are placed in the world, the tutorial state is active, `tickTutorialPerFrame(0.1)` advances the hint index after enough ticks, the `#tutorial-hint` DOM element has text, and `clearTutorial` resets the state + clears the DOM.

## Outcome of Phase 3

After Phase 3.6, the player has a reason to do anything other than press Q and walk. They've collected an Echo, found a Stabilizer, died from energy depletion, unlocked an amplifier, locked a block in place, glided through a gap, and completed a guided tutorial that walks them through all of the above without consulting the spec.
