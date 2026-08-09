# Phase 3.1 — Starting Brief

> **Session goal:** Implement Phase 3.1 — Biomes — surface the current biome in the HUD, color the skybox + fog per biome, and lay the ground for the §3.2 (Stabilizers) + §3.3 (Echoes) + §3.4 (Resonance Cores) follow-ons.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §3.1.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 2.8 closure.
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–2.8 shipped the core mechanics — phase shift, phase-relative collision, per-phase place/break, save/reload memory, the Phase Lens, Resonance, the Phase Anchor, and the audio integration. The game is *mechanically* playable. It's not yet *enjoyable* — the player has no goal, no progression, and no reason to walk in any particular direction.

The plan's §3 ("Make the world feel like a world") has seven sub-phases (§3.1 Biomes, §3.2 Stabilizers, §3.3 Echoes, §3.4 Resonance Cores, §3.5 Phase Lock + Phase Glider, §3.6 Tutorial zone, §3.7 Outcome). Each sub-phase gets its own session-sized brief; this one covers **§3.1 Biomes** as the first.

The §3.1 acceptance is:

> **Acceptance (from plan §3.1):** walking from a Forest biome into a Crystal Cavern visibly changes the sky color and the floating object set.

The "floating object set" is split across §3.3 (Echoes) and §3.4 (Resonance Cores); the §3.1 deliverable is the **sky color** + the **biome label** + the per-biome fog/light tint. The "object set" is wired in by §3.3/§3.4 and the §3.1 skybox transition is the visible scaffold the player sees first.

The codebase has substantial scaffolding already in place:

1. **Eight biome constants** in `src/core/constants.js` — `BIOME_FOREST = 1`, `BIOME_CAVES = 2`, `BIOME_DEEP_VOID = 3`, `BIOME_RUINS = 4`, `BIOME_DESERT = 5`, `BIOME_CRYSTAL_CAVERN = 6`, `BIOME_SKY_RUINS = 7`, `BIOME_PHASE_NEXUS = 8` — plus the canonical `BIOME_NAMES` array (`['Forest', 'Caves', 'Deep Void', 'Ruins', 'Desert', 'Crystal Cavern', 'Sky Ruins', 'Phase Nexus']`) and the `BIOME_PREFERENCES` table (preferred stone/wood per biome).
2. **Per-biome terrain data** in `src/gen/terrain.js` — the `BIOME_DATA` map has `{ surfaceBlock, subSurfaceBlock, depthBlock, woodChance, crystalChance, caveChance, biomeColor: [r, g, b] }` for each of the 8 biomes. The terrain generator already keys off `biomeId` per chunk (`generateChunk(chunkX, chunkZ, biomeId)`).
3. **`World.getBiome(x, z)`** in `src/core/world.js` — deterministic per-region biome assignment (hash of `floor(x / 64), floor(z / 64)` into the 8-bucket distribution: Forest 25%, Ruins 15%, Caves 15%, Desert 15%, Crystal Cavern 10%, Sky Ruins 10%, Deep Void 5%, Phase Nexus 5%). The function returns the biome id; the chunk loader (`loadOrGenerateChunk` in `World`) calls `chunk.setBiome(this.getBiome(centerX, centerZ))` and forwards the biome id to the terrain generator.
4. **`#biome-info` DOM element** in `index.html` (line 136) — currently displays a static `"BIOME: FOREST"` placeholder. The plan's §3.1 says to *read from `world.getBiome(playerPos.x, playerPos.z)` and update the text*. The element's CSS is already styled (line 74 of `index.html`).
5. **The existing skybox + fog** in `src/render/renderer.js` and `main.js` — `createSkybox(scene)` builds a `THREE.SphereGeometry(500, 32, 32)` with a `ShaderMaterial` gradient. `scene.background` and `scene.fog` are updated in `onPhaseChanged` to match the *current phase* (`PHASE_COLORS[phase]`). The §3.1 work extends this so the skybox + fog also tints by the *current biome* — layered on top of the phase tint (multiplicative or additive blend, the brief calls it out as a "biome-tinted" version of the existing phase-tinted skybox).
6. **The lighting system** in `main.js` — `lighting.phaseLight.color` is set from `PHASE_COLORS[phase]` in `onPhaseChanged`. The §3.1 work extends this so the phase light also tints by biome.

What's missing for §3.1:

