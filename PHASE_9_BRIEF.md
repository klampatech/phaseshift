# Phase 9 — Bug bash + hardening pass

> **Session goal:** Manual browser testing across Chrome / Firefox / Safari on real hardware, fix the Firefox pointer-lock audio quirk, harden edge cases found during testing, update documentation (tested browsers matrix + KNOWN_ISSUES cleanup), and improve Playwright coverage where possible. Closes the post-1.0 hardening arc before tackling §10+ (mobile, cloud saves, modding, etc.).
>
> **Parent plan:** [`PROJECT_REMEDIATION_PLAN.md`](./PROJECT_REMEDIATION_PLAN.md) §9.
> **Repo:** `/home/kyle/Development/phaseshift` (use `GIT_DIR=/tmp/phaseshift-git` for git ops — see `HANDOFF.md` §Sandbox quirks).
> **Branch:** `main` · **Tip before starting:** Phase 8 doc cleanup (`bdaa540`).
> **Remote:** `klampatech/phaseshift` (live: https://klampatech.github.io/phaseshift/).

---

## Why now

1.0 is shipped and the live deployment works, but the headless Playwright suite has 13 pre-existing WebGL failures (no GPU in CI) and the Phase 6 "manual browser verification" notes have never been exercised end-to-end. The `KNOWN_ISSUES.md` Platform section lists 3 items:

- Firefox pointer-lock behavior is finicky — audio context may need an extra click after pointer-lock on some Linux distros.
- Safari < 16 not supported (out of scope — see §Mobile below).
- Mobile not supported (out of scope — see §Mobile below).

Without a structured browser-matrix test pass, we don't know what actually breaks on real hardware. The risk register also flags "Renderer never disposes meshes" as a Phase 4.5 memory-leak risk — never audited.

---

## Sub-phases

### §9.1 — Browser testing protocol + results matrix

**Acceptance:**
- A new "Tested browsers" section in `README.md` lists every (OS / browser / version) combo that's been manually verified, with date + reviewer.
- Run an 8-scenario smoke test in **Chrome** (Linux + at least one of Windows / Mac), **Firefox** (Linux + at least one of Windows / Mac), and **Safari** (Mac only):
  1. Page loads → blocker screen appears.
  2. Click blocker → audio context initializes, music starts.
  3. WASD moves the player; mouse-look rotates the camera; camera follows the player (Phase 1.2 regression check).
  4. LMB breaks a block; RMB places a block; Shift+LMB places an anchor (Phase 2.3 / 2.7).
  5. T cycles phase; Q resonates; E holds the lens (Phase 2.1 / 2.6 / 2.5).
  6. Build a stabilizer → trigger collapse → respawn (Phase 3.2).
  7. Save game (ESC → Save) → refresh page → state restored (Phase 1.7 e2e).
  8. Walk through Forest → Crystal Cavern biome transition; `#biome-info` updates (Phase 3.1).
- File findings in a new section at the bottom of `KNOWN_ISSUES.md` titled **"🟫 Discovered in Phase 9.1"**. Each entry: browser, scenario #, observed behavior, repro steps.

**This is mostly a discovery sub-phase.** The deliverable is the matrix + log. If a test fails, classify it:
- **(a) Quick fix:** Add to §9.2 / §9.3 fix list.
- **(b) Defer:** File as an issue in `KNOWN_ISSUES.md` for a future phase.

**Files to touch:** `README.md` (new section), `KNOWN_ISSUES.md` (new "Discovered in Phase 9.1" section). No code changes unless something is a quick fix.

### §9.2 — Firefox pointer-lock + audio fix

**Acceptance:** After pointer-lock on Firefox, `audioManager.resume()` runs reliably without requiring a second click on any platform (Linux, Windows, Mac). The current "may need an extra click on some Linux distros" caveat in `KNOWN_ISSUES.md` is removed.

**Fix shape:**
1. Reproduce on Firefox Linux — open https://klampatech.github.io/phaseshift/, click the blocker, immediately try to play. Confirm audio doesn't start.
2. Diagnose: it's likely that Firefox's `pointerlockchange` event fires before the AudioContext unlock path completes. Common fixes:
   - Defer `audioManager.resume()` to the next event-loop tick via `setTimeout(() => resume(), 0)`.
   - Or add a `mousedown` / `keydown` listener that calls `resume()` on the first post-lock input event as a fallback.
3. Fix in `main.js` (the `pointerlockchange` listener) + `src/audio/manager.js` if needed.
4. Add a Playwright test in `tests/gameplay.spec.js` that boots the game in Firefox headless, simulates pointer-lock + first input, asserts the audio context state is `running`.

**Files to touch:** `main.js`, `src/audio/manager.js`, `tests/gameplay.spec.js`. New `tests/headless/test-phase9.cjs` case for the deterministic behavior (e.g., deferred resume timing).

### §9.3 — Edge case hardening

**Acceptance (drive this from §9.1 findings):**
- **Rapid input:** Spam-clicking T at >10 Hz doesn't break energy accounting (no negative energy, no double-shifts). Spam-pressing E doesn't accumulate phantom drains. Spam-clicking Q doesn't allow negative energy.
- **Chunk boundaries:** Walking from one chunk to another mid-action (breaking a block at the edge) doesn't leave orphan particles or leave the block in a partial state.
- **Save/load edge cases:**
  - Quitting during a phase-shift animation → on reload, state is consistent (no "stuck mid-shift" / no `phaseManager.state === 'shifting'` save).
  - Saving at exactly `y=0` boundary → player doesn't fall through the world.
  - Loading a save from a chunk that's since been garbage-collected → no `null.chunk` errors.
- **Tab visibility:** Backgrounding the tab during a phase collapse → on resume, the collapse finishes cleanly (not stuck on the overlay).
- **Reduced-motion:** Settings → reduced-motion on → FOV breathing + phase-shift color pulse are skipped, but the game is still playable.

**Fix shape:**
- Each bug is its own focused fix + unit test.
- Identify bugs from §9.1 first; supplement with code-reading of known weak spots: `src/core/phase.js` (energy clamp), `src/save/system.js` (save-state validation), `main.js` (visibility handler), `src/ui/hud.js` (reduced-motion path).

**Files to touch:** Depends on findings — likely `src/core/phase.js`, `src/save/system.js`, `main.js`, `src/ui/hud.js`. New `tests/headless/test-phase9.cjs` cases for each fix.

### §9.4 — Performance audit (optional — skip if time-constrained)

**Acceptance:** A performance test boots the game, walks the player in a straight line for 60 seconds, and asserts:
- Main thread FPS stays above 30 (target 60).
- Heap size doesn't grow unboundedly (assert `< 50 MB` delta from baseline).
- Chunk mesh count returns to initial after 60s of walking (no leak).

**Fix shape:**
- If heap growth is unbounded: trace the leak — likely the Phase 4.5 "Renderer never disposes meshes" risk register item.
- If FPS drops below 30: profile + identify the bottleneck (likely material recompile or shadow-map regen on biome change).
- Document findings in `PERFORMANCE.md` (new) with FPS-by-biome + memory-by-chunk-count, even if no fix is needed.

**Files to touch:** `PERFORMANCE.md` (new, optional), possibly `src/render/renderer.js` (leak fix), `src/core/world.js` (chunk lifecycle).

### §9.5 — Documentation updates

**Acceptance:**
- `README.md` has the "Tested browsers" matrix from §9.1.
- `KNOWN_ISSUES.md` has updated Platform section reflecting §9.2 fix and any §9.3 edge-case fixes.
- `GAME_SPEC.md` is still accurate. If any §9.3 finding revealed spec drift, update the spec.
- `HANDOFF.md` updated to point at this brief and to summarize the Phase 9 closure.
- `PROJECT_REMEDIATION_PLAN.md` Progress table: §9 row updated to "✅ Done".
- `PHASE_9_BRIEF.md` (this file).

**Files to touch:** All of the above. Documentation is free — if §9.1–§9.4 didn't produce any docs updates, that's a sign the testing was too shallow.

---

## Suggested execution order

1. **§9.1** (browser testing protocol) — start with this. It produces the input for §9.2 and §9.3.
2. **§9.2** (Firefox pointer-lock fix) — high value, small fix.
3. **§9.3** (edge case hardening) — driven by what §9.1 finds.
4. **§9.5** (docs) — natural wrap-up.
5. **§9.4** (perf audit) — optional; skip if §9.1 didn't surface any perf complaints.

---

## Common pitfalls

- **Don't trust the headless CI for WebGL tests.** The sandbox has no GPU. The 13 Playwright WebGL failures are real-bugs-OR-infrastructure-limitations — the manual test pass in §9.1 is the only way to know which.
- **The Firefox pointer-lock fix must not break Chromium.** Test on both.
- **§9.3 edge case hardening is high-value but low-yield.** Don't spend more than half a session on it; if a bug is complex, file it and move on.
- **§9.4 perf audit is optional for the budget.** If FPS is fine in §9.1, you can skip §9.4 entirely.
- **§9.5 docs updates are free.** If §9.1–§9.4 didn't produce any docs updates, that's a sign the testing was too shallow.
- **The user (not Codex) does the manual browser testing.** Codex can write tests + fixes but cannot open a browser in this sandbox. Drive §9.1 by handing the scenario list to the user and recording their findings.

---

## Hand-off artifacts (deliverables from this phase)

- `HANDOFF.md` — Phase 9 closure section, "Post-1.0 roadmap" updated.
- `PROJECT_REMEDIATION_PLAN.md` — §9 row ✅ Done.
- `PHASE_9_BRIEF.md` — this file (committed at start of phase).
- `KNOWN_ISSUES.md` — new "🟫 Discovered in Phase 9.1" section + updated Platform section.
- `README.md` — new "Tested browsers" matrix.
- `PERFORMANCE.md` — (optional, only if §9.4 ran).
- `tests/headless/test-phase9.cjs` — new, ~30–60 checks across §9.2 / §9.3 / §9.4.
- `tests/gameplay.spec.js` — Firefox Playwright test for §9.2.

---

## Commit & push (canonical pattern)

```bash
export GIT_DIR=/tmp/phaseshift-git GIT_WORK_TREE=/home/kyle/Development/phaseshift
cd /home/kyle/Development/phaseshift

git add -A
git commit -m "Phase 9: browser matrix + Firefox pointer-lock fix + edge case hardening + perf audit + doc updates"

TOKEN=$(grep oauth_token ~/.config/gh/hosts.yml | tail -1 | awk '{print $2}')
git remote set-url origin https://x-access-token:${TOKEN}@github.com/klampatech/phaseshift.git
git push origin main
git remote set-url origin https://github.com/klampatech/phaseshift.git
```

---

## What "Phase 9 done" looks like

- [ ] §9.1: Browser test matrix in README; findings in KNOWN_ISSUES.
- [ ] §9.2: Firefox pointer-lock audio caveat removed; Playwright Firefox test added.
- [ ] §9.3: All bugs found in §9.1 are either fixed or filed for a future phase.
- [ ] §9.4: PERFORMANCE.md exists, OR §9.4 was explicitly skipped with a note in HANDOFF.
- [ ] §9.5: HANDOFF / KNOWN_ISSUES / README / PROJECT_REMEDIATION_PLAN all reflect 1.0-tested state.
- [ ] All 23 prior headless test files still pass + new `test-phase9.cjs` passes.
- [ ] `npm run build` clean (37.80 KB gzipped main entry — should not regress).
- [ ] Live URL still serves HTTP 200.
- [ ] Post-1.0 roadmap in HANDOFF is updated (Phase 9 = ✅, §10+ candidates remain).
