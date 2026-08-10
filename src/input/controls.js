// src/input/controls.js
// Controls class for the 3D game - keyboard and mouse input
// Supports WASD movement, mouse look, phase shift, scanning, resonance, echo interaction

import * as THREE from 'three';

export class Controls {
  constructor(camera, DOMElement) {
    this.camera = camera;
    this.domElement = DOMElement;
    this.state = {
      moveX: 0,
      moveZ: 0,
      jump: false,
      sprint: false,
      crouching: false,
      shifting: false,
      scanning: false,
      resonating: false,
      fusing: false,           // Phase 10.2: F held (Phase Fuse)
      placeAnchor: false,      // Phase 10.7: B is the alt-anchor key (F was)
      phaseDirect: null,
      toggleMinimap: false,
      toggleAnchor: false,     // legacy — kept for back-compat
      saveGame: false,
      loadGame: false,
      toggleEcho: false,
      toggleInventory: false,
      mouseDownLeft: false,
      mouseDownRight: false,
      paused: false,
    };

    // Track previous key states for "just pressed" detection
    this._prevKeys = {};
    this._frameStep = () => {
      const current = this.state;
      const justPressed = {};
      // Check key/mouse state changes
      for (const key of Object.keys(current)) {
        const prev = this._prevKeys[key];
        if (current[key] && !prev) {
          justPressed[key] = true;
        }
        this._prevKeys[key] = current[key];
      }
      // Track one-shot mouse button presses (when locked)
      if (this.isLocked) {
        const prevLMB = this._prevKeys['mouseDownLeft'] || false;
        const prevRMB = this._prevKeys['mouseDownRight'] || false;
        if (current.mouseDownLeft && !prevLMB) {
          justPressed.mouseClickLeft = true;
          // Reset for next frame
          this.state.mouseDownLeft = false;
        }
        if (current.mouseDownRight && !prevRMB) {
          justPressed.mouseClickRight = true;
          this.state.mouseDownRight = false;
        }
      }
      return justPressed;
    };

    this.yaw = 0;
    this.pitch = 0;
    this.moveSpeed = 3;
    this.sensitivity = 0.002;

    this.isLocked = false;

    // Track held modifiers for compound shortcuts
    this._shiftHeld = false;
    this._controlHeld = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);

    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener('keydown', this._onKeyDown, false);
    document.addEventListener('keyup', this._onKeyUp, false);
    document.addEventListener('mousemove', this._onMouseMove, false);
    document.addEventListener('mousedown', this._onMouseDown, false);
    document.addEventListener('mouseup', this._onMouseUp, false);
    document.addEventListener('wheel', this._onWheel, false);
    document.addEventListener('pointerlockchange', this._onPointerLockChange, false);
  }

  _onPointerLockChange() {
    this.isLocked = document.pointerLockElement === this.domElement;
  }

  _onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': this.state.moveZ = -1; break;
      case 'KeyS': this.state.moveZ = 1; break;
      case 'KeyA': this.state.moveX = -1; break;
      case 'KeyD': this.state.moveX = 1; break;
      case 'Space':
        e.preventDefault();
        this.state.jump = true;
        // Shift+Space = phase shift
        if (this._shiftHeld || e.shiftKey) {
          this.state.shifting = true;
        }
        break;
      case 'ShiftLeft': case 'ShiftRight': case 'Shift':
        this.state.sprint = true;
        this._shiftHeld = true;
        break;
      case 'ControlLeft': case 'ControlRight':
        this.state.crouching = true;
        break;
      case 'KeyE': this.state.scanning = true; break;
      case 'KeyQ': this.state.resonating = true; break;
      case 'KeyT': this.state.toggleEcho = true; break;
      case 'Digit1': this.state.phaseDirect = 0; break;
      case 'Digit2': this.state.phaseDirect = 1; break;
      case 'Digit3': this.state.phaseDirect = 2; break;
      case 'KeyM': this.state.toggleMinimap = true; break;
      case 'KeyI': this.state.toggleInventory = true; break;
      case 'F5': this.state.saveGame = true; break;
      case 'F9': this.state.loadGame = true; break;
      case 'KeyF': this.state.fusing = true; break;
      case 'KeyB': this.state.placeAnchor = true; break; // Phase 10.7: alt-anchor
      case 'KeyR': this.state.toggleStabilizer = true; break; // Phase 10.5: Stabilizer
      case 'Escape': this.state.paused = true; break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'KeyS': this.state.moveZ = 0; break;
      case 'KeyA': case 'KeyD': this.state.moveX = 0; break;
      case 'Space':
        e.preventDefault();
        this.state.jump = false;
        // If Space released while Shift still held, stop shifting
        if (this._shiftHeld) {
          this.state.shifting = false;
        }
        break;
      case 'ShiftLeft': case 'ShiftRight': case 'Shift':
        this.state.sprint = false;
        this._shiftHeld = false;
        break;
      case 'ControlLeft': case 'ControlRight':
        this.state.crouching = false;
        this._controlHeld = false;
        break;
      case 'KeyE': this.state.scanning = false; break;
      case 'KeyQ': this.state.resonating = false; break;
      case 'KeyT': this.state.toggleEcho = false; break;
      case 'Digit1': case 'Digit2': case 'Digit3': this.state.phaseDirect = null; break;
      case 'KeyM': this.state.toggleMinimap = false; break;
      case 'KeyI': this.state.toggleInventory = false; break;
      case 'F5': this.state.saveGame = false; break;
      case 'F9': this.state.loadGame = false; break;
      case 'KeyF': this.state.fusing = false; break;
      case 'KeyB': this.state.placeAnchor = false; break;
      case 'KeyR': this.state.toggleStabilizer = false; break;
      case 'Escape': this.state.paused = false; break;
    }
  }

  _onMouseMove(e) {
    if (!this.isLocked) return;

    const dx = e.movementX || 0;
    const dy = e.movementY || 0;

    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;

    // Clamp pitch
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));

    // Apply rotation
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  _onMouseDown(e) {
    if (!this.isLocked) {
      // Not locked - request pointer lock on any button
      this.domElement.requestPointerLock();
      return;
    }
    // Locked canvas: track mouse buttons for block interaction
    if (e.button === 0) {
      this.state.mouseDownLeft = true;
    } else if (e.button === 2) {
      this.state.mouseDownRight = true;
    }
  }

  _onMouseUp(e) {
    if (!this.isLocked) return;
    if (e.button === 0) {
      this.state.mouseDownLeft = false;
    } else if (e.button === 2) {
      this.state.mouseDownRight = false;
    }
  }

  _onWheel(e) {
    // Scroll wheel for phase cycling
    // Handled separately
  }

  getState() {
    return { ...this.state };
  }

  /** Returns keys/mouse that JUST transitioned true this frame (one-shot trigger). */
  getJustPressed() {
    return this._frameStep();
  }

  getYaw() { return this.yaw; }
  getPitch() { return this.pitch; }

  reset() {
    this.state = {
      moveX: 0, moveZ: 0, jump: false, sprint: false,
      crouching: false, shifting: false, scanning: false,
      resonating: false, fusing: false, placeAnchor: false,
      phaseDirect: null, toggleMinimap: false,
      toggleEcho: false,
      toggleAnchor: false, toggleStabilizer: false,
      saveGame: false, loadGame: false,
      toggleInventory: false,
      mouseDownLeft: false, mouseDownRight: false,
      paused: false,
    };
    this._prevKeys = {};
    this._shiftHeld = false;
    this._controlHeld = false;
    this.yaw = 0;
    this.pitch = 0;
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
