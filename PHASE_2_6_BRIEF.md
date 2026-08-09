# Phase 2.6 — Starting Brief

> **Session goal:** Implement Phase 2.6 — Resonance (Q) — the one-shot press that swaps phase presence on the blocks around the player.
> **Parent plan:** `PROJECT_REMEDIATION_PLAN.md` §2.6.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** working tree (Phase 2.5 closure).
> **Remote:** `klampatech/phaseshift`.

---

## Problem

Phases 2.1–2.5 shipped phase shift, phase-relative collision, per-phase place/break, save/reload memory, and the Phase Lens. The §2.6 acceptance from the plan is the Resonance mechanic — the player presses Q to *swap* phase presence on the blocks around them, and this is the bridge between "the player can see phase differences" (Phase Lens in §2.5) and "the player can do something with that data" (Anchor in §2.7).

> **Acceptance (from plan §2.6):** pressing Q in a chunk with mixed phase blocks visibly swaps them. The audio plays the resonance chord. The energy bar drops by 15.

The codebase has the *scaffolding* for this — `World.resonate(cx, cy, cz, radius)` (in the active `World`) inverts phase presence on blocks in a cubic radius. `main.js#performResonance` calls `resonate` and emits a notification. But the implementation is partial and untested:

1. `main.js#performResonance` uses a hand-rolled chunk loop that reads `chunk.alphaData` directly (the same Phase 1.5 anti-pattern Phase 2.5 refactored out of `performScan`). The chunk loop and the scan count are dead code — the actual resonance is delegated to `World.resonate(...)`.
2. `resonanceRadius = 16` is hard-coded; the plan says `radius=1` (a 3×3×3 area).
3. `wave.amplitude` and `wavePhase` references are left over from a deleted wave-FX system.
4. The visual is "the chunk meshes flash red for 2 seconds" — the plan says "a phase-colored sphere pulse on the player."
5. There's no audio.
6. **No unit tests.** `World.resonate` is exercised by the existing chunk-visual rebuild path but the swap behavior is untested in isolation.

For Phase 2.6 we need to:
- Centralize the resonance logic on `World` (or a new `src/resonance/resonate.js`).
- Add a phase-colored sphere pulse visual (port from `ParticleManager.emitResonancePulse`).
- Wire the §2.6 acceptance math (15 energy on press, refuse if insufficient).
- Wire the audio on resonance (port from `ParticleManager.emitResonancePulse`).
- Cover the new behavior with unit tests and Playwright regression tests.
- Refactor `main.js#performResonance` to delegate to the new world method instead of reading chunk data directly.

## Acceptance (from plan §2.6)

1. **Press Q (one-shot).** `World.resonate(playerX, playerY, playerZ, 1)` swaps phase presence on every block in a 3×3×3 area. A notification shows the swap count.
2. **Press Q.** Energy drops by 15. If the player has less than 15 energy, the resonance is refused and a "Insufficient energy" notification appears.
3. **Press Q.** The affected blocks visibly swap (a Stone block that was visible in Alpha becomes invisible in Alpha and visible in Beta; the chunk mesh updates within one frame).
4. **Press Q.** A phase-colored sphere pulse appears on the player (radius 1 block, fades over 1 second, color = `PHASE_COLORS[currentPhase]`).
5. **Press Q.** The audio plays the resonance chord (port from `ParticleManager.emitResonancePulse`).
6. **Press Q with no phase-different blocks in the radius.** The resonance still fires (1 energy cost), the sphere pulse still appears, the audio still plays, but no blocks are swapped. No crash.
7. **Regression:** `main.js#performResonance` no longer reads `chunk.alphaData` directly; it delegates to `World.resonate(...)` (or `src/resonance/resonate.js`).

## Fix shape

