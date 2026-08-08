import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, WORLD_SEED, BLOCK_PROPERTIES } from './src/core/constants.js';
import { World } from './src/core/world.js';
import { PhaseManager } from './src/core/phase.js';
import { PhysicsManager } from './src/core/physics.js';
import { setupLighting, createPlayerMesh, createSkybox, ChunkVisual, setupPostProcessing } from './src/render/renderer.js';
import { Controls } from './src/input/controls.js';
import { HUD } from './src/ui/hud.js';
import { AudioManager } from './src/audio/manager.js';
import { SaveSystem, Settings } from './src/save/system.js';

// Game state
let scene, camera, renderer, controls, hud, audioManager;
let world, phaseManager, physicsManager;
let playerMesh, skybox;
let lighting;
let postProcessing;
let animFrameId;
let lastTime = 0;
let frameCount = 0;
let gameRunning = false;
let gamePaused = false;
let settings;
let saveSystem;

// Block visual cache
const blockMeshes = new Map();
const chunkVisuals = new Map();

// Raycaster for block interaction
const raycaster = new THREE.Raycaster();
const rayDir = new THREE.Vector3();

// Interaction state
let anchorPlaced = false;
let scanActive = false;
let phaseLensActive = false;
let lastInteractedPos = null;
let shiftKeyHeld = false;
let eKeyHeld = false;
let qKeyHeld = false;
let currentBlockPlaced = null; // block type for shift+click placement
let blockBreaking = false;
let blockBreakProgress = 0;
const BLOCK_BREAK_DURATION = 0.5; // seconds to break a block

function init() {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.008);

  // Create camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  // Create renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // Setup post-processing (bloom + phase color grading)
  postProcessing = setupPostProcessing(renderer, scene, camera);

  // Setup lighting
  lighting = setupLighting(scene);

  // Create skybox
  skybox = createSkybox(scene);

  // Create player mesh
  playerMesh = createPlayerMesh();
  scene.add(playerMesh);

  // Initialize systems
  settings = new Settings();
  saveSystem = new SaveSystem();

  // Create world
  world = new World(scene, (chunk) => updateChunkVisual(chunk));

  // Create phase manager
  phaseManager = new PhaseManager();
  phaseManager.addListener(onPhaseChanged);

  // Create physics manager
  physicsManager = new PhysicsManager(world, phaseManager);

  // Audio (must be before pointerlock handler)
  audioManager = new AudioManager();

  // Position player at spawn
  physicsManager.setPosition(0, 20, 0);
  camera.position.set(0, 20, 0);

  // Load initial chunks around player
  world.updateChunks(0, 0);
  console.log("Initial chunks loaded:", world.getChunks().size);

  // Setup controls
  const blocker = document.getElementById('blocker');
  controls = new Controls(camera, renderer.domElement);

  // Pointer lock
  blocker.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
      blocker.classList.add('hidden');
      if (!gameRunning) {
        gameRunning = true;
        audioManager.init();
        audioManager.resume();
        lastTime = performance.now();
        // Initial HUD update so phase names show immediately
        hud.update(phaseManager, physicsManager);
        requestAnimationFrame(gameLoop);
      }
    } else {
      blocker.classList.remove('hidden');
      gameRunning = false;
    }
  });

  // HUD
  hud = new HUD(document.getElementById('hud'));
  hud.update(phaseManager, physicsManager);

  // Handle window resize
  window.addEventListener('resize', onResize);

  // Menu button wiring
  setupMenuButtons();

  // Phase cycling via right-click (when not in pointer lock context menu)
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (document.pointerLockElement) {
      phaseManager.cyclePhase();
    }
  });

  // Handle key press for phase cycling and menus
  document.addEventListener('keydown', (e) => {
    if (!document.pointerLockElement) return;
    
    // Direct phase selection (1, 2, 3)
    if (e.key === '1') { phaseManager.setPhase(PHASE_ALPHA); phaseManager.notify(); }
    if (e.key === '2') { phaseManager.setPhase(PHASE_BETA); phaseManager.notify(); }
    if (e.key === '3') { phaseManager.setPhase(PHASE_GAMMA); phaseManager.notify(); }
    
    // Menu toggles (only when NOT in pointer lock)
    // Shift handling for other keys
    if (e.key === 'Shift') shiftKeyHeld = true;
    if (e.key === 'Control') { playerMesh.scale.y = 0.5; playerMesh.position.y -= 0.9; }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftKeyHeld = false;
    if (e.key === 'Control') { playerMesh.scale.y = 1; playerMesh.position.y += 0.9; }
  });

  // Mouse click for block interaction (when pointer locked)
  document.addEventListener('click', (e) => {
    if (!document.pointerLockElement || gamePaused) return;
    
    if (e.button === 0 && shiftKeyHeld) {
      // Shift+click: place anchor at targeted position
      placeAnchor();
    } else if (e.button === 2) {
      // Right-click: cycle phase (also handled by contextmenu)
      phaseManager.cyclePhase();
    } else if (e.button === 0) {
      // Left-click: break block or start collecting
      breakBlock();
    }
  });

  // Mouse movement for raycasting (block hint display)
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement || gamePaused) return;
    updateBlockHint();
  });

  // Initial chunk generation
  updateChunkVisuals();

  // Show phase name
  hud.showNotification('ALPHA', '#5aa85a');

  console.log('Phase Shifter initialized!');
}

