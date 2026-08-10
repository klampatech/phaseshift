# Phase 3.3 — Starting Brief

> **Session goal:** Implement Phase 3.3 — Echoes — turn Ruins-biome floating crystals into collectible lore objects with an inventory counter and HUD label.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §3.3.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 3.2 closure (`Stabilizers + Phase Collapse state machine`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–3.2 shipped the core mechanics, per-biome visuals, audio cues, and Stabilizer checkpoints. But the §3.3 plan ("Echoes — Ruins collectibles with lore strings + counter in HUD") is the first session-sized piece of the "give the player a reason to explore" arc. The plan's acceptance is:

> **Acceptance (from plan §3.3):** entering a Ruins biome produces floating crystals. Walking close to one collects it and the inventory shows the lore.

The codebase has scaffolding already in place:

1. **`BLOCK_ECHO = 16`** in `src/core/constants.js` — a placeholder block id reserved for echoes. The block is placeable but inert.
2. **`BIOME_RUINS`** / **`BIOME_SKY_RUINS`** constants — already in `src/gen/terrain.js`, with biome-preference tables.
3. **`#echo-counter` / `#lore-toast`** placeholders are *not* yet in `index.html` — the §3.3 work adds them.
4. **`World` chunk generator** — the existing `terrain.js` populates the world with biome-driven features. The §3.3 work adds an Echo feature to the Ruins/Sky Ruins biome generator.
5. **Save/load infrastructure** — `World.exportGlobalState` / `World.importGlobalState` / `SaveSystem` already round-trip player edits. The §3.3 work extends the save blob to include the collected echo set.

What's missing for §3.3:

- A pure helper module `src/collect/echo.js` that:
  - Computes the Echo spawn pattern (deterministic per-chunk position + Y, deterministic lore string from a seeded RNG, deterministic floating animation phase).
  - Exports the canonical `ECHO_PICKUP_RADIUS` (1.5 — the §3.3 "walking within 2 blocks" spec).
  - Exports the canonical `ECHO_LORE_LIBRARY` (a small array of lore strings the §3.3 brief calls out: "I dreamed of a city made of mirrors.", "The Nexus hums tonight.", etc).
  - Computes `pickupResult(playerPos, echoList)` — returns the nearest Echo within the pickup radius, or `null`.
- A new pure module `src/inventory/inventory.js` that:
  - Owns the per-player inventory state: `{ collectedEchoes: Map<string, lore>, amplifiers: Set<string>, ... }`.
  - Exposes `addEcho(state, key, lore)` (idempotent — re-collecting is a no-op), `removeEcho`, `hasEcho`, `listEchoes`, `addAmplifier`, `hasAmplifier`, `serialize`, `deserialize`.
- A new Echo overlay (similar pattern to the Anchor/Checkpoint overlays):
  - `EchoOverlay` class in `src/render/renderer.js`.
  - One floating crystal mesh (low-poly diamond, slowly rotating + bobbing) per Echo in the world.
  - Per-biome color (warm gold for Ruins, pale blue for Sky Ruins, deep purple for Phase Nexus).
  - `showEcho(x, y, z, key, color)` / `updateEchoes(dt, snapshot)` / `clearEcho(key)` / `clearEchoes()`.
- A per-frame Echo pickup tick in `main.js`:
  - Reads `playerPos` each frame, walks the world's Echo list, checks `pickupResult`.
  - On pickup: `inventory.addEcho(state, loreKey)`, `world.collectEcho(key)`, `renderer.clearEcho(key)`, `notify(loreText)`, increment the HUD counter.
- A new HUD element `#echo-counter` (right side of the screen, "ECHOES: X / Y") and `#lore-toast` (transient 5-second lore display on pickup).
- A new debug hook `__phaseShifter__.forceSpawnEcho(x, y, z, lore?)` (so the Playwright test can verify pickup without depending on biome RNG).
- A new debug hook `__phaseShifter__.getInventory()` / `__phaseShifter__.listEchoes()`.
- The §3.3 acceptance math: walking within `ECHO_PICKUP_RADIUS = 1.5` blocks of an Echo collects it (one-shot per Echo), the inventory grows, the lore string shows, the HUD counter ticks up.

## Acceptance (from plan §3.3)

1. **Entering a Ruins biome produces floating crystals.** Echo meshes float at chest height above the Ruins terrain, gently rotating + bobbing. The mesh color matches the biome (warm gold for Ruins, pale blue for Sky Ruins).
2. **Walking close to one collects it.** Player within `ECHO_PICKUP_RADIUS = 1.5` blocks → on next frame, the Echo is removed from the world map + added to the inventory + a "lore toast" appears.
3. **The inventory shows the lore.** The `#lore-toast` displays the Echo's lore string for 5 seconds. Subsequent pickups update the toast.
4. **An Echo counter in the HUD shows "X / Y".** `#echo-counter` shows `ECHOES: 1 / 8` (or whatever the spawn total is). Updates on every pickup edge.
5. **Echoes are deterministic.** A given world seed produces the same Echo positions + lore strings across reloads. The RNG is the same per-chunk `chunkHash(...)` used for terrain features.
6. **Echoes are one-shot.** Re-entering a chunk after collecting an Echo doesn't respawn it. The `world._collectedEchoes` set survives save/load.
7. **Save/restore persists the inventory.** `World.exportGlobalState()` + `World.importGlobalState()` include the collected echo set + the spawn list. The §3.3 work verifies the round-trip.
8. **No regression locks.** Phase 3.2's Stabilizer + collapse state machine stays intact (Echoes don't interfere with respawn). Phase 3.1's biome tick stays intact (Echoes don't trigger a biome transition).

