import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT,
  BLOCK_WOOD, BLOCK_CRYSTAL, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_RUNE, BLOCK_SAND,
  BLOCK_GLASS, BLOCK_IRON, BLOCK_GOLD_ORE, BLOCK_WATER, BLOCK_PHASE_COLORS,
  PHASE_COLORS, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION,
  ANCHOR_LIFETIME, ANCHOR_FILL_COLOR, ANCHOR_BORDER_COLOR } from '../core/constants.js';
import {
  anchorKey as _anchorKey,
  anchorFadeOpacity as _anchorFadeOpacity,
  anchorBorderOpacity as _anchorBorderOpacity,
} from '../anchor/anchor.js';

// Block texture colors (low-poly style)
const BLOCK_COLORS = {
  [BLOCK_STONE]:   [0x707070, 0x5a8faa, 0x888877],
  [BLOCK_GRASS]:   [0x69a859, 0x3377b3, 0x7f884d],
  [BLOCK_DIRT]:    [0x735940, 0x4d6680, 0x707059],
  [BLOCK_WOOD]:    [0x805933, 0x334d80, 0x887f33],
  [BLOCK_CRYSTAL]: [0x996699, 0x4db3e6, 0xe6cc33],
  [BLOCK_OBSIDIAN]:[0x261a33, 0x1a3366, 0x887f33],
  [BLOCK_VOID]:    [0x0d0514, 0x1a264d, 0x881a4d],
  [BLOCK_RUNE]:    [0x4d4d4d, 0x33cc99, 0xe6b333],
  [BLOCK_SAND]:    [0xbfa866, 0x668cb3, 0x887f33],
  [BLOCK_GLASS]:   [0xb3cce6, 0x4db3e6, 0xe6e67f],
  [BLOCK_IRON]:    [0x807366, 0x336680, 0x887f33],
  [BLOCK_GOLD_ORE]:[0x807f33, 0x338066, 0xe6cc33],
  [BLOCK_WATER]:   [0x335999, 0x2680cc, 0x887f33],
};

// Create simple voxel geometry (face culling)
function createBlockGeometry(blockType) {
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const colors = BLOCK_COLORS[blockType] || [0x888888, 0x888888, 0x888888];

  // 6 faces: +x, -x, +y, -y, +z, -z
  const count = 24;
  const colorArray = new Float32Array(count * 3);
  const baseColor = new THREE.Color(colors[0]);

  for (let i = 0; i < count; i += 3) {
    const faceIndex = Math.floor(i / 4);
    const phaseColor = new THREE.Color(colors[faceIndex] || colors[0]);
    colorArray[i] = phaseColor.r;
    colorArray[i + 1] = phaseColor.g;
    colorArray[i + 2] = phaseColor.b;
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
  return geom;
}

// Build InstancedMesh for a chunk's data
function buildChunkMeshes(chunk, world) {
  const phases = ['alpha', 'beta', 'gamma'];
  const colorMap = {};

  // Count blocks per type for each phase
  for (const phase of phases) {
    const data = chunk[phase + 'Data'];
    if (!data) continue;

    const blockCounts = {};
    for (let i = 0; i < data.length; i++) {
      const block = data[i];
      if (block === BLOCK_AIR) continue;
      blockCounts[block] = (blockCounts[block] || 0) + 1;
    }

    colorMap[phase] = blockCounts;
  }

  return colorMap;
}

// Create or update a chunk visual representation
export class ChunkVisual {
  constructor(scene, chunk) {
    this.scene = scene;
    this.chunk = chunk;
    this.meshGroup = new THREE.Group();
    this.meshGroup.userData.chunk = chunk;
    this.meshes = { alpha: null, beta: null, gamma: null };
  }

  updateMeshes(world) {
    // Remove old meshes
    for (const phase of ['alpha', 'beta', 'gamma']) {
      if (this.meshes[phase]) {
        this.meshGroup.remove(this.meshes[phase]);
        if (this.meshes[phase].geometry) this.meshes[phase].geometry.dispose();
        if (this.meshes[phase].material) this.meshes[phase].material.dispose();
      }
    }

    const phases = ['alpha', 'beta', 'gamma'];

    for (let p = 0; p < 3; p++) {
      const phaseName = phases[p];
      const data = this.chunk[phaseName + 'Data'];
      if (!data) continue;

      // Collect non-air blocks
      const positions = [];
      const colors = [];

      for (let i = 0; i < data.length; i++) {
        const block = data[i];
        if (block === BLOCK_AIR) continue;

        const { x: lx, y: ly, z: lz } = world.unpackIndex(i);
        const wx = this.chunk.cx * CHUNK_SIZE + lx;
        const wy = ly;
        const wz = this.chunk.cz * CHUNK_SIZE + lz;

        // Face culling: skip blocks fully surrounded by solid blocks
        if (this.isSurrounded(data, lx, ly, lz, world)) continue;

        positions.push(wx, wy, wz);

        const colorArr = BLOCK_COLORS[block] || [0.5, 0.5, 0.5];
        const c = new THREE.Color(colorArr[p] || colorArr[0]);
        colors.push(c.r, c.g, c.b);
      }

      if (positions.length === 0) {
        this.meshes[phaseName] = null;
        continue;
      }

      const count = positions.length / 3;
      // One cube instance per visible voxel. The previous implementation put
      // one vertex per block into a regular Mesh; THREE interpreted every
      // three blocks as a single triangle, leaving terrain effectively
      // invisible. Instancing renders actual voxel cubes while sharing one
      // geometry and material per phase/chunk.
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.InstancedMesh(geom, material, count);
      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();
      for (let instance = 0; instance < count; instance++) {
        const offset = instance * 3;
        matrix.makeTranslation(
          positions[offset], positions[offset + 1], positions[offset + 2]
        );
        mesh.setMatrixAt(instance, matrix);
        color.setRGB(colors[offset], colors[offset + 1], colors[offset + 2]);
        mesh.setColorAt(instance, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = true;
      mesh.userData.phase = p;
      this.meshGroup.add(mesh);
      this.meshes[phaseName] = mesh;
    }

    // Attach/detach from scene
    if (this.meshes.alpha || this.meshes.beta || this.meshes.gamma) {
      this.scene.add(this.meshGroup);
    } else {
      if (this.scene.children.includes(this.meshGroup)) {
        this.scene.remove(this.meshGroup);
      }
    }
  }

  isSurrounded(data, x, y, z, world) {
    // Check 6 neighbors
    const neighbors = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];

    let solidNeighbors = 0;
    for (const [dx, dy, dz] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_HEIGHT) {
        continue; // Edge of chunk - always render
      }
      const ni = world.localIndex(nx, ny, nz);
      if (data[ni] !== BLOCK_AIR) {
        solidNeighbors++;
      }
    }

    // Cull if surrounded on 5+ sides (face culling optimization)
    return solidNeighbors >= 5;
  }

  removeFromScene() {
    this.scene.remove(this.meshGroup);
  }
}

// Lighting setup
export function setupLighting(scene) {
  const ambient = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambient);

  // Directional light (sun)
  const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
  sun.position.set(50, 100, 30);
  sun.castShadow = false;
  scene.add(sun);

  // Phase-colored point lights for visual feedback
  const phaseLight = new THREE.PointLight(0xffffff, 0.3, 50);
  phaseLight.position.set(0, 30, 0);
  phaseLight.name = 'phaseLight';
  scene.add(phaseLight);

  return { ambient, sun, phaseLight };
}

