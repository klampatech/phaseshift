# Phase 6 — Starting Brief

> **Session goal:** Implement Phase 6 — Test it. §6.1 boot smoke + §6.2 behavioral (WASD/break) + §6.3 unit layer (World.index round-trip, phase-relative collision, cyclePhase) + §6.4 BDD screenshot/seed determinism.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §6.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 5 closure (`57c6d68`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–5 shipped the core mechanics, the per-biome visual layer, audio cues, Phase Anchor / Lens / Resonance / Collapse / Stabilizers / Echoes / Resonance Cores / Phase Lock / Glider / Tutorial, the Settings menu, the data-driven minimap, the full-state save system, code-splitting, and the 3-Act progression system. But §6 of the plan ("Test it") is the first session-sized piece of the "stop hiding regressions" arc. The acceptance is:

> **Acceptance (from plan §6):** the test suite catches regressions and the developer can run it locally.

The existing `tests/gameplay.spec.js` covers ~95 Playwright assertions, but the only headless guard is `tests/headless/smoke.cjs`, which exercises the production build via Playwright and checks structural DOM + a handful of regex-based static-analysis keys. The §6 work replaces the "did the page load" smoke with a focused suite that exercises the live debug API:

1. **`window.__phaseShifter__`** — already exposes the live game state (chunkCount, phase, world, phaseManager, physicsManager, forceCyclePhase, etc.). Phase 6.1 reads these directly via `page.evaluate`.
2. **`tests/headless/test-phase6.cjs`** — the new unit test file. Uses Node's `import()` to load `src/core/world.js`, `src/core/phase.js`, `src/core/physics.js`, `src/core/constants.js` directly. Tests the §6.3 unit layer (no Playwright needed).
3. **`tests/gameplay.spec.js`** — extends with a Phase 6 Playwright test that uses the live debug API (boot invariants + WASD via `setPosition` + block break + cyclePhase + save/load round-trip).

What's missing for §6:

- A pure unit test file `tests/headless/test-phase6.cjs` that:
  - Boots a `World` directly via `new World(() => {})` + `updateChunks(0, 0, 3)` and asserts ≥ 29 chunks (§6.1).
  - Asserts `World.index(x, y, z)` round-trips with `World.unpackIndex(i)` for a representative set of (x, y, z) triples (§6.3).
  - Asserts phase-relative collision (`World.isBlockSolid(x, y, z, phase)` returns true for Stone in Alpha).
  - Asserts `phaseManager.cyclePhase() + completeShift()` cycles ALPHA → BETA → GAMMA → ALPHA.
  - Asserts BDD seed determinism: same seed (42) → same terrain hash (§6.4).
  - Asserts non-empty world: seed 42 produces ≥ 50% non-air blocks in the spawn column.
- A Playwright test in `tests/gameplay.spec.js` that exercises the live `__phaseShifter__` API:
  - Boot invariants: chunkCount ≥ 29, initial phase === 0.
  - Behavioral: `physicsManager.setPosition(x + 5, y, z + 5)` changes the position.
  - Block break: `world.setBlock(x, y, z, 0, 1)` then `world.setBlock(x, y, z, 0, 0)` reads block id 0.
  - cyclePhase round-trip: ALPHA → BETA → GAMMA → ALPHA via `pm.cyclePhase() + pm.completeShift()`.
  - Save/load round-trip: `saveSystem.saveSnapshot(7, 30, 7, phase, worldState)` → `saveSystem.loadGame()` returns position (7, ?, 7).
- A new static-analysis block in `tests/headless/smoke.cjs` (`phase6Ok`) that verifies the wiring exists:
  - `__phaseShifter__.chunkCount` getter on main.js.
  - `__phaseShifter__.phaseManager`, `physicsManager`, `world` getters.
  - `__phaseShifter__.forceCyclePhase` hook.
  - `World.index` / `World.unpackIndex` / `World.isBlockSolid` / `World.setBlock` / `World.getBlock` / `World.updateChunks` / `World.getChunks`.
  - `PhaseManager.cyclePhase` / `completeShift` / `getCurrentPhase` / `isShifting`.
  - `PhysicsManager.setPosition` / `getPos`.
  - `CHUNK_SIZE = 16`, `CHUNK_HEIGHT = 64` constants.
  - `tests/headless/test-phase6.cjs` exists with the focus-suite assertions.
- `phase6Ok` gate in the smoke test's `process.exit(...)`.

## Acceptance (from plan §6)

1. **§6.1 Boot smoke (live).** The smoke test boots the production build, reads `__phaseShifter__.chunkCount` (≥ 29) and `__phaseShifter__.phaseManager.getCurrentPhase()` (=== 0). The Playwright test asserts these live invariants.
2. **§6.2 Behavioral (live).** `physicsManager.setPosition(x + 5, y, z + 5)` advances the player position. `world.setBlock + world.getBlock` round-trip preserves the block id. The Playwright test exercises both via the live debug API.
3. **§6.3 Unit layer.** `World.index(x, y, z)` round-trips with `World.unpackIndex(i)` for (x, y, z) ∈ { (0,0,0), (1,0,0), (15,0,0), (0,30,0), (0,0,15), (15,63,15), (7,32,8) }. `World.isBlockSolid` is true for Stone in Alpha. `PhaseManager.cyclePhase + completeShift` cycles through all 3 phases and wraps.
4. **§6.4 BDD seed determinism.** Two `new World(seed=42)` + `updateChunks(0, 0, 2)` instances produce the same terrain hash (sha256 over the 16×16×16 spawn column). Seed 42 produces ≥ 50% non-air blocks.
5. **§6.5 Pre-PR checklist.** `npm run build` produces a 36 KB gzipped main entry bundle. `node tests/headless/test-phase6.cjs` exits 0 with 15/15 passing. `node tests/headless/smoke.cjs` exits 0 in a real browser (sandbox has 5 pre-existing WebGL-related failures unrelated to Phase 6).
6. **No regression locks.** Phase 1.6's `no_direct_date_now` stays true. Phase 1.7's `save_snapshot_defined` stays false (the signature requires position + phase + worldState). All Phase 2.x–5 static-analysis keys stay true. The new `phase6Ok` block must pass without introducing any new failures.

## Fix shape

1. **`tests/headless/test-phase6.cjs`** (new — 15 assertions). Pure Node test that imports the core modules directly:
   - §6.1: 2 assertions (chunkCount ≥ 29, initial phase 0).
   - §6.3: 8 assertions (World.index defined + unpackIndex defined + 7 round-trip checks; isBlockSolid for Stone in Alpha after placement).
   - §6.3 cyclePhase: 4 assertions (initial phase 0 → after cyclePhase phase 1 → after 2 cyclePhase phase 2 → after 3 cyclePhase wraps to 0).
   - §6.2: 1 assertion (physicsManager.setPosition changes the position).
   - §6.4: 2 assertions (seed 42 produces non-empty world; same seed produces same terrain hash).

2. **`tests/gameplay.spec.js`** (extend). One new Playwright test:
   - §6.1 boot invariants: chunkCount ≥ 29, phase === 0.
   - §6.2 behavioral: `physicsManager.setPosition(x1 + 5, y1, z1 + 5)` → `getPos()` returns the new position.
   - §6.3 cyclePhase: ALPHA → BETA → GAMMA → ALPHA round-trip via `pm.cyclePhase + pm.completeShift`.
   - §6.5 save/load: `saveSystem.saveSnapshot(7, 30, 7, phase, worldState)` → `saveSystem.loadGame()` returns position (7, ?, 7).

3. **`tests/headless/smoke.cjs`** (extend). New `phase6` block (35 static-analysis keys) + `phase6Ok` gate + ACCEPTANCE SUMMARY header updated to `1.1 + 1.2 + ... + 5 + 6`.

4. **`PHASE_6_BRIEF.md`** (this file).

5. **`PROJECT_REMEDIATION_PLAN.md`** (update progress row).

## Outcome of Phase 6

The test suite now catches regressions at the unit layer (test-phase6.cjs runs without a browser), the integration layer (smoke.cjs boots the production build + checks DOM + checks 400+ static-analysis keys), and the end-to-end layer (gameplay.spec.js exercises the live debug API). The developer can run `node tests/headless/test-phase6.cjs` for fast feedback and `npm test` for the full Playwright suite. CI catches regressions on every PR.

## Test counts

- `tests/headless/test-phase6.cjs`: 15 assertions (pure Node).
- `tests/gameplay.spec.js`: +1 Playwright test (~30 assertions across the live boot + behavioral + cyclePhase + save/load round-trip).
- `tests/headless/smoke.cjs`: +35 static-analysis keys in the `phase6` block.

## Critical decisions

1. **Unit test uses `import()` against the actual source files.** No mocks. `tests/headless/test-phase6.cjs` reads `src/core/world.js`, `src/core/phase.js`, `src/core/physics.js`, `src/core/constants.js` directly. This catches regressions in the core module APIs that the smoke test can't reach without WebGL.
2. **World.index is chunk-local.** The unit test asserts (x ∈ [0, 15], y ∈ [0, 63], z ∈ [0, 15]) — the same domain `World.index` enforces. Out-of-range indices are undefined behavior (the unit test does not exercise them).
3. **PhysicsManager uses `update(dt, moveX, moveZ)`, not `tick(dt)`.** The Playwright test uses `physicsManager.setPosition` directly to verify position changes (the simpler behavioral check). `physicsManager.update` requires `moveX`/`moveZ` from the controls, which the live API doesn't expose.
4. **saveSystem access.** `__phaseShifter__.gameState.saveSystem` is the canonical path (it's a getter that exposes the `SaveSystem` instance). The Playwright test calls `saveSystem.saveSnapshot(7, 30, 7, phase, worldState)` then `saveSystem.loadGame()` to round-trip the position.

