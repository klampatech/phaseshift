# Phase 8 — Starting Brief

> **Session goal:** Implement Phase 8 — Polish + community. §8.1 (Tutorial skip button), §8.2 (Post-collapse invulnerability window), §8.3 (Audio context restart on tab-resume), §8.4 (Settings "Reset to defaults" button), §8.5 (Compass distance indicator), §8.6 (Tutorial hint re-trigger on ring re-enter), §8.7 (Footstep volume scales with block density), §8.8 (Cleanup KNOWN_ISSUES.md now-resolved items).
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §8.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 7 closure (`bbce4b8`).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 1.1–7 shipped the entire §0–§7 plan: the core mechanics, the per-biome visual layer, audio cues, every Phase tool (Anchor, Lens, Resonance, Collapse, Stabilizers, Echoes, Resonance Cores, Phase Lock, Phase Glider, Tutorial Zone), the Settings menu, the data-driven minimap, the full-state save system, code-splitting, the 3-Act progression system, and the focused test suite. Phase 7 added the README + KNOWN_ISSUES + CI.

But the 1.0 release is missing the "polish + community" items. The acceptance from the plan's post-1.0 roadmap is:

> **Acceptance:** address the 🟧 Major + 🟨 Minor items in `KNOWN_ISSUES.md`.

The current `KNOWN_ISSUES.md` has 3 Major items (tutorial skip button, post-collapse invuln window, audio restart on tab-resume) + 4 Minor items (settings reset, compass distance, tutorial hint repeat on re-enter, footstep volume scaling) + 1 stale item ("Quit to Title is a refresh" — actually already fixed in the Phase 4.1 implementation; the comment in HANDOFF.md is outdated).

The codebase has substantial scaffolding already in place:

1. **Tutorial state** in `src/tutorial/tutorial.js` — `createTutorialState()`, `startTutorial()`, `tickTutorial()`, `clearTutorial()`. The Phase 3.6 work added the 8-hint walkthrough.
2. **Tutorial HUD** in `src/ui/hud.js#setTutorialHint` / `clearTutorialHint` — fades the hint in/out.
3. **Collapse state** in `src/collapse/collapse.js` + `main.js#forcePhaseCollapse` — the §3.2 audio + teleport + respawn cycle.
4. **Audio context** in `src/audio/manager.js` — `resume()` + `startAmbientMusic(phase)` already exposed. The `pointerlockchange` listener already calls `resume()`.
5. **Settings menu** in `src/ui/hud.js#renderSettingsMenu` — sliders + toggles + a Close button (no reset).
6. **Compass** in `src/ui/hud.js#updateCompass` + `src/progression/goals.js#compassBearing` — points at the nearest unfinished marker; distance is computed but not displayed.
7. **Footstep material** in `src/audio/footsteps.js` — `FOOTSTEP_MATERIALS` (stone/wood/crystal/void) with per-material filters; volume is currently constant.

What's missing for §8:

- A `skipTutorial()` debug hook + a UI button on the tutorial hint banner.
- A `postCollapseInvulnTimer` state in the collapse state machine + suppression of energy loss in the window.
- A `visibilitychange` listener that detects tab-suspend → tab-resume + re-triggers `startAmbientMusic(phase)` instead of `resume()`.
- A "Reset to defaults" button in the Settings menu + a pure helper `defaultSettings()` that returns the canonical defaults.
- A `#compass-distance` DOM element + `hud.updateCompassDistance(targetPos, playerPos)` that shows the metric distance.
- A `_tutorialReEnter` edge detection in `tickTutorialPerFrame` that re-shows the hint when the player walks out of the ring and back in.
- A density-aware footstep volume formula in `src/audio/footsteps.js` (read neighbor cells; reduce volume when surrounded by air, increase when in dense stone).
- A `KNOWN_ISSUES.md` cleanup — remove the stale "Quit to Title is a refresh" item (the §4.1 implementation shows the blocker overlay, not a refresh).

## Acceptance (from plan §8)

