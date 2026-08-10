// HUD rendering (DOM-based, minimal overlay)
import { biomeLabel as biomeLabelFromId } from '../world/biome.js';

export class HUD {
  constructor(container) {
    this.container = container;
    this.minVisible = true;
    this.cameraYaw = 0;
    this._notifTimer = null;
    this._lastPhase = -1;
    this._phaseJustShifted = false;
    this._shiftDirection = 0;
    this._blockHintThrottle = 0;
    // Phase 3.1: per-frame biome tracking. The DOM element is
    // pre-existing in index.html (the `#biome-info` div at line
    // 136). The text is updated ONLY on the change edge
    // (`_lastBiomeId !== newBiomeId`) — not every frame — to
    // avoid unnecessary DOM writes (the §3.1 brief's "edge
    // detector" pitfall).
    this._lastBiomeId = -1;
    this._biomeInfoEl = (typeof document !== 'undefined')
      ? document.querySelector('#biome-info')
      : null;
    // Phase 3.3: echo counter + lore toast. Both elements live in
    // index.html; the HUD just queries them here so the per-frame
    // update is a one-line DOM write.
    this._echoCounterEl = (typeof document !== 'undefined')
      ? document.querySelector('#echo-counter')
      : null;
    this._loreToastEl = (typeof document !== 'undefined')
      ? document.querySelector('#lore-toast')
      : null;
    this._loreToastTimer = null;
    // Phase 3.4: amplifier status panel (AB / BG / AG indicators).
    this._ampStatusEl = (typeof document !== 'undefined')
      ? document.querySelector('#amplifier-status')
      : null;
    this._lastAmpString = null;
    // Phase 3.6: tutorial hint element (bottom-of-screen
    // 8-second-rotating hint walkthrough). Element lives in
    // index.html; HUD just queries it here so the per-hint
    // update is a one-line DOM write.
    this._tutorialHintEl = (typeof document !== 'undefined')
      ? document.querySelector('#tutorial-hint')
      : null;
    this._tutorialHintTimer = null;
    this._lastTutorialHintText = null;
    this._createElements();
  }

  _createElements() {
    // Only create elements that don't exist in the HTML
    // Don't wipe existing HTML - work with what's already there
    this.container.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 10;
      font-family: 'Courier New', monospace;
    `;

    // Create elements that don't exist in the HTML

    // Minimap (top-right) - canvas needed for drawing
    const minimap = document.createElement('canvas');
    minimap.id = 'minimap';
    minimap.style.cssText = `
      position: absolute; top: 20px; right: 20px;
      width: 150px; height: 150px;
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      display: block;
    `;
    this.container.appendChild(minimap);

    // Objective waypoint (top-center)
    const objective = document.createElement('div');
    objective.id = 'objective';
    objective.style.cssText = `
      position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
      color: rgba(255,255,255,0.9); font-size: 16px; letter-spacing: 0.15em;
      text-shadow: 0 0 10px currentColor;
      display: none;
    `;
    this.container.appendChild(objective);

    // Energy arc (around crosshair)
    const energyContainer = document.createElement('div');
    energyContainer.id = 'energy-container';
    energyContainer.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 30px; height: 30px; pointer-events: none;
    `;
    this.container.appendChild(energyContainer);

    // Fatigue warning
    const fatigueWarning = document.createElement('div');
    fatigueWarning.id = 'fatigue-warning';
    fatigueWarning.style.cssText = `
      position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
      color: #ff4444; font-size: 12px; opacity: 0;
    `;
    this.container.appendChild(fatigueWarning);
  }

