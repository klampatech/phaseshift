# Phase 2.5 — Starting Brief

> **Session goal:** Implement Phase 2.5 — Scan / Phase Lens (E to highlight phase-different blocks).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.5.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 2.4 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 2.1–2.4 shipped phase shift, phase-relative collision, per-phase place/break, and save/reload memory. The §2.5 acceptance from the plan is the Phase Lens mechanic — the player holds E to *see* phase differences in the world around them, and this is the bridge between "the world has phase-relative data" (§2.2) and "the player can do something with that data" (Resonance in §2.6, Anchor in §2.7).

> **Acceptance (from plan §2.5):** holding E in a dense Forest shows colored wireframes around blocks that differ from the current phase. The energy bar ticks down.

The codebase has the *scaffolding* for this — `World.scanNearby(playerX, playerY, playerZ, radius)` already exists (Phase 1.4) and returns `{x, y, z, visiblePhases}` for blocks that exist in at least two phases. `main.js` has a `performScan` and a `phaseLensActive` flag driven by `ctrlState.scanning`. But the implementation is partial and untested:

1. `main.js#performScan` uses a hand-rolled chunk loop (works, but bypasses `World.scanNearby` and reads chunk data directly — fragile).
2. `scanRadius = 8` is hard-coded; the plan says **4** blocks.
3. There's a `phaseLensActive` flag and `updatePhaseLensVisibility` that fades *non-current* phases to 0.1 opacity, but **no colored wireframe per phase** — the plan calls for "colored wireframes per phase" (Alpha in green, Beta in blue, Gamma in gold).
4. **No energy drain** on hold. The plan says 0.5/sec; the constants file has `SCAN_COST = 3` for the one-shot press, but no drain rate.
5. **No beam-from-camera** visual. The plan says "Beam from the camera in the crosshair direction."
6. **No unit tests.** The existing scan code in `main.js` is untested (Phase 1.4's `World.scanNearby` was used in static-analysis checks for indexing but no behavioral tests for scan results).

For Phase 2.5 we need to:
- Centralize the scan logic on `World` (or a new `src/scan/lens.js`).
- Add the per-phase colored wireframe rendering.
- Wire the energy drain (0.5/sec) to the hold state.
- Add the camera beam.
- Cover the new behavior with unit tests and Playwright regression tests.
- Refactor `main.js#performScan` to delegate to the new world method instead of reading chunk data directly.

## Acceptance (from plan §2.5)

1. **Press E (one-shot, no hold).** `World.scanNearby(playerX, playerY, playerZ, 4)` returns the phase-different blocks in a 4-block radius. A notification shows the count.
2. **Hold E.** A continuous lens activates: blocks visible in a *different* phase from the current are outlined with a colored wireframe (Alpha outline = green, Beta = blue, Gamma = gold).
3. **Hold E.** Energy drains at 0.5/sec. When energy is below the threshold, the lens deactivates and the player is told "Insufficient energy."
4. **Hold E.** A subtle beam is drawn from the camera in the crosshair direction (cylinder or thin box geometry) to make the "scanning" affordance visually obvious.
5. **Release E.** The wireframes clear within one frame. The beam disappears. No further energy is consumed.
6. **Hold E, walk into a known-mixed-phase cell (e.g. a Crystal block in Beta, surrounded by Stone).** The Crystal block is outlined in *the non-current phase's* color (since Crystal is only visible in Beta, it's "different" from the player standing in Alpha).
7. **Hold E in a chunk with no phase-different blocks (rare — try a solid Stone cube in a single phase).** The lens shows zero wireframes. No crash. No false positives.
8. **Regression:** `main.js#performScan` no longer reads `chunk.alphaData` directly; it delegates to `World.scanNearby`.

## Fix shape