1. **§8.1 Tutorial skip button.** A "Skip" button on the `#tutorial-hint` element. Clicking it calls `clearTutorial(state)` + hides the hint + emits a one-shot "Tutorial skipped" notification. The `__phaseShifter__.skipTutorial()` debug hook lets the Playwright test verify the state.
2. **§8.2 Post-collapse invuln window.** After `forcePhaseCollapse()` resolves, the player has a 5-second invuln window where `setEnergy(0)` and `consumeEnergy()` no-ops. A new HUD element `#collapse-invuln` shows the remaining seconds. Debug hook `__phaseShifter__.getCollapseInvulnRemaining()` returns the timer.
3. **§8.3 Audio context restart on tab-resume.** A `visibilitychange` listener detects the `hidden → visible` transition. If the AudioContext was suspended, call `audioManager.startAmbientMusic(phase)` (not just `resume()`) so the music loop is fresh. Debug hook `__phaseShifter__.forceAudioRestart()` lets the Playwright test trigger the path.
4. **§8.4 Settings "Reset to defaults".** A "Reset" button in the Settings menu that calls `defaultSettings()` + `settings.setAll(defaults)` + re-renders the panel. The 11 defaults come from `src/settings/menu.js#SETTINGS_DEFAULTS`.
5. **§8.5 Compass distance indicator.** A `#compass-distance` element below the arrow showing the metric distance (`Math.floor(distance)` blocks). Color shifts from gray to gold when within 8 blocks (the "near pickup range" for Echoes + Cores).
6. **§8.6 Tutorial hint re-trigger on ring re-enter.** The `tickTutorialPerFrame` checks `isWithinTutorialRing(playerPos, ringCenter)`. If the player leaves the ring and returns, the current hint re-fires (resets the fade timer + sets opacity to 1).
7. **§8.7 Footstep volume scales with block density.** The `shouldPlayFootstep` helper reads the 8 horizontal neighbors of the player's feet cell. If >4 are non-AIR, boost volume to 1.0 (dense); if <2, reduce to 0.5 (sparse). A pure helper `footstepVolumeForDensity(neighborCount, total)` computes the volume.
8. **§8.8 KNOWN_ISSUES cleanup.** Remove the stale "Pause menu 'Quit to Title' is a refresh" item (the §4.1 implementation shows the blocker overlay, not a refresh). The remaining items are all addressed by this phase or by future work.

## Fix shape

1. **`src/tutorial/tutorial.js`** (extend). New export:
   - `clearTutorialAndHide(state)` — calls `clearTutorial(state)` + returns `{ ok: true, reason: 'skipped' }` for the UI button.
   - Pure helper: nothing else changes.

2. **`src/ui/hud.js`** (extend). New methods:
   - `setTutorialSkipVisible(visible)` — shows a "Skip" button on the `#tutorial-hint` element. Defensive: `typeof document !== 'undefined'` + null element no-op.
   - `setCollapseInvuln(remaining)` — updates the `#collapse-invuln` element text + opacity. Hidden when `remaining <= 0`.
   - `setCompassDistance(distanceBlocks, inRange)` — updates the `#compass-distance` element text + color.

3. **`src/collapse/collapse.js`** (extend). New exports:
   - `POST_COLLAPSE_INVULN_DURATION = 5.0` — the §8.2 constant (5 seconds).
   - `createInvulnState()` — returns `{ active: false, remaining: 0 }`.
   - `startInvuln(state)` — sets `active = true, remaining = POST_COLLAPSE_INVULN_DURATION`.
   - `tickInvuln(state, dt)` — decrements `remaining` by `dt`; sets `active = false` when `remaining <= 0`.
   - `isInvulnActive(state)` — boolean.

4. **`main.js`** (extend). Per-frame:
   - Call `tickInvuln(invulnState, deltaTime)` after `tickCollapse(...)`.
   - When `invulnState.active`, suppress energy loss: `phaseManager.setEnergy(0)` and `consumeEnergy()` become no-ops via a `isInvulnActive` check.
   - `hud.setCollapseInvuln(invulnState.remaining)` per frame.
   - `document.addEventListener('visibilitychange', ...)` — on `document.visibilityState === 'visible'`, call `audioManager.startAmbientMusic(phaseManager.getCurrentPhase())` instead of `audioManager.resume()`.
   - Tutorial re-enter detection: if `tutorialState.active && !wasInRingLastFrame && isInRingNow`, call `hud.setTutorialHint(hint, hintIndex)` to re-fire.
   - Compass distance: compute `Math.floor(distance(playerPos, targetPos))` and call `hud.setCompassDistance(distance, inRange)`.

5. **`src/settings/menu.js`** (extend). New export:
   - `defaultSettings()` — returns a fresh object with all 11 defaults (the canonical `SETTINGS_DEFAULTS` shape).

6. **`src/ui/hud.js#renderSettingsMenu`** (extend). Add a "Reset to defaults" button. Click handler calls `cb('settingsReset', defaults)`. The `applySettingsChange` in main.js calls `settings.setAll(defaults)` on the `settingsReset` key.

7. **`src/audio/footsteps.js`** (extend). New exports:
   - `footstepVolumeForDensity(neighborCount, total = 8)` — returns a `0.5..1.0` multiplier based on `neighborCount / total` (linear lerp).
   - `countNeighbors(world, x, y, z, phase)` — pure helper that counts the 8 horizontal neighbors of the cell at `(x, y, z)`.

8. **`main.js#performFootstep`** (extend). Read the neighbor count, compute the volume multiplier, pass it to `audioManager.playFootstep(material, volume)`.

9. **`index.html`** (extend). Add the new DOM elements:
   - `#compass-distance` (positioned below the arrow, smaller font, monospace).
   - `#collapse-invuln` (positioned at top-center, fades out when `remaining <= 0`).
   - `#tutorial-skip-btn` (a small "Skip" button on the tutorial hint).