function setupMenuButtons() {
  const pauseMenu = document.getElementById('pause-menu');
  const inventoryPanel = document.getElementById('inventory-panel');
  const optionsPanel = document.getElementById('options-panel');

  // Pause menu buttons
  document.getElementById('btn-resume').addEventListener('click', () => {
    pauseMenu.style.display = 'none';
    gamePaused = false;
    renderer.domElement.requestPointerLock();
  });
  document.getElementById('btn-inv').addEventListener('click', () => {
    pauseMenu.style.display = 'none';
    inventoryPanel.style.display = 'flex';
    updateInventoryUI();
  });
  document.getElementById('btn-save').addEventListener('click', () => {
    saveGame();
  });
  document.getElementById('btn-opts').addEventListener('click', () => {
    pauseMenu.style.display = 'none';
    optionsPanel.style.display = 'flex';
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    gameRunning = false;
    gamePaused = true;
    pauseMenu.style.display = 'none';
    inventoryPanel.style.display = 'none';
    optionsPanel.style.display = 'none';
    document.exitPointerLock();
    document.getElementById('blocker').classList.remove('hidden');
  });

  // Inventory panel
  document.getElementById('inv-close').addEventListener('click', () => {
    inventoryPanel.style.display = 'none';
  });

  // Options panel
  document.getElementById('opts-close').addEventListener('click', () => {
    optionsPanel.style.display = 'none';
  });
  document.getElementById('opt-autosave').addEventListener('click', () => {
    const opts = document.getElementById('opt-autosave');
    if (opts.textContent.includes('ON')) {
      opts.textContent = 'Auto-Save: OFF';
      if (settings) settings.setAutoSave(false);
    } else {
      opts.textContent = 'Auto-Save: ON';
      if (settings) settings.setAutoSave(true);
    }
  });

  // Pause on P key (when pointer is NOT locked)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
      // Only toggle pause when pointer is NOT locked (player has hit P to open menu)
      togglePause();
    }
  });

  // Inventory toggle (I key)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') {
      const inventoryPanel = document.getElementById('inventory-panel');
      const wasOpen = inventoryPanel.style.display === 'flex';
      inventoryPanel.style.display = wasOpen ? 'none' : 'flex';
      if (!wasOpen) updateInventoryUI();
    }
    // Minimap toggle (M key)
    if (e.key === 'm' || e.key === 'M') {
      hud.setMinimapVisible(!hud.minimapVisible);
    }
  });
}