1. **`src/resonance/resonate.js`** (new) — pure module. Exports:
   - `resonateResults(playerX, playerY, playerZ, radius, world)` — returns `Array<{ x, y, z, swappedPhases: number[] }>` describing the cells that DO have phase differences and were swapped. The renderer + notification can use this for the swap count.
   - `resonateRadius()` — returns `1` (the plan's 3×3×3 area).
   - `resonateCost()` — returns `15` (the plan's energy cost; mirrors `RESONATE_COST`).
   - `resonanceSpherePulse(currentPhase)` — returns the per-frame sphere param shape `{ radius, opacity, color }` for the renderer. The sphere starts at the player position, expands from 0.2 → 1.0 block radius over 0.25s, then fades opacity 1.0 → 0 over 0.75s.

   All functions are pure so behavioral tests can run without Three.js or a global `world`.

2. **`src/render/renderer.js`** (extend `Renderer` or a new `ResonancePulse`):
   - `showResonancePulse(playerX, playerY, playerZ, currentPhase)` — creates a sphere mesh at the player position, tinted with `PHASE_COLORS[currentPhase]`, expanding + fading per `resonate.js#resonanceSpherePulse`.
   - `updateResonancePulse(dt)` — advances the per-frame fade. Called every frame in the game loop; the pulse auto-disposes when opacity reaches 0.
   - `clearResonancePulse()` — immediate dispose (used on cleanup / scene reload).

3. **`src/core/world.js`** (extend `resonate`):
   - The existing `resonate(...)` returns `void` and writes per-block. Wrap it with a counter / list so the renderer can see which cells were swapped. New `resonateWithReport(cx, cy, cz, radius, currentPhase)` returns `{ results: Array<{ x, y, z, swappedPhases: number[] }>, count: number }`. The old `resonate(...)` stays for the existing call site (back-compat).

4. **`src/core/constants.js`** — add `RESONANCE_RADIUS = 1` and `RESONANCE_PULSE_DURATION = 1.0` (the 0.25 expand + 0.75 fade).

5. **`main.js`**:
   - `performResonance` is refactored to delegate to `world.resonateWithReport(...)` (or `src/resonance/resonate.js#resonateResults`) — no more direct `chunk.alphaData` reads.
   - Insufficient energy → `phaseManager.getEnergy() < RESONATE_COST` → `hud.showNotification('Insufficient energy', '#ff8844')` and skip the resonance.
   - On success: `renderer.showResonancePulse(playerX, playerY, playerZ, currentPhase)` + `audioManager.playResonance(currentPhase)` (the audio method is added in Phase 2.6; back-port from `ParticleManager.emitResonancePulse`).
   - `ctrlState.resonating` is one-shot (not a hold). The Phase 1.1 `controls.js` already resets `resonating` to `false` on key-up, so the existing `if (ctrlState.resonating && !qKeyHeld)` pattern works.

6. **`tests/headless/test-phase26.cjs`** (new) — at least 12 tests:
   - Static: `src/resonance/resonate.js` exports the four helpers; `main.js#performResonance` no longer reads `chunk.alphaData` directly; `World.resonateWithReport` is defined; `RESONANCE_RADIUS` is defined; `RESONANCE_PULSE_DURATION` is defined; renderer has `showResonancePulse`/`updateResonancePulse`/`clearResonancePulse`.
   - Behavior on tiny world: `resonateResults` returns the expected swapped cells; `resonateRadius` returns 1; `resonateCost` returns 15; `resonanceSpherePulse` returns the right shape for a given phase and progress; `findPhaseDifferences`/`resonate` round-trip: a block in Alpha swaps to Beta (the inversion).
   - Energy: spending 15 energy on a 100-energy player leaves 85; refusing to spend below 15 leaves the player's energy unchanged.

7. **`tests/headless/smoke.cjs`** — add Phase 2.6 static-analysis block (8–10 checks).

8. **`tests/gameplay.spec.js`** — 1 new Playwright test: simulate `__phaseShifter__.forceResonate()` debug hook, assert the resonance overlay group has child meshes, the energy dropped by 15, and the swapped cells are now in the OTHER phase.

## Files to touch

- `src/resonance/resonate.js` — new (pure module).
- `src/core/world.js` — add `resonateWithReport(cx, cy, cz, radius, currentPhase)`.
- `src/core/constants.js` — add `RESONANCE_RADIUS = 1`, `RESONANCE_PULSE_DURATION = 1.0`.
- `src/render/renderer.js` — add `ResonancePulse` (sphere mesh + per-frame fade).
- `src/audio/manager.js` — add `playResonance(phase)` (port from `ParticleManager.emitResonancePulse`).
- `main.js` — refactor `performResonance`; add per-frame pulse fade; add audio wiring.
- `tests/headless/test-phase26.cjs` — new.
- `tests/headless/smoke.cjs` — Phase 2.6 static-analysis block.
- `tests/gameplay.spec.js` — 1 new Playwright test.

## How to verify

```bash
node --check main.js
node --check src/resonance/resonate.js
node --check src/render/renderer.js
npm run build
node tests/headless/test-phase12.cjs   # 17/17 still pass
node tests/headless/test-phase13.cjs   # 7/7 still pass
node tests/headless/test-phase14.cjs   # 22/22 still pass
node tests/headless/test-phase15.cjs   # 12/12 still pass
node tests/headless/test-phase16.cjs   # 21/21 still pass
node tests/headless/test-phase17.cjs   # 26/26 still pass
node tests/headless/test-phase22.cjs   # 35/35 still pass
node tests/headless/test-phase23.cjs   # 50/50 still pass
node tests/headless/test-phase24.cjs   # 46/46 still pass
node tests/headless/test-phase25.cjs   # 70/70 still pass
node tests/headless/test-phase26.cjs   # new — Phase 2.6
sudo -E -n node tests/headless/smoke.cjs
npx playwright test
```

End-to-end browser verification (press Q, see the sphere pulse + audio + swapped blocks) is the user's responsibility. WebGL fails in the sandbox; the headless tests cover the math + API surface.

## Reference files

- `src/core/world.js` — `resonate(cx, cy, cz, radius)` (already exists) is the model for `resonateWithReport`. The two are siblings: `resonate` writes, `resonateWithReport` writes + reports.
- `src/core/constants.js` — `RESONATE_COST = 15` (existing) is the energy cost. `PHASE_COLORS` is the wave tint palette.
- `src/core/game.js` (orphan, do NOT import) — `world.resonate(playerPos, 1)` + `particles.emitResonancePulse(playerPos, color)` + `audio.playResonance()` is the reference implementation. Port the algorithm and rendering pattern; do not import the module.
- `src/render/renderer.js` — `ChunkVisual.isSurrounded` and the chunk-mesh pattern are the model for `ResonancePulse`'s sphere mesh. The pulse lives in a separate THREE.Group so it can be cleared without touching chunk visuals.
- `src/input/controls.js` — `ctrlState.resonating` is set by the Q key listener's `keydown` and reset on `keyup`. Phase 2.6 reads the flag, doesn't change it.
- `src/audio/manager.js` — `playShift(phase)` is the existing one-shot audio pattern. `playResonance(phase)` is the new method, modeled on `playShift`. The reference audio is in `ParticleManager.emitResonancePulse` (orphan).
- `main.js` — `performResonance` (currently reads `chunk.alphaData` directly) and the per-frame `if (ctrlState.resonating && !qKeyHeld)` loop are the call sites to refactor.
- `PHASE_2_5_BRIEF.md` — the previous brief. The §2.5 contract (no direct `chunk.alphaData` reads in the scan loop) extends naturally to resonance: a player resonance is a real edit and the snapshot persistence is preserved.

## Common pitfalls

- **Don't import the orphan `src/core/game.js`.** The plan says to *port* features from it, not to import it. The reference implementation has a known `ppos` redeclaration bug (HANDOFF §Architectural state). Build the new code from scratch against the active `World` + `Renderer` API.
- **Don't reuse the Phase Lens overlay group for the resonance pulse.** The Phase 2.5 brief is explicit: the overlay lives in its own THREE.Group. The resonance pulse lives in a DIFFERENT group (a `ResonancePulse` instance). The two are independent — clearing the lens must not affect the pulse and vice versa.
- **The pulse must update every frame.** The sphere expands and fades over 1 second; a pulse anchored to the press frame would be static. Animate position + scale + opacity per-frame in the game loop (or in `renderer.update()`). Don't snapshot it on press.
- **The pulse must dispose when opacity reaches 0.** Otherwise the renderer leaks sphere meshes every Q press. The `updateResonancePulse(dt)` should `clearResonancePulse()` when the pulse's lifetime exceeds `RESONANCE_PULSE_DURATION`.
- **Energy deduct must be on press, not on key-up.** The brief says "15 energy per press" — a single 15-energy debit at the press frame. Don't accumulate ticks while Q is held (the spam guard in `controls.js` resets `resonating` on key-up anyway, so this is automatic).
- **The "insufficient energy" branch is a one-shot per press.** Same pattern as Phase 2.5: when energy < cost, the resonance is refused and the player is told "Insufficient energy". The notification is one-shot per press (not per-frame).
- **`resonate` is not the same as `resonateWithReport`.** The existing `resonate(...)` returns `void` and writes per-block. The new `resonateWithReport(...)` returns a report of which cells were swapped. The renderer + notification use the report; the legacy `resonate` stays for back-compat (and as the implementation behind `resonateWithReport`).
- **Don't read `chunk.alphaData` directly in `main.js`.** This was the Phase 1.5 anti-pattern; Phase 2.5 refactored it out of `performScan`. Phase 2.6 must refactor it out of `performResonance`. The refactor: `main.js#performResonance` calls `world.resonateWithReport(...)` (or `src/resonance/resonate.js#resonateResults`). The renderer gets the report; it doesn't read chunk data.
- **The pulse color comes from `PHASE_COLORS`, not a hard-coded tuple.** Phase 2.1 already exports `PHASE_COLORS` from `src/core/constants.js`. Use `PHASE_COLORS[currentPhase]` for the pulse tint so the palette stays in lockstep with the HUD indicator and the post-FX shader.
- **The audio method exists but the audio file doesn't.** `audioManager.playResonance(phase)` may be a no-op for the headless tests (no audio context). The Phase 2.6 acceptance is the visual + the energy math; the audio is a nice-to-have. If the audio file is missing, log a warning and skip the audio; the test asserts `audioManager.playResonance` is callable, not that it actually played sound.
- **Playwright can't verify the visual feedback** (no WebGL in the sandbox). The Playwright test should assert *non-visual* invariants: the swap count > 0, the energy dropped by 15, the swapped cells are now in the OTHER phase. Don't assert colors or opacities.

## Hand-off artifacts

- `HANDOFF.md` updated to point at this brief and to summarize the Phase 2.5 closure (already in the working tree at start of phase).
- `PROJECT_REMEDIATION_PLAN.md` Progress table: Phase 2.5 is already ✅ Done. Phase 2.6 will mark its own row ✅ Done in `PROJECT_REMEDIATION_PLAN.md` when it ships.
- `PHASE_2_7_BRIEF.md` (Phase Anchor / Shift+LMB) will be created at the start of the next-next session.

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 2.6: resonance (Q) — phase-color sphere pulse + 15-energy swap"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

After pushing, update `PROJECT_REMEDIATION_PLAN.md` Progress table (Phase 2.6 → ✅ Done), update `HANDOFF.md` for Phase 2.7 hand-off, and create `PHASE_2_7_BRIEF.md` following the same template.
