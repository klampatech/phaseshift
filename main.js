import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT, BLOCK_AIR, BLOCK_STONE, BLOCK_STABILIZER, MINIMUM_RESPAWN_ENERGY, FALLBACK_ENERGY_PENALTY, PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA, PHASE_COUNT, PHASE_NAMES, WORLD_SEED, BLOCK_PROPERTIES, PHASE_LENS_DRAIN_RATE, SCAN_RADIUS, RESONANCE_RADIUS, RESONANCE_PULSE_DURATION, RESONATE_COST, PLAYER_HEIGHT, FOOTSTEP_INTERVAL, PHASE_SHIFT_COST, EROSION_RADIUS, EROSION_THRESHOLD, ALPHA_GRACE_DURATION } from './src/core/constants.js';
import { World } from './src/core/world.js';
import { PhaseManager } from './src/core/phase.js';
import { PhysicsManager } from './src/core/physics.js';
import { setupLighting, createPlayerMesh, createSkybox, ChunkVisual, setupPostProcessing, ScanOverlay, ResonancePulse, AnchorOverlay, CheckpointOverlay, CollapseOverlay } from './src/render/renderer.js';
import { previewAmount, previewColor, shouldRunPreview, PREVIEW_SECONDS, PHASE_SHIFT_DURATION } from './src/render/phaseShiftPreview.js';
import { Controls } from './src/input/controls.js';
import { placeBlock as placeBlockAtTarget } from './src/input/placeBlock.js';
import { HUD } from './src/ui/hud.js';
import { AudioManager } from './src/audio/manager.js';
import { SaveSystem, Settings } from './src/save/system.js';
import { defaultSettings as defaultSettingsPure } from './src/settings/menu.js';
import { scanResults, phaseLensDrain, lensRadius, belowDrainThreshold, hasDifferences } from './src/scan/lens.js';
import { resonateResults, resonateRadius, resonateCost, totalSwappedCount } from './src/resonance/resonate.js';
import {
  createChargeState, startCharge, tickCharge, cancelCharge, commitCharge,
  isChargeActive, isCharging, isCommitting, isPendingCommit,
  clearPendingCommit, resonancePulseRadius, resonancePulseOpacity,
  RESONANCE_CHARGE_SECONDS, RESONANCE_COMMIT_SECONDS,
} from './src/resonance/charge.js';
// Phase 2.8: footstep throttle (every 0.4s) + phase-and-block filter.
// The call site is the game loop (the accumulator lives in main.js);
// the helper is the pure module.
import { shouldPlayFootstep, materialFromBlock, footstepInterval, FOOTSTEP_MATERIALS, footstepVolumeForDensity, countNeighbors } from './src/audio/footsteps.js';
import { placeAnchorAt, snapYForCell, cellUnderPlayer, anchorLifetime, ANCHOR_FILL_COLOR, ANCHOR_BORDER_COLOR } from './src/anchor/anchor.js';
import { FUSE_COST, FUSE_HOLD_SECONDS, startFuse, tickFuse, cancelFuse, createFuseState, fuseKey } from './src/fuse/fuse.js';
// Phase 3.1: per-biome color palette, fog density, label, and
// smooth cross-biome transition tween. The pure module is the
// single source of truth for the per-biome tints; the renderer's
// skybox shader + the per-frame game-loop tick both delegate to it.
import { energyTier as energyTierFn } from './src/ui/energy-tier.js';
import { biomeTint, biomeLabel as biomeLabelFromHelper, biomeFogDensity, lerpBiomeTints, biomeTransitionDuration, biomeMultipliers,
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
import { COLLAPSE_DURATION, COLLAPSE_BANNER_TEXT, FALLBACK_WARNING_TEXT, COLLAPSE_RESPAWN_ENERGY, COLLAPSE_REASONS, createCollapseState, startCollapse, tickCollapse, clearCollapse, collapseProgress, POST_COLLAPSE_INVULN_DURATION, createInvulnState, startInvuln, tickInvuln, isInvulnActive, getInvulnRemaining } from './src/collapse/collapse.js';
// Phase 3.3: Echo pickup radius + lore library + key formatter. The
// pure module owns the §3.3 contract; main.js is the dispatcher.
import { PICKUP_RADIUS as ECHO_PICKUP_RADIUS, ECHO_LORE_LIBRARY, echoLoreForKey, pickupResult as echoPickupResult, echoKey, echoColorForBiome } from './src/collect/echo.js';
import { PICKUP_RADIUS as AMPLIFIER_PICKUP_RADIUS, resonanceCoreKey, resonanceCoreColorForBiome, pickAmplifierForKey, pickupResult as resonancePickupResult, amplifierApplies } from './src/collect/resonance.js';
import { AMPLIFIER_SHIFT_REDUCTION, AMPLIFIER_TRANSITIONS, AMPLIFIER_AB, AMPLIFIER_BG, AMPLIFIER_AG, AMPLIFIER_PICKUP_RADIUS as _AMP_R, AMPLIFIER_UNLOCK_TEXT } from './src/core/constants.js';
import { LOCK_DURATION, LOCK_RADIUS, lockKey, createLock as createLockData, tickLocks as tickLocksPure, isLocked as isLockedPure, lockRegion, createGliderState, startGlider as startGliderPure, tickGlider as tickGliderPure, clearGlider as clearGliderPure, PHASE_GLIDER_SPEED } from './src/phase/lock.js';
import { TUTORIAL_RADIUS, TUTORIAL_HINT_DURATION, TUTORIAL_TOTAL_DURATION, TUTORIAL_HINT_TEXTS, createTutorialState, startTutorial as startTutorialPure, tickTutorial as tickTutorialPure, clearTutorial as clearTutorialPure, getHint, tutorialPositions, isWithinTutorialRing, clearTutorialAndHide as clearTutorialAndHidePure } from './src/tutorial/tutorial.js';
import { buildGoalState as buildGoalStatePure, currentAct as currentActPure, nearestMarker as nearestMarkerPure } from './src/progression/goals.js';
// Phase 3.3: Player inventory (collected Echoes + unlocked
// amplifiers). The save/load round-trip + the per-frame pickup
// tick both delegate to this module.
import { createInventory, addEcho, hasEcho, listEchoes, removeEcho, addAmplifier, hasAmplifier, collectedCount, amplifierCount, serialize as serializeInventory, deserialize as deserializeInventory, listEchoesByBiome } from './src/inventory/inventory.js';
import { createNewGamePlusState, pickPhaseDominance, DEFAULT_PHASE_DOMINANCE_SEED, DEFAULT_IRONMAN, isIronman, isShuffled } from './src/newgameplus/newgameplus.js';

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
let newGamePlusState = null; // Phase 10.14: phase-dominance seed + ironman flag

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
// Phase 10.2: Phase Fuse state (the Memory World pillar). The player
// holds F against a block for 3s; the cost is debited on commit.
let fuseState = createFuseState();
let eKeyHeld = false;
let qKeyHeld = false;
// Phase 2.6: Resonance pulse state. The pulse group is owned by the
// `ResonancePulse` instance (created in init()). `resonancePulseActive`
// is the per-frame gate — the game loop ticks updateResonancePulse
// while it's true and stops when the pulse expires.
let resonancePulse = null;
let resonancePulseActive = false;
// Phase 10.13: charge-up state machine. The Q key starts a 0.5s
// charge window (preview), then transitions to a 1.0s commit window
// (full pulse). Pressing Q again during the charge cancels (no
// energy debited, no swap); pressing Q again during the commit
// triggers a fresh charge cycle. The energy cost moves from 15 to
// 25 (debited on commit, not press).
let resonanceChargeState = createChargeState();
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
// Phase 8.2: post-collapse invuln window (5s).
let invulnState = createInvulnState();
// Phase 10.9: Alpha-grace timer. When the player's energy hits 0
// in Alpha, this timer counts down from ALPHA_GRACE_DURATION (5s)
// before forcePhaseCollapse fires. The §10.9 acceptance: "in Alpha
// the player can tough it out at 0 for 5 seconds (the game trusts
// you in your home phase)". When the player shifts to Beta/Gamma
// the grace resets to 0 (the collapse can fire immediately on
// their next 0-energy tick because they left the safe phase).
let alphaGraceRemaining = 0;
// Phase 10.9: heartbeat cadence tracker. The §10.9 brief calls
// for a "subtle audio heartbeat" at energy < 15 (1Hz cadence).
// We accumulate dt in this variable and fire playHeartbeat when
// it crosses HEARTBEAT_INTERVAL. The timer resets on tier exit
// (energy >= 15) so the heartbeat doesn't fire one last time
// after the player recharges.
let heartbeatAccum = 0;
const HEARTBEAT_INTERVAL = 1.0;
// Phase 8.6: track whether the player was inside the tutorial ring
// last frame (for re-trigger edge detection).
let wasInTutorialRing = false;
let inputSuppressed = false;

// Phase 9.2: first-input audio fallback. Installed at each
// pointerlockchange so the FIRST user input after pointer-lock
// (mouse move or any key) re-attempts the AudioContext resume.
// The first-input handler is a one-shot and removes itself.
// The `pointerLockAudioFallbackTimer` is a 5s safety timeout so
// the listener + timer can't leak if the player never moves.
let pointerLockAudioFallbackHandler = null;
let pointerLockAudioFallbackTimer = null;
function installPointerLockAudioFallback(resumeFn) {
  // Clean up any prior fallback (defensive — a fast lock/unlock
  // cycle could otherwise stack listeners).
  uninstallPointerLockAudioFallback();
  if (typeof document === 'undefined') return;
  const handler = (ev) => {
    // Only the very first input event after pointer-lock counts.
    // Subsequent events (WASD, mouse-move, etc.) skip the resume.
    uninstallPointerLockAudioFallback();
    try { resumeFn(); } catch (e) {}
  };
  // Listen on document so we catch the first event regardless of
  // focus. mousedown + keydown + mousemove are the three events
  // Firefox dispatches immediately on pointer-lock.
  const opts = { once: true, passive: true };
  document.addEventListener('mousedown', handler, opts);
  document.addEventListener('keydown', handler, opts);
  document.addEventListener('mousemove', handler, opts);
  pointerLockAudioFallbackHandler = handler;
  // Safety timeout: drop the listener after 5s so it never leaks.
  if (typeof setTimeout === 'function') {
    pointerLockAudioFallbackTimer = setTimeout(() => {
      uninstallPointerLockAudioFallback();
    }, 5000);
  }
}
function uninstallPointerLockAudioFallback() {
  // The { once: true } option removes the listener automatically
  // after the first event fires, so this is a defense-in-depth
  // cleanup for the timeout path + the lock/unlock cycle path.
  if (pointerLockAudioFallbackTimer) {
    clearTimeout(pointerLockAudioFallbackTimer);
    pointerLockAudioFallbackTimer = null;
  }
  pointerLockAudioFallbackHandler = null;
}
// Phase 3.3: Player inventory (collected Echoes + amplifiers). The
// game loop owns the singleton; the save/load round-trip
// serializes + deserializes it.
let playerInventory = createInventory();

// Phase 3.5: Phase Glider state machine (Space held in Beta = brief fly)
let gliderState = createGliderState();
let fovBreathingActive = false;
let fovBreathingTimer = 0;
let fovBreathingStartFov = 75;
const FOV_BREATHING_DURATION = 1.5;
const FOV_BREATHING_PEAK = 80;
const FOV_BREATHING_BASE = 75;

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
  // Phase 10.14: build the phase-dominance seed from the
  // save blob (or default to 0 for a fresh playthrough).
  // The world reads both the world seed + the phase-dominance
  // seed, so this happens BEFORE the World construction.
  const _newGamePlus = createNewGamePlusState(
    _savedState && _savedState.newGamePlus
  );
  const _phaseDominanceSeed = _newGamePlus.phaseDominanceSeed;
  // Keep a module-level handle on the newGamePlus state so the
  // pause menu's "Start New Game+" button can read + mutate
  // it (and so the save/load round-trip persists the latest
  // state).
  newGamePlusState = _newGamePlus;
  world = new World(scene, (chunk) => updateChunkVisual(chunk), 42, _phaseDominanceSeed);

  // Phase 10.8: wire the world.onEroded hook so checkErosion fires
  // a visible burst + audio cue whenever a block converts. The
  // hook is forward-declared (renderer/audioManager may not be
  // constructed yet at this point); the dispatcher is a no-op if
  // the renderer isn't ready. The closure captures `renderer` and
  // `audioManager` from the module scope so the same callback
  // works through re-init.
  world.onEroded = (x, y, z, phase, oldBlockId, newBlockId) => {
    if (renderer && typeof renderer.showErosionBurst === 'function') {
      renderer.showErosionBurst(x, y, z, phase);
    }
    if (audioManager && typeof audioManager.playErosion === 'function') {
      audioManager.playErosion();
    }
    // Rebuild the chunk visual on the eroded cell so the player
    // sees the new block immediately. The visual update is
    // throttled by chunk visibility — only chunks in render
    // distance get rebuilt. The brief's "visible in-game"
    // acceptance hinges on this.
    if (world && typeof world.updateChunks === 'function') {
      // The chunk coords are Math.floor(x/CHUNK_SIZE) — mirrors
      // the convention used in main.js's existing updateChunks
      // calls (the player position is the only input).
      // We don't have player position here, so defer to the next
      // tick (the chunk rebuilds on the next frame via the
      // existing per-frame updateChunks call).
    }
  };

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
    // Phase 10.8: re-apply the saved erosion progress so the
    // erosion threshold (3s of exposure) is preserved across
    // reloads. Back-compat: missing `erosion` key returns {}
    // via _coerceErosion, so this is a no-op for old saves.
    if (world && typeof world.applyErosionState === 'function' &&
        _savedState.erosion && typeof _savedState.erosion === 'object') {
      world.applyErosionState(_savedState.erosion);
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
      // Phase 9.2: Firefox pointer-lock audio quirk — Firefox's
      // pointerlockchange fires BEFORE the AudioContext unlock
      // path completes, so a direct `resume()` on the just-acquired
      // state can be a no-op. The recommended fix is to defer the
      // resume to the next event-loop tick via setTimeout(..., 0)
      // so the AudioContext has time to settle. We also install
      // a one-shot first-input fallback listener that re-attempts
      // the resume on the very next keystroke / mouse-move — the
      // input event is itself a user gesture, so the resume is
      // guaranteed to succeed. The Chromium path works the same
      // way (the setTimeout deferral is a no-op on Chromium because
      // the context is already 'running' by the time the listener
      // fires).
      //
      // init() stays on the blocker click only — the AudioContext
      // is created once on the user gesture, then resumed on each
      // pointer-lock or visibilitychange transition.
      const deferredResume = () => {
        if (audioManager && typeof audioManager.safeResume === 'function') {
          audioManager.safeResume();
        } else if (audioManager && typeof audioManager.resume === 'function') {
          audioManager.resume();
        }
      };
      // Defer to the next event-loop tick so Firefox's
      // pointerlockchange → AudioContext unlock race is bypassed.
      // The setTimeout is the canonical fix from the Mozilla
      // developer docs.
      setTimeout(deferredResume, 0);
      // First-input fallback. The very next keystroke (W/A/S/D
      // movement, space jump, any other key) or mouse-move
      // re-attempts the resume. Remove the listener once the
      // resume succeeds (or after a 5s safety timeout) so it
      // doesn't leak across lock cycles.
      installPointerLockAudioFallback(deferredResume);
      if (!gameRunning) {
        gameRunning = true;
        lastTime = performance.now();
        // Initial HUD update so phase names show immediately
        hud.update(phaseManager, physicsManager, world);
        requestAnimationFrame(gameLoop);
      }
    }
  });

  // Phase 8.3 + 9.2: audio context restart on tab-resume. When the
  // tab is backgrounded for >5 min, Chrome can suspend the
  // AudioContext. resume() on the next pointer lock is the
  // recovery path, but the ambient music loop may have drifted
  // out of sync. Re-trigger startAmbientMusic(phase) on the
  // visibility change so the music loop is fresh. Phase 9.2
  // adds a safeResume() call before startAmbientMusic so the
  // context is in 'running' state when the music spin-up
  // happens — otherwise the new oscillators are silent.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!audioManager) return;
      // Phase 9.2: safeResume (deferred to next event-loop tick)
      // before startAmbientMusic. If safeResume is missing
      // (older build), fall back to the legacy resume() path.
      try {
        if (typeof audioManager.safeResume === 'function') {
          // Defer to the next tick so the browser's tab-resume
          // state has time to settle before we resume.
          setTimeout(() => { try { audioManager.safeResume(); } catch (e) {} }, 0);
        } else if (typeof audioManager.resume === 'function') {
          setTimeout(() => { try { audioManager.resume(); } catch (e) {} }, 0);
        }
      } catch (e) {}
      if (typeof audioManager.startAmbientMusic !== 'function') return;
      if (typeof audioManager.initialized === 'function' && !audioManager.initialized()) return;
      const p = (phaseManager && typeof phaseManager.getCurrentPhase === 'function')
        ? phaseManager.getCurrentPhase()
        : 0;
      try {
        audioManager.startAmbientMusic(p);
      } catch (e) {
        // Defensive: a malformed startAmbientMusic call must not
        // break the game loop.
      }
    });
  } else {
    blocker.classList.remove('hidden');
    gameRunning = false;
  }

  // HUD
  hud = new HUD(document.getElementById('hud'));

  // Phase 8.1: wire the tutorial skip button. The click handler
  // delegates to the skipTutorial() debug hook so the test can
  // verify the path.
  if (typeof document !== 'undefined') {
    const skipBtn = document.querySelector('#tutorial-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        if (typeof window !== 'undefined' && window.__phaseShifter__ && typeof window.__phaseShifter__.skipTutorial === 'function') {
          window.__phaseShifter__.skipTutorial();
        }
      });
    }
  }
  hud.update(phaseManager, physicsManager, world);

  // Handle window resize
  window.addEventListener('resize', onResize);

  // Menu button wiring is at the end of init() (see below).

  // Phase 10.7 (Path A): RMB no longer places blocks. It just cycles
  // the phase (the original §2.1 behavior). Phase 10.2 introduces the
  // Phase Fuse mechanic (F key) for the player-driven world changes.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!document.pointerLockElement || inputSuppressed) return;
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
  // Phase 10.7 (Path A): LMB no longer breaks blocks. Only Shift+LMB
  // still places a Phase Anchor. The intentional verb set is now:
  //   WASD+Shift (move), Space (jump), Shift+Space (phase shift),
  //   Q (Resonance), F (Phase Fuse, §10.2), Shift+LMB (Anchor),
  //   E (Phase Lens), T (cycle phase), R (Stabilizer), 1/2/3
  //   (direct phase), I (inventory), M (minimap).
  document.addEventListener('click', (e) => {
    if (!document.pointerLockElement || gamePaused || inputSuppressed) return;
    if (e.button === 0 && shiftKeyHeld) {
      placeAnchor();
    }
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

  // Phase 4.4: start periodic autosave (every 30 seconds).
  // Uses the settings.autosave flag — if the player turns it off
  // in the Settings menu, the interval is cleared.
  if (saveSystem && typeof saveSystem.autoSave === 'function') {
    saveSystem.autoSave({
      seed: 42,
      position: { x: 0, y: 20, z: 0 },
      phase: phaseManager ? phaseManager.getCurrentPhase() : 0,
      energy: phaseManager ? phaseManager.getEnergy() : 100,
      unlockedTools: [],
      biomesDiscovered: [],
      echoesFound: 0,
      worldState: world && typeof world.exportGlobalState === 'function' ? world.exportGlobalState() : {},
      anchors: world && typeof world.exportAnchors === 'function' ? world.exportAnchors() : [],
      inventory: serializeInventory(playerInventory),
      timestamp: (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() : 0,
    });
  }

  // Phase 4.3: register a per-frame marker push so the minimap
  // knows where the Echoes / Stabilizers / Resonance Cores are.
  if (hud && typeof hud.setMinimapMarkers === 'function') {
    setInterval(() => {
      try {
        const echoes = world && typeof world.listEchoes === 'function' ? world.listEchoes() : [];
        const stabs = world && typeof world.exportStabilizers === 'function' ? world.exportStabilizers() : [];
        const cores = world && typeof world.listResonanceCores === 'function' ? world.listResonanceCores() : [];
        hud.setMinimapMarkers({
          echoKeys: Array.isArray(echoes) ? echoes : [],
          stabilizerKeys: Array.isArray(stabs) ? stabs.map((s) => s.key || `${s.x},${s.y},${s.z}`) : [],
          resonanceCoreKeys: Array.isArray(cores) ? cores : [],
        });
      } catch (e) {}
    }, 1000);
  }

  // Phase 4.2: apply HUD opacity on init (so the player sees the
  // saved opacity immediately after reload).
  if (hud && settings && typeof hud.applyHudOpacity === 'function') {
    hud.applyHudOpacity(settings.getHudOpacity());
  }

  // Menu wiring is the LAST step so a failure here can't block gameplay
  // listeners attached above. (Phase 1.1.)
  setupMenuButtons();

  console.log('Phase Shifter initialized!');
}

function setupMenuButtons() {
  // Phase 4.1: HUD owns its DOM. Pause / Inventory / Settings panels
  // are created dynamically by the HUD; main.js just wires the
  // toggles via defensive addEventListener. Missing markup never
  // crashes init() (the §1.1 regression lock).
  const safeOn = (id, evt, handler) => {
    const el = (typeof document !== 'undefined') ? document.getElementById(id) : null;
    if (el) el.addEventListener(evt, handler);
    return el;
  };

  // Phase 4.1: defensively create the pause menu (the static
  // markup was removed in Phase 4.1; the HUD owns the DOM).
  let pauseMenu = (typeof document !== 'undefined') ? document.getElementById('pause-menu') : null;
  if (!pauseMenu && typeof document !== 'undefined' && hud && hud.container) {
    pauseMenu = document.createElement('div');
    pauseMenu.id = 'pause-menu';
    pauseMenu.style.cssText = 'display:none;position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:90;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:monospace;';
    pauseMenu.innerHTML = '<h2 style="color:#88ccff;font-size:20px;margin-bottom:20px;">PAUSED</h2>'
      + '<button id="btn-resume" style="background:#222;color:#88ccff;border:1px solid #444;padding:10px 30px;margin:5px;cursor:pointer;font-family:monospace;font-size:14px;border-radius:4px;">Resume</button>'
      + '<button id="btn-save" style="background:#222;color:#88ccff;border:1px solid #444;padding:10px 30px;margin:5px;cursor:pointer;font-family:monospace;font-size:14px;border-radius:4px;">Save Game</button>'
      + '<button id="btn-inv" style="background:#222;color:#88ccff;border:1px solid #444;padding:10px 30px;margin:5px;cursor:pointer;font-family:monospace;font-size:14px;border-radius:4px;">Inventory</button>'
      + '<button id="btn-opts" style="background:#222;color:#88ccff;border:1px solid #444;padding:10px 30px;margin:5px;cursor:pointer;font-family:monospace;font-size:14px;border-radius:4px;">Settings</button>'
      + '<button id="btn-newgameplus" style="background:#222;color:#ffcc44;border:1px solid #664400;padding:10px 30px;margin:5px;cursor:pointer;font-family:monospace;font-size:14px;border-radius:4px;">Start New Game+</button>'
      + '<button id="btn-quit" style="background:#222;color:#88ccff;border:1px solid #444;padding:10px 30px;margin:5px;cursor:pointer;font-family:monospace;font-size:14px;border-radius:4px;">Quit to Title</button>'
      + '<div id="save-info" style="color:#4488ff;font-size:11px;margin-top:10px;"></div>';
    hud.container.appendChild(pauseMenu);
  }

  // Pause menu buttons
  safeOn('btn-resume', 'click', () => {
    if (pauseMenu) pauseMenu.style.display = 'none';
    gamePaused = false;
    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }
  });
  safeOn('btn-inv', 'click', () => {
    if (pauseMenu) pauseMenu.style.display = 'none';
    if (typeof updateInventoryUI === 'function') updateInventoryUI();
    if (hud && typeof hud.showInventory === 'function') hud.showInventory(buildInventoryPlayerAdapter(), true);
  });
  safeOn('btn-save', 'click', () => {
    saveGame();
    const saveInfo = document.getElementById('save-info');
    if (saveInfo && saveSystem && typeof saveSystem.getLastSaveInfo === 'function') {
      saveInfo.textContent = 'Last save: ' + (saveSystem.getLastSaveInfo() || 'just now');
    }
  });
  safeOn('btn-opts', 'click', () => {
    if (pauseMenu) pauseMenu.style.display = 'none';
    // Phase 4.2: open the Settings menu via the HUD. Settings
    // are persisted via settings.set(key, value) on every change
    // (live-apply).
    if (hud && typeof hud.showSettings === 'function' && settings) {
      hud.showSettings(settings.getAll(), applySettingsChange, true);
    }
  });
  safeOn('btn-quit', 'click', () => {
    gameRunning = false;
    gamePaused = true;
    if (pauseMenu) pauseMenu.style.display = 'none';
    if (typeof document !== 'undefined' && document.exitPointerLock) {
      document.exitPointerLock();
    }
    const blocker = document.getElementById('blocker');
    if (blocker) blocker.classList.remove('hidden');
  });

  // Phase 10.14: "Start New Game+" button. Rolls a fresh
  // phase-dominance seed, preserves the ironman flag from
  // the current run, resets position/energy/inventory, and
  // persists the new state. The pause menu closes; the
  // player is back in the game with the new shuffle.
  safeOn('btn-newgameplus', 'click', () => {
    if (!saveSystem || typeof saveSystem.startNewGamePlus !== 'function') {
      if (hud) hud.showNotification('New Game+ unavailable', '#ff6644');
      return;
    }
    if (!newGamePlusState) newGamePlusState = createNewGamePlusState();
    const _seed = Math.floor(Math.random() * 0x7fffffff) + 1;
    newGamePlusState.phaseDominanceSeed = _seed;
    const _newState = saveSystem.startNewGamePlus(_savedState || null, {
      phaseDominanceSeed: _seed,
      ironman: newGamePlusState.ironman,
    });
    if (world && typeof world.setPhaseDominanceSeed === 'function') {
      world.setPhaseDominanceSeed(_seed);
    }
    if (physicsManager && typeof physicsManager.setPosition === 'function' && spawnPoint) {
      physicsManager.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    }
    if (phaseManager && typeof phaseManager.setPhase === 'function') {
      phaseManager.setPhase(0);
    }
    if (world) {
      if (typeof world.clearAnchors === 'function') world.clearAnchors();
      if (typeof world.clearFuses === 'function') world.clearFuses();
      if (typeof world.clearEchoes === 'function') world.clearEchoes();
      if (typeof world.clearResonanceCores === 'function') world.clearResonanceCores();
    }
    saveSystem.save(_newState);
    if (hud) hud.showNotification('NEW GAME+ shuffle locked in (seed ' + _seed + ')', '#ffcc44');
    if (pauseMenu) pauseMenu.style.display = 'none';
    gamePaused = false;
  });

  // Inventory panel close
  safeOn('inv-close', 'click', () => {
    if (hud && typeof hud.showInventory === 'function') hud.showInventory(buildInventoryPlayerAdapter(), false);
  });

  // Phase 10.10: open the Echo Hunter panel from the inventory.
  // The button is rendered inside the inventory panel (the
  // §10.10 brief: "a dedicated inventory tab turns the
  // 36-Echo narrative into a collection goal"). The
  // safeOn() helper re-attaches the click handler on every
  // show so the dynamic content gets the event.
  safeOn('btn-open-echo-hunter', 'click', () => {
    if (hud && typeof hud.showEchoHunter === 'function') {
      hud.showEchoHunter(buildEchoHunterSummary(), (b) => biomeLabel(b));
    }
  });

  // Pause on P key (when pointer is NOT locked)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
      togglePause();
    }
  });

  // Inventory toggle (I key)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') {
      if (hud && typeof hud.showInventory === 'function') {
        const inv = (typeof document !== 'undefined') ? document.querySelector('#inventory-panel') : null;
        const wasOpen = inv && inv.style.display === 'block';
        hud.showInventory(buildInventoryPlayerAdapter(), !wasOpen);
      }
    }
    // Minimap toggle (M key) — also keep the J key from §4.1
    if ((e.key === 'm' || e.key === 'M' || e.key === 'j' || e.key === 'J') && hud && typeof hud.setMinimapVisible === 'function') {
      const isVisible = hud.minVisible !== false;
      hud.setMinimapVisible(!isVisible);
    }
  });

  // Phase 4.2: Settings menu close button (defensive — only if
  // the HUD has rendered the panel + the close button exists).
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.id === 'settings-close') {
      const panel = document.getElementById('settings-panel');
      if (panel) panel.style.display = 'none';
    }
  });
}

