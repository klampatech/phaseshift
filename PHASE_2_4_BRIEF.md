# Phase 2.4 — Starting Brief

> **Session goal:** Implement Phase 2.4 — Phase memory persistence (the wider §2.4 goal beyond the chunk-unload half that landed in Phase 2.3).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.4.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 2.3 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phase 2.3 locked in per-phase place/break (LMB break, RMB-on-face place Stone, RMB-in-air cycle) AND the chunk-unload + reload persistence path. The §2.4 acceptance is wider:

> **Acceptance (from plan §2.4):** break a block, walk far enough to unload the chunk, walk back — the block is still broken.

The "unload the chunk" part is now solved (Phase 2.3 did it). What's left is the save → reload round-trip:

> **Acceptance (from plan §2.3 + §2.4):** The placed/broken block persists through a save → reload round-trip (already covered by Phase 1.7; regression test).

The Phase 1.7 export/import filter out `BLOCK_AIR` on both sides, so a *break* (which writes `BLOCK_AIR` to `_globalStateMap`) does NOT survive a save → reload round-trip. The placed block survives (the generator's value is overwritten on reload by the player's non-air edit). The broken block doesn't (the AIR is filtered out, and the generator's value resurrects on reload).

This is a real half-coverage. For Phase 2.4 we need to extend the same "the player's value wins, including AIR" guarantee to the save format. Trade-off: the save file gets bigger (it now records every player's AIR too). That's the right design — the player broke the block, the break should stick.

The fix is small: stop filtering `BLOCK_AIR` in `World.exportGlobalState` and `World.importGlobalState`. The change is consistent with the Phase 2.3 `loadChunk` fix (which applies AIR from the global state map whenever the key exists).

## Acceptance (from plan §2.3 + §2.4)

1. **Pick a Stone block in Alpha, break it.** The cell becomes `BLOCK_AIR` in Alpha. Save → reload. The cell is still `BLOCK_AIR` in Alpha (the break survives).
2. **Place Stone at a fresh cell in Beta, save, reload.** The cell is still Stone in Beta.
3. **Break a block, walk far enough to unload the chunk (`UNLOAD_CHUNK_DIST + 2`), walk back.** The block is still broken. (Already covered by Phase 2.3.)
4. **Place Stone, walk away, walk back.** Stone is still there. (Already covered by Phase 2.3.)
5. **Pick a generator-populated cell (e.g. a Dirt block at the surface in Alpha), break it, save, reload.** The cell is still `BLOCK_AIR` in Alpha (the break survives the round-trip).
6. **Reboot the page** (the strongest "reload" test). The cell is still AIR.

In all cases, the cell's value in the player's `phase` matches the player's last edit, regardless of whether the edit was a placement or a break.

## Fix shape

1. **`World.exportGlobalState()`** in `src/core/world.js` — stop filtering `BLOCK_AIR`. The current implementation:
   ```js
   exportGlobalState() {
     const out = {};
     for (const [key, blockId] of this._globalStateMap) {
       if (blockId !== BLOCK_AIR) out[key] = blockId;
     }
     return out;
   }
   ```
   becomes:
   ```js
   exportGlobalState() {
     const out = {};
     for (const [key, blockId] of this._globalStateMap) {
       out[key] = blockId; // Preserve AIR too: a player break is a real edit.
     }
     return out;
   }
   ```
   The trade-off is a bigger save file for worlds with many player breaks. Notes:
   - Phase 1.7's "filter out BLOCK_AIR to keep the save small" comment is **stale** — it's a Phase 1.7 design assumption that we now relax to match the new persistence contract.
   - `_globalStateMap` only contains entries the player has touched (via `setBlock`). Generator-only cells are not in the map. So the save still doesn't bloat for untouched terrain.
   - Inside the player's existing memory, the player's intent is the canonical truth — both placements and breaks.

2. **`World.importGlobalState(snapshot)`** in `src/core/world.js` — stop filtering `BLOCK_AIR` on the import side:
   ```js
   importGlobalState(snapshot) {
     this._globalStateMap.clear();
     if (!snapshot || typeof snapshot !== 'object') return 0;
     let count = 0;
     for (const [key, blockId] of Object.entries(snapshot)) {
       if (typeof blockId === 'number' && Number.isFinite(blockId)) {
         this._globalStateMap.set(key, blockId);
         count++;
       }
     }
     return count;
   }
   ```
   The previous filter `&& blockId !== BLOCK_AIR` is dropped. The `Number.isFinite` check stays — garbage in the save blob (NaN, fractional, etc.) is still rejected.

3. **`saveSystem.saveSnapshot` / `loadGame`** in `src/save/system.js` — the JSON-serialized save blob is the same shape; it just contains more entries (the player's AIR edits). No code change needed if the export/import shape is unchanged.

4. **`tests/headless/test-phase24.cjs`** — new. Three behavioral tests:
   - Pick a Stone block, break it (`world.setBlock(..., AIR)`), export state, import state into a fresh World, reload the chunk, verify the cell is still AIR.
   - Place Stone in Beta, save, reload (export + import + chunk reload), verify the cell is still Stone in Beta.
   - Break a generator-populated Dirt block, save, reload, verify the cell is AIR in Alpha.
   - Plus the static-analysis checks: `exportGlobalState` no longer filters AIR; `importGlobalState` no longer filters AIR; `loadChunk` applies AIR (already verified in Phase 2.3).

5. **Extend `tests/headless/smoke.cjs`** with the Phase 2.4 static-analysis block.

## Files to touch

- `src/core/world.js` — `exportGlobalState` and `importGlobalState` no longer filter `BLOCK_AIR`.
- `src/save/system.js` — no change (the JSON shape is the same; the entries just include AIR).
- `tests/headless/test-phase24.cjs` — new.
- `tests/headless/smoke.cjs` — Phase 2.4 static-analysis block.
- `tests/gameplay.spec.js` — optional Playwright test that breaks a block, hard-reloads the page, and asserts the cell is still AIR.

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
node tests/headless/test-phase23.cjs
node tests/headless/test-phase24.cjs   # new
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (break a block → save → reload → block is still missing + the AIR shows up in the HUD-replay) is the user's responsibility.

## Reference files

- `src/core/world.js` — `exportGlobalState`, `importGlobalState`, `loadChunk` (Phase 2.3's AIR-preservation fix is the model for Phase 2.4).
- `src/save/system.js` — `saveSnapshot`, `loadGame` (the JSON shape is unchanged; only the entries' content is more inclusive).
- `src/core/constants.js` — `BLOCK_AIR = 0` (the canonical "no block" id).
- `PROJECT_REMEDIATION_PLAN.md` §2.4 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context.
- `PHASE_2_3_BRIEF.md` — Phase 2.3's persistence contract (chunk-unload + reload + AIR); Phase 2.4 extends it to save → reload.

## Common pitfalls

- **Don't drop the `Number.isFinite` guard from `importGlobalState`.** A tampered save blob can contain `NaN`, fractional ids, or strings. The previous code filtered both `BLOCK_AIR` and non-finite values; the new code keeps the non-finite filter but accepts AIR. Garbage in the save blob (e.g. `"block": "stone"` strings) is still rejected.
- **Save file size will grow if the player makes many breaks.** Per-cell entries are tiny (single byte for the block id + a few bytes for the key) — even a heavy player who breaks 10,000 blocks adds <100 KB to the save file. Not a real concern.
- **The `_globalStateMap` is also touched by `loadChunk` (Phase 2.3) — when the chapter shortcut is `world.setBlock(...)`, the map is updated. Don't accidentally add a separate path that also writes to the map without going through `setBlock` — that would split the persistence contract.**
- **The `globalStateMap` filter changes don't affect the §2.4 acceptance test in `test-phase23.cjs` (Phase 2.3) — those tests construct a fresh `World` and use `setBlock` + `chunks.delete` + `ensureChunk`, which don't go through the export/import path at all.**
- **The new `importGlobalState` accepts `BLOCK_AIR`. Don't invert the logic so that `importGlobalState` *deletes* missing keys from the map — that would erase the player's previous edits. The behavior is: the snapshot is the canonical truth; everything not in the snapshot is forgotten.**
- **The Phase 1.7 `_coerceWorldState` in `src/save/system.js` might also filter `BLOCK_AIR`. Check before assuming it doesn't — if it does, both ends need to change in lockstep.**

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.3 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table marks Phase 2.3 ✅ Done (already in this commit).
- Phase 2.4 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.4: phase memory persistence across save/reload (exportGlobalState + importGlobalState preserve BREAK_AIR)"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.4 → ✅ Done), update `HANDOFF.md` for Phase 2.5 hand-off, and create `PHASE_2_5_BRIEF.md` following the same template.
