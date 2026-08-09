# Phase 2.1 — Starting Brief

> **Session goal:** Implement Phase 2.1 — Phase shift.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.1.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 1.7 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Right-click is the only thing in place for phase shifting. The `main.js` `contextmenu` listener calls `phaseManager.cyclePhase()`, but several §2.1 acceptance items are still open:

- The post-processing shader's `uPhase` uniform is not driven by the current phase.
- The HUD already has `#phase-name` and `#phase-indicator` slots, but neither the color nor the post-FX color grading tracks the active phase.
- `audioManager.playShift(phase)` is referenced nowhere; the existing audio system is silent during a shift.
- The ~1.5 s shift animation is not visibly tied to player input (no FOV breathing, no chromatic aberration, no shader tint).
- Spamming right-click while a shift is mid-flight is currently a no-op (`cyclePhase()` early-returns if `_isShifting`), but no test exists for the spam guard, and the integration is informal.

A few mechanics that are prerequisites for phase mechanics in §2.2+ (block place/break, scan, resonance) rely on the phase manager being authoritative and the HUD being correct, so locking §2.1 down first prevents later phases from being written against the wrong invariants.

## Acceptance (from plan §2.1)

1. Right-click (`Pointer Lock` mode) cycles `ALPHA → BETA → GAMMA → ALPHA`.
2. The shift takes ~1.5 s with a visible color transition (shader tint + HUD + audio).
3. The HUD shows the current phase name (`#phase-name`) and color (`#phase-indicator`).
4. The post-processing shader's `uPhase` uniform is updated on every shift.
5. `audioManager.playShift(phase)` plays on cycle completion.
6. Spamming right-click while shifting is ignored (no double-shift, no energy double-spend).
7. (Implicit) `tests/headless/test-phase12.cjs` (17/17), `test-phase13.cjs` (7/7), `test-phase14.cjs` (21/21), `test-phase15.cjs` (12/12), `test-phase16.cjs` (21/21), and the Playwright suite (31/31) still pass.

## Fix shape

1. **HUD wiring** (`main.js#onPhaseChanged`, `src/ui/hud.js`)
   - The `onPhaseChanged` listener already updates `#phase-name`. Extend it to also update `#phase-indicator`'s background color and `#phase-name`'s text color.
   - The current `colors` array uses hex strings; convert to RGB numbers for the indicator dot.
2. **Post-processing** (`src/render/renderer.js#setupPostProcessing`)
   - Expose a `setPhase(phase)` (or update via a callback) so the shader's `uPhase` uniform follows the active phase.
   - In `main.js#onPhaseChanged`, call `postProcessing.setPhase(phase)` after the HUD update.
3. **Audio** (`src/audio/manager.js`)
   - Add `playShift(phase)`. Use a short tone per phase (Alpha = soft pad, Beta = bright bell, Gamma = distorted noise burst) via the existing WebAudio context.
   - Trigger from `main.js#onPhaseChanged` (or from `phaseManager.addListener` in the right place).
4. **Spam guard** (`src/core/phase.js#cyclePhase`)
   - Already early-returns when `_isShifting`; add a unit test that proves two calls in quick succession produce exactly one shift.
5. **Visual transition**
   - Use the existing shift animation in `PhaseManager` (`_shiftProgress` already exists). Drive a CSS transition on the body background or a fullscreen overlay div with `rgba(phaseColor, 1 - shiftProgress)` so the player gets a visible ~1.5 s color pulse.
6. **Add `tests/headless/test-phase17.cjs`**
   - Static checks: `playShift(phase)` defined in `AudioManager`; `setPhase` or equivalent uniform update defined on the post-processing module; `cyclePhase` early-returns while shifting.
   - Behavioral checks: two `cyclePhase()` calls within one frame produce exactly one phase change and consume `PHASE_SHIFT_COST` once.