  update(phaseManager, physicsManager, world) {
    const phase = phaseManager.getCurrentPhase();
    const energy = phaseManager.getEnergy();
    const maxEnergy = phaseManager.getMaxEnergy();

    // Phase 3.1: update the #biome-info text on biome change. The
    // biome id comes from `world.getBiome(playerPos.x, playerPos.z)`
    // (the deterministic per-region assignment in src/core/world.js).
    // The text is updated ONLY on the change edge
    // (`_lastBiomeId !== newBiomeId`) — the per-frame biome read
    // happens elsewhere (in the game loop's per-frame biome tick),
    // and the HUD only owns the DOM text. The label is
    // "BIOME: <label>" (the §3.1 brief's contract). Defensive:
    // when `world` is null or the player is mid-init, no text
    // change fires (the previous label stays).
    if (world && typeof world.getBiome === 'function' && this._biomeInfoEl) {
      const p = (physicsManager && typeof physicsManager.getPos === 'function')
        ? physicsManager.getPos()
        : null;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        const newBiomeId = world.getBiome(p.x, p.z);
        if (newBiomeId !== this._lastBiomeId) {
          // Lazy import to avoid a circular dependency: the
          // biome.js module sits at src/world/biome.js and the
          // HUD sits at src/ui/hud.js. The dynamic import keeps
          // the static-analysis simple.
          // For a one-shot lookup we can read the label via
          // `BIOME_NAMES[biomeId - 1]` (the canonical array in
          // src/core/constants.js — same convention as the
          // src/world/biome.js pure module).
          // We import the helper module eagerly at the top of
          // the file (see imports below) so this stays a
          // synchronous call.
          this._biomeInfoEl.textContent = `BIOME: ${biomeLabelFromId(newBiomeId)}`;
          this._lastBiomeId = newBiomeId;
        }
      }
    }

    // Phase shift detection
    const wasShifting = this._lastShift;
    const shifting = phaseManager.isShifting;
    const targetPhase = phaseManager.getTargetPhase();

    // Track if we're currently in a shift
    this._lastShift = shifting;

    // Detect phase change (cycle completed)
    if (this._lastPhase >= 0 && this._lastPhase !== phase && !shifting) {
      // Phase just shifted - show notification
      const phaseNames = ['ALPHA', 'BETA', 'GAMMA'];
      const phaseColors = ['#5aa85a', '#3399e6', '#d9b34c'];
      this.showNotification(`${phaseNames[phase]} PHASE`, phaseColors[phase]);
      this._phaseJustShifted = true;
      this._shiftDirection = phase - this._lastPhase;
    }
    this._lastPhase = phase;

    // Show shifting notification (throttled - only during active shift)
    if (shifting && targetPhase >= 0 && this._lastPhase !== targetPhase) {
      const phaseNames = ['ALPHA', 'BETA', 'GAMMA'];
      const phaseColors = ['#5aa85a', '#3399e6', '#d9b34c'];
      this.showNotification(`SHIFTING TO ${phaseNames[targetPhase]}...`, phaseColors[targetPhase]);
    }

    // Block hint for phase-walking through blocks (throttled)
    this._updateBlockHint(phaseManager, physicsManager, world);

    // Update HTML phase indicator (pre-existing in index.html). Phase 2.1
    // also drives the #phase-indicator dot's background color so the player
    // gets a visible cue next to the phase name. Hex → RGB tuple for the
    // indicator's backgroundColor so we can build a box-shadow halo too.
    const phaseName = document.querySelector('#phase-name');
    const phaseIndicator = document.querySelector('#phase-indicator');
    const energyFill = document.querySelector('#energy-fill');
    const phaseNames = ['ALPHA', 'BETA', 'GAMMA'];
    const phaseColors = ['#5aa85a', '#3399e6', '#d9b34c'];
    const phaseRgb = [[0x5a, 0xa8, 0x5a], [0x33, 0x99, 0xe6], [0xd9, 0xb3, 0x4c]];

    if (phaseName) {
      phaseName.textContent = phaseNames[phase];
      phaseName.style.color = phaseColors[phase];
      phaseName.style.textShadow = `0 0 8px ${phaseColors[phase]}`;
    }
    if (phaseIndicator) {
      const [r, g, b] = phaseRgb[phase] || [255, 255, 255];
      phaseIndicator.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      phaseIndicator.style.boxShadow = `0 0 8px rgba(${r}, ${g}, ${b}, 0.7)`;
    }
    if (energyFill) {
      energyFill.style.width = (energy / maxEnergy * 100) + '%';
      if (energy < maxEnergy * 0.2) {
        energyFill.style.background = '#ff4444';
      } else {
        energyFill.style.background = phaseColors[phase];
      }
    }

