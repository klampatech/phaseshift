# 🌌 PHASE SHIFTER: Complete Game Design Specification

## 1. Core Design Pillars
- **One Mechanic, Deep Mastery:** Phase-shifting is the only core interaction. Everything else (movement, exploration, puzzles, progression) orbits around it.
- **No Building, Only Shaping:** Players don't place/break blocks. They shift phases to reveal, alter, and navigate terrain.
- **Memory World:** The environment remembers phase changes. What you leave in Phase B persists when you return.
- **Calm Tension:** Serene traversal punctuated by environmental puzzle-solving and resource negotiation.

---

## 2. Gameplay Mechanics

### 2.1 Phase System (Core)
- **3 Phases (Alpha, Beta, Gamma):** The world exists in 3 overlapping dimensional layers. Each phase contains different block states:
  - **Alpha:** Default walkable terrain, stable, contains basic resources.
  - **Beta:** Walls in Alpha may be passable; floors may be gaps. Contains mid-tier resources.
  - **Gamma:** Only visible in Gamma. Contains rare resources and environmental hazards.
- **Shifting:** Right-click/hold button toggles between phases. Cycle order: Alpha → Beta → Gamma → Alpha.
  - **Visual:** Chromatic shift + camera FOV breathing + light bloom color change.
  - **Physics:** Only blocks matching current phase register for collision.
  - **Memory:** Blocks retain the phase they were last observed in. Shift back later, they're changed.
- **Phase Drain:** Rapid shifting or staying in Beta/Gamma too long charges "phase fatigue." Forces rhythm in gameplay: explore Alpha, shift to Beta for shortcuts, return to Alpha to recover.

### 2.2 Movement & Interaction
- **Locomotion:** Standard WASD + mouse look. Sprint (Shift), Jump (Space), Crouch (Ctrl).
- **Phase Step:** Small gaps (<1 block) can be crossed by shifting mid-stride to catch an invisible platform in Beta/Gamma.
- **Phase Lock:** Certain blocks "anchor" when you stand on them during a shift. They remain in your active phase temporarily, creating temporary bridges/stairs.
- **Interaction:** 
  - **Scan (E):** Highlights phase differences in nearby blocks (costs minor phase energy).
  - **Resonate (Q):** Emits a phase pulse that swaps block states in a 3×3×3 radius. High risk/reward.

### 2.3 Progression
- **Phase Amplifiers:** Unlock by finding "Resonance Cores" hidden in Gamma. Improve shift speed, reduce drain, extend Phase Lock duration.
- **Traversal Tools:**
  - **Phase Anchor:** Place temporary solid blocks in active phase (limited charge).
  - **Phase Lens:** View past shifts/decayed paths.
  - **Phase Glider:** Short gliding using Gamma's updrafts.
- **Story/Exploration:** Discover "Echoes" (memory recordings) showing what the world looked like before phase fractures. Reconstruct forgotten paths.

---

## 3. Physics & Collision System

### 3.1 Block Physics Model
- **Phase-Relative Colliders:** Each block stores 3 collision masks (one per phase). Only the active phase's mask is checked.
- **Mass & Inertia:** Some blocks are "heavy" (anchor when shifted) vs "light" (float/slide). Affects how Phase Lock behaves.
- **Friction/Sliding:** Smooth blocks (ice/glass phases) reduce traction. Players must phase-shift to gain purchase.

### 3.2 Collision Detection
- **Grid-Based:** World stored as chunked 16×16×16 grids. Each cell contains a 3-bit collision mask (phase alpha/beta/gamma).
- **Player AABB:** Checked against active phase grid. Fast O(1) lookup.
- **Phase Lock:** When standing on a block during shift, that block's collision mask is temporarily forced to active phase. Removed after N seconds or player leaves.

### 3.3 Environmental Physics
- **Phase Erosion:** Some blocks decay when observed in the "wrong" phase (e.g., stone in Beta becomes porous sand). Creates dynamic terrain.
- **Resonance Pulses:** Swaps block states based on adjacency rules (wood → rock → ore). Used for puzzle-solving.

---

## 4. World Generation & Structure

