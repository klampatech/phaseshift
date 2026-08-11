# Known Issues

This document tracks known issues, intentional limitations, and out-of-scope items for Phase Shifter. **Current state:** Phase 10 P0 + P1 + P2 all shipped (14 sub-phases, 482 new headless checks). No further Phase 10 work planned — the post-1.0 Phase 11+ roadmap (touch-input, cloud saves, more biomes, modding API) is in `HANDOFF.md`. Items are grouped by severity:

- 🟥 **Critical** — game-breaking; tracked here so they're not lost.
- 🟧 **Major** — significant UX or feature gap; will fix in a future phase.
- 🟨 **Minor** — polish / cosmetic; nice-to-have.
- 🟦 **Platform** — known platform limitation; documented for users.
- 🟪 **Out of scope** — explicit decision not to support.

## 🟥 Critical

_None currently tracked as of the Phase 10 P0+P1 release._ All 🟧 Major and 🟨 Minor items from the 1.0 + Phase 8 era are resolved. The 🟧 "Gameplay mechanics (Phase 10 P2 — deferred)" section below tracks the 5 P2 sub-phases still pending from Phase 10.

## 🟧 Major

### Tutorial is verbose but skippable

✅ **Fixed in Phase 8.1** (commits `6495145`, `1706a94`). The Phase 3.6 tutorial now has an explicit "Skip" button on the `#tutorial-hint` banner. Clicking it calls `__phaseShifter__.skipTutorial()`, which clears the state + emits a "Tutorial skipped" notification. The hint also re-fires when the player walks out of the tutorial ring and back in (`wasInTutorialRing` edge detection).

### Phase Collapse cooldown is 30s

✅ **Fixed in Phase 8.2** (commits `6495145`, `1706a94`). After a Phase Collapse, the player respawns with `MINIMUM_RESPAWN_ENERGY` (30) and enters a 5s post-collapse invuln window (`POST_COLLAPSE_INVULN_DURATION`). During the window, `setEnergy(0)` and `consumeEnergy()` are no-ops so the player can't re-collapse immediately. The HUD shows the remaining seconds via `#collapse-invuln`. The follow-up commit `1706a94` extended the invuln check to `forcePhaseCollapse` (not just `forcePhaseCollapseToStabilizer`).

### Audio doesn't restart if the tab is backgrounded for >5 minutes

✅ **Fixed in Phase 8.3** (commit `6495145`). A `visibilitychange` listener now detects the `hidden → visible` transition and re-triggers `audioManager.startAmbientMusic(phase)` instead of just `resume()`. The fresh `startAmbientMusic` call resets the music loop so it doesn't drift out of sync.

## 🟨 Minor

### Settings menu has no "Reset to defaults" button

✅ **Fixed in Phase 8.4** (commit `6495145`). The Settings menu now has a "Reset" button that calls `applySettingsChange('settingsReset', defaults)` → `settings.setAll(defaultSettings())`. All 11 canonical settings keys (mouse sensitivity, render distance, volume, HUD opacity, reduced-motion, autosave toggle, etc.) are restored to their defaults from `defaultSettings()` in `src/settings/menu.js`.

### Compass arrow doesn't indicate distance

✅ **Fixed in Phase 8.5** (commit `6495145`). The compass now shows a distance label below the arrow (`#compass-distance`), driven by `hud.setCompassDistance(meters)`. Distance is colored gold when within 8 blocks (Echoes + Resonance Core pickup range).

### Tutorial hint doesn't repeat

✅ **Fixed in Phase 8.6** (commit `6495145`). `tickTutorialPerFrame` now uses `wasInTutorialRing` edge detection — when the player walks out of the tutorial ring during a hint and back in, the same hint is re-shown.

### Footstep volume doesn't scale with block density

✅ **Fixed in Phase 8.7** (commit `6495145`). New pure module exports `footstepVolumeForDensity(neighborCount)` and `countNeighbors(world, x, y, z)` in `src/audio/footsteps.js`. The footstep tick now reads the neighbor count at footstep time and scales the per-material volume accordingly — denser vegetation / more blocks around the player = louder / softer footsteps per material.

## 🟧 Gameplay mechanics (Phase 10 P2 — deferred)

**Phase 10 P2 fully shipped.** §10.10 Echo Hunter panel (`7a880ac`), §10.14 New Game+ mode (`77b3935`), §10.13 resonance charge-up (`38eb2cd`), §10.12 phase shift preview (`6cdecc6`), §10.11 wrong-phase Echoes (`b6e7dce`). The section below now only describes shipped work + the per-section followups the brief flagged.

