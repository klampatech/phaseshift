# Phase 1.4 — Starting Brief

> **Session goal:** Implement Phase 1.4 — Single index scheme (`World.index()` / `World.localIndex()` helpers; replace raw formulas).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §1.4.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** `31d0f48` · **Remote:** `klampatech/phaseshift`.

---

## Problem

The block-indexing formula `x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT` is inlined in **8 places** across the codebase:

| File | Line | Use |
|---|---|---|
| `src/gen/terrain.js` | 247 | `TerrainGenerator.index(x, y, z)` (used internally) |
| `src/core/world.js` | 187 | `World.getBlock` — local chunk index |
| `src/core/world.js` | 207 | `World.setBlock` — local chunk index |
| `src/core/world.js` | 144 | `World.loadChunk` — `bz = Math.floor(i / (CHUNK_SIZE * CHUNK_HEIGHT))` |
| `src/render/renderer.js` | 108 | `ChunkVisual.updateMeshes` — position extraction |
| `src/render/renderer.js` | 176 | `ChunkVisual.isSurrounded` — neighbor index |
| `main.js` | 587, 633 | scan loops in `performScan` / `performResonance` |
| `main.js` | 747 | `placeBlockAt` — writes `chunk.alphaData[index]` directly |

If the formula ever changes (e.g. switch to Z-major or Y-major for cache locality), every site has to change in lock-step. This is the kind of fragile coupling Phase 0 was meant to eliminate.

There's also a pre-existing bug in `main.js#placeBlockAt` (line 743-744):
```js
const chunk = world.getChunk(x, z);                  // ← world.getChunk doesn't exist (Phase 1.5 adds it)
const localX = ((x - chunk.x * CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;  // ← chunk.x doesn't exist either
```
The function is called from `placeAnchor()` (line 700) and `breakBlock()` (line 726). It would silently no-op today because `world.getChunk` is `undefined` → `chunk` is `undefined` → `!chunk` short-circuits the function. **Phase 1.5 will add `World.getChunk()` properly; for now, leave `placeBlockAt` alone and let Phase 1.5 wire it. The Phase 1.4 fix only touches the raw index formulas in `main.js#performScan` / `performResonance` (lines 587, 633), not `placeBlockAt`.**

## Acceptance (from plan §1.4)

1. `World.index(x, y, z)` and `World.localIndex(cx, cz, x, z)` are defined in `src/core/world.js`.
2. `World.unpackIndex(i)` returns `{ x, y, z }` so we can write a round-trip test.
3. All raw index formulas in `src/core/world.js` (`getBlock`, `setBlock`, `loadChunk`), `src/render/renderer.js` (`ChunkVisual.updateMeshes`, `ChunkVisual.isSurrounded`), and `main.js` (`performScan`, `performResonance`) use the new helpers.
4. A unit test in `tests/headless/test-phase14.cjs` checks round-trip (`unpackIndex(index(x, y, z)) === { x, y, z }`) for several corner cases (0,0,0; max corner; mid; y-major boundary).
5. After Phase 1.4: `world.setBlock(x, y, z, phase, type)` followed by `world.getBlock(x, y, z, phase)` returns `type` for every `(x, y, z)`.
6. (Implicit) `tests/headless/test-phase12.cjs` (17/17) and `tests/headless/test-phase13.cjs` (7/7) still pass.

## Fix shape

1. **Add helpers to `src/core/world.js`** (in the `// ── Spawn-time helpers` section is fine, or a new `// ── Index helpers` section is cleaner). Both helpers return the same integer; the semantic split is so call sites can be self-documenting.
   ```js
   /** Linear index for an absolute world voxel: x + y*CHUNK_SIZE + z*CHUNK_SIZE*CHUNK_HEIGHT */
   index(x, y, z) { return x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT; }

   /** Linear index within a chunk. `cx`/`cz` are world chunk coords (passed but unused in the math — the index formula is the same because local coords are 0..CHUNK_SIZE-1). */
   localIndex(cx, cz, x, y, z) { return x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT; }

   /** Inverse of `index`. Used for round-trip tests and (later) decompression. */
   unpackIndex(i) {
     const x = i % CHUNK_SIZE;
     const z = Math.floor(i / (CHUNK_SIZE * CHUNK_HEIGHT));
     const y = Math.floor(i / CHUNK_SIZE) % CHUNK_HEIGHT;
     return { x, y, z };
   }
   ```
2. **Replace raw formulas** — be surgical, one site at a time:
   - `World.getBlock` / `World.setBlock` → `this.index(lx, wy, lz)` (or `localIndex` — same value).
   - `World.loadChunk` blend loop → use the helpers for the inner un-index (`unpackIndex(i)` is the cleanest — one call instead of three modulo/divide ops).
   - `renderer.js#ChunkVisual.updateMeshes` → `unpackIndex(i)` (line 105-108).
   - `renderer.js#ChunkVisual.isSurrounded` → `this.index(nx, ny, nz)` (line 176).
   - `main.js#performScan` / `performResonance` → `world.index(wx, wy, wz)` (lines 587, 633).