### 4.1 Procedural Generation
- **Seeded Noise:** Perlin/simplex noise generates base terrain (Alpha).
- **Phase Inversion Rules:** Beta/Gamma generated via XOR/bitmask transformations of Alpha. Ensures logical relationships (e.g., Beta gaps correspond to Alpha pillars).
- **Biome Zones:** Mountain, desert, void, and forest zones affect resource distribution and phase behavior.

### 4.2 World Layout
- **Non-Linear Exploration:** Hub-based with branching paths. Each region has a puzzle/flow requiring phase mastery.
- **Checkpoint Nodes:** "Stabilizers" restore phase energy and unlock fast-travel (shift anchors).
- **Hidden Depths:** Gamma layers contain secrets, lore, and endgame content.

### 4.3 Block Types (Examples)
| Block | Alpha | Beta | Gamma | Behavior |
|-------|-------|------|-------|----------|
| Stone | Solid | Solid | Gaps | Stable, heavy |
| Wood | Walkable | Gaps | Solid (ramp) | Decays in Beta, anchors in Alpha |
| Crystal | Fragile | Solid (bounce) | Glows (light) | Reacts to pulses |
| Obsidian | Immovable | Solid | Walkable | Phase lock anchor |
| Void | Unwalkable | Gaps | Walkable (anti-grav) | Creates updrafts in Gamma |
| Rune | Hidden | Activates | Glows | Puzzle interactable |

---

## 5. Art & Visual Direction

### 5.1 Style
- **Low-Poly Voxel + Chromatic Post-Processing:** Clean, readable silhouettes. Color palette shifts per phase:
  - **Alpha:** Warm earth tones (greens, browns, blues)
  - **Beta:** Cool neon accents (cyan, magenta, purple)
  - **Gamma:** High contrast monochrome with gold/red highlights
- **Lighting:** Dynamic per-phase lighting. Gamma has directional light sources. Post-process bloom + fog sells dimensionality.

### 5.2 Assets
- **Voxel Geometry:** 6 faces (cube). Use `THREE.BoxGeometry` with vertex colors.
- **Texture Pack:** 16×16 or 32×32 pixel art atlas. Generate 3 color variants per block type (one per phase).
- **Effects:** Particle systems for phase shifts, dust, and resonance pulses. All GPU-driven via `Points` + custom shaders.
- **No Skeletal Models:** Enemies/NPCs (if any) are voxel-avatars with simple state machines. Player character: voxel humanoid or abstract "wisp" form.

### 5.3 VFX Per Phase
- **Alpha:** Standard lighting, subtle ground fog, day/night cycle.
- **Beta:** Neon edge glow on adjacent blocks, screen-space distortion, floating dust particles.
- **Gamma:** High contrast, sharp shadows, golden particle trails on interactables, chromatic aberration.

---

## 6. UI/UX Design

### 6.1 HUD (Minimalist, Diegetic Where Possible)
- **Phase Indicator:** Subtle bar + color code (bottom center). Fills when fatigued.
- **Energy/Shield:** Thin arc around crosshair. Dips on shift, regenerates in Alpha.
- **Objective Waypoint:** Subtle beacon + distance. Phase-locked objectives glow in active phase only.
- **Mini-Map:** Top-right. Shows phase differences via color overlay. Toggleable.
- **Inventory:** Slide-out panel. Shows unlocked tools/amplifiers. Grid-based.

### 6.2 Menus
- **Main Menu:** Abstract phase-shifting ambient scene. Clean typography.
- **Settings:** Graphics (post-processing quality, draw distance), Controls, Accessibility.
- **Pause:** Quick resume. Tutorial/Controls. Map view (reveals explored regions).

### 6.3 Feedback & UX Principles
- **Readability First:** Phase changes must be instantly readable. Color, sound, and camera motion sync.
- **No Inventory Management:** Tools upgrade permanently. No stacking/sorting.
- **Fail State:** "Phase Collapse" (energy depleted) returns you to nearest Stabilizer with partial resource loss. No permadeath.

---

## 7. Audio Design

### 7.1 Sound Palette
- **Music:** Ambient, procedural generative. Each phase has distinct scale/mode (Alpha: major/dronal, Beta: minor/ethereal, Gamma: dissonant/resolving).
- **SFX:** 
  - **Shift:** Low hum + glass chime + wind rush. Pitch changes per phase.
  - **Footsteps:** Phase-dependent material sounds. Echo in Beta/Gamma.
  - **Resonance:** Deep bass + harmonic overtone series.
  - **UI:** Soft clicks, phase whooshes.

