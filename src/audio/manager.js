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

  // Footstep sound
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

  // Resonance pulse sound
  playResonance() {
    if (!this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Deep bass
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;

    osc.connect(filter).connect(gain).connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 1.5);
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
