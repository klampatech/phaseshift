# Phase 2.7 — Starting Brief

> **Session goal:** Implement Phase 2.7 — Phase Anchor (Shift+LMB) — the player presses Shift+LMB on a block to *lock* the phase under them, holding them in place through a phase shift.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.7.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 2.6 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 2.1–2.6 shipped phase shift, phase-relative collision, per-phase place/break, save/reload memory, the Phase Lens, and Resonance. The §2.7 acceptance from the plan is the Phase Anchor mechanic — the player presses Shift+LMB on a block to *lock* the phase under them, holding them in place through a phase shift. The plan says:

> **Acceptance (from plan §2.7):** Shift+LMB on a block shows a glowing outline. Standing on it through a phase shift keeps you on the block. After 10 seconds the outline disappears.

The codebase has *scaffolding*:

1. `main.js#placeAnchor` is a stub (from Phase 2.3) that emits an "Anchor placement pending §2.7" notification. The previous body would write a stray `BLOCK_STABILIZER` (id 15) at the targeted face — that's pollution, not a Phase 2.7 concern.
2. The orphan `src/core/phaseLockManager.js` is the *reference* `lockManager` implementation: a class that holds a Map of locked blocks (key = `${x},${y},${z},${phase}`), a `THREE.Group` of fill + edge meshes (yellow glow), a 10-second lifetime, and a per-frame fade-out for the last 3 seconds. It exposes `createLock`, `removeLock`, `update(dt)`, `isLocked(x, y, z, phase)`, `clearAll`, `getActiveLockKeys`, and `count`.
3. The active `World` already has `findNearestStabilizer(x, y, z, maxSearchRadius)` + `_stabilizerPositions` tracking — but that's for the `BLOCK_STABILIZER` (id 15) checkpoints that restore energy on respawn, not the §2.7 anchor. The §2.7 anchor is a *separate* concept: it's the player-placed lock that holds the player in place through a phase shift.

The §2.7 work is a port + refactor (mirroring Phase 2.5 + 2.6):

- Centralize the anchor logic on a new `src/anchor/anchor.js` pure module (radius, lifetime, color, place/tick helpers).
- Add a `World.createAnchor / removeAnchor / tickAnchors / findAnchorUnderPlayer` API.
- Add an `AnchorOverlay` class to the renderer (mirroring the `ScanOverlay` pattern) so the wireframes live in their own `THREE.Group` and are disposed cleanly.
- Replace `main.js#placeAnchor` with a real implementation: raycast the targeted block, place the anchor one cell above the targeted face (same convention as `placeBlockAtTarget`), debounce re-presses on the same cell (refresh the lifetime), and emit "Anchor placed" / "Anchor removed" / "Anchor refreshed" notifications.
- Add the "standing on it through a phase shift keeps you on the block" behavior: in `onPhaseChanged`, after the cycle completes, check if the player's feet are inside an anchor cell. If so, re-snap the player's Y so they stay standing on the anchor block (the anchor is collision-solid in ALL phases for the duration of the lock).
- Wire the §2.7 acceptance math (10s lifetime, free to place).
- Cover the new behavior with unit tests + Playwright regression tests.

## Acceptance (from plan §2.7)