10. **`KNOWN_ISSUES.md`** (edit). Remove the "Pause menu 'Quit to Title' is a refresh" item from the 🟨 Minor section. Update the 🟧 Major section to mark the tutorial skip + post-collapse invuln + audio restart items as "Fixed in §8.x" with a commit hash.

11. **`tests/headless/test-phase8.cjs`** (new). Covers:
    - Pure module helpers (`defaultSettings`, `footstepVolumeForDensity`, `createInvulnState` + `tickInvuln`).
    - main.js integration: `settingsReset` handler, `forceAudioRestart` debug hook, `skipTutorial` debug hook, `getCollapseInvulnRemaining` debug hook.
    - src/tutorial/tutorial.js: `clearTutorialAndHide` returns `{ ok: true, reason: 'skipped' }`.
    - src/collapse/collapse.js: `tickInvuln` decrements + deactivates.

12. **`PHASE_8_BRIEF.md`** (this file).

13. **`HANDOFF.md`** (Phase 8 closure section; "What's next — §9 mobile touch or §10 cloud saves").

14. **`PROJECT_REMEDIATION_PLAN.md`** (§8 row updated to "✅ Done").

## Outcome of Phase 8

The 1.0 release is now genuinely polished:

- **Tutorial** can be skipped at any time. The hint re-fires when the player walks out of the ring and back in.
- **Phase Collapse** is forgiving — 5s post-collapse invuln window prevents the player from re-collapsing immediately.
- **Audio** doesn't drift when the tab is backgrounded → resumed.
- **Settings** can be reset to defaults in one click.
- **Compass** shows the distance to the nearest marker, with a color shift at 8 blocks.
- **Footsteps** scale with block density (dense stone = louder, sparse air = quieter).
- **KNOWN_ISSUES** no longer lists the stale "Quit to Title" item.

The repo is now ready for either §9 (mobile touch) or §10 (cloud saves) as the next session.

## Test counts

- 22 headless test files, **1271 checks** (pre-Phase 8). Phase 8 adds `tests/headless/test-phase8.cjs` (target: ~30 checks).
- 1 new Playwright test for the 5 polish items (skip tutorial, post-collapse invuln, audio restart, settings reset, compass distance).

## Critical decisions

- **Post-collapse invuln is 5 seconds.** The plan said "5s post-collapse invulnerability window would improve UX" — using 5s is a sweet spot (long enough to be useful, short enough not to feel punitive). The window suppresses `setEnergy(0)` + `consumeEnergy()` but does NOT suppress the energy regen — the player can recover naturally.
- **Audio restart re-triggers `startAmbientMusic(phase)`** — not `resume()` — because `resume()` only un-suspends the AudioContext; the music loop may have drifted out of sync. Re-triggering from the phase tells the WebAudio API to start a fresh loop.
- **Compass distance is `Math.floor(distance)` blocks.** The brief says "shows the metric distance" — `Math.floor` gives a clean integer display. The color shifts from `#888` to `#ffcc00` at 8 blocks (the "near pickup range" for Echoes + Cores).
- **Tutorial re-enter resets the hint fade timer.** The hint banner's `opacity: 1` + 8s fade-out restarts on ring re-enter. The hint INDEX does not reset (the tutorial is still on the same step); only the fade timer.
- **Footstep density is the count of 8 horizontal neighbors.** Vertical neighbors are excluded (the player is on top of a block; the 8 horizontal cells are the "around" cells).
- **Settings reset uses `setAll` not per-key set.** The `setAll(defaults)` pattern is faster + simpler than 11 individual `set(key, default)` calls. The `setAll` method already exists in `src/save/settings.js` (added in Phase 4.2).
- **KNOWN_ISSUES is updated but the Major items stay.** The §8 work FIXES the 3 Major + 3 of the 4 Minor items, but the doc still tracks the items (with "Fixed in §8" notes) so the changelog is visible.

## Common pitfalls

- **The tutorial Skip button must not fire after the tutorial completes.** The `skipTutorial()` debug hook checks `tutorialState.active` first; if `!active`, the hook is a no-op.
- **The post-collapse invuln is per-collapse, not global.** Each `forcePhaseCollapse()` call starts a new invuln window. Two consecutive collapses reset the timer.
- **The audio restart must check `audioManager.initialized` first.** If the blocker has not been clicked (the AudioContext has not been created), the `visibilitychange` listener is a no-op.
- **The compass distance element must hide when there's no target.** The `updateCompass(targetPos, playerYaw, playerPos)` returns null when there's no target; the distance element follows the same contract.
- **The footstep density check must run AFTER the footstep is triggered (not before).** The neighbor count is read at footstep time (the same time as the material lookup).
- **The settings reset must call `applySettingsChange('settingsReset', defaults)`.** The existing `applySettingsChange` handler in main.js already handles per-key `set(key, value)`; the new key `settingsReset` is a special case that calls `setAll(defaults)` instead.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 7 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table: §8 row updated to "✅ Done".
- `PHASE_8_BRIEF.md` (this file).

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 8: polish — tutorial skip + post-collapse invuln + audio restart + settings reset + compass distance + tutorial re-enter + footstep density"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```
