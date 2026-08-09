#!/usr/bin/env node
/* eslint-disable no-console */
// Phase 2.3 verification: per-phase place/break with RMB disambiguation.
//
//   1) Static-analysis — the pieces exist:
//        - main.js imports placeBlock from ./src/input/placeBlock.js
//        - src/input/placeBlock.js exports placeBlock(hit, blockId, context)
//          with the three refusal paths (no-hit, target-not-air,
//          overlaps-player) and a world.setBlock write through the
//          current phase
//        - main.js contextmenu handler does the disambiguation:
//          placeBlock hit-or-no-hit → cycle phase fallback
//        - main.js placeAnchor is stubbed (no BLOCK_15 stray write)
//        - main.js spawnPlaceParticles mirrors spawnBreakParticles
//        - main.js exposes __phaseShifter__.placeBlock debug hook
//        - main.js contextmenu handler still calls preventDefault +
//          cyclePhase (Phase 2.1 regression lock)
//   2) Behavior — placeBlock(hit, blockId, context) on a tiny fixture:
//        - null hit → { ok: false, reason: 'no-hit' }
//        - air target → ok: true, writes to world.setBlock with current
//          phase + correct coordinates
//        - non-air target → { ok: false, reason: 'target-not-air' },
//          world state untouched
//        - player-AABB-overlap target → { ok: false, reason:
//          'overlaps-player' }, world state untouched
//        - per-phase: placeBlock writes only to the current phase;
//          other phases retain their existing block id
//   3) Behavior — world.setBlock persistence through chunk unload/reload
//      (§2.4 acceptance — break/place survives chunk reload):
//        - Place a Stone block via world.setBlock in Alpha
//        - chunks.delete(<chunk key>)
//        - Call loadChunk(<chunk>) again
//        - The cell is still Stone in Alpha; still air in Beta + Gamma
//
// Static checks are against source files (not the Vite-minified bundle).
// Same pattern as Phases 1.2–2.2.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mainPath = path.join(ROOT, 'main.js');
const worldPath = path.join(ROOT, 'src', 'core', 'world.js');
const placeBlockPath = path.join(ROOT, 'src', 'input', 'placeBlock.js');
const constantsPath = path.join(ROOT, 'src', 'core', 'constants.js');

const mainText = fs.readFileSync(mainPath, 'utf8');
const worldText = fs.readFileSync(worldPath, 'utf8');
const placeBlockText = fs.readFileSync(placeBlockPath, 'utf8');
const constantsText = fs.readFileSync(constantsPath, 'utf8');

