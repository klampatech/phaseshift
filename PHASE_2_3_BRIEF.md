# Phase 2.3 — Starting Brief

> **Session goal:** Implement Phase 2.3 — Block place / break (per-phase).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.3 + §2.4.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 2.2 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phase 2.1 locked down right-click for phase cycling; Phase 2.2 locked down phase-relative collision. The player can now cycle phases and stand on Stone in Alpha + Beta — but they can't actually *interact* with the world yet.

There's a half-built interaction layer in `main.js`:

- `breakBlock()` is wired to **left-click** (LMB). It raycasts up to 6 blocks, checks `BLOCK_PROPERTIES[id].phase.includes(currentPhase)` to refuse invisible blocks, and calls `placeBlockAt(x, y, z, BLOCK_AIR)`.
- `placeBlockAt(x, y, z, blockType)` writes through `world.setBlock(x, y, z, phaseManager.getCurrentPhase(), blockType)`. So a single-phase edit is already correct.
- `placeAnchor()` is wired to **Shift+LMB** (Phase 2.7). It calls `placeBlockAt(anchorPos.x, anchorPos.y, anchorPos.z, 15)` (the old "anchor block" id). This currently repurposes LMB+Shift to *write* to the world; that path has nothing to do with the Phase 2.7 lockManager yet.
- `updateBlockHint()` runs on every mousemove and writes a `#block-hint` text — already in place, no changes needed.
- **There is no `placeBlock()` wired to any input.** The plan §2.3 says "RMB = place Stone", but RMB is already taken by phase cycling (§2.1). This needs disambiguation.

The disambiguation is the load-bearing decision. The current keymap is:

| Input | Current | Plan §2.3 wants |
|---|---|---|
| LMB | break (✓) | break (✓) |
| RMB | cycle phase (✓) | place Stone |
| Shift+LMB | anchor (preliminary; not yet the lockManager path) | anchor (§2.7) |

We can't repurpose RMB without breaking §2.1's right-click cycle and the Playwright tests that pin it. **Resolution:** RMB-on-a-face places Stone; RMB-in-open-air cycles phase. The raycast result is the disambiguator — if there's a hit block and the adjacent face cell is empty, RMB places; otherwise RMB cycles. This keeps both interactions accessible without giving up either one.

A second concern: §2.4 says **player edits must survive a chunk unload/reload**. `World.setBlock` already writes to `_globalStateMap` (Phase 1.7 closure), and `loadChunk` already applies that snapshot back into the generated `alphaData/betaData/gammaData` arrays. We need to lock that path in with a regression test (break a block, force `chunks.delete(...)`, force a reload — the block is still gone).

## Acceptance (from plan §2.3 + §2.4)

1. Standing in Alpha with a Stone block in crosshair range:
   - **LMB** breaks it; the cell becomes `BLOCK_AIR` in Alpha (and only Alpha — Stone in Beta + Gamma, if any, is untouched).
   - **RMB** (on the block face) places Stone on the adjacent face cell, in the current phase only.
   - **RMB** (no block in range) cycles the phase (existing §2.1 behavior, preserved).
2. The placed/broken block persists through a save → reload round-trip (already covered by Phase 1.7; regression test).
3. The placed/broken block persists through a chunk unload + reload:
   - Break a block, walk far enough that the chunk unloads (`UNLOAD_CHUNK_DIST + 2`), walk back — the block is still broken.
   - The same test for `placeBlockAt`: place Stone, walk away, walk back — Stone is still there.
4. `#block-hint` shows the targeted block's name + visible/solid state. (Already wired by `updateBlockHint`; regression test that the text contains the block name.)
5. Breaking a block that is not in the current phase shows the "Block not solid in current phase" notification and does not modify the world. (Already wired; regression test.)
6. (Implicit) `tests/headless/test-phase12.cjs` … `test-phase22.cjs` (35/35), `smoke.cjs`, and the Playwright suite (33/33) still pass.

## Fix shape