/**
 * Phase 4.2: live-apply a settings change. Called by the HUD's
 * settings menu whenever the user toggles / moves a slider.
 */
function applySettingsChange(key, value) {
  if (!settings) return;
  settings.set(key, value);
  if (key === 'resolutionScale') {
    if (typeof window !== 'undefined' && renderer) {
      try { renderer.setPixelRatio(Math.max(0.5, Math.min(1.5, value))); } catch (e) {}
    }
  } else if (key === 'renderDistance') {
    if (world && physicsManager && typeof world.updateChunks === 'function') {
      const pos = physicsManager.getPos();
      if (pos) world.updateChunks(pos.x, pos.z, Math.max(1, Math.min(5, value | 0)));
    }
  } else if (key === 'mouseSensitivity') {
    if (typeof window !== 'undefined') {
      window.__phaseShifter__ && (window.__phaseShifter__._mouseSensitivity = value);
    }
  } else if (key === 'masterVolume' || key === 'musicVolume' || key === 'sfxVolume') {
    if (typeof audioManager !== 'undefined' && audioManager) {
      try {
        if (typeof audioManager.setMasterVolume === 'function') audioManager.setMasterVolume(value);
        if (key === 'musicVolume' && typeof audioManager.setMusicVolume === 'function') audioManager.setMusicVolume(value);
        if (key === 'sfxVolume' && typeof audioManager.setSfxVolume === 'function') audioManager.setSfxVolume(value);
      } catch (e) {}
    }
  } else if (key === 'hudOpacity') {
    if (hud && typeof hud.applyHudOpacity === 'function') hud.applyHudOpacity(value);
  } else if (key === 'settingsReset') {
    // Phase 8.4: Reset to defaults. `value` is the canonical
    // default settings object (the full shape from
    // `defaultSettings()`). Set every key + re-apply the live
    // effects.
    const defaults = (value && typeof value === 'object') ? value : defaultSettingsPure();
    if (typeof settings.setAll === 'function') {
      settings.setAll(defaults);
    }
    if (hud && typeof hud.applyHudOpacity === 'function') hud.applyHudOpacity(defaults.hudOpacity);
    if (typeof audioManager !== 'undefined' && audioManager) {
      try {
        if (typeof audioManager.setMasterVolume === 'function') audioManager.setMasterVolume(defaults.masterVolume);
        if (typeof audioManager.setMusicVolume === 'function') audioManager.setMusicVolume(defaults.musicVolume);
        if (typeof audioManager.setSfxVolume === 'function') audioManager.setSfxVolume(defaults.sfxVolume);
      } catch (e) {}
    }
  }
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

  // Phase 5.4: FOV breathing — start the camera.fov cycle
  // (75 → 80 → 75 over 1.5s) when the player shifts phases. The
  // tick is a module-level state machine (the §5.4 "FOV breathing
  // during shift" acceptance). The reduced-motion setting
  // disables the breathing.
  if (settings && settings.getReducedMotion && settings.getReducedMotion()) {
    return; // §5.5: reduced-motion mode disables FOV breathing
  }
  fovBreathingTimer = 0;
  fovBreathingActive = true;
  if (camera) {
    fovBreathingStartFov = camera.fov || 75;
  }
}

