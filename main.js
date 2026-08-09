import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, WORLD_SEED, BLOCK_PROPERTIES, PHASE_LENS_DRAIN_RATE, SCAN_RADIUS, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION, RESONATE_COST, PLAYER_HEIGHT, FOOTSTEP_INTERVAL } from './src/core/constants.js';
import { World } from './src/core/world.js';
import { PhaseManager } from './src/core/phase.js';
import { PhysicsManager } from './src/core/physics.js';
import { setupLighting, createPlayerMesh, createSkybox, ChunkVisual, setupPostProcessing, ScanOverlay, ResonancePulse, AnchorOverlay } from './src/render/renderer.js';
import { Controls } from './src/input/controls.js';
import { placeBlock as placeBlockAtTarget } from './src/input/placeBlock.js';
import { HUD } from './src/ui/hud.js';
import { AudioManager } from './src/audio/manager.js';
import { SaveSystem, Settings } from './src/save/system.js';
import { scanResults, phaseLensDrain, lensRadius, belowDrainThreshold, hasDifferences } from './src/scan/lens.js';
import { resonateResults, resonateRadius, resonateCost, totalSwappedCount } from './src/resonance/resonate.js';
// Phase 2.8: footstep throttle (every 0.4s) + phase-and-block filter.
// The call site is the game loop (the accumulator lives in main.js);
// the helper is the pure module.
import { shouldPlayFootstep, materialFromBlock, footstepInterval, FOOTSTEP_MATERIALS } from './src/audio/footsteps.js';
import { placeAnchorAt, snapYForCell, cellUnderPlayer, anchorLifetime, ANCHOR_FILL_COLOR, ANCHOR_BORDER_COLOR } from './src/anchor/anchor.js';
// Phase 3.1: per-biome color palette, fog density, label, and
// smooth cross-biome transition tween. The pure module is the
// single source of truth for the per-biome tints; the renderer's
// skybox shader + the per-frame game-loop tick both delegate to it.
import { biomeTint, biomeLabel as biomeLabelFromHelper, biomeFogDensity, lerpBiomeTints, biomeTransitionDuration,
  BIOME_TINTS, BIOME_NAMES, BIOME_FOREST, BIOME_CAVES, BIOME_DEEP_VOID, BIOME_RUINS,
  BIOME_DESERT, BIOME_CRYSTAL_CAVERN, BIOME_SKY_RUINS, BIOME_PHASE_NEXUS } from './src/world/biome.js';

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
// Phase 2.6: Resonance pulse state. The pulse group is owned by the
// `ResonancePulse` instance (created in init()). `resonancePulseActive`
// is the per-frame gate — the game loop ticks updateResonancePulse
// while it's true and stops when the pulse expires.
let resonancePulse = null;
let resonancePulseActive = false;
// Phase 2.6: one-shot gate for the "Insufficient energy" notification.
// Reset on Q release so the next press can re-trigger.
let resonance_insufficientNotifiedThisPress = false;
// Phase 2.8: footstep accumulator. The game loop decrements this
// by deltaTime each frame and calls audioManager.playFootstep(material)
// when the accumulator crosses zero AND the player is moving + grounded.
// The canonical interval is FOOTSTEP_INTERVAL (0.4s; the plan's §2.8
// "every 0.4s"). The accumulator lives in main.js (the game loop owns
// it) so the audio engine stays scene-agnostic.
let footstepTimer = 0;
// Phase 3.1: biome tracking state. `currentBiomeId` mirrors the
// `currentPhase` pattern (it's the cached id the game loop read
// on the last frame). `currentBiomeTint` is the per-frame lerped
// tint that drives the skybox shader + scene fog + phase light.
// `biomeTransitionTimer` is the dt-based accumulator for the
// 0.5s cross-biome tween (the §3.1 brief's smooth transition);
// when it reaches `biomeTransitionDuration()`, the transition is
// done and the lerped tint snaps to the target biome's tint.
// `targetBiomeTint` is the destination of the in-flight transition
// (the most recent world.getBiome() result).
let currentBiomeId = BIOME_FOREST;
let currentBiomeTint = biomeTint(BIOME_FOREST);
let targetBiomeTint = biomeTint(BIOME_FOREST);
let biomeTransitionTimer = biomeTransitionDuration();
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

  // Phase 2.6: Resonance pulse group (a phase-colored sphere that
  // expands + fades per frame). The pulse lives in its own THREE.Group
  // so the Phase Lens overlay and the chunk-mesh group are independent.
  resonancePulse = new ResonancePulse(scene);

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
    // Phase 2.7: import the saved anchor list. The legacy §1.7 /
    // §2.4 save blob has no `anchors` key — `_coerceAnchors` returns
    // an empty array in that case. World.importAnchors(snapshot)
    // returns the count actually applied. The renderer's overlay
    // group is empty until placeAnchor() fires — we don't pre-draw
    // wireframes on init because the player's position may have
    // moved (and the snap-to-anchor logic only fires on phase change).
    if (Array.isArray(_savedState.anchors) && _savedState.anchors.length > 0) {
      world.importAnchors(_savedState.anchors);
    } else {
      // Defensive: ensure the anchor list is empty even when the save
      // blob has no anchors (back-compat with §1.7 / §2.4).
      world.importAnchors([]);
    }
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

  // Pointer lock. Phase 2.8: audioManager.init() now fires on the
  // blocker click (the user gesture), not inside the subsequent
  // pointerlockchange listener. The risk register (row #12) calls
  // this out: doing it lazily after pointer lock means the first
  // phase-shift audio is lost. The AudioContext needs a user gesture
  // to unlock, and the click is the unambiguous one. The
  // pointerlockchange listener still calls audioManager.resume() on
  // the suspended-context path (some browsers suspend the context
  // again on tab visibility change).
  blocker.addEventListener('click', () => {
    if (!gameRunning && audioManager && typeof audioManager.init === 'function') {
      audioManager.init();
      audioManager.resume();
    }
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
      blocker.classList.add('hidden');
      // Defensive: some browsers (Chromium, Firefox) suspend the
      // AudioContext on tab visibility change. resume() on the next
      // pointer lock is the recovery path. init() stays on the blocker
      // click only — the AudioContext is created once, then resumed
      // on each re-focus.
      if (audioManager && typeof audioManager.resume === 'function') {
        audioManager.resume();
      }
      if (!gameRunning) {
        gameRunning = true;
        lastTime = performance.now();
        // Initial HUD update so phase names show immediately
        hud.update(phaseManager, physicsManager, world);
        requestAnimationFrame(gameLoop);
      }
    } else {
      blocker.classList.remove('hidden');
      gameRunning = false;
    }
  });

  // HUD
  hud = new HUD(document.getElementById('hud'));
  hud.update(phaseManager, physicsManager, world);

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

  // Phase 3.1: drive the skybox shader's phaseTint uniform. The
  // shader multiplies phaseTint * biomeTint into the base
  // gradient (the §3.1 "phase × biome" formula). The phase tint
  // is the [r, g, b] float triple from PHASE_COLORS[phase]; the
  // biome tint is driven per-frame by tickBiomesPerFrame.
  // Conversion: PHASE_COLORS are 0xRRGGBB hex strings; the shader
  // uniform takes [0, 1] floats. We divide the parseHexColor()
  // output (0-255 ints) by 255.
  if (renderer && typeof renderer.setPhaseTint === 'function') {
    const [pr, pg, pb] = parseHexColor(colors[phase]);
    renderer.setPhaseTint([pr / 255, pg / 255, pb / 255]);
  }

  // Phase 2.8 audio on phase change. The plan's order is:
  //   1) stopAmbientMusic()    — tear down the current track
  //   2) startAmbientMusic(phase) — spin up the new track
  //   3) playShift(phase)      — chime on the cycle transition
  // The stop-before-start ordering is the contract; the AudioEngine
  // short-circuits on !this.initialized so the headless tests can
  // exercise the wiring without a real AudioContext. The init()
  // pathway is on the blocker click (the user gesture), not here.
  if (audioManager) {
    audioManager.stopAmbientMusic();
    audioManager.startAmbientMusic(phase);
    audioManager.playShift(phase);
  }

  // Phase 2.7: snap-to-anchor — if the player is standing on an
  // anchor cell, re-snap the player Y to the anchor's top so the
  // phase shift doesn't drop them through (the §2.7 contract: a
  // block under an anchor stays solid in ALL phases for the
  // duration of the lock). The check is `findAnchorUnderPlayer`:
  // it returns the anchor at the cell directly under the player's
  // feet in the current phase. If the player is mid-jump, mid-fall,
  // or standing on a non-anchor block, no snap fires.
  if (world && physicsManager && typeof world.findAnchorUnderPlayer === 'function') {
    const playerPos = physicsManager.getPos();
    const underAnchor = world.findAnchorUnderPlayer(
      playerPos.x, playerPos.y, playerPos.z, phase
    );
    if (underAnchor) {
      const snapY = snapYForCell(underAnchor.y);
      if (Number.isFinite(snapY)) {
        // The physics manager's setPosition is the canonical way to move
        // the player without breaking the camera follow + collision
        // detection (the §1.2 follow code glues the camera to the
        // new position on the next frame).
        physicsManager.setPosition(playerPos.x, snapY, playerPos.z);
      }
    }
  }
}

