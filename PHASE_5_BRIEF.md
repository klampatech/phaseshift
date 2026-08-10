# Phase 5 — Starting Brief

> **Session goal:** Implement Phase 5 — Make it enjoyable. §5.1 (Goals + Progression: 3 Acts, HUD objective, compass), §5.3 (Audio polish: per-phase ambient + footstep filters + shift pitch — already partially wired), §5.4 (Visual polish: FOV breathing on shift), §5.5 (Accessibility: reduced-motion mode + HUD opacity slider + color-blind-friendly phase indicators).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §5.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 4 closure (`434846b`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–4 shipped the core mechanics, the per-biome visual layer, audio cues, Phase Anchor, Phase Lens, Resonance pulse, Phase Collapse state machine, Echoes, Resonance Cores, Phase Lock + Phase Glider, Tutorial Zone, the Settings menu, the data-driven minimap, the full-state save system, and code-splitting. But the §5 plan ("Make it enjoyable") is the first session-sized piece of the "give the player a reason to keep playing" arc. The acceptance is:

> **Acceptance (from plan §5):** the player feels directed without being hand-held.

The codebase has substantial scaffolding already in place:

1. **`HUD.update(...)`** — owns the DOM. Phase 5.1 adds `updateObjective(goalState)` + `updateCompass(targetPos, playerYaw, playerPos)`.
2. **`#objective` element** in `index.html` — Phase 2.6 wiring (placeholder).
3. **`Settings` class** — already extended in Phase 4.2. Phase 5.5 adds the `reducedMotion` toggle.
4. **`AudioManager.playShift(phase)`** — Phase 2.8 already does per-phase shift pitch (110/165/220 Hz). Phase 5.3 confirms the audio polish.
5. **`AudioManager.playFootstep(material)`** — Phase 2.8 already does per-material footstep filters. Phase 5.3 confirms.
6. **`onPhaseChanged` in main.js** — Phase 5.4 adds FOV breathing start.

What's missing for §5:

- A pure helper module `src/progression/goals.js` that:
  - Owns the 3 Acts (`ACT_FIND_FIRST_ECHO`, `ACT_REACH_PHASE_NEXUS`, `ACT_MASTER_ALL_PHASES`) + their objectives.
  - Computes the current act + objective + color from the goal state.
  - Computes the compass bearing (relative to player look direction) to the nearest marker.
  - Builds the goal state snapshot from inventory + world + biomesVisited.
- HUD extensions:
  - `updateObjective(goalState)` — DOM write only on text/color change (cheap: 1 DOM write per act transition).
  - `updateCompass(targetPos, playerYaw, playerPos)` — rotates the `#compass-arrow` element to point at the nearest unfinished marker. Fades out when no target.
- `#compass-arrow` element + CSS in `index.html`.
- main.js wiring:
  - Module-level FOV breathing state (`fovBreathingActive`, `fovBreathingTimer`, `fovBreathingStartFov`, `FOV_BREATHING_DURATION = 1.5`, `FOV_BREATHING_PEAK = 80`, `FOV_BREATHING_BASE = 75`).
  - `tickFovBreathingPerFrame(dt)` — cycles `camera.fov` from base → peak → base over 1.5s when active. Disables in reduced-motion mode.
  - `tickGoalsPerFrame(dt)` — calls `hud.updateObjective(goalState)` + finds the nearest marker (echo → stabilizer → resonance core) + calls `hud.updateCompass(...)`.
  - `onPhaseChanged` starts the FOV breathing (skips in reduced-motion mode).
  - Debug hooks: `buildGoalState()`, `getCurrentAct()`, `listStabilizers()`.

## Acceptance (from plan §5)

1. **§5.1 3 Acts.** Act 1: Find your first Echo (collectEchoCount >= 1). Act 2: Reach the Phase Nexus (visit the Nexus biome). Act 3: Master all phases (collect all 3 amplifiers + place a Stabilizer).
2. **§5.1 HUD objective.** The `#objective` element shows the current act's objective text + color (cyan for active, green for complete). DOM write only fires on transition.
3. **§5.1 Compass.** The `#compass-arrow` element rotates to point at the nearest unfinished marker (echo, stabilizer, or resonance core). Fades out when no target.
4. **§5.4 FOV breathing.** Camera FOV cycles 75 → 80 → 75 over 1.5s on each phase shift. `tickFovBreathingPerFrame` updates `camera.fov` per frame.
5. **§5.5 Reduced-motion.** The Settings menu's "Reduced Motion" toggle disables FOV breathing + chromatic aberration. `settings.getReducedMotion()` returns the current value.
6. **§5.3 Audio polish (already in §2.8).** Per-phase shift pitch (110/165/220 Hz base + 880/1320/1568 Hz chime). Per-material footstep filters (stone/wood/crystal/void).
7. **No regression locks.** All earlier phases still pass. The Settings menu (Phase 4.2) persists reduced-motion to localStorage.

## Fix shape

1. **`src/progression/goals.js`** (new — pure module). Exports:
   - `ACT_FIND_FIRST_ECHO`, `ACT_REACH_PHASE_NEXUS`, `ACT_MASTER_ALL_PHASES` constants.
   - `ACT_ORDER` (frozen array of act IDs in progression order).
   - `ACT_OBJECTIVES` (frozen map of act ID → objective string).
   - `actCompleted(act, state)` — completion predicate.
   - `currentAct(state)` — first incomplete act (or null).
   - `currentObjective(state)` — current objective string (or "All complete — explore freely.").
   - `objectiveColor(state)` — color string (cyan for active, green for complete).
   - `markerKey(x, y, z)` — canonical `"x,y,z"` key.
   - `compassBearing(playerPos, targetPos, yawRadians)` — bearing in radians relative to look direction (or null).
   - `nearestMarker(playerPos, markers)` — nearest `{x, y, z}` from the list (or null).
   - `buildGoalState(playerInventory, world, biomesVisited)` — snapshot for the HUD.
   - `TARGET_NEAREST_ECHO`, `TARGET_NEAREST_STABILIZER`, `TARGET_NEAREST_CORE`, `TARGET_PHASE_NEXUS` constants.
   - `GOAL_DEFAULTS` (frozen).
2. **`src/ui/hud.js`** (extend). Add `updateObjective(goalState)` + `updateCompass(targetPos, playerYaw, playerPos)`. Both methods query DOM defensively (no-op if `typeof document === 'undefined'`).
3. **`index.html`** (extend). Add `#compass-arrow` CSS (a CSS triangle that rotates via transform) + element.
4. **`main.js`** (extend):
   - Import `buildGoalState`, `currentAct`, `nearestMarker` from `./src/progression/goals.js`.
   - Module-level FOV breathing state + constants.
   - `tickFovBreathingPerFrame(dt)` function.
   - `tickGoalsPerFrame(dt)` function.
   - Game loop calls both ticks after the existing `tickGliderPerFrame`.
   - `onPhaseChanged` starts the FOV breathing (skips if `settings.getReducedMotion()` is true).
   - Debug hooks: `__phaseShifter__.buildGoalState()`, `__phaseShifter__.getCurrentAct()`, `__phaseShifter__.listStabilizers()`.
5. **`tests/headless/test-phase5.cjs`** (new). 58 assertions:
   - 28 §5.1 goals module (constants, actCompleted, currentAct, currentObjective, objectiveColor, markerKey, compassBearing, nearestMarker, buildGoalState, GOAL_DEFAULTS frozen).
   - 3 §5.1 HUD (updateObjective + updateCompass + import).
   - 2 §5.1 HTML (compass-arrow element + CSS).
   - 10 §5.1 main.js wiring (import + tickGoalsPerFrame + hook calls + hooks).
   - 4 §5.4 main.js wiring (FOV breathing function + call + state + constants).
   - 3 §5.5 main.js + Settings (reduced-motion + setReducedMotion + DEFAULT_REDUCED_MOTION).
   - 8 §5.1 + §5.4 misc checks.
6. **`tests/headless/smoke.cjs`** (extend). Add `phase5Ok` gate with 27 static-analysis keys + `phase5Ok` to `process.exit` gate + ACCEPTANCE SUMMARY header updated.
7. **`PHASE_5_BRIEF.md`** (this file).

## Outcome of Phase 5

The player feels directed without being hand-held. The 3 Acts give structure; the HUD objective + compass tell them what to do next; the FOV breathing makes phase shifts feel like a transition; the accessibility settings let players tune the experience.