### Echo Hunter panel (Phase 10.10) — shipped

✅ **Shipped in Phase 10.10** (commit `7a880ac`). The inventory panel now exposes a dedicated **Echo Hunter** tab with a per-biome breakdown of all 36 Echoes (5 per biome + 1 Nexus final). New `listEchoesByBiome()` helper in `src/inventory/inventory.js` collects `byBiome` / `collected` / `total` / `byBiomeCollected` / `byBiomeTotal`. New HUD methods `showEchoHunter(summary, biomeName)` + `hideEchoHunter()` + `showBiomeZoneOverlay(zoneText, ttlMs)`. The "Open Echo Hunter" button lives inside the inventory panel. **Bonus latent-bug fix:** the inventory panel's per-biome counter was previously rendered via a broken single-quoted template (always showed the static length) — now reads from the `collectedEchoes` Map correctly.

### "Wrong phase" Echoes (Phase 10.11) — shipped

✅ **Shipped in Phase 10.11** (commit `b6e7dce`). Each non-Phase-Nexus biome has 1 wrong-phase Echo (7 total) that is invisible in the wrong phase. The player must use the Phase Lens to find them; collecting one unlocks a unique lore line. The Echo is tagged with a `hiddenPhase` field in the world; `World.getEchoVisibility(key, currentPhase)` is the canonical visibility check (also used by the pickup loop + the EchoOverlay). The renderer's EchoOverlay hides wrong-phase meshes via `mesh.visible = false` so the player can't see them by looking. Phase Nexus intentionally has no hidden Echo (it already has the unique final Echo + the per-biome signature mechanics from §10.6 — adding a hidden Echo would dilute the finale). 57 new headless checks in `tests/headless/test-phase10-hidden-echoes.cjs`.

### Phase shift preview (Phase 10.12) — shipped

✅ **Shipped in Phase 10.12** (commit `6cdecc6`). New post-processing `ShaderPass` (`phaseShiftPreview`) runs after the existing phase pass. During the first 0.5s of a shift, the world renders with a desaturated + tinted ghost of the target phase (peak intensity 0.6, mix amount computed from the shift progress). The ghost fades to the live shift over the remaining 1.0s. Pure module `src/render/phaseShiftPreview.js` exposes `previewAmount(progress)` + `previewColor(phase)` + `shouldRunPreview(progress)` for testability. 48 new headless checks in `tests/headless/test-phase10-preview.cjs`.

### Resonance charge-up (Phase 10.13) — shipped

✅ **Shipped in Phase 10.13** (commit `38eb2cd`). Pressing Q now opens a 0.5s charge window during which the player sees a small / dim preview sphere (radius 0.2 → 0.6, opacity 0.3 → 0.7). Pressing Q again during the charge cancels (no energy debited, no swap). After the charge elapses the state transitions to 'committing' — the cost (now 25 energy, up from 15) is debited + the full pulse fires over the next 1.0s. Pure module `src/resonance/charge.js` exports the state-machine helpers (`createChargeState`, `startCharge`, `tickCharge`, `cancelCharge`, `commitCharge`, `isPendingCommit`, etc.). The 15→25 cost increase compensates for the preview-then-commit flow (the brief is explicit on this). 85 new headless checks in `tests/headless/test-phase10-resonance-charge.cjs`.

### New Game+ mode (Phase 10.14) — shipped

✅ **Shipped in Phase 10.14** (commit `77b3935`). The pause menu now exposes a **Start New Game+** button (gold styling) that rolls a fresh `phaseDominanceSeed` (Fisher-Yates shuffle of `[PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA]` per non-Nexus biome) and optionally toggles an `ironman` flag in the save blob. The pause-menu button calls `saveSystem.startNewGamePlus()`, which clears anchors / fuses / echoes / cores, resets player position + phase, and persists the new state. New `phaseDominanceSeed` is stored in the save blob so reloads keep the shuffle. The Phase Nexus biome is always locked to identity permutation (the §10.5 finale is deterministic). Seed=0 also returns the identity permutation (no shuffle on first playthrough = full back-compat). `__phaseShifter__.newGamePlus` debug surface (`seed` / `ironman` / `permutation` / `isShuffled` getters; `setSeed` / `setIronman` / `forceStartNewGamePlus` methods). 69 new headless checks in `tests/headless/test-phase10-newgameplus.cjs`.