function togglePause() {
  gamePaused = !gamePaused;
  const pauseMenu = document.getElementById('pause-menu');
  const blocker = document.getElementById('blocker');
  
  if (gamePaused) {
    pauseMenu.style.display = 'flex';
    // Restore last save info
    const saveInfo = document.getElementById('save-info');
    if (saveInfo && saveSystem) {
      const lastSave = saveSystem.getLastSaveInfo();
      if (lastSave) {
        saveInfo.textContent = `Last save: ${lastSave}`;
      }
    }
  } else {
    pauseMenu.style.display = 'none';
    renderer.domElement.requestPointerLock();
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPhaseChanged(phaseManager) {
  const phase = phaseManager.getCurrentPhase();
  const targetPhase = phaseManager.targetPhase;
  const colors = ['#5aa85a', '#3399e6', '#d9b34c'];
  const names = ['ALPHA', 'BETA', 'GAMMA'];

  // Update the #phase-name DOM element
  const phaseNameEl = document.querySelector('#phase-name');
  if (phaseNameEl) {
    const displayPhase = phaseManager._isShifting ? targetPhase : phase;
    phaseNameEl.textContent = names[displayPhase];
    phaseNameEl.style.color = colors[displayPhase];
  }

  if (hud) {
    const displayPhase = phaseManager._isShifting ? targetPhase : phase;
    hud.showNotification(names[displayPhase], colors[displayPhase]);
  }

  // Update scene fog/background to match phase
  scene.fog.color.setRGB(
    colors[phase].substring(1, 3),
    colors[phase].substring(3, 5),
    colors[phase].substring(5, 7)
  );
  // Actually set properly
  const hex = parseInt(colors[phase].substring(1), 16);
  scene.background.setRGB((hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255);
  scene.fog.color.setRGB(
    (hex >> 16 & 255) / 255,
    (hex >> 8 & 255) / 255,
    (hex & 255) / 255
  );

  // Update phase light color
  if (lighting && lighting.phaseLight) {
    lighting.phaseLight.color.set(colors[phase]);
    lighting.phaseLight.intensity = 0.3 + (phase * 0.1);
  }

  // Update ambient music
  if (audioManager) {
    audioManager.stopAmbientMusic();
    audioManager.startAmbientMusic(phase);
    audioManager.playShift(phase);
  }
}

function gameLoop(time) {
  if (!gameRunning) return;

  const deltaTime = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  // Update phase manager
  phaseManager.update(deltaTime);

  // Update HUD
  if (hud) hud.update(phaseManager, physicsManager);

  // Handle Pause (P) - when pointer is NOT locked
  if (gamePaused) {
    requestAnimationFrame(gameLoop);
    postProcessing.composer.render();
    return;
  }

  // Handle Phase Lens (E key hold)
  const pos = physicsManager.getPos();
  world.updateChunks(pos.x, pos.z);
  
  // Rebuild visuals for new chunks
  world.getChunks().forEach((chunk, key) => {
    if (!chunk.loaded) return;
    if (!chunkVisuals.has(key)) {
      const visual = new ChunkVisual(scene, chunk);
      chunkVisuals.set(key, visual);
    }
    chunkVisuals.get(key).updateMeshes(world);
  });
  
  // Physics update
  const ctrlState = controls.getState();
  const velocity = physicsManager.getVelocity();
  
  // Apply gravity
  if (!physicsManager.isGrounded) {
    physicsManager.update(deltaTime);
  } else {
    // On ground: apply movement
    let moveX = 0, moveZ = 0;
    if (ctrlState.moveZ < 0) moveZ -= 1;
    if (ctrlState.moveZ > 0) moveZ += 1;
    if (ctrlState.moveX < 0) moveX -= 1;
    if (ctrlState.moveX > 0) moveX += 1;
    
    const speed = ctrlState.sprint ? 1.5 : 1;
    
    // Apply camera direction
    if (moveX !== 0 || moveZ !== 0) {
      const forward = new THREE.Vector3(0, 0, -1);
      const right = new THREE.Vector3(1, 0, 0);
      const direction = new THREE.Vector3();
      
      // Get camera yaw (horizontal rotation)
      const yaw = Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);
      
      direction.x = (Math.sin(yaw) * moveZ + Math.cos(yaw) * moveX) * speed;
      direction.z = (Math.cos(yaw) * moveZ - Math.sin(yaw) * moveX) * speed;
      
      physicsManager.update(deltaTime, direction.x, direction.z);
    } else {
      physicsManager.update(deltaTime);
    }
  }
  // End of game loop ground physics else block

  // Handle Jump (Space)
  if (ctrlState.jump && physicsManager.isGrounded) {
    physicsManager.jump();
  }

  // Handle Phase Shift (Shift+Space)
  if (ctrlState.shifting) {
    phaseManager.cyclePhase();
  }

  // Handle Scanning (E)
  if (ctrlState.scanning && !scanActive) {
    scanActive = true;
    performScan(pos);
  }
  if (!ctrlState.scanning) {
    scanActive = false;
  }

  // Handle Phase Lens (hold E)
  if (ctrlState.scanning && !phaseLensActive) {
    phaseLensActive = true;
  }
  if (!ctrlState.scanning) {
    phaseLensActive = false;
  }
  // Phase Lens: make blocks invisible in non-current phases fade out
  updatePhaseLensVisibility();

  // Handle Resonance Scan (Q)
  if (ctrlState.resonating && !qKeyHeld) {
    qKeyHeld = true;
    performResonance(pos);
  }
  if (!ctrlState.resonating) {
    qKeyHeld = false;
  }

  // Handle Block Interaction (Mouse)
  // Already handled by event listeners

  // Update block hint based on crosshair raycast
  updateBlockHint();

  // Update inventory UI periodically (throttled)
  if (frameCount % 30 === 0) {
    updateInventoryUI();
  }
  frameCount++;

  // Update phase-based post-processing
  postProcessing.updatePhase(phaseManager.getCurrentPhase(), ctrlState.resonating);

  // Render with post-processing
  postProcessing.composer.render();
  requestAnimationFrame(gameLoop);
}

function updatePhaseLensVisibility() {
  const phase = phaseManager.getCurrentPhase();
  const phaseName = PHASE_NAMES[phase];
  
  chunkVisuals.forEach((visual) => {
    const phases = ['alpha', 'beta', 'gamma'];
    // When phase lens is active, make blocks of OTHER phases transparent
    phases.forEach((p) => {
      const mesh = visual.meshes[p];
      if (mesh) {
        // When phase lens is active and not in current phase, make it transparent
        mesh.material.opacity = phaseLensActive && p !== phaseName ? 0.1 : 0.95;
      }
    });
  });
}

function performScan(pos) {
  // Scan nearby blocks for phase information
  const scanRadius = 8;
  let scannedBlocks = 0;
  const chunks = world.getChunks();
  
  chunks.forEach((chunk) => {
    const cx = chunk.x * CHUNK_SIZE;
    const cz = chunk.z * CHUNK_SIZE;
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    
    if (Math.abs(dx) > CHUNK_SIZE || Math.abs(dz) > CHUNK_SIZE) return;
    if (Math.sqrt(dx*dx + dz*dz) > scanRadius) return;
    if (!chunk.loaded || !chunk.alphaData) return;
    
    // Scan through the chunk data for non-air blocks
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx + x;
        const wz = cz + z;
        const dist = Math.sqrt((pos.x - wx)**2 + (pos.z - wz)**2);
        if (dist > scanRadius) continue;
        
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const block = chunk.alphaData[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x];
          if (block !== BLOCK_AIR) {
            scannedBlocks++;
          }
        }
      }
    }
  });
  
  // Consume energy for scan
  phaseManager.consumeEnergy(3); // SCAN_COST from constants
  
  if (scannedBlocks > 0) {
    hud.showNotification(`SCANNED: ${scannedBlocks} blocks`, '#5aa85a');
  }
  
  // Visual feedback: flash the crosshair
  const crosshair = document.getElementById('crosshair');
  crosshair.style.background = '#5aa85a';
  setTimeout(() => { crosshair.style.background = '#fff'; }, 200);
}

