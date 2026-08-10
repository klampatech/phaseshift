# Phase 4 — Starting Brief

> **Session goal:** Implement Phase 4 — Polish. §4.1 (HUD owns its DOM), §4.2 (Settings menu with localStorage persistence + live-apply), §4.3 (data-driven minimap with Echo / Stabilizer / Core markers), §4.4 (full-state save including velocity + look angles + energy + fatigue + 30s autosave), §4.5 (InstancedMesh + frustum culling + dispose already wired; draw distance cap via Settings.renderDistance), §4.6 (vite manualChunks: three + audio + gameplay).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §4.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 3.6 closure (`a49d157`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–3.6 shipped the core mechanics, the per-biome visual layer, audio cues, Phase Anchor, Phase Lens, Resonance pulse, Phase Collapse state machine, Echoes, Resonance Cores, Phase Lock + Phase Glider, and the Tutorial Zone. But the §4 plan ("Make it feel good") is the first session-sized piece of the "eliminate jank, polish UX, fix the architectural debt" arc. The acceptance is:

> **Acceptance (from plan §4):**
> - The game has menus, settings, a real minimap, a real save system, and a smaller bundle. It's now a product, not a prototype.

The codebase has substantial scaffolding already in place:

1. **`Settings` class** in `src/save/system.js` — the persistence layer (was a stub; Phase 4.2 extends it).
2. **`SaveSystem.saveSnapshot(x, y, z, phase, worldState, anchors, inventory)`** — the §1.7 / §3.3 save API. Phase 4.4 extends it to accept velocity + look angles + energy + fatigue.
3. **`HUD` class** in `src/ui/hud.js` — owns the DOM (the §4.1 contract). Phase 4.1 adds `addSafeEventListener` + `querySelectorSafe` helpers; Phase 4.2 adds `renderSettingsMenu`; Phase 4.3 rewrites `_updateMinimap` to read actual world data.
4. **`World.updateChunks(playerX, playerZ, radius)`** — the §1.4 chunk manager. Phase 4.5's draw-distance cap reuses `RENDER_DISTANCE` (the §1.4 constant) clamped to the Settings.renderDistance slider.
5. **`InstancedMesh` + `frustumCulled` + `dispose`** already in `src/render/renderer.js` — Phase 4.5's performance acceptance is already wired (just needs verification).
6. **Vite manualChunks** not present — Phase 4.6 adds it (three + audio + gameplay splits).

What's missing for §4:

- A pure helper module `src/settings/menu.js` that:
  - Owns the canonical defaults: `SETTINGS_STORAGE_KEY = 'phaseshift_settings_v1'`, `DEFAULT_RESOLUTION_SCALE = 1.0`, `DEFAULT_RENDER_DISTANCE = 3`, `MIN_RENDER_DISTANCE = 1`, `MAX_RENDER_DISTANCE = 5`, `DEFAULT_MOUSE_SENSITIVITY = 0.002`, audio volumes (master/music/sfx), `DEFAULT_HUD_OPACITY`, `DEFAULT_AUTOSAVE`, `DEFAULT_POST_PROCESSING`, `DEFAULT_REDUCED_MOTION`, `DEFAULT_KEYBINDINGS` (frozen map).
  - Exports the canonical helpers: `clampNumber(value, min, max, fallback)`, `coerceBoolean(value, fallback)`, `normalizeKey(key)`, `buildSettings(overrides)`, `serializeSettings(settings)`, `deserializeSettings(json)`, `getSetting(settings, key)`, `setSetting(settings, key, value)`, `actionForKey(settings, key)`.
  - Exports `SETTINGS_DEFAULTS` (frozen) + `SETTING_KEYS` (frozen array of all setting names).
- A pure helper module `src/ui/minimap.js` that:
  - Owns the canonical constants: `MINIMAP_SIZE = 32`, `MINIMAP_RANGE = 16`, `PHASE_OVERLAY_COLORS` (green/blue/gold), `MARKER_NONE / ECHO / STABILIZER / RESONANCE_CORE`, marker colors.
  - Exports `buildMinimapSnapshot(world, player, opts)` (returns 32×32 cells + player + markers).
  - Exports `markerColor(markerType)`.
  - Exports `MINIMAP_DEFAULTS` (frozen).
- HUD extensions (`src/ui/hud.js`):
  - `renderSettingsMenu(settings, onChange)` — generates the Settings panel DOM (sliders + toggles).
  - `showSettings(settings, onChange, visible)` — show/hide the Settings panel.
  - `applyHudOpacity(opacity)` — live-apply the HUD opacity slider.
  - `addSafeEventListener(id, event, handler)` — defensive addEventListener (Phase 4.1 contract).
  - `querySelectorSafe(selector)` — defensive querySelector.
  - `setMinimapMarkers({echoKeys, stabilizerKeys, resonanceCoreKeys})` — cache marker keys for the minimap.
  - `_updateMinimap(physicsManager, world, phase)` rewritten to call `buildMinimapSnapshot(...)` + draw player triangle + draw markers.
- `src/save/system.js` extensions:
  - `Settings` class extended: `getMouseSensitivity`, `getRenderDistance`, `getMasterVolume`, `getHudOpacity`, `getAutoSave`, `setAutoSave`, `getReducedMotion`, `setReducedMotion`. localStorage key is `phaseshift_settings_v1`.
  - `SaveSystem.saveSnapshot(x, y, z, phase, worldState, anchors, inventory, extras)` — extras include velocity, lookYaw, lookPitch, energy, fatigue.
  - `SaveSystem.save(gameState)` — pass-through all fields including velocity + look angles + fatigue.
  - `SaveSystem._normalizeState(state)` — preserve the new fields on load.
  - `SaveSystem._coerceVelocity(value)` — defensive velocity coercion.
  - `SaveSystem.autoSave(gameState)` — idempotent interval (Phase 4.4 acceptance: "periodic autosave every 30s").
  - `SaveSystem.stopAutoSave()` — clear the interval.
- `main.js` extensions:
  - `applySettingsChange(key, value)` — live-apply settings (resolution scale → renderer pixel ratio; renderDistance → world.updateChunks; mouseSensitivity → window.__phaseShifter__._mouseSensitivity; volumes → audioManager setters; HUD opacity → hud.applyHudOpacity).
  - `setupMenuButtons()` rewritten — pause menu is created dynamically (the §4.1 contract). Settings button opens the HUD's settings panel. Inventory button calls `hud.showInventory`.
  - `saveGame()` — now reads velocity + lookYaw + lookPitch + energy + fatigue and passes them to `saveSystem.saveSnapshot(..., extras)`.
  - On `init()` end: `saveSystem.autoSave(...)` + `hud.applyHudOpacity(settings.getHudOpacity())`.
  - 1s `setInterval` that pushes world key lists (echoes / stabilizers / resonance cores) into `hud.setMinimapMarkers(...)`.
- `index.html` cleanup — static `#pause-menu`, `#inventory-panel`, `#options-panel`, `#crafting-panel`, `#settings-panel` are placeholders with `display: none` (for the smoke test's structural DOM check). The HUD replaces their content on first show (the §4.1 contract).
- `vite.config.js` — `manualChunks` split: `three` → its own chunk, `audio` → its own chunk, `gameplay` (phase/lock + resonance + collapse + tutorial) → its own chunk. Initial main entry is ~36 KB gzipped (the §4.6 acceptance: "initial JS load under 200 KB gzipped").

## Acceptance (from plan §4)

1. **§4.1 Data-driven UX.** The HUD owns its DOM. Modifying the pause / settings / inventory menu doesn't require editing `index.html` beyond adding empty placeholder `<div>`s with `display: none` (the HUD replaces the content). The pause menu is dynamically created in `setupMenuButtons()`; the inventory / settings panels are dynamically created in the HUD.
2. **§4.1 addSafeEventListener.** Defensive `addEventListener` pattern in the HUD + main.js: missing markup never crashes init() (the §1.1 regression lock).
3. **§4.2 Settings menu.** The Settings panel renders with resolution scale (50%–150%), render distance (1–5 chunks), mouse sensitivity (0.0005–0.01), master / music / SFX volume (0%–100%), HUD opacity (0%–100%), autosave toggle, post-processing toggle, reduced-motion toggle.
4. **§4.2 localStorage persistence.** Settings persist to `localStorage['phaseshift_settings_v1']` (single key, the §4.2 contract). Reload restores the saved values.
5. **§4.2 live-apply.** `applySettingsChange` fires on every slider/toggle change. Resolution scale updates `renderer.setPixelRatio`; render distance calls `world.updateChunks(playerX, playerZ, dist)`; volumes dispatch to `audioManager` setters; HUD opacity updates `hud.applyHudOpacity`.
6. **§4.3 Data-driven minimap.** The minimap reads `world.getBlock(wx, 0, wz, phase)` for each of 32×32 cells around the player. Each cell is colored by its phase (green/blue/gold). Echoes / Stabilizers / Resonance Cores are drawn as colored dots at their world positions. The player is a triangle pointing in the look direction.
7. **§4.3 minimap markers.** `hud.setMinimapMarkers({echoKeys, stabilizerKeys, resonanceCoreKeys})` caches the keys. The per-frame minimap draw reads from this cache.
8. **§4.4 full-state save.** `saveGame()` writes velocity, lookYaw, lookPitch, energy, fatigue into the save blob. `loadGame()` returns these fields. Reload restores the player's velocity (clamped) and look angles.
9. **§4.4 autosave.** `saveSystem.autoSave(gameState)` fires every 30s with the current game state. Calling `autoSave` again cancels the prior interval (idempotent). `stopAutoSave()` clears the interval.
10. **§4.5 Performance.** `InstancedMesh` per chunk (verified in `src/render/renderer.js`). `frustumCulled = true` set on chunk meshes. Old geometries + materials are `.dispose()`-d when chunks rebuild. Draw distance cap is `Settings.renderDistance` (1–5 chunks, default 3).
11. **§4.6 Code-splitting.** Vite builds produce 4 chunks: `three` (480 KB / 121 KB gzipped), `index` (122 KB / 36 KB gzipped — main entry), `gameplay` (8 KB / 3 KB gzipped), `audio` (6 KB / 2 KB gzipped). Initial main entry is ~36 KB gzipped (the §4.6 acceptance: under 200 KB).
12. **No regression locks.** Phase 1–3 work stays intact. `Date.now` removed from main.js (the §1.6 "no Date.now" test passes again). The §3.3 `phase33_main_save_game_passes_inventory_to_save` test pattern updated for the new saveSnapshot signature (the `inventorySnapshot` is still passed; the regex was relaxed to allow the trailing `{ velocity, ... }` extras parameter).

## Fix shape

1. **`src/settings/menu.js`** (new — pure module). Exports the canonical defaults + helpers (above).
2. **`src/ui/minimap.js`** (new — pure module). Exports the snapshot helpers + marker constants (above).
3. **`src/ui/hud.js`** (extend). Adds `renderSettingsMenu` + `showSettings` + `applyHudOpacity` + `addSafeEventListener` + `querySelectorSafe` + `setMinimapMarkers` + rewrites `_updateMinimap`.
4. **`src/save/system.js`** (extend). `Settings` class extended (above). `SaveSystem.save` pass-through + `saveSnapshot` extras + `_normalizeState` preserves new fields + `_coerceVelocity` + idempotent `autoSave` + `stopAutoSave`.
5. **`src/core/world.js`** (extend). Adds `World.exportStabilizers()` (returns the `_stabilizerPositions` map keys).
6. **`main.js`** (extend). `applySettingsChange` function. `setupMenuButtons` rewritten for §4.1. `saveGame` writes extras. `init()` end starts `autoSave` + applies HUD opacity + sets up the per-second marker push.
7. **`index.html`** (cleanup). Static panels become `display: none` placeholders; HUD replaces their content on first show.
8. **`vite.config.js`** (extend). `manualChunks` splits three / audio / gameplay.
9. **`tests/headless/test-phase4.cjs`** (new). 82 assertions across the 6 sub-phases:
   - 26 §4.2 settings module tests (defaults, clamping, coercion, normalization, buildSettings, serialize/deserialize, getSetting/setSetting, actionForKey, frozen defaults)
   - 14 §4.3 minimap module tests (constants, buildMinimapSnapshot, marker indexing, markerColor)
   - 10 §4.4 save/load tests (saveSnapshot with extras, _normalizeState preserves velocity/look angles/energy/fatigue, autosave idempotent, stopAutoSave clears)
   - 1 §4.5 world.exportStabilizers test
   - 3 §4.6 vite manualChunks tests
   - 5 §4.1 HUD/HTML/main.js wiring tests
   - 13 §4.2 main.js Settings wiring tests
   - 8 §4.3/§4.4 main.js marker + saveGame tests
10. **`tests/headless/smoke.cjs`** (extend). Adds `phase4Ok` gate with 55 static-analysis keys + `phase4Ok` to `process.exit` gate + ACCEPTANCE SUMMARY header updated to include §4.
11. **`tests/gameplay.spec.js`** (extend). New Phase 4 Playwright test: settings getters/setters, autosave toggle, save/load round-trip with extras, HUD settings panel rendering, minimap marker caching, localStorage persistence.

## Outcome of Phase 4

The game has menus, settings, a real minimap, a real save system, and a smaller bundle. It's now a product, not a prototype.