// Post-processing setup (bloom, chromatic aberration, vignette)
export function setupPostProcessing(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom pass
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2, // strength — subtle glow without washing out the whole scene
    0.25, // radius
    0.8  // threshold — only genuinely bright highlights bloom
  );
  bloomPass.name = 'bloom';
  composer.addPass(bloomPass);

  // Custom post-processing shader (phase-based color grading + vignette)
  const phaseShader = {
    uniforms: {
      tDiffuse: { value: null },
      uPhase: { value: 0.0 },
      uResonating: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uPhase;
      uniform float uResonating;
      varying vec2 vUv;

      // Simple vignette
      float vignette(vec2 uv, float strength) {
        vec2 center = uv - 0.5;
        float dist = length(center) * 2.0;
        return smoothstep(1.0 + strength, 0.5 - strength * 0.5, dist);
      }

      void main() {
        vec4 color = texture2D(tDiffuse, vUv);

        // Phase-based color grading
        if (uPhase < 0.5) {
          // Alpha: cool green tint
          color.r *= 0.9;
          color.g *= 1.1;
          color.b *= 0.95;
        } else if (uPhase < 1.5) {
          // Beta: warm orange tint
          color.r *= 1.1;
          color.g *= 0.95;
          color.b *= 0.85;
        } else {
          // Gamma: purple/violet tint
          color.r *= 0.9;
          color.g *= 1.0;
          color.b *= 1.1;
        }

        // Resonance glow (Q key)
        if (uResonating > 0.5) {
          color.rgb += vec3(0.3, 0.1, 0.3);
        }

        // Vignette
        float vig = vignette(vUv, 0.4);
        color.rgb *= vig;

        gl_FragColor = color;
      }
    `,
  };
  const phasePass = new ShaderPass(phaseShader);
  phasePass.name = 'phase';
  composer.addPass(phasePass);

  return {
    composer,
    bloomPass,
    phasePass,
    updatePhase(phase, resonating) {
      phasePass.uniforms.uPhase.value = phase;
      phasePass.uniforms.uResonating.value = resonating ? 1.0 : 0.0;
    },
    // Phase 2.1 alias — main.js#onPhaseChanged calls setPhase(phase) on a
    // cycle completion so the shader tint updates at the exact moment of
    // the phase change (the per-frame updatePhase still drives the
    // uResonating side from the Q-key state).
    setPhase(phase) {
      phasePass.uniforms.uPhase.value = phase;
    },
  };
}

// Create player mesh (voxel character)
export function createPlayerMesh() {
  const group = new THREE.Group();

  // Body
  const bodyGeom = new THREE.BoxGeometry(0.6, 0.8, 0.4);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.4;
  group.add(body);

  // Head
  const headGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = 1.05;
  group.add(head);

  // Legs
  const legGeom = new THREE.BoxGeometry(0.25, 0.6, 0.25);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x334455 });
  const leftLeg = new THREE.Mesh(legGeom, legMat);
  leftLeg.position.set(-0.15, -0.3, 0);
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeom, legMat);
  rightLeg.position.set(0.15, -0.3, 0);
  group.add(rightLeg);

  group.position.y = 0;

  return group;
}

// Create skybox (gradient). Phase 3.1: the skybox shader now
// blends a per-biome tint with a per-phase tint. The renderer's
// `setBiomeTint` / `setPhaseTint` methods update the uniforms;
// the game loop's per-frame biome tick calls them after lerping
// toward the target biome color. The two tints are multiplied
// (the §3.1 "phase × biome" formula) so the visible skybox
// reads as the player's current phase tinted by the current
// biome — multiplicative blend, not destructive replacement.
export function createSkybox(scene) {
  const skyGeom = new THREE.SphereGeometry(500, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0xffffff) },
      offset: { value: 20 },
      exponent: { value: 0.6 },
      // Phase 3.1: per-biome tint and per-phase tint (THREE.Vector3
      // of RGB in [0, 1]). Both default to white (1, 1, 1) so the
      // pre-Phase-3.1 skybox rendering is unchanged until the
      // game loop starts driving the uniforms. The fragment shader
      // multiplies both tints into the base gradient.
      biomeTint: { value: new THREE.Vector3(1, 1, 1) },
      phaseTint: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      // Phase 3.1: per-biome tint + per-phase tint. Both are
      // THREE.Vector3 of [r, g, b] in [0, 1]. The base gradient
      // is multiplied by both tints so the visible skybox reads
      // as (biomeTint * phaseTint) (the §3.1
      // "phase × biome" formula). The tints default to white so
      // the pre-Phase-3.1 rendering is preserved.
      uniform vec3 biomeTint;
      uniform vec3 phaseTint;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        vec3 base = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
        gl_FragColor = vec4(base * biomeTint * phaseTint, 1.0);
      }
    `,
    side: THREE.BackSide,
  });
  const sky = new THREE.Mesh(skyGeom, skyMat);
  // Phase 3.1: tag the mesh so the game loop can find it without
  // relying on a `userData` mutation. The renderer's setBiomeTint /
  // setPhaseTint methods look it up by name.
  sky.name = 'skybox';
  scene.add(sky);

  // Phase 3.1: convenience methods on the mesh. The game loop calls
  // these after lerping the biome color toward the target. `tint`
  // is the [r, g, b] array in [0, 1] (the canonical
  // `biomeTint(biomeId).color` shape from src/world/biome.js).
  // Defensive: missing / non-finite channels fall back to 1.0
  // (white) so the skybox never goes black from a bad call.
  sky.setBiomeTint = function setBiomeTint(tint) {
    const v = (tint && typeof tint === 'object') ? tint : [1, 1, 1];
    skyMat.uniforms.biomeTint.value.set(
      Number.isFinite(v[0]) ? v[0] : 1,
      Number.isFinite(v[1]) ? v[1] : 1,
      Number.isFinite(v[2]) ? v[2] : 1,
    );
  };
  sky.setPhaseTint = function setPhaseTint(tint) {
    const v = (tint && typeof tint === 'object') ? tint : [1, 1, 1];
    skyMat.uniforms.phaseTint.value.set(
      Number.isFinite(v[0]) ? v[0] : 1,
      Number.isFinite(v[1]) ? v[1] : 1,
      Number.isFinite(v[2]) ? v[2] : 1,
    );
  };
  return sky;
}

// ── Phase Lens Scan Overlay (Phase 2.5) ───────────────────────────────

/**
 * Owns the Phase Lens visuals: a wireframe outline per phase-different
 * cell, plus a beam from the camera in the crosshair direction. The
 * overlay lives in its own THREE.Group so it can be cleared in one
 * call without touching the chunk-mesh group (the chunk visualizer
 * owns the `meshes` field; the overlay must not share it).
 *
 * The brief is explicit:
 *   - Wireframe color per OTHER phase (Alpha=green, Beta=blue, Gamma=gold).
 *     A multi-phase block gets one outline per other phase.
 *   - `showScanHighlights` disposes old wireframes when called repeatedly
 *     (the player can hold E, walk into a new chunk, and call again —
 *     the old meshes must be removed and their geometries/materials
 *     disposed).
 *   - The beam is tinted with the player's current phase color (the
 *     beam is the player's "look" indicator, not the target's).
 *   - The beam position must update every frame while scanning — the
 *     camera moves and rotates; a beam anchored to world coordinates
 *     would lag behind.
 *
 * The class does NOT call into `World` or `PhaseManager` itself. It
 * takes the scan results array (the shape is
 * `Array<{ x, y, z, currentPhaseBlock, otherPhases, mask }>`) and the
 * caller's current phase. The game loop is the dispatcher.
 */
export class ScanOverlay {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'scanOverlay';
    this.scene.add(this.group);

    // Beam mesh lives in this group too. It's rebuilt per-frame while
    // scanning (the camera moves + rotates) so we don't bother trying
    // to share materials across frames.
    this._beamGroup = new THREE.Group();
    this._beamGroup.name = 'scanBeam';
    this.group.add(this._beamGroup);