function performResonance(pos) {
  // Resonance scan: find phase-specific blocks
  const resonanceRadius = 16;
  let resonanceBlocks = [];
  const chunks = world.getChunks();
  
  chunks.forEach((chunk) => {
    const cx = chunk.x * CHUNK_SIZE;
    const cz = chunk.z * CHUNK_SIZE;
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    
    if (Math.abs(dx) > CHUNK_SIZE || Math.abs(dz) > CHUNK_SIZE) return;
    if (Math.sqrt(dx*dx + dz*dz) > resonanceRadius) return;
    if (!chunk.loaded || !chunk.alphaData) return;
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx + x;
        const wz = cz + z;
        const dist = Math.sqrt((pos.x - wx)**2 + (pos.z - wz)**2);
        if (dist > resonanceRadius) continue;
        
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const block = chunk.alphaData[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x];
          if (block !== BLOCK_AIR) {
            const props = BLOCK_PROPERTIES[block];
            if (props && props.phase) {
              resonanceBlocks.push({ x: wx, y, z, block, phases: [...props.phase] });
            }
          }
        }
      }
    }
  });
  
  // Consume energy for resonance
  phaseManager.consumeEnergy(15); // RESONATE_COST from constants
  
  if (resonanceBlocks.length > 0) {
    hud.showNotification(`RESONANCE: ${resonanceBlocks.length} phase-blocks`, '#d9b34c');
    
    // Show phase-specific blocks with special glow
    resonanceBlocks.forEach(rb => {
      const blockProps = BLOCK_PROPERTIES[rb.block];
      const chunk = world.getChunk(rb.x, rb.z);
      const cKey = `${chunk.x},${chunk.z}`;
      const visual = chunkVisuals.get(cKey);
      if (visual && blockProps && blockProps.phase) {
        const phases = ['alpha', 'beta', 'gamma'];
        const matchingPhase = phases[blockProps.phase[0]];
        const mesh = visual.meshes[matchingPhase];
        if (mesh) {
          mesh.material.emissive.set('#ff6644');
          mesh.material.emissiveIntensity = 0.5;
          setTimeout(() => {
            mesh.material.emissive.set('#000000');
            mesh.material.emissiveIntensity = 0;
          }, 2000);
        }
      }
    });
  }
}

