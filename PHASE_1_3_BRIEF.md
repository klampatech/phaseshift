# Phase 1.3 — Starting Brief

> **Session goal:** Implement Phase 1.3 — Safe spawn via downward raycast.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §1.3.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** `cc8ed0a` · **Remote:** `klampatech/phaseshift`.

---

## Problem

`main.js:97-102` hard-codes the spawn:

```js
physicsManager.setPosition(0, 20, 0);
camera.position.set(0, 20, 0);
```

`y=20` is a guess. Depending on terrain at (0, 0), the player can spawn:
- **Inside a solid block** → physics pushes them out at next tick (jarring)
- **Far above the surface** → free-fall for several seconds (disorienting)

After Phase 1.2, the camera-follow code means the camera now faithfully copies whatever bad spawn position we set — so a bad spawn is more visible than ever.

## Acceptance (from plan §1.3)

1. Player spawns in open air **on or near a solid surface**, never inside a block.
2. Spawn computed by raycasting down from `y=63` within the 3×3 chunk area around (0,0) until a solid block is found. Place the player one block above the highest solid block + `1.7` (player height).
3. If that fails (no solid blocks in 3×3 area), fall back to chunk generation over a 5×5 area and try again.
4. Add `console.info('[Phase Shifter] Spawned at', pos.toArray())` so it's easy to verify.
5. (Implicit) Camera still trails player (Phase 1.2 behavior preserved).

## Fix shape

1. **Add a raycast helper** in `src/core/world.js` (preferred — World owns chunk data) OR `src/core/physics.js` (also fine). It should:
   - Take `(worldX, worldZ)` and return the highest solid `y` in that column (or `null`).
   - Use the existing `World.getBlock(x, y, z)` (raw indexing is acceptable here — Phase 1.4 will replace with `World.index(...)`).
   - Iterate from `y=63` downward to `y=0`, return `y` of first solid block, or `null`.
2. **Replace the hard-coded spawn** in `main.js` `init()`. Sequence:
   - Call `world.updateChunks(0, 0)` (already done at line 100ish) — this loads the 3×3 area around (0,0).
   - Try the raycast at `(0, 0)`. If found: `setPosition(0, surfaceY + 1.7, 0)`.
   - If not found (no solid in 3×3): expand chunks to 5×5, retry the raycast.
   - If still not found: log an error, fall back to a known-safe `y=30` so the game still loads.
   - `console.info('[Phase Shifter] Spawned at', pos.toArray())`.
3. (Optional but recommended) Initialize the camera at the same position via `physicsManager.getPos()` instead of `camera.position.set(0, 20, 0)` — keeps the init code DRY and uses the constant from Phase 1.2.

## Files to touch

- `main.js` (init function — replace lines 97-102)
- `src/core/world.js` (new raycast helper) — **or** add the helper inline in main.js for now and port to World later

## How to verify

```bash
node --check main.js && npm run build
node tests/headless/test-phase12.cjs          # Phase 1.2 tests still pass
sudo -E -n node tests/headless/smoke.cjs      # smoke test still green
```

Extend `test-phase12.cjs` (or add a new `test-phase13.cjs`) with:
- Source-level static-analysis: the literal `setPosition(0, 20, 0)` should be GONE from main.js (was the Phase 1.2 baseline).
- Source-level static-analysis: a downward raycast helper is present in main.js (or World).
- Source-level static-analysis: `console.info('[Phase Shifter] Spawned at'` log is wired.

Extend `smoke.cjs` to include those same static-analysis checks so the Phase 1.3 acceptance is checked in CI.

End-to-end browser verification (player spawns visibly on a solid surface, not inside it) is the user's responsibility.

## Reference files

- `main.js` — see lines 90-110 for the current init flow; lines 380-410 for the gameLoop with the Phase 1.2 follow code (don't break this).
- `src/core/world.js` — see `getBlock(x, y, z)` for chunk/block lookup.
- `src/core/physics.js` — see `setPosition(x, y, z)`, `PLAYER_HEIGHT = 1.7`.
- `src/core/constants.js` — see `CHUNK_SIZE`, `CHUNK_HEIGHT`, `BLOCK_AIR`, `BLOCK_PROPERTIES` (for solid check).
- `PROJECT_REMEDIATION_PLAN.md` §1.3 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context.

## Common pitfalls

- **Don't forget the eye-height offset.** After `physicsManager.setPosition(...)` is called, the Phase 1.2 follow code copies that to the camera and adds `EYE_HEIGHT = 1.6`. So the camera automatically sits at the right height — no need to manually set `camera.position` separately anymore (you can delete the `camera.position.set(0, 20, 0)` line).
- **The raycast must wait for chunks to load.** If you call `getBlock` before `updateChunks` finishes, you get air everywhere. The init function already calls `world.updateChunks(0, 0)` — that should be sufficient. If you fall back to 5×5, call `world.updateChunks(0, 0)` again with a larger radius if the API supports it (check `World.updateChunks` signature).
- **`null` propagation.** If the raycast returns `null` in both 3×3 and 5×5 areas, the fallback `setPosition(0, 30, 0)` is logged as an error — don't silently swallow it.
- **Solid-block check.** Use `BLOCK_PROPERTIES[id]?.solid` or compare to `BLOCK_AIR`. Don't hard-code block IDs.
- **Don't break Phase 1.2.** The camera-follow + quaternion-derived movement basis must keep working. Run `tests/headless/test-phase12.cjs` after the change.

## Commit & push

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 1.3: safe spawn via downward raycast"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 1.3 → ✅ Done), update `HANDOFF.md` for Phase 1.4 hand-off, and create `PHASE_1_4_BRIEF.md` following the same template.
