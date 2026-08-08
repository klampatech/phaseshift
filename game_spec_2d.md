# 🌌 PHASE SHIFTER 2D: Design Specification

## Core Concept
A 2D top-down voxel exploration game featuring phase-shifting mechanics. The world exists in 3 overlapping dimensional layers (Alpha, Beta, Gamma), each with different block states and behaviors.

## Technical Overview
- **HTML5 Canvas** for rendering (no Three.js dependency)
- **Vanilla JavaScript** - no game frameworks
- **Single file**: `index.html` with embedded JS/CSS
- **Target**: 60fps, works on all modern browsers

## Game Structure

### 1. World System
- **Grid**: 16×16 tile grid, tile size 40px (640×640 canvas)
- **Chunked Storage**: Each block stores 3 collision states (one per phase)
- **Block Types**: 8 types with phase-dependent behaviors:
  - Stone (solid in all phases, heavy)
  - Wood (walkable in Alpha, gaps in Beta, ramps in Gamma)
  - Crystal (fragile in Alpha, bounce in Beta, glowing in Gamma)
  - Obsidian (immovable, phase lock anchor)
  - Void (unwalkable in Alpha, gaps in Beta, anti-gravity in Gamma)
  - Rune (hidden in Alpha, activates in Beta, glows in Gamma)
  - Water (slow movement, phase-stable)
  - Energy Node (resource, visible only in Gamma)

### 2. Phase System
- **Alpha**: Default phase, warm earth tones (greens, browns)
- **Beta**: Cool neon accents (cyan, magenta, purple)  
- **Gamma**: High contrast with gold/red highlights
- **Shifting**: Cycle phases, affects visibility and collision
- **Phase Drain**: Energy depletion from rapid shifting or staying in Beta/Gamma
- **Phase Lock**: Blocks "anchor" when standing on them during shift

### 3. Player
- **Movement**: WASD keys
- **Phase Shift**: Right-click or Space (hold for slow shift, quick press for instant)
- **Abilities**:
  - **Scan (E)**: Highlight phase differences (costs energy)
  - **Resonate (Q)**: Swap block states in 3×3 radius (high energy cost)
- **Energy**: Replenishes in Alpha phase, depleted by shifting/abilities

### 4. UI Elements
- **HUD**: Phase indicator, energy bar, objective marker
- **Inventory**: Slide-out panel showing tools
- **Mini-map**: 16×16 grid showing current phase view
- **Notifications**: Phase change announcements, objective updates

### 5. Progression
- **Phase Amplifiers**: Found as "Resonance Cores" (rare)
  - Improve shift speed
  - Reduce phase drain
  - Extend Phase Lock duration
- **Traversal Tools**:
  - **Phase Anchor**: Place temporary solid blocks (limited charge)
  - **Phase Lens**: View past shifts/decayed paths
  - **Phase Glider**: Short gliding using Gamma's updrafts

### 6. Biomes (3 total for prototype)
- **Forest**: Wood-heavy, abundant resources
- **Ruins**: Crystal and Rune clusters, puzzle areas
- **Caves**: Obsidian and Void zones, dangerous

## Controls Reference
| Key | Action |
|-----|--------|
| W/A/S/D | Move up/left/down/right |
| Space (hold) | Slow phase shift |
| Space (quick) | Instant phase shift |
| E | Scan (reveal phase differences) |
| Q | Resonate (swap block states) |
| F | Use Phase Anchor (place temporary block) |
| I | Toggle inventory |
| M | Toggle mini-map |
| 1/2/3 | Direct phase selection |

## Visual Design
- **Low-poly aesthetic** with clean silhouettes
- **Color coding per phase**:
  - Alpha: #5aa85a (green tones)
  - Beta: #3399e6 (blue tones)  
  - Gamma: #d9b34c (gold tones)
- **Chromatic shift animation** when switching phases
- **Particle effects** for phase shifts and abilities

## Audio (Optional)
- WebAudio API for procedural sound effects
- Phase shift: low hum + glass chime
- Footsteps: phase-dependent material sounds
- Ambient music: procedural generative per phase