function placeAnchor() {
  const pos = physicsManager.getPos();
  const dir = getCameraDirection();
  const hit = raycastBlock(pos, dir);
  
  if (hit) {
    // Place anchor at hit position + face normal
    const anchorPos = {
      x: hit.blockX + hit.face.x,
      y: hit.blockY + hit.face.y,
      z: hit.blockZ + hit.face.z
    };
    
    // Use existing phase manager or add anchor
    if (phaseManager.addAnchor) {
      phaseManager.addAnchor(anchorPos.x, anchorPos.y, anchorPos.z);
      hud.showNotification(`ANCHOR PLACED (${anchorPos.x}, ${anchorPos.y}, ${anchorPos.z})`, '#ff6644');
      
      // Visual: place a small glowing marker
      const markerGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xff6644 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(anchorPos.x + 0.5, anchorPos.y + 0.5, anchorPos.z + 0.5);
      scene.add(marker);
      
      // Add to chunk data as BLOCK_ANCHOR (value 15)
      placeBlockAt(anchorPos.x, anchorPos.y, anchorPos.z, 15);
    }
  }
}

function breakBlock() {
  const pos = physicsManager.getPos();
  const dir = getCameraDirection();
  const hit = raycastBlock(pos, dir);
  
  if (hit) {
    // Can only break blocks in current phase (visible)
    const blockType = hit.blockType;
    const chunk = world.getChunk(hit.blockX, hit.blockZ);
    
    if (chunk && chunk.alphaData) {
      // Get the properties of the block we're looking at
      const props = BLOCK_PROPERTIES[blockType];
      
      // Check if block is visible/solid in current phase
      if (props && props.phase && !props.phase.includes(phaseManager.getCurrentPhase())) {
        hud.showNotification('Block not solid in current phase', '#ff4444');
        return;
      }
      
      // Place air at this position to break the block
      placeBlockAt(hit.blockX, hit.blockY, hit.blockZ, BLOCK_AIR);
      hud.showNotification(`BLOCK BROKEN (${hit.blockX}, ${hit.blockY}, ${hit.blockZ})`, '#ff4444');
      
      // Update the chunk visuals
      updateChunkVisuals();
      
      // Spawn collection particle effect
      spawnBreakParticles(hit.blockX, hit.blockY, hit.blockZ, hit.blockType);
    }
  }
}

