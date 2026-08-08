import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, BLOCK_GRASS, BLOCK_DIRT,
  BLOCK_WOOD, BLOCK_CRYSTAL, BLOCK_OBSIDIAN, BLOCK_VOID, BLOCK_RUNE, BLOCK_SAND,
  BLOCK_GLASS, BLOCK_IRON, BLOCK_GOLD_ORE, BLOCK_WATER, BLOCK_PHASE_COLORS } from '../core/constants.js';

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

        const lx = i % CHUNK_SIZE;
        const lz = Math.floor(i / (CHUNK_SIZE * CHUNK_HEIGHT));
        const ly = Math.floor(i / CHUNK_SIZE) % CHUNK_HEIGHT;
        const wx = this.chunk.cx * CHUNK_SIZE + lx;
        const wy = ly;
        const wz = this.chunk.cz * CHUNK_SIZE + lz;

        // Face culling: skip blocks fully surrounded by solid blocks
        if (this.isSurrounded(data, lx, ly, lz)) continue;

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

  isSurrounded(data, x, y, z) {
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
      const ni = nx + ny * CHUNK_SIZE + nz * CHUNK_SIZE * CHUNK_HEIGHT;
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

// Main renderer class — manages scenes, chunks, player, and rendering
export class Renderer {
  constructor(world, scene, camera, phaseManager, webglRenderer) {
    this.world = world;
    this.scene = scene;
    this.camera = camera;
    this.phaseManager = phaseManager;
    this.webglRenderer = webglRenderer;
    this.visuals = new Map(); // chunkKey -> ChunkVisual
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'scanHighlights';
    this.scene.add(this.highlightGroup);

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

  // Show scan results as colored wireframe outlines
  showScanResults(results) {
    // Clear previous highlights
    while (this.highlightGroup.children.length > 0) {
      const child = this.highlightGroup.children[0];
      this.highlightGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }

    if (!results || results.length === 0) return;

    const phases = ['alpha', 'beta', 'gamma'];

    for (const r of results) {
      const bx = r.x, by = r.y, bz = r.z;

      // Find the block in any phase that has data
      for (let p = 0; p < 3; p++) {
        const block = this.world.getBlock(bx, by, bz, p);
        if (block === BLOCK_AIR) continue;

        // Get phase mask — highlight phases where this block is present
        const mask = this.world.getBlockMask(bx, by, bz);
        if ((mask & (1 << p)) === 0) continue;

        // Create a wireframe box for highlighted phases
        const colors = BLOCK_PHASE_COLORS[p];
        const color = new THREE.Color(colors);
        const boxGeom = new THREE.BoxGeometry(1.02, 1.02, 1.02);
        const edges = new THREE.EdgesGeometry(boxGeom);
        const lineMat = new THREE.LineBasicMaterial({
          color: color,
          linewidth: 2,
          transparent: true,
          opacity: 0.8,
        });
        const wireframe = new THREE.LineSegments(edges, lineMat);
        wireframe.position.set(bx + 0.5, by + 0.5, bz + 0.5);
        this.highlightGroup.add(wireframe);
      }
    }
  }

  // Clear all scan highlights
  clearScanHighlights() {
    while (this.highlightGroup.children.length > 0) {
      const child = this.highlightGroup.children[0];
      this.highlightGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
  }

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