1. **`placeBlock(hit, blockId)`** (`main.js` or a new `src/input/placeBlock.js` — main.js is fine for now, it's already where `breakBlock` lives).
   - Reuse the same raycast as `breakBlock` (6-block reach).
   - Compute the target cell: `hit.blockX/Y/Z + hit.face` (the adjacent face normal).
   - Refuse if the target cell is already non-air in the current phase (`BLOCK_AIR` is the only legal overwrite in §2.3 — placing into a non-air cell would let the player build arbitrary stacked blocks, which is out of scope).
   - Refuse if the target cell would overlap the player's AABB (use `PhysicsManager._checkCollision` — already exposed for tests — to verify the placement is physically possible).
   - Refuse if the current phase's solidity mask for `blockId` would put a solid block where the player is standing. (Tied to Phase 2.2's `World.isBlockSolid`.)
   - Call `world.setBlock(targetX, targetY, targetZ, phaseManager.getCurrentPhase(), blockId)`.
   - Update the chunk visuals (`updateChunkVisuals`).
   - Spawn a placement particle effect (port `spawnBreakParticles` → `spawnPlaceParticles`, mirrored signature).
   - HUD notification: `BLOCK PLACED (x, y, z)`.
2. **Input disambiguation** (`main.js` click handler)
   - On `RMB`:
     - If `raycastBlock(pos, dir)` returns a hit AND the adjacent face cell is empty AND placing wouldn't overlap the player → call `placeBlock(hit, BLOCK_STONE)` and **return** (skip the phase cycle).
     - Otherwise → call `phaseManager.cyclePhase()` (existing behavior).
   - On `LMB` (no shift) → `breakBlock()` (existing behavior).
   - On `Shift+LMB` → `placeAnchor()` (existing; Phase 2.7 will replace the body with the `lockManager` path).
