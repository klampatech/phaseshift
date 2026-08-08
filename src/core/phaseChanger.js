// ============================================================================
// REFERENCE IMPLEMENTATION — DO NOT IMPORT.
//
// This module is the orphan "GameEngine" code path (see
// PROJECT_REMEDIATION_PLAN.md, Phase 0). The active game loads from
// `main.js` at the repo root, which wires `src/core/world.js`,
// `src/core/phase.js`, and `src/core/physics.js` as the single source of
// truth. The features in this file (Particles, Phase Lock, Resonance
// pulses, Echo collectibles, Phase Collapse) are ported into the active
// path one at a time; this file is the *reference* for those ports, not
// the authority.
//
// Policy:
//   - Do not add `import { ... } from '...this file...'` anywhere.
//   - If a feature here is needed, port it into the active path first
//     and add tests, then delete or further quarantine this file.
//   - If you need to delete or rename this file, do so as a separate PR.
// ============================================================================

// Phase Changer - wraps PhaseManager from phase.js
import { PhaseManager } from '../core/phase.js';

export class PhaseChanger extends PhaseManager {
}