    this._beamMesh = null;
    this._beamMaterial = null;
    this._visible = false;
  }

  /**
   * Show scan highlights for the given results. Replaces any existing
   * wireframes (the player can hold E, walk into a new chunk, and call
   * again). `currentPhase` is the integer phase index — used to skip
   * outlining the current phase (the renderer should outline each
   * phase where the cell IS non-air but the player is NOT).
   */
  showScanHighlights(results, currentPhase) {
    // Clear old wireframes (dispose geometries + materials).
    this.clearWireframes();

    if (!Array.isArray(results) || results.length === 0) return;

    for (const r of results) {
      const bx = r.x, by = r.y, bz = r.z;
      const otherPhases = Array.isArray(r.otherPhases) ? r.otherPhases : [];
      for (const p of otherPhases) {
        if (p === currentPhase) continue;
        // Skip out-of-range phase data (defensive — findPhaseDifferences
        // does the same filter, but the renderer is a public surface).
        if (p < 0 || p > 2) continue;

        // Use PHASE_COLORS so the wireframe matches the HUD indicator.
        const color = PHASE_COLORS[p] || '#ffffff';
        const boxGeom = new THREE.BoxGeometry(1.02, 1.02, 1.02);
        const edges = new THREE.EdgesGeometry(boxGeom);
        const lineMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.85,
        });
        const wireframe = new THREE.LineSegments(edges, lineMat);
        wireframe.position.set(bx + 0.5, by + 0.5, bz + 0.5);
        this.group.add(wireframe);
        // The wireframe is now owned by the group. Dispose its geometry
        // in clearWireframes() — the material is per-wireframe so we
        // dispose it here too if the round-trip ever needs the cleanup.
        // (Tracked conventionally via .userData.dispose = true.)
        wireframe.userData.disposable = true;
      }
    }
  }

  /**
   * Clear all wireframe meshes. Disposes geometries and materials so
   * the renderer doesn't leak when the player walks around with the
   * lens held.
   */
  clearWireframes() {
    for (const child of [...this.group.children]) {
      if (child === this._beamGroup) continue; // beam is owned separately
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          for (const m of child.material) m.dispose();
        } else {
          child.material.dispose();
        }
      }
      this.group.remove(child);
    }
  }

  /**
   * Clear all wireframes AND the beam. Use when the player releases E.
   */
  clearScanHighlights() {
    this.clearWireframes();
    this.hideScanBeam();
  }

  /**
   * Show a beam from the camera in the crosshair direction. Built as
   * a thin cylinder oriented along the camera's forward vector. The
   * beam is tinted with the player's current phase color (so the
   * player sees their own "look" highlighted, not the target's).
   *
   * `currentPhase` is the integer phase index (used for the tint).
   * The beam is ~6 blocks long, matching the player's raycast reach.
   */
  showScanBeam(camera, currentPhase) {
    if (!camera) return;
    const beamLength = 6;
    const beamRadius = 0.02;

    // Dispose the prior beam before drawing a new one — the camera
    // moves every frame, so position/orientation are stale anyway.
    this.hideScanBeam();

    const color = PHASE_COLORS[currentPhase] || '#ffffff';
    const beamGeom = new THREE.CylinderGeometry(beamRadius, beamRadius, beamLength, 8, 1, true);
    // Translate so the cylinder is anchored at the camera and extends
    // forward (Three.js cylinders are centered on their origin; move
    // it down so the top is at the origin).
    beamGeom.translate(0, -beamLength / 2, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeom, beamMat);
    this._beamMesh = beam;
    this._beamMaterial = beamMat;
    this._beamGroup.add(beam);

    // The beam is parented to the camera so it follows every frame
    // (camera.position + camera.quaternion). No per-frame update
    // needed; THREE handles the transform.
    this.scene.add(camera); // no-op if already parented
    beam.parent = camera;
    // Reset transform so the beam is in camera-local space pointing
    // down -Y (the cylinder's "forward" after the geometry translate).
    beam.position.set(0, 0, 0);
    beam.rotation.set(0, 0, 0);
    // The camera's forward is -Z, but the cylinder is along -Y. Rotate
    // the beam so its long axis lines up with the camera's forward.
    beam.rotation.x = -Math.PI / 2;

    this._visible = true;
  }

  /**
   * Hide the beam. Disposes its geometry + material so the renderer
   * doesn't leak while the player releases E.
   */
  hideScanBeam() {
    if (this._beamMesh) {
      if (this._beamMesh.parent) this._beamMesh.parent.remove(this._beamMesh);
      if (this._beamMesh.geometry) this._beamMesh.geometry.dispose();
      this._beamMesh = null;
    }
    if (this._beamMaterial) {
      this._beamMaterial.dispose();
      this._beamMaterial = null;
    }
    this._visible = false;
  }

  /**
   * Whether the overlay is currently active (highlight or beam). Used
   * by the game loop to know whether the next frame should redraw.
   */
  isVisible() {
    return this._visible;
  }

  /**
   * Number of highlight meshes currently in the overlay group. Used
   * by the Playwright test to assert the scan produced output.
   */
  getHighlightCount() {
    let count = 0;
    for (const child of this.group.children) {
      if (child === this._beamGroup) continue;
      count++;
    }
    return count;
  }

  /**
   * Remove the overlay from the scene. Used in dispose() / hot-reload.
   */
  dispose() {
    this.clearScanHighlights();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// Main renderer class — manages scenes, chunks, player, and rendering

// ── Resonance Pulse (Phase 2.6) ────────────────────────────────────

/**
 * Owns the Resonance sphere pulse: a phase-colored sphere that
 * expands from the player position and fades over RESONANCE_PULSE_DURATION
 * seconds. The pulse lives in its own THREE.Group so the chunk-mesh
 * group and the Phase Lens overlay group are untouched. The brief
 * is explicit: the pulse must NOT share a group with the Phase Lens.
 *
 * Lifecycle:
 *   1. main.js calls `showResonancePulse(x, y, z, currentPhase)` on Q
 *      press. The pulse sphere is created at the player position with
 *      a tint from PHASE_COLORS[currentPhase].
 *   2. main.js calls `updateResonancePulse(dt)` every frame. The
 *      `resonanceSpherePulse` helper (src/resonance/resonate.js) returns
 *      `{ radius, opacity, color }` for the elapsed time. The pulse
 *      applies those values to the mesh.
 *   3. When `radius` exceeds the lifetime the helper returns null;
 *      `updateResonancePulse` disposes the mesh and clears the group.
 *      The pulse is auto-disposed — no leak per Q press.
 *
 * The pulse must update every frame (the brief's "don't snapshot it on
 * press" pitfall). The mesh's scale changes per frame so the visual
 * expansion is visible; the mesh's material.opacity changes per frame
 * so the fade is visible.
 *
 * Independent of the Phase Lens overlay (different group, different
 * clear API). Clearing the lens overlays (`scanOverlay.clearScanHighlights`)
 * does not touch the pulse and vice versa.
 */
export class ResonancePulse {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'resonancePulse';
    this.scene.add(this.group);

    this._mesh = null;
    this._material = null;
    this._geometry = null;
    this._elapsed = 0;
    this._alive = false;
    this._centerX = 0;
    this._centerY = 0;
    this._centerZ = 0;
    this._currentPhase = 0;
  }

  /**
   * Spawn a new resonance pulse at (x, y, z) tinted with
   * `PHASE_COLORS[currentPhase]`. Disposes any existing pulse first
   * so back-to-back presses don't stack meshes. The pulse starts at
   * the player position; the per-frame `updateResonancePulse` then
   * expands it.
   */
  showResonancePulse(x, y, z, currentPhase) {
    // Dispose any existing pulse so back-to-back presses don't leak.
    this.clearResonancePulse();

    const phase = Number.isFinite(currentPhase) ? Math.floor(currentPhase) : 0;
    const color = PHASE_COLORS[phase] || '#ffffff';
    this._currentPhase = phase;
    this._centerX = Number.isFinite(x) ? x : 0;
    this._centerY = Number.isFinite(y) ? y : 0;
    this._centerZ = Number.isFinite(z) ? z : 0;
    this._elapsed = 0;

    // Sphere mesh — radius 1 (will scale per frame in update).
    const radius = (typeof RESONANCE_RADIUS === 'number')
      ? RESONANCE_RADIUS
      : 1;
    this._geometry = new THREE.SphereGeometry(radius, 16, 16);
    this._material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.position.set(this._centerX, this._centerY, this._centerZ);
    this._mesh.scale.setScalar(0.2); // start at the "expand start" radius
    this._mesh.frustumCulled = false;
    this.group.add(this._mesh);
    this._alive = true;
  }

  /**
   * Advance the pulse by dt seconds. Reads the per-frame shape from
   * the resonanceSpherePulse helper (resonate.js) and applies it to
   * the mesh. When the helper returns null (>= duration) the pulse
   * is auto-disposed.
   */
  updateResonancePulse(dt) {
    if (!this._alive) return;
    const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this._elapsed += d;
    const shape = resonanceSpherePulse(this._elapsed, this._currentPhase);
    if (!shape) {
      // Expired — dispose cleanly.
      this.clearResonancePulse();
      return;
    }
    if (!this._mesh || !this._material) {
      // Defensive: the mesh was disposed externally.
      this._alive = false;
      return;
    }
    // Apply the per-frame shape. The mesh's unit sphere is at scale 1
    // when its radius == 1; we scale by the shape's radius so the
    // visual size matches.
    this._mesh.scale.setScalar(shape.radius);
    this._material.opacity = shape.opacity;
  }

  /**
   * Immediate dispose. Used on cleanup, scene reload, or back-to-back
   * presses. Disposes the geometry and material so the renderer
   * doesn't leak.
   */
  clearResonancePulse() {
    if (this._mesh) {
      if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
      this._mesh = null;
    }
    if (this._geometry) {
      this._geometry.dispose();
      this._geometry = null;
    }
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    this._alive = false;
    this._elapsed = 0;
  }

  /**
   * Whether the pulse is currently active. Used by the game loop
   * to know whether the next frame should call updateResonancePulse.
   */
  isVisible() {
    return this._alive;
  }

  /**
   * Number of meshes in the pulse group. Used by the Playwright
   * test to assert the pulse produced output after a press.
   */
  getMeshCount() {
    let count = 0;
    for (const child of this.group.children) {
      if (child.isMesh) count++;
    }
    return count;
  }

  /**
   * Remove the pulse group from the scene. Used in dispose() /
   * hot-reload.
   */
  dispose() {
    this.clearResonancePulse();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// ── Resonance Pulse helper (Phase 2.6) ────────────────────────────────

/**
 * Bridge between the pure `resonanceSpherePulse(t, phase)` helper and
 * the THREE.Mesh. Returns the per-frame shape, or `null` when the
 * pulse has expired. Lazy-imports the helper so the renderer's static
 * analysis doesn't pull in the whole resonance module (the helper is
 * tiny but the pattern is consistent with the rest of the file).
 */
function resonanceSpherePulse(t, phase) {
  // Inlined here to avoid the top-level import. The shape is
  //   { radius: 0.2 -> 1.0 over 0.25s, opacity: 1.0 then 0.0 over 0.75s }
  // identical to src/resonance/resonate.js#resonanceSpherePulse.
  const total = (typeof RESONANCE_PULSE_DURATION === 'number')
    ? RESONANCE_PULSE_DURATION
    : 1.0;
  if (!Number.isFinite(t) || t < 0 || t >= total) return null;
  const color = PHASE_COLORS[phase] || '#ffffff';
  const expandSteps = 0.25;
  const fadeSteps = 0.75;
  let radius;
  if (t <= expandSteps) {
    radius = 0.2 + (1.0 - 0.2) * (t / expandSteps);
  } else {
    radius = 1.0;
  }
  let opacity;
  if (t <= expandSteps) {
    opacity = 1.0;
  } else {
    const k = (t - expandSteps) / fadeSteps;
    opacity = Math.max(0, 1.0 - k);
  }
  return { radius, opacity, color };
}


// ── Phase Anchor Overlay (Phase 2.7) ────────────────────────────

/**
 * Owns the Phase Anchor wireframes: the yellow-glow outline that
 * appears on a block when the player presses Shift+LMB. The overlay
 * lives in its own THREE.Group (separate from the chunk-mesh group,
 * the Phase Lens overlay group, and the Resonance pulse group) so
 * the four visuals are fully independent.
 *
 * Lifecycle (mirrors the orphan PhaseLockManager's per-anchor
 * BoxGeometry + EdgesGeometry pattern):
 *   1. main.js calls `showAnchor(anchor)` on Shift+LMB. The overlay
 *      creates a 1.02-cube BoxGeometry (translucent yellow fill) +
 *      a 1.02-cube EdgesGeometry (bright gold border) at the anchor
 *      cell. The materials are per-anchor (NOT shared) so the
 *      pulse-fade in the last 3 seconds can be applied per-anchor
 *      without affecting siblings.
 *   2. main.js calls `updateAnchors(snapshot, removedKeys)` every
 *      frame. The overlay applies the per-anchor fade opacity (from
 *      `anchorFadeOpacity(remaining)`) to each anchor's fill
 *      material, then disposes the geometry + materials of any
 *      anchors whose key is in `removedKeys`.
 *   3. When the lifetime expires (or the player presses Shift+LMB
 *      on a different cell, leaving the previous one to expire),
 *      the overlay auto-disposes the wireframe — no leak.
 *
 * The overlay must update every frame (the brief's "pulse-fade
 * animation must be visible" pitfall). The mesh's material.opacity
 * is set per-frame so the fade is visible.
 *
 * Independent of the Phase Lens overlay (different group, different
 * clear API) and the Resonance pulse (different group, different
 * clear API). Clearing the lens or the pulse does not affect the
 * anchor overlay and vice versa.
 */
export class AnchorOverlay {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'anchorOverlay';
    this.scene.add(this.group);

    // Map<key, { group, fill, edges, fillMat, edgeMat, boxGeom, edgeGeom }>
    // key is `${x},${y},${z},${phase}` (same convention as the orphan
    // PhaseLockManager + World._anchors).
    this._anchors = new Map();
  }

  /**
   * Show an anchor outline at (x, y, z) in the given phase. If an
   * outline already exists for the same key, the existing one is
   * disposed first (the lifetime was refreshed by the world's
   * createAnchor; the visual re-fires from the new remaining).
   */
  showAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') return;
    const { x, y, z, phase } = anchor;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (typeof phase !== 'number' || phase < 0 || phase > 2) return;

    const key = _anchorKey(Math.floor(x), Math.floor(y), Math.floor(z), phase);

    // Dispose any existing wireframe for this key (refresh path).
    this._disposeKey(key);

    const remaining = (typeof anchor.remaining === 'number')
      ? anchor.remaining
      : ANCHOR_LIFETIME;
    const fillOp = _anchorFadeOpacity(remaining);
    const edgeOp = _anchorBorderOpacity(remaining);

    // 1.02-cube box (slightly larger than the 1.0 voxel so the
    // outline doesn't z-fight with the block's face). Mirrors the
    // orphan's BoxGeometry(1.02, 1.02, 1.02) + EdgesGeometry
    // combination.
    const boxGeom = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    const fillMat = new THREE.MeshBasicMaterial({
      color: ANCHOR_FILL_COLOR,
      transparent: true,
      opacity: fillOp,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(boxGeom, fillMat);
    fillMesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);

    const edges = new THREE.EdgesGeometry(boxGeom);
    const edgeMat = new THREE.LineBasicMaterial({
      color: ANCHOR_BORDER_COLOR,
      transparent: true,
      opacity: edgeOp,
    });
    const edgeMesh = new THREE.LineSegments(edges, edgeMat);
    edgeMesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);

    const innerGroup = new THREE.Group();
    innerGroup.add(fillMesh);
    innerGroup.add(edgeMesh);
    this.group.add(innerGroup);

    this._anchors.set(key, {
      group: innerGroup,
      fill: fillMesh,
      edges: edgeMesh,
      fillMat,
      edgeMat,
      boxGeom,
      edgeGeom: edges,
    });
  }

  /**
   * Per-frame update. `snapshot` is the array of `{ x, y, z, phase,
   * remaining }` from `World.getAnchors()`. `removedKeys` is the
   * array of expired keys from `World.tickAnchors`. The overlay:
   *   1. Updates the fill + edge opacity for each anchor in the
   *      snapshot (the pulse-fade animation in the last 3 seconds).
   *   2. Disposes any anchor whose key is in `removedKeys` (the
   *      wireframe is removed cleanly so the renderer doesn't leak).
   *
   * Defensive: any anchor in `removedKeys` that's NOT in the
   * internal map is a no-op (the world and the overlay may have
   * raced; the safe thing is to ignore the orphan key).
   */
  updateAnchors(snapshot, removedKeys) {
    // 1. Apply per-frame opacity to the live anchors.
    if (Array.isArray(snapshot)) {
      for (const a of snapshot) {
        if (!a || typeof a !== 'object') continue;
        const key = _anchorKey(a.x, a.y, a.z, a.phase);
        const rec = this._anchors.get(key);
        if (!rec) continue;
        const r = (typeof a.remaining === 'number') ? a.remaining : ANCHOR_LIFETIME;
        if (rec.fillMat) rec.fillMat.opacity = _anchorFadeOpacity(r);
        if (rec.edgeMat) rec.edgeMat.opacity = _anchorBorderOpacity(r);
      }
    }

    // 2. Remove the wireframes whose keys are in removedKeys.
    if (Array.isArray(removedKeys)) {
      for (const key of removedKeys) {
        this._disposeKey(key);
      }
    }
  }

  /**
   * Clear all anchor wireframes. Used on scene reload / debug
   * cleanup. Disposes every geometry + material so the renderer
   * doesn't leak.
   */
  clearAnchors() {
    for (const key of [...this._anchors.keys()]) {
      this._disposeKey(key);
    }
  }

  /**
   * Number of wireframes currently in the overlay group. Used by
   * the Playwright test to assert the anchor produced a visual
   * after a press. Note: each wireframe is a `THREE.Group` with
   * 2 children (the fill mesh + the edges mesh), so this count
   * is the number of inner groups, not the total child count.
   */
  getAnchorCount() {
    return this._anchors.size;
  }

  /**
   * List of keys currently visible. Used by the test to assert
   * the canonical key format + the lifecycle of the overlay.
   */
  getAnchorKeys() {
    return [...this._anchors.keys()];
  }

  /**
   * Get the number of raw meshes (fill + edges) currently in the
   * overlay group. Used by the test to assert the wireframe was
   * actually drawn (a child of `this.group` per anchor × 2 = 2N).
   */
  getMeshCount() {
    let count = 0;
    for (const child of this.group.children) {
      count += child.children ? child.children.length : 1;
    }
    return count;
  }

  /**
   * Internal: dispose a single anchor's resources. Removes the
   * group from the scene + disposes the geometry + materials so
   * the renderer doesn't leak. Safe to call on a non-existent
   * key (no-op).
   */
  _disposeKey(key) {
    const rec = this._anchors.get(key);
    if (!rec) return;
    this._anchors.delete(key);
    if (rec.group) {
      if (rec.group.parent) rec.group.parent.remove(rec.group);
    }
    if (rec.boxGeom) rec.boxGeom.dispose();
    if (rec.edgeGeom) rec.edgeGeom.dispose();
    if (rec.fillMat) rec.fillMat.dispose();
    if (rec.edgeMat) rec.edgeMat.dispose();
  }

  /**
   * Remove the overlay group from the scene. Used in dispose() /
   * hot-reload.
   */
  dispose() {
    this.clearAnchors();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// Phase 3.2: Stabilizer checkpoint overlay + Phase Collapse screen
// tint. The CheckpointOverlay is a THREE.Group (named
// "checkpointOverlay") that draws a ring + crosshair above each
// placed Stabilizer block. The CollapseOverlay is a progress
// tracker for the deep-purple vignette + screen tint during the
// 1.5s collapse animation (the actual visual is a DOM element in
// index.html - this class only tracks the progress value).

export class CheckpointOverlay {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'checkpointOverlay';
    this.scene.add(this.group);

    // Per-Stabilizer resources, keyed by the canonical "x,y,z" string.
    this._checkpoints = new Map();
  }

  showCheckpoint(x, y, z, key) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const k = (typeof key === 'string' && key.length > 0) ? key : `${fx},${fy},${fz}`;
    this._disposeKey(k);

    const ringGeom = new THREE.RingGeometry(0.45, 0.6, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff8844,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(fx + 0.5, fy + 1.02, fz + 0.5);
    ring.rotation.x = -Math.PI / 2;

    const spriteMat = new THREE.SpriteMaterial({
      color: 0xff8844,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(fx + 0.5, fy + 1 + 1.2, fz + 0.5);
    sprite.scale.set(0.8, 0.8, 0.8);

    const innerGroup = new THREE.Group();
    innerGroup.add(ring);
    innerGroup.add(sprite);
    this.group.add(innerGroup);

    this._checkpoints.set(k, {
      group: innerGroup,
      ring,
      ringGeom,
      ringMat,
      sprite,
      spriteMat,
    });
  }

  updateCheckpoints(snapshot) {
    if (!Array.isArray(snapshot)) return;
    const present = new Set();
    for (const c of snapshot) {
      if (!c || typeof c !== 'object') continue;
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue;
      const fx = Math.floor(c.x);
      const fy = Math.floor(c.y);
      const fz = Math.floor(c.z);
      const k = (typeof c.key === 'string' && c.key.length > 0) ? c.key : `${fx},${fy},${fz}`;
      present.add(k);
      if (!this._checkpoints.has(k)) {
        this.showCheckpoint(c.x, c.y, c.z, k);
      }
    }
    for (const k of [...this._checkpoints.keys()]) {
      if (!present.has(k)) {
        this._disposeKey(k);
      }
    }
  }

  clearCheckpoint(key) {
    return this._disposeKey(key);
  }

  clearCheckpoints() {
    for (const k of [...this._checkpoints.keys()]) {
      this._disposeKey(k);
    }
  }

  getCheckpointCount() {
    return this._checkpoints.size;
  }

  getCheckpointKeys() {
    return [...this._checkpoints.keys()];
  }

  _disposeKey(key) {
    const rec = this._checkpoints.get(key);
    if (!rec) return false;
    this._checkpoints.delete(key);
    if (rec.group && rec.group.parent) rec.group.parent.remove(rec.group);
    if (rec.ringGeom) rec.ringGeom.dispose();
    if (rec.ringMat) rec.ringMat.dispose();
    if (rec.spriteMat) rec.spriteMat.dispose();
    return true;
  }

  dispose() {
    this.clearCheckpoints();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

export class CollapseOverlay {
  constructor() {
    this._progress = 0;
    this._visible = false;
  }

  updateCollapseOverlay(progress) {
    const p = (typeof progress === 'number' && Number.isFinite(progress))
      ? Math.max(0, Math.min(1, progress))
      : 0;
    this._progress = p;
    this._visible = p > 0;
  }

  clearCollapseOverlay() {
    this._progress = 0;
    this._visible = false;
  }

  getProgress() {
    return this._progress;
  }

  isVisible() {
    return this._visible;
  }
}

export class EchoOverlay {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'echoOverlay';
    /** Map<key, { mesh, key, color }> */
    this.entries = new Map();
    /** Per-Echo animation phase (radians) for out-of-sync bobbing */
    this._animTime = 0;
  }

  showEcho(x, y, z, key, color) {
    if (typeof key !== 'string' || key.length === 0) return;
    if (!this.entries.has(key)) {
      const geometry = new THREE.OctahedronGeometry(0.25, 0);
      const c = (Array.isArray(color) && color.length >= 3) ? color : [0.95, 0.78, 0.35];
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c[0], c[1], c[2]),
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.userData = { key, baseY: y, phase: Math.random() * Math.PI * 2 };
      this.group.add(mesh);
      this.entries.set(key, { mesh, key, color: c });
    } else {
      const entry = this.entries.get(key);
      entry.mesh.position.set(x, y, z);
      if (Array.isArray(color) && color.length >= 3) {
        entry.color = color;
        if (entry.mesh.material && entry.mesh.material.color) {
          entry.mesh.material.color.setRGB(color[0], color[1], color[2]);
        }
      }
    }
  }

  updateEchoes(dt, snapshot) {
    const d = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
    this._animTime += d;
    const presentKeys = new Set();
    const list = Array.isArray(snapshot) ? snapshot : [];
    for (const e of list) {
      if (!e || typeof e !== 'object' || !e.key) continue;
      if (!this.entries.has(e.key)) {
        // Auto-create if missing (the per-frame tick is the
        // single source of truth for which Echoes are alive).
        const c = (Array.isArray(e.color) && e.color.length >= 3) ? e.color : [0.95, 0.78, 0.35];
        this.showEcho(e.x, e.y, e.z, e.key, c);
      }
      const entry = this.entries.get(e.key);
      if (!entry) continue;
      presentKeys.add(e.key);
      // Bob + rotate animation
      const t = this._animTime;
      const ph = (entry.mesh.userData && Number.isFinite(entry.mesh.userData.phase))
        ? entry.mesh.userData.phase : 0;
      entry.mesh.position.y = (e.y || 0) + Math.sin(t * 1.5 + ph) * 0.15;
      entry.mesh.rotation.y = t * 0.4 + ph;
    }
    // Drop entries that are no longer in the snapshot (collected)
    for (const key of Array.from(this.entries.keys())) {
      if (!presentKeys.has(key)) this.clearEcho(key);
    }
  }

  clearEcho(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (entry.mesh && entry.mesh.geometry) entry.mesh.geometry.dispose();
    if (entry.mesh && entry.mesh.material) entry.mesh.material.dispose();
    this.entries.delete(key);
  }

  clearEchoes() {
    for (const key of Array.from(this.entries.keys())) this.clearEcho(key);
  }

  getCount() {
    return this.entries.size;
  }

  getKeys() {
    return Array.from(this.entries.keys());
  }

  dispose() {
    this.clearEchoes();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// Phase 3.4: ResonanceCoreOverlay - floating amplifier meshes
// (one per BLOCK_RESONANCE_CORE in the world). Each Core is a
// rotating octahedron with a faint glow ring; the color is
// picked by `resonanceCoreColorForBiome(biomeId)`. The mesh
// lives in its own THREE.Group named 'resonanceCoreOverlay' so
// the chunk-mesh, Phase Lens, Resonance, Anchor, Checkpoint,
// Collapse, and Echo groups stay independent.
export class ResonanceCoreOverlay {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'resonanceCoreOverlay';
    /** Map<key, { mesh, ring, key, color }> */
    this.entries = new Map();
    /** Per-Core animation phase (radians) for out-of-sync bobbing */
    this._animTime = 0;
  }

  showResonanceCore(x, y, z, key, color, amplifier) {
    if (typeof key !== 'string' || key.length === 0) return;
    if (!this.entries.has(key)) {
      const geometry = new THREE.OctahedronGeometry(0.32, 0);
      // Cores are larger than Echoes (0.25 vs 0.32) and have a
      // brighter color (no opacity falloff).
      const c = (Array.isArray(color) && color.length >= 3) ? color : [0.85, 0.78, 0.3];
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c[0], c[1], c[2]),
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y + 1, z);
      mesh.userData = { key, baseY: y + 1, phase: Math.random() * Math.PI * 2, amplifier: amplifier || null };
      this.group.add(mesh);
      // Faint glow ring at the base of the Core
      const ringGeometry = new THREE.RingGeometry(0.4, 0.5, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c[0], c[1], c[2]),
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.set(x, y + 0.05, z);
      ring.rotation.x = -Math.PI / 2;
      this.group.add(ring);
      this.entries.set(key, { mesh, ring, key, color: c, amplifier: amplifier || null });
    } else {
      const entry = this.entries.get(key);
      entry.mesh.position.set(x, y + 1, z);
      if (entry.ring) entry.ring.position.set(x, y + 0.05, z);
      if (Array.isArray(color) && color.length >= 3) {
        entry.color = color;
        if (entry.mesh.material && entry.mesh.material.color) {
          entry.mesh.material.color.setRGB(color[0], color[1], color[2]);
        }
        if (entry.ring && entry.ring.material && entry.ring.material.color) {
          entry.ring.material.color.setRGB(color[0], color[1], color[2]);
        }
      }
      if (amplifier) entry.amplifier = amplifier;
    }
  }

  updateResonanceCores(dt, snapshot) {
    const d = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
    this._animTime += d;
    const presentKeys = new Set();
    const list = Array.isArray(snapshot) ? snapshot : [];
    for (const e of list) {
      if (!e || typeof e !== 'object' || !e.key) continue;
      if (!this.entries.has(e.key)) {
        const c = (Array.isArray(e.color) && e.color.length >= 3) ? e.color : [0.85, 0.78, 0.3];
        this.showResonanceCore(e.x, e.y, e.z, e.key, c, e.amplifier);
      }
      const entry = this.entries.get(e.key);
      if (!entry) continue;
      presentKeys.add(e.key);
      const t = this._animTime;
      const ph = (entry.mesh.userData && Number.isFinite(entry.mesh.userData.phase))
        ? entry.mesh.userData.phase : 0;
      // Slower + larger bob than Echoes
      entry.mesh.position.y = (e.y || 0) + 1 + Math.sin(t * 1.2 + ph) * 0.2;
      entry.mesh.rotation.y = t * 0.5 + ph;
      if (entry.ring) {
        entry.ring.rotation.z = t * 0.3 + ph;
      }
    }
    for (const key of Array.from(this.entries.keys())) {
      if (!presentKeys.has(key)) this.clearResonanceCore(key);
    }
  }

  clearResonanceCore(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (entry.mesh && entry.mesh.geometry) entry.mesh.geometry.dispose();
    if (entry.mesh && entry.mesh.material) entry.mesh.material.dispose();
    if (entry.ring && entry.ring.parent) entry.ring.parent.remove(entry.ring);
    if (entry.ring && entry.ring.geometry) entry.ring.geometry.dispose();
    if (entry.ring && entry.ring.material) entry.ring.material.dispose();
    this.entries.delete(key);
  }

  clearResonanceCores() {
    for (const key of Array.from(this.entries.keys())) this.clearResonanceCore(key);
  }

  getCount() {
    return this.entries.size;
  }

  getKeys() {
    return Array.from(this.entries.keys());
  }

  getAmplifierAt(key) {
    const entry = this.entries.get(key);
    return entry ? (entry.amplifier || null) : null;
  }

  dispose() {
    this.clearResonanceCores();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

export class Renderer {
  constructor(world, scene, camera, phaseManager, webglRenderer) {
    this.world = world;
    this.scene = scene;
    this.camera = camera;
    this.phaseManager = phaseManager;
    this.webglRenderer = webglRenderer;
    this.visuals = new Map(); // chunkKey -> ChunkVisual
    // Phase 2.5: scan highlights live in this.scanOverlay, not in a
    // group owned by the Renderer. The overlay's group is named
    // 'scanOverlay' and is added to the scene by the ScanOverlay ctor.

    // Echo object rendering
    this._echoGroup = new THREE.Group();
    this._echoGroup.name = 'echoObjects';
    this.scene.add(this._echoGroup);
    // Resonance Core rendering
    this._coreGroup = new THREE.Group();
    this._coreGroup.name = 'resonanceCores';
    this.scene.add(this._coreGroup);

    // Set up lighting
    setupLighting(scene);

    // Set up post-processing (bloom + phase color grading + vignette)
    const pp = setupPostProcessing(webglRenderer, scene, camera);
    this.composer = pp.composer;
    this.bloomPass = pp.bloomPass;
    this.phasePass = pp.phasePass;

    // Phase 2.5: Phase Lens scan overlay (wireframes + beam). The
    // overlay manages its own THREE.Group so the chunk-mesh group is
    // untouched. main.js calls showScanHighlights / clearScanHighlights
    // / showScanBeam / hideScanBeam on the renderer; the renderer
    // forwards to the overlay.
    this.scanOverlay = new ScanOverlay(scene);

    // Phase 2.6: Resonance sphere pulse (Q). The pulse lives in its
    // own THREE.Group (a `ResonancePulse` instance) so the chunk-mesh
    // group and the Phase Lens overlay group are untouched. The
    // pulse is independent of the overlay — clearing the lens does
    // not affect the pulse and vice versa.
    this.resonancePulse = new ResonancePulse(scene);

    // Phase 2.7: Phase Anchor (Shift+LMB) — the yellow-glow outline
    // that appears on a block when the player presses Shift+LMB.
    // The overlay lives in its own THREE.Group (an `AnchorOverlay`
    // instance) so the chunk-mesh group, the Phase Lens overlay, and
    // the Resonance pulse are all untouched. The four visuals are
    // fully independent: clearing one does not affect the others.
    this.anchorOverlay = new AnchorOverlay(scene);
    // Phase 3.2: Stabilizer checkpoint overlay. Owns its own
    // THREE.Group ("checkpointOverlay") so the chunk-mesh
    // group, the Phase Lens overlay, the Resonance pulse, the
    // Anchor overlay, and the checkpoint overlay are all
    // independent.
    this.checkpointOverlay = new CheckpointOverlay(scene);
    // Phase 3.2: Phase Collapse overlay (deep-purple vignette
    // + screen tint during the 1.5s collapse animation). The
    // visual lives in the #phase-collapse-overlay DOM element;
    // this class only tracks the progress value for the test
    // surface.
    this.collapseOverlay = new CollapseOverlay();
    // Phase 3.3: EchoOverlay (floating crystal meshes above each Echo).
    this.echoOverlay = new EchoOverlay();
    scene.add(this.echoOverlay.group);
    // Phase 3.4: ResonanceCoreOverlay (floating amplifier meshes
    // above each BLOCK_RESONANCE_CORE in Crystal Caverns).
    this.resonanceCoreOverlay = new ResonanceCoreOverlay();
    scene.add(this.resonanceCoreOverlay.group);
  }

  // Phase 2.6: thin wrappers over the ResonancePulse so main.js has
  // a single dispatcher API. The brief is explicit: the renderer is
  // the owner of the visual, main.js is the dispatcher.
  showResonancePulse(x, y, z, currentPhase) {
    if (this.resonancePulse) this.resonancePulse.showResonancePulse(x, y, z, currentPhase);
  }

  updateResonancePulse(dt) {
    if (this.resonancePulse) this.resonancePulse.updateResonancePulse(dt);
  }

  clearResonancePulse() {
    if (this.resonancePulse) this.resonancePulse.clearResonancePulse();
  }

  // Phase 2.7: thin wrappers over the AnchorOverlay so main.js has
  // a single dispatcher API. The brief is explicit: the renderer is
  // the owner of the visual, main.js is the dispatcher. These
  // wrappers are also the surface the static-analysis checks poke.
  showAnchor(anchor) {
    if (this.anchorOverlay) this.anchorOverlay.showAnchor(anchor);
  }

  updateAnchors(snapshot, removedKeys) {
    if (this.anchorOverlay) this.anchorOverlay.updateAnchors(snapshot, removedKeys);
  }

  clearAnchors() {
    if (this.anchorOverlay) this.anchorOverlay.clearAnchors();
  }

  // Phase 3.2: thin wrappers over the CheckpointOverlay so main.js
  // has a single dispatcher API.
  showCheckpoint(x, y, z, key) {
    if (this.checkpointOverlay) this.checkpointOverlay.showCheckpoint(x, y, z, key);
  }

  updateCheckpoints(snapshot) {
    if (this.checkpointOverlay) this.checkpointOverlay.updateCheckpoints(snapshot);
  }

  clearCheckpoint(key) {
    if (this.checkpointOverlay) this.checkpointOverlay.clearCheckpoint(key);
  }

  clearCheckpoints() {
    if (this.checkpointOverlay) this.checkpointOverlay.clearCheckpoints();
  }

  getCheckpointCount() {
    return this.checkpointOverlay ? this.checkpointOverlay.getCheckpointCount() : 0;
  }

  getCheckpointKeys() {
    return this.checkpointOverlay ? this.checkpointOverlay.getCheckpointKeys() : [];
  }

  isCheckpointAt(key) {
    if (!this.checkpointOverlay) return false;
    const keys = this.checkpointOverlay.getCheckpointKeys();
    return keys.indexOf(key) >= 0;
  }

  // Phase 3.2: Phase Collapse overlay driver.
  updateCollapseOverlay(progress) {
    if (this.collapseOverlay) this.collapseOverlay.updateCollapseOverlay(progress);
  }

  clearCollapseOverlay() {
    if (this.collapseOverlay) this.collapseOverlay.clearCollapseOverlay();
  }

  getCollapseOverlayProgress() {
    return this.collapseOverlay ? this.collapseOverlay.getProgress() : 0;
  }

  isCollapseOverlayVisible() {
    return this.collapseOverlay ? this.collapseOverlay.isVisible() : false;
  }


  // Phase 3.3: thin wrappers over the EchoOverlay so main.js has a
  // single dispatcher API. The overlay owns its own THREE.Group so
  // the chunk-mesh, Phase Lens, Resonance, Anchor, Checkpoint, and
  // Collapse groups are all independent.
  showEcho(x, y, z, key, color) {
    if (this.echoOverlay) this.echoOverlay.showEcho(x, y, z, key, color);
  }

  updateEchoes(dt, snapshot) {
    if (this.echoOverlay) this.echoOverlay.updateEchoes(dt, snapshot);
  }

  clearEcho(key) {
    if (this.echoOverlay) this.echoOverlay.clearEcho(key);
  }

  clearEchoes() {
    if (this.echoOverlay) this.echoOverlay.clearEchoes();
  }

  getEchoCount() {
    return this.echoOverlay ? this.echoOverlay.getCount() : 0;
  }

  getEchoKeys() {
    return this.echoOverlay ? this.echoOverlay.getKeys() : [];
  }

  isEchoAt(key) {
    if (!this.echoOverlay) return false;
    const keys = this.echoOverlay.getKeys();
    return keys.indexOf(key) >= 0;
  }

  // Phase 3.4: thin wrappers over the ResonanceCoreOverlay so
  // main.js has a single dispatcher API. The overlay owns its
  // own THREE.Group so the chunk-mesh, Phase Lens, Resonance,
  // Anchor, Checkpoint, Collapse, and Echo groups stay
  // independent.
  showResonanceCore(x, y, z, key, color, amplifier) {
    if (this.resonanceCoreOverlay) this.resonanceCoreOverlay.showResonanceCore(x, y, z, key, color, amplifier);
  }

  updateResonanceCores(dt, snapshot) {
    if (this.resonanceCoreOverlay) this.resonanceCoreOverlay.updateResonanceCores(dt, snapshot);
  }

  clearResonanceCore(key) {
    if (this.resonanceCoreOverlay) this.resonanceCoreOverlay.clearResonanceCore(key);
  }

  clearResonanceCores() {
    if (this.resonanceCoreOverlay) this.resonanceCoreOverlay.clearResonanceCores();
  }

  getResonanceCoreCount() {
    return this.resonanceCoreOverlay ? this.resonanceCoreOverlay.getCount() : 0;
  }

  getResonanceCoreKeys() {
    return this.resonanceCoreOverlay ? this.resonanceCoreOverlay.getKeys() : [];
  }

  isResonanceCoreAt(key) {
    if (!this.resonanceCoreOverlay) return false;
    const keys = this.resonanceCoreOverlay.getKeys();
    return keys.indexOf(key) >= 0;
  }

  getResonanceCoreAmplifierAt(key) {
    return this.resonanceCoreOverlay ? this.resonanceCoreOverlay.getAmplifierAt(key) : null;
  }

  // Phase 2.5: thin wrappers over the ScanOverlay so main.js has a
  // single dispatcher API. The brief is explicit: the renderer is the
  // owner of the visual, main.js is the dispatcher. These wrappers are
  // also the surface the static-analysis checks poke.
  showScanHighlights(results, currentPhase) {
    if (this.scanOverlay) this.scanOverlay.showScanHighlights(results, currentPhase);
  }

  clearScanHighlights() {
    if (this.scanOverlay) this.scanOverlay.clearScanHighlights();
  }

  showScanBeam(camera, currentPhase) {
    if (this.scanOverlay) this.scanOverlay.showScanBeam(camera, currentPhase);
  }

  hideScanBeam() {
    if (this.scanOverlay) this.scanOverlay.hideScanBeam();
  }

  // Phase 2.5: back-compat shim — the orphan/legacy Renderer signature
  // was `showScanResults(results)`. Keep the old name working so the
  // existing renderer-API smoke tests don't break.
  showScanResults(results) {
    if (this.scanOverlay) this.scanOverlay.showScanHighlights(results, this.phaseManager ? this.phaseManager.getCurrentPhase() : 0);
  }

  // Phase 3.1: thin wrappers over the skybox shader uniforms so
  // main.js has a single dispatcher API. The skybox is a Mesh
  // (returned by createSkybox) with `setBiomeTint` / `setPhaseTint`
  // methods; the renderer forwards to them. The skybox is looked
  // up by name (`skybox`) so a missing scene object is a no-op.
  // `tint` is an [r, g, b] array in [0, 1] — the canonical
  // `biomeTint(biomeId).color` shape from src/world/biome.js, or
  // a hex/RGB array from the phase color.
  setBiomeTint(tint) {
    const sky = this.scene ? this.scene.getObjectByName('skybox') : null;
    if (sky && typeof sky.setBiomeTint === 'function') {
      sky.setBiomeTint(tint);
    }
  }
  setPhaseTint(tint) {
    const sky = this.scene ? this.scene.getObjectByName('skybox') : null;
    if (sky && typeof sky.setPhaseTint === 'function') {
      sky.setPhaseTint(tint);
    }
  }

  // Update or create a chunk's visual representation
  updateChunk(chunk) {
    const key = `${chunk.cx},${chunk.cz}`;
    let visual = this.visuals.get(key);
    if (!visual) {
      visual = new ChunkVisual(this.scene, chunk);
      this.visuals.set(key, visual);
    }
    visual.updateMeshes(this.world);
  }

  // Remove chunk visuals for unloaded chunks
  removeChunk(chunk) {
    const key = `${chunk.cx},${chunk.cz}`;
    const visual = this.visuals.get(key);
    if (visual) {
      visual.removeFromScene();
      this.visuals.delete(key);
    }
  }

  // Phase 2.5: the actual rendering of scan highlights / beam lives
  // in this.scanOverlay (a `ScanOverlay` instance). The shim methods
  // (showScanHighlights, clearScanHighlights, showScanBeam, hideScanBeam)
  // above forward to it. The Renderer class no longer maintains its
  // own highlightGroup — the overlay is the single source of truth.

  // Render the scene for the current phase
  render(playerPhase) {
    const alphaOpacity = 1.0;
    const betaOpacity = playerPhase === 1 ? 0.3 : 0.08;
    const gammaOpacity = playerPhase === 2 ? 0.3 : 0.08;

    // Update phase colors on meshes
    for (const visual of this.visuals.values()) {
      if (visual.meshes.alpha) {
        visual.meshes.alpha.material.opacity = alphaOpacity;
      }
      if (visual.meshes.beta) {
        visual.meshes.beta.material.opacity = betaOpacity;
      }
      if (visual.meshes.gamma) {
        visual.meshes.gamma.material.opacity = gammaOpacity;
      }
    }

    // Update phase-based light color
    const phaseColors = [0x88aaff, 0xffaa88, 0x88ff88];
    const phaseLight = this.scene.getObjectByName('phaseLight');
    if (phaseLight) {
      phaseLight.color.setHex(phaseColors[playerPhase] || 0xffffff);
    }

    // Update Echo objects
    this._updateEchoVisuals(playerPhase);
    // Update Resonance Core objects
    this._updateCoreVisuals(playerPhase);

    // Pass phase info to post-processing shader
    if (this.phasePass) {
      this.phasePass.uniforms.uPhase.value = playerPhase;
      this.phasePass.uniforms.uResonating.value = this.phaseManager.isShifting ? 1.0 : 0.0;
    }

    // Render via post-processing composer (bloom + phase shader + vignette)
    if (this.composer && this.webglRenderer) {
      this.composer.render();
    }
  }

  // Update Echo object visuals (floating rotating crystals)
  _updateEchoVisuals(playerPhase) {
    const echoes = this.world.getEchoes();
    // Remove collected echoes
    const collectedIndices = [];
    for (let i = 0; i < this._echoGroup.children.length; i++) {
      const child = this._echoGroup.children[i];
      if (child.userData.collected) {
        collectedIndices.push(i);
      }
    }
    // Remove collected echo meshes
    for (const i of collectedIndices.reverse()) {
      const child = this._echoGroup.children[i];
      this._echoGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    // Track currently rendered echo positions
    const existingPositions = new Set();
    for (const child of this._echoGroup.children) {
      const key = `${child.userData.wx},${child.userData.wy},${child.userData.wz}`;
      existingPositions.add(key);
    }

    // Add/create echo objects that aren't rendered yet
    for (const echo of echoes) {
      const key = `${echo.x},${echo.y},${echo.z}`;
      if (existingPositions.has(key)) continue;

      // Create a small rotating crystal for the echo
      const geom = new THREE.OctahedronGeometry(0.25, 0);
      const material = new THREE.MeshBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.position.set(echo.x + 0.5, echo.y + 0.7, echo.z + 0.5);
      mesh.userData.wx = echo.x;
      mesh.userData.wy = echo.y;
      mesh.userData.wz = echo.z;
      mesh.userData.collected = false;
      mesh.userData.isEcho = true;
      this._echoGroup.add(mesh);
    }

    // Animate existing echoes (bob up and down, rotate)
    const time = Date.now() * 0.001;
    for (const child of this._echoGroup.children) {
      const baseY = child.userData.wy + 0.7;
      child.position.y = baseY + Math.sin(time * 2 + child.userData.wz) * 0.08;
      child.rotation.y += 0.02;
      child.rotation.z = Math.sin(time * 1.5 + child.userData.wx) * 0.1;

      // Highlight nearby echoes (within 4 blocks)
      const playerPos = this.world._playerPosition;
      if (playerPos) {
        const dx = child.userData.wx - Math.floor(playerPos.x);
        const dy = child.userData.wy - Math.floor(playerPos.y);
        const dz = child.userData.wz - Math.floor(playerPos.z);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const proximity = Math.max(0, 1 - dist / 6);
        child.material.opacity = 0.4 + proximity * 0.6;
        child.scale.setScalar(0.8 + proximity * 0.5);
      }
    }
  }

  // Update Resonance Core visuals (pulsating crystals)
  _updateCoreVisuals(playerPhase) {
    const cores = this.world.getResonanceCores();

    // Create core objects that don't exist yet
    const existingPositions = new Set();
    for (const child of this._coreGroup.children) {
      const key = `${child.userData.wx},${child.userData.wy},${child.userData.wz}`;
      existingPositions.add(key);
    }

    // Create new cores
    for (const core of cores) {
      const key = `${core.x},${core.y},${core.z}`;
      if (existingPositions.has(key)) continue;

      // Create a pulsating crystal for the resonance core
      const geom = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const material = new THREE.MeshBasicMaterial({
        color: 0xe6cc33,
        transparent: true,
        opacity: 0.7,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.position.set(core.x + 0.5, core.y + 0.5, core.z + 0.5);
      mesh.userData.wx = core.x;
      mesh.userData.wy = core.y;
      mesh.userData.wz = core.z;
      mesh.userData.isCore = true;
      this._coreGroup.add(mesh);
    }

    // Animate cores (pulsate)
    const time = Date.now() * 0.001;
    for (const child of this._coreGroup.children) {
      const pulse = 0.7 + Math.sin(time * 3) * 0.3;
      child.scale.setScalar(pulse);
      child.material.opacity = 0.4 + pulse * 0.4;
      child.rotation.y += 0.015;
    }
  }
}