- A pure helper module `src/world/biome.js` that:
  - Returns the canonical `biomeColor` for a biome id (the RGB triplet from `BIOME_DATA`).
  - Returns the canonical `biomeLabel` for a biome id (the string from `BIOME_NAMES`).
  - Returns the per-biome fog density (a tuning constant — the Forest fog is lighter than the Deep Void fog).
- A per-frame update in the game loop that:
  - Reads `world.getBiome(playerPos.x, playerPos.z)` and stores it in a module-level `currentBiomeId` (mirroring the `currentPhase` pattern).
  - Smoothly tweens `scene.background`, `scene.fog.color`, and the phase light color toward the new biome tint (the transition is a 0.5s fade — instant transitions feel janky).
  - Updates `#biome-info` text to `"BIOME: ${label}"` on biome change.
- A per-biome fog density so the Forest doesn't look as foggy as the Deep Void (each biome has its own `fogDensity` constant).
- A new debug hook `__phaseShifter__.forceBiome(biomeId)` that bypasses `world.getBiome` and pins the player to a specific biome (for Playwright testing without flying to a far-away biome).
- A new debug hook `__phaseShifter__.getCurrentBiomeId()` for test assertions.
- The §3.1 acceptance math: walking from Forest to Crystal Cavern tints the sky purple. The current `onPhaseChanged` updates `scene.background` + `scene.fog.color` + `lighting.phaseLight.color` to the **phase** color; the §3.1 work is to *also* layer the **biome** color on top, so the final skybox reads as `phase × biome` (the Forest+Alpha sky is the current green-ish, the Crystal Cavern+Alpha sky is purple-tinted green, the Deep Void+Gamma sky is yellow-tinted near-black).

The §3.1 work is therefore mostly **a pure helper + a per-frame update + a renderer extension** — mirroring the Phase 2.5/2.6/2.7/2.8 pattern (a pure module + world API + game-loop call site + renderer forwarding), with a new `#biome-info` HUD element wire.

## Acceptance (from plan §3.1)

1. **`#biome-info` displays the current biome.** The text is `"BIOME: ${label}"` where `label` comes from `BIOME_NAMES[currentBiomeId]`. Updated on biome change (not every frame — only when the biome id changes). The DOM element is the existing `#biome-info` (line 136 of `index.html`); the §3.1 work is to *update* it from `world.getBiome(playerPos.x, playerPos.z)`, not to *create* it.
2. **`scene.background` tints to the current biome.** The existing `onPhaseChanged` sets `scene.background` to `PHASE_COLORS[phase]`. The §3.1 work layers the biome color on top so the background reads as `biomeColor × phaseColor` (multiplicative blend). The transition is a 0.5s smooth tween (lerp the RGB channels toward the target each frame).
3. **`scene.fog.color` tints to the current biome.** Same pattern as `scene.background`. The fog density is also biome-specific (`fogDensity[biomeId]` from the pure helper) so the Forest is less foggy than the Deep Void.
4. **The phase light tints to the current biome.** `lighting.phaseLight.color` is also blended with the biome color (multiplicative, same as background).
5. **Walking from Forest to Crystal Cavern visibly changes the sky color.** The §3.1 acceptance math: `world.getBiome(0, 0) = BIOME_FOREST` (id 1, green tint) at the spawn; after `forcePlaceAnchor`-style walking into a Crystal Cavern region, the skybox tints to the Crystal Cavern color (purple-blue). The transition is 0.5s.
6. **The biome label updates on biome change.** The `#biome-info` text changes from `"BIOME: FOREST"` to `"BIOME: CRYSTAL CAVERN"` on a biome transition. The update fires only on the change edge (not every frame).
7. **`#biome-info` is hidden on the blocker screen.** Same pattern as `#phase-name` + `#phase-indicator` — the element is visible during gameplay but hidden when the blocker is up. The HUD already manages this for the other elements.
8. **The biome change is a debug hook.** `__phaseShifter__.forceBiome(biomeId)` pins the player to a specific biome (the test uses this; the production path uses `world.getBiome(...)`). `__phaseShifter__.getCurrentBiomeId()` returns the player's current biome id (the test asserts the change).
9. **The biome change is dt-based, not Date.now-based.** The transition tween is a per-frame `biomeTransitionTimer` accumulator (the same pattern as the §2.7 anchor lifetime + §2.8 footstep timer). Defensive: `dt` is clamped to 0.05s (the same 5-frames-at-60fps cap the game loop uses).
10. **No regression locks.** No direct chunk reads (the biome id comes from `world.getBiome(...)`). The phase-vs-biome interaction is multiplicative, not destructive — the phase change still updates the phase color first, and the biome layer is added on top.
11. **The biome tint applies to the skybox shader, not just the background.** The current `createSkybox` shader is a gradient that reads from a uniform — the §3.1 work adds a `biomeTint` uniform that the vertex/fragment shader multiplies into the gradient. The `scene.background` and `scene.fog.color` are also updated, but the visible skybox is the shader sphere.