    // Fatigue warning (pre-existing in index.html)
    const fatigueWarning = document.querySelector('#fatigue-warning');
    if (fatigueWarning && energy < 20) {
      fatigueWarning.style.opacity = '1';
      fatigueWarning.textContent = '⚠ PHASE COLLAPSE IMMINENT';
    } else if (fatigueWarning) {
      fatigueWarning.style.opacity = '0';
    }

    // Phase Step cooldown indicator
    const stepBar = document.querySelector('#phase-step-bar');
    const stepLabel = document.querySelector('#phase-step-label');
    if (physicsManager && physicsManager.lastPhaseStep) {
      const elapsed = performance.now() / 1000 - physicsManager.lastPhaseStep;
      const COOLDOWN = 0.8; // matches PHASE_STEP_COOLDOWN
      const ready = elapsed >= COOLDOWN;
      if (stepBar) {
        stepBar.style.width = ready ? '100%' : (elapsed / COOLDOWN * 100) + '%';
        stepBar.style.background = ready ? '#5aa85a' : '#888';
      }
      if (stepLabel) {
        stepLabel.textContent = ready ? 'PHASE STEP READY' : 'RECHARGING';
        stepLabel.style.color = ready ? '#5aa85a' : '#888';
      }
    }

    // Minimap (dynamically created)
    this._updateMinimap(physicsManager);
  }

  _updateBlockHint(phaseManager, physicsManager, world) {
    const targetPhase = phaseManager.getTargetPhase();
    if (targetPhase < 0 || !phaseManager.isShifting) {
      this.showBlockHint(false);
      return;
    }

    // Throttle expensive block checks - only check every 10 frames when shifting
    this._blockHintThrottle = (this._blockHintThrottle || 0) + 1;
    if (this._blockHintThrottle % 10 !== 0) {
      return;
    }

    // Check if player is inside any block in the target phase (phase-walking detection)
    const pos = physicsManager.getPos();
    const halfWidth = 0.4 / 2;
    const px = pos.x;
    const py = pos.y;
    const pz = pos.z;

    // Check blocks the player overlaps in the target phase (tight bounding box)
    const bx1 = Math.floor(px - halfWidth);
    const bx2 = Math.floor(px + halfWidth);
    const by1 = Math.floor(py - 1.4);
    const by2 = Math.floor(py + 0.4);
    const bz1 = Math.floor(pz - halfWidth);
    const bz2 = Math.floor(pz + halfWidth);

    let insideBlock = false;
    if (world && world.getBlock) {
      for (let bx = bx1; bx <= bx2; bx++) {
        for (let by = by1; by <= by2; by++) {
          for (let bz = bz1; bz <= bz2; bz++) {
            const block = world.getBlock(bx, by, bz, targetPhase);
            if (block > 0) {
              const props = window.BLOCK_PROPERTIES?.[block];
              if (props && props.phaseSolid && props.phaseSolid[targetPhase]) {
                insideBlock = true;
                break;
              }
            }
          }
          if (insideBlock) break;
        }
        if (insideBlock) break;
      }
    }

    const blockHint = document.querySelector('#block-hint');
    if (blockHint) {
      blockHint.style.opacity = insideBlock ? '1' : '0';
    }
  }

  _updateMinimap(physicsManager) {
    const minimap = document.querySelector('#minimap');
    if (!this.minVisible || !minimap) return;

    const ctx = minimap.getContext('2d');
    const size = 150;
    minimap.width = size;
    minimap.height = size;

    const pos = physicsManager.getPos();
    const px = pos.x;
    const pz = pos.z;

    // Draw minimap background
    ctx.fillStyle = 'rgba(20,20,30,0.9)';
    ctx.fillRect(0, 0, size, size);

    // Draw player position (center)
    const cx = size / 2;
    const cy = size / 2;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw nearby blocks (very simplified)
    const scale = 2;
    const range = 8;

    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const screenX = cx + dx * scale;
        const screenY = cy + dz * scale;

        // Draw a small marker for terrain
        ctx.fillStyle = 'rgba(100,150,100,0.4)';
        ctx.fillRect(screenX, screenY, scale, scale);
      }
    }

    // Draw player direction
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(this.cameraYaw) * 8, cy + Math.cos(this.cameraYaw) * 8);
    ctx.stroke();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(0, 0, size, size);
  }

  setMinimapVisible(visible) {
    this.minVisible = visible;
    const minimap = document.querySelector('#minimap');
    if (minimap) {
      minimap.style.display = visible ? 'block' : 'none';
    }
  }

  setPaused(paused) {
    let overlay = document.querySelector('#pause-overlay');
    if (!paused) {
      if (overlay) overlay.style.display = 'none';
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pause-overlay';
      overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        color: #fff; font-size: 32px;
        z-index: 20; pointer-events: none;
      `;
      overlay.innerHTML = `
        <div>PAUSED</div>
        <div style="font-size: 14px; margin-top: 16px; color: rgba(255,255,255,0.5);">Press ESC to resume</div>
      `;
      this.container.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  }

  /** Show/hide the inventory panel. */
  showInventory(player, visible) {
    // Create panel on first call
    let panel = document.querySelector('#inventory-panel');
    if (!panel && visible) {
      panel = document.createElement('div');
      panel.id = 'inventory-panel';
      panel.style.cssText = `
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(10, 10, 20, 0.92);
        border: 1px solid rgba(100, 150, 255, 0.3);
        border-radius: 8px;
        padding: 20px 24px;
        color: #ddd; font-size: 13px;
        min-width: 420px;
        display: none;
        pointer-events: auto;
      `;
      this.container.appendChild(panel);
    }
    if (!panel) return;

    if (!visible) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    // Build tool slots row
    const tools = player ? player.getTools() : [];
    const toolNames = {
      phaseAnchor: 'Phase Anchor',
      phaseLens: 'Phase Lens',
      phaseGlider: 'Phase Glider',
      stabilizer: 'Stabilizer',
    };
    const toolDescriptions = {
      phaseAnchor: 'Place phase anchors to return to any phase.',
      phaseLens: 'Reveals hidden materials in other phases.',
      phaseGlider: 'Double-jump in phase-shifted states.',
      stabilizer: 'Reduces energy drain during extended shifts.',
    };

    let html = '<div style="color:#88aaff;font-size:15px;font-weight:bold;margin-bottom:12px;text-align:center;letter-spacing:0.1em;">INVENTORY</div>';

    // Tools
    html += '<div style="margin-bottom:14px;">';
    html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">TOOLS</div>';
    html += '<div style="display:flex;gap:8px;">';
    tools.forEach((t, i) => {
      const owned = t.owned;
      const name = toolNames[t.toolId] || t.toolId;
      const desc = toolDescriptions[t.toolId] || '';
      const dim = owned ? '' : 'opacity:0.35;';
      const border = owned ? '1px solid rgba(100,150,255,0.5);' : '1px solid rgba(80,80,80,0.3);';
      html += `<div style="flex:1;background:rgba(20,20,30,${owned?'0.8':'0.3'});border:${border};border-radius:4px;padding:6px;cursor:pointer;transition:background 0.15s;${dim}" `; 
      html += `onmouseenter="this.style.background='${owned?'rgba(40,40,60,0.9)':'rgba(30,30,30,0.5)'}'" ` 
      html += `onmouseleave="this.style.background='${owned?'rgba(20,20,30,0.8)':'rgba(20,20,30,0.3)'}'" ` 
      html += `onclick="alert('${name}\n\n${desc}')">
        <div style="color:${owned?'#ddd':'#555'};font-size:11px;margin-bottom:2px;">${name}</div>`;
      html += owned ? `<div style="color:#888;font-size:10px;">Owned ✓</div>` : `<div style="color:#555;font-size:10px;">Not yet found</div>`;
      html += '</div>';
    });
    // Pad remaining slots
    const emptySlots = Math.max(0, 4 - tools.length);
    for (let i = 0; i < emptySlots; i++) {
      html += '<div style="flex:1;background:rgba(20,20,30,0.2);border:1px dashed rgba(80,80,80,0.3);border-radius:4px;padding:6px;"></div>';
    }
    html += '</div></div>';

    // Amplifiers
    const amps = player ? player.getAmplifiers() : [];
    const ampNames = {
      AB: 'A-B Resonator',
      BG: 'B-G Resonator',
      AG: 'A-G Resonator',
    };
    html += '<div style="margin-bottom:14px;">';
    html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">AMPLIFIERS</div>';
    html += '<div style="display:flex;gap:8px;">';
    const ampIds = ['AB', 'BG', 'AG'];
    ampIds.forEach(id => {
      const amp = amps.find(a => a.toolId === id);
      const owned = amp ? amp.owned : false;
      const name = ampNames[id];
      const dim = owned ? '' : 'opacity:0.35;';
      const border = owned ? '1px solid rgba(100,200,100,0.5);' : '1px solid rgba(80,80,80,0.3);';
      html += `<div style="flex:1;background:rgba(20,20,30,${owned?'0.8':'0.3'});border:${border};border-radius:4px;padding:6px;cursor:pointer;transition:background 0.15s;${dim}" ` 
      html += `onmouseenter="this.style.background='${owned?'rgba(40,40,60,0.9)':'rgba(30,30,30,0.5)'}'" ` 
      html += `onmouseleave="this.style.background='${owned?'rgba(20,20,30,0.8)':'rgba(20,20,30,0.3)'}'" ` 
      html += `onclick="alert('${name}\n\nResonance amplifier for ${id[0]}-${id[1]} phase transition.')">
        <div style="color:${owned?'#ddd':'#555'};font-size:11px;margin-bottom:2px;">${name}</div>`;
      html += owned ? `<div style="color:#888;font-size:10px;">Owned ✓</div>` : `<div style="color:#555;font-size:10px;">Not yet found</div>`;
      html += '</div>';
    });
    html += '</div></div>';

    // Echoes / Lore
    const echoes = player ? player.getEchoes() : [];
    html += '<div>';
    html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">ECHOES & LORE (${echoes.length} collected)</div>';
    if (echoes.length === 0) {
      html += '<div style="color:#555;font-size:11px;font-style:italic;padding:4px 0;">No echoes discovered yet.</div>';
    } else {
      echoes.forEach(e => {
        html += `<div style="color:#aaa;font-size:11px;padding:3px 0;border-bottom:1px solid rgba(100,100,100,0.2);">
          <span style="color:#6688cc;">[${e.type || 'echo'}]</span> ${e.lore || 'Unknown resonance echo'}
        </div>`;
      });
    }
    html += '</div>';

    panel.innerHTML = html;
  }

  showNotification(text, color = '#ffffff') {
    const notification = document.querySelector('#notification');
    if (!notification) return;

    notification.textContent = text;
    notification.style.color = color;
    notification.style.textShadow = `0 0 20px ${color}`;
    notification.style.opacity = '1';

    if (this._notifTimer) clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => {
      notification.style.opacity = '0';
    }, 2000);
  }



  /**
   * Phase 3.3: update the `#echo-counter` HUD element. The format
   * is `ECHOES: X / Y` where X is the collected count and Y is
   * the total spawned count. The DOM write only fires when the
   * element exists (safe in headless tests without a DOM).
   */
  setEchoCounter(collected, total) {
    if (!this._echoCounterEl) return;
    const x = Number.isFinite(collected) ? Math.max(0, collected | 0) : 0;
    const y = Number.isFinite(total) ? Math.max(0, total | 0) : 0;
    this._echoCounterEl.textContent = `ECHOES: ${x} / ${y}`;
  }

  /**
   * Phase 3.3: show a lore toast for `ECHO_LORE_TTL` seconds.
   * Subsequent calls reset the timer (so rapid pickups update the
   * toast rather than stacking on top of the prior one).
   */
  showLoreToast(text) {
    if (!this._loreToastEl) return;
    if (typeof text !== 'string' || text.length === 0) return;
    this._loreToastEl.textContent = text;
    this._loreToastEl.style.opacity = '1';
    if (this._loreToastTimer) clearTimeout(this._loreToastTimer);
    this._loreToastTimer = setTimeout(() => {
      if (this._loreToastEl) this._loreToastEl.style.opacity = '0';
    }, 5000);
  }

  /**
   * Phase 3.4: update the `#amplifier-status` HUD element. The
   * format is `AMPS: AB BG AG` (lit if unlocked, dim if not).
   * The DOM write only fires when the element exists + the
   * status string changes (cheap: one DOM write per unlock).
   *
   * @param {Set<string>|string[]} unlocked - the unlocked
   *   amplifier names (e.g. 'amplifierAB').
   */
  setAmplifierStatus(unlocked) {
    if (!this._ampStatusEl) return;
    const set = (unlocked instanceof Set) ? unlocked : new Set(Array.isArray(unlocked) ? unlocked : []);
    const isAB = set.has('amplifierAB');
    const isBG = set.has('amplifierBG');
    const isAG = set.has('amplifierAG');
    const str = `AMPS: ${isAB ? '●' : '○'} AB  ${isBG ? '●' : '○'} BG  ${isAG ? '●' : '○'} AG`;
    if (this._lastAmpString === str) return;
    this._lastAmpString = str;
    this._ampStatusEl.textContent = str;
  }

  showBlockHint(visible) {
    const blockHint = document.querySelector('#block-hint');
    if (blockHint) {
      blockHint.style.opacity = visible ? '1' : '0';
    }
  }

  setObjective(text, color = '#ffffff') {
    const objective = document.querySelector('#objective');
    if (!objective) return;

    objective.textContent = text;
    objective.style.color = color;
    objective.style.display = text ? 'block' : 'none';
  }

  setCameraYaw(yaw) {
    this.cameraYaw = yaw;
  }

  /**
   * Phase 3.6: show the current tutorial hint text in the
   * `#tutorial-hint` element. The text persists until the next
   * call (or until clearTutorialHint is called). The DOM write
   * only fires when the element exists + the text actually
   * changes (cheap: one DOM write per hint advance).
   *
   * @param {string} text - the hint text to display
   * @param {number} hintIndex - the 0-based hint index (for the
   *   optional index badge; falls back to no badge if absent)
   */
  setTutorialHint(text, hintIndex) {
    if (!this._tutorialHintEl) return;
    if (typeof text !== 'string' || text.length === 0) return;
    const idx = (typeof hintIndex === 'number' && Number.isFinite(hintIndex))
      ? (hintIndex + 1) : 0;
    const formatted = idx > 0 ? `[${idx}] ${text}` : text;
    if (this._lastTutorialHintText === formatted) return;
    this._lastTutorialHintText = formatted;
    this._tutorialHintEl.textContent = formatted;
    this._tutorialHintEl.style.opacity = '1';
    if (this._tutorialHintTimer) clearTimeout(this._tutorialHintTimer);
    this._tutorialHintTimer = setTimeout(() => {
      if (this._tutorialHintEl) this._tutorialHintEl.style.opacity = '0';
    }, 8000);
  }

  /**
   * Phase 3.6: clear the tutorial hint text (fade-out).
   * Called when the tutorial completes or is dismissed.
   */
  clearTutorialHint() {
    if (!this._tutorialHintEl) return;
    this._tutorialHintEl.textContent = '';
    this._tutorialHintEl.style.opacity = '0';
    this._lastTutorialHintText = null;
    if (this._tutorialHintTimer) {
      clearTimeout(this._tutorialHintTimer);
      this._tutorialHintTimer = null;
    }
  }
}