1. **`src/scan/lens.js`** (new) — pure module. Exports:
   - `scanResults(playerX, playerY, playerZ, radius, currentPhase, world)` — returns `Array<{ x, y, z, currentPhaseBlock, otherPhases: number[] }>`. The per-block result includes the block in the current phase + the list of OTHER phases where this cell is non-air. This is what the renderer needs to color the wireframes.
   - `phaseLensDrain(dt)` — returns the energy to subtract (`PHASE_LENS_DRAIN_RATE * dt`).
   - `lensRadius()` — returns `4` (the plan's block radius).
   
   All functions are pure so behavioral tests can run without Three.js or a global `world`.

2. **`src/render/renderer.js`** (extend `ChunkVisual` or a new `ScanOverlay`):
   - `showScanHighlights(results)` — for each result, create a wireframe Box geometry at `(x, y, z)` colored by the *other* phases (multi-phase blocks get multiple outlines). Use `LineSegments` + `EdgesGeometry` for the wireframe.
   - `clearScanHighlights()` — dispose all highlight meshes.
   - `showScanBeam(camera)` / `hideScanBeam()` — show a thin colored cylinder from the camera in the crosshair direction.
   - The overlay lives in a separate Three.js group (`scanOverlayGroup`) so it can be cleared without touching chunk visuals.

3. **`src/core/world.js`** (extend `scanNearby`):
   - The existing `scanNearby` returns only blocks that exist in **multiple** phases (bitCount > 1). For the Phase Lens wireframe, the renderer also wants blocks that exist in *one* phase but not the *current* phase (e.g. standing in Alpha, the renderer wants to outline a Crystal block that's only in Beta). Add a new helper `findPhaseDifferences(playerX, playerY, playerZ, radius, currentPhase)` that returns all blocks in the radius that differ from the current phase, including single-phase non-current blocks. `scanNearby` (multi-phase) stays for the §3.0 minimap use case.

4. **`src/core/constants.js`** — add `PHASE_LENS_DRAIN_RATE = 0.5` and `SCAN_RADIUS = 4` (and `SCAN_LENS_RADIUS = 4` if different — probably the same).

5. **`main.js`**:
   - `performScan` is refactored to delegate to `world.findPhaseDifferences(...)` (or `src/scan/lens.js#scanResults`) — no more direct `chunk.alphaData` reads.
   - New per-frame branch in the game loop: while `ctrlState.scanning` is true, drain energy at `PHASE_LENS_DRAIN_RATE * dt` and call `renderer.showScanHighlights(world.findPhaseDifferences(...))`. When `ctrlState.scanning` is false, `renderer.clearScanHighlights()`.
   - Insufficient energy → `phaseManager.getEnergy() < PHASE_LENS_DRAIN_RATE * dt` → call `hud.showNotification('Insufficient energy', '#ff8844')` and force `ctrlState.scanning = false`.
   - Beam from camera: while scanning, `renderer.showScanBeam(camera)`; otherwise `renderer.hideScanBeam()`.

6. **`tests/headless/test-phase25.cjs`** (new) — at least 12 tests:
   - Static: `src/scan/lens.js` exports the three helpers; `main.js#performScan` no longer reads `chunk.alphaData` directly; `World.findPhaseDifferences` is defined; `PHASE_LENS_DRAIN_RATE` is defined; renderer has `showScanHighlights`/`clearScanHighlights`/`showScanBeam`/`hideScanBeam`.
   - Behavior on tiny world: `scanResults` returns the expected phase-different cells; `phaseLensDrain` returns the right amount for a given dt; `lensRadius` returns 4; `findPhaseDifferences` includes single-phase non-current blocks (Crystal in Beta when player is in Alpha); `findPhaseDifferences` returns empty for a fully-uniform chunk.
   - Energy: draining for 2 seconds at 0.5/sec subtracts 1.0 from a world energy pool. Insufficient energy below threshold prevents further drain.

7. **`tests/headless/smoke.cjs`** — add Phase 2.5 static-analysis block (8–10 checks).

8. **`tests/gameplay.spec.js`** — 1 Playwright test: simulate `__phaseShifter__.forceScan()` debug hook, hold E for 1.5s, assert the scan overlay group has child meshes. (No real wireframe colors can be verified headless without a working renderer; just assert mesh count > 0 and the energy dropped by ~0.75.)

## Files to touch

- `src/scan/lens.js` — new (pure module).
- `src/core/world.js` — add `findPhaseDifferences(playerX, playerY, playerZ, radius, currentPhase)`.
- `src/core/constants.js` — add `PHASE_LENS_DRAIN_RATE = 0.5`, `SCAN_RADIUS = 4`.
- `src/render/renderer.js` — add `ScanOverlay` (wireframe + beam).
- `main.js` — refactor `performScan`; add per-frame lens loop; add beam; refactor energy drain.
- `tests/headless/test-phase25.cjs` — new.
- `tests/headless/smoke.cjs` — Phase 2.5 static-analysis block.
- `tests/gameplay.spec.js` — 1 new Playwright test.

## How to verify

```bash
node --check main.js
node --check src/scan/lens.js
node --check src/render/renderer.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
node tests/headless/test-phase13.cjs   # 7/7 still pass
node tests/headless/test-phase14.cjs   # 21/21 still pass
node tests/headless/test-phase15.cjs   # 12/12 still pass
node tests/headless/test-phase16.cjs   # 21/21 still pass
node tests/headless/test-phase17.cjs   # 26/26 still pass
node tests/headless/test-phase22.cjs   # 35/35 still pass
node tests/headless/test-phase23.cjs   # 50/50 still pass
node tests/headless/test-phase24.cjs   # 46/46 still pass
node tests/headless/test-phase25.cjs   # new — Phase 2.5
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (hold E, see colored wireframes + beam + energy drain) is the user's responsibility. WebGL fails in the sandbox; the headless tests cover the math + API surface.

## Reference files

- `src/core/world.js` — `scanNearby` (Phase 1.4) is the model for `findPhaseDifferences`. `getBlockMask` is the per-block phase-presence read primitive.
- `src/core/constants.js` — `SCAN_COST = 3` (one-shot) and `RESONATE_COST = 15` are the existing energy-cost constants. `PHASE_LENS_DRAIN_RATE = 0.5` (per-second hold cost) is the new one.
- `src/core/game.js` (orphan, do NOT import) — `world.scanNearby(playerPos, 4)` + `renderer.showScanResults` + `renderer.clearScanHighlights` + `particles.emitPhaseLens` are the reference implementation. Port the algorithm and rendering pattern; do not import the module.
- `src/render/renderer.js` — `ChunkVisual.isSurrounded` and the chunk-mesh pattern are the model for `ScanOverlay`'s wireframe + beam geometry. The overlay lives in a separate Three.js group so it can be cleared without touching chunk visuals.
- `src/input/controls.js` — `ctrlState.scanning` is set by the E key listener. Phase 2.5 reads the flag, doesn't change it.
- `main.js` — `performScan` (currently reads `chunk.alphaData` directly) and the per-frame `updatePhaseLensVisibility` loop are the call sites to refactor.
- `PHASE_2_4_BRIEF.md` — the previous brief. The persistence contract (save/reload preserves BLOCK_AIR) extends naturally: a Phase Lens "highlight" is read-only (no `_globalStateMap` writes), so no special persistence handling is needed.
- `PROJECT_REMEDIATION_PLAN.md` §2.5 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context.
- `src/core/particles/particleManager.js` (orphan, do NOT import) — `emitPhaseLens` is the reference for the beam-from-camera particle effect. Port the algorithm; the active path will need a Three.js equivalent (a cylinder mesh that pulses opacity, not a particle system, since particles are still quarantined).

## Common pitfalls

- **Don't import the orphan `src/core/game.js`.** The plan says to *port* features from it, not to import it. The reference implementation has a known `ppos` redeclaration bug (HANDOFF §Architectural state). Build the new code from scratch against the active `World` + `Renderer` API.
- **Don't put the overlay in the chunk-mesh group.** `ScanOverlay` is a separate Three.js group with its own add/remove lifecycle. The chunk visualizer owns the `meshes` field; the overlay must not share that field. If you add wireframes to the chunk group, you'll have to clear them whenever the chunk reloads (which happens often — every time the player moves into a new chunk). A separate group clears the overlay in one call.
- **The beam must update every frame while scanning.** The camera moves and rotates; a beam anchored to world coordinates would lag behind. Animate the beam's position and orientation per-frame in the game loop (or in `renderer.update()`). Don't snapshot it on scan-press.
- **Energy drain must be `dt`-scaled.** A naive `phaseManager.consumeEnergy(PHASE_LENS_DRAIN_RATE)` once per press would drain a fixed amount regardless of how long the player holds. The drain should be `PHASE_LENS_DRAIN_RATE * dt` per frame so 1 second of hold = 0.5 energy, 2 seconds = 1.0, etc.
- **The "insufficient energy" branch is a state, not a frame.** When the player's energy falls below the per-frame cost, the lens should turn off and *stay off* until the player releases and re-presses E. Don't drain the energy to negative and don't keep ticking the lens at sub-threshold levels. The notification is one-shot (per-press, not per-frame).
- **`scanNearby` is not the same as `findPhaseDifferences`.** The existing `scanNearby` returns only multi-phase blocks (the §3.0 minimap use case). The new `findPhaseDifferences` returns all blocks that differ from the current phase, including single-phase non-current blocks. Don't break `scanNearby` — the minimap work (Phase 3.3) still uses it.
- **Don't read `chunk.alphaData` directly in `main.js`.** This was the Phase 1.5 anti-pattern; Phase 2.5 must refactor it out. The refactor: `main.js#performScan` calls `world.findPhaseDifferences(...)` (or `src/scan/lens.js#scanResults`). The renderer gets the results; it doesn't read chunk data.
- **The wireframe color must come from `PHASE_COLORS`, not a hard-coded tuple.** Phase 2.1 already exports `PHASE_COLORS` from `src/core/constants.js`. Use `[alpha, beta, gamma].map(p => PHASE_COLORS[p])` for the outline colors so the palette stays in lockstep with the HUD indicator and the post-FX shader.
- **Playwright can't verify the visual feedback** (no WebGL in the sandbox). The Playwright test should assert *non-visual* invariants: the scan overlay group has child meshes, the energy dropped by the expected amount, the notification appeared. Don't assert colors or opacities.
- **The renderer's `showScanHighlights` must dispose old meshes** when called repeatedly. The player can hold E, walk into a new chunk, and call `showScanHighlights` again. The old meshes need to be removed from the scene and their geometries/materials disposed, or the renderer leaks memory.
- **The beam mesh's color comes from the player's current phase, not the target phase.** The plan says "beam from the camera in the crosshair direction" — the player is "looking" with their current phase, so the beam is tinted with `PHASE_COLORS[currentPhase]`.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.4 closure (already in the working tree at start of phase).
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 2.4 is already ✅ Done. Phase 2.5 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- Phase 2.5 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- `PHASE_2_6_BRIEF.md` (Resonance / Q) will be created at the start of the next-next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.5: scan / phase lens (hold E to highlight phase-different blocks + beam)"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.5 → ✅ Done), update `HANDOFF.md` for Phase 2.6 hand-off, and create `PHASE_2_6_BRIEF.md` following the same template.