## Fix shape

1. **`src/collect/echo.js`** (new — pure module). Exports:
   - `ECHO_PICKUP_RADIUS = 1.5`.
   - `ECHO_LORE_LIBRARY` (frozen array of 12 lore strings).
   - `echoLoreForKey(key)` — returns the lore string for a given echo key (deterministic).
   - `pickupResult(playerPos, echoList, radius)` — returns the nearest echo within radius, or `null`.
   - `echoKey(x, y, z)` — canonical `"x,y,z"` string.
   - `floatingOffset(t, phase)` — returns `{ y, rotY }` for the floating animation.

2. **`src/inventory/inventory.js`** (new — pure module). Exports:
   - `createInventory()` — returns `{ collectedEchoes: new Map(), amplifiers: new Set() }`.
   - `addEcho(inv, key, lore)` — idempotent.
   - `hasEcho(inv, key)`, `listEchoes(inv)`, `removeEcho(inv, key)`.
   - `addAmplifier(inv, name)`, `hasAmplifier(inv, name)`.
   - `serialize(inv)`, `deserialize(snapshot)`.

3. **`src/render/renderer.js`** (extend). Add `EchoOverlay` class:
   - Separate `THREE.Group` named `echoOverlay` (independent of chunk-mesh, Phase Lens, Resonance, Anchor, Checkpoint, Collapse groups).
   - Per-Echo: a low-poly octahedron mesh (`OctahedronGeometry(0.25, 0)`) tinted by biome.
   - Methods: `showEcho(x, y, z, key, color)`, `updateEchoes(dt, snapshot)` (drives the bob + rotate animation), `clearEcho(key)`, `clearEchoes()`.

4. **`src/world/world.js`** (extend). Add Echo infrastructure:
   - `this._echoPositions` map (key → `{ x, y, z, loreKey, biomeId }`).
   - `World.spawnEcho(x, y, z, loreKey, biomeId)`, `World.collectEcho(key)`, `World.listEchoes()`.

5. **`main.js`** (extend). Per-frame Echo pickup tick:
   - After the existing biome tick, walk `world.listEchoes()` against the player's position.
   - For each uncollected Echo within `ECHO_PICKUP_RADIUS`, call `inventory.addEcho`, `world.collectEcho`, `renderer.clearEcho`, `notify(loreText)`, update the HUD counter.
   - Drive `renderer.updateEchoes(dt, world.listEchoes())` for the floating animation.

6. **`src/ui/hud.js`** (extend). Constructor queries `#echo-counter` + `#lore-toast`. New method `setEchoCounter(collected, total)` + `showLoreToast(text)`.

7. **`index.html`** (extend). Add `#echo-counter` + `#lore-toast` elements with CSS.

8. **`src/save/system.js`** (extend). Save/load round-trip for the inventory.

9. **`tests/headless/test-phase33.cjs`** (new) — at least 30 checks.
10. **`tests/headless/smoke.cjs`** — add Phase 3.3 static-analysis block.
11. **`tests/gameplay.spec.js`** — 1 new Playwright test.

## Files to touch

- `src/collect/echo.js` (new).
- `src/inventory/inventory.js` (new).
- `src/render/renderer.js` (EchoOverlay class).
- `src/core/world.js` (Echo spawn + collect API).
- `src/core/constants.js` (ECHO_PICKUP_RADIUS, BLOCK_ECHO, ECHO_LORE_LIBRARY).
- `src/ui/hud.js` (echo counter + lore toast).
- `main.js` (per-frame Echo pickup tick + debug hooks).
- `index.html` (#echo-counter + #lore-toast elements).
- `src/save/system.js` (inventory round-trip).
- `tests/headless/test-phase33.cjs` (new).
- `tests/headless/smoke.cjs` (extend with Phase 3.3).
- `tests/gameplay.spec.js` (1 new Phase 3.3 test).
- `HANDOFF.md` (Phase 3.3 closure).
- `PROJECT_REMEDIATION_PLAN.md` (Phase 3.3 row ✅ Done).
- `PHASE_3_4_BRIEF.md` (Resonance Cores — Crystal Caverns unlocks).

## How to verify

```bash
node --check main.js
node --check src/collect/echo.js
node --check src/inventory/inventory.js
node --check src/render/renderer.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
... all earlier phase tests still pass ...
node tests/headless/test-phase32.cjs   # 101/101 still pass
node tests/headless/test-phase33.cjs   # new — Phase 3.3
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

## Common pitfalls

- **Echoes are deterministic per chunk seed.** The same `worldSeed` produces the same Echo positions + lore strings across reloads. The RNG uses the chunk hash, not the wall clock.
- **The pickup is one-shot per Echo.** Re-entering a chunk doesn't respawn a collected Echo; the `_echoPositions` map removes the key on pickup.
- **The lore toast is a transient overlay.** It shows for 5 seconds, then fades. Multiple rapid pickups update the toast (cancel the prior fade timer, show the new lore).
- **The Echo counter survives save/load.** The save blob includes `{ collectedEchoes, amplifiers }` so reloading the game restores the inventory.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 3.2 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 3.2 row ✅ Done; Phase 3.3 row ✅ Done when it ships.
- `PHASE_3_4_BRIEF.md` (Resonance Cores — Crystal Caverns unlocks with amplifier cost reduction) will be created at the start of the next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
git add -A
git commit -m "Phase 3.3: echoes - collectible lore objects + HUD counter + lore toast"
TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```