3. **Don't touch** `placeBlockAt` (Phase 1.5), `TerrainGenerator.index` (could be deprecated later but is internal), or `renderer.js` mesh-build code that does NOT do linear indexing (just `lx/lz/ly` arithmetic).
4. **Add `tests/headless/test-phase14.cjs`** with:
   - Round-trip: `unpackIndex(index(x, y, z)) === { x, y, z }` for `(0,0,0)`, `(CHUNK_SIZE-1, CHUNK_HEIGHT-1, CHUNK_SIZE-1)`, `(5, 32, 7)`, `(0, 63, 0)`, `(15, 0, 15)`.
   - `localIndex` and `index` return the same value for the same `(x, y, z)` triple.
   - Static-analysis: `World.index` is defined in `src/core/world.js`; `getBlock` / `setBlock` no longer contain a raw `y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT` substring.
   - Behavioral: `world.setBlock(5, 30, 7, PHASE_ALPHA, BLOCK_STONE)` followed by `world.getBlock(5, 30, 7, PHASE_ALPHA)` returns `BLOCK_STONE`. Same for `BLOCK_AIR`, `BLOCK_GLASS`, `BLOCK_WOOD`. (Chunk must be loaded first — use `world.updateChunks(0, 0, 2)`.)
5. **Extend `smoke.cjs`** with the same static-analysis checks so the Phase 1.4 acceptance is checked in CI.

## Files to touch

- `src/core/world.js` (helpers + replace 3 raw formulas)
- `src/render/renderer.js` (replace 2 raw formulas in `ChunkVisual`)
- `main.js` (replace 2 raw formulas in `performScan` / `performResonance`; do NOT touch `placeBlockAt`)
- `tests/headless/test-phase14.cjs` (new)
- `tests/headless/smoke.cjs` (extend)

## How to verify

```bash
node --check main.js && npm run build
node tests/headless/test-phase12.cjs          # 17/17 still pass
node tests/headless/test-phase13.cjs          # 7/7 still pass
node tests/headless/test-phase14.cjs          # new — round-trip + get/set
sudo -E -n node tests/headless/smoke.cjs      # smoke test still green
```

End-to-end browser verification (clicking on a block still toggles it, scan/resonance still work) is the user's responsibility.

## Reference files

- `src/core/world.js` — see `getBlock(x, y, z, phase)` (~line 180), `setBlock(x, y, z, phase, id)` (~line 195), `loadChunk` (~line 110-150). Also see the new `findTopSolidBlock` from Phase 1.3 — no changes there for Phase 1.4.
- `src/render/renderer.js` — see `ChunkVisual.updateMeshes` (~line 95-130) for position extraction and `ChunkVisual.isSurrounded` (~line 160-185) for neighbor indexing.
- `main.js` — see `performScan` (~line 580-595) and `performResonance` (~line 625-635) for the inline `y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x` formulas.
- `PROJECT_REMEDIATION_PLAN.md` §1.4 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context. Note the "Missing helpers" section is now stale (`World.index` / `World.localIndex` are about to be added in this phase).

## Common pitfalls

- **Don't touch `placeBlockAt`.** It uses `chunk.x` (which doesn't exist — should be `chunk.cx`) and `world.getChunk` (which doesn't exist — added in Phase 1.5). Leave the function alone this phase. Phase 1.5 will replace it with `world.setBlock(...)`.
- **Don't change the formula.** `World.index(x, y, z) === x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT`. The existing `getBlock` / `setBlock` already use this formula; the goal is centralization, not a re-layout.
- **Round-trip test sanity.** `unpackIndex(i)` is the inverse of `index(x, y, z)`. Verify by checking `unpackIndex(index(0, 0, 0)).x === 0`, `unpackIndex(index(15, 63, 15)).y === 63`, etc.
- **Static-analysis regex will break if Vite minifies.** Source-level checks against `src/core/world.js` (NOT the dist bundle) are robust — same as Phase 1.2 / 1.3.
- **`World.localIndex` signature.** The plan says `World.localIndex(cx, cz, x, z)` but the math doesn't actually use `cx`/`cz` (local coords are 0..CHUNK_SIZE-1 regardless of chunk). Accept either: pass `cx`/`cz` for self-documentation but ignore them, OR drop them and document the signature. Recommend dropping them — keeps the call sites identical to `index(...)`.
- **Don't break Phase 1.2 or 1.3.** Camera follow + downward raycast must keep working. Run `tests/headless/test-phase12.cjs` and `test-phase13.cjs` after every change.
- **Existing tests are the ground truth.** If a test passes today and breaks after your refactor, your refactor is wrong — go back and fix it.

## Commit & push

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 1.4: single index scheme (World.index/localIndex/unpackIndex)"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 1.4 → ✅ Done), update `HANDOFF.md` for Phase 1.5 hand-off, and create `PHASE_1_5_BRIEF.md` following the same template.
