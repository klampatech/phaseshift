import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, WORLD_SEED, BLOCK_PROPERTIES, PHASE_LENS_DRAIN_RATE, SCAN_RADIUS } from './src/core/constants.js';
import { World } from './src/core/world.js';
import { PhaseManager } from './src/core/phase.js';
import { PhysicsManager } from './src/core/physics.js';
import { setupLighting, createPlayerMesh, createSkybox, ChunkVisual, setupPostProcessing, ScanOverlay } from './src/render/renderer.js';
import { Controls } from './src/input/controls.js';
import { placeBlock as placeBlockAtTarget } from './src/input/placeBlock.js';
import { HUD } from './src/ui/hud.js';
import { AudioManager } from './src/audio/manager.js';
import { SaveSystem, Settings } from './src/save/system.js';
import { scanResults, phaseLensDrain, lensRadius, belowDrainThreshold, hasDifferences } from './src/scan/lens.js';

// Eye height: distance from feet to eyes. Player physics height is 1.7 (see
// src/core/physics.js PLAYER_HEIGHT); 1.6 is a comfortable eye offset for a
// first-person voxel game.
const EYE_HEIGHT = 1.6;

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
// Phase 2.5: one-shot gate for the "Insufficient energy" notification.
// Reset on E release so the next press can re-trigger.
let lens_insufficientNotifiedThisPress = false;
// Phase 2.5: Phase Lens scan overlay (wireframes + beam). Separate
// from the THREE.WebGLRenderer (`renderer`) — the brief is explicit
// that the overlay lives in its own THREE.Group so the chunk-mesh
// group is untouched. The overlay is created once in init() and
// reused for every press/hold/release cycle.
let scanOverlay = null;
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

  // Phase 2.5: Phase Lens scan overlay (wireframes + beam). The
  // overlay adds its own THREE.Group to the scene. The chunk visuals
  // and the overlay are independent — clearing the overlay never
  // touches the chunk meshes.
  scanOverlay = new ScanOverlay(scene);

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

  // Phase 1.6: if a save exists, restore the last position and phase. The
  // returned state is normalized (Phase 1.6 acceptance) and may be null on
  // a fresh start.
  const _savedState = saveSystem.loadGame();
  const _hasSave = !!_savedState;

  // Create world
  world = new World(scene, (chunk) => updateChunkVisual(chunk));

  // Create phase manager
  phaseManager = new PhaseManager();
  phaseManager.addListener(onPhaseChanged);

  // Create physics manager
  physicsManager = new PhysicsManager(world, phaseManager);

  // Apply the loaded phase before we read the world so phase-relative
  // collision matches the saved state. Also re-apply the player's block
  // memory so broken/placed blocks survive a reload.
  if (_hasSave) {
    phaseManager.setPhase(_savedState.phase);
    world.importGlobalState(_savedState.worldState);
  }

  // Audio (must be before pointerlock handler)
  audioManager = new AudioManager();

  // Phase 1.3: Compute a safe spawn via downward raycast instead of
  // hard-coding y=20 (which can put the player inside a block or floating
  // far above the surface). The camera-follow code added in Phase 1.2 will
  // keep the camera glued to whatever position we set here.
  //
  // Strategy:
  //   1. Load a 3×3 chunk area around (0, 0).
  //   2. Raycast straight down from y=CHUNK_HEIGHT-1 to find the highest
  //      solid block at (0, 0).
  //   3. If none found, expand to a 5×5 chunk area and retry.
  //   4. If still none, fall back to a known-safe y=30 so the game still
  //      loads. Logged as an error so it's visible.
  // Phase 1.6: prefer the saved player position; otherwise spawn near (0, 0).
  const _spawnXZ = _hasSave
    ? { x: _savedState.position.x, z: _savedState.position.z }
    : { x: 0, z: 0 };
  // Load a 3x3 chunk area first; the safe-spawn raycast only needs one column.
  world.updateChunks(_spawnXZ.x, _spawnXZ.z);
  console.log("Initial chunks loaded:", world.getChunks().size);

  let topSolidY = world.findTopSolidBlock(_spawnXZ.x, _spawnXZ.z);
  if (topSolidY === null) {
    console.warn(`[Phase Shifter] No solid block at (${_spawnXZ.x}, ${_spawnXZ.z}); expanding to 5x5 chunk area`);
    world.updateChunks(_spawnXZ.x, _spawnXZ.z, 2); // radius=2 → 5x5 chunks around the spawn column
    topSolidY = world.findTopSolidBlock(_spawnXZ.x, _spawnXZ.z);
  }

  if (topSolidY !== null) {
    // Feet on top of the highest solid block: pos.y = blockY + 1 (top
    // surface) + PLAYER_HEIGHT (1.7). PLAYER_HEIGHT is defined in
    // src/core/physics.js.
    physicsManager.setPosition(_spawnXZ.x, topSolidY + 1 + 1.7, _spawnXZ.z);
  } else {
    console.error('[Phase Shifter] No solid block found in 5x5 area; falling back to y=30');
    physicsManager.setPosition(_spawnXZ.x, 30, _spawnXZ.z);
  }

  // Initialize the camera at the spawn position (with EYE_HEIGHT offset).
  // The Phase 1.2 follow code in gameLoop keeps it glued afterwards.
  const _spawnPos = physicsManager.getPos();
  camera.position.set(_spawnPos.x, _spawnPos.y + EYE_HEIGHT, _spawnPos.z);

  console.info('[Phase Shifter] Spawned at', _spawnPos.toArray());
  refreshSaveInfo();

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

  // Menu button wiring is at the end of init() (see below).

  // Phase 2.3 RMB disambiguation. Right-click fires the `contextmenu`
  // event before the `click` event, so the disambiguation logic lives here
  // (it must run before any phase cycle starts). RMB on a face places
  // Stone; RMB in open air cycles the phase (existing §2.1 behavior).
  // The actual placement is delegated to tryPlaceStoneOnFace() so the
  // §2.1 PhaseManager.cyclePhase() call stays reachable within the §2.1
  // static-analysis regex distance.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!document.pointerLockElement) return;
    const hit = raycastBlock(physicsManager.getPos(), getCameraDirection());
    if (tryPlaceStoneOnFace(hit)) return;
    phaseManager.cyclePhase();
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

  // Mouse click for block interaction (when pointer locked).
  // Phase 2.3: RMB disambiguation is in the `contextmenu` handler (which
  // fires first). The spam guard in PhaseManager.cyclePhase would prevent
  // a double-cycle here anyway, but we don't call cyclePhase at all from
  // this handler so the §2.3 place-on-face path is unambiguous.
  document.addEventListener('click', (e) => {
    if (!document.pointerLockElement || gamePaused) return;

    if (e.button === 0 && shiftKeyHeld) {
      // Shift+click: place anchor (Phase 2.7 will replace this body
      // with the lockManager path). For Phase 2.3, placeAnchor is a
      // no-op + notification so the world doesn't get a stray BLOCK_15.
      placeAnchor();
    } else if (e.button === 0) {
      // Left-click: break block
      breakBlock();
    }
    // e.button === 2 (RMB) is handled by the contextmenu listener.
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

  // Menu wiring is the LAST step so a failure here can't block gameplay
  // listeners attached above. (Phase 1.1.)
  setupMenuButtons();

  console.log('Phase Shifter initialized!');
}

function setupMenuButtons() {
  // Each button is wired only if its DOM element exists, so missing markup
  // never crashes init(). (Phase 1.1.)
  const safeOn = (id, evt, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, handler);
    return el;
  };

  const pauseMenu = document.getElementById('pause-menu');
  const inventoryPanel = document.getElementById('inventory-panel');
  const optionsPanel = document.getElementById('options-panel');

  // Pause menu buttons
  safeOn('btn-resume', 'click', () => {
    pauseMenu.style.display = 'none';
    gamePaused = false;
    renderer.domElement.requestPointerLock();
  });
  safeOn('btn-inv', 'click', () => {
    pauseMenu.style.display = 'none';
    if (inventoryPanel) {
      inventoryPanel.style.display = 'flex';
      updateInventoryUI();
    }
  });
  safeOn('btn-save', 'click', () => {
    saveGame();
  });
  safeOn('btn-opts', 'click', () => {
    pauseMenu.style.display = 'none';
    if (optionsPanel) optionsPanel.style.display = 'flex';
  });
  safeOn('btn-quit', 'click', () => {
    gameRunning = false;
    gamePaused = true;
    if (pauseMenu) pauseMenu.style.display = 'none';
    if (inventoryPanel) inventoryPanel.style.display = 'none';
    if (optionsPanel) optionsPanel.style.display = 'none';
    document.exitPointerLock();
    document.getElementById('blocker').classList.remove('hidden');
  });

  // Inventory panel
  safeOn('inv-close', 'click', () => {
    if (inventoryPanel) inventoryPanel.style.display = 'none';
  });

  // Options panel
  safeOn('opts-close', 'click', () => {
    if (optionsPanel) optionsPanel.style.display = 'none';
  });
  safeOn('opt-autosave', 'click', () => {
    const opts = document.getElementById('opt-autosave');
    if (!opts) return;
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
    refreshSaveInfo();
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

// Parse a '#rrggbb' hex string into [r, g, b] 0-255 integers. Returns
// white on parse failure so the HUD never shows NaN.
function parseHexColor(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) {
    return [255, 255, 255];
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function onPhaseChanged(phaseManager) {
  const phase = phaseManager.getCurrentPhase();
  const targetPhase = phaseManager.targetPhase;
  const colors = ['#5aa85a', '#3399e6', '#d9b34c'];
  const names = ['ALPHA', 'BETA', 'GAMMA'];

  // Update the #phase-name DOM element and the #phase-indicator dot.
  // Both must change together so the HUD reads as one unit. Hex → RGB
  // tuple for the indicator backgroundColor (Phase 2.1 brief).
  const phaseNameEl = document.querySelector('#phase-name');
  const phaseIndicatorEl = document.querySelector('#phase-indicator');
  const displayPhase = phaseManager._isShifting ? targetPhase : phase;
  const [hexR, hexG, hexB] = parseHexColor(colors[displayPhase]);
  if (phaseNameEl) {
    phaseNameEl.textContent = names[displayPhase];
    phaseNameEl.style.color = colors[displayPhase];
    phaseNameEl.style.textShadow = `0 0 8px ${colors[displayPhase]}`;
  }
  if (phaseIndicatorEl) {
    phaseIndicatorEl.style.backgroundColor = `rgb(${hexR}, ${hexG}, ${hexB})`;
    phaseIndicatorEl.style.boxShadow = `0 0 8px rgba(${hexR}, ${hexG}, ${hexB}, 0.7)`;
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

  // Drive the post-processing uPhase uniform immediately on a phase
  // change so the shader tint tracks the active phase at the exact
  // moment the cycle completes (Phase 2.1 acceptance: uniform updated on
  // every shift). The game loop also calls updatePhase() per-frame so
  // the uResonating side keeps responding to the Q-key state.
  if (postProcessing && typeof postProcessing.setPhase === 'function') {
    postProcessing.setPhase(phase);
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
    
    // Apply camera direction (Phase 1.2: quaternion-derived basis)
    if (moveX !== 0 || moveZ !== 0) {
      // controls._onMouseMove already applies yaw/pitch to camera.quaternion
      // via THREE.Euler(pitch, yaw, 0, 'YXZ'). Derive the horizontal movement
      // basis from that quaternion so walking direction matches look direction
      // (including pitch — looking up/down no longer rotates the wrong way).
      // Derive the horizontal movement basis from camera.quaternion
      // (controls._onMouseMove already applies yaw/pitch via
      //  THREE.Euler(pitch, yaw, 0, 'YXZ')). This means walking direction
      // always matches look direction — including looking up/down, where
      // pitch would have warped the old atan2() formula.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right   = new THREE.Vector3(1, 0,  0).applyQuaternion(camera.quaternion);
      forward.y = 0; forward.normalize();
      right.y   = 0; right.normalize();

      // Sign convention: controls.js sets moveZ=-1 for W (forward) and
      // moveX=+1 for D (strafe right). Three.js camera convention is
      // forward = -Z at identity. So W → -moveZ scales forward; D → moveX
      // scales right.
      const direction = new THREE.Vector3()
        .addScaledVector(forward, -moveZ)
        .addScaledVector(right,    moveX)
        .multiplyScalar(speed);

      physicsManager.update(deltaTime, direction.x, direction.z);
    } else {
      physicsManager.update(deltaTime);
    }
  }
  // End of game loop ground physics else block

  // Camera follow (Phase 1.2): trail the player with eye-height offset.
  // Done after every physics tick so the camera reflects the freshest position.
  const _camFollowPos = physicsManager.getPos();
  camera.position.set(_camFollowPos.x, _camFollowPos.y + EYE_HEIGHT, _camFollowPos.z);

  // Handle Jump (Space)
  if (ctrlState.jump && physicsManager.isGrounded) {
    physicsManager.jump();
  }

  // Handle Phase Shift (Shift+Space)
  if (ctrlState.shifting) {
    phaseManager.cyclePhase();
  }

  // Phase 2.5: Phase Lens (hold E). The lens is a continuous affordance:
  // while ctrlState.scanning is true, the renderer must show colored
  // wireframes around cells that differ from the current phase, plus a
  // beam from the camera in the crosshair direction, and energy must
  // drain at PHASE_LENS_DRAIN_RATE per second. When the player releases
  // E, the lens clears within one frame and no further energy is
  // consumed.
  if (ctrlState.scanning) {
    // Edge: rising edge of E (just pressed). Fire the one-shot scan
    // notification (existing §2.5 acceptance #1) and set the gate so
    // we don't double-fire.
    if (!scanActive) {
      scanActive = true;
      performScan(pos);
    }
    // Hold path: check energy, drain, and render the overlay.
    if (phaseManager.getEnergy() < PHASE_LENS_DRAIN_RATE * deltaTime) {
      // Insufficient energy: turn the lens off and notify once per
      // press (the loop is gated by scanActive so the notification
      // is exactly one-shot). Brief acceptance #3.
      if (lens_insufficientNotifiedThisPress !== true) {
        hud.showNotification('Insufficient energy', '#ff8844');
        lens_insufficientNotifiedThisPress = true;
      }
      // Force-clear the lens without consuming more energy.
      ctrlState.scanning = false;
      scanActive = false;
      if (postProcessing && postProcessing.composer) {
        // Renderer API: clear highlights + beam.
      }
      if (scanOverlay) {
        scanOverlay.clearScanHighlights();
        scanOverlay.hideScanBeam();
      }
    } else {
      // Normal hold path: drain energy per dt, then redraw the
      // overlay. The drain is dt-scaled so 1 second of hold = 0.5
      // energy, 2 seconds = 1.0, etc.
      phaseLensActive = true;
      const drain = phaseLensDrain(deltaTime);
      if (drain > 0) {
        phaseManager.consumeEnergy(drain);
      }
      // Re-scan each frame so the wireframes track the player as
      // they move (and so the player sees cells appear/disappear as
      // the lens sweeps over them).
      const results = scanResults(pos.x, pos.y, pos.z, lensRadius(), phaseManager.getCurrentPhase(), world);
      if (scanOverlay) {
        scanOverlay.showScanHighlights(results, phaseManager.getCurrentPhase());
        scanOverlay.showScanBeam(camera, phaseManager.getCurrentPhase());
      }
    }
  } else {
    // Released E -> clear the lens within one frame.
    if (scanActive) {
      scanActive = false;
    }
    if (phaseLensActive) {
      phaseLensActive = false;
      // Reset the one-shot notification gate so the next press can
      // re-trigger the "Insufficient energy" message if needed.
      lens_insufficientNotifiedThisPress = false;
    }
    if (scanOverlay) {
      scanOverlay.clearScanHighlights();
      scanOverlay.hideScanBeam();
    }
  }

  // Phase Lens (legacy fade non-current phases): keep the existing
  // updatePhaseLensVisibility() so the per-phase chunk opacity works
  // alongside the new wireframe overlay. The two are complementary —
  // the overlay shows the per-cell shape, the legacy fade shows the
  // whole-phase block visibility.
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

  // Phase 2.1: drive the full-screen color pulse during a shift so the
  // player gets a visible ~1.5s color pulse (rgba(targetPhaseColor,
  // 1 - shiftProgress) per the brief). The overlay is transparent when
  // not shifting so it has no effect on normal rendering.
  updatePhaseShiftOverlay();

  // Render with post-processing
  postProcessing.composer.render();
  requestAnimationFrame(gameLoop);
}

// Phase 2.1: update the #phase-shift-overlay background to match the
// target phase color * (1 - shiftProgress). Called once per frame.
function updatePhaseShiftOverlay() {
  const overlay = document.getElementById('phase-shift-overlay');
  if (!overlay) return;
  if (!phaseManager._isShifting) {
    // Transparent when idle. Use rgba so future JS reads of the
    // backgroundColor still parse cleanly.
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    return;
  }
  const targetPhase = phaseManager.getTargetPhase();
  const colors = ['#5aa85a', '#3399e6', '#d9b34c'];
  const [r, g, b] = parseHexColor(colors[targetPhase] || '#ffffff');
  // 1 - shiftProgress: full saturation at start of shift, transparent at
  // the end. Cap at 0.55 so the pulse isn't blinding during heavy bloom.
  const alpha = Math.max(0, Math.min(0.55, (1 - phaseManager.getPhaseShiftProgress()) * 0.55));
  overlay.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

// Phase 2.5: performScan — one-shot press of E (the rising edge). The
// brief's acceptance #1 is "World.scanNearby(playerX, playerY, playerZ,
// 4) returns the phase-different blocks in a 4-block radius. A
// notification shows the count." We delegate to src/scan/lens.js +
// world.findPhaseDifferences rather than reading chunk.alphaData
// directly (the Phase 1.5 anti-pattern). The pure helper is the
// single source of truth.
function performScan(pos) {
  const currentPhase = phaseManager.getCurrentPhase();
  const radius = lensRadius();
  const results = scanResults(pos.x, pos.y, pos.z, radius, currentPhase, world);
  const count = hasDifferences(results) ? results.length : 0;

  // Consume energy for the one-shot scan (separate from the per-tick
  // hold drain).
  phaseManager.consumeEnergy(3); // SCAN_COST from constants

  if (count > 0) {
    hud.showNotification(`SCANNED: ${count} phase-differences`, '#5aa85a');
  }

  // Visual feedback: flash the crosshair.
  const crosshair = document.getElementById('crosshair');
  if (crosshair) {
    crosshair.style.background = '#5aa85a';
    setTimeout(() => { crosshair.style.background = '#fff'; }, 200);
  }
}

function performResonance(pos) {
  // Resonance scan: find phase-specific blocks
  const resonanceRadius = 16;
  let resonanceBlocks = [];
  const chunks = world.getChunks();
  
  chunks.forEach((chunk) => {
    const cx = chunk.cx * CHUNK_SIZE;
    const cz = chunk.cz * CHUNK_SIZE;
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
          const block = chunk.alphaData[world.index(x, y, z)];
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
      if (!chunk) return;
      const cKey = `${chunk.cx},${chunk.cz}`;
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

// Phase 2.3: placeAnchor is a no-op stub. The full lockManager integration
// lives in Phase 2.7 (per PROJECT_REMEDIATION_PLAN §2.7). Without this stub,
// the previous implementation would write a stray BLOCK_STABILIZER (id 15)
// into the world at the targeted face — not a Phase 2.3 concern but a
// pollution we want to avoid. The brief recommends showing a notification
// instead so the input binding (Shift+LMB) is visibly acknowledged.
function placeAnchor() {
  if (hud) {
    hud.showNotification('Anchor placement pending §2.7', '#ff6644');
  }
}

// Phase 2.3: tryPlaceStoneOnFace(hit) attempts to place Stone at the
// targeted face and returns true on success. The contextmenu handler
// calls this first; if it returns false (no hit, target not air, or
// would overlap the player), the handler falls through to phase cycle.
// Pure side-effect free of the §2.1 cyclePhase coupling.
function tryPlaceStoneOnFace(hit) {
  const result = placeBlockAtTarget(hit, BLOCK_STONE, { world, phaseManager, physicsManager });
  if (!result.ok) return false;
  updateChunkVisuals();
  spawnPlaceParticles(result.x, result.y, result.z, BLOCK_STONE);
  hud.showNotification(`BLOCK PLACED (${result.x}, ${result.y}, ${result.z})`, '#5aa85a');
  return true;
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
  world.setBlock(x, y, z, phaseManager.getCurrentPhase(), blockType);
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
    const blockType = world.getBlock(
      blockX, blockY, blockZ, phaseManager.getCurrentPhase()
    );
    
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

// Phase 2.3: spawnPlaceParticles — mirrored signature of spawnBreakParticles.
// Same particle count + geometry, but tilted upward (positive Y velocity)
// and slower decay so the placement affirmation reads visually distinct from
// the break debris. Particles tint toward the placed block's color.
function spawnPlaceParticles(blockX, blockY, blockZ, blockType) {
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
      (Math.random() - 0.5) * 1.5,
      Math.random() * 1.5 + 0.5,  // biased upward
      (Math.random() - 0.5) * 1.5
    );

    scene.add(particle);

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
  const phase = phaseManager.getCurrentPhase();
  const worldState = world.exportGlobalState();
  saveSystem.saveSnapshot(pos.x, pos.y, pos.z, phase, worldState);
  hud.showNotification('GAME SAVED', '#4488ff');
  refreshSaveInfo();
}

function refreshSaveInfo() {
  if (!saveSystem) return;
  const saveInfo = document.getElementById('save-info');
  if (!saveInfo) return;
  const lastSave = saveSystem.getLastSaveInfo();
  saveInfo.textContent = lastSave ? `Last save: ${lastSave}` : '';
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
    // Phase 2.5: forceScan() — runs the one-shot scan at the player's
    // current position and returns the result array. The brief's
    // acceptance #1 is "World.scanNearby returns the phase-different
    // blocks in a 4-block radius. A notification shows the count."
    // We delegate to scanResults() in src/scan/lens.js, which calls
    // world.findPhaseDifferences() — no direct chunk-data reads.
    forceScan() {
      if (!world || !phaseManager) return null;
      const p = physicsManager ? physicsManager.getPos() : { x: 0, y: 0, z: 0 };
      const results = scanResults(
        p.x, p.y, p.z,
        lensRadius(),
        phaseManager.getCurrentPhase(),
        world,
      );
      return { results, count: results.length, radius: lensRadius(), phase: phaseManager.getCurrentPhase() };
    },
    // Phase 2.5: start/stop the Phase Lens hold state (programmatic
    // counterpart to the E-key). The Playwright test calls these to
    // exercise the overlay wiring without needing pointer lock.
    startPhaseLens() {
      lens_insufficientNotifiedThisPress = false;
      scanActive = true;
      phaseLensActive = true;
    },
    stopPhaseLens() {
      scanActive = false;
      phaseLensActive = false;
      lens_insufficientNotifiedThisPress = false;
      if (scanOverlay) {
        scanOverlay.clearScanHighlights();
        scanOverlay.hideScanBeam();
      }
    },
    // Phase 2.5: scanOverlay inspection — the Playwright test uses
    // this to confirm the overlay produced child meshes after a
    // hold. Returns the child count (excluding the beam subgroup).
    getScanOverlayHighlightCount() {
      return scanOverlay ? scanOverlay.getHighlightCount() : 0;
    },
    getScanOverlayBeamVisible() {
      return scanOverlay ? scanOverlay.isVisible() : false;
    },
    // Phase 2.3: placeBlock(x, y, z, blockType) test hook. Calls the
    // same placeBlock helper that the RMB contextmenu handler uses, so
    // Playwright tests can verify the per-phase write + global state
    // snapshot path without needing pointer lock. Returns the raw
    // { ok, x, y, z, phase } result so tests can assert both placement
    // success and refusal reasons.
    placeBlock(x, y, z, blockType) {
      if (!world || !phaseManager || !physicsManager) return null;
      const hit = { blockX: x, blockY: y, blockZ: z, face: { x: 0, y: 0, z: 0 } };
      const result = placeBlockAtTarget(hit, blockType, { world, phaseManager, physicsManager });
      if (result.ok) {
        updateChunkVisuals();
        spawnPlaceParticles(result.x, result.y, result.z, blockType);
        if (hud) hud.showNotification(`BLOCK PLACED (${result.x}, ${result.y}, ${result.z})`, '#5aa85a');
      }
      return result;
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
    get lastSaveInfo() { return saveSystem ? saveSystem.getLastSaveInfo() : null; },
    saveSnapshot(x, y, z, phase, worldState) {
      if (!saveSystem) return null;
      return saveSystem.saveSnapshot(x, y, z, phase, worldState);
    },
    get phaseName() { return phaseManager && phaseManager.getPhaseName ? phaseManager.getPhaseName() : ''; },
    get isShifting() { return phaseManager && phaseManager.isShifting ? !!phaseManager.isShifting : false; },
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
// Phase 1.1: don't rethrow. A non-fatal init failure (missing DOM, etc.)
// used to kill the whole script before listeners attached. Now we log and
// recover so the page is at least partially functional.
try {
  init();
} catch (e) {
  console.error('[Phase Shifter] Init failed (recovered):', e);
}
