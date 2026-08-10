# Phase 3.4 — Starting Brief

> **Session goal:** Implement Phase 3.4 — Resonance Cores — turn the `BLOCK_RESONANCE_CORE` block into a working amplifier system. Placing / finding a Resonance Core in a Crystal Cavern biome spawns a floating amplifier mesh; walking within `AMPLIFIER_PICKUP_RADIUS` (1.5) collects it and unlocks the matching amplifier (AB / BG / AG). The amplifier reduces the energy cost of the matching phase shift by `AMPLIFIER_SHIFT_REDUCTION` (1.5) per amplifier.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §3.4.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 3.3 closure (`63e83ad`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–3.3 shipped the core mechanics, the per-biome visual layer, audio cues, Phase Anchor, Phase Lens, Resonance pulse, Phase Collapse state machine, and Echoes (collectible lore). But the §3.4 plan ("Resonance Cores — Crystal Caverns unlocks with amplifier cost reduction") is the first session-sized piece of the "give the player a reason to explore the Crystal Caverns" arc. The acceptance is:

> **Acceptance (from plan §3.4):** collecting a Resonance Core lights up the corresponding amplifier in the inventory. Costs of phase shifts in that transition decrease.

The codebase has scaffolding already in place:

1. **`BLOCK_RESONANCE_CORE = 16`** in `src/core/constants.js` — the block type id (now exported; the previous version referenced it but never exported — a bug fixed in this session).
2. **`AMPLIFIER_AB` / `AMPLIFIER_BG` / `AMPLIFIER_AG`** in `src/core/constants.js` — the three amplifier names keyed by the transition they cover.
3. **`AMPLIFIER_SHIFT_REDUCTION = 1.5`** + **`AMPLIFIER_DRAIN_REDUCTION = 0.05`** — the per-amplifier cost reduction.
4. **`World._resonanceCores`** in `src/core/world.js` — the legacy block-id 16 tracking map (used by the pre-3.4 ambient-music volume code).
5. **`addAmplifier` / `hasAmplifier` / `amplifierCount`** in `src/inventory/inventory.js` — the inventory side of the §3.3 helpers, ready to be used by §3.4.
6. **`#amplifier-status` placeholder** — not yet in `index.html`; the §3.4 work adds it.
7. **`renderer.echoOverlay`** — the Phase 3.3 overlay (the §3.4 work adds a parallel `resonanceCoreOverlay` group).
8. **Save blob** — the §3.3 work extended the save blob to include `{ collectedEchoes, amplifiers }`; the §3.4 work verifies the round-trip preserves the amplifier set.

What's missing for §3.4:

- A pure helper module `src/collect/resonance.js` that:
  - Computes the per-Core pickup (Chebyshev/cubic radius via squared-distance compare, matches the §3.3 Echo / §3.2 Stabilizer pattern).
  - Exports the canonical `PICKUP_RADIUS = 1.5` (mirror of `ECHO_PICKUP_RADIUS`).
  - Exports `resonanceCoreKey(x, y, z)` (canonical `"x,y,z"`).
  - Exports `resonanceCoreColorForBiome(biomeId)` (Crystal Cavern → pale blue, Phase Nexus → green, Desert → amber).
  - Exports `pickAmplifierForKey(key)` (deterministic 1-of-3 amplifier pick from a hash of the key).
  - Exports `amplifierApplies(ampName, fromPhase, toPhase)` (checks if the amplifier covers the given transition).
  - Exports `pickupResult(playerPos, coreList, radius)` (returns the nearest uncollected Core within radius, or `null`).
  - Exports `floatingOffset(t, phase)` (bob + rotate animation, mirror of §3.3).
  - Exports `coreToWorldData(x, y, z, amplifier, biomeId)` (canonical Core shape).
  - Exports `isResonanceCoreBlock(blockId)` (the BLOCK_RESONANCE_CORE check).
- A new `ResonanceCoreOverlay` class in `src/render/renderer.js`:
  - A `THREE.Group` named `resonanceCoreOverlay` (independent of the chunk-mesh, Phase Lens, Resonance, Anchor, Checkpoint, Collapse, and Echo groups).
  - Per-Core: a slightly larger `OctahedronGeometry(0.32, 0)` (vs Echo's 0.25) tinted by biome + a faint `RingGeometry(0.4, 0.5, 16)` glow ring at the base.
  - Methods: `showResonanceCore(x, y, z, key, color, amplifier)` / `updateResonanceCores(dt, snapshot)` / `clearResonanceCore(key)` / `clearResonanceCores()`.
- A new per-frame `tickResonanceCoresPerFrame(dt)` in `main.js`:
  - Walks `world.listResonanceCores()` against the player's position.
  - On pickup: `world.collectResonanceCore(key)`, `inventory.addAmplifier(amp)`, `renderer.clearResonanceCore(key)`, `hud.setAmplifierStatus(...)`, `hud.showNotification("Amplifier AB unlocked - ...")` on the unlock edge.
  - Drives the floating animation via `renderer.updateResonanceCores(dt, snapshot)`.
- A new HUD element `#amplifier-status` in `index.html` (right side, just below `#echo-counter`): `AMPS: ● AB  ○ BG  ○ AG` (filled circle for unlocked, empty for locked).
- A new `setAmplifierStatus(unlocked)` method on `HUD` that updates the DOM (only writes on change edge, like the §3.3 echo counter).
- New debug hooks: `__phaseShifter__.forceSpawnResonanceCore(x, y, z, amplifier?, biomeId?)` / `forceCollectResonanceCore(key)` / `getResonanceCores()` / `getResonanceCoreCount()` / `getResonanceCoreKeys()` / `getResonanceCoreAmplifierAt(key)` / `isResonanceCoreAt(key)` / `getAmplifierStatusText()` / `getShiftCost(from, to)` (the effective energy cost after the amplifier discount) / `clearResonanceCores()` / `tickResonanceCoresPerFrame(dt)`.
- The §3.4 acceptance: walking within `AMPLIFIER_PICKUP_RADIUS` of a Core collects it, the inventory grows, the matching amplifier lights up in `#amplifier-status`, and `getShiftCost(from, to)` returns a reduced cost (5 - 1.5 = 3.5 for one matching amplifier).

## Acceptance (from plan §3.4)

1. **Placing / finding a Resonance Core spawns a floating amplifier mesh.** Per-Core `OctahedronGeometry(0.32, 0)` + `RingGeometry(0.4, 0.5, 16)` glow ring; bob + rotate animation. The mesh color matches the biome.
2. **Walking close to one collects it.** Player within `AMPLIFIER_PICKUP_RADIUS = 1.5` blocks → on next frame, the Core is removed from the world map + added to `playerInventory.amplifiers` + a notification fires.
3. **The amplifier lights up in the HUD.** `#amplifier-status` shows `AMPS: ● AB  ○ BG  ○ AG` after the first AB-Core is collected.
4. **Costs of phase shifts in that transition decrease.** `getShiftCost(0, 1)` returns `3.5` (not `5`) after the first AB-Core is collected; `getShiftCost(0, 2)` is unchanged (AG amp not yet collected).
5. **Cores are one-shot per Core.** Re-entering a chunk after pickup doesn't respawn the Core; the world's `_resonanceCores` map marks it collected.
6. **Save/restore persists the amplifier list.** The save blob includes `{ collectedEchoes, amplifiers }` from §3.3; the §3.4 work verifies the round-trip preserves the amplifier set.
7. **Cores are deterministic.** A given world seed produces the same Core positions + amplifier assignments across reloads. The `pickAmplifierForKey` is keyed off the core position so reloads show the same amp.
8. **No regression locks.** Phase 3.3's Echoes + HUD counter + lore toast stay intact. Phase 3.2's Stabilizer + collapse state machine stays intact. Phase 3.1's biome tick stays intact.
9. **The cost reduction is per-amplifier.** Collecting two matching amplifiers (e.g. 2 AB) would reduce the cost by `2 * AMPLIFIER_SHIFT_REDUCTION = 3`; collecting all 3 (AB, BG, AG) would reduce the cost of all 3 transitions.

## Fix shape

1. **`src/collect/resonance.js`** (new — pure module). Exports:
   - `PICKUP_RADIUS` (re-export of `AMPLIFIER_PICKUP_RADIUS`).
   - `resonanceCoreKey(x, y, z)` — canonical `"x,y,z"` (defensive: null for non-finite).
   - `resonanceCoreColorForBiome(biomeId)` — Crystal Cavern pale blue, Phase Nexus green, Desert amber, default white.
   - `pickAmplifierForKey(key)` — deterministic 1-of-3 pick via simple hash.
   - `amplifierApplies(ampName, fromPhase, toPhase)` — checks `AMPLIFIER_TRANSITIONS[ampName]` includes both phases.
   - `isWithinRadius(playerPos, corePos, radius)` — Chebyshev/cubic distance.
   - `pickupResult(playerPos, coreList, radius)` — nearest uncollected Core within radius.
   - `floatingOffset(t, phase)` — `{ y, rotY }` for the floating animation.
   - `coreToWorldData(x, y, z, amplifier, biomeId)` — canonical Core shape.
   - `isResonanceCoreBlock(blockId)` — `blockId === BLOCK_RESONANCE_CORE`.
   - `RESONANCE_CORE_AMPLIFIERS` — frozen array of `[AB, BG, AG]`.

2. **`src/core/world.js`** (extend). Add `§3.4 Resonance Core API`:
   - `this._resonanceCores` map (key → `{ x, y, z, amplifier, biomeId, collected, key }`).
   - `World.spawnResonanceCore(x, y, z, amplifier, biomeId)` — idempotent unless collected.
   - `World.collectResonanceCore(key)` — marks collected + returns data.
   - `World.listResonanceCores()` — uncollected Cores as a plain array.
   - `World.getTotalResonanceCores()` / `World.getUncollectedResonanceCoreCount()` / `World.getCollectedResonanceCoreCount()`.
   - `World.clearResonanceCores()` — wipes the list.

3. **`src/core/constants.js`** (extend). Add:
   - `BLOCK_RESONANCE_CORE = 16` (now properly exported).
   - `AMPLIFIER_PICKUP_RADIUS = 1.5`.
   - `RESONANCE_CORE_LIFETIME = 0` (persistent).
   - `AMPLIFIER_TRANSITIONS` (frozen map: AB → [0, 1], BG → [1, 2], AG → [0, 2]).
   - `AMPLIFIER_UNLOCK_TEXT` (frozen map of unlock notification strings).
   - `BLOCK_PROPERTIES[BLOCK_RESONANCE_CORE]` entry (golden color, no solid, immovable).

4. **`src/render/renderer.js`** (extend). Add `ResonanceCoreOverlay` class:
   - Separate `THREE.Group` named `resonanceCoreOverlay` (independent of the chunk-mesh, Phase Lens, Resonance, Anchor, Checkpoint, Collapse, and Echo groups).
   - Per-Core: `OctahedronGeometry(0.32, 0)` + `RingGeometry(0.4, 0.5, 16)` glow ring.
   - Methods: `showResonanceCore` / `updateResonanceCores` / `clearResonanceCore` / `clearResonanceCores` / `getCount` / `getKeys` / `getAmplifierAt`.
   - Renderer thin wrappers: `showResonanceCore` / `updateResonanceCores` / `clearResonanceCore` / `clearResonanceCores` / `getResonanceCoreCount` / `getResonanceCoreKeys` / `isResonanceCoreAt` / `getResonanceCoreAmplifierAt`.

5. **`src/ui/hud.js`** (extend). Constructor queries `#amplifier-status` + caches the last status string. New method `setAmplifierStatus(unlocked)` that updates the DOM (only writes on change edge).

6. **`index.html`** (extend). Add `#amplifier-status` element + CSS.

7. **`main.js`** (extend). Per-frame `tickResonanceCoresPerFrame(dt)`:
   - Walks `world.listResonanceCores()` + drives the overlay animation.
   - On pickup: `world.collectResonanceCore(key)`, `inventory.addAmplifier(amp)`, `renderer.clearResonanceCore(key)`, `hud.setAmplifierStatus(...)`, `hud.showNotification("Amplifier AB unlocked - ...")`.
   - Wires into the game loop after `tickEchoesPerFrame`.

8. **`src/save/system.js`** — no change. The §3.3 work already extends the save blob to include `inventory`; the amplifier list is in `inventory.amplifiers` and is already serialized.

9. **`tests/headless/test-phase34.cjs`** (new) — 63 checks (≈16 static + 30 pure-module + 12 World API + 5 inventory round-trip).
10. **`tests/headless/smoke.cjs`** — add Phase 3.4 static-analysis block (42 keys).
11. **`tests/gameplay.spec.js`** — 1 new Phase 3.4 test.

## Files to touch

- `src/collect/resonance.js` (new).
- `src/core/world.js` (Resonance Core API).
- `src/core/constants.js` (BLOCK_RESONANCE_CORE, AMPLIFIER_PICKUP_RADIUS, AMPLIFIER_TRANSITIONS, AMPLIFIER_UNLOCK_TEXT).
- `src/render/renderer.js` (ResonanceCoreOverlay class + thin wrappers).
- `src/ui/hud.js` (setAmplifierStatus method).
- `index.html` (#amplifier-status element + CSS).
- `main.js` (per-frame `tickResonanceCoresPerFrame` + debug hooks).
- `tests/headless/test-phase34.cjs` (new).
- `tests/headless/smoke.cjs` (Phase 3.4 static-analysis block + process-exit gate).
- `tests/gameplay.spec.js` (1 new Phase 3.4 Playwright test).
- `HANDOFF.md` (Phase 3.4 closure).
- `PROJECT_REMEDIATION_PLAN.md` (Phase 3.4 row ✅ Done).
- `PHASE_3_5_BRIEF.md` (Phase Lock + Phase Glider — to be created at the start of the next session).

## How to verify

```bash
node --check main.js
node --check src/collect/resonance.js
node --check src/render/renderer.js
node --check src/ui/hud.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
... all earlier phase tests still pass ...
node tests/headless/test-phase33.cjs   # 131/131 still pass
node tests/headless/test-phase34.cjs   # 63/63 new — Phase 3.4
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

## Common pitfalls

- **Resonance Cores MUST be in their own THREE.Group** (not the chunk-mesh group). Same pattern as §3.3 Echoes / §3.2 Checkpoints / §3.1 Scan / §2.7 Anchor.
- **Pickup math is Chebyshev/cubic radius** via squared-distance compare. Matches the existing §2.5 / §2.6 / §2.7 / §3.2 / §3.3 pattern.
- **The amplifier assignment is deterministic.** The `pickAmplifierForKey` uses a simple hash of the key, so the same Core position always unlocks the same amplifier across reloads. The hash is `-` so the result is stable.
- **The cost reduction is per-amplifier, not per-Core.** Two AB Cores would reduce the AB shift cost by `2 * 1.5 = 3` (not 1.5). The test asserts the per-amplifier math.
- **The save blob already includes amplifiers** (from §3.3). The §3.4 work doesn't need a new save extension — the existing `inventory.serialize` covers it. The save round-trip test verifies the contract.
- **The `BLOCK_RESONANCE_CORE` block id was 16 but was never exported** (a pre-3.4 bug). The §3.4 work adds the export + a `BLOCK_PROPERTIES` entry. The pre-3.4 `terrain.js` reference to `BLOCK_RESONANCE_CORE` now resolves correctly.
- **The `getShiftCost` debug hook is a separate surface from `phaseManager.cyclePhase`.** The current `cyclePhase` doesn't apply the amplifier discount; the §3.4 work provides the `getShiftCost` hook so the test surface can verify the math, and the §3.5 / §3.6 work can wire it into the actual shift code.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 3.3 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 3.3 row ✅ Done; Phase 3.4 row ✅ Done when it ships.
- `PHASE_3_5_BRIEF.md` (Phase Lock + Phase Glider — port the orphan `PhaseLockManager`, add a Phase Step visual cue) will be created at the start of the next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
git add -A
git commit -m "Phase 3.4: resonance cores — Crystal Caverns amplifiers + cost reduction + HUD status"
TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```