## Fix shape

1. **`src/world/biome.js`** (new) — pure module. Exports:
   - `BIOME_TINTS` — frozen map: `biomeId → { color: [r, g, b], fogDensity: number }`. The 8 biome colors come from `BIOME_DATA[biomeId].biomeColor` (the same RGB triplets the terrain generator uses). The fog densities are tuning constants:
     - Forest: 0.006 (light haze)
     - Caves: 0.012 (medium haze)
     - Deep Void: 0.025 (thick haze)
     - Ruins: 0.008 (light haze)
     - Desert: 0.004 (very light, the desert is open)
     - Crystal Cavern: 0.014 (medium-heavy, the cavern is enclosed)
     - Sky Ruins: 0.005 (light, the sky is open)
     - Phase Nexus: 0.018 (heavy, the nexus is dense)
   - `biomeTint(biomeId)` — returns the `{ color, fogDensity }` object for the biome id. Defensive: out-of-range ids return the Forest tint (default).
   - `biomeLabel(biomeId)` — returns the canonical string from `BIOME_NAMES[biomeId]`. Defensive: out-of-range ids return `'Unknown'`.
   - `biomeFogDensity(biomeId)` — returns the fog density for the biome id. Defensive: out-of-range ids return the Forest default.
   - `lerpBiomeTints(from, to, t)` — pure function that lerps two biome tints by `t ∈ [0, 1]`. Returns a new `{ color, fogDensity }` object. The `color` is lerped component-wise; the `fogDensity` is also lerped. Used by the game loop's per-frame transition tween.
   - The re-export of `BIOME_FOREST` … `BIOME_PHASE_NEXUS` + `BIOME_NAMES` from `src/core/constants.js` for convenience.

2. **`src/core/world.js`** — no API change. The §3.1 work uses the existing `world.getBiome(x, z)` (the deterministic per-region assignment) and the existing chunk-level `chunk.biomeId` (which the terrain generator already keys off). The new pure module lives at `src/world/biome.js`.

3. **`main.js`**:
   - **Per-frame biome tick**: in `gameLoop`, after the physics update, compute `const newBiomeId = world.getBiome(physicsManager.getPos().x, physicsManager.getPos().z)`. If `newBiomeId !== currentBiomeId`, store `currentBiomeId = newBiomeId`, reset `biomeTransitionTimer = 0`, and update `#biome-info` text to `"BIOME: ${biomeLabel(newBiomeId)}"`. The per-frame transition tween: increment `biomeTransitionTimer += deltaTime`; if `t >= 0.5`, the transition is complete; otherwise lerp the current scene colors toward the target biome tint by `t / 0.5`. Apply the lerped values to `scene.background`, `scene.fog.color`, `scene.fog.density`, and `lighting.phaseLight.color`. The phase color is applied first (existing code) and the biome tint is applied on top (multiplicative blend — the `phaseColor × biomeTint` formula).
   - **Blocker visibility**: the `#biome-info` element hides when the blocker is up (the HUD's existing `setUIVisible` toggle on the parent `#hud` should handle this if it's already there; if not, add it to the same `setUIVisible` call that hides the phase indicator).
   - **Debug hooks**: add `__phaseShifter__.forceBiome(biomeId)` (sets `currentBiomeId = biomeId` and resets the transition timer — the production path uses `world.getBiome(...)` so the test can pin to a specific biome without flying there), `__phaseShifter__.getCurrentBiomeId()` (returns `currentBiomeId` for the test), `__phaseShifter__.lerpBiomeTints(from, to, t)` (pass-through to the pure helper for the static test), `__phaseShifter__.biomeLabel(biomeId)` (pass-through to the pure helper).