### 7.2 Spatial Audio
- **WebAudio API:** Use `pannerNode` for 3D positioning.
- **Dynamic Mixing:** Music layers intensify near Gamma anomalies or unstable terrain.

---

## 8. Progression & Content Roadmap

### 8.1 Early Game (Tutorial + Hub)
- Learn shift mechanics
- First 3 biomes (Forest, Ruins, Caves)
- Unlock Phase Lock, Resonance Pulse
- Discover first Echo (lore)

### 8.2 Mid Game (Expansion)
- 4 new biomes (Desert, Crystal Caverns, Sky Ruins, Deep Void)
- Phase Amplifiers (drain reduction, lock duration)
- Traversal Tools (Anchor, Lens, Glider)
- Puzzle complexity scales (multi-phase locks, adjacency chains)

### 8.3 Late Game (Mastery)
- Final region (Phase Nexus)
- All tools unlocked
- Lore complete (world origin, why phases fractured)
- New Game+ (randomized phase maps, hidden challenges)

---

## 9. Technical Architecture (Three.js)

### 9.1 Core Systems
```
/ src
  / core
    world.js       # Chunk manager, block storage (Uint8Array grids)
    phase.js       # Phase state machine, shift logic
    physics.js     # AABB collision, Phase Lock manager
  / render
    renderer.js    # Three.js setup, layers, render loops
    materials.js   # Phase-specific shaders, post-processing
    particles.js   # GPU-driven VFX (shifts, dust, pulses)
  / input
    controls.js    # WASD, mouse, phase shift, abilities
  / ui
    hud.js         # Phase bar, energy, inventory
    menus.js       # Main, pause, settings
  / audio
    manager.js     # WebAudio, spatial mixers, music zones
  / gen
    terrain.js     # Noise-based world gen, phase inversion
    biomes.js      # Biome rules, resource distribution
  / save
    system.js      # Save/load, seed storage, progress
```

### 9.2 Rendering Pipeline
- **InstancedMesh:** 3 instances per chunk (one per phase). 1024 blocks/chunk → 3072 instances max. Culling via `frustumCulled`.
- **Layers:** `scene.layers` toggle visibility. Shift = `layer.enable/disable`.
- **Shaders:** Custom vertex/fragment for phase color mapping. Uniforms: phase, time, lightPos.
- **Post-Processing:** `EffectComposer` → RenderPass → UnrealBloomPass → ShaderPass (chromatic aberration, vignette).

### 9.3 Performance Targets
- **Frame Rate:** 60fps on integrated graphics.
- **Draw Calls:** < 50 per view (instancing + batching).
- **Memory:** < 200MB base. Chunk loading/unloading on player distance.
- **Loading:** Preload chunks in background. Async world gen.

### 9.4 Build & Deployment
- **Bundler:** Vite + Three.js r160+
- **Polyfills:** None needed (modern browsers).
- **Platform:** WebGL2. Mobile fallback (reduced draw distance, baked lighting).
- **Storage:** IndexedDB for saves. LocalStorage for settings.

---

## 10. Scope & Milestones

### Phase 1: Prototype (Weeks 1-2)
- Basic voxel grid + 3-phase visibility
- Player movement + phase shifting
- Phase Lock mechanic
- Minimal UI + controls

### Phase 2: Core Loop (Weeks 3-5)
- World generation + biomes
- Block types + physics
- Resonance Pulse + Phase Drain
- Basic audio + post-processing

### Phase 3: Content & Polish (Weeks 6-8)
- Full progression + tools
- UI/HUD complete
- Saves + menus
- Performance optimization

### Phase 4: Release Prep (Weeks 9-10)
- Bug fixing + testing
- Accessibility tweaks
- Deploy to web (GitHub Pages / Netlify)

---

## 11. Known Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Performance on low-end devices | Chunk LOD, disable post-processing option, limit render distance |
| Phase confusion for players | Clear color coding + subtle tutorials + mini-map overlay |
| Repetitive gameplay | Vary block behaviors, puzzle complexity, and biome rules |
| Scope creep | Strictly limit to 1 player, 6 biomes, 3 phases, no multiplayer |

---

*Last Updated: 2024*
*Status: Approved for Prototyping*