1. **Shift+LMB on a block.** A yellow glowing outline appears at the targeted block (one cell above the targeted face, like `placeBlockAtTarget`). The outline is a 1.02-cube BoxGeometry with a translucent yellow fill + bright yellow edge border.
2. **Shift+LMB again on the same cell.** The lifetime is refreshed (the §2.7 spec: "After 10 seconds the outline disappears"; re-pressing extends the lock). The notification says "Anchor refreshed".
3. **Shift+LMB on a different cell.** A new anchor is placed; the previous one is untouched.
4. **Shift+LMB in open air (no hit).** The notification says "No block in range" and no anchor is placed.
5. **Shift+LMB on a block that is not visible/solid in the current phase.** The notification says "Block not solid in current phase" and no anchor is placed.
6. **Phase shift while standing on an anchor.** The player stays on the block. The `onPhaseChanged` handler checks for an active anchor under the player's feet and re-snaps the player Y so gravity doesn't pull them through. (This is the §2.7 acceptance.)
7. **10 seconds elapse.** The anchor outline disappears (the lifetime expires). The `World.tickAnchors(dt)` removes the anchor; the `AnchorOverlay` removes the wireframe.
8. **Anchor is free to place (0 energy cost).** Unlike the Phase Lens (drain) and the Resonance (15-energy one-shot), the anchor costs no energy.
9. **Anchor survives save/reload.** The `_anchors` map is part of the `World` state and is round-tripped through `SaveSystem` (Phase 2.7 extends the §1.7 save snapshot with the anchor list — see `Files to touch` for the save blob contract).
10. **The anchor overlay is in its own `THREE.Group`.** The chunk-mesh group, the Phase Lens overlay, and the Resonance pulse group are untouched. (Mirror of the §2.5 / §2.6 anti-pattern — don't reuse a shared group.)
11. **The anchor wireframe pulse-fades in the last 3 seconds.** Mirror of the orphan `PhaseLockManager` — the orphan pulses opacity `0.2 + 0.3 * sin(...)` over the last 3 seconds before expiry. Pure helper in `src/anchor/anchor.js#anchorFadeOpacity(remainingSeconds)`.

## Fix shape

1. **`src/anchor/anchor.js`** (new) — pure module. Exports:
   - `anchorLifetime()` — returns 10 (seconds; the plan's "10 seconds" acceptance).
   - `anchorFadeWindow()` — returns 3 (seconds; the orphan's "last 3 seconds" pulse fade).
   - `anchorFillColor()` — returns `0xffee88` (the orphan's `LOCKED_BLOCK_COLOR`).
   - `anchorBorderColor()` — returns `0xffcc00` (the orphan's `LOCKED_BLOCK_BORDER`).
   - `anchorFadeOpacity(remainingSeconds)` — the per-frame opacity multiplier: when `remaining <= 3s`, returns `0.2 + 0.3 * sin((3 - remaining) * 2π)`; otherwise returns 0.4 (the orphan's default fill opacity).
   - `anchorKey(x, y, z, phase)` — the canonical `${x},${y},${z},${phase}` string. Same convention as the orphan + `World._globalKey`.
   - `placeAnchorAt(playerX, playerY, playerZ, hit, currentPhase, world)` — pure helper that mirrors `placeBlockAtTarget`: rejects `no-hit`, `target-not-air` (the target must be a solid block, not air), `overlaps-player`; returns `{ ok, x, y, z, phase, reason }`. The anchor is placed at the cell above the targeted face (same convention as `placeBlockAtTarget`).
   - `tickAnchors(anchors, dt)` — pure function that walks the `anchors` map, decrements `remaining` on each, and returns the list of expired keys. Used by `World.tickAnchors(dt)`.
   - `isAnchorExpired(anchor, dt)` — defensive helper for unit tests.

2. **`src/core/world.js`** (extend `World`):
   - `this._anchors = new Map()` — `key → { x, y, z, phase, remaining }` (added in the constructor).
   - `World.createAnchor(x, y, z, phase)` — adds the anchor. Idempotent: if the key already exists, the remaining lifetime is refreshed (the §2.7 spec). Returns `{ ok: true, refreshed: boolean }` or `{ ok: false, reason }`.
   - `World.removeAnchor(x, y, z, phase)` — removes the anchor. Returns `{ ok, removed: boolean }`.
   - `World.getAnchors()` — returns a snapshot `Array<{ x, y, z, phase, remaining }>` for the renderer + save system.
   - `World.tickAnchors(dt)` — walks the map, decrements `remaining`, removes expired ones. Returns `Array<key>` of removed anchors so the renderer can clear the wireframe.
   - `World.findAnchorUnderPlayer(playerX, playerY, playerZ)` — returns the first anchor whose cell is at `floor(playerX)`, `floor(playerY) - 1`, `floor(playerZ)` (the cell directly under the player's feet). Used by the §2.7 "standing on it through a phase shift" logic.
   - `World.isAnchorActive(x, y, z, phase)` — boolean check. Used by the physics to make the anchor collision-solid in all phases (the §2.7 contract).
   - `World.exportAnchors()` / `World.importAnchors(snapshot)` — save/load round-trip. Same contract as `exportGlobalState` / `importGlobalState` (Phase 1.7).
   - `exportGlobalState` + `importGlobalState` — the existing §1.7 / §2.4 contract is unchanged (anchors live in their own map, not the global block state). The anchor list is part of the `World` snapshot but is exported/imported through the dedicated `exportAnchors` / `importAnchors` API.

3. **`src/core/constants.js`** — add `ANCHOR_LIFETIME = 10`, `ANCHOR_FADE_WINDOW = 3`, `ANCHOR_FILL_COLOR = 0xffee88`, `ANCHOR_BORDER_COLOR = 0xffcc00`, `ANCHOR_COST = 0`.

4. **`src/render/renderer.js`** (add `AnchorOverlay`):
   - `showAnchor(anchor)` — adds a wireframe + fill mesh at the anchor's cell. Mirrors the orphan's `createLock` (BoxGeometry 1.02 + EdgesGeometry + bright fill / edge). The fill opacity is set via `anchorFadeOpacity(remaining)`. The fill material is shared per-overlay (not per-anchor) to keep allocations down — actually, the orphan uses per-anchor materials so the pulse fade can be applied per-anchor. Mirroring that: one fill + one edge material per anchor.
   - `updateAnchors(snapshot, removedKeys)` — applies the per-frame fade to each anchor's fill material, then removes any wireframes whose key is in `removedKeys`. Called from the game loop after `World.tickAnchors`.
   - `clearAnchors()` — clears all anchor wireframes (for cleanup / scene reload).
   - `getAnchorCount()` — number of wireframes currently in the overlay group. Used by the Playwright test.
   - `getAnchorKeys()` — the list of keys currently visible. Used by tests.
   - The `Renderer` class adds thin wrappers (`showAnchor`, `updateAnchors`, `clearAnchors`) so `main.js` has a single dispatcher API (mirroring `showResonancePulse` / `updateResonancePulse`).

5. **`main.js`**:
   - `placeAnchor()` is rewritten to:
     1. raycast via `raycastBlock(physicsManager.getPos(), getCameraDirection())`;
     2. if no hit → `hud.showNotification('No block in range', '#ff6644')` and early return;
     3. if the targeted block isn't visible/solid in the current phase → `hud.showNotification('Block not solid in current phase', '#ff6644')` and early return;
     4. call `placeAnchorAt(...)` from `src/anchor/anchor.js` to compute the anchor cell;
     5. if the helper refuses (`overlaps-player`, etc.) → notification with the reason and early return;
     6. call `world.createAnchor(x, y, z, currentPhase)` — idempotent (re-pressing on the same cell refreshes the lifetime). The return value tells us whether it was a fresh place or a refresh.
     7. call `renderer.showAnchor(...)` to draw the wireframe;
     8. notification: "Anchor placed" (fresh) or "Anchor refreshed" (refresh).
   - The per-frame game loop calls `world.tickAnchors(deltaTime)` and forwards the result to `renderer.updateAnchors(snapshot, removedKeys)`. (Mirrors the Resonance pulse per-frame loop.)
   - `onPhaseChanged` is extended: after the cycle completes, check `world.findAnchorUnderPlayer(physicsManager.getPos().x, physicsManager.getPos().y, physicsManager.getPos().z)`. If found, snap the player's Y to `anchor.y + 1 + PLAYER_HEIGHT` so they stay on the block.
   - Debug hooks: `__phaseShifter__.forcePlaceAnchor(x, y, z)` (returns `{ ok, refreshed, x, y, z, phase, count, meshCount }`), `getAnchorCount()`, `getAnchorKeys()`, `clearAnchors()`, `isAnchorAt(x, y, z, phase)`.

6. **`src/save/system.js`** — `saveSnapshot(x, y, z, phase, worldState, anchors)` takes the new anchor list. The save blob shape is `{ player, worldState, anchors }` (extends the §1.7 / §2.4 contract). `_coerceAnchors` rejects non-finite / non-integer / out-of-range ids so a tampered save can't poison the anchor list. The legacy §1.7 / §2.4 save blob (without `anchors`) is still loadable — missing `anchors` defaults to an empty array.

7. **`tests/headless/test-phase27.cjs`** (new) — at least 12 tests:
   - Static: `src/anchor/anchor.js` exports the helpers; `ANCHOR_LIFETIME` / `ANCHOR_FADE_WINDOW` / `ANCHOR_FILL_COLOR` / `ANCHOR_BORDER_COLOR` are defined; `World.createAnchor` / `World.removeAnchor` / `World.tickAnchors` / `World.findAnchorUnderPlayer` are defined; `AnchorOverlay` class is defined; main.js#placeAnchor delegates to `placeAnchorAt`; onPhaseChanged calls `findAnchorUnderPlayer`; debug hooks are present.
   - Behavior: `anchorLifetime` returns 10; `anchorFadeOpacity` returns 0.4 outside the fade window, oscillating in the last 3s; `tickAnchors` decrements and returns expired keys; `createAnchor` is idempotent (re-pressing refreshes); `findAnchorUnderPlayer` finds the cell under the player's feet; `placeAnchorAt` rejects no-hit / target-not-air / player-overlap; the §2.7 energy math (anchor is free, no energy debit).

8. **`tests/headless/smoke.cjs`** — add Phase 2.7 static-analysis block (10–12 checks). Process-exit gate now also requires Phase 2.7 to pass.

9. **`tests/gameplay.spec.js`** — 1 new Playwright test: `forcePlaceAnchor(x, y, z)` adds an anchor + a wireframe, `getAnchorCount` returns 1 + the mesh count matches, `findAnchorUnderPlayer` returns the anchor when the player is standing on it, a tick of `tickAnchors(11)` removes it, the wireframe mesh count goes to 0.

## Files to touch

- `src/anchor/anchor.js` — new (pure module).
- `src/core/world.js` — add `_anchors` map, `createAnchor`, `removeAnchor`, `getAnchors`, `tickAnchors`, `findAnchorUnderPlayer`, `isAnchorActive`, `exportAnchors`, `importAnchors`.
- `src/core/constants.js` — add `ANCHOR_LIFETIME`, `ANCHOR_FADE_WINDOW`, `ANCHOR_FILL_COLOR`, `ANCHOR_BORDER_COLOR`, `ANCHOR_COST`.
- `src/render/renderer.js` — add `AnchorOverlay` class + thin Renderer wrappers.
- `src/save/system.js` — extend `saveSnapshot` / `loadSnapshot` with the anchor list; add `_coerceAnchors`; back-compat for legacy blobs.
- `main.js` — rewrite `placeAnchor`; add per-frame `tickAnchors` loop; extend `onPhaseChanged` with snap-to-anchor; add debug hooks; call `saveSystem.saveSnapshot(..., world.exportAnchors())` in `saveGame`.
- `tests/headless/test-phase27.cjs` — new.
- `tests/headless/smoke.cjs` — Phase 2.7 static-analysis block + exit gate.
- `tests/headless/test-phase16.cjs` — extend the §1.6 / §1.7 save round-trip test to include the anchor list (one extra test: a save with anchors → load → the anchors are restored).
- `tests/gameplay.spec.js` — 1 new Phase 2.7 test.
- `HANDOFF.md` — Phase 2.7 closure.
- `PROJECT_REMEDIATION_PLAN.md` — Phase 2.7 row ✅ Done.

## How to verify

```bash
node --check main.js
node --check src/anchor/anchor.js
node --check src/render/renderer.js
node --check src/save/system.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
node tests/headless/test-phase13.cjs   # 7/7 still pass
node tests/headless/test-phase14.cjs   # 22/22 still pass
node tests/headless/test-phase15.cjs   # 12/12 still pass
node tests/headless/test-phase16.cjs   # 21/21 still pass (extended for anchor)
node tests/headless/test-phase17.cjs   # 26/26 still pass
node tests/headless/test-phase22.cjs   # 35/35 still pass
node tests/headless/test-phase23.cjs   # 50/50 still pass
node tests/headless/test-phase24.cjs   # 46/46 still pass
node tests/headless/test-phase25.cjs   # 70/70 still pass
node tests/headless/test-phase26.cjs   # 71/71 still pass
node tests/headless/test-phase27.cjs   # new — Phase 2.7
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (Shift+LMB on a block, see the glowing outline, phase-shift while standing on it, walk off after 10s) is the user's responsibility. WebGL fails in the sandbox; the headless tests cover the math + API surface.

## Reference files

- `src/core/phaseLockManager.js` (orphan, do NOT import) — `PhaseLockManager` is the reference implementation. Port the algorithm + rendering pattern; do not import the module. The orphan's known `ppos` bug is irrelevant here (different module).
- `src/render/renderer.js` — `ScanOverlay` (Phase 2.5) and `ResonancePulse` (Phase 2.6) are the model for the new `AnchorOverlay`. The overlay lives in its own `THREE.Group` (the brief's "must NOT share a group" pitfall).
- `src/core/world.js` — `resonateWithReport` (Phase 2.6) is the model for the new `createAnchor` / `tickAnchors` API. The world is the single source of truth; the renderer reads through `World.getAnchors()`.
- `src/input/placeBlock.js` (Phase 2.3) — `placeBlock` is the model for the new `placeAnchorAt` pure helper. Same shape: reject `no-hit`, `target-not-air`, `overlaps-player`. Same return shape: `{ ok, x, y, z, phase, reason }`.
- `src/resonance/resonate.js` (Phase 2.6) — the pure-module pattern (no Three.js, no globals) is the model for the new `src/anchor/anchor.js`.
- `main.js` — `performResonance` (Phase 2.6) is the model for the rewritten `placeAnchor` (insufficient-energy branch, one-shot per press, debug hook).
- `PHASE_2_6_BRIEF.md` — the previous brief. The §2.6 contract (no direct chunk reads in the per-frame loop) extends naturally to anchors: the renderer reads through `World.getAnchors()`.

## Common pitfalls

- **Don't import the orphan `src/core/phaseLockManager.js`.** The plan says to *port* features from it, not to import it. The reference implementation is a class with a `THREE.Group` and a `Map`; the active path is a pure module + a `World` API + an `AnchorOverlay`. Build the new code from scratch against the active `World` + `Renderer` API.
- **Don't reuse the Phase Lens overlay group or the Resonance pulse group for the anchor.** The brief is explicit: the anchor lives in its own `AnchorOverlay` `THREE.Group`. The three overlays are independent — clearing the lens does not affect the anchor; clearing the pulse does not affect the anchor; clearing the anchor does not affect the lens or the pulse.
- **The anchor is free to place (0 energy cost).** Unlike the Phase Lens (0.5/sec drain) and the Resonance (15-energy one-shot), the anchor has no energy cost. The §2.7 spec is "After 10 seconds the outline disappears" — no energy mention. The `World.createAnchor` does NOT call `phaseManager.consumeEnergy`. The debug hook `forcePlaceAnchor` does NOT debit energy.
- **The anchor is collision-solid in ALL phases.** The §2.7 contract: "Standing on it through a phase shift keeps you on the block." Even if the underlying block is passable in the new phase (e.g. Stone in Gamma), the anchor keeps the player on top. The `onPhaseChanged` snap-to-anchor logic re-snaps the player's Y to `anchor.y + 1 + PLAYER_HEIGHT` so gravity doesn't pull them through. (The orphan's `isLocked` is also collision-solid in all phases — porting that contract is part of §2.7.)
- **The anchor survives a phase shift (lifetime doesn't tick down during the shift).** The `World.tickAnchors(dt)` is called per-frame in the game loop. During a phase shift, the game loop is still ticking (the shift is a 1.5s visual transition, not a pause). The anchor's `remaining` decrements normally.
- **The anchor survives a save/load round-trip.** The save blob is extended with the anchor list. The legacy §1.7 / §2.4 blob (no `anchors` key) loads with an empty anchor list.
- **Re-pressing Shift+LMB on the same cell refreshes the lifetime.** The `World.createAnchor` is idempotent: if the key already exists, the `remaining` is reset to `ANCHOR_LIFETIME`. The notification says "Anchor refreshed" instead of "Anchor placed".
- **The snap-to-anchor only fires when the player is *standing on* the anchor cell.** `World.findAnchorUnderPlayer(playerX, playerY, playerZ)` returns the anchor at the cell directly under the player's feet (`floor(playerY) - 1`). If the player is mid-jump or mid-fall, no snap fires. If the player is on top of a non-anchor block, no snap fires.
- **The `placeAnchorAt` helper returns the anchor position at the cell above the targeted face** (same convention as `placeBlockAtTarget` — the anchor is on the block the player is looking at, not the empty cell in front of it). The `hit.face` provides the normal; the anchor is at `hit.blockX + face.x`, `hit.blockY + face.y`, `hit.blockZ + face.z`.
- **The anchor is placed in the current phase** (same convention as `placeBlockAtTarget`). The `World.createAnchor` stores `phase` so the anchor is uniquely keyed per cell per phase. Two anchors at the same cell in two different phases are independent.
- **The orphan's `createLock` is called by `registerShift` (after a phase cycle).** The §2.7 spec is the *opposite*: the player presses Shift+LMB to place the lock, then stands on it through the cycle. The orphan's `registerShift` is the "auto-lock on shift" behavior — not part of §2.7. Port the per-frame update + the createLock + the rendering, NOT the registerShift trigger.
- **The orphan uses `Date.now()` for the expiry check.** That's wrong in a sandbox where the system clock may be unreliable. The new `World.tickAnchors(dt)` uses a per-frame `dt` accumulator instead. The `remaining` is the seconds until expiry.
- **The renderer per-frame update must dispose the wireframe geometry + materials when the anchor is removed.** Mirroring the `ResonancePulse.clearResonancePulse` pattern. The `AnchorOverlay.updateAnchors(snapshot, removedKeys)` removes any wireframes whose key is in `removedKeys` and disposes their geometry + materials.
- **Playwright can't verify the visual feedback** (no WebGL in the sandbox). The Playwright test should assert *non-visual* invariants: the anchor count, the wireframe mesh count, the lifetime math, the snap-to-anchor Y math. Don't assert colors or opacities.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.6 closure (already in the working tree at start of phase).
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 2.6 is already ✅ Done. Phase 2.7 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- `PHASE_2_8_BRIEF.md` (Audio integration) will be created at the start of the next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.7: phase anchor (Shift+LMB) — yellow-glow outline + 10s lock + snap-to-anchor on phase shift"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.7 → ✅ Done), update `HANDOFF.md` for Phase 2.8 hand-off, and create `PHASE_2_8_BRIEF.md` following the same template.