7. **Extend `tests/headless/smoke.cjs`** with the same static-analysis checks.
8. **Extend the Playwright suite** if there is a visible HUD change to assert (optional — at minimum, ensure the existing 31 tests still pass).

## Files to touch

- `src/audio/manager.js` — add `playShift(phase)`.
- `src/render/renderer.js` — expose `setPhase(phase)` on the post-processing handle; the existing `setupPostProcessing` may already return an object.
- `src/core/phase.js` — no API change, but unit test the spam guard.
- `src/ui/hud.js` — extend the `update`/`onPhaseChanged` listener to refresh `#phase-indicator` background.
- `main.js` — wire `audioManager.playShift` + `postProcessing.setPhase` into `onPhaseChanged`.
- `index.html` — confirm `#phase-indicator` is present (it should be, per Phase 1.1 acceptance).
- `tests/headless/test-phase17.cjs` — new.
- `tests/headless/smoke.cjs` — extend with Phase 2.1 checks.

## How to verify

```bash
node --check main.js
npm run build
node tests/headless/test-phase12.cjs
node tests/headless/test-phase13.cjs
node tests/headless/test-phase14.cjs
node tests/headless/test-phase15.cjs
node tests/headless/test-phase16.cjs
node tests/headless/test-phase17.cjs
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (visually seeing the color transition on right-click, hearing the audio cue, confirming the shader tint) is the user's responsibility.

## Reference files

- `src/core/phase.js` — `cyclePhase()`, `_isShifting`, `_shiftProgress`, `_notifyListeners`. The `completeShift()` test hook is also here.
- `src/core/constants.js` — `PHASE_NAMES`, `PHASE_COLORS`, `PHASE_SHIFT_COST`, `PHASE_REGEN_RATE_ALPHA`.
- `src/audio/manager.js` — current audio API. The existing init/resume paths are not phase-aware.
- `src/render/renderer.js` — `setupPostProcessing(renderer, scene, camera)`. Confirm whether it returns a handle; if not, refactor to return one.
- `main.js#onPhaseChanged` (around line 350) — current listener. Add audio + post-processing hooks here.
- `PROJECT_REMEDIATION_PLAN.md` §2.1 — the canonical spec.
- `HANDOFF.md` — sandbox quirks and broader context.

## Common pitfalls

- **Don't break the `__phaseShifter__.forceCyclePhase` debug hook.** The Playwright suite uses it to drive shifts without pointer lock. Any change to `cyclePhase` should keep the test hook working (it calls `cyclePhase` followed by `completeShift`).
- **Don't introduce a second source of truth for the active phase.** `PhaseManager._currentPhase` is the only authority. The HUD, post-processing, and audio all read from `PhaseManager`, not from any local state.
- **The right-click listener is `document.addEventListener('contextmenu', ...)` and `e.preventDefault()`s the browser menu. Don't replace it with a `mousedown` handler without preserving the `e.preventDefault()` call** — the browser context menu would otherwise appear.
- **Spam guard test must not depend on real time.** Use `completeShift()` to force the shift to finish, or call `cyclePhase` twice in the same tick and assert the second call returned `false` (the current return value, not a thrown error).
- **Static-analysis regex will break if Vite minifies.** Source-level checks against `src/audio/manager.js` (NOT the dist bundle) are robust — same approach as Phases 1.2–1.7.
- **Don't break the existing HUD tests.** The `#phase-name` text still must contain `ALPHA` on init. The `#phase-indicator` background color should change to match `PHASE_COLORS[phase]` on shift.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 1.7 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table marks Phase 1.7 ✅ Done and Phase 2 — Core mechanics 🚧 In progress.
- Phase 1.6 brief (`PHASE_1_6_BRIEF.md`) remains in the repo for history; remove or archive it when Phase 2 lands.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.1: phase shift (HUD + shader + audio + spam guard)"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.1 → ✅ Done), update `HANDOFF.md` for Phase 2.2 hand-off, and create `PHASE_2_2_BRIEF.md` following the same template.