**P2 fully shipped — 192 new headless checks across 3 new test files.** The Phase 10 brief at `PHASE_10_BRIEF.md` remains the source of truth for any future revisions.

## 🟦 Platform

### Mobile (Android / iOS) is not supported

**Phase Shifter requires a keyboard + mouse.** The controls are WASD + Space + Q/E/LMB/RMB + mouse-look (pointer lock). There is no touch input layer, no virtual gamepad, no mobile UI scaling.

The game also requires WebGL 2 + ES modules + AudioContext, which are present in modern mobile browsers but the control scheme is the blocking factor. Adding mobile support would require:

- Touch joystick (left thumb: move, right thumb: look) or accelerometer tilt-look
- Tap-and-hold equivalents for Q/E
- A separate mobile UI (the current HUD is sized for desktop screens)
- Reduced draw distance + LOD scaling for weaker GPUs

This is a significant scope expansion. We recommend keeping it desktop-only for now.

### Safari < 16 is not supported

Pointer Lock + AudioContext + ES Modules require Safari 16+ (released September 2022). Earlier versions have known bugs.

### Firefox is supported (pointer-lock + audio fixed in Phase 9.2)

Firefox's pointer-lock exit on `Esc` is reliable. Audio context resume after pointer-lock is now deterministic — see Phase 9.2 in `PHASE_9_BRIEF.md`. The deferred-resume path (next event-loop tick via `setTimeout(..., 0)`) + the one-shot first-input fallback listener handles the Firefox race condition where `pointerlockchange` fires before the AudioContext unlock path completes.

## 🟪 Out of scope

### Multiplayer

Phase Shifter is single-player only. No networking code, no WebSocket server, no player-to-player interactions.

### Modding / scripting API

No plugin system, no Lua/JS sandbox, no asset pipeline for custom blocks. The block registry in `src/core/constants.js` is hard-coded.

### Cloud saves

Save data is stored in `localStorage` only. No cloud sync, no account system, no cross-device persistence.

### Achievements / leaderboards

No achievement system, no Steam integration, no leaderboard. The 3-Act progression is the primary "story" mode.

### Editor / creative mode

No in-game block editor, no fly cam toggle (fly mode exists for debug only via `__phaseShifter__.flying`), no world export.

## 🟫 Discovered in Phase 9.1

The Phase 9.1 browser-matrix test pass surfaced the following items. Each is either fixed in §9.2 / §9.3 or filed for a future phase.

### Fixed in Phase 9.2 / §9.3 (closed)

- **🟦 Firefox pointer-lock audio** — `pointerlockchange` fires before the AudioContext unlock path completes on Firefox; audio didn't always start without a second click. Fixed in §9.2: deferred resume via `setTimeout(..., 0)` + one-shot first-input fallback listener. See `PHASE_9_BRIEF.md` §9.2 and the new `tests/firefox-pointer-lock.spec.js` test.
- **🟨 Phase-shift color pulse ignores reduced-motion** — the `updatePhaseShiftOverlay` function applied the full-screen color pulse regardless of the reduced-motion setting. Fixed in §9.3: respects `settings.getReducedMotion()` and skips the pulse when on. The pulse was the only Phase 5.4 reduced-motion gap (FOV breathing was already gated).
- **🟨 Loading a save at y=0 boundary** — `PhysicsManager.setPosition(0, 0, 0)` allowed the player to fall through the world floor (the per-tick check `< 0` only caught strictly-negative y). Fixed in §9.3: `setPosition` clamps y to a safe minimum (1.0) and the per-tick check is now `< 1`. The path is exercised via save → reload → next physics tick.

### Filed for a future phase (deferred)

_None currently. The §9.3 acceptance bullets (rapid input, chunk boundaries, save/load edge cases, tab visibility, reduced-motion) all passed the static-analysis + behavioral tests in `tests/headless/test-phase9.cjs` (57 checks). The §9.4 performance audit was skipped — see `HANDOFF.md` for the deferral note._

## Reporting new issues

If you find a bug not on this list:

1. Check the console — most issues print a `[Phase Shifter]` log entry.
2. Use the debug hooks: `__phaseShifter__.chunkCount`, `__phaseShifter__.phase`, `__phaseShifter__.worldData`, etc.
3. File an issue at https://github.com/klampatech/phaseshift/issues with the console output + the steps to reproduce.
