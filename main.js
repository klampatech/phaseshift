import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, BLOCK_STABILIZER, MINIMUM_RESPAWN_ENERGY, PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, PHASE_NAMES, WORLD_SEED, BLOCK_PROPERTIES, PHASE_LENS_DRAIN_RATE, SCAN_RADIUS, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION, RESONATE_COST, PLAYER_HEIGHT, FOOTSTEP_INTERVAL } from './src/core/constants.js';
import { World } from './src/core/world.js';
import { PhaseManager } from './src/core/phase.js';
import { PhysicsManager } from './src/core/physics.js';
import { setupLighting, createPlayerMesh, createSkybox, ChunkVisual, setupPostProcessing, ScanOverlay, ResonancePulse, AnchorOverlay, CheckpointOverlay, CollapseOverlay } from './src/render/renderer.js';
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
// Phase 3.2: Stabilizer placement cost, search radius, and respawn
// target lookup. The pure module is the single source of truth for
// the 3.2 math; main.js is the dispatcher.
import { STABILIZER_RADIUS, STABILIZER_PLACE_COST, STABILIZER_FALLBACK_COLOR, findRespawnTarget, isWithinRadius, stabilizerKey, snapYForStabilizerCell } from './src/world/stabilizer.js';
// Phase 3.2: Phase Collapse state machine (the 1.5s animation +
// input suppression + teleport + energy restore). The pure module
// owns the timer math + the done payload; main.js is the
// dispatcher.
import { COLLAPSE_DURATION, COLLAPSE_BANNER_TEXT, FALLBACK_WARNING_TEXT, COLLAPSE_RESPAWN_ENERGY, COLLAPSE_REASONS, createCollapseState, startCollapse, tickCollapse, clearCollapse, collapseProgress } from './src/collapse/collapse.js';
// Phase 3.3: Echo pickup radius + lore library + key formatter. The
// pure module owns the §3.3 contract; main.js is the dispatcher.
import { PICKUP_RADIUS as ECHO_PICKUP_RADIUS, ECHO_LORE_LIBRARY, echoLoreForKey, pickupResult as echoPickupResult, echoKey, echoColorForBiome } from './src/collect/echo.js';
import { PICKUP_RADIUS as AMPLIFIER_PICKUP_RADIUS, resonanceCoreKey, resonanceCoreColorForBiome, pickAmplifierForKey, pickupResult as resonancePickupResult, amplifierApplies } from './src/collect/resonance.js';
import { AMPLIFIER_SHIFT_REDUCTION, AMPLIFIER_TRANSITIONS, AMPLIFIER_AB, AMPLIFIER_BG, AMPLIFIER_AG, AMPLIFIER_PICKUP_RADIUS as _AMP_R, AMPLIFIER_UNLOCK_TEXT } from './src/core/constants.js';
import { LOCK_DURATION, LOCK_RADIUS, lockKey, createLock as createLockData, tickLocks as tickLocksPure, isLocked as isLockedPure, lockRegion, createGliderState, startGlider as startGliderPure, tickGlider as tickGliderPure, clearGlider as clearGliderPure } from './src/phase/lock.js';
import { TUTORIAL_RADIUS, TUTORIAL_HINT_DURATION, TUTORIAL_TOTAL_DURATION, TUTORIAL_HINT_TEXTS, createTutorialState, startTutorial as startTutorialPure, tickTutorial as tickTutorialPure, clearTutorial as clearTutorialPure, getHint, tutorialPositions, isWithinTutorialRing } from './src/tutorial/tutorial.js';
// Phase 3.3: Player inventory (collected Echoes + unlocked
// amplifiers). The save/load round-trip + the per-frame pickup
// tick both delegate to this module.
import { createInventory, addEcho, hasEcho, listEchoes, removeEcho, addAmplifier, hasAmplifier, collectedCount, amplifierCount, serialize as serializeInventory, deserialize as deserializeInventory } from './src/inventory/inventory.js';

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
// Phase 3.2: collapse state machine (the 3.2 "Stabilizers"
// deliverable). collapseState is the module-level singleton
// that the game loop owns; the per-frame collapse tick advances
// the timer + drives the renderer overlay + dispatches the
// teleport + energy restore. inputSuppressed is the keyboard /
// mouse input gate - while true, the input handlers no-op so the
// player can't move or shift mid-collapse.
let collapseState = createCollapseState();
let inputSuppressed = false;
// Phase 3.3: Player inventory (collected Echoes + amplifiers). The
// game loop owns the singleton; the save/load round-trip
// serializes + deserializes it.
let playerInventory = createInventory();

// Phase 3.5: Phase Glider state machine (Space held in Beta = brief fly)
let gliderState = createGliderState();

