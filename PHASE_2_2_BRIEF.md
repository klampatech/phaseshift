# Phase 2.2 — Starting Brief

> **Session goal:** Implement Phase 2.2 — Phase-relative collision.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.2.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 2.1 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

`BLOCK_PROPERTIES[*].phaseSolid` already exists in `src/core/constants.js`:

| Block | phaseSolid (Alpha/Beta/Gamma) |
|---|---|
| Stone | `[true, true, false]` |
| Wood | `[true, false, true]` |
| Grass | `[true, false, false]` |
| Dirt | `[true, false, false]` |
| Sand | `[true, false, false]` |
| Iron | `[true, true, false]` |
| Crystal | `[false, true, false]` |
| Obsidian | `[false, false, true]` |
| Rune | `[false, false, true]` |
| Stabilizer | `[true, true, true]` |
| Glass | `[true, true, true]` |
| Water | `[true, false, false]` |

But `src/core/physics.js` is reading only `BLOCK_PROPERTIES[block].solid` (a single boolean), not the per-phase array. The player currently collides with Stone in all three phases — which makes the §2.1 phase shift feel like a flag flip instead of a real transition. Worse, several later phases (§2.3 place/break, §2.5 scan, §2.7 anchor) write logic that *assumes* phase-relative collision is correct, so locking §2.2 down first prevents regressions downstream.

A second concern: the renderer currently uses `chunk.alphaData/betaData/gammaData` and may not be honoring `phaseSolid` either. Per-phase collision is only useful if the renderer agrees on what's visible in which phase.

## Acceptance (from plan §2.2)

1. Standing on a Stone block in Alpha, cycling to Beta: player stays standing (Stone is `phaseSolid: [true, true, false]`).
2. Standing on a Stone block in Beta, cycling to Gamma: player falls through (Stone is not solid in Gamma).
3. Standing on a Stone block in Gamma, cycling back to Alpha: player lands on the Stone block again.
4. The collision routine reads `BLOCK_PROPERTIES[block].phaseSolid[phase]` (with a `.solid` fallback for blocks that don't define `phaseSolid`).
5. A small set of regression tests covers Stone, Crystal, and Grass (one solid, one conditional, one Alpha-only).
6. (Implicit) `tests/headless/test-phase12.cjs` … `test-phase17.cjs`, plus the Playwright suite (33/33), still pass.

## Fix shape

1. **Phase-aware collision** (`src/core/physics.js`)
   - Replace every `props.solid` read in the collision routine with `props.phaseSolid[phase]` (defaulting to `props.solid` when `phaseSolid` is missing — this keeps Phase 1.5's BLOCK_AIR/BLOCK_GLASS/etc. behavior intact for blocks where the array exists but the per-phase solid is what we want).
   - Both the AABB collision pass and the "is the block below the player solid?" gravity check must read the array; otherwise the player will float in mid-air or sink through floors inconsistently.
2. **Renderer parity** (`src/render/renderer.js`)
   - Confirm `ChunkVisual` / `isSurrounded` already mesh-blends correctly when `phaseSolid[phase]` is false in the current phase. If it doesn't (block is rendered but passable), expose a debug helper that flags the mismatch — do **not** start hiding blocks here, that's §2.4 (phase memory).
3. **Unit test** (`tests/headless/test-phase22.cjs`)
   - Static: `physics.js` reads `phaseSolid[phase]` (regex check), the fallback to `.solid` exists, no `props.solid` reads remain inside collision routines.
   - Behavioral: a `PhysicsManager` fixture with a tiny world reports Stone as solid in Alpha + Beta and passable in Gamma; Crystal as solid only in Beta; Grass as solid only in Alpha. The fixture can be a minimal `World` subclass with `getBlock` returning known ids per coordinate — no Three.js needed.
4. **Extend `tests/headless/smoke.cjs`** with the same Phase 2.2 static-analysis block.
5. **Optional Playwright check** (`tests/gameplay.spec.js`)
   - Place the player on a Stone block (in Alpha), call `forceCyclePhase` to Beta, assert `physicsManager.isGrounded` is still true; cycle to Gamma, assert `isGrounded` flips to false. Only safe to assert this if we control gravity timing — likely skip in headless smoke and rely on the behavioral test.

## Files to touch

- `src/core/physics.js` — read `phaseSolid[phase]` in collision + ground checks.
- `src/core/world.js` — possibly add a `isBlockSolid(x, y, z, phase)` convenience wrapper (so physics doesn't need to reach into `BLOCK_PROPERTIES` itself).
- `src/core/constants.js` — no change (the array is already correct).
- `src/render/renderer.js` — sanity-check that `ChunkVisual` mesh-blends with phase-relative solidity (no code change if it already does).
- `tests/headless/test-phase22.cjs` — new.
- `tests/headless/smoke.cjs` — extend.
- `tests/gameplay.spec.js` — optional collision regression test.

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
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (player visibly falls through Stone when the phase cycles to Gamma) is the user's responsibility.

## Reference files

- `src/core/physics.js` — `PhysicsManager` collision + ground-check routines.
- `src/core/constants.js` — `BLOCK_PROPERTIES` with `phaseSolid` arrays (already correct per the table above).
- `src/core/world.js` — `getBlock(x, y, z, phase)` returns the block id at that coordinate in the given phase (used by the collision routine).
- `src/render/renderer.js` — `ChunkVisual` mesh-blends; sanity check that phase-relative solidity aligns with the renderer.
- `PROJECT_REMEDIATION_PLAN.md` §2.2 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context.

## Common pitfalls

- **The collision routine reads `props.solid` and `props.phaseSolid[phase]` in different branches.** Make sure the new read replaces every occurrence, not just the obvious one. A search for `\.solid\b` across `src/core/physics.js` is the right starting point.
- **`BLOCK_AIR` has `phaseSolid: [false, false, false]`**, so the fallback `props.solid` (false) is identical — no regression there. But `BLOCK_GLASS` has `phaseSolid: [true, true, true]` AND `solid: true`, so the fallback works for it too. The risk is a block where the array disagrees with the scalar (there shouldn't be any, but worth a regression test on Stone).
- **The `phase` passed to collision is the player's current phase**, not the target phase — even while `_isShifting` is true. A shift in flight should not change collision mid-air.
- **Static-analysis regex will break if Vite minifies.** Source-level checks against `src/core/physics.js` (NOT the dist bundle) are robust — same approach as Phases 1.2–2.1.
- **Don't break the `__phaseShifter__.forceCyclePhase` debug hook.** Phase 2.1's Playwright tests rely on it. Any change to `physics.js` must keep `forceCyclePhase` + `completeShift` working.
- **The renderer doesn't need a `phaseSolid` filter** for Phase 2.2 — only the physics does. The renderer's job is to show what's visible in the current phase (`BLOCK_PROPERTIES[block].phase.includes(currentPhase)`), which is independent of `phaseSolid`.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.1 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table marks Phase 2.1 ✅ Done (already in this commit).
- Phase 1.6 brief (`PHASE_1_6_BRIEF.md`) remains in the repo for history; remove or archive it when Phase 2 lands.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.2: phase-relative collision (physics reads phaseSolid[phase])"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.2 → ✅ Done), update `HANDOFF.md` for Phase 2.3 hand-off, and create `PHASE_2_3_BRIEF.md` following the same template.
