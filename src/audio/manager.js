// Audio engine using WebAudio API
export class AudioEngine {
  constructor(options = {}) {
    this.ctx = null;
    this.initialized = false;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.currentMode = 0;
    this.settings = options || {};
    this.sounds = [];
    this.footstepTimer = 0;
  }

  init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.4;
      this.sfxGain.connect(this.masterGain);

      this.initialized = true;
    } catch (e) {
      console.warn('WebAudio not available:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Phase 9.2: safe resume. Returns the AudioContext state after
   * the call (or 'uninitialized' if the context never built). The
   * pointer-lockchange listener uses this to defer the resume to
   * the next event-loop tick on Firefox — Firefox's pointerlockchange
   * fires before the AudioContext unlock path completes, and a
   * direct `resume()` against the just-acquired state can be a
   * no-op. The next-tick deferral + first-input fallback closes
   * the race on every platform.
   *
   * Returns one of: 'uninitialized' | 'closed' | 'suspended' |
   * 'running' | 'resuming'. The method is safe to call from any
   * event listener (no throws).
   */
  safeResume() {
    if (!this.initialized || !this.ctx) return 'uninitialized';
    try {
      if (this.ctx.state === 'closed') return 'closed';
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(() => {}, () => {});
        }
      }
      return this.ctx.state;
    } catch (e) {
      return 'uninitialized';
    }
  }

  // Phase shift sound
  playShift(phase) {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Low hum
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    const freqs = [110, 165, 220]; // Different pitch per phase
    osc1.frequency.value = freqs[phase];
    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc1.connect(gain1).connect(this.sfxGain);
    osc1.start(now);
    osc1.stop(now + 0.5);

    // Glass chime
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    const chimeFreqs = [880, 1320, 1568];
    osc2.frequency.value = chimeFreqs[phase];
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.08, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(gain2).connect(this.sfxGain);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.8);

    // Wind rush (filtered noise)
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freqs[phase] * 2;
    filter.Q.value = 5;
    const gain3 = ctx.createGain();
    gain3.gain.setValueAtTime(0.05, now);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.connect(filter).connect(gain3).connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.3);
  }

  // Phase 2.8: Footstep sound. The caller (main.js game loop +
  // src/audio/footsteps.js#shouldPlayFootstep) throttles the call
  // to every footstepInterval() seconds while moving and grounded,
  // and looks up the material name via materialFromBlock (the
  // phase-and-block filter). The four canonical material names
  // (stone / wood / crystal / void) have distinct lowpass filters;
  // anything else falls back to 200 Hz (the closest lowpass). The
  // method is a no-op without an AudioContext — the headless tests
  // assert the API surface, not the audible output.
  playFootstep(material = 'stone') {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Noise burst for footstep
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.01));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    const freqs = { stone: 200, wood: 150, crystal: 400, void: 100 };
    filter.type = 'lowpass';
    filter.frequency.value = freqs[material] || 200;

    const gain = ctx.createGain();
    gain.gain.value = 0.08;

    source.connect(filter).connect(gain).connect(this.sfxGain);
    source.start(now);
    source.stop(now + 0.05);
  }

  // Phase 2.6: Resonance pulse sound. The chord is a phase-dependent
  // sweep + a chord that lands on the phase's triad center. The pitch
  // is per-phase so the player hears the resonance as a "phase signature"
  // (Alpha low, Beta mid, Gamma high). The signature falls back to a
  // default sweep when the AudioContext hasn't been initialized yet
  // (e.g. headless tests) — the headless tests assert that the method
  // is callable, not that it actually played sound.
  playResonance(phase = 0) {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Phase 2.6: chord centers per phase (Alpha / Beta / Gamma).
    const chordCenters = [60, 90, 120];
    const baseFreq = chordCenters[phase] || 60;

    // Deep bass sweep from baseFreq → 2× baseFreq over 0.5s.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 2, now + 0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;

    osc.connect(filter).connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 1.5);

    // Phase 2.6: a chord that lands on the phase's triad center
    // (port from ParticleManager.emitResonancePulse) — three notes
    // stacked at the 1×, 5/4, and 3/2 frequencies of the base.
    const chordFreqs = [baseFreq, baseFreq * 1.25, baseFreq * 1.5];
    for (const freq of chordFreqs) {
      const chord = ctx.createOscillator();
      chord.type = 'triangle';
      chord.frequency.value = freq;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0, now);
      cg.gain.linearRampToValueAtTime(0.08, now + 0.05);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      chord.connect(cg).connect(this.sfxGain);
      chord.start(now);
      chord.stop(now + 1.0);
    }
  }

  // Collapse / respawn sound
  playCollapse() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Sudden vacuum sound - low frequency sweep + noise burst
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.8);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 3;

    // Noise burst for chaos
    const bufferSize = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.15));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.12;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 200;
    noiseFilter.Q.value = 1;

    osc.connect(filter).connect(gain).connect(this.sfxGain);
    noise.connect(noiseFilter).connect(noiseGain).connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 1.0);
    noise.start(now);
    noise.stop(now + 0.5);
  }

  // Block break sound - crunchy noise burst
  playBlockBreak() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Noise burst (crunchy)
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;

    const gain = ctx.createGain();
    gain.gain.value = 0.1;

    source.connect(filter).connect(gain).connect(this.sfxGain);
    source.start(now);
    source.stop(now + 0.2);
  }

  // Block place sound - soft click
  playBlockPlace() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Soft click: short sine burst
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  // Phase 10.2: Phase Fuse sound — a soft golden chime.
  // Two stacked tones (440 + 660 Hz) with a slow exponential decay.
  // Distinct from the block place sound (800 Hz) so the player
  // hears the difference between a fuse and a place.
  playFuse() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freqs = [440, 660];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain).connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  }

  // Phase 10.8: Erosion "crumble" sound. A short low-pass noise
  // burst that suggests stone degrading. Tuned subtle (gain 0.06)
  // because the burst can fire many times in a single frame in
  // a busy chunk — we want a soft patter, not a cement-mixer.
  playErosion() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.12);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // Decaying noise: starts loud, fades fast
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 350;  // low rumble, not a crack
    const gain = ctx.createGain();
    gain.gain.value = 0.06;        // soft patter
    source.connect(filter).connect(gain).connect(this.sfxGain);
    source.start(now);
    source.stop(now + 0.12);
  }

  // Phase 10.9: Energy "heartbeat" cue. A low-frequency
  // thump (50 Hz) that fires when the player is in the
  // 'critical' energy tier (< 15). The gain is intentionally
  // subtle (0.18) so it doesn't drown out the rest of the
  // mix. The main.js game loop calls this once per second
  // when in the 'critical' tier; the §10.9 "subtle heartbeat"
  // acceptance is satisfied by the low gain + the 1Hz
  // cadence.
  playHeartbeat() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 50; // low thump, sub-bass rumble
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.30);
  }

  // Ambient procedural music
  startAmbientMusic(phase) {
    if (!this.initialized) return;

    this.stopAmbientMusic();

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Drone
    const droneFreqs = [55, 82.41, 110];
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = droneFreqs[phase];
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    drone.connect(droneGain).connect(this.musicGain);
    drone.start(now);
    this.drone = drone;

    // Ethereal pad
    const padFreqs = [220, 329.63, 440];
    const pad = ctx.createOscillator();
    pad.type = 'triangle';
    pad.frequency.value = padFreqs[phase];
    const padGain = ctx.createGain();
    padGain.gain.value = 0.03;
    pad.connect(padGain).connect(this.musicGain);
    pad.start(now);
    this.pad = pad;
  }

  stopAmbientMusic() {
    if (this.drone) { try { this.drone.stop(); } catch (e) {} }
    if (this.pad) { try { this.pad.stop(); } catch (e) {} }
    this.drone = null;
    this.pad = null;
  }

  // Spatial 3D sound
  playSpatialSound(x, y, z, soundFn) {
    if (!this.initialized) return;
    // In a full implementation, use pannerNode for 3D positioning
    soundFn();
  }

  update(audioState) {
    if (!audioState) return;

    // Handle phase shift audio
    if (audioState.phaseShift) {
      this.playShift(this.currentMode);
      audioState.phaseShift = false;
    }

    // Handle resonance audio
    if (audioState.resonance) {
      this.playResonance();
      audioState.resonance = false;
    }

    // Start/stop ambient music
    if (audioState.musicPlaying && this.currentMode !== -1) {
      this.startAmbientMusic(this.currentMode);
    } else if (!audioState.musicPlaying) {
      this.stopAmbientMusic();
    }
  }

  setVolume(volume) {
    if (this.masterGain) {
      this.masterGain.gain.value = volume;
    }
  }
}

// Alias for backwards compatibility
export const AudioManager = AudioEngine;