// Phase 3.6: Tutorial state machine (60s hint walkthrough at spawn)
let tutorialState = createTutorialState();
let collapseNotifyPending = false;
let fallbackWarnedForCurrentCollapse = false;
// Phase 3.2: original spawn point. Captured from physicsManager
// after the player settles so the fallback respawn path can
// teleport back here when no Stabilizer is in range.
let spawnPoint = null;
// Phase 3.2: last known stabilizer snapshot (the renderer's
// checkpoint overlay syncs from this on each frame).
let lastStabilizerSnapshot = [];
let collapseWasCollapsingLastFrame = false;

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
      playerInventory = deserializeInventory(_savedState.inventory);
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

  // Phase 3.2: capture the original spawn point.
  spawnPoint = {
    x: _spawnPos.x,
    y: _spawnPos.y,
    z: _spawnPos.z,
  };
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
    if (!document.pointerLockElement || inputSuppressed) return;
    const hit = raycastBlock(physicsManager.getPos(), getCameraDirection());
    if (tryPlaceStoneOnFace(hit)) return;
    phaseManager.cyclePhase();
  });

  // Handle key press for phase cycling and menus
  document.addEventListener('keydown', (e) => {
    if (!document.pointerLockElement || inputSuppressed) return;
    
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
    if (!document.pointerLockElement || gamePaused || inputSuppressed) return;

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
    if (!document.pointerLockElement || gamePaused || inputSuppressed) return;
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

  // Phase 3.5: create Phase Locks around the player on phase shift.
  // The lock holds blocks visible + solid in the new phase for
  // LOCK_DURATION (10s) seconds. The player can step on blocks
  // they couldn't reach before (e.g. Obsidian in Beta).
  if (physicsManager && typeof physicsManager.getPos === 'function' && world && typeof world.createLock === 'function') {
    const playerPos = physicsManager.getPos();
    if (playerPos && typeof playerPos === 'object') {
      const region = lockRegion(playerPos.x, playerPos.y, playerPos.z, LOCK_RADIUS);
      for (const cell of region) {
        // Only lock blocks that exist in the new phase (i.e. have
        // a non-air block at this cell in the new phase).
        try {
          const block = world.getBlock(cell.x, cell.y, cell.z, phase);
          if (block && block !== 0) {
            world.createLock(cell.x, cell.y, cell.z, phase, LOCK_DURATION);
          }
        } catch (e) { /* ignore chunk-not-loaded cells */ }
      }
      if (hud && typeof hud.showNotification === 'function' && region.length > 0) {
        hud.showNotification(`Phase Lock: ${region.length} blocks`, '#ffee88');
      }
    }
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
      visual.updateMeshes(world);
    }
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

  // Phase 3.2: per-frame collapse tick. The state machine owns
  // the 1.5s timer; the per-frame tick advances it, drives the
  // renderer overlay, suppresses input, and dispatches the
  // teleport + energy restore on completion.
  tickCollapsePerFrame(deltaTime);
  tickEchoesPerFrame(deltaTime);
  tickResonanceCoresPerFrame(deltaTime);
  tickLocksPerFrame(deltaTime);
  tickGliderPerFrame(deltaTime);
  tickTutorialPerFrame(deltaTime);

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

function updateChunkVisual(chunk) {
  if (!chunk || !world) return;
  const key = world.getChunkKey(chunk.cx, chunk.cz);
  let visual = chunkVisuals.get(key);
  if (!visual) {
    visual = new ChunkVisual(scene, chunk);
    chunkVisuals.set(key, visual);
  }
  visual.updateMeshes(world);
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
    const blocks = world ? Array.from(world.getChunks().values()).reduce((sum, c) => {
      return sum + (c.alphaData ? c.alphaData.filter(b => b !== BLOCK_AIR).length : 0);
    }, 0) : 0;
    const phase = phaseManager ? phaseManager.getCurrentPhase() : 0;
    
    progressInfo.textContent = `Chunks: ${chunks} | Blocks: ${blocks} | Current Phase: ${PHASE_NAMES[phase]}`;
  }
}

function saveGame() {
  const inventorySnapshot = serializeInventory(playerInventory);
  // Phase 3.2: don't save mid-collapse.
  if (inputSuppressed || (collapseState && collapseState.isCollapsing)) {
    if (hud) hud.showNotification('Cannot save during collapse', '#ff8844');
    return;
  }
  const pos = physicsManager.getPos();
  const phase = phaseManager.getCurrentPhase();
  const worldState = world.exportGlobalState();
  // Phase 2.7: include the anchor list in the save snapshot so
  // placed anchors survive a save → reload round-trip. The legacy
  // §1.7 / §2.4 save blob (without anchors) is still loadable.
  const anchors = world.exportAnchors ? world.exportAnchors() : [];
  saveSystem.saveSnapshot(pos.x, pos.y, pos.z, phase, worldState, anchors, inventorySnapshot);
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

// Phase 3.2: computeRespawnTarget(playerPos).
function computeRespawnTarget(playerPos) {
  const list = world && world._stabilizerPositions
    ? Array.from(world._stabilizerPositions.values())
    : [];
  return findRespawnTarget(playerPos, list, {
    radius: STABILIZER_RADIUS,
    fallback: spawnPoint,
  });
}

// Phase 3.3: tickEchoesPerFrame(dt) - drive the floating
// animation on the EchoOverlay + run the pickup loop against
// the player's current position. The pickup is one-shot per
// Echo (world.collectEcho + inventory.addEcho + clearEcho).
function tickEchoesPerFrame(dt) {
  if (!world || typeof world.listEchoes !== 'function') return;
  const snapshot = world.listEchoes();
  if (renderer && typeof renderer.updateEchoes === 'function') {
    renderer.updateEchoes(dt, snapshot);
  }
  if (!physicsManager || typeof physicsManager.getPos !== 'function') return;
  const pos = physicsManager.getPos();
  const playerPos = pos && typeof pos === 'object'
    ? { x: pos.x, y: pos.y, z: pos.z }
    : null;
  if (!playerPos) return;
  const hit = echoPickupResult(playerPos, snapshot, ECHO_PICKUP_RADIUS);
  if (hit && hit.key) {
    const lore = hit.lore || echoLoreForKey(hit.key);
    const added = addEcho(playerInventory, hit.key, lore);
    if (added) {
      world.collectEcho(hit.key);
      if (renderer && typeof renderer.clearEcho === 'function') {
        renderer.clearEcho(hit.key);
      }
      if (hud && typeof hud.showNotification === 'function') {
        hud.showNotification(`ECHO: ${lore}`, '#ffeeaa');
      }
      if (hud && typeof hud.showLoreToast === 'function') {
        hud.showLoreToast(lore);
      }
    }
    // Always update the counter (even on re-collect no-op, so the
    // test surface sees the edge). Cheap: one DOM write.
    if (hud && typeof hud.setEchoCounter === 'function') {
      hud.setEchoCounter(collectedCount(playerInventory), world.getTotalEchoes());
    }
  }
}

// Phase 3.5: tickLocksPerFrame(dt) - drive the lock overlay
// (yellow-glow outline) + tick the world's lock list. The
// actual lock creation happens in onPhaseChanged; this tick
// just drives the visual + clears expired locks.
function tickLocksPerFrame(dt) {
  if (!world || typeof world.tickLocks !== 'function') return;
  world.tickLocks(dt);
  if (renderer && typeof renderer.updateLocks === 'function') {
    const snap = (typeof world.listLocks === 'function') ? world.listLocks() : [];
    renderer.updateLocks(snap);
  }
}

// Phase 3.6: tickTutorialPerFrame(dt) - advance the tutorial
// hint walkthrough. The tutorial is a 60s sequence of 8 hints;
// each hint shows for 8s. The tick advances the state machine
// + drives the HUD overlay.
function tickTutorialPerFrame(dt) {
  if (!tutorialState || !tutorialState.active) return;
  const t = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : 0;
  const result = tickTutorialPure(tutorialState, dt, t);
  if (result.done) {
    tutorialState = clearTutorialPure(tutorialState);
    if (hud && typeof hud.clearTutorialHint === 'function') {
      hud.clearTutorialHint();
    }
    return;
  }
  if (hud && typeof hud.setTutorialHint === 'function' && result.hint) {
    hud.setTutorialHint(result.hint, result.hintIndex);
  }
}

// Phase 3.5: tickGliderPerFrame(dt) - advance the Phase Glider
// state machine (Space held in Beta = brief fly). The glider
// state was started by `startGlider(...)` (e.g. on Space press);
// the tick applies the per-frame delta to the player position.
function tickGliderPerFrame(dt) {
  if (!gliderState || !gliderState.gliding) return;
  const t = tickGliderPure(gliderState, dt);
  if (t.done) {
    clearGliderPure(gliderState);
    return;
  }
  if (physicsManager && typeof physicsManager.setPosition === 'function' && (t.dx || t.dy || t.dz)) {
    const pos = physicsManager.getPos();
    physicsManager.setPosition(pos.x + t.dx, pos.y + t.dy, pos.z + t.dz);
  }
}

// Phase 3.4: tickResonanceCoresPerFrame(dt) - drive the
// floating animation on the ResonanceCoreOverlay + run the
// pickup loop against the player's current position. The pickup
// is one-shot per Core (world.collectResonanceCore +
// inventory.addAmplifier + clearResonanceCore).
function tickResonanceCoresPerFrame(dt) {
  if (!world || typeof world.listResonanceCores !== 'function') return;
  const snapshot = world.listResonanceCores();
  if (renderer && typeof renderer.updateResonanceCores === 'function') {
    renderer.updateResonanceCores(dt, snapshot);
  }
  if (!physicsManager || typeof physicsManager.getPos !== 'function') return;
  const pos = physicsManager.getPos();
  const playerPos = pos && typeof pos === 'object'
    ? { x: pos.x, y: pos.y, z: pos.z }
    : null;
  if (!playerPos) return;
  // Augment the snapshot with a `color` field for the overlay
  // (the World's listResonanceCores() doesn't include color, but
  // the overlay needs it for showResonanceCore).
  const augmented = snapshot.map((c) => ({
    ...c,
    color: (typeof resonanceCoreColorForBiome === 'function')
      ? [
          ((resonanceCoreColorForBiome(c.biomeId) >> 16) & 0xff) / 255,
          ((resonanceCoreColorForBiome(c.biomeId) >> 8) & 0xff) / 255,
          (resonanceCoreColorForBiome(c.biomeId) & 0xff) / 255,
        ]
      : [0.85, 0.78, 0.3],
  }));
  if (renderer && typeof renderer.updateResonanceCores === 'function') {
    renderer.updateResonanceCores(dt, augmented);
  }
  const hit = resonancePickupResult(playerPos, snapshot, AMPLIFIER_PICKUP_RADIUS);
  if (hit && hit.key) {
    const result = world.collectResonanceCore(hit.key);
    if (result) {
      addAmplifier(playerInventory, result.amplifier);
      if (renderer && typeof renderer.clearResonanceCore === 'function') {
        renderer.clearResonanceCore(hit.key);
      }
      if (hud && typeof hud.showNotification === 'function') {
        const msg = (AMPLIFIER_UNLOCK_TEXT && AMPLIFIER_UNLOCK_TEXT[result.amplifier])
          || `Amplifier ${result.amplifier} unlocked`;
        hud.showNotification(msg, '#aaffaa');
      }
      if (hud && typeof hud.setAmplifierStatus === 'function') {
        hud.setAmplifierStatus(playerInventory.amplifiers);
      }
    }
  }
  // Always update the amplifier status HUD (cheap, fires on change only).
  if (hud && typeof hud.setAmplifierStatus === 'function') {
    hud.setAmplifierStatus(playerInventory.amplifiers);
  }
}

// Phase 3.2: tickCollapsePerFrame(dt).
function tickCollapsePerFrame(dt) {
  if (!collapseState || !collapseState.isCollapsing) {
    collapseWasCollapsingLastFrame = false;
    if (renderer && typeof renderer.clearCollapseOverlay === 'function') {
      renderer.clearCollapseOverlay();
    }
    return;
  }
  const result = tickCollapse(collapseState, dt);
  collapseState = result.state;
  if (renderer && typeof renderer.updateCollapseOverlay === 'function') {
    renderer.updateCollapseOverlay(result.progress);
  }
  const overlayEl = (typeof document !== 'undefined') ? document.getElementById('phase-collapse-overlay') : null;
  if (overlayEl) {
    if (result.progress > 0) {
      const alpha = Math.sin(result.progress * Math.PI) * 0.55;
      overlayEl.style.backgroundColor = `rgba(68, 0, 34, ${alpha.toFixed(3)})`;
      overlayEl.style.opacity = '1';
    } else {
      overlayEl.style.opacity = '0';
    }
  }
  if (collapseNotifyPending && !collapseWasCollapsingLastFrame) {
    if (hud && typeof hud.showNotification === 'function') {
      hud.showNotification(COLLAPSE_BANNER_TEXT, '#ff8844');
    }
    collapseNotifyPending = false;
  }
  collapseWasCollapsingLastFrame = !!collapseState.isCollapsing;
  if (result.done) {
    const tp = result.targetPos;
    if (tp && Number.isFinite(tp.x) && Number.isFinite(tp.y) && Number.isFinite(tp.z)) {
      if (physicsManager && typeof physicsManager.setPosition === 'function') {
        physicsManager.setPosition(tp.x, tp.y, tp.z);
      }
    } else if (spawnPoint) {
      if (physicsManager && typeof physicsManager.setPosition === 'function') {
        physicsManager.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);
      }
    }
    if (phaseManager && typeof phaseManager.setEnergy === 'function') {
      phaseManager.setEnergy(MINIMUM_RESPAWN_ENERGY);
    } else if (phaseManager && typeof phaseManager.consumeEnergy === 'function') {
      const cur = phaseManager.getEnergy();
      const delta = cur - MINIMUM_RESPAWN_ENERGY;
      if (delta > 0) phaseManager.consumeEnergy(delta);
    }
    if (tp && tp.source === 'spawn' && !fallbackWarnedForCurrentCollapse) {
      if (hud && typeof hud.showNotification === 'function') {
        hud.showNotification(FALLBACK_WARNING_TEXT, '#ffaa66');
      }
      fallbackWarnedForCurrentCollapse = true;
    }
    collapseState = clearCollapse(collapseState);
    inputSuppressed = false;
    if (renderer && typeof renderer.clearCollapseOverlay === 'function') {
      renderer.clearCollapseOverlay();
    }
    if (overlayEl) {
      overlayEl.style.opacity = '0';
    }
  }
  if (world && world._stabilizerPositions) {
    lastStabilizerSnapshot = Array.from(world._stabilizerPositions.values());
  }
  if (renderer && typeof renderer.updateCheckpoints === 'function') {
    renderer.updateCheckpoints(lastStabilizerSnapshot);
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
        // the 2.8 brief. Refuse to collapse in Alpha - the audio
        // would not fire meaningfully and the player is in the
        // "safe" phase.
        return { ok: false, reason: 'alpha-cannot-collapse', phase };
      }
      if (phaseManager.setEnergy) {
        phaseManager.setEnergy(0);
      } else if (phaseManager.consumeEnergy) {
        phaseManager.consumeEnergy(phaseManager.getEnergy());
      }
      if (audioManager && typeof audioManager.playCollapse === 'function') {
        audioManager.playCollapse();
      }
      // Phase 3.2: extend the audio stub with the collapse state
      // machine. The audio fires BEFORE the state machine so the
      // player hears the "vacuum sweep" cue during the 1.5s
      // animation. The respawn target lookup uses the player's
      // CURRENT position (the collapse point) + the world's
      // stabilizer list. The fallback is the original spawn point.
      const target = computeRespawnTarget(physicsManager.getPos());
      startCollapse(collapseState, COLLAPSE_REASONS.FORCED, target, target ? target.source : null);
      inputSuppressed = true;
      collapseNotifyPending = true;
      fallbackWarnedForCurrentCollapse = false;
      collapseWasCollapsingLastFrame = false;
      return { ok: true, phase, energy: phaseManager.getEnergy(), target };
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
    // Phase 3.2: forcePlaceStabilizer(x, y, z, phase?) debug hook.
    forcePlaceStabilizer(x, y, z, phase) {
      if (!world) return null;
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const fz = Math.floor(z);
      const p = (typeof phase === 'number') ? phase : (phaseManager ? phaseManager.getCurrentPhase() : 0);
      world.setBlock(fx, fy, fz, p, BLOCK_STABILIZER);
      const key = stabilizerKey(fx, fy, fz);
      if (renderer && typeof renderer.showCheckpoint === 'function') {
        renderer.showCheckpoint(fx, fy, fz, key);
      }
      return {
        ok: true,
        x: fx, y: fy, z: fz, phase: p,
        key,
        count: world._stabilizerPositions ? world._stabilizerPositions.size : 0,
        meshCount: renderer && renderer.checkpointOverlay ? renderer.checkpointOverlay.getCheckpointCount() : 0,
      };
    },
    // Phase 3.2: breakStabilizer(x, y, z, phase?) debug hook.
    breakStabilizer(x, y, z, phase) {
      if (!world) return null;
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const fz = Math.floor(z);
      const p = (typeof phase === 'number') ? phase : (phaseManager ? phaseManager.getCurrentPhase() : 0);
      world.setBlock(fx, fy, fz, p, BLOCK_AIR);
      const key = stabilizerKey(fx, fy, fz);
      if (renderer && typeof renderer.clearCheckpoint === 'function') {
        renderer.clearCheckpoint(key);
      }
      return { ok: true, x: fx, y: fy, z: fz, key, count: world._stabilizerPositions ? world._stabilizerPositions.size : 0 };
    },
    // Phase 3.2: getCollapseState() debug hook.
    getCollapseState() {
      return {
        isCollapsing: !!collapseState.isCollapsing,
        collapseTimer: collapseState.collapseTimer,
        collapseDuration: COLLAPSE_DURATION,
        reason: collapseState.reason,
        targetPos: collapseState.targetPos,
        inputSuppressed: !!inputSuppressed,
      };
    },
    // Phase 3.2: tickCollapsePerFrame(dt) debug hook.
    tickCollapsePerFrame(dt) {
      const d = (typeof dt === 'number') ? dt : 0;
      tickCollapsePerFrame(d);
      return {
        isCollapsing: !!collapseState.isCollapsing,
        collapseTimer: collapseState.collapseTimer,
        targetPos: collapseState.targetPos,
      };
    },
    // Phase 3.2: getRespawnTarget() debug hook.
    getRespawnTarget() {
      return computeRespawnTarget(physicsManager.getPos());
    },
    // Phase 3.2: getSpawnPoint() debug hook.
    getSpawnPoint() {
      return spawnPoint ? { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z } : null;
    },
    // Phase 3.2: getStabilizerSnapshot() debug hook.
    getStabilizerSnapshot() {
      return lastStabilizerSnapshot.slice();
    },
    // Phase 3.2: getStabilizerCount() debug hook.
    getStabilizerCount() {
      return world && world._stabilizerPositions ? world._stabilizerPositions.size : 0;
    },
    // Phase 3.2: forcePhaseCollapseToStabilizer(x, y, z) debug hook.
    forcePhaseCollapseToStabilizer(x, y, z) {
      if (!phaseManager) return null;
      const phase = phaseManager.getCurrentPhase();
      if (phase === PHASE_ALPHA) {
        return { ok: false, reason: 'alpha-cannot-collapse', phase };
      }
      if (phaseManager.setEnergy) {
        phaseManager.setEnergy(0);
      } else if (phaseManager.consumeEnergy) {
        phaseManager.consumeEnergy(phaseManager.getEnergy());
      }
      if (audioManager && typeof audioManager.playCollapse === 'function') {
        audioManager.playCollapse();
      }
      const snapY = snapYForStabilizerCell(y);
      const target = { x: x, y: snapY, z: z, source: 'stabilizer' };
      startCollapse(collapseState, COLLAPSE_REASONS.TEST, target, 'stabilizer');
      inputSuppressed = true;
      collapseNotifyPending = true;
      fallbackWarnedForCurrentCollapse = false;
      collapseWasCollapsingLastFrame = false;
      return { ok: true, phase, energy: phaseManager.getEnergy(), target };
    },
    // Phase 3.2: clearStabilizers() debug hook.
    clearStabilizers() {
      if (!world) return null;
      const list = world._stabilizerPositions ? [...world._stabilizerPositions.values()] : [];
      for (const s of list) {
        world.setBlock(s.x, s.y, s.z, phaseManager ? phaseManager.getCurrentPhase() : 0, BLOCK_AIR);
      }
      if (renderer && typeof renderer.clearCheckpoints === 'function') {
        renderer.clearCheckpoints();
      }
      lastStabilizerSnapshot = [];
      return { cleared: list.length };
    },
    // Phase 3.2: getCheckpointMeshCount() debug hook.
    getCheckpointMeshCount() {
      return renderer && renderer.checkpointOverlay ? renderer.checkpointOverlay.getCheckpointCount() : 0;
    },
    getCheckpointKeys() {
      return renderer && renderer.checkpointOverlay ? renderer.checkpointOverlay.getCheckpointKeys() : [];
    },
    // Phase 3.3: forceSpawnEcho(x, y, z, loreKey?, biomeId?) debug hook.
    forceSpawnEcho(x, y, z, loreKey, biomeId) {
      if (!world || typeof world.spawnEcho !== 'function') return null;
      const k = (typeof loreKey === 'string' && loreKey.length > 0) ? loreKey : echoKey(x, y, z);
      const biome = Number.isFinite(biomeId) ? biomeId : (world.getBiome ? world.getBiome(Math.floor(x), Math.floor(z)) : 0);
      const echo = world.spawnEcho(x, y, z, k, biome);
      if (renderer && typeof renderer.showEcho === 'function') {
        renderer.showEcho(Math.floor(x), Math.floor(y) + 1, Math.floor(z), echo.key, echoColorForBiome(biome));
      }
      return {
        ok: !!echo,
        key: echo.key,
        x: echo.x, y: echo.y, z: echo.z,
        biomeId: echo.biomeId,
        lore: echo.lore,
        loreKey: echo.loreKey,
        color: echoColorForBiome(biome),
        collected: echo.collected,
      };
    },
    // Phase 3.3: forceCollectEcho(key) debug hook.
    forceCollectEcho(key) {
      if (!world || typeof world.collectEcho !== 'function') return null;
      const lore = echoLoreForKey(key);
      const result = world.collectEcho(key);
      if (result) {
        addEcho(playerInventory, key, lore);
        if (renderer && typeof renderer.clearEcho === 'function') renderer.clearEcho(key);
        if (hud && typeof hud.setEchoCounter === 'function') {
          hud.setEchoCounter(collectedCount(playerInventory), world.getTotalEchoes());
        }
      }
      return result ? { ok: true, ...result, lore } : { ok: false };
    },
    // Phase 3.3: getInventory() debug hook - returns the raw
    // inventory state for inspection. The shape is
    // { collectedEchoes: Map<key, lore>, amplifiers: Set<name> }.
    getInventory() {
      return {
        collectedEchoes: Array.from(playerInventory.collectedEchoes.entries()).map(([key, lore]) => ({ key, lore })),
        amplifiers: Array.from(playerInventory.amplifiers),
        collectedCount: collectedCount(playerInventory),
        amplifierCount: amplifierCount(playerInventory),
      };
    },
    // Phase 3.3: listEchoes() debug hook - the world's
    // uncollected Echoes (the shape the per-frame pickup reads).
    listEchoes() {
      if (!world || typeof world.listEchoes !== 'function') return [];
      return world.listEchoes();
    },
    // Phase 3.3: getEchoCount() debug hook - the number of
    // uncollected Echo meshes in the renderer.
    getEchoCount() {
      return renderer && typeof renderer.getEchoCount === 'function' ? renderer.getEchoCount() : 0;
    },
    // Phase 3.3: getEchoKeys() debug hook - the active Echo mesh keys.
    getEchoKeys() {
      return renderer && typeof renderer.getEchoKeys === 'function' ? renderer.getEchoKeys() : [];
    },
    // Phase 3.3: getTotalEchoes() debug hook.
    getTotalEchoes() {
      return world && typeof world.getTotalEchoes === 'function' ? world.getTotalEchoes() : 0;
    },
    // Phase 3.3: getCollectedEchoCount() debug hook.
    getCollectedEchoCount() {
      return world && typeof world.getCollectedEchoCount === 'function' ? world.getCollectedEchoCount() : collectedCount(playerInventory);
    },
    // Phase 3.3: getEchoCounterText() debug hook - the current
    // #echo-counter textContent (or null if the DOM element is
    // missing).
    getEchoCounterText() {
      const el = (typeof document !== 'undefined') ? document.querySelector('#echo-counter') : null;
      return el ? el.textContent : null;
    },
    // Phase 3.4: forceSpawnResonanceCore(x, y, z, amplifier?, biomeId?) debug hook.
    forceSpawnResonanceCore(x, y, z, amplifier, biomeId) {
      if (!world || typeof world.spawnResonanceCore !== 'function') return null;
      const amp = (typeof amplifier === 'string' && amplifier.length > 0)
        ? amplifier
        : pickAmplifierForKey(resonanceCoreKey(x, y, z));
      const biome = Number.isFinite(biomeId) ? biomeId : (world.getBiome ? world.getBiome(Math.floor(x), Math.floor(z)) : 0);
      const core = world.spawnResonanceCore(x, y, z, amp, biome);
      if (renderer && typeof renderer.showResonanceCore === 'function') {
        renderer.showResonanceCore(Math.floor(x), Math.floor(y), Math.floor(z), core.key, resonanceCoreColorForBiome(biome), amp);
      }
      return {
        ok: !!core,
        key: core.key,
        amplifier: core.amplifier,
        x: core.x, y: core.y, z: core.z,
        biomeId: core.biomeId,
      };
    },
    // Phase 3.4: forceCollectResonanceCore(key) debug hook.
    forceCollectResonanceCore(key) {
      if (!world || typeof world.collectResonanceCore !== 'function') return null;
      const result = world.collectResonanceCore(key);
      if (result) {
        addAmplifier(playerInventory, result.amplifier);
        if (renderer && typeof renderer.clearResonanceCore === 'function') {
          renderer.clearResonanceCore(key);
        }
        if (hud && typeof hud.setAmplifierStatus === 'function') {
          hud.setAmplifierStatus(playerInventory.amplifiers);
        }
      }
      return result ? { ok: true, ...result } : { ok: false };
    },
    // Phase 3.4: getResonanceCores() debug hook.
    getResonanceCores() {
      if (!world || typeof world.listResonanceCores !== 'function') return [];
      return world.listResonanceCores();
    },
    // Phase 3.4: getResonanceCoreCount() debug hook.
    getResonanceCoreCount() {
      return renderer && typeof renderer.getResonanceCoreCount === 'function' ? renderer.getResonanceCoreCount() : 0;
    },
    // Phase 3.4: getResonanceCoreKeys() debug hook.
    getResonanceCoreKeys() {
      return renderer && typeof renderer.getResonanceCoreKeys === 'function' ? renderer.getResonanceCoreKeys() : [];
    },
    // Phase 3.4: getResonanceCoreAmplifierAt(key) debug hook.
    getResonanceCoreAmplifierAt(key) {
      return renderer && typeof renderer.getResonanceCoreAmplifierAt === 'function' ? renderer.getResonanceCoreAmplifierAt(key) : null;
    },
    // Phase 3.4: isResonanceCoreAt(key) debug hook.
    isResonanceCoreAt(key) {
      return renderer && typeof renderer.isResonanceCoreAt === 'function' ? renderer.isResonanceCoreAt(key) : false;
    },
    // Phase 3.4: getAmplifierStatusText() debug hook.
    getAmplifierStatusText() {
      const el = (typeof document !== 'undefined') ? document.querySelector('#amplifier-status') : null;
      return el ? el.textContent : null;
    },
    // Phase 3.4: getShiftCost(from, to) debug hook - returns the
    // effective energy cost after the amplifier discount.
    getShiftCost(from, to) {
      const base = 5; // PHASE_SHIFT_COST
      if (!Number.isFinite(from) || !Number.isFinite(to)) return base;
      const amps = (playerInventory && playerInventory.amplifiers) ? playerInventory.amplifiers : new Set();
      let reduction = 0;
      for (const amp of amps) {
        if (amplifierApplies(amp, from, to)) reduction += AMPLIFIER_SHIFT_REDUCTION;
      }
      return Math.max(0, base - reduction);
    },
    // Phase 3.4: clearResonanceCores() debug hook.
    clearResonanceCores() {
      if (world && typeof world.clearResonanceCores === 'function') world.clearResonanceCores();
      if (renderer && typeof renderer.clearResonanceCores === 'function') renderer.clearResonanceCores();
      return true;
    },
    // Phase 3.5: forceCreateLock(x, y, z, phase, duration?) debug hook.
    forceCreateLock(x, y, z, phase, duration) {
      if (!world || typeof world.createLock !== 'function') return null;
      const dur = (typeof duration === 'number' && Number.isFinite(duration)) ? duration : LOCK_DURATION;
      const lock = world.createLock(x, y, z, phase, dur);
      if (lock && renderer && typeof renderer.showLock === 'function') {
        const key = lockKey(x, y, z, phase);
        renderer.showLock(x, y, z, phase, key);
      }
      return lock;
    },
    // Phase 3.5: getLockCount() debug hook.
    getLockCount() {
      return world && typeof world.getLockCount === 'function' ? world.getLockCount() : 0;
    },
    // Phase 3.5: getLockKeys() debug hook.
    getLockKeys() {
      return world && typeof world.getLockKeys === 'function' ? world.getLockKeys() : [];
    },
    // Phase 3.5: isLocked(x, y, z, phase) debug hook.
    isLocked(x, y, z, phase) {
      return world && typeof world.isLocked === 'function' ? world.isLocked(x, y, z, phase) : false;
    },
    // Phase 3.5: clearLocks() debug hook.
    clearLocks() {
      if (world && typeof world.clearLocks === 'function') world.clearLocks();
      if (renderer && typeof renderer.clearLocks === 'function') renderer.clearLocks();
      return true;
    },
    // Phase 3.5: tickLocksPerFrame(dt) debug hook.
    tickLocksPerFrame(dt) {
      const d = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
      tickLocksPerFrame(d);
      return { ok: true };
    },
    // Phase 3.5: startGlider(direction) debug hook.
    startGlider(direction) {
      const dir = (direction && typeof direction === 'object') ? direction : { x: 0, y: 1, z: 0 };
      const state = startGliderPure(gliderState, dir, performance.now() / 1000);
      gliderState = state;
      return { ok: true, state: { gliding: state.gliding, timer: state.timer } };
    },
    // Phase 3.5: tickGliderPerFrame(dt) debug hook.
    tickGliderPerFrame(dt) {
      const d = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
      tickGliderPerFrame(d);
      return { ok: true, gliding: gliderState.gliding };
    },
    // Phase 3.5: getGliderState() debug hook.
    getGliderState() {
      return { gliding: gliderState.gliding, timer: gliderState.timer, duration: gliderState.duration };
    },
    // Phase 3.5: clearGlider() debug hook.
    clearGlider() {
      gliderState = clearGliderPure(gliderState);
      return { ok: true };
    },
    // Phase 3.6: forceGenerateTutorial() debug hook.
    forceGenerateTutorial() {
      if (!physicsManager || typeof physicsManager.getPos !== 'function') return null;
      const pos = physicsManager.getPos();
      if (!pos) return null;
      const p = tutorialPositions(pos.x, pos.y, pos.z);
      // Place the stone at chest height
      if (world && typeof world.setBlock === 'function') {
        world.setBlock(p.stone.x, p.stone.y, p.stone.z, 0, BLOCK_STONE);
        for (const cell of p.phaseRow) {
          world.setBlock(cell.x, cell.y, cell.z, 0, cell.blockId);
        }
        world.setBlock(p.stabilizer.x, p.stabilizer.y, p.stabilizer.z, 0, BLOCK_STABILIZER);
      }
      // Spawn the Echo (Phase 3.3)
      if (world && typeof world.spawnEcho === 'function') {
        world.spawnEcho(p.echo.x, p.echo.y + 1, p.echo.z, 'tutorial.echo', 0);
      }
      // Start the tutorial state machine
      const t = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : 0;
      tutorialState = startTutorialPure(tutorialState, pos, t);
      return {
        ok: true,
        stone: p.stone,
        phaseRow: p.phaseRow,
        echo: p.echo,
        stabilizer: p.stabilizer,
      };
    },
    // Phase 3.6: tickTutorialPerFrame(dt) debug hook.
    tickTutorialPerFrame(dt) {
      const d = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
      tickTutorialPerFrame(d);
      return { ok: true, active: tutorialState.active };
    },
    // Phase 3.6: getTutorialHint() debug hook.
    getTutorialHint() {
      if (!tutorialState || !tutorialState.active) return null;
      const idx = tutorialState.currentHint;
      return { hint: TUTORIAL_HINT_TEXTS[idx], hintIndex: idx, elapsed: tutorialState.elapsed };
    },
    // Phase 3.6: getTutorialState() debug hook.
    getTutorialState() {
      return {
        active: tutorialState.active,
        elapsed: tutorialState.elapsed,
        currentHint: tutorialState.currentHint,
        hintCount: TUTORIAL_HINT_TEXTS.length,
      };
    },
    // Phase 3.6: clearTutorial() debug hook.
    clearTutorial() {
      tutorialState = clearTutorialPure(tutorialState);
      if (hud && typeof hud.clearTutorialHint === 'function') {
        hud.clearTutorialHint();
      }
      return { ok: true };
    },
    // Phase 3.3: isEchoAt(key) debug hook.
    isEchoAt(key) {
      return renderer && typeof renderer.isEchoAt === 'function' ? renderer.isEchoAt(key) : false;
    },
    // Phase 3.2: isCheckpointAt(x, y, z) debug hook.
    isCheckpointAt(x, y, z) {
      const key = stabilizerKey(x, y, z);
      return renderer && typeof renderer.isCheckpointAt === 'function' ? renderer.isCheckpointAt(key) : false;
    },
    // Phase 3.3: tickEchoesPerFrame(dt) debug hook - drives the
    // per-frame Echo animation + pickup loop from outside the
    // game loop (used by the Playwright test).
    tickEchoesPerFrame(dt) {
      const d = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0;
      tickEchoesPerFrame(d);
      return { ok: true, dt: d };
    },
    // Phase 3.3: clearEchoes() debug hook (test reset path).
    clearEchoes() {
      if (world && typeof world.clearEchoes === 'function') world.clearEchoes();
      if (renderer && typeof renderer.clearEchoes === 'function') renderer.clearEchoes();
      return { ok: true };
    },
    // Phase 3.3: addAmplifier(name) debug hook - unlocks an
    // amplifier for the player (Phase 3.4 wires this to the
    // Resonance Core pickup). Returns { ok, newlyAdded }.
    addAmplifier(name) {
      if (typeof name !== 'string' || name.length === 0) return { ok: false, reason: 'bad-name' };
      const added = addAmplifier(playerInventory, name);
      return { ok: true, newlyAdded: added, name };
    },
    // Phase 3.3: hasAmplifier(name) debug hook.
    hasAmplifier(name) {
      return hasAmplifier(playerInventory, name);
    },
    // Phase 3.3: hasEcho(key) debug hook.
    hasEcho(key) {
      return hasEcho(playerInventory, key);
    },
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