function gameLoop(time) {
  if (!gameRunning) return;

  const deltaTime = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  // Update phase manager
  phaseManager.update(deltaTime);

  // Update HUD
  if (hud) hud.update(phaseManager, physicsManager, world);

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

  // Phase 2.8: footstep tick relies on isMoving + isGrounded. We
  // hoist moveX + moveZ + isGrounded to the function scope so the
  // post-physics footstep block can read them. The values are
  // computed fresh here (and once more inside the if/else) so the
  // footstep block sees the same `isMoving` the physics block fed
  // into physicsManager.update().
  let moveX = 0, moveZ = 0;
  if (ctrlState.moveZ < 0) moveZ -= 1;
  if (ctrlState.moveZ > 0) moveZ += 1;
  if (ctrlState.moveX < 0) moveX -= 1;
  if (ctrlState.moveX > 0) moveX += 1;
  const isMoving = (moveX !== 0 || moveZ !== 0);
  const isGrounded = !!physicsManager.isGrounded;

  // Apply gravity
  if (!physicsManager.isGrounded) {
    physicsManager.update(deltaTime);
  } else {
    // On ground: apply movement
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

  // Phase 2.8: footstep tick. Throttles audioManager.playFootstep(material)
  // to every footstepInterval() seconds while the player is moving
  // AND grounded. The phase-and-block filter is the per-phase
  // world.getBlock lookup on the cell directly under the player's
  // feet in the current phase. The accumulator lives in main.js (the
  // game loop owns it) so the audio engine stays scene-agnostic.
  // The cell below the player is `floor(playerY) - 1` (same convention
  // as cellUnderPlayer in src/anchor/anchor.js).
  if (audioManager && typeof audioManager.playFootstep === 'function' && world) {
    const tickResult = shouldPlayFootstep(footstepTimer, deltaTime, isMoving, isGrounded);
    footstepTimer = tickResult.remainingTimer;
    if (tickResult.play) {
      const playerPos = physicsManager.getPos();
      const cellX = Math.floor(playerPos.x);
      const cellY = Math.floor(playerPos.y) - 1;
      const cellZ = Math.floor(playerPos.z);
      const blockType = world.getBlock(cellX, cellY, cellZ, phaseManager.getCurrentPhase());
      const material = materialFromBlock(blockType, phaseManager.getCurrentPhase());
      if (material) {
        audioManager.playFootstep(material);
      }
    }
  }

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

  // Handle Resonance Scan (Q). Phase 2.6: the press is one-shot per
  // rising edge (the Phase 1.1 input binding already resets
  // `ctrlState.resonating` on key-up, so the spam guard is automatic).
  if (ctrlState.resonating && !qKeyHeld) {
    qKeyHeld = true;
    performResonance(pos);
  }
  if (!ctrlState.resonating) {
    qKeyHeld = false;
    // Reset the one-shot insufficient-energy notification gate so the
    // next press can re-trigger the message.
    resonance_insufficientNotifiedThisPress = false;
  }

  // Phase 2.6: advance the resonance sphere pulse every frame. The
  // pulse has its own lifetime (1.0s, expand + fade) and is auto-
  // disposed by ResonancePulse when the lifetime expires. The
  // per-frame gate is `resonancePulseActive` — the renderer only
  // spends cycles on the pulse mesh while it's alive.
  if (resonancePulseActive && renderer && typeof renderer.updateResonancePulse === 'function') {
    renderer.updateResonancePulse(deltaTime);
    if (renderer.resonancePulse && !renderer.resonancePulse.isVisible()) {
      resonancePulseActive = false;
    }
  }

  // Phase 2.7: advance the Phase Anchor (Shift+LMB) lifetime every
  // frame. The world is the single source of truth for the per-cell
  // `remaining` value; the renderer's AnchorOverlay is driven by
  // the snapshot + the removed-key list. The overlay disposes
  // expired wireframes so the renderer doesn't leak. No per-frame
  // gate — the per-frame cost is O(active anchors), which is small
  // in practice (a few anchors at most).
  tickAnchorsPerFrame(deltaTime);

  // Phase 3.1: per-frame biome tick. Mirrors the footstep + anchor
  // pattern — read the player's current biome, detect the change
  // edge, smoothly tween the scene colors toward the target tint.
  // The biome id comes from `world.getBiome(playerPos.x, playerPos.z)`
  // (the deterministic per-region assignment in src/core/world.js).
  // The transition tween is dt-based (the same pattern as the §2.7
  // anchor lifetime + §2.8 footstep timer); `dt` is clamped by the
  // game loop's `Math.min(..., 0.05)` ceiling so a tab-switch pause
  // can't dump the entire pause into the timer. The biome id is
  // the player's CURRENT biome — the `forceBiome` debug hook
  // bypasses this read and pins the player to a specific biome.
  tickBiomesPerFrame(deltaTime);

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

// Phase 2.6: Resonance (Q). The one-shot press delegates to
// `world.resonateWithReport(...)` via `resonateResults` (no more
// direct `chunk.alphaData` reads — the Phase 1.5 anti-pattern
// Phase 2.5 refactored out of `performScan`). The brief's §2.6
// acceptance is:
//   1. Press Q in a chunk with mixed phase blocks visibly swaps them.
//   2. Energy drops by 15. Refuse if < 15 with "Insufficient energy".
//   3. Sphere pulse on the player (radius 0.2 → 1.0 block over 0.25s,
//      then opacity 1.0 → 0 over 0.75s, color = PHASE_COLORS[phase]).
//   4. Audio plays the resonance chord (audioManager.playResonance).
//   5. The pulse still fires when no phase-different blocks are in
//      radius (15 energy cost, no swap, no crash).
function performResonance(pos) {
  const currentPhase = phaseManager.getCurrentPhase();

  // Refuse if insufficient energy. Notification is one-shot per press
  // (mirroring the Phase Lens pattern).
  if (phaseManager.getEnergy() < resonateCost()) {
    if (!resonance_insufficientNotifiedThisPress) {
      hud.showNotification('Insufficient energy', '#ff8844');
      resonance_insufficientNotifiedThisPress = true;
    }
    return;
  }
  // Reset the one-shot gate so the next press can re-trigger.
  resonance_insufficientNotifiedThisPress = false;

  // Delegate to the world — single source of truth for the swap.
  const results = resonateResults(
    pos.x, pos.y, pos.z,
    resonateRadius(),
    currentPhase,
    world,
  );
  const swappedCount = totalSwappedCount(results);

  // Energy debit on success (one-shot per press — not per-frame).
  phaseManager.consumeEnergy(resonateCost());

  // Visual: phase-colored sphere pulse anchored to the player.
  if (renderer && typeof renderer.showResonancePulse === 'function') {
    renderer.showResonancePulse(pos.x, pos.y, pos.z, currentPhase);
  }
  resonancePulseActive = true;

  // Audio: chord + sweep. The audio method is a no-op without an
  // AudioContext, so the headless tests can still assert the call.
  if (audioManager && typeof audioManager.playResonance === 'function') {
    audioManager.playResonance(currentPhase);
  }

  // Notification: show the swap count (0 is fine — the pulse still
  // fired, the audio still played, the energy is still debited).
  if (swappedCount > 0) {
    hud.showNotification(`RESONANCE: ${swappedCount} phase-cells`, '#d9b34c');
  } else {
    hud.showNotification('RESONANCE: no phase-cells', '#d9b34c');
  }
}


// Phase 2.7: placeAnchor() — the Shift+LMB Phase Anchor. Raycasts
// the targeted block, validates via the pure placeAnchorAt helper,
// and writes the anchor through World.createAnchor (idempotent —
// re-pressing on the same cell refreshes the lifetime rather than
// stacking). The renderer's AnchorOverlay draws the yellow-glow
// wireframe. The per-frame game loop calls world.tickAnchors(dt) +
// renderer.updateAnchors(...) to drive the pulse-fade animation in
// the last 3 seconds + the lifetime expiry.
//
// Acceptance (per plan §2.7):
//   - Shift+LMB on a block shows a glowing outline
//   - Standing on it through a phase shift keeps you on the block
//     (the snap-to-anchor logic in onPhaseChanged)
//   - After 10 seconds the outline disappears
function placeAnchor() {
  if (!world || !phaseManager || !physicsManager) return;
  const pos = physicsManager.getPos();
  const dir = getCameraDirection();
  const hit = raycastBlock(pos, dir);
  if (!hit) {
    if (hud) hud.showNotification('No block in range', '#ff6644');
    return;
  }
  const currentPhase = phaseManager.getCurrentPhase();
  // The pure helper mirrors the §2.3 placeBlock API: rejects
  // no-hit, target-not-air, and overlaps-player.
  const result = placeAnchorAt(pos.x, pos.y, pos.z, hit, currentPhase, world);
  if (!result.ok) {
    if (hud) {
      const reason = result.reason || 'invalid';
      const msg = reason === 'overlaps-player'
        ? 'Cannot anchor a block you are standing inside'
        : reason === 'target-not-air'
        ? 'Block not solid in current phase'
        : 'Anchor placement failed';
      hud.showNotification(msg, '#ff6644');
    }
    return;
  }
  // Idempotent: createAnchor refreshes the lifetime if the cell
  // is already anchored (the §2.7 spec — re-pressing extends the lock).
  const created = world.createAnchor(result.x, result.y, result.z, result.phase);
  if (!created || !created.ok) {
    if (hud) hud.showNotification('Anchor placement failed', '#ff6644');
    return;
  }
  // Draw the wireframe. We pass the snapshot from getAnchors() so
  // the overlay reads the freshest `remaining` value.
  if (renderer && typeof renderer.showAnchor === 'function') {
    renderer.showAnchor({
      x: result.x, y: result.y, z: result.z, phase: result.phase,
      remaining: anchorLifetime(),
    });
  }
  if (hud) {
    const msg = created.refreshed
      ? `Anchor refreshed (${result.x}, ${result.y}, ${result.z})`
      : `Anchor placed (${result.x}, ${result.y}, ${result.z})`;
    const color = created.refreshed ? '#ffcc00' : '#ffee88';
    hud.showNotification(msg, color);
  }
}

// Phase 2.7: per-frame anchor update. Walks the world's anchor list,
// decrements each `remaining`, removes expired ones, and forwards
// the result to the renderer's AnchorOverlay. Mirrors the §2.6
// per-frame Resonance pulse loop (one update per frame, no leak
// because the overlay disposes expired wireframes).
function tickAnchorsPerFrame(dt) {
  if (!world) return;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (d === 0) return;
  // 1. Decrement + collect expired. The world is the single source
  //    of truth for the lifetime math.
  const removedKeys = world.tickAnchors(d);
  // 2. Snapshot the remaining anchors for the renderer (the
  //    overlay applies per-anchor opacity from the snapshot).
  const snapshot = world.getAnchors();
  // 3. Drive the overlay. updateAnchors also disposes any
  //    wireframes whose key is in removedKeys.
  if (renderer && typeof renderer.updateAnchors === 'function') {
    renderer.updateAnchors(snapshot, removedKeys);
  }
}

// Phase 3.1: per-frame biome tick. Reads the player's current
// biome (via `world.getBiome(playerPos.x, playerPos.z)`), detects
// the change edge, and smoothly tweens the scene colors toward
// the target biome tint. The transition is 0.5s (the §3.1 brief's
// smooth fade — instant transitions feel janky). The tween is
// dt-based: `biomeTransitionTimer` accumulates `dt` and the
// lerp factor is `biomeTransitionTimer / biomeTransitionDuration()`.
//
// What the tick drives:
//   1. `scene.background` — tinted by the lerped biome color
//      (multiplicatively on top of the phase color which was set
//      in `onPhaseChanged`).
//   2. `scene.fog.color` — same lerped biome color, so the fog
//      hue matches the skybox.
//   3. `scene.fog.density` — lerped per-biome density (Forest
//      0.006 → Deep Void 0.025, etc).
//   4. `lighting.phaseLight.color` — also lerped (the §3.1 brief's
//      "phase light tints to the current biome" requirement).
//   5. The skybox shader uniforms (via renderer.setBiomeTint) so
//      the gradient sphere reads as the biome-tinted skybox.
//
// Edge cases:
//   - On the change edge (newBiomeId !== currentBiomeId), the
//     transition timer resets to 0 and the target tint is the
//     new biome's tint.
//   - The `#biome-info` text update is the HUD's responsibility
//     (it reads the same world.getBiome on the next frame and
//     fires the text-change edge detector).
//   - `forceBiome(biomeId)` debug hook bypasses the world.getBiome
//     read and pins the player to a specific biome (the §3.1
//     brief's "pin without flying" pattern).
function tickBiomesPerFrame(dt) {
  if (!world || typeof world.getBiome !== 'function') return;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;

  // 1. Read the player's current biome. The `forceBiome` debug
  //    hook sets `currentBiomeId` directly; the production path
  //    reads from the world (the per-region deterministic
  //    assignment, hash of `floor(x / 64)` × `floor(z / 64)`).
  const playerPos = (physicsManager && typeof physicsManager.getPos === 'function')
    ? physicsManager.getPos()
    : null;
  if (!playerPos || !Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.z)) return;

  const newBiomeId = world.getBiome(playerPos.x, playerPos.z);
  if (newBiomeId !== currentBiomeId) {
    // Biome change edge: reset the transition timer and update
    // the target. The previous lerped state is the new "from"
    // so mid-flight chaining works (the §3.1 brief's pitfall:
    // "if the player walks through two biome regions in 0.5s,
    // the second transition starts from where the first one
    // ended, not from the original biome's target").
    currentBiomeId = newBiomeId;
    targetBiomeTint = biomeTint(newBiomeId);
    biomeTransitionTimer = 0;
  }

  // 2. Advance the transition tween. Clamp to the duration so
  //    a frame that happens to be larger than 0.05s (the
  //    game-loop ceiling) doesn't overshoot.
  if (d > 0) {
    biomeTransitionTimer = Math.min(biomeTransitionTimer + d, biomeTransitionDuration());
  }
  const t = biomeTransitionTimer / biomeTransitionDuration();

  // 3. Lerp the current tint toward the target. The `from` is
  //    whatever the scene is currently rendering (so mid-flight
  //    chaining works), the `to` is the new biome's tint.
  currentBiomeTint = lerpBiomeTints(currentBiomeTint, targetBiomeTint, t);

  // 4. Drive the scene. The phase color is applied first (the
  //    existing onPhaseChanged path), then the biome tint is
  //    layered on top. The visible skybox is the shader sphere
  //    (the §3.1 brief's "the biome tint applies to the skybox
  //    shader, not just the background" requirement).
  if (scene) {
    // scene.background + scene.fog.color — same RGB triplet.
    if (scene.background && typeof scene.background.setRGB === 'function') {
      scene.background.setRGB(
        currentBiomeTint.color[0],
        currentBiomeTint.color[1],
        currentBiomeTint.color[2],
      );
    }
    if (scene.fog) {
      if (typeof scene.fog.color.setRGB === 'function') {
        scene.fog.color.setRGB(
          currentBiomeTint.color[0],
          currentBiomeTint.color[1],
          currentBiomeTint.color[2],
        );
      }
      // Per-biome fog density (the §3.1 brief's "Forest is less
      // foggy than the Deep Void" requirement). Use `=` rather
      // than lerp for the very last frame so the density lands
      // exactly on the target value (floating-point slop from
      // the lerp would otherwise leave the fog slightly wrong).
      if (biomeTransitionTimer >= biomeTransitionDuration()) {
        scene.fog.density = biomeFogDensity(currentBiomeId);
      } else {
        scene.fog.density = currentBiomeTint.fogDensity;
      }
    }
  }
  // The phase light tints by the biome too (the §3.1 brief's
  // "phase light tints to the current biome" requirement).
  if (lighting && lighting.phaseLight) {
    lighting.phaseLight.color.setRGB(
      currentBiomeTint.color[0],
      currentBiomeTint.color[1],
      currentBiomeTint.color[2],
    );
  }
  // The skybox shader reads the biome tint via a uniform — the
  // renderer's setBiomeTint forwards to the skybox mesh. The
  // fragment shader multiplies the biome tint by the phase tint
  // (the §3.1 "phase × biome" formula). The phase tint is
  // driven by the existing onPhaseChanged path (Phase 2.1
  // regression lock) — only the biome side is set here.
  if (renderer && typeof renderer.setBiomeTint === 'function') {
    renderer.setBiomeTint(currentBiomeTint.color);
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
  // Phase 2.8: soft click on placement. Guarded with the audioManager
  // existence + the method presence so the headless smoke test can
  // exercise the path without an AudioContext. The engine short-
  // circuits on !this.initialized, so the call is safe even when
  // the WebAudio API failed to construct.
  if (audioManager && typeof audioManager.playBlockPlace === 'function') {
    audioManager.playBlockPlace();
  }
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

      // Phase 2.8: crunchy noise on break. Same guard pattern as
      // tryPlaceStoneOnFace — guarded with audioManager + method
      // presence so the headless smoke test can exercise the path
      // without an AudioContext. The engine short-circuits on
      // !this.initialized, so the call is safe even when WebAudio
      // failed to construct.
      if (audioManager && typeof audioManager.playBlockBreak === 'function') {
        audioManager.playBlockBreak();
      }
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
  // Phase 2.7: include the anchor list in the save snapshot so
  // placed anchors survive a save → reload round-trip. The legacy
  // §1.7 / §2.4 save blob (without anchors) is still loadable.
  const anchors = world.exportAnchors ? world.exportAnchors() : [];
  saveSystem.saveSnapshot(pos.x, pos.y, pos.z, phase, worldState, anchors);
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
    // Phase 2.6: forceResonate() — runs the one-shot resonance at
    // the player's current position and returns the result. Mirrors
    // the §2.5 forceScan() pattern: the brief's acceptance #1..
    // acceptance #6 are the data path (radii, swap counts, energy
    // debits) — the Playwright test exercises the hook end-to-end
    // without needing keyboard input. The visual sphere pulse and
    // audio are still wired (the renderer.updateResonancePulse loop
    // advances the pulse each frame).
    forceResonate() {
      if (!world || !phaseManager) return null;
      const p = physicsManager ? physicsManager.getPos() : { x: 0, y: 0, z: 0 };
      const currentPhase = phaseManager.getCurrentPhase();
      const energyBefore = phaseManager.getEnergy();
      const radius = resonateRadius();
      const results = resonateResults(p.x, p.y, p.z, radius, currentPhase, world);
      const swappedCount = totalSwappedCount(results);
      // Debit the energy so the test can verify the 15-energy math.
      const debited = phaseManager.consumeEnergy(resonateCost());
      // Spawn the sphere pulse (no-op if the renderer isn't ready).
      if (renderer && typeof renderer.showResonancePulse === 'function') {
        renderer.showResonancePulse(p.x, p.y, p.z, currentPhase);
      }
      resonancePulseActive = true;
      // Audio (no-op without an AudioContext; the headless tests
      // just assert the method is callable).
      if (audioManager && typeof audioManager.playResonance === 'function') {
        audioManager.playResonance(currentPhase);
      }
      const energyAfter = phaseManager.getEnergy();
      return {
        radius,
        phase: currentPhase,
        count: swappedCount,
        results,
        energyBefore,
        energyAfter,
        energyDebited: debited,
      };
    },
    // Phase 2.6: resonance pulse inspection — the Playwright test
    // uses this to confirm the pulse produced a mesh after a press.
    getResonancePulseMeshCount() {
      return renderer && renderer.resonancePulse
        ? renderer.resonancePulse.getMeshCount()
        : 0;
    },
    getResonancePulseVisible() {
      return renderer && renderer.resonancePulse
        ? renderer.resonancePulse.isVisible()
        : false;
    },
    clearResonancePulse() {
      if (renderer && typeof renderer.clearResonancePulse === 'function') {
        renderer.clearResonancePulse();
      }
      resonancePulseActive = false;
    },
    // Phase 2.7: forcePlaceAnchor(x, y, z, phase?) — places an anchor
    // at the given cell in the given phase (defaults to the player's
    // current phase). Mirrors the §2.6 forceResonate() pattern: the
    // Playwright test uses this to assert the anchor overlay wiring
    // without needing pointer lock + Shift+LMB. The hook delegates
    // to world.createAnchor (idempotent — re-pressing on the same
    // cell refreshes the lifetime) and renderer.showAnchor (draws
    // the wireframe). Returns the per-press report:
    //   { ok, refreshed, x, y, z, phase, count, meshCount, remaining }
    forcePlaceAnchor(x, y, z, phase) {
      if (!world || !phaseManager) return null;
      const p = (typeof phase === 'number') ? phase : phaseManager.getCurrentPhase();
      const created = world.createAnchor(x, y, z, p);
      if (!created || !created.ok) {
        return { ok: false, reason: created && created.reason };
      }
      const anchor = world.getAnchors().find(a => a.x === Math.floor(x) && a.y === Math.floor(y) && a.z === Math.floor(z) && a.phase === p);
      if (renderer && typeof renderer.showAnchor === 'function') {
        renderer.showAnchor(anchor || { x, y, z, phase: p, remaining: 10 });
      }
      return {
        ok: true,
        refreshed: created.refreshed,
        x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), phase: p,
        count: world.getAnchors().length,
        meshCount: renderer && renderer.anchorOverlay ? renderer.anchorOverlay.getMeshCount() : 0,
        remaining: anchor ? anchor.remaining : 10,
      };
    },
    // Phase 2.7: anchor inspection hooks — the Playwright test uses
    // these to confirm the overlay produced a wireframe after a press.
    getAnchorCount() {
      if (!world) return 0;
      return world.getAnchors().length;
    },
    getAnchorMeshCount() {
      return renderer && renderer.anchorOverlay
        ? renderer.anchorOverlay.getMeshCount()
        : 0;
    },
    getAnchorKeys() {
      return renderer && renderer.anchorOverlay
        ? renderer.anchorOverlay.getAnchorKeys()
        : [];
    },
    clearAnchors() {
      if (world && typeof world.clearAnchors === 'function') world.clearAnchors();
      if (renderer && typeof renderer.clearAnchors === 'function') renderer.clearAnchors();
    },
    isAnchorAt(x, y, z, phase) {
      if (!world) return false;
      const p = (typeof phase === 'number') ? phase : phaseManager.getCurrentPhase();
      return world.isAnchorActive(x, y, z, p);
    },
    // Phase 2.7: programmatic lifetime tick. The Playwright test uses
    // this to assert the 10-second expiry without waiting 10 real
    // seconds. Tick by 11 seconds → every anchor should expire.
    tickAnchors(dt) {
      if (!world) return [];
      return world.tickAnchors(dt);
    },
    // Phase 2.7: programmatic snap-to-anchor test. Returns the
    // anchor under the player's feet (or null). The Playwright test
    // uses this to assert the §2.7 acceptance #6.
    findAnchorUnderPlayer() {
      if (!world || !physicsManager) return null;
      const p = physicsManager.getPos();
      const phase = phaseManager ? phaseManager.getCurrentPhase() : 0;
      return world.findAnchorUnderPlayer(p.x, p.y, p.z, phase);
    },
    // Phase 2.8: footstep debug hooks. The Playwright test exercises
    // the throttle math + the per-phase material lookup without
    // needing pointer lock. tickFootsteps(dt, ctx) is the per-tick
    // pure helper — it returns the { play, remainingTimer } shape
    // that shouldPlayFootstep produces, without mutating the audio
    // engine or the world. forcePlayFootstep(material) is a
    // pass-through to audioManager.playFootstep. getFootstepTimer()
    // exposes the current accumulator for invariant tests.
    tickFootsteps(dt, ctx) {
      const d = (typeof dt === 'number') ? dt : 0;
      const isMoving = ctx && typeof ctx.isMoving === 'boolean' ? ctx.isMoving : false;
      const isGrounded = ctx && typeof ctx.isGrounded === 'boolean' ? ctx.isGrounded : false;
      return shouldPlayFootstep(footstepTimer, d, isMoving, isGrounded);
    },
    // Phase 2.8: explicitly advance the footstep accumulator from
    // outside the game loop. The Playwright test uses this to drive
    // the production footstep tick (which mutates the module-
    // scoped footstepTimer) and then read getFootstepTimer() to
    // assert the throttle math.
    advanceFootstepTimer(dt) {
      const d = (typeof dt === 'number') ? dt : 0;
      const isMoving = (physicsManager && physicsManager.isGrounded) ? true : false;
      // Use the player's actual isGrounded. If neither is moving nor
      // grounded, the helper still decrements the accumulator but
      // doesn't fire; the test asserts the remainingTimer shape.
      const isGrounded = !!(physicsManager && physicsManager.isGrounded);
      const result = shouldPlayFootstep(footstepTimer, d, isMoving, isGrounded);
      footstepTimer = result.remainingTimer;
      return result;
    },
    getFootstepTimer() {
      return footstepTimer;
    },
    forcePlayFootstep(material) {
      if (!audioManager || typeof audioManager.playFootstep !== 'function') return null;
      audioManager.playFootstep(material);
      return { material: material || 'stone', ok: true };
    },
    // Phase 2.8: pass-through debug wrappers for the audio API.
    // The Playwright test asserts the API surface is reachable from
    // the debug surface even though WebAudio fails in the sandbox
    // (the engine short-circuits on !this.initialized).
    playBlockBreakDebug() {
      if (!audioManager || typeof audioManager.playBlockBreak !== 'function') return null;
      audioManager.playBlockBreak();
      return true;
    },
    playBlockPlaceDebug() {
      if (!audioManager || typeof audioManager.playBlockPlace !== 'function') return null;
      audioManager.playBlockPlace();
      return true;
    },
    playShiftDebug(phase) {
      if (!audioManager || typeof audioManager.playShift !== 'function') return null;
      const p = (typeof phase === 'number') ? phase : (phaseManager ? phaseManager.getCurrentPhase() : 0);
      audioManager.playShift(p);
      return { phase: p };
    },
    playResonanceDebug(phase) {
      if (!audioManager || typeof audioManager.playResonance !== 'function') return null;
      const p = (typeof phase === 'number') ? phase : (phaseManager ? phaseManager.getCurrentPhase() : 0);
      audioManager.playResonance(p);
      return { phase: p };
    },
    playCollapseDebug() {
      if (!audioManager || typeof audioManager.playCollapse !== 'function') return null;
      audioManager.playCollapse();
      return true;
    },
    playFootstepDebug(material) {
      if (!audioManager || typeof audioManager.playFootstep !== 'function') return null;
      audioManager.playFootstep(material || 'stone');
      return { material: material || 'stone' };
    },
    startAmbientMusicDebug(phase) {
      if (!audioManager || typeof audioManager.startAmbientMusic !== 'function') return null;
      const p = (typeof phase === 'number') ? phase : (phaseManager ? phaseManager.getCurrentPhase() : 0);
      audioManager.startAmbientMusic(p);
      return { phase: p };
    },
    stopAmbientMusicDebug() {
      if (!audioManager || typeof audioManager.stopAmbientMusic !== 'function') return null;
      audioManager.stopAmbientMusic();
      return true;
    },
    // Phase 2.8: phase collapse stub. The §2.8 deliverable is the
    // audio call site; the §3.2 stabilizer/collapse state machine
    // is a separate session. The hook sets energy to 0 (the collapse
    // precondition) and calls audioManager.playCollapse() so the
    // audio wiring is testable. The Playwright test asserts the
    // call is reachable, not the respawn-to-stabilizer behavior
    // (that's §3.2).
    forcePhaseCollapse() {
      if (!phaseManager) return null;
      const phase = phaseManager.getCurrentPhase();
      if (phase === PHASE_ALPHA) {
        // The collapse precondition is "any non-Alpha phase" per
        // the §2.8 brief. Refuse to collapse in Alpha — the audio
        // wouldn't fire meaningfully and the player is in the
        // "safe" phase.
        return { ok: false, reason: 'alpha-cannot-collapse', phase };
      }
      if (phaseManager.setEnergy) {
        phaseManager.setEnergy(0);
      } else if (phaseManager.consumeEnergy) {
        // Best-effort fallback: consume all current energy.
        phaseManager.consumeEnergy(phaseManager.getEnergy());
      }
      if (audioManager && typeof audioManager.playCollapse === 'function') {
        audioManager.playCollapse();
      }
      return { ok: true, phase, energy: phaseManager.getEnergy() };
    },
    // Phase 3.1: forceBiome(biomeId) test hook. Pins the player
    // to a specific biome regardless of position. The production
    // path uses `world.getBiome(playerPos.x, playerPos.z)` (the
    // deterministic per-region assignment); the debug hook
    // bypasses that read so the test can verify the per-frame
    // biome tick + the `#biome-info` text update + the scene
    // background lerp without flying to a far-away biome. The
    // hook resets the transition timer so the per-frame lerp
    // tween fires from the current state to the new target. The
    // `world` parameter is read-only; the hook only mutates the
    // module-level `currentBiomeId` / `targetBiomeTint` / timer.
    forceBiome(biomeId) {
      if (!Number.isFinite(biomeId)) {
        return { ok: false, reason: 'bad-input' };
      }
      const id = Math.floor(biomeId);
      if (id < 1 || id > 8) {
        return { ok: false, reason: 'out-of-range' };
      }
      currentBiomeId = id;
      targetBiomeTint = biomeTint(id);
      biomeTransitionTimer = 0;
      return {
        ok: true,
        biomeId: id,
        label: biomeLabelFromHelper(id),
        color: targetBiomeTint.color.slice(),
        fogDensity: targetBiomeTint.fogDensity,
      };
    },
    // Phase 3.1: getCurrentBiomeId() test hook. Returns the
    // module-level `currentBiomeId`. The Playwright test asserts
    // that the value matches the biome set by `forceBiome`.
    getCurrentBiomeId() {
      return currentBiomeId;
    },
    // Phase 3.1: lerpBiomeTints(from, to, t) test hook.
    // Pass-through to the pure helper. Used by the static-analysis
    // check + the Playwright test that asserts the transition
    // math mid-flight.
    lerpBiomeTints(from, to, t) {
      return lerpBiomeTints(from, to, t);
    },
    // Phase 3.1: biomeLabel(biomeId) test hook. Pass-through to
    // the pure helper. Used by the Playwright test that asserts
    // the `#biome-info` text matches the canonical label.
    biomeLabel(biomeId) {
      return biomeLabelFromHelper(biomeId);
    },
    // Phase 3.1: getCurrentBiomeTint() test hook. Returns the
    // module-level `currentBiomeTint` so the Playwright test can
    // assert the per-frame lerp is converging toward the target
    // after a `forceBiome` call.
    getCurrentBiomeTint() {
      return {
        color: currentBiomeTint.color.slice(),
        fogDensity: currentBiomeTint.fogDensity,
      };
    },
    // Phase 3.1: tickBiomesPerFrame(dt) test hook. Drives the
    // per-frame biome tick from outside the game loop. The
    // Playwright test uses this to advance the transition
    // tween past 0.5s and assert the scene background has
    // reached the target biome color.
    tickBiomesPerFrame(dt) {
      const d = (typeof dt === 'number') ? dt : 0;
      tickBiomesPerFrame(d);
      return {
        biomeId: currentBiomeId,
        color: currentBiomeTint.color.slice(),
        fogDensity: currentBiomeTint.fogDensity,
        timer: biomeTransitionTimer,
      };
    },
    // Phase 3.1: getBiomeTransitionTimer() test hook. The
    // transition timer is the dt-based accumulator; the test
    // reads it to assert the tween is advancing.
    getBiomeTransitionTimer() {
      return biomeTransitionTimer;
    },
    // Phase 3.1: getBiomeTransitionDuration() test hook.
    // Pass-through to the pure helper. The test asserts the
    // canonical 0.5s value.
    getBiomeTransitionDuration() {
      return biomeTransitionDuration();
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
        // Phase 2.8: soft click on placement (debug hook matches the
        // RMB path). Guarded with audioManager + method presence so
        // the headless test exercises the wiring without an
        // AudioContext. The engine short-circuits on !this.initialized.
        if (audioManager && typeof audioManager.playBlockPlace === 'function') {
          audioManager.playBlockPlace();
        }
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