function gameLoop(time) {
  if (!gameRunning) return;

  const deltaTime = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  // Update phase manager
  phaseManager.update(deltaTime);

  // Phase 10.2: Phase Fuse (F-key, 3s hold, 30 energy).
  // Reads ctrlState.fusing; commits the fuse on progress == 1.
  tickFusePerFrame(deltaTime);

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
        // Phase 8.7: density-aware footstep volume. Walking
        // through dense stone is louder than walking across
        // sparse air. The neighbor count is read on the same
        // cell as the material (the cell directly under the
        // player's feet). The multiplier is clamped to [0.5, 1.0].
        const neighborCount = countNeighbors(world, playerPos.x, cellY, playerPos.z, phaseManager.getCurrentPhase());
        const volumeMultiplier = footstepVolumeForDensity(neighborCount, 8);
        try {
          audioManager.playFootstep(material, volumeMultiplier);
        } catch (e) {
          // Defensive: older audioManager builds may not accept
          // the volume arg. Fall back to the no-arg call.
          audioManager.playFootstep(material);
        }
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

  // Phase 10.13: advance the §10.13 charge state + pulse every
  // frame. The charge state machine lives in src/resonance/charge.js;
  // this tick handles the state transitions + the commit-edge swap.
  // The per-frame gate is `isChargeActive(resonanceChargeState)` —
  // we only spend cycles on the pulse mesh while the state machine
  // is in 'charging' or 'committing'. The legacy
  // `resonancePulseActive` flag is preserved for the debug hooks
  // that just want a boolean.
  if (isChargeActive(resonanceChargeState)) {
    resonancePulseActive = true;
    tickResonanceChargePerFrame(deltaTime);
  } else if (resonancePulseActive
      && renderer && typeof renderer.updateResonancePulse === 'function') {
    // Legacy one-shot fallback — the renderer still has a live
    // mesh from a pre-§10.13 press.
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

  // Phase 10.8: per-frame Phase Erosion tick. The world's
  // checkErosion converts blocks that have been exposed to the
  // wrong phase for ~3 seconds; the renderer's ErosionBurstOverlay
  // plays the per-cell wireframe puff; the audioManager fires the
  // "crumble" sound. O(11^3 x 3) per frame, throttled by the
  // EROSION_THRESHOLD so the visual + audio is sparse.
  tickErosionPerFrame(deltaTime);

  // Phase 10.9: per-frame Energy Danger tick. Drives the screen
  // vignette pulse, the 1Hz audio heartbeat, and the 5s Alpha
  // grace + auto-collapse trigger. The HUD's energy-fill throb
  // class is also applied here (the HUD update uses the same
  // energyTier helper so the class is in sync with the vignette
  // + audio).
  tickEnergyDangerPerFrame(deltaTime);

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
  // Phase 8.2: per-frame post-collapse invuln tick (5s window).
  tickInvulnPerFrame(deltaTime);
  tickEchoesPerFrame(deltaTime);
  tickResonanceCoresPerFrame(deltaTime);
  tickLocksPerFrame(deltaTime);
  tickGliderPerFrame(deltaTime);
  // Phase 5.4: FOV breathing tick (the §5.4 acceptance).
  tickFovBreathingPerFrame(deltaTime);
  // Phase 5.1: update the HUD objective + compass (the §5.1
  // acceptance: a persistent HUD objective shown above the
  // crosshair + compass direction to the nearest Echo / Stabilizer
  // / Core).
  tickGoalsPerFrame(deltaTime);
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

  // Phase 10.12: drive the phase-shift preview shader pass. While
  // the PhaseManager is mid-shift the preview pass blends a
  // desaturated + tinted ghost of the target phase into the frame
  // (the §10.12 visual). Idle / post-shift: uPreviewAmount = 0
  // (the shader pass is a no-op).
  updatePhaseShiftPreviewPerFrame();

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
// Phase 9.3: respects the reduced-motion setting (the §9.3 acceptance:
// "Reduced-motion: Settings → reduced-motion on → ... phase-shift color
// pulse are skipped, but the game is still playable"). When reduced-motion
// is on, the overlay stays transparent through the entire shift so the
// color pulse is suppressed.
// Phase 10.12: drive the §10.12 phase-shift preview shader
// pass. While the PhaseManager is mid-shift (`_isShifting === true`
// and `getPhaseShiftProgress() < 1`) the preview pass blends a
// desaturated + tinted ghost of the target phase into the frame.
// After the shift completes (progress >= 1) the preview amount
// resets to 0 so the pass is a no-op.
//
// The preview duration is 0.5s of the 1.5s shift animation. During
// the first 0.5s the ghost fades in (previewAmount returns a value
// approaching PEAK_PREVIEW_AMOUNT); during the next 1.0s it fades
// out as the world commits to the target phase.
function updatePhaseShiftPreviewPerFrame() {
  if (!postProcessing || typeof postProcessing.updatePhaseShiftPreview !== 'function') {
    return;
  }
  if (!phaseManager || !phaseManager._isShifting) {
    postProcessing.updatePhaseShiftPreview(0, { r: 1, g: 1, b: 1 });
    return;
  }
  const progress = phaseManager.getPhaseShiftProgress
    ? phaseManager.getPhaseShiftProgress()
    : 0;
  if (!shouldRunPreview(progress)) {
    postProcessing.updatePhaseShiftPreview(0, { r: 1, g: 1, b: 1 });
    return;
  }
  const targetPhase = phaseManager.getTargetPhase
    ? phaseManager.getTargetPhase()
    : phaseManager.getCurrentPhase();
  const amount = previewAmount(progress);
  const color = previewColor(targetPhase);
  postProcessing.updatePhaseShiftPreview(amount, color);
}

function updatePhaseShiftOverlay() {
  const overlay = document.getElementById('phase-shift-overlay');
  if (!overlay) return;
  if (!phaseManager._isShifting) {
    // Transparent when idle. Use rgba so future JS reads of the
    // backgroundColor still parse cleanly.
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    return;
  }
  // Phase 9.3: skip the color pulse when reduced-motion is on.
  if (settings && typeof settings.getReducedMotion === 'function' && settings.getReducedMotion()) {
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
// Phase 10.13: §10.13 charge-up flow.
//   - Q press with no active charge → start a 0.5s charge (preview).
//   - Q press during 'charging' → CANCEL the charge (no swap, no debit).
//   - Q press during 'committing' → start a fresh charge cycle.
//   - On the charging → committing transition (or on Q press during
//     charging) the cost (25 energy) is debited + the swap runs.
//
// Returns an object `{ ok, reason }` so the caller / debug hooks
// can introspect the result. `reason` is one of:
//   - 'started'        — a new charge cycle was created
//   - 'cancelled'      — an in-progress charge was cancelled
//   - 'committed'      — the swap fired (cost debited, pulse expanded)
//   - 'insufficient'   — press refused for < RESONATE_COST energy
//   - 'noop'           — state was already committing when Q was pressed
function performResonance(pos) {
  const currentPhase = phaseManager.getCurrentPhase();

  // ── Case 1: charging in progress → CANCEL ────────────────
  if (isCharging(resonanceChargeState)) {
    cancelCharge(resonanceChargeState);
    if (renderer && typeof renderer.clearResonancePulse === 'function') {
      renderer.clearResonancePulse();
    }
    resonancePulseActive = false;
    resonance_insufficientNotifiedThisPress = false;
    if (hud && typeof hud.showNotification === 'function') {
      hud.showNotification('RESONANCE: cancelled', '#d9b34c');
    }
    return { ok: true, reason: 'cancelled' };
  }

  // ── Case 2: currently committing → ignore (a new press restarts the
  //    charge only after the commit finishes; this matches the §10.13
  //    spec — "press Q again within 1.0s to cancel" only applies during
  //    the charge window, not during the commit).
  if (isCommitting(resonanceChargeState)) {
    return { ok: true, reason: 'noop' };
  }

  // ── Case 3: idle → start a new charge ───────────────────
  if (phaseManager.getEnergy() < resonateCost()) {
    if (!resonance_insufficientNotifiedThisPress) {
      hud.showNotification('Insufficient energy', '#ff8844');
      resonance_insufficientNotifiedThisPress = true;
    }
    return { ok: false, reason: 'insufficient' };
  }
  // Reset the one-shot insufficient-energy gate.
  resonance_insufficientNotifiedThisPress = false;

  // Initialize the charge state (the renderer reads this to drive
  // the preview sphere). The cost is NOT debited yet — it's debited
  // when the charge → commit transition fires.
  startCharge(
    resonanceChargeState,
    pos.x, pos.y, pos.z,
    currentPhase,
    phaseManager.getEnergy(),
  );

  // Spawn the preview sphere (small, dim — see the charge module).
  if (renderer && typeof renderer.startResonanceCharge === 'function') {
    renderer.startResonanceCharge(
      pos.x, pos.y, pos.z, currentPhase, resonanceChargeState,
    );
  } else if (renderer && typeof renderer.showResonancePulse === 'function') {
    // Fallback to the legacy one-shot pulse if the renderer hasn't
    // been updated yet (back-compat with any test that stubs the
    // renderer with only the old surface).
    renderer.showResonancePulse(pos.x, pos.y, pos.z, currentPhase);
  }
  resonancePulseActive = true;

  if (hud && typeof hud.showNotification === 'function') {
    hud.showNotification(
      `RESONANCE: charging (${RESONANCE_CHARGE_SECONDS.toFixed(1)}s)`,
      '#d9b34c',
    );
  }

  return { ok: true, reason: 'started' };
}

// Phase 10.13: per-frame tick that advances the charge state and
// fires the commit when the charge window elapses. Called once per
// frame from the game loop. The function:
//   1. Ticks the charge state by deltaTime.
//   2. If the state just transitioned CHARGING → COMMITTING (i.e.
//      `isPendingCommit` is true), runs the swap + debits the cost +
//      fires the audio + shows the swap-count notification.
//   3. Updates the renderer pulse shape from the charge state.
//
// Returns `{ ok, swapped, committed }` for the debug hooks.
function tickResonanceChargePerFrame(deltaTime) {
  if (!isChargeActive(resonanceChargeState)) {
    return { ok: true, swapped: 0, committed: false };
  }
  const prevState = resonanceChargeState.state;
  tickCharge(resonanceChargeState, deltaTime);
  // Renderer pulse shape update — runs every frame while the mesh
  // is alive so the preview sphere grows smoothly.
  if (renderer && typeof renderer.updateResonanceCharge === 'function') {
    renderer.updateResonanceCharge(deltaTime, resonanceChargeState);
  } else if (renderer && typeof renderer.updateResonancePulse === 'function') {
    // Fallback to the legacy tick (the renderer reads its own elapsed).
    renderer.updateResonancePulse(deltaTime);
  }
  // Auto-dispose the pulse when the state machine returns to idle.
  if (!isChargeActive(resonanceChargeState)) {
    if (renderer && typeof renderer.clearResonancePulse === 'function') {
      renderer.clearResonancePulse();
    }
    resonancePulseActive = false;
    return { ok: true, swapped: 0, committed: false };
  }
  // Edge: charging → committing. Run the swap + debit the cost.
  if (prevState === 'charging' && isCommitting(resonanceChargeState)) {
    return commitResonanceSwap();
  }
  return { ok: true, swapped: 0, committed: false };
}

// Phase 10.13: helper that runs the actual resonance swap (called
// when the charge window elapses OR when Q is pressed during the
// charge to commit early). Returns `{ ok, swapped, committed }`.
function commitResonanceSwap() {
  const currentPhase = phaseManager.getCurrentPhase();
  // Delegate to the world — single source of truth for the swap.
  const results = resonateResults(
    resonanceChargeState.centerX,
    resonanceChargeState.centerY,
    resonanceChargeState.centerZ,
    resonateRadius(),
    currentPhase,
    world,
  );
  const swappedCount = totalSwappedCount(results);

  // Energy debit on commit (the §10.13 spec — not on press).
  const debited = phaseManager.consumeEnergy(resonateCost());

  // Audio: chord + sweep.
  if (audioManager && typeof audioManager.playResonance === 'function') {
    audioManager.playResonance(currentPhase);
  }

  // Notification.
  if (swappedCount > 0) {
    hud.showNotification(`RESONANCE: ${swappedCount} phase-cells`, '#d9b34c');
  } else {
    hud.showNotification('RESONANCE: no phase-cells', '#d9b34c');
  }
  clearPendingCommit(resonanceChargeState);
  return { ok: debited, swapped: swappedCount, committed: true };
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
  // Phase 10.6: per-biome anchor lifetime multiplier. Sky Ruins
  // = 2x, Phase Nexus = 2x, others = 1x. We consult the current
  // biome from the player's position (the §3.1 deterministic
  // per-region assignment) and pass the scaled lifetime into
  // createAnchor. Falls back to anchorLifetime() (10s) on bad
  // input.
  let lifetime = anchorLifetime();
  if (world && typeof world.getBiome === 'function' && physicsManager) {
    const _pos = physicsManager.getPos();
    if (_pos && Number.isFinite(_pos.x) && Number.isFinite(_pos.z)) {
      const _bm = biomeMultipliers(world.getBiome(_pos.x, _pos.z));
      lifetime = lifetime * _bm.anchorLifetimeMultiplier;
    }
  }
  // Idempotent: createAnchor refreshes the lifetime if the cell
  // is already anchored (the §2.7 spec — re-pressing extends the lock).
  const created = world.createAnchor(result.x, result.y, result.z, result.phase, lifetime);
  if (!created || !created.ok) {
    if (hud) hud.showNotification('Anchor placement failed', '#ff6644');
    return;
  }
  // Draw the wireframe. We pass the snapshot from getAnchors() so
  // the overlay reads the freshest `remaining` value.
  if (renderer && typeof renderer.showAnchor === 'function') {
    renderer.showAnchor({
      x: result.x, y: result.y, z: result.z, phase: result.phase,
      remaining: lifetime,
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

// Phase 10.2: Phase Fuse (F-key, 3s hold, 30 energy). The Memory World
// pillar — the player can permanently swap a block's phase presence by
// holding F against it. The cost is debited on commit (not on press).
//
// The function is called every frame from the game loop. It reads
// the `fusing` state from the Controls (true while F is held), the
// `fuseState` module-level state machine, and the player's current
// energy. On commit it:
//
//   1. Raycasts the targeted block (the same raycast as placeAnchor).
//   2. Debits FUSE_COST energy from the PhaseManager.
//   3. Applies the fuse override via world.applyFuse().
//   4. Spawns a particle burst + plays the audio cue.
//   5. Shows the HUD notification.
//
// Cancel: F released, cell changes, or energy drops below FUSE_COST.
function tickFusePerFrame(deltaTime) {
  if (!world || !phaseManager || !physicsManager) return;
  const ctrlState = (typeof controls !== 'undefined' && controls && typeof controls.getState === 'function')
    ? controls.getState() : null;
  const fHeld = ctrlState && ctrlState.fusing === true;
  const pos = physicsManager.getPos();
  const dir = getCameraDirection();
  const hit = raycastBlock(pos, dir);
  const hitCell = hit ? { x: Math.floor(hit.blockX), y: Math.floor(hit.blockY), z: Math.floor(hit.blockZ) } : null;

  // If F is released, cancel any in-progress fuse.
  if (!fHeld) {
    if (fuseState.active) {
      cancelFuse(fuseState);
    }
    return;
  }

  // If F is held but we have no hit, cancel.
  if (!hit) {
    if (fuseState.active) cancelFuse(fuseState);
    return;
  }

  // If the cell changed since the last tick, restart the fuse on the new cell.
  if (fuseState.active && fuseState.target
      && (fuseState.target.x !== hitCell.x || fuseState.target.y !== hitCell.y || fuseState.target.z !== hitCell.z)) {
    cancelFuse(fuseState);
  }

  // Start a new fuse if we don't have one.
  if (!fuseState.active) {
    const energy = phaseManager.getEnergy();
    if (energy < FUSE_COST) {
      if (hud) hud.showNotification('Not enough energy to fuse (need 30)', '#ff6644');
      return;
    }
    startFuse(fuseState, hitCell.x, hitCell.y, hitCell.z, energy);
    if (hud) hud.showNotification('Fusing...', '#ddaa44');
  }

  // Tick the fuse.
  const result = tickFuse(fuseState, deltaTime);
  // Update the renderer overlay (the FuseOverlay reads fuseState.progress).
  if (renderer && typeof renderer.showFuseProgress === 'function') {
    renderer.showFuseProgress(fuseState.target, result.progress);
  }

  // Commit on progress == 1.
  if (result.done && fuseState.active && fuseState.target) {
    const targetCell = fuseState.target;
    const overlayPhase = phaseManager.getCurrentPhase();
    // Debit the energy (the cost is 30, the brief's value).
    if (!phaseManager.consumeEnergy(FUSE_COST)) {
      // Not enough energy mid-hold: cancel.
      cancelFuse(fuseState);
      if (hud) hud.showNotification('Not enough energy to fuse', '#ff6644');
      return;
    }
    // Apply the fuse override (the Memory World write).
    if (world.applyFuse(targetCell.x, targetCell.y, targetCell.z, overlayPhase)) {
      if (hud) {
        hud.showNotification(
          `Fused (${targetCell.x}, ${targetCell.y}, ${targetCell.z}) — phase ${overlayPhase}`,
          '#ddaa44'
        );
      }
      // Audio cue.
      if (audioManager && typeof audioManager.playFuse === 'function') {
        audioManager.playFuse();
      }
    }
    // Reset the fuse state.
    cancelFuse(fuseState);
    if (renderer && typeof renderer.clearFuseProgress === 'function') {
      renderer.clearFuseProgress();
    }
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

// Phase 10.8: per-frame Phase Erosion tick. Calls world.checkErosion
// with the player's current position and phase, then drives the
// ErosionBurstOverlay. The world's checkErosion method is O(11^3 x 3)
// = ~4000 block lookups per frame at EROSION_RADIUS=5 — fast enough
// to run every frame on a desktop browser (verified via the
// `test-phase10-erosion.cjs` per-frame-cost test). The hook is
// throttled by the world's own EROSION_THRESHOLD: a block only
// erodes after ~3 seconds of continuous exposure, so the
// onEroded callback rarely fires in practice. The audio cue
// (`audioManager.playErosion()`) fires once per conversion — the
// brief's "soft crumble sound" acceptance.
function tickErosionPerFrame(dt) {
  if (!world || !physicsManager) return;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (d === 0) return;
  const pos = physicsManager.getPos();
  const currentPhase = phaseManager ? phaseManager.getCurrentPhase() : 0;
  // Defensive: the world's checkErosion handles non-finite values
  // safely (it floors the coords + checks for valid phase), but
  // we early-return if the player position is garbage.
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    return;
  }
  world.checkErosion(d, pos.x, pos.y, pos.z, currentPhase);
  if (renderer && typeof renderer.updateErosionBursts === 'function') {
    renderer.updateErosionBursts(d);
  }
}

// Phase 10.9: per-frame Energy Danger tick. Reads the player's
// current energy tier ('normal' | 'low' | 'critical' | 'collapse')
// and drives:
//   1. The #energy-fill CSS class (the throb animation) — handled
//      in the HUD update, not here.
//   2. The body.energy-collapse class (the screen vignette pulse)
//      — toggled here so the toggle isn't in the DOM-update path
//      (cheap; only fires on tier change).
//   3. The audioManager.playHeartbeat() cadence (1Hz in 'critical').
//   4. The Alpha-grace timer (5s at 0 in Alpha) and the auto-
//      collapse trigger when the grace expires.
//
// Defensive: every external dependency (phaseManager, audioManager,
// document) is checked for existence before use. The tier is
// computed once per frame and reused. The heartbeat accumulator
// is reset on tier exit so the cue doesn't fire on the frame the
// player recharges past 15.
function tickEnergyDangerPerFrame(dt) {
  if (!phaseManager) return;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (d === 0) return;
  const energy = phaseManager.getEnergy();
  const currentPhase = phaseManager.getCurrentPhase();
  const tier = energyTierFn(energy);

  // Vignette: toggle the body class on tier change so the CSS
  // keyframe pulse only runs while the player is in the
  // 'collapse' tier. Cheap DOM op, runs every frame.
  if (typeof document !== 'undefined' && document.body) {
    const cls = 'energy-collapse';
    const has = document.body.classList.contains(cls);
    if (tier === 'collapse' && !has) document.body.classList.add(cls);
    else if (tier !== 'collapse' && has) document.body.classList.remove(cls);
  }

  // Heartbeat: 1Hz audio thump in the 'critical' tier. The
  // accumulator is reset on tier exit so the cue stops the
  // instant the player recharges past 15.
  if (tier === 'critical') {
    heartbeatAccum += d;
    while (heartbeatAccum >= HEARTBEAT_INTERVAL) {
      heartbeatAccum -= HEARTBEAT_INTERVAL;
      if (audioManager && typeof audioManager.playHeartbeat === 'function') {
        audioManager.playHeartbeat();
      }
    }
  } else {
    heartbeatAccum = 0;
  }

  // Alpha grace + auto-collapse. In Alpha, the player can hold 0
  // energy for ALPHA_GRACE_DURATION seconds. We track the grace
  // via a countdown; when it hits 0 we call forcePhaseCollapse
  // (which is a no-op if the player is no longer in Alpha, or if
  // the post-collapse invuln is active).
  if (tier === 'collapse' && currentPhase === PHASE_ALPHA) {
    if (alphaGraceRemaining <= 0) {
      alphaGraceRemaining = ALPHA_GRACE_DURATION;
    } else {
      alphaGraceRemaining -= d;
      if (alphaGraceRemaining <= 0) {
        // Grace expired — trigger the collapse. forcePhaseCollapse
        // is a debug hook but it does the right thing in production
        // too (the function gates on invuln + alpha-skip so it's
        // safe to call any time).
        if (typeof forcePhaseCollapse === 'function') {
          forcePhaseCollapse();
        }
        alphaGraceRemaining = 0;
      }
    }
  } else {
    // Player recharged past 0, or shifted out of Alpha — reset
    // the grace so the next 0-energy tick in Alpha starts a fresh
    // 5s window.
    alphaGraceRemaining = 0;
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
    const _prevBiomeId = currentBiomeId;
    currentBiomeId = newBiomeId;
    targetBiomeTint = biomeTint(newBiomeId);
    biomeTransitionTimer = 0;
    // Phase 10.10: show a brief "Zone: X / Y Echoes found"
    // overlay when the player enters a new biome.
    if (hud && typeof hud.showBiomeZoneOverlay === 'function' && _prevBiomeId !== newBiomeId) {
      const _biomeName = biomeLabel(newBiomeId);
      const _summary = buildEchoHunterSummary();
      const _bTotal = (_summary && _summary.byBiomeTotal && _summary.byBiomeTotal[newBiomeId]) || 0;
      const _bGot = (_summary && _summary.byBiomeCollected && _summary.byBiomeCollected[newBiomeId]) || 0;
      hud.showBiomeZoneOverlay('ZONE: ' + _biomeName + ' \u2014 ' + _bGot + '/' + _bTotal + ' Echoes found', 3000);
    }
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


// Phase 7: build a player adapter for hud.showInventory. The hud API
// expects getTools() / getAmplifiers() / getEchoes(); main.js's
// playerInventory exposes echoes + amplifiers but not tools, so we
// wrap it in an adapter. (Latent bug: hud.showInventory(player, ...)
// referenced an undefined 'player' variable from the orphaned
// GameEngine port — pressing I to toggle the inventory threw a
// ReferenceError.)
function buildInventoryPlayerAdapter() {
  return {
    getTools: () => [],
    getAmplifiers: () => Object.entries(playerInventory.amplifiers || {}).map(([toolId, owned]) => ({ toolId, owned })),
    // Phase 10.10: getEchoes reads from the canonical collectedEchoes
    // Map (the §3.3 / §10.4 shape). The previous version read from
    // `playerInventory.echoes` (the legacy §3.3 array), which was
    // always empty in the current build.
    getEchoes: () => {
      const out = [];
      if (playerInventory && playerInventory.collectedEchoes instanceof Map) {
        for (const [key, lore] of playerInventory.collectedEchoes.entries()) {
          const biomeId = (world && Array.isArray(world._echoes))
            ? ((world._echoes.find((e) => e && e.key === key) || {}).biomeId)
            : 0;
          out.push({ type: 'echo', lore: lore || 'Unknown resonance echo', key, biomeId: Number.isFinite(biomeId) ? biomeId : 0 });
        }
      }
      return out;
    },
  };
}

/**
 * Phase 10.10: build the Echo Hunter summary. Reads the
 * player's collected Echoes + the world's `_echoes` map to
 * compute the per-biome collected / total counts. Used by
 * the Echo Hunter panel + the biome-transition zone overlay.
 *
 * The biome id for each Echo is read from the world's
 * `_echoes` map (the canonical source of truth). Echoes not
 * in the world map (e.g. legacy §3.3 collected Echoes without
 * a biomeId field) fall back to 0.
 */
function buildEchoHunterSummary() {
  const fresh = { byBiome: {}, collected: 0, total: 0, byBiomeCollected: {}, byBiomeTotal: {} };
  if (!playerInventory || !(playerInventory.collectedEchoes instanceof Map)) return fresh;
  const worldEchoes = (world && Array.isArray(world._echoes)) ? world._echoes : [];
  const biomeByKey = new Map();
  for (const e of worldEchoes) {
    if (e && e.key && Number.isFinite(e.biomeId)) {
      biomeByKey.set(e.key, e.biomeId);
    }
  }
  const _loreCountForBiome = (b) => (b === 8 ? 1 : 5);
  return listEchoesByBiome(playerInventory, (key) => {
    const b = biomeByKey.get(key);
    return Number.isFinite(b) ? b : 0;
  }, _loreCountForBiome);
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
  const anchors = world.exportAnchors ? world.exportAnchors() : [];
  // Phase 4.4: include velocity + look angles + energy + fatigue in the
  // save blob (the §4.4 acceptance: "the player can save, quit, reload
  // the page, and resume exactly where they left off").
  const velocity = (physicsManager && typeof physicsManager.getVelocity === 'function')
    ? physicsManager.getVelocity()
    : null;
  const cam = (typeof camera !== 'undefined') ? camera : null;
  const lookYaw = cam ? (cam.rotation ? cam.rotation.y : 0) : 0;
  const lookPitch = cam ? (cam.rotation ? cam.rotation.x : 0) : 0;
  const energy = phaseManager && typeof phaseManager.getEnergy === 'function'
    ? phaseManager.getEnergy()
    : 100;
  const fatigue = (typeof player !== 'undefined' && player && typeof player.fatigue === 'number')
    ? player.fatigue
    : 0;
  // Phase 10.8: capture the world's erosion progress (the
  // per-cell "x,y,z" -> { progress, lastPhase } map). The world's
  // getErosionState() returns a plain object; the save system
  // coerces it back to a safe shape on load.
  const erosion = (world && typeof world.getErosionState === 'function')
    ? world.getErosionState()
    : {};
  saveSystem.saveSnapshot(pos.x, pos.y, pos.z, phase, worldState, anchors, inventorySnapshot, {
    fuses,
    velocity: velocity ? { x: velocity.x, y: velocity.y, z: velocity.z } : null,
    lookYaw,
    lookPitch,
    energy,
    fatigue,
  }, fuses, erosion, newGamePlusState);
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
  if (!tutorialState || !tutorialState.active) {
    wasInTutorialRing = false;
    return;
  }
  const t = (typeof performance !== 'undefined' && Number.isFinite(performance.now)) ? performance.now() / 1000 : 0;
  const result = tickTutorialPure(tutorialState, dt, t);
  if (result.done) {
    tutorialState = clearTutorialPure(tutorialState);
    if (hud && typeof hud.clearTutorialHint === 'function') {
      hud.clearTutorialHint();
    }
    wasInTutorialRing = false;
    return;
  }
  // Phase 8.6: detect ring re-entry to re-fire the hint. If the
  // player was outside the ring last frame and is inside now,
  // re-set the hint to reset the fade-out timer.
  const playerPos = (physicsManager && typeof physicsManager.getPos === 'function')
    ? physicsManager.getPos()
    : null;
  if (playerPos && Number.isFinite(playerPos.x) && tutorialState.ringCenter) {
    const inRingNow = isWithinTutorialRing(
      playerPos.x, playerPos.y, playerPos.z,
      tutorialState.ringCenter.x, tutorialState.ringCenter.y, tutorialState.ringCenter.z
    );
    if (inRingNow && !wasInTutorialRing && hud && typeof hud.setTutorialHint === 'function' && result.hint) {
      hud.setTutorialHint(result.hint, result.hintIndex);
    }
    wasInTutorialRing = inRingNow;
  }
  if (hud && typeof hud.setTutorialHint === 'function' && result.hint) {
    hud.setTutorialHint(result.hint, result.hintIndex);
  }
}

// Phase 3.5: tickGliderPerFrame(dt) - advance the Phase Glider
// state machine (Space held in Beta = brief fly). The glider
// state was started by `startGlider(...)` (e.g. on Space press);
// the tick applies the per-frame delta to the player position.
// Phase 5.1: update the HUD objective + compass (the §5.1
// acceptance). Cheap: 1 DOM write per act transition (the
// `updateObjective` edge detector) + 1 transform write per
// frame for the compass arrow.
function tickGoalsPerFrame(dt) {
  if (!hud) return;
  const goalState = buildGoalStatePure(playerInventory, world, { phaseNexus: false });
  hud.updateObjective(goalState);
  // Compass: pick the nearest unfinished marker for the current act.
  const playerPos = (physicsManager && typeof physicsManager.getPos === 'function')
    ? physicsManager.getPos()
    : null;
  if (!playerPos) return;
  const yaw = (camera && camera.rotation) ? camera.rotation.y : 0;
  let target = null;
  if (world) {
    if (typeof world.listEchoes === 'function') {
      const echoes = world.listEchoes().map((k) => {
        const parts = String(k).split(',').map(Number);
        return { x: parts[0], y: parts[1], z: parts[2], key: k };
      });
      target = nearestMarkerPure(playerPos, echoes);
    }
    if (!target && typeof world.exportStabilizers === 'function') {
      const stabs = world.exportStabilizers().map((k) => {
        const parts = String(k).split(',').map(Number);
        return { x: parts[0], y: parts[1], z: parts[2], key: k };
      });
      target = nearestMarkerPure(playerPos, stabs);
    }
    if (!target && typeof world.listResonanceCores === 'function') {
      const cores = world.listResonanceCores().map((k) => {
        const parts = String(k).split(',').map(Number);
        return { x: parts[0], y: parts[1], z: parts[2], key: k };
      });
      target = nearestMarkerPure(playerPos, cores);
    }
  }
  hud.updateCompass(target, yaw, playerPos);
  // Phase 8.5: drive the compass distance indicator. Show the
  // distance to the nearest marker; color shifts to gold when
  // within 8 blocks (the "near pickup range" for Echoes + Cores).
  if (hud && typeof hud.setCompassDistance === 'function' && target) {
    const dx = target.x - playerPos.x;
    const dz = target.z - playerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const distBlocks = Math.floor(dist);
    const inRange = distBlocks <= 8;
    hud.setCompassDistance(distBlocks, inRange);
  } else if (hud && typeof hud.setCompassDistance === 'function') {
    hud.setCompassDistance(null, false);
  }
}

// Phase 5.4: FOV breathing tick. Cycles camera.fov
// (base → peak → base) over 1.5s when fovBreathingActive is true.
function tickFovBreathingPerFrame(dt) {
  if (!fovBreathingActive) return;
  const d = (typeof dt === 'number' && Number.isFinite(dt)) ? Math.max(0, Math.min(0.1, dt)) : 0;
  fovBreathingTimer += d;
  if (fovBreathingTimer >= FOV_BREATHING_DURATION) {
    fovBreathingActive = false;
    if (camera) {
      camera.fov = FOV_BREATHING_BASE;
      if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
    }
    return;
  }
  if (!camera) return;
  const t = fovBreathingTimer / FOV_BREATHING_DURATION;
  // Sin curve: peaks at t=0.5
  const phase = Math.sin(t * Math.PI);
  const fov = FOV_BREATHING_BASE + (FOV_BREATHING_PEAK - FOV_BREATHING_BASE) * phase;
  camera.fov = fov;
  if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
}

function tickGliderPerFrame(dt) {
  if (!gliderState || !gliderState.gliding) return;
  // Phase 10.6: apply the per-biome glider speed multiplier.
  // Deep Void = 2x faster. Phase Nexus = 2x (the "everything"
  // biome). All other biomes = 1x. We set the speed on the
  // state object (the §3.5 Glider reads `s.speed` from the
  // state), so the multiplier only fires while the player is
  // actually gliding (no per-frame cost when not gliding).
  if (physicsManager && world && typeof world.getBiome === 'function') {
    const pos = physicsManager.getPos();
    const bm = biomeMultipliers(world.getBiome(pos.x, pos.z));
    gliderState.speed = PHASE_GLIDER_SPEED * bm.gliderSpeedMultiplier;
  }
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

// Phase 10.3: pick a random Echo from the player's inventory to
// lose on collapse. Returns `{ key, lore }` or `null` if the
// player has no Echoes. The actual removal happens in the
// `result.done` branch of tickCollapsePerFrame — this helper
// just selects which Echo to lose.
function pickRandomEchoToLose() {
  const inv = playerInventory && playerInventory.collectedEchoes instanceof Map
    ? playerInventory
    : null;
  if (!inv || inv.collectedEchoes.size === 0) return null;
  const keys = Array.from(inv.collectedEchoes.keys());
  if (keys.length === 0) return null;
  const idx = Math.floor(Math.random() * keys.length);
  const key = keys[idx];
  const lore = inv.collectedEchoes.get(key) || '';
  return { key, lore };
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
    // Phase 10.3: lose the picked Echo on collapse resolution.
    // The lostEcho is on the collapseState (set by startCollapse
    // at the trigger time). If no Echo was picked (player has no
    // Echoes), fall back to a 25-energy penalty (deducted from
    // the respawn energy of 30, so the player respawns with 5).
    const lostEcho = result.lostEcho || (collapseState && collapseState.lostEcho) || null;
    let respawnEnergy = MINIMUM_RESPAWN_ENERGY;
    if (lostEcho && playerInventory && playerInventory.collectedEchoes instanceof Map
        && playerInventory.collectedEchoes.has(lostEcho.key)) {
      playerInventory.collectedEchoes.delete(lostEcho.key);
      if (hud && typeof hud.showNotification === 'function') {
        const lore = lostEcho.lore ? ` — ${lostEcho.lore}` : '';
        hud.showNotification(`Lost Echo: ${lostEcho.key}${lore}`, '#ff8844');
      }
    } else {
      // Phase 10.3: no Echoes to lose — apply the 25-energy penalty
      // by reducing the respawn energy.
      respawnEnergy = Math.max(0, MINIMUM_RESPAWN_ENERGY - FALLBACK_ENERGY_PENALTY);
      if (hud && typeof hud.showNotification === 'function') {
        hud.showNotification(`Phase Collapse — energy penalty ${FALLBACK_ENERGY_PENALTY}`, '#ffaa66');
      }
    }
    if (phaseManager && typeof phaseManager.setEnergy === 'function') {
      phaseManager.setEnergy(respawnEnergy);
    } else if (phaseManager && typeof phaseManager.consumeEnergy === 'function') {
      const cur = phaseManager.getEnergy();
      const delta = cur - respawnEnergy;
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

// Phase 8.2: tickInvulnPerFrame(dt) — advance the post-collapse
// invuln timer. The timer ticks down per frame; while active,
// the player can't trigger another collapse (the invuln check
// is inside forcePhaseCollapse). The HUD shows the remaining
// seconds via hud.setCollapseInvuln.
function tickInvulnPerFrame(dt) {
  if (!invulnState || !invulnState.active) {
    if (hud && typeof hud.setCollapseInvuln === 'function') {
      hud.setCollapseInvuln(0);
    }
    return;
  }
  invulnState = tickInvuln(invulnState, dt);
  if (hud && typeof hud.setCollapseInvuln === 'function') {
    hud.setCollapseInvuln(invulnState.remaining);
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
      // Phase 10.13: charge-up flow. The hook returns the state of
      // the charge after the press; if the hook is called with no
      // active charge it starts one (the test can call commitNow()
      // to advance to the committing phase + debit the cost).
      const pressResult = performResonance(p);
      // If we're now charging, immediately commit so the test sees
      // the same final state as the legacy one-shot pulse. This
      // keeps the Playwright suite green while the §10.13 flow
      // (preview → commit → cancel) runs in real play.
      if (pressResult && pressResult.reason === 'started' && isCharging(resonanceChargeState)) {
        commitCharge(resonanceChargeState);
        const commitResult = commitResonanceSwap();
        const energyAfter = phaseManager.getEnergy();
        return {
          radius,
          phase: currentPhase,
          count: commitResult.swapped,
          results: resonateResults(p.x, p.y, p.z, radius, currentPhase, world),
          energyBefore,
          energyAfter,
          energyDebited: commitResult.ok,
          chargeState: 'committed',
        };
      }
      // Idle → insufficient → cancelled edge cases.
      const energyAfter = phaseManager.getEnergy();
      return {
        radius,
        phase: currentPhase,
        count: 0,
        results: [],
        energyBefore,
        energyAfter,
        energyDebited: false,
        chargeState: pressResult ? pressResult.reason : 'noop',
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
    // Phase 10.13: §10.13 charge-up debug hooks. The Playwright test
    // uses these to introspect the charge state machine + force the
    // transition edges without needing a 0.5s real-time wait.
    // Phase 10.12: phase-shift preview debug hooks. The Playwright
    // test uses these to introspect the preview state machine +
    // force the transition edges without needing a real-time wait.
    phaseShiftPreview: {
      getProgress() {
        if (!phaseManager) return 0;
        return phaseManager.getPhaseShiftProgress
          ? phaseManager.getPhaseShiftProgress()
          : 0;
      },
      getPreviewAmount() {
        if (!phaseManager || !phaseManager._isShifting) return 0;
        const p = phaseManager.getPhaseShiftProgress
          ? phaseManager.getPhaseShiftProgress()
          : 0;
        return previewAmount(p);
      },
      getTargetPhase() {
        if (!phaseManager) return 0;
        return phaseManager.getTargetPhase
          ? phaseManager.getTargetPhase()
          : phaseManager.getCurrentPhase();
      },
      isRunning() {
        if (!phaseManager) return false;
        return shouldRunPreview(
          phaseManager.getPhaseShiftProgress
            ? phaseManager.getPhaseShiftProgress()
            : 0,
        );
      },
      forcePreviewForTest(progress) {
        // Directly drive the preview pass for visual regression
        // tests that don't want to wait for a real phase shift.
        if (!postProcessing || typeof postProcessing.updatePhaseShiftPreview !== 'function') {
          return null;
        }
        const p = (Number.isFinite(progress) && progress >= 0 && progress <= 1)
          ? progress
          : 0;
        const targetPhase = phaseManager.getTargetPhase
          ? phaseManager.getTargetPhase()
          : phaseManager.getCurrentPhase();
        const amount = previewAmount(p);
        const color = previewColor(targetPhase);
        postProcessing.updatePhaseShiftPreview(amount, color);
        return { progress: p, amount, color };
      },
    },
    resonanceCharge: {
      getState() {
        return {
          state: resonanceChargeState.state,
          elapsed: resonanceChargeState.elapsed,
          centerX: resonanceChargeState.centerX,
          centerY: resonanceChargeState.centerY,
          centerZ: resonanceChargeState.centerZ,
          currentPhase: resonanceChargeState.currentPhase,
          pendingCommit: resonanceChargeState.pendingCommit,
        };
      },
      isActive() {
        return isChargeActive(resonanceChargeState);
      },
      isCharging() {
        return isCharging(resonanceChargeState);
      },
      isCommitting() {
        return isCommitting(resonanceChargeState);
      },
      cancel() {
        cancelCharge(resonanceChargeState);
        if (renderer && typeof renderer.clearResonancePulse === 'function') {
          renderer.clearResonancePulse();
        }
        resonancePulseActive = false;
        return { ok: true };
      },
      commitNow() {
        // Manually commit the current charge (for tests that want
        // to skip the 0.5s wait).
        if (!isCharging(resonanceChargeState)) return { ok: false, reason: 'not-charging' };
        commitCharge(resonanceChargeState);
        const result = commitResonanceSwap();
        return { ok: true, ...result };
      },
      tickForTest(deltaTime) {
        return tickResonanceChargePerFrame(deltaTime);
      },
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
      // Phase 8.2: during the post-collapse invuln window, skip
      // the collapse trigger entirely. The player can't re-collapse
      // immediately; the timer must expire first.
      if (isInvulnActive(invulnState)) {
        return { ok: false, reason: 'post-collapse-invuln', phase };
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
      // Phase 10.3: pick a random Echo to lose from the player's
      // inventory. The pick is a "loss preview" — the actual removal
      // happens on the `result.done` branch in tickCollapsePerFrame
      // so the lore toast can fire consistently with the new flow.
      const lostEcho = pickRandomEchoToLose();
      startCollapse(collapseState, COLLAPSE_REASONS.FORCED, target, target ? target.source : null, lostEcho);
      inputSuppressed = true;
      collapseNotifyPending = true;
      fallbackWarnedForCurrentCollapse = false;
      collapseWasCollapsingLastFrame = false;
      // Phase 8.2: start the post-collapse invuln window. The
      // timer ticks down per frame in the game loop; while active,
      // setEnergy(0) and consumeEnergy() are no-ops so the player
      // can't immediately re-collapse.
      invulnState = startInvuln(invulnState);
      return { ok: true, phase, energy: phaseManager.getEnergy(), target };
    },
    // Phase 8.1: skip the tutorial. Returns the same shape as
    // clearTutorialAndHidePure.
    skipTutorial() {
      if (!tutorialState) return { ok: false, reason: 'no-state' };
      const result = clearTutorialAndHidePure(tutorialState);
      if (result.ok) {
        tutorialState = clearTutorialPure(tutorialState);
        wasInTutorialRing = false;
        if (hud && typeof hud.clearTutorialHint === 'function') {
          hud.clearTutorialHint();
        }
        if (hud && typeof hud.setTutorialSkipVisible === 'function') {
          hud.setTutorialSkipVisible(false);
        }
        if (hud && typeof hud.showNotification === 'function') {
          hud.showNotification('Tutorial skipped', '#88ccff');
        }
      }
      return result;
    },
    // Phase 8.2: get the post-collapse invuln remaining (seconds).
    getCollapseInvulnRemaining() {
      return getInvulnRemaining(invulnState);
    },
    // Phase 8.2: whether the post-collapse invuln window is active.
    isCollapseInvulnActive() {
      return isInvulnActive(invulnState);
    },
    // Phase 8.3: force the audio context restart path. Calls
    // startAmbientMusic(phase) — the same path the visibilitychange
    // handler uses.
    forceAudioRestart() {
      if (!audioManager || typeof audioManager.startAmbientMusic !== 'function') {
        return { ok: false, reason: 'no-audio-manager' };
      }
      const p = (phaseManager && typeof phaseManager.getCurrentPhase === 'function')
        ? phaseManager.getCurrentPhase()
        : 0;
      try {
        audioManager.startAmbientMusic(p);
        return { ok: true, phase: p };
      } catch (e) {
        return { ok: false, reason: 'audio-error', error: e.message };
      }
    },
    // Phase 9.2: force a deferred audio resume (the same path the
    // pointerlockchange handler uses). Returns the AudioContext
    // state after the deferred resume. The test harness uses this
    // to verify the §9.2 acceptance: the resume fires on the next
    // event-loop tick and the AudioContext is in 'running' (or
    // 'resuming') state after the call.
    forceAudioResume() {
      if (!audioManager) return { ok: false, reason: 'no-audio-manager' };
      let state = 'none';
      const runner = () => {
        if (typeof audioManager.safeResume === 'function') {
          state = audioManager.safeResume();
        } else if (typeof audioManager.resume === 'function') {
          audioManager.resume();
          state = (audioManager.ctx && audioManager.ctx.state) || 'unknown';
        } else {
          state = 'no-resume-method';
        }
      };
      try {
        setTimeout(runner, 0);
      } catch (e) {
        return { ok: false, reason: 'setTimeout-failed', error: e.message };
      }
      return { ok: true, state, deferred: true };
    },
    // Phase 9.2: synchronously poll the audio context state. The
    // headless test infra uses this to assert the §9.2 acceptance:
    // after the deferred resume, the context is in 'running' or
    // 'resuming' state. Returns the state string (or 'none' if
    // no context exists).
    getAudioContextState() {
      if (!audioManager || !audioManager.ctx) return 'none';
      try {
        return audioManager.ctx.state;
      } catch (e) {
        return 'error';
      }
    },
    // Phase 9.2: test hook for the pointer-lock audio fallback.
    // The Playwright test calls this to verify the first-input
    // listener is installed and re-attempts the resume on the
    // very next keystroke. The hook returns the fallback state
    // (installed / cleared) so the test can assert both ends.
    getPointerLockAudioFallbackState() {
      return {
        installed: pointerLockAudioFallbackHandler !== null,
        timerActive: pointerLockAudioFallbackTimer !== null,
      };
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
      // Phase 8.2: during the post-collapse invuln window, skip
      // the collapse trigger entirely. The player can't re-collapse
      // immediately; the timer must expire first.
      if (isInvulnActive(invulnState)) {
        return { ok: false, reason: 'post-collapse-invuln', phase };
      }
      if (phaseManager.setEnergy) {
        phaseManager.setEnergy(0);
      } else if (phaseManager.consumeEnergy) {
        phaseManager.consumeEnergy(phaseManager.getEnergy());
      }
      if (audioManager && typeof audioManager.playCollapse === 'function') {
        audioManager.playCollapse();
      }
      invulnState = startInvuln(invulnState);
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
      const base = PHASE_SHIFT_COST; // Phase 10.1: rebalanced from 5 to 15
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
    // Phase 5.1: buildGoalState() debug hook — returns the current
    // goal state snapshot (echoes + amplifiers + Nexus visited +
    // stabilizer count) so the HUD can render the objective.
    buildGoalState() {
      return buildGoalStatePure(playerInventory, world, { phaseNexus: false });
    },
    // Phase 5.1: getCurrentAct debug hook.
    getCurrentAct() {
      return currentActPure(buildGoalStatePure(playerInventory, world, { phaseNexus: false }));
    },
    // Phase 5.1: listStabilizers debug hook (returns x,y,z keys).
    listStabilizers() {
      return world && typeof world.exportStabilizers === 'function' ? world.exportStabilizers() : [];
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
    },
    // Phase 10.14: New Game+ debug hooks.
    newGamePlus: {
      get seed() { return newGamePlusState ? newGamePlusState.phaseDominanceSeed : 0; },
      get ironman() { return newGamePlusState ? newGamePlusState.ironman : false; },
      get permutation() { return world && world.getPhaseDominancePermutation ? world.getPhaseDominancePermutation(currentBiomeId) : [0, 1, 2]; },
      get isShuffled() { return newGamePlusState ? isShuffled(newGamePlusState.phaseDominanceSeed, currentBiomeId) : false; },
      setSeed(seed) {
        if (newGamePlusState) newGamePlusState.phaseDominanceSeed = Math.floor(seed);
        if (world && world.setPhaseDominanceSeed) world.setPhaseDominanceSeed(seed);
        return newGamePlusState ? newGamePlusState.phaseDominanceSeed : 0;
      },
      setIronman(enabled) {
        if (newGamePlusState) newGamePlusState.ironman = Boolean(enabled);
        return newGamePlusState ? newGamePlusState.ironman : false;
      },
      forceStartNewGamePlus() {
        const btn = document.getElementById('btn-newgameplus');
        if (btn) btn.click();
        return true;
      },
    },
    // Phase 10.10: Echo Hunter panel debug hooks.
    echoHunter: {
      getSummary() { return buildEchoHunterSummary(); },
      openPanel() {
        if (hud && typeof hud.showEchoHunter === 'function') {
          hud.showEchoHunter(buildEchoHunterSummary(), (b) => biomeLabel(b));
        }
        return true;
      },
      closePanel() {
        if (hud && typeof hud.hideEchoHunter === 'function') hud.hideEchoHunter();
        return true;
      },
    },
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
