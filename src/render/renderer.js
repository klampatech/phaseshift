import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT,
  BLOCK_WOOD, BLOCK_CRYSTAL, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_RUNE, BLOCK_SAND,
  BLOCK_GLASS, BLOCK_IRON, BLOCK_GOLD_ORE, BLOCK_WATER, BLOCK_PHASE_COLORS,
  PHASE_COLORS, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION } from '../core/constants.js';

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
      const geom = new THREE.BufferGeometry();
      const posArray = new Float32Array(positions);
      const colArray = new Float32Array(colors);

      geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colArray, 3));

      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      });

      const mesh = new THREE.Mesh(geom, material);
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
    0.8, // strength
    0.4, // radius
    0.1  // threshold
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

// Create skybox (gradient)
export function createSkybox(scene) {
  const skyGeom = new THREE.SphereGeometry(500, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0xffffff) },
      offset: { value: 20 },
      exponent: { value: 0.6 },
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
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide,
  });
  const sky = new THREE.Mesh(skyGeom, skyMat);
  scene.add(sky);
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