const results = [];
function check(label, ok, extra = '') {
  results.push(!!ok);
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  console.log('=== Phase 2.3 source checks ===');

  // placeBlock is extracted to its own module so it's independently
  // testable. The brief says "main.js or a new src/input/placeBlock.js —
  // main.js is fine for now" but we extract because main.js has top-level
  // side effects (init()) and the behavioral test runs without a
  // browser. main.js still imports it.
  check(
    'src/input/placeBlock.js exports placeBlock',
    /export\s+function\s+placeBlock\s*\(/.test(placeBlockText)
  );
  check(
    'src/input/placeBlock.js exports playerAABBOverlapsCell',
    /export\s+function\s+playerAABBOverlapsCell\s*\(/.test(placeBlockText)
  );
  check(
    'main.js imports placeBlock from ./src/input/placeBlock.js',
    /import\s*\{[^}]*placeBlock[^}]*\}\s*from\s*['"]\.\/src\/input\/placeBlock\.js['"]/.test(mainText)
  );

  // placeBlock signature: (hit, blockId, context). The context bundles
  // world + phaseManager + physicsManager so the helper is testable
  // without Three.js or globals.
  check(
    'placeBlock signature is (hit, blockId, context)',
    /export\s+function\s+placeBlock\s*\(\s*hit\s*,\s*blockId\s*,\s*context\s*\)/.test(placeBlockText)
  );

  // placeBlock must check the current phase via phaseManager.getCurrentPhase().
  check(
    'placeBlock reads current phase via phaseManager.getCurrentPhase()',
    /phaseManager\.getCurrentPhase\s*\(/.test(placeBlockText)
  );

  // placeBlock must write through world.setBlock(...).
  check(
    'placeBlock writes via world.setBlock(targetX, targetY, targetZ, phase, blockId)',
    /world\.setBlock\s*\(\s*targetX\s*,\s*targetY\s*,\s*targetZ\s*,\s*phase\s*,\s*blockId\s*\)/.test(placeBlockText)
  );

  // Refusal paths.
  check(
    'placeBlock refuses with reason: no-hit',
    /reason:\s*['"]no-hit['"]/.test(placeBlockText)
  );
  check(
    'placeBlock refuses non-air target cells with reason: target-not-air',
    /existing\s*!==\s*BLOCK_AIR[\s\S]{0,200}?reason:\s*['"]target-not-air['"]/.test(placeBlockText)
  );
  check(
    'placeBlock refuses player AABB overlap with reason: overlaps-player',
    /playerAABBOverlapsCell[\s\S]{0,200}?reason:\s*['"]overlaps-player['"]/.test(placeBlockText)
  );

  // placeBlock must compute the target cell from hit.blockX/Y/Z + hit.face.
  check(
    'placeBlock computes target = hit.block + hit.face',
    /hit\.blockX\s*\+\s*hit\.face\.x/.test(placeBlockText) &&
      /hit\.blockY\s*\+\s*hit\.face\.y/.test(placeBlockText) &&
      /hit\.blockZ\s*\+\s*hit\.face\.z/.test(placeBlockText)
  );

  // Contextmenu handler does the disambiguation.
  check(
    'main.js contextmenu handler calls placeBlock with BLOCK_STONE',
    /addEventListener\(\s*['"]contextmenu['"][\s\S]*?placeBlockAtTarget\s*\([^,]+,\s*BLOCK_STONE/.test(mainText)
  );
  check(
    'main.js contextmenu handler falls back to cyclePhase()',
    /addEventListener\(\s*['"]contextmenu['"][\s\S]*?phaseManager\.cyclePhase\s*\(\s*\)/.test(mainText)
  );
  // Phase 2.1 regression: preventDefault + cyclePhase still wired.
  check(
    'main.js contextmenu handler still calls e.preventDefault() + cyclePhase',
    /addEventListener\(\s*['"]contextmenu['"][\s\S]*?e\.preventDefault\(\)[\s\S]{0,400}?cyclePhase\s*\(\s*\)/.test(mainText)
  );

  // placeAnchor stubbed — no BLOCK_15 (BLOCK_STABILIZER) stray write.
  check(
    'main.js placeAnchor no longer writes BLOCK_STABILIZER (id 15) via placeBlockAt',
    !/placeBlockAt\s*\([^)]*,\s*15\s*\)/.test(mainText)
  );
  check(
    'main.js placeAnchor shows the §2.7 deferred notification',
    /placeAnchor[\s\S]{0,400}?Anchor placement pending §2\.7/.test(mainText)
  );

  // spawnPlaceParticles is defined and mirrors spawnBreakParticles sig.
  check(
    'main.js spawnPlaceParticles is defined',
    /function\s+spawnPlaceParticles\s*\(\s*blockX\s*,\s*blockY\s*,\s*blockZ\s*,\s*blockType\s*\)/.test(mainText)
  );

  // Debug hook exposed.
  check(
    'main.js exposes __phaseShifter__.placeBlock(x, y, z, blockType) hook',
    /__phaseShifter__[\s\S]*?placeBlock\s*\(\s*x\s*,\s*y\s*,\s*z\s*,\s*blockType\s*\)/.test(mainText)
  );

  // Don't break the Phase 2.1 spam guard / Phase 2.2 collision path.
  check(
    'main.js still exposes __phaseShifter__.forceCyclePhase',
    /__phaseShifter__[\s\S]*?forceCyclePhase\s*\(/.test(mainText)
  );
  check(
    'main.js #placeBlockAt (unvalidated write primitive) still routes through world.setBlock',
    /function\s+placeBlockAt\s*\([^)]*\)[\s\S]*?world\.setBlock\s*\(/.test(mainText)
  );

  console.log('\n=== Phase 2.3 placeBlock behavior ===');

  // Import placeBlock from the extracted module — no Three.js, no
  // module-level globals. The test constructs a tiny fixture.
  const { placeBlock } = await import(pathToFileURL(placeBlockPath).href);
  const constants = await import(pathToFileURL(constantsPath).href);
  const {
    PHASE_ALPHA, PHASE_BETA, PHASE_GAMMA,
    BLOCK_AIR, BLOCK_STONE, BLOCK_WOOD, BLOCK_OBSIDIAN,
  } = constants;

  // Minimal world fixture with a per-cell per-phase lookup table.
  // Tracks setBlock calls so we can assert the write path.
  function makeTinyWorld(layout) {
    const writes = []; // { x, y, z, phase, blockId }
    const world = {
      _writes: writes,
      getBlock(x, y, z, phase) {
        const col = layout[x];
        if (!col) return BLOCK_AIR;
        const row = col[y];
        if (!row) return BLOCK_AIR;
        const cell = row[z];
        if (!cell) return BLOCK_AIR;
        return cell[phase] ?? BLOCK_AIR;
      },
      isBlockSolid(x, y, z, phase) {
        const block = this.getBlock(x, y, z, phase);
        if (block === BLOCK_AIR) return false;
        const props = constants.BLOCK_PROPERTIES[block];
        if (!props) return false;
        if (props.phaseSolid) return !!props.phaseSolid[phase];
        return !!props.solid;
      },
      setBlock(x, y, z, phase, blockId) {
        writes.push({ x, y, z, phase, blockId });
      },
      updateChunks() {},
    };
    return world;
  }

  // Stub PhaseManager — only getCurrentPhase() is read by placeBlock.
  function makeStubPhaseManager(initial = PHASE_ALPHA) {
    return { _phase: initial, getCurrentPhase() { return this._phase; } };
  }

  // Stub PhysicsManager — only getPos() is read by placeBlock.
  function makeStubPhysicsManager(x = 0, y = 2, z = 0) {
    return { _pos: { x, y, z }, getPos() { return this._pos; } };
  }

  // World with Stone at (0, 0, 0) in Alpha + Beta, air in Gamma. Player
  // is positioned 5 blocks away so the AABB doesn't overlap the target.
  const stoneWorld = makeTinyWorld({
    0: { 0: { 0: { [PHASE_ALPHA]: BLOCK_STONE, [PHASE_BETA]: BLOCK_STONE } } },
  });

  // 1. null hit → no-hit refusal. No writes.
  const r1 = placeBlock(null, BLOCK_STONE, {
    world: stoneWorld,
    phaseManager: makeStubPhaseManager(PHASE_ALPHA),
    physicsManager: makeStubPhysicsManager(10, 10, 10),
  });
  check(
    'placeBlock(null) returns ok: false, reason: no-hit',
    r1.ok === false && r1.reason === 'no-hit'
  );
  check(
    'placeBlock(null) does not write to world',
    stoneWorld._writes.length === 0
  );

  // 2. Air target → success. Writes Stone at the target cell.
  const r2 = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 1, y: 0, z: 0 } },
    BLOCK_STONE,
    {
      world: stoneWorld,
      phaseManager: makeStubPhaseManager(PHASE_ALPHA),
      physicsManager: makeStubPhysicsManager(10, 10, 10),
    }
  );
  check(
    'placeBlock on air target (right face) returns ok: true',
    r2.ok === true
  );
  check(
    'placeBlock writes targetX = hit.blockX + face.x',
    r2.x === 1 && stoneWorld._writes[0]?.x === 1
  );
  check(
    'placeBlock writes targetY = hit.blockY + face.y',
    r2.y === 0 && stoneWorld._writes[0]?.y === 0
  );
  check(
    'placeBlock writes targetZ = hit.blockZ + face.z',
    r2.z === 0 && stoneWorld._writes[0]?.z === 0
  );
  check(
    'placeBlock writes the current phase (Alpha)',
    r2.phase === PHASE_ALPHA && stoneWorld._writes[0]?.phase === PHASE_ALPHA
  );
  check(
    'placeBlock writes the requested blockId (BLOCK_STONE)',
    stoneWorld._writes[0]?.blockId === BLOCK_STONE
  );

  // 3. Per-phase: placeBlock only writes to the current phase. Switch
  // to Beta and place on the opposite face. The Beta write should be at
  // (-1, 0, 0), not at (1, 0, 0) where we wrote in Alpha.
  const stoneWorld2 = makeTinyWorld({
    0: { 0: { 0: { [PHASE_ALPHA]: BLOCK_STONE, [PHASE_BETA]: BLOCK_STONE } } },
  });
  const r3 = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: -1, y: 0, z: 0 } },
    BLOCK_WOOD,
    {
      world: stoneWorld2,
      phaseManager: makeStubPhaseManager(PHASE_BETA),
      physicsManager: makeStubPhysicsManager(10, 10, 10),
    }
  );
  check(
    'placeBlock on Beta writes (-1, 0, 0) with phase Beta',
    r3.ok === true &&
      r3.x === -1 && r3.y === 0 && r3.z === 0 &&
      r3.phase === PHASE_BETA &&
      stoneWorld2._writes[0]?.x === -1 &&
      stoneWorld2._writes[0]?.phase === PHASE_BETA &&
      stoneWorld2._writes[0]?.blockId === BLOCK_WOOD
  );

  // 4. Non-air target → refusal. Stone at (1, 0, 0) in Alpha. Player
  // tries to place Stone on the +X face of (0, 0, 0), which is (1, 0, 0)
  // — already non-air. Refuse.
  const busyWorld = makeTinyWorld({
    0: { 0: { 0: { [PHASE_ALPHA]: BLOCK_STONE } } },
    1: { 0: { 0: { [PHASE_ALPHA]: BLOCK_STONE } } },
  });
  const busyWrites = busyWorld._writes.length;
  const r4 = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 1, y: 0, z: 0 } },
    BLOCK_STONE,
    {
      world: busyWorld,
      phaseManager: makeStubPhaseManager(PHASE_ALPHA),
      physicsManager: makeStubPhysicsManager(10, 10, 10),
    }
  );
  check(
    'placeBlock on non-air target returns ok: false, reason: target-not-air',
    r4.ok === false && r4.reason === 'target-not-air'
  );
  check(
    'placeBlock on non-air target does not write to world',
    busyWorld._writes.length === busyWrites
  );

  // 5. Player AABB overlap → refusal. Place Stone at (0, 0, 0) — player's
  // AABB is feet at y=2-1.7=0.3, top at y=2, x ±0.3, z ±0.3. The cell
  // (0, 0, 0) spans x=[0,1], y=[0,1], z=[0,1]. Player AABB: x=[-0.3,
  // 0.3], y=[0.3, 2], z=[-0.3, 0.3]. The cells overlap in x (0 < 0.3),
  // y (0.3 < 1), z (0 < 0.3). So AABB overlaps cell.
  const overlapWorld = makeTinyWorld({});
  const r5 = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 0, y: 0, z: 0 } },
    BLOCK_STONE,
    {
      world: overlapWorld,
      phaseManager: makeStubPhaseManager(PHASE_ALPHA),
      // Player at (0, 2, 0). Feet y = 2 - 1.7 = 0.3. AABB:
      //   x: [-0.3, 0.3], y: [0.3, 2], z: [-0.3, 0.3]
      // Target cell (0, 0, 0): x: [0, 1], y: [0, 1], z: [0, 1]
      // Overlap in x (0 < 0.3), y (0.3 < 1), z (0 < 0.3) → overlap.
      physicsManager: makeStubPhysicsManager(0, 2, 0),
    }
  );
  check(
    'placeBlock on player-AABB-overlap target returns ok: false, reason: overlaps-player',
    r5.ok === false && r5.reason === 'overlaps-player'
  );
  check(
    'placeBlock on player-AABB-overlap does not write to world',
    overlapWorld._writes.length === 0
  );

  // 6. Player AABB does NOT overlap when standing on top of the target
  // cell. Player at (0.5, 2.7, 0.5) — feet y = 1.0, top y = 2.7. AABB
  // just above cell (0, 0, 0). Player is also above the target cell
  // (already standing on it). The target cell is (1, 0, 0) — placing
  // Stone on the +X face of (0, 0, 0).
  const r6 = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 1, y: 0, z: 0 } },
    BLOCK_STONE,
    {
      world: makeTinyWorld({ 0: { 0: { 0: { [PHASE_ALPHA]: BLOCK_STONE } } } }),
      phaseManager: makeStubPhaseManager(PHASE_ALPHA),
      // Player at (0.5, 2.7, 0.5). Feet y = 2.7 - 1.7 = 1.0. AABB:
      //   x: [0.2, 0.8], y: [1.0, 2.7], z: [0.2, 0.8]
      // Target cell (1, 0, 0): x: [1, 2], y: [0, 1], z: [0, 1]
      // No overlap (x: 0.8 < 1, y: 1.0 = 1.0 boundary, z: 0.8 < 1).
      // Should succeed.
      physicsManager: makeStubPhysicsManager(0.5, 2.7, 0.5),
    }
  );
  check(
    'placeBlock on adjacent face (no overlap) succeeds',
    r6.ok === true && r6.x === 1 && r6.y === 0 && r6.z === 0
  );

  // 7. Phase-aware: target cell is air in Alpha but Stone in Beta. Place
  // in Alpha — should succeed. Place in Beta — should refuse.
  const mixedWorld = makeTinyWorld({
    0: {
      0: {
        0: { [PHASE_ALPHA]: BLOCK_STONE, [PHASE_BETA]: BLOCK_STONE },
        1: { [PHASE_BETA]: BLOCK_STONE },
      },
    },
  });
  const r7a = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 0, y: 0, z: 1 } },
    BLOCK_STONE,
    {
      world: mixedWorld,
      phaseManager: makeStubPhaseManager(PHASE_ALPHA),
      physicsManager: makeStubPhysicsManager(10, 10, 10),
    }
  );
  check(
    'placeBlock in Alpha: target air in Alpha → ok: true',
    r7a.ok === true
  );
  const r7b = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 0, y: 0, z: 1 } },
    BLOCK_STONE,
    {
      world: mixedWorld,
      phaseManager: makeStubPhaseManager(PHASE_BETA),
      physicsManager: makeStubPhysicsManager(10, 10, 10),
    }
  );
  check(
    'placeBlock in Beta: target Stone in Beta → ok: false, reason: target-not-air',
    r7b.ok === false && r7b.reason === 'target-not-air'
  );

  // 8. Obsidian (Gamma-only solid) places in Gamma via the §2.3 contract.
  // Obsidian is solid in Gamma only, so the play should proceed.
  const obsidianWorld = makeTinyWorld({});
  const r8 = placeBlock(
    { blockX: 0, blockY: 0, blockZ: 0, face: { x: 0, y: 0, z: 0 } },
    BLOCK_OBSIDIAN,
    {
      world: obsidianWorld,
      phaseManager: makeStubPhaseManager(PHASE_GAMMA),
      physicsManager: makeStubPhysicsManager(10, 10, 10),
    }
  );
  check(
    'placeBlock of Obsidian in Gamma (player not in cell) succeeds',
    r8.ok === true && r8.phase === PHASE_GAMMA && obsidianWorld._writes[0]?.blockId === BLOCK_OBSIDIAN
  );

  console.log('\n=== Phase 2.3 / 2.4 chunk unload + reload persistence ===');

  // The §2.4 acceptance: "break a block, walk far enough to unload the
  // chunk, walk back — the block is still broken." World.setBlock
  // writes to _globalStateMap; loadChunk reads it back and applies it
  // on top of the generated chunk data. We exercise that contract here.
  const { World } = await import(pathToFileURL(worldPath).href);

  let updates = 0;
  const scene = { add() {}, remove() {} };
  const onChunkUpdated = () => { updates++; };
  const realWorld = new World(scene, onChunkUpdated);

  // Load the origin chunk manually so we don't depend on the global
  // §2.4 unload-distance math.
  realWorld.ensureChunk(0, 0);
  // Pick a cell that the generator already populates so we can see the
  // pre-state (Alpha). (0, 5, 0) is mid-air in most biomes — find one
  // the generator doesn't fill, then place Stone there.
  const px = 2, py = 30, pz = 2;
  const phasePlace = PHASE_ALPHA;
  const alphaBefore = realWorld.getBlock(px, py, pz, phasePlace);
  // Place Stone at (px, py, pz) in Alpha.
  realWorld.setBlock(px, py, pz, phasePlace, BLOCK_STONE);
  const alphaAfter = realWorld.getBlock(px, py, pz, phasePlace);
  check(
    'setBlock writes Stone at (px, py, pz) in Alpha',
    alphaAfter === BLOCK_STONE,
    `before=${alphaBefore} after=${alphaAfter}`
  );

  // Now unload the chunk and reload it.
  const chunkKey = `${0},${0}`;
  realWorld.chunks.delete(chunkKey);
  check(
    'chunks.delete(chunkKey) removed the chunk',
    !realWorld.chunks.has(chunkKey)
  );

  // loadChunk runs as part of ensureChunk. We call it directly to
  // exercise the persistence path.
  const reloaded = realWorld.ensureChunk(0, 0);
  check(
    'ensureChunk reloads the chunk',
    reloaded.loaded === true && realWorld.chunks.has(chunkKey)
  );

  // The cell should still be Stone in Alpha after reload.
  const alphaReloaded = realWorld.getBlock(px, py, pz, phasePlace);
  check(
    'chunk reload preserves Stone in Alpha (block survives reload)',
    alphaReloaded === BLOCK_STONE,
    `reloaded=${alphaReloaded}`
  );

  // Beta + Gamma should still be their generated value (BLOCK_AIR
  // because the generator doesn't fill mid-air cells at this y).
  const betaReloaded = realWorld.getBlock(px, py, pz, PHASE_BETA);
  const gammaReloaded = realWorld.getBlock(px, py, pz, PHASE_GAMMA);
  check(
    'chunk reload preserves Beta state (not affected by Alpha edit)',
    betaReloaded === BLOCK_AIR || betaReloaded !== BLOCK_STONE,
    `betaReloaded=${betaReloaded}`
  );
  check(
    'chunk reload preserves Gamma state (not affected by Alpha edit)',
    gammaReloaded === BLOCK_AIR || gammaReloaded !== BLOCK_STONE,
    `gammaReloaded=${gammaReloaded}`
  );

  // Global state map is the single source of truth (Phase 1.7 + 2.4).
  check(
    'global state map records the placed block',
    realWorld.getGlobalBlock(px, py, pz, phasePlace) === BLOCK_STONE
  );

  // Symmetric case: place Stone in Beta and confirm Alpha stays untouched.
  realWorld.setBlock(px, py, pz + 1, PHASE_BETA, BLOCK_STONE);
  realWorld.chunks.delete(chunkKey);
  realWorld.ensureChunk(0, 0);
  check(
    'chunks.delete + reload: Beta Stone survives',
    realWorld.getBlock(px, py, pz + 1, PHASE_BETA) === BLOCK_STONE
  );
  check(
    'chunks.delete + reload: Alpha at (px, py, pz+1) is air or generated, not Stone',
    realWorld.getBlock(px, py, pz + 1, PHASE_ALPHA) !== BLOCK_STONE
  );

  // §2.4 inverse: place Stone in Alpha, then break it (write BLOCK_AIR).
  // Phase 1.7's exportGlobalState + _globalStateMap contract: the
  // break should also persist.
  realWorld.setBlock(px, py, pz, PHASE_ALPHA, BLOCK_AIR);
  realWorld.chunks.delete(chunkKey);
  realWorld.ensureChunk(0, 0);
  check(
    'chunk reload preserves the break (Alpha cell is air)',
    realWorld.getBlock(px, py, pz, PHASE_ALPHA) === BLOCK_AIR
  );
  check(
    'global state map records BLOCK_AIR at (px, py, pz, Alpha)',
    realWorld.getGlobalBlock(px, py, pz, PHASE_ALPHA) === BLOCK_AIR
  );

  console.log('\n=== Phase 2.3 placeBlock signature / refusal taxonomy ===');

  // Verify the full refusal taxonomy and the success path return shape.
  const taxonomyWorld = makeTinyWorld({});
  const taxonomyPhys = makeStubPhysicsManager(10, 10, 10);
  const taxonomyPm = makeStubPhaseManager(PHASE_ALPHA);

  // null hit
  const t_null = placeBlock(null, BLOCK_STONE, {
    world: taxonomyWorld, phaseManager: taxonomyPm, physicsManager: taxonomyPhys,
  });
  check('taxonomy: null hit → no-hit', t_null.ok === false && t_null.reason === 'no-hit');

  // missing context
  const t_nocontext = placeBlock({ blockX: 0, blockY: 0, blockZ: 0, face: { x: 1, y: 0, z: 0 } }, BLOCK_STONE, null);
  check('taxonomy: missing context → missing-context', t_nocontext.ok === false && t_nocontext.reason === 'missing-context');

  // success path returns { ok, x, y, z, phase }
  const t_ok = placeBlock({ blockX: 0, blockY: 0, blockZ: 0, face: { x: 1, y: 0, z: 0 } }, BLOCK_STONE, {
    world: makeTinyWorld({}), phaseManager: taxonomyPm, physicsManager: taxonomyPhys,
  });
  check('taxonomy: success returns { ok: true, x, y, z, phase }',
    t_ok.ok === true && typeof t_ok.x === 'number' && typeof t_ok.y === 'number' &&
    typeof t_ok.z === 'number' && typeof t_ok.phase === 'number');

  const passed = results.filter(Boolean).length;
  console.log(`\n=== Phase 2.3 TOTAL: ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(err => {
  console.error('TEST FAILED:', err.stack || err.message);
  process.exit(1);
});
