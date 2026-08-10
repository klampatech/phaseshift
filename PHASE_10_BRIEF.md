# Phase 10 — Gameplay mechanics, playability & fun pass

> **Session goal:** Take Phase Shifter from "solid tech demo of a traversal mechanic" to "an actually-fun, replayable small game" by closing the gaps surfaced in the gameplay-mechanics review (see "Diagnosis" below). The roots of the game are excellent — the project ships a working phase-shift traversal loop with 1393 headless tests and a 38 KB gzipped main entry. What's missing is *tension, stakes, narrative, and a payoff*. Phase 10 fixes that.
>
> **Parent plan:** [`PROJECT_REMEDIATION_PLAN.md`](./PROJECT_REMEDIATION_PLAN.md) §10.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** `bdaa540` (Phase 9 closure).
> **Remote:** `klampatech/phaseshift` (live: https://klampatech.github.io/phaseshift/).

---

## Diagnosis (the why)

A gameplay-mechanics review of the as-shipped 1.0 build surfaced four root causes that make the game shallow today. Phase 10 closes them.

### 1. The energy economy is a no-op
- `PHASE_SHIFT_COST = 5` (max energy = 100) — `src/core/constants.js:187`
- `PHASE_REGEN_RATE_ALPHA = 0.5` × `dt * 60` per frame (`src/core/phase.js:119`) — ~30 energy/sec in Alpha
- The README claims "30 energy per shift + 1/sec regen in Alpha" — the actual numbers are 5 energy per shift + 30 energy/sec regen
- Result: the player can shift continuously. **There is no tension.** The "Phase Collapse" penalty is meaningless because the player just regens to full in 4 seconds.
- The `dt * 60` multiplier is itself a hidden bug — it makes energy scale with frame rate, not real time
- `PHASE_DRAIN_RATE_BETA/Gamma` constants (`src/core/constants.js:195-196`) are never referenced in the active code path

### 2. Three of the four design pillars are broken
The spec (`GAME_SPEC.md §1`) declares four design pillars. The implementation honors only one.

| Pillar | Spec says | Implementation does | Status |
|---|---|---|---|
| One Mechanic, Deep Mastery | Phase-shifting is the only core interaction | Phase-shift works, but the game also teaches LMB/RMB block edit as a primary verb | Diluted |
| No Building, Only Shaping | Players don't place/break blocks | `src/input/placeBlock.js` is a full block editor; tutorial #3 + #4 teach breaking/placing | Broken |
| Memory World | Phase changes persist | World is static — each cell has a hardcoded 3-bit collision mask, no way for the player to leave a persistent mark | Broken |
| Calm Tension | Serene traversal + resource negotiation | The energy economy is so lenient there is no negotiation | Broken |

### 3. The lore is random flavor text
- 12 strings in `ECHO_LORE_LIBRARY` (`src/collect/echo.js:51-65`)
- Echoes placed by chance per biome, addressed by hash(key) — adjacent Echoes can have unrelated lore
- The "Mirror City" / "Lost Architect" / "Phase Nexus" hints at a story the game never tells

### 4. The 3 Acts end, then nothing
- Act 1: find any Echo (trivial)
- Act 2: walk to a specific biome (compass helps)
- Act 3: collect 3 cores + place 1 Stabilizer (trivial)
- After: "All complete — explore freely" (`src/progression/goals.js:96`) — but there's nothing to explore
- No boss, no payoff, no narrative arc ending

### 5. Plus a long tail of small issues
- **Phase Erosion** is defined in `src/core/world.js:checkErosion()` but **never called from `main.js`** — dead code
- **Blocker UI** labels `Q Phase Step · E Phase Walk (hold)` are wrong — the actual bindings are Q = Resonance, E = Phase Lens
- **Hidden mechanics** — Phase Glider (Space in Beta), Phase Anchor (Shift+LMB), Resonance's solve-power, Phase Lock's auto-fire — are surface-level OK but never taught in a way that reveals their purpose
- **Biomes are palette swaps** — each biome has no unique mechanic, just a different color
- **No replayability hooks** — no New Game+, no daily seed, no achievements
- **The README is lying about the energy numbers** — would mislead a new player before they even start

The hooks for all of this are already in the code. The work is filling them in.

---

## Sub-phases

Phase 10 is sequenced P0 → P1 → P2. **P0 is required for the game to be fun.** P1 makes it feel good. P2 makes it addictive.

### §10.1 — Fix the energy economy (P0)

**The single highest-impact change in the project.** Without this, the game has no tension.

**Acceptance:**
- `PHASE_SHIFT_COST = 15` (was 5)
- `PHASE_REGEN_RATE_ALPHA = 2.0` (was 0.5) — per real second, not per-frame
- `PHASE_DRAIN_RATE_BETA = 0.5` per real second (when in Beta — was unset)
- `PHASE_DRAIN_RATE_GAMMA = 1.0` per real second (when in Gamma — was unset)
- Remove the `dt * 60` multiplier from `phaseManager.update()` (`src/core/phase.js:119, 121`) — this is a hidden bug that makes energy scale with frame rate
- Result: the player can shift ~6 times in a row from full energy in Alpha, must rest to recover, drains while in Beta/Gamma. The "Phase Collapse" penalty becomes a real consequence.
- Amplifiers reduce the shift cost by `AMPLIFIER_SHIFT_REDUCTION` (1.5 per) per the existing contract
- README updated to match the new numbers (the current README says "30 energy per shift"; fix the README to say 15 then correct)
- All 24 headless test files still pass (re-baseline `test-phase12.cjs` etc. as needed for the new energy contract)
- New `tests/headless/test-phase10-energy.cjs` with ~15 checks covering the new energy contract: shift cost, per-second regen/drain (real-time), amplifier discount, no negative energy, framerate-independent

**Fix shape:**
1. Open `src/core/constants.js`. Update `PHASE_SHIFT_COST`, `PHASE_REGEN_RATE_ALPHA`, add `PHASE_DRAIN_RATE_BETA`, `PHASE_DRAIN_RATE_GAMMA` as per-real-second values. Remove the orphan `ENERGY_REGEN_RATE` and `PHASE_DRAIN_RATE` if they exist.
2. Open `src/core/phase.js`. Update `update(dt)` to multiply rates by `dt` directly (not `dt * 60`). Add a per-second drain while in Beta/Gamma.
3. Update `README.md` to match the new numbers.
4. Update `src/ui/hud.js` if the energy bar visually needs retuning for the new range.
5. Add the new test file.

**Files to touch:** `src/core/constants.js`, `src/core/phase.js`, `README.md`, `src/ui/hud.js` (if needed), `tests/headless/test-phase10-energy.cjs` (new).

---

### §10.2 — Implement "Memory World" via the Phase Fuse (P0)

**The game's missing pillar.** Without this, the world is static and the player has no impact.

**Acceptance:**
- New mechanic: **Phase Fuse** — hold `F` (or another unbound key) on a block for 3 seconds + 30 energy to permanently swap that block's phase presence (i.e., write a new entry in `BLOCK_PROPERTIES.phaseSolid`). The fused block is marked with a subtle golden outline (the §2.7 anchor palette, but tinted differently to distinguish).
- The fused state persists across save/load (extends `World.exportGlobalState()` + `importGlobalState()`)
- Resonance (Q) is now reframed as "the *quick* rephase" — swap 3×3×3 for 15 energy, temporary effect (resets when player leaves radius? debate needed)
- The Phase Fuse is the *permanent* rephase — single block, 30 energy, but persists
- Tutorial gets a new step after Resonance: "Hold F on a block to fuse it permanently"
- The player can now "leave a path" — fuse blocks in Beta to make a permanent bridge, fuse Echoes in Gamma to make them visible in Alpha, etc.
- Headless test: `tests/headless/test-phase10-fuse.cjs` with ~20 checks covering the fuse lifecycle, energy cost, persistence, save/load, and interaction with Resonance

**Design note:** Resist the urge to fuse Resonance away. They serve different purposes — Resonance is *tactical* (escape, puzzle), Fuse is *strategic* (build paths, mark discoveries). Keep both.

**Fix shape:**
1. New pure module `src/fuse/fuse.js` with `fuseCost`, `fuseKey`, `fuseDuration`, `fuseTick`, `canFuse`, `startFuse`, `tickFuse`, `committedFuses`. Mirror the anchor pattern.
2. New constants `FUSE_COST = 30`, `FUSE_HOLD_SECONDS = 3`, `FUSE_OUTLINE_COLOR = 0xddaa44`.
3. `World.createFuse(x, y, z, phase)`, `World.tickFuses(dt)`, `World.exportFuses()` + `World.importFuses()`.
4. New `FuseOverlay` in `src/render/renderer.js` (separate THREE.Group, similar to AnchorOverlay).
5. Wire `F` key in `src/input/controls.js` (verify it's free — currently F is the alt-anchor key; need to rebind one or pick a different key).
6. Extend `src/save/system.js` `_coerceFuses` + `saveSnapshot` for save/load.
7. Add a tutorial step in `src/tutorial/tutorial.js` (item #9 after the existing 8).
8. Update the README to include the new mechanic.

**Files to touch:** `src/fuse/fuse.js` (new), `src/core/constants.js`, `src/core/world.js`, `src/render/renderer.js`, `src/input/controls.js`, `src/save/system.js`, `src/tutorial/tutorial.js`, `main.js`, `tests/headless/test-phase10-fuse.cjs` (new), `README.md`.

---

### §10.3 — Add a real failure state (P0)

**Collapse costs nothing today. Make it cost something the player cares about.**

**Acceptance:**
- On Phase Collapse (energy = 0 in Beta/Gamma, or `forcePhaseCollapse()`), the player loses 1 random Echo
- The lost Echo is shown in the lore toast: `"Lost Echo: <key> — <lore>"` — the player grieves a specific Echo, not "Phase Collapse #7"
- If the player has no Echoes, they drop a 25-energy penalty instead (still hurts, but recoverable)
- The lore toast replaces the existing "No Stabilizer nearby" toast when the collapse was not stabilized
- The 5s post-collapse invuln window (Phase 8.2) is preserved so the player can't re-collapse immediately
- Headless test: `tests/headless/test-phase10-collapse.cjs` covering the Echo-loss ordering, the invuln interaction, and the energy-fallback path

**Fix shape:**
1. In `src/collapse/collapse.js`, extend `startCollapse` to accept a `playerInventory` argument and track the lost Echo in the collapse state.
2. In `main.js#tickCollapsePerFrame`, on the `result.done` branch, remove a random Echo from `playerInventory` and emit the lore toast.
3. Add a `FALLBACK_ENERGY_PENALTY = 25` constant for the no-Echo case.
4. New debug hook `__phaseShifter__.forceCollapseWithLoss()` for testing.

**Files to touch:** `src/collapse/collapse.js`, `src/core/constants.js`, `main.js`, `tests/headless/test-phase10-collapse.cjs` (new).

---

### §10.4 — Sequence the lore (P0)

**The 12 lore strings are flavor text. The story is the progression.**

**Acceptance:**
- Lore is no longer random. Build a 30+ Echo narrative in `src/collect/echo.js`:
  - **Forest** (5 Echoes): "I dreamed of three cities. One is now. One is lost. One is trying to come back."
  - **Ruins** (5 Echoes): "The Architect built the Mirror City as a gift. The Architect's name is now on every wall."
  - **Caves** (5 Echoes): "Stone dreams. Caves are the dreams of mountains. We live in their dreams."
  - **Crystal Caverns** (5 Echoes): "The crystals grew from grief. The Architect's grief. The grief of everyone who stayed."
  - **Desert** (5 Echoes): "It was a sea. The Architect drank it. The sea is now the desert."
  - **Deep Void** (5 Echoes): "The Void is not empty. The Void is the Architect, finally alone."
  - **Sky Ruins** (5 Echoes): "The sky was once ground. We used to walk up here. The Mirror City fell up."
  - **Phase Nexus** (1 final Echo): "You are the next Architect. Build what you must. The phases will remember you."
- Each Echo has a biome-specific color (already supported via `echoColorForBiome`) and a unique anchor key
- The `echoLoreForKey` helper is replaced by a direct lookup; the key encodes which story beat it is
- Optional: tie Echo discovery to biome exit — collect all 5 Echoes in Forest to unlock the path to Ruins (the compass already points at the nearest unfinished marker; this is a natural extension)
- Headless test: `tests/headless/test-phase10-lore.cjs` covering the lore sequence, the deterministic per-Echo assignment, and the save/load round-trip

**Fix shape:**
1. Replace `ECHO_LORE_LIBRARY` in `src/collect/echo.js` with a per-biome ordered array.
2. Replace `echoLoreForKey(key)` with `loreForKey(key, biomeId)` that does a direct lookup.
3. Update `world.listEchoes()` to include the biome id with each Echo key.
4. Update the lore toast to show the Echo's ordinal within its biome ("Forest Echo 3 of 5").

**Files to touch:** `src/collect/echo.js`, `src/core/world.js`, `main.js`, `tests/headless/test-phase10-lore.cjs` (new).

---

### §10.5 — Give the Phase Nexus a finale (P0)

**The 3 Acts end in "explore freely." Give them a payoff.**

**Acceptance:**
- New Act 4: "Convergence" — unlocked when:
  - All 3 Amplifiers collected
  - At least 1 Stabilizer placed
  - At least 1 Echo collected
  - Player has entered the Phase Nexus biome
- The Act 4 trigger: a chamber opens in the Phase Nexus (a 5×5×5 region of stone cleared, a wooden floor, a glowing ceiling, the final Echo floating in the center)
- The final Echo plays the Nexus lore (the §10.4 "You are the next Architect" line)
- After collecting the final Echo, the world gets a permanent visual change: each biome's tint gains a subtle shimmer (the chunk materials get a +5% emissive boost), and the player avatar gets a faint glow (a translucent mesh added to the player group)
- The HUD objective updates to "Convergence complete. The phases remember you."
- New `BIOME_PHASE_NEXUS_OPEN` state in the world (the Nexus is sealed until Act 4)
- Headless test: `tests/headless/test-phase10-nexus.cjs` covering the Act 4 unlock conditions, the Nexus-open state, the final Echo placement, and the visual-change persistence

**Fix shape:**
1. Extend `src/progression/goals.js` with `ACT_CONVERGENCE` and `actCompleted(ACT_CONVERGENCE, state)`.
2. New `World.openNexus()` / `World.isNexusOpen()` / `World.listNexusChamber()` methods.
3. New `NexusChamberOverlay` in `src/render/renderer.js` (the chamber geometry + the final Echo).
4. Extend `src/save/system.js` with the nexus-open state.
5. New `applyConvergenceVisuals()` in `main.js` — emits the visual shimmer + player glow on completion.

**Files to touch:** `src/progression/goals.js`, `src/core/world.js`, `src/render/renderer.js`, `src/save/system.js`, `main.js`, `tests/headless/test-phase10-nexus.cjs` (new).

---

### §10.6 — Per-biome signature mechanics (P1)

**Each biome is a palette swap. Make them feel different.**

**Acceptance:**
- **Forest** — Echoes are 2× more common (the "remembrance" biome). `echoChance` in `BIOME_DATA` doubles for Forest.
- **Crystal Cavern** — Resonance Cores are 2× more common (the "power" biome). `resonanceCoreChance` doubles for Crystal Cavern.
- **Deep Void** — Phase Glider is 2× faster (`PHASE_GLIDER_SPEED = 12.0` when in Deep Void biome)
- **Sky Ruins** — Phase Anchors last 2× longer (`ANCHOR_LIFETIME = 20` when in Sky Ruins biome)
- **Desert** — Echoes are rare but high-quality (the "lost" biome; lore is unique to Desert)
- **Phase Nexus** — all of the above apply + the Act 4 finale
- Headless test: `tests/headless/test-phase10-biomes.cjs` covering the per-biome tuning + the biome detection in player position

**Fix shape:**
1. New `biomeMultipliers(biomeId)` helper in `src/world/biome.js` returning `{ echoMultiplier, coreMultiplier, gliderSpeedMultiplier, anchorLifetimeMultiplier }`.
2. `src/gen/terrain.js` consults `biomeMultipliers(biomeId)` when generating chunks.
3. `main.js` consults `biomeMultipliers(currentBiomeId)` when running the per-frame Glider/Anchor ticks.

**Files to touch:** `src/world/biome.js`, `src/gen/terrain.js`, `src/phase/lock.js`, `src/core/world.js`, `main.js`, `tests/headless/test-phase10-biomes.cjs` (new).

---

### §10.7 — Drop LMB/RMB block edit + fix UI labels (P1)

**The spec says no building. The tutorial teaches building. Pick one.**

**Decision tree:** If you agree with the spec ("No Building, Only Shaping"), follow path A. If you want to keep block edit, follow path B and update the spec.

**Path A — Drop LMB/RMB block edit (recommended, matches the spec):**
- **Acceptance:**
  - LMB no longer breaks blocks. RMB no longer places blocks.
  - Remove `placeBlock(hit, blockId, context)` from `src/input/placeBlock.js` (or keep as a debug hook).
  - Remove tutorial #3 (`Break the Stone block with Left Click`) and #4 (`Place a block with Right Click`).
  - Replace with: "F to fuse a block permanently" (§10.2) and "Q to resonate a 3×3×3 area".
  - The 4 verbs are: WASD+Shift, Shift+Space (phase), Q (Resonance), F (Fuse), Shift+LMB (Anchor), E (Lens), T (cycle), R (Stabilizer).
- **Files to touch:** `src/input/placeBlock.js`, `src/input/controls.js`, `src/tutorial/tutorial.js`, `main.js`, `index.html` (blocker UI), `README.md`, `tests/headless/test-phase23.cjs` (deprecate the placement tests).

**Path B — Keep block edit, update the spec:**
- **Acceptance:**
  - `GAME_SPEC.md §1` updated to add "Building" as a 5th pillar
  - The lore (if §10.4 is done) is updated to reflect that the player *builds* the Mirror City
  - The tutorial keeps the break/place steps
- **Files to touch:** `GAME_SPEC.md`, `README.md`.

**Recommended picker:** Path A. The Phase Shifter pitch is fundamentally different from Minecraft, and the tutorials currently train the wrong game.

**UI label fixes (both paths):**
- **Acceptance:**
  - Blocker UI in `index.html:13-19` says: `Q Resonance · E Phase Lens (hold) · F Phase Fuse (hold)` instead of the wrong `Q Phase Step · E Phase Walk (hold)`
  - The control label `LMB Break block · RMB Place block` is removed (Path A) or kept (Path B)
  - README "Controls" section updated to match the new labels
- **Files to touch:** `index.html`, `README.md`.

---

### §10.8 — Wire up erosion or remove it (P1)

**`World.checkErosion()` is dead code.** Either use it or delete it.

**Recommended path: wire it up.**

**Acceptance:**
- `World.checkErosion(dt, playerX, playerY, playerZ, playerPhase)` is called from `main.js` in the game loop (after the physics tick, before the render)
- The per-frame cost is O(11 cubed x 3) = ~4000 block lookups in the player's radius — fast enough, but verify the FPS holds (target: ≥30 FPS)
- A subtle particle burst fires when a block erodes (mirror the Phase Anchor's per-cell particle pattern)
- An audio cue plays on erosion (a soft "crumble" sound)
- The erosion is visible in-game: Stone in Gamma → Dirt, Wood in Beta → Dirt, etc. Players will notice and adjust their behavior
- Headless test: `tests/headless/test-phase10-erosion.cjs` covering the tick math, the threshold check, the per-block uniqueness, and the persistence

**Fix shape:**
1. Call `world.checkErosion(dt, pos.x, pos.y, pos.z, phaseManager.getCurrentPhase())` from `main.js` in the game loop.
2. Wire the `onEroded` hook to a particle + audio call.
3. Add an `audioManager.playErosion()` audio method.

**Files to touch:** `main.js`, `src/audio/manager.js`, `src/render/renderer.js` (particle hook), `tests/headless/test-phase10-erosion.cjs` (new).

**Alternative:** Delete the erosion code. If wiring it up slows the game or doesn't feel right, drop it from `src/core/world.js` and `src/core/constants.js` and remove the unused imports.

---

### §10.9 — Energy danger states (P1)

**The energy HUD is a number. Make it a feeling.**

**Acceptance:**
- When energy < 30: HUD energy bar throb orange (CSS keyframe animation)
- When energy < 15: a subtle audio heartbeat plays (gain modulated by energy level)
- When energy < 5: a screen vignette pulse (rgba(255, 100, 0, 0.1) on/off at 1 Hz)
- When energy = 0 in Beta/Gamma: collapse starts as today, but **in Alpha** the player can tough it out at 0 for 5 seconds (the game trusts you in your home phase)
- Headless test: `tests/headless/test-phase10-energy-states.cjs` covering the threshold detection + the 5-second Alpha grace

**Fix shape:**
1. New `energyTier(energy)` helper in `src/ui/hud.js` returning `'normal' | 'low' | 'critical' | 'collapse'`.
2. CSS keyframes for the orange throb and the screen vignette pulse.
3. New `audioManager.playHeartbeat()` method.
4. Wire the alpha-grace in `main.js`'s collapse trigger.

**Files to touch:** `src/ui/hud.js`, `index.html`, `src/audio/manager.js`, `main.js`, `tests/headless/test-phase10-energy-states.cjs` (new).

---

### §10.10 — Echo Hunter panel (P2)

**Track all 30+ Echoes. Show discoverable count per biome.**

**Acceptance:**
- Inventory panel (`I`) shows a "Echoes" tab with all 30+ Echoes
- Each Echo has a slot: `[?] The Architect's Dream (Forest 1/5)` until collected, `[✓] The Architect's Dream (Forest 1/5)` after
- The panel shows biome-by-biome breakdown: `Forest 3/5 · Ruins 0/5 · Caves 0/5 · …`
- A "Zone: 12/15 Echoes found" overlay shows briefly when the player transitions biomes
- New `INV_ECHOES` tab in the inventory panel
- Headless test: `tests/headless/test-phase10-inventory.cjs` covering the panel rendering + the per-biome counts

**Fix shape:**
1. New `EchoHunterPanel` in `src/ui/hud.js`.
2. Extend `src/inventory/inventory.js` with `listEchoesByBiome()` helper.
3. New biome-transition hook in `main.js#tickBiomesPerFrame` that fires the count overlay.

**Files to touch:** `src/ui/hud.js`, `src/inventory/inventory.js`, `main.js`, `index.html`, `tests/headless/test-phase10-inventory.cjs` (new).

---

### §10.11 — "Wrong phase" Echoes (P2)

**Each biome has 1 Echo that only appears in a specific phase.** The player must use the Phase Lens to find them.

**Acceptance:**
- `WrongPhaseEcho` block type (new, or reuse `BLOCK_ECHO` with a `phase-locked` flag on the world map)
- 1 per biome, 8 total
- The Echo is invisible in the wrong phase; the Phase Lens highlights it (similar to existing phase-different blocks)
- Collecting a WrongPhaseEcho unlocks a unique lore line (the §10.4 set gets +1 Echo per biome)
- Headless test: `tests/headless/test-phase10-hidden-echoes.cjs` covering the phase-locked visibility + the Lens highlight

**Fix shape:**
1. New `wrongPhaseEchoes` constant in `src/collect/echo.js` (per biome: which phase shows it).
2. Extend `World.getEchoVisibility(key, currentPhase)` to return `true` only when the current phase matches.
3. Extend `ScanOverlay` to highlight phase-locked Echoes.
4. New biome-specific Echo entry in `ECHO_LORE_LIBRARY`.

**Files to touch:** `src/collect/echo.js`, `src/core/world.js`, `src/render/renderer.js`, `src/scan/lens.js`, `tests/headless/test-phase10-hidden-echoes.cjs` (new).

---

### §10.12 — Phase shift preview (P2)

**A 0.5s "ghost" of the target phase world before the shift completes.**

**Acceptance:**
- When the player presses Shift+Space (or T), the world briefly shows a desaturated ghost of the target phase for 0.5s
- The current phase renders normally
- The ghost fades to the target phase over the next 1.0s (the existing 1.5s shift animation)
- The energy cost is unchanged
- The implementation is a post-processing pass — no need to rebuild chunks
- Heads-up: the existing `updatePhaseShiftOverlay` does a similar color pulse; this is a *spatial* preview, not a color pulse

**Fix shape:**
1. New `PhaseShiftPreview` shader in `src/render/renderer.js` (a `ShaderPass` that mixes the current frame with a desaturated version + a phase tint).
2. Wire the preview from `main.js` when `phaseManager.isShifting` is true and the elapsed time is < 0.5s.

**Files to touch:** `src/render/renderer.js`, `main.js`, `tests/headless/test-phase10-preview.cjs` (new).

---

### §10.13 — Resonance charge-up (P2)

**The 1.0s resonance pulse is a flashy VFX. Make it a tactical decision.**

**Acceptance:**
- When the player presses Q, the resonance sphere pulse starts at 0.5s charge (smaller, dimmer)
- During the charge, the swap is *previewed* — the player sees the target phase blocks in the 3×3×3
- At 1.0s, the swap commits and the sphere pulse expands to full
- Press Q again within 1.0s to cancel (no energy refund, but no swap)
- The energy cost is debited on commit, not on press
- The cost is increased from 15 to 25 to compensate for the preview-then-commit flow

**Fix shape:**
1. New `RESONANCE_CHARGE_SECONDS = 0.5` + `RESONANCE_PULSE_DURATION = 1.5` constants.
2. Extend `ResonancePulse` in `src/render/renderer.js` with a `charge` state.
3. Extend `main.js#performResonance` to track the charge state and the cancel path.
4. Update constant `RESONATE_COST = 25`.

**Files to touch:** `src/core/constants.js`, `src/render/renderer.js`, `main.js`, `tests/headless/test-phase10-resonance-charge.cjs` (new).

---

### §10.14 — New Game+ mode (P2)

**Randomize the phase dominance of each biome. Add ironman mode.**

**Acceptance:**
- New Game+ is offered from the pause menu after Act 3 (Convergence) is complete
- The world seed is preserved, but the phase-dominance mapping is randomized: Forest might be Beta-heavy (more Obsidian + Void), Crystal Cavern might be Alpha-heavy (more Stone), etc.
- The Convergence goal re-applies; the player re-collects 3 amplifiers + 1 Echo + 1 Stabilizer + 1 final Echo
- Optional ironman mode: no manual saves, no Stabilizer respawns (the collapse goes to spawn with full Echo loss)
- `worldSeed` + `phaseDominanceSeed` are stored in the save blob
- Headless test: `tests/headless/test-phase10-newgameplus.cjs` covering the phase-dominance shuffle + the ironman flag

**Fix shape:**
1. New `phaseDominanceSeed` in `GameState`.
2. New `pickPhaseDominance(phaseDominanceSeed, biomeId)` helper returning a permutation of [0, 1, 2].
3. Extend `BIOME_DATA` in `src/gen/terrain.js` with `phaseDominance` per biome.
4. New `startNewGamePlus()` in `src/save/system.js`.
5. Pause menu button "Start New Game+".

**Files to touch:** `src/gen/terrain.js`, `src/core/world.js`, `src/save/system.js`, `src/ui/hud.js`, `index.html`, `main.js`, `tests/headless/test-phase10-newgameplus.cjs` (new).

---

## Suggested execution order

The order matters — earlier phases set up the game-state and inventory hooks that later phases depend on.

1. **§10.1** (energy economy) — start here. Without it, none of the other mechanics have tension.
2. **§10.2** (Phase Fuse) — the missing pillar. Sets the precedent for player-driven world changes.
3. **§10.3** (collapse penalty) — Echo loss depends on the lore system; do this before §10.4 if you want the lore loss to feel visceral.
4. **§10.4** (lore sequence) — the narrative spine. Required for §10.5.
5. **§10.5** (Nexus finale) — the payoff. Required for §10.14.
6. **§10.7** (drop LMB/RMB or fix the spec) — pick a direction. Affects the blocker UI.
7. **§10.6** (per-biome mechanics) — uses the Phase Fuse, Resonance, Anchor, Glider hooks.
8. **§10.8** (wire up erosion) — small, easy win.
9. **§10.9** (energy danger states) — depends on §10.1.
10. **§10.10** (Echo Hunter panel) — depends on §10.4.
11. **§10.11** (wrong-phase Echoes) — depends on §10.4 + the Phase Lens.
12. **§10.12** (phase shift preview) — small polish.
13. **§10.13** (resonance charge-up) — small polish.
14. **§10.14** (New Game+) — depends on §10.5 (the Convergence trigger).

If time is short, **P0 (§10.1 → §10.5) is required.** P1 is the loaves of bread. P2 is the sugar — cut if needed.

---

## Common pitfalls

- **Don't trust the headless CI for WebGL tests.** The sandbox has no GPU. The 13 pre-existing Playwright WebGL failures are infrastructure limitations, not real bugs. Run the manual browser pass on the size of §10.1 + §10.3 + §10.5 (the highest-impact changes) before declaring Phase 10 done.
- **The §10.1 energy change ripples through every test.** When you set `PHASE_SHIFT_COST = 15`, re-baseline `test-phase12.cjs` (which testbed `PHASE_SHIFT_COST = 5`) and any other test that asserts on the old value. The README change compounds: the test counts check the NEW cost, not the old.
- **§10.2 (Phase Fuse) interacts with §10.13 (Resonance charge-up).** If you do both, decide which is the *permanent* edit and which is the *tactical* edit. The brief recommends Fuse = permanent, Resonance = tactical. Don't let them overlap.
- **§10.4 (lore sequence) changes the save blob.** Old saves have hash-based lore; new saves have ordered lore. Either migrate the hash-keyed lore to the ordered lore, or version the save blob (`saveVersion = 2`).
- **§10.5 (Nexus finale) should feel earned, not gated.** The unlock conditions are all "natural" — getting all 3 amplifiers is part of Act 3, placing a Stabilizer is part of the existing collapse-safety loop, collecting an Echo is the first thing the player does. The player won't feel the gate.
- **§10.7 (drop LMB/RMB) is a breaking change for any player with existing muscle memory.** If you go Path A, the README + the blocker UI *must* be updated in the same commit. If you keep LMB/RMB, update the spec.
- **§10.9 (energy danger states) can be annoying if they over-trigger.** Tune the audio heartbeat to be subtle (gain < 0.3) and the vignette pulse to be barely visible (alpha < 0.1). The point is to feel the danger, not be screamed at.
- **§10.12 (phase shift preview) is a post-processing pass.** It's not a free change — test the FPS impact on a low-end GPU before shipping.

---

## Hand-off artifacts (deliverables from this phase)

- `HANDOFF.md` — Phase 10 closure section, "Post-1.0 roadmap" updated.
- `PROJECT_REMEDIATION_PLAN.md` — §10 row ✅ Done.
- `PHASE_10_BRIEF.md` — this file (committed at start of phase).
- `README.md` — Controls section updated for the new mechanic + the correct energy numbers + the new lore density.
- `KNOWN_ISSUES.md` — new "🟧 Gameplay mechanics" section if any of the §10 sub-phases couldn't be completed.
- `tests/headless/test-phase10-energy.cjs` (new, ~15 checks)
- `tests/headless/test-phase10-fuse.cjs` (new, ~20 checks)
- `tests/headless/test-phase10-collapse.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-lore.cjs` (new, ~15 checks)
- `tests/headless/test-phase10-nexus.cjs` (new, ~20 checks)
- `tests/headless/test-phase10-biomes.cjs` (new, ~15 checks)
- `tests/headless/test-phase10-erosion.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-energy-states.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-inventory.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-hidden-echoes.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-preview.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-resonance-charge.cjs` (new, ~10 checks)
- `tests/headless/test-phase10-newgameplus.cjs` (new, ~15 checks)

**Total new headless checks: ~170.** Total project: ~1563 (vs the current 1393).

---

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 10: gameplay mechanics + playability pass (energy rebalance, Phase Fuse, collapse penalty, sequenced lore, Nexus finale, per-biome mechanics, etc.)"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

Prefer one commit per sub-phase (so the diff is reviewable), then a final "Phase 10: docs + roadmap updates" commit. Sample commit sequence:

```
Phase 10.0: add this brief + roadmap update
Phase 10.1: rebalance energy economy (PHASE_SHIFT_COST=15, remove dt*60 multiplier)
Phase 10.2: add Phase Fuse mechanic (3s hold, 30 energy, permanent phase swap)
Phase 10.3: collapse penalty = lose 1 random Echo (energy fallback)
Phase 10.4: replace 12 random lore strings with 30+ sequenced narrative
Phase 10.5: Act 4 Convergence + Nexus finale + persistent visual change
Phase 10.6: per-biome signature mechanics (Echo-rich, Core-rich, Glider-fast, etc.)
Phase 10.7: drop LMB/RMB block edit (Path A) + fix blocker UI labels
Phase 10.8: wire up phase erosion (was dead code in src/core/world.js)
Phase 10.9: energy danger states (HUD throb, audio heartbeat, vignette pulse)
Phase 10.10: Echo Hunter panel in inventory
Phase 10.11: wrong-phase Echoes (1 per biome, Phase-Lens-findable)
Phase 10.12: phase shift preview (0.5s ghost before commit)
Phase 10.13: resonance charge-up (0.5s preview, 1.0s commit, 1.5s cancel)
Phase 10.14: New Game+ mode (phase-dominance shuffle) + ironman flag
Phase 10 docs: README + KNOWN_ISSUES + HANDOFF + PROJECT_REMEDIATION_PLAN updates
```

---

## What "Phase 10 done" looks like

- [ ] §10.1: Energy rebalance shipped. `PHASE_SHIFT_COST = 15`, real-time regen, no `dt * 60` multiplier. README updated.
- [ ] §10.2: Phase Fuse shipped. F-key, 3s hold, 30 energy, persistent, save/load round-trip works. Tutorial step added.
- [ ] §10.3: Collapse penalty shipped. Echo loss on collapse, lore toast, 25-energy fallback when no Echoes.
- [ ] §10.4: Lore shipped. 30+ sequenced narrative, deterministic per-key, per-biome ordinal shown.
- [ ] §10.5: Act 4 Convergence shipped. Nexus opens, final Echo plays, world gains shimmer + player glow.
- [ ] §10.6: Per-biome mechanics shipped. Forest/Crystal Cavern/Deep Void/Sky Ruins/Desert/Nexus each have a signature.
- [ ] §10.7: LMB/RMB decision made. Either Path A (drop) or Path B (keep + update spec). Blocker UI labels accurate.
- [ ] §10.8: Erosion wired up. Particle burst + audio on erosion. (Alternative: removed cleanly.)
- [ ] §10.9: Energy danger states shipped. HUD throb, heartbeat, vignette pulse.
- [ ] §10.10: Echo Hunter panel shipped. Inventory shows all 30+ slots, per-biome counts.
- [ ] §10.11: Wrong-phase Echoes shipped. 8 total, Phase-Lens-findable, unique lore per biome.
- [ ] §10.12: Phase shift preview shipped. 0.5s ghost before commit.
- [ ] §10.13: Resonance charge-up shipped. 0.5s preview, 1.0s commit, 1.5s cancel.
- [ ] §10.14: New Game+ shipped. Phase-dominance shuffle + ironman mode.
- [ ] All 24 prior headless test files still pass.
- [ ] New `tests/headless/test-phase10-*.cjs` files pass. ~170 new checks.
- [ ] `npm run build` clean. Main entry stays under 50 KB gzipped (current 38 KB).
- [ ] Live URL still serves HTTP 200.
- [ ] Manual browser pass: §10.1 + §10.3 + §10.5 verified on Chrome + Firefox + Safari.
- [ ] Post-1.0 roadmap in `HANDOFF.md` updated with Phase 10 closure.
- [ ] KNOWN_ISSUES.md updated with any deferred §10 sub-phases.

Optional P0 minimum:
- [ ] §10.1 + §10.2 + §10.3 + §10.4 + §10.5 all shipped. ~75 new checks. The game has tension, world-memory, stakes, narrative, and a payoff.

---

## The vision (one paragraph)

> Phase 10 takes Phase Shifter from "a tech demo of a solid traversal mechanic" to "a small game that earns its 30 minutes." The bones are excellent — the project has a 3375-line `main.js`, 1393 headless tests, eight biomes, eight verbs, three Acts, and a polished accessibility layer. Phase 10 fills the missing veins: tension (energy rebalance), impact (Phase Fuse), stakes (collapse penalty), narrative (sequenced lore), payoff (Nexus finale), and identity (per-biome mechanics). The result is a game that earns its place in the "small browser games that stuck with me" list — the kind of thing that gets shared on r/WebGames with "I just discovered this."