function placeBlockAt(x, y, z, blockType) {
  const chunk = world.getChunk(x, z);
  if (!chunk || !chunk.alphaData) return;
  
  // Convert world coords to chunk local coords
  const localX = ((x - chunk.x * CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localZ = ((z - chunk.z * CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  
  // Set the block (index = y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x)
  const index = y * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX;
  chunk.alphaData[index] = blockType;
}

function updateChunkVisuals() {
  const pos = physicsManager.getPos();
  world.updateChunks(pos.x, pos.z);
  
  world.getChunks().forEach((chunk, key) => {
    if (!chunk.loaded) return;
    if (!chunkVisuals.has(key)) {
      const visual = new ChunkVisual(scene, chunk);
      chunkVisuals.set(key, visual);
    }
    chunkVisuals.get(key).updateMeshes(world);
  });
}

function getCameraDirection() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return dir;
}

function raycastBlock(origin, direction) {
  raycaster.set(origin, direction);
  raycaster.far = 6.0; // 6 block reach
  
  // Get all chunk meshes
  const meshes = [];
  chunkVisuals.forEach((visual) => {
    const phases = ['alpha', 'beta', 'gamma'];
    const phase = phaseManager.getCurrentPhase();
    const mesh = visual.meshes[phases[phase]];
    if (mesh && mesh.visible) {
      meshes.push(mesh);
    }
  });
  
  const intersects = raycaster.intersectObjects(meshes, false);
  
  if (intersects.length > 0) {
    const intersect = intersects[0];
    const point = intersect.point;
    const face = intersect.face;
    
    // Convert hit point to block coords
    const blockX = Math.floor(point.x);
    const blockY = Math.floor(point.y);
    const blockZ = Math.floor(point.z);
    
    // Determine face normal
    const faceNormal = new THREE.Vector3(
      face ? face.normal.x : 0,
      face ? face.normal.y : 0,
      face ? face.normal.z : 0
    );
    
    // Find the block type
    const chunk = world.getChunk(blockX, blockZ);
    let blockType = BLOCK_AIR;
    if (chunk && chunk.alphaData) {
      const localX = ((blockX - chunk.x * CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localZ = ((blockZ - chunk.z * CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const index = blockY * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX;
      if (index >= 0 && index < chunk.alphaData.length) {
        blockType = chunk.alphaData[index];
      }
    }
    
    return {
      blockX, blockY, blockZ, blockType, face: faceNormal
    };
  }
  
  return null;
}

function updateBlockHint() {
  const pos = physicsManager.getPos();
  const dir = getCameraDirection();
  const hit = raycastBlock(pos, dir);
  
  const blockHint = document.getElementById('block-hint');
  if (hit) {
    const props = BLOCK_PROPERTIES[hit.blockType];
    const phaseName = PHASE_NAMES[phaseManager.getCurrentPhase()];
    if (props) {
      const visible = props.phase && props.phase.length > 0 ? 
        (props.phase.includes(phaseManager.getCurrentPhase()) ? 'VISIBLE' : 'INVISIBLE') : 'INVISIBLE';
      const solidText = props.solid ? 'SOLID' : 'PASS-THROUGH';
      blockHint.textContent = `${props.name} | Phase: ${phaseName} | ${visible} | ${solidText}`;
    }
  } else {
    blockHint.textContent = '';
  }
}

function spawnBreakParticles(blockX, blockY, blockZ, blockType) {
  const props = BLOCK_PROPERTIES[blockType];
  if (!props) return;
  
  const color = new THREE.Color(
    props.color[0] / 255,
    props.color[1] / 255,
    props.color[2] / 255
  );
  
  const particleCount = 8;
  const geometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const material = new THREE.MeshBasicMaterial({ color });
  
  for (let i = 0; i < particleCount; i++) {
    const particle = new THREE.Mesh(geometry, material);
    particle.position.set(
      blockX + 0.5 + (Math.random() - 0.5) * 0.5,
      blockY + 0.5 + (Math.random() - 0.5) * 0.5,
      blockZ + 0.5 + (Math.random() - 0.5) * 0.5
    );
    
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 2,
      (Math.random() - 0.5) * 2
    );
    
    scene.add(particle);
    
    // Animate particle falling
    const startTime = performance.now();
    const animateParticle = (now) => {
      const elapsed = (now - startTime) / 1000;
      if (elapsed > 1.0) {
        scene.remove(particle);
        return;
      }
      particle.position.x += velocity.x * 0.016;
      particle.position.y += velocity.y * 0.016 - 9.8 * elapsed * 0.016;
      particle.position.z += velocity.z * 0.016;
      particle.material.opacity = 1 - elapsed;
      requestAnimationFrame(animateParticle);
    };
    requestAnimationFrame(animateParticle);
  }
}

function updateInventoryUI() {
  const toolGrid = document.getElementById('tool-grid');
  const amplifierGrid = document.getElementById('amplifier-grid');
  const progressInfo = document.getElementById('progress-info');
  
  if (toolGrid) {
    toolGrid.innerHTML = '';
    // Show available tools
    const tools = {
      'Phase Anchor': 'Place anchor points to phase-lock blocks. Shift+click.',
      'Phase Lens': 'See through walls in current phase. Hold E.',
      'Phase Glider': 'Fly briefly through void spaces. Press Space in Beta.'
    };
    
    Object.entries(tools).forEach(([name, desc]) => {
      const div = document.createElement('div');
      div.textContent = `${name}: ${desc}`;
      toolGrid.appendChild(div);
    });
  }
  
  if (amplifierGrid) {
    amplifierGrid.innerHTML = '';
    const amplifiers = {
      'Resonance Core': 'Boosts resonance radius. Found in Gamma biome.',
      'Stabilizer': 'Checkpoint. Restores energy on respawn.',
      'Echo': 'Lore/memory recording. Collect to unlock story.'
    };
    
    Object.entries(amplifiers).forEach(([name, desc]) => {
      const div = document.createElement('div');
      div.textContent = `${name}: ${desc}`;
      amplifierGrid.appendChild(div);
    });
  }
  
  if (progressInfo) {
    const chunks = world ? world.getChunks().size : 0;
    const blocks = world ? world.getChunks().reduce((sum, c) => {
      return sum + (c.alphaData ? c.alphaData.filter(b => b !== BLOCK_AIR).length : 0);
    }, 0) : 0;
    const phase = phaseManager ? phaseManager.getCurrentPhase() : 0;
    
    progressInfo.textContent = `Chunks: ${chunks} | Blocks: ${blocks} | Current Phase: ${PHASE_NAMES[phase]}`;
  }
}

function saveGame() {
  const pos = physicsManager.getPos();
  saveSystem.saveGame(pos.x, pos.y, pos.z, phaseManager.getCurrentPhase());
  hud.showNotification('GAME SAVED', '#4488ff');
  
  // Update save info in pause menu
  const saveInfo = document.getElementById('save-info');
  if (saveInfo && saveSystem) {
    const lastSave = saveSystem.getLastSaveInfo();
    if (lastSave) {
      saveInfo.textContent = `Last save: ${lastSave}`;
    }
  }
}

// Debug hooks for testing
if (typeof window !== 'undefined') {
  window.__phaseShifter__ = {
    // Direct flat API (for tests)
    get chunkCount() { return world && world.getChunks ? world.getChunks().size : 0; },
    // Force a phase cycle (useful for testing without keyboard)
    forceCyclePhase() { 
      if (phaseManager) {
        phaseManager.cyclePhase();
        phaseManager.completeShift();
      }
    },
    get blockCount() { 
      if (!world || !world.getChunks) return 0;
      let count = 0;
      world.getChunks().forEach(chunk => {
        if (chunk && chunk.loaded && chunk.alphaData) {
          count += chunk.alphaData.filter(b => b !== 0).length;
        }
      });
      return count;
    },
    get biomes() {
      if (!world || !world.getChunks) return [];
      const biomes = new Set();
      world.getChunks().forEach(chunk => {
        if (chunk && chunk.biome) biomes.add(chunk.biome);
      });
      return [...biomes];
    },
    get phase() { return phaseManager && phaseManager.getCurrentPhase ? phaseManager.getCurrentPhase() : -1; },
    get energy() { return phaseManager && phaseManager.getEnergy ? phaseManager.getEnergy() : 0; },
    get playerPos() { return physicsManager && physicsManager.getPos ? physicsManager.getPos() : null; },
    // Nested API (for advanced debugging)
    get world() { return world; },
    get phaseManager() { return phaseManager; },
    get physicsManager() { return physicsManager; },
    get controls() { return controls; },
    get gameRunning() { return gameRunning; },
    get camera() { return camera; },
    get scene() { return scene; },
    get _hud() { return hud; },
    worldData: {
      get chunkCount() { return world && world.getChunks ? world.getChunks().size : 0; },
      get blockCount() { 
        if (!world || !world.getChunks) return 0;
        let count = 0;
        world.getChunks().forEach(chunk => {
          if (chunk && chunk.loaded && chunk.alphaData) {
            count += chunk.alphaData.filter(b => b !== 0).length;
          }
        });
        return count;
      },
      get biomes() {
        if (!world || !world.getChunks) return [];
        const biomes = new Set();
        world.getChunks().forEach(chunk => {
          if (chunk && chunk.biome) biomes.add(chunk.biome);
        });
        return [...biomes];
      }
    },
    phaseData: {
      get currentPhase() { return phaseManager && phaseManager.getCurrentPhase ? phaseManager.getCurrentPhase() : -1; },
      get energy() { return phaseManager && phaseManager.getEnergy ? phaseManager.getEnergy() : 0; },
      get isShifting() { return phaseManager && phaseManager._isShifting !== undefined ? phaseManager._isShifting : false; },
      get shiftProgress() { return phaseManager ? phaseManager.getPhaseShiftProgress() : 0; }
    },
    physicsState: {
      get playerPosition() { return physicsManager && physicsManager.getPos ? physicsManager.getPos() : null; },
      get velocity() { return physicsManager && physicsManager.getVelocity ? physicsManager.getVelocity() : null; },
      get isGrounded() { return physicsManager && typeof physicsManager.isGrounded !== 'undefined' ? physicsManager.isGrounded : false; }
    },
    gameState: {
      get settings() { return settings; },
      get saveSystem() { return saveSystem; },
      get chunkVisuals() { return chunkVisuals ? chunkVisuals.size : 0; }
    },
    // Force initialize if needed
    init() {
      if (!scene) init();
    }
  };
  console.log('[Phase Shifter] Debug hooks registered');
}

// Start the game
try {
  init();
} catch (e) {
  console.error('[Phase Shifter] Init failed:', e);
  throw e;
}
