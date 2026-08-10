# Known Issues

This document tracks known issues, intentional limitations, and out-of-scope items for Phase Shifter. Items are grouped by severity:

- 🟥 **Critical** — game-breaking; tracked here so they're not lost.
- 🟧 **Major** — significant UX or feature gap; will fix in a future phase.
- 🟨 **Minor** — polish / cosmetic; nice-to-have.
- 🟦 **Platform** — known platform limitation; documented for users.
- 🟪 **Out of scope** — explicit decision not to support.

## 🟥 Critical

_None currently tracked._

## 🟧 Major

### Tutorial is verbose but skippable

_Fixed in Phase 8.1 (commit pending)._ The Phase 3.6 tutorial now has an explicit "Skip" button on the `#tutorial-hint` banner. Clicking it calls `__phaseShifter__.skipTutorial()`, which clears the state + emits a "Tutorial skipped" notification. The hint also re-fires when the player walks out of the tutorial ring and back in (`wasInTutorialRing` edge detection).

### Phase Collapse cooldown is 30s

_Fixed in Phase 8.2 (commit pending)._ After a Phase Collapse, the player respawns with `MINIMUM_RESPAWN_ENERGY` (30) and enters a 5s post-collapse invuln window (`POST_COLLAPSE_INVULN_DURATION`). During the window, `setEnergy(0)` and `consumeEnergy()` are no-ops so the player can't re-collapse immediately. The HUD shows the remaining seconds via `#collapse-invuln`.

### Audio doesn't restart if the tab is backgrounded for >5 minutes

_Fixed in Phase 8.3 (commit pending)._ A `visibilitychange` listener now detects the `hidden → visible` transition and re-triggers `audioManager.startAmbientMusic(phase)` instead of just `resume()`. The fresh `startAmbientMusic` call resets the music loop so it doesn't drift out of sync.

## 🟨 Minor

### Settings menu has no "Reset to defaults" button

Phase 4.2 added the Settings menu (mouse sensitivity, render distance, volume, HUD opacity, reduced-motion, autosave toggle) but no reset button. The defaults are documented in `src/settings/menu.js` (`SETTINGS_DEFAULTS`).

### Compass arrow doesn't indicate distance

The compass arrow (Phase 5.1) points at the nearest unfinished marker but doesn't show distance. The color shifts when a marker is within pickup range for Echoes + Resonance Cores, but Stabilizers don't have a pickup range (they're place-anywhere).

### Tutorial hint doesn't repeat

If the player walks out of the tutorial ring during a hint and back in, the same hint won't replay (the timer is one-shot per hint index). Future work: re-show the hint if the player leaves the ring and returns within the hint window.

### Footstep volume doesn't scale with block density

`FOOTSTEP_MATERIALS` defines the four materials (stone/wood/crystal/void) but the volume is constant. Walking through dense vegetation (Forest biome) should sound different from walking across bare stone.

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

### Firefox is supported but pointer-lock behavior is finicky

Firefox's pointer-lock exit on `Esc` is reliable, but the audio context may need an extra click after pointer-lock to resume on some Linux distros.

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

## Reporting new issues

If you find a bug not on this list:

1. Check the console — most issues print a `[Phase Shifter]` log entry.
2. Use the debug hooks: `__phaseShifter__.chunkCount`, `__phaseShifter__.phase`, `__phaseShifter__.worldData`, etc.
3. File an issue at https://github.com/klampatech/phaseshift/issues with the console output + the steps to reproduce.