4. **`src/render/renderer.js`** (extend `createSkybox`):
   - The `ShaderMaterial` already has uniforms — the §3.1 work adds a `biomeTint` uniform (a `THREE.Vector3` of the biome's RGB triplet) and a `phaseTint` uniform (a `THREE.Vector3` of the phase's RGB triplet). The fragment shader multiplies both into the gradient output (`finalColor = baseGradient * (biomeTint * phaseTint)`). The renderer's `setBiomeTint(tint)` and `setPhaseTint(tint)` methods update the uniforms; the game loop calls them per frame.

5. **`src/ui/hud.js`** (extend `update`):
   - `HUD.update(phaseManager, physicsManager, world)` — the new `world` parameter is the World instance (already passed in some places; the §3.1 work confirms it's plumbed through). When `world` is provided, the HUD queries `world.getBiome(playerPos.x, playerPos.z)` and updates `#biome-info` text on biome change. The HUD doesn't own the scene background / fog (those are renderer-level concerns); it only owns the `#biome-info` text element.
   - The DOM element `#biome-info` is queried in the `HUD` constructor (mirror the `#phase-name` / `#phase-indicator` pattern). It's a child of the `#hud` container so the existing show/hide toggle on `#hud` works.

6. **`index.html`** — no new elements. The `#biome-info` element is already there (line 136). The §3.1 work is to *update* it from the HUD, not to *add* it.

7. **`tests/headless/test-phase31.cjs`** (new) — at least 30 checks (≥15 static-analysis + ≥15 behavioral):
   - Static: `src/world/biome.js` exports the helpers; `BIOME_TINTS` has 8 entries; `biomeTint(biomeId)` returns a non-null object for each id; `biomeLabel(biomeId)` returns the canonical string; `lerpBiomeTints(from, to, 0)` returns the `from` tint; `lerpBiomeTints(from, to, 1)` returns the `to` tint; main.js imports `biomeLabel` and `lerpBiomeTints`; the per-frame game loop has a biome tick that calls `world.getBiome`; the renderer shader has the `biomeTint` uniform; the HUD has the `#biome-info` DOM element; the debug hooks are present.
   - Behavioral: `lerpBiomeTints(Forest, CrystalCavern, 0.5)` returns the mid-point color; `biomeLabel(BIOME_FOREST) === 'Forest'`; `biomeLabel(BIOME_PHASE_NEXUS) === 'Phase Nexus'`; `biomeTint(99)` returns the Forest default; `world.getBiome(0, 0)` returns a valid biome id; the biome id is stable for the same `(x, z)`; the §3.1 forceBiome hook sets `currentBiomeId` and the `#biome-info` text updates.

8. **`tests/headless/smoke.cjs`** — add a Phase 3.1 static-analysis block (≥15 checks). The process-exit gate now also requires Phase 3.1 to pass.

9. **`tests/gameplay.spec.js`** — 1 new Playwright test: `forceBiome(BIOME_FOREST)` sets `currentBiomeId = BIOME_FOREST` and the `#biome-info` text updates to `"BIOME: FOREST"` within 0.5s; `forceBiome(BIOME_CRYSTAL_CAVERN)` updates the text to `"BIOME: CRYSTAL CAVERN"`; the scene background lerps to the Crystal Cavern color (asserted via `scene.background.r/g/b`); the forceBiome debug hook is callable from the debug surface.

## Files to touch

- `src/world/biome.js` — new (pure module: `BIOME_TINTS`, `biomeTint`, `biomeLabel`, `biomeFogDensity`, `lerpBiomeTints`).
- `main.js`:
  - per-frame biome tick in `gameLoop` (`world.getBiome` + transition tween + `#biome-info` update + scene background / fog / light blend);
  - new debug hooks: `forceBiome(biomeId)`, `getCurrentBiomeId()`, `lerpBiomeTints(from, to, t)`, `biomeLabel(biomeId)`.
- `src/render/renderer.js` — extend `createSkybox` with `biomeTint` + `phaseTint` uniforms; add `setBiomeTint` + `setPhaseTint` methods.
- `src/ui/hud.js` — `HUD.update(phaseManager, physicsManager, world)` queries `world.getBiome(playerPos.x, playerPos.z)` and updates `#biome-info` text on biome change.
- `index.html` — no change (the `#biome-info` element is already present).
- `tests/headless/test-phase31.cjs` — new (≥30 checks).
- `tests/headless/smoke.cjs` — add a Phase 3.1 static-analysis block (≥15 checks) and extend the process-exit gate.
- `tests/gameplay.spec.js` — 1 new Playwright test.
- `HANDOFF.md` — Phase 3.1 closure section; "What's next — Phase 3.2".
- `PROJECT_REMEDIATION_PLAN.md` — Phase 3.1 row ✅ Done; §3 row updated to "3.1 ✅".
- `PHASE_3_2_BRIEF.md` — to be created at the start of the next session (mirrors how the previous phases deferred the next brief).

## How to verify

```bash
node --check main.js
node --check src/world/biome.js
node --check src/render/renderer.js
node --check src/ui/hud.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
node tests/headless/test-phase13.cjs   # 7/7 still pass
node tests/headless/test-phase14.cjs   # 22/22 still pass
node tests/headless/test-phase15.cjs   # 12/12 still pass
node tests/headless/test-phase16.cjs   # 21/21 still pass
node tests/headless/test-phase17.cjs   # 26/26 still pass
node tests/headless/test-phase22.cjs   # 35/35 still pass
node tests/headless/test-phase23.cjs   # 51/51 still pass
node tests/headless/test-phase24.cjs   # 46/46 still pass
node tests/headless/test-phase25.cjs   # 70/70 still pass
node tests/headless/test-phase26.cjs   # 71/71 still pass
node tests/headless/test-phase27.cjs   # 107/107 still pass
node tests/headless/test-phase28.cjs   # 87/87 still pass
node tests/headless/test-phase31.cjs   # new — Phase 3.1
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (walk from Forest to Crystal Cavern → see the sky tint shift to purple → see `#biome-info` change to `"BIOME: CRYSTAL CAVERN"`) is the user's responsibility. WebGL + the skybox shader fail in the sandbox; the headless tests cover the math + API surface.

## Reference files

- `src/core/world.js` — `world.getBiome(x, z)` is the canonical per-region biome assignment. The `World` constructor initializes `this.biomeId = BIOME_FOREST`; chunks set their own `biomeId` from `chunk.setBiome(this.getBiome(centerX, centerZ))`. The `BIOME_DATA` map in `src/gen/terrain.js` is the canonical biome data (terrain + color).
- `src/render/renderer.js` — `createSkybox(scene)` builds a sphere with a `ShaderMaterial` gradient. The §3.1 work extends the shader with `biomeTint` + `phaseTint` uniforms (a `THREE.Vector3` for each). The renderer's existing `setPhaseTint`-style pattern is the model for the new `setBiomeTint`.
- `src/ui/hud.js` — `HUD.update(phaseManager, physicsManager, world)` already takes a `world` parameter (passed in some places). The §3.1 work confirms the parameter is plumbed through to all call sites and queries `world.getBiome(playerPos.x, playerPos.z)` for the biome label update.
- `index.html` — `#biome-info` element (line 136), styled (line 74). The §3.1 work queries and updates this element; no new DOM nodes.
- `src/audio/footsteps.js` (Phase 2.8) and `src/anchor/anchor.js` (Phase 2.7) — the model for the pure-module pattern: `biome.js` is shaped the same way (no Three.js, no globals, no scene access; pure getters + pure helpers; tested in isolation).
- `main.js` — the per-frame footstep tick (Phase 2.8) and the per-frame anchor tick (Phase 2.7) are the model for the per-frame biome tick. The biome transition tween is the same accumulator pattern (the `biomeTransitionTimer` is a module-level `let`, decremented each frame by `deltaTime`).

## Common pitfalls

- **Don't replace the existing phase-tint skybox.** The §3.1 work *layers* the biome tint on top of the phase tint (multiplicative blend). Replacing the phase tint with the biome tint would regress the §2.1 acceptance ("phase shift visually changes the world color"). The shader's `finalColor = baseGradient * (biomeTint * phaseTint)` formula is the model.
- **The biome id is a hash of the region (`floor(x / 64)`), not a per-block lookup.** `world.getBiome(x, z)` returns a stable id for the same `(x, z)` chunk — the biomes are 64-block regions, not per-block. Walking 1 block doesn't change the biome; walking 64 blocks may change the biome. The test must `forceBiome(...)` to pin to a specific biome without flying.
- **The biome fog density is per-biome, not per-phase.** The §3.1 work adds a per-biome fog density so the Forest is less foggy than the Deep Void. The existing `scene.fog = new THREE.FogExp2(0x1a1a2e, 0.008)` (main.js line 89) is a phase-default; the §3.1 work overrides this with the biome density. The density lerps during the transition (the same `lerpBiomeTints` helper).
- **The biome tick is per-frame, but the `#biome-info` text update is on-change.** The biome id is read every frame (the player can walk into a new biome region), but the DOM text is updated only when the id changes (to avoid unnecessary DOM writes). The `currentBiomeId !== newBiomeId` check is the edge detector.
- **The `forceBiome(biomeId)` debug hook bypasses `world.getBiome`.** The hook pins `currentBiomeId = biomeId` directly so the test doesn't have to fly to a far-away biome. The production game loop path uses `world.getBiome(...)` for the per-frame read. The Playwright test uses `forceBiome` to test the `#biome-info` text update + the scene background lerp without spatial movement.
- **The `lerpBiomeTints` helper lerps the color + fog density.** Both fields are lerped component-wise (color RGB) or scalar (fog density). The `t` parameter is in `[0, 1]` — `0` is the `from` tint, `1` is the `to` tint. The transition is 0.5s, so `t = biomeTransitionTimer / 0.5`. The shader's `biomeTint` uniform is updated each frame from the lerped color.
- **The biome transition tween is dt-based, not Date.now-based.** Same pattern as the §2.7 anchor lifetime + §2.8 footstep timer. The `biomeTransitionTimer` is a module-level `let` (the game loop owns it). Defensive: `dt` is clamped to 0.05s (the same 5-frames-at-60fps cap the game loop uses).
- **The biome id is a number (1–8), not a string.** The constants are `BIOME_FOREST = 1` etc. The `biomeLabel` helper does the `BIOME_NAMES[id - 1]` lookup (the array is 0-indexed, the constants are 1-indexed). Defensive: `id < 1` or `id > 8` returns the Forest default.
- **The HUD doesn't own the scene background / fog.** The HUD only owns the `#biome-info` text element. The scene background / fog are renderer-level concerns and the game loop updates them per frame. The renderer forwards the biome tint to the shader uniform; the game loop forwards the lerped values.
- **The biome change is additive, not destructive.** The phase color is applied first (existing code), then the biome tint is multiplied on top. A Forest+Alpha scene is green-tinted green; a Crystal Cavern+Alpha scene is green-tinted purple; a Deep Void+Gamma scene is yellow-tinted near-black. The §3.1 acceptance math is "the sky color visibly changes" — the multiplicative blend ensures the change is visible regardless of the current phase.
- **The `biomeColor` in `BIOME_DATA` is RGB in `[0, 1]`, not hex.** The terrain generator stores it as `[0.3, 0.55, 0.3]` (Forest) etc. The §3.1 work reads from the same map and converts to the Three.js `THREE.Color` (which takes `[0, 1]` floats). The renderer's `setBiomeTint(tint)` accepts the `[r, g, b]` array directly.
- **The `getBiome(x, z)` function is deterministic per region.** `Math.floor(x / 64) * 73856093 ^ Math.floor(z / 64) * 19349663 % 10000 / 10000` is the hash. The same `(x, z)` always returns the same biome id (this is the test pin). The `forceBiome` debug hook overrides this for testing.
- **The biome transition should not interrupt mid-flight.** If the player walks through two biome regions in 0.5s, the second biome transition starts from where the first one ended (the lerp's `from` is the current scene color, not the previous biome's target). The `lerpBiomeTints` helper accepts any two tints, so the transition can chain.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.8 closure (already in the working tree at start of phase).
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 2.8 is already ✅ Done. Phase 3.1 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- `PHASE_3_2_BRIEF.md` (Stabilizers — `BLOCK_STABILIZER` checkpoints + phase collapse respawn) will be created at the start of the next session. Phase 2.8 already shipped the audio wiring (`audioManager.playCollapse` + `__phaseShifter__.forcePhaseCollapse`); §3.2 is the *state machine* + *respawn logic* on top of that audio call.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 3.1: biomes — per-biome skybox + fog tint + #biome-info HUD + forceBiome debug hook"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

If the implementation needs a follow-up commit (e.g. a smoke-test tweak discovered after the first push), commit + push again with a `Phase 3.1 follow-up: …` message. After pushing, update `PROJECT_REMEDIATION_PLAN.md` (Phase 3.1 → ✅ Done, §3 row to "3.1 ✅"), update `HANDOFF.md` (Phase 3.1 closure, "What's next — Phase 3.2"), and create `PHASE_3_2_BRIEF.md` following the same template.