3. **`placeAnchor` cleanup**
   - The current `placeAnchor` writes `15` (the old anchor block id) via `placeBlockAt`. That's not the §2.7 lockManager path. For Phase 2.3 we just want a placeholder so the input binding still works. Two options:
     - (a) Leave `placeAnchor` alone and ignore the side-effect (the world gets a stray Stone block at id 15; Phase 2.7 will rewrite this anyway).
     - (b) Stub `placeAnchor` to call the `lockManager.addAnchor` path if the manager exists, else no-op. (Cleaner.)
   - Recommendation: **(b)**. Move the actual lockManager integration to §2.7 (it's already deferred there). For Phase 2.3, stub `placeAnchor` to a no-op + `hud.showNotification('Anchor placement pending §2.7')`. Prevents the stray-block side effect from polluting §2.3's tests.
4. **`world.setBlock` regression test** (`tests/headless/test-phase23.cjs`)
   - Behavioral: a tiny World with a Stone block at (0, 0, 0) in Alpha. Call `world.setBlock(0, 0, 0, PHASE_ALPHA, BLOCK_AIR)`. Force-unload the chunk (`chunks.delete(...)`). Call `loadChunk(chunk)` again. Assert the cell is `BLOCK_AIR` in Alpha and still `BLOCK_STONE` in Beta (if we placed Stone there too) or `BLOCK_AIR` (if we didn't). This is the §2.4 acceptance: "break a block, walk far enough to unload the chunk, walk back — the block is still broken."
   - Same for placement.
   - Static-analysis: `world.setBlock` writes through `_globalStateMap`, `loadChunk` reads from it. (Regex checks against source.)
5. **`placeBlock` unit test** (`tests/headless/test-phase23.cjs`)
   - Static: `placeBlock` defined in `main.js`; calls `world.setBlock` with the *current* phase; refuses to overwrite non-air target cells; refuses to overlap the player AABB; updates chunk visuals.
   - Behavioral: a tiny fixture exposing `placeBlock({blockX, blockY, blockZ, face})`. Verify it calls `world.setBlock` with the correct phase + coordinates. (No Three.js needed — main.js doesn't actually need Three for this test if we extract `placeBlock` to a pure function or just call it through the existing helpers.)
6. **Extend `tests/headless/smoke.cjs`** with the same Phase 2.3 static-analysis block.
7. **Optional Playwright check** (`tests/gameplay.spec.js`)
   - Set up the `__phaseShifter__` debug hook to expose `placeBlock(x, y, z, blockType)`. Call it on a known-empty cell adjacent to a Stone block. Assert the cell now reports as Stone in the targeted phase.
   - Only safe to assert this if we control the world state — the existing `forceCyclePhase` hook gives us a precedent for adding debug hooks for tests.

## Files to touch

- `main.js` — `placeBlock(hit, blockId)` helper; input disambiguation in the click handler; stub `placeAnchor` to defer §2.7.
- `src/core/world.js` — no API change (already writes through `_globalStateMap`); regression test covers the persistence path.
- `src/core/constants.js` — no change.
- `tests/headless/test-phase23.cjs` — new.
- `tests/headless/smoke.cjs` — extend with Phase 2.3 static-analysis block.
- `tests/gameplay.spec.js` — optional `placeBlock` regression test (uses the debug hook).

## How to verify

```bash
node --check main.js
npm run build
node tests/headless/test-phase12.cjs
node tests/headless/test-phase13.cjs
node tests/headless/test-phase14.cjs
node tests/headless/test-phase15.cjs
node tests/headless/test-phase16.cjs
node tests/headless/test-phase17.cjs
node tests/headless/test-phase22.cjs
node tests/headless/test-phase23.cjs   # new
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (dig a 1-block hole, refill it, walk away and back, place survives; break survives) is the user's responsibility.

## Reference files

- `main.js` — `breakBlock`, `placeAnchor`, `placeBlockAt`, `raycastBlock`, `updateBlockHint` already exist; the click handler at line 224 wires them up.
- `src/core/world.js` — `setBlock` writes `_globalStateMap`; `loadChunk` reads it back (Phase 1.7).
- `src/core/physics.js` — `_checkCollision` and `_isBlockSolid` (Phase 2.2) gate placement-overlap checks.
- `src/core/constants.js` — `BLOCK_PROPERTIES` + `phaseSolid` masks (Phase 2.2).
- `PROJECT_REMEDIATION_PLAN.md` §2.3 + §2.4 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context.

## Common pitfalls

- **Don't reuse `placeBlockAt` for the placement helper** — `placeBlockAt(x, y, z, blockType)` writes any block id at any cell, no validation. The new `placeBlock(hit, blockId)` must reject overlap (player AABB), reject non-air targets, and reject out-of-range faces. Keep `placeBlockAt` as the unvalidated write primitive that the new helper calls.
- **The RMB-on-face vs RMB-in-air disambiguation must check the *current* phase.** A Stone block in Alpha is solid; the same coordinate in Gamma is air. If the player is in Gamma and RMB's on a Stone cell, the face is still a valid placement target — the *cell* isn't solid in this phase, so the player could walk through it. That's a §2.4 concern, not §2.3; just don't reject placement based on the wrong phase.
- **`world.setBlock` already triggers `markChunkUpdated`**, which calls `onChunkUpdated`. `ChunkVisual.updateMeshes` rebuilds the mesh. So the renderer picks up the change automatically — no manual mesh rebuild needed. (Confirmed by Phase 1.5's `setBlock triggers visual update callback` check.)
- **`placeBlock` must use `Math.floor` consistently** — `raycastBlock` returns `blockX/Y/Z` as `Math.floor(point.x/y/z)`, which are already integer block coordinates. Don't double-floor.
- **The placement-overlap check should call `PhysicsManager._isBlockSolid(targetX, targetY, targetZ, phase)`** (Phase 2.2 helper) to verify the player won't be inside the new block once it's placed. This is the §2.3 acceptance "placement wouldn't put the player inside a block."
- **Don't break the `__phaseShifter__.forceCyclePhase` debug hook** (Phase 2.1). The new `placeBlock` doesn't touch it, but any refactor of the click handler must keep `forceCyclePhase` working.
- **Static-analysis regex will break if Vite minifies.** Source-level checks against `main.js` (NOT the dist bundle) are robust — same approach as Phases 1.2–2.2.
- **The `placeBlockAt` writes through `phaseManager.getCurrentPhase()` already**, so there's no risk of accidentally writing in the wrong phase. The disambiguation logic in the click handler must also use `phaseManager.getCurrentPhase()`, not a captured phase.
- **The §2.4 chunk-unload regression test needs to actually unload the chunk.** Just calling `chunks.delete(...)` is enough — `loadChunk` rebuilds from terrain gen + applies `_globalStateMap` on top. Walking far enough to unload in-game works too (UNLOAD_CHUNK_DIST+2 from the player), but it's slow and depends on the spawn point. The unit test bypasses both.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.2 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table marks Phase 2.2 ✅ Done (already in this commit).
- Phase 2.3 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.3: per-phase place/break (RMB-on-face places Stone, RMB-in-air cycles)"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.3 → ✅ Done), update `HANDOFF.md` for Phase 2.4 hand-off, and create `PHASE_2_4_BRIEF.md` following the same template.
