/**
 * Phase 4.2 — Settings menu (data-driven UX)
 *
 * Pure module. No Three.js, no globals, no scene access. The
 * settings menu is owned by the HUD (the §4.1 acceptance: "the
 * HUD owns its DOM"). The settings values are persisted to
 * localStorage under the canonical key `phaseshift_settings_v1`
 * so a player can tweak once and have it stick across reloads.
 *
 * The §4.2 acceptance is:
 *   - Settings menu (resolution scale, render distance, mouse
 *     sensitivity, audio volume, keybindings).
 *   - Settings persist in localStorage under a single key.
 *   - Live-apply: changes take effect on the next frame.
 *
 * The constants here are the canonical defaults + the helper
 * for normalizing + validating user input. The settings UI is
 * rendered by `hud.renderSettingsMenu(settings, onChange)`.
 */

// ── Canonical defaults ────────────────────────────────────────

/** §4.2: Resolution scale (1.0 = native, 0.5 = half, etc.). */
export const DEFAULT_RESOLUTION_SCALE = 1.0;

/** §4.2: Render distance in chunks (1–5, the plan's range). */
export const DEFAULT_RENDER_DISTANCE = 3;
export const MIN_RENDER_DISTANCE = 1;
export const MAX_RENDER_DISTANCE = 5;

/** §4.2: Mouse sensitivity (radians per pixel). */
export const DEFAULT_MOUSE_SENSITIVITY = 0.002;
export const MIN_MOUSE_SENSITIVITY = 0.0005;
export const MAX_MOUSE_SENSITIVITY = 0.01;

/** §4.2: Audio volumes (0..1). */
export const DEFAULT_MASTER_VOLUME = 0.5;
export const DEFAULT_MUSIC_VOLUME = 0.3;
export const DEFAULT_SFX_VOLUME = 0.4;

/** §4.2: HUD opacity (0..1). */
export const DEFAULT_HUD_OPACITY = 1.0;

/** §4.2: Autosave enabled. */
export const DEFAULT_AUTOSAVE = true;

/** §4.2: Post-processing on/off. */
export const DEFAULT_POST_PROCESSING = true;

/** §4.2: Reduced-motion mode (disables FOV breathing + chromatic aberration). */
export const DEFAULT_REDUCED_MOTION = false;

/** §4.2: localStorage key for the persisted settings blob. */
export const SETTINGS_STORAGE_KEY = 'phaseshift_settings_v1';

/** §4.2: Default keybindings (the canonical action → key map). */
export const DEFAULT_KEYBINDINGS = Object.freeze({
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  shift: 'KeyT',
  phaseStep: 'KeyQ',
  phaseLens: 'KeyE',
  phaseAnchor: 'ShiftLeft',
  break: null,        // mouse button — no key binding
  place: null,        // mouse button — no key binding
  pause: 'Escape',
  inventory: 'KeyI',
  minimap: 'KeyJ',
  glider: 'Space',    // overlaps with jump; §3.5 Phase Glider is the Beta-only variant
});

/** Canonical setting key list (used for validation + UI rendering). */
export const SETTING_KEYS = Object.freeze([
  'resolutionScale',
  'renderDistance',
  'mouseSensitivity',
  'masterVolume',
  'musicVolume',
  'sfxVolume',
  'hudOpacity',
  'autosave',
  'postProcessing',
  'reducedMotion',
  'keyBindings',
]);

// ── Helpers ────────────────────────────────────────────────────

/** Clamp a number to [min, max]; return fallback if not finite. */
export function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Coerce a value to a boolean. Anything truthy → true, else false. */
export function coerceBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'on') return true;
  if (value === 0 || value === '0' || value === 'off') return false;
  return fallback;
}

/** Coerce a string key like 'KeyW' to its upper-case canonical form. */
export function normalizeKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  // Accept 'w', 'W', 'KeyW' → 'KeyW'; 'space', 'Space' → 'Space'.
  const lower = trimmed.toLowerCase();
  if (lower === 'space' || lower === ' ') return 'Space';
  if (lower.startsWith('key') && trimmed.length === 4) return trimmed; // 'KeyW' etc.
  if (trimmed.length === 1) return 'Key' + trimmed.toUpperCase();
  return trimmed; // already in canonical form
}

/** Build the canonical settings object (merges partial overrides). */
export function buildSettings(overrides) {
  const o = (overrides && typeof overrides === 'object') ? overrides : {};
  const keyBindings = (o.keyBindings && typeof o.keyBindings === 'object')
    ? { ...DEFAULT_KEYBINDINGS, ...o.keyBindings }
    : { ...DEFAULT_KEYBINDINGS };
  return {
    resolutionScale: clampNumber(o.resolutionScale, 0.5, 1.5, DEFAULT_RESOLUTION_SCALE),
    renderDistance: clampNumber(o.renderDistance, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE, DEFAULT_RENDER_DISTANCE),
    mouseSensitivity: clampNumber(o.mouseSensitivity, MIN_MOUSE_SENSITIVITY, MAX_MOUSE_SENSITIVITY, DEFAULT_MOUSE_SENSITIVITY),
    masterVolume: clampNumber(o.masterVolume, 0, 1, DEFAULT_MASTER_VOLUME),
    musicVolume: clampNumber(o.musicVolume, 0, 1, DEFAULT_MUSIC_VOLUME),
    sfxVolume: clampNumber(o.sfxVolume, 0, 1, DEFAULT_SFX_VOLUME),
    hudOpacity: clampNumber(o.hudOpacity, 0, 1, DEFAULT_HUD_OPACITY),
    autosave: coerceBoolean(o.autosave, DEFAULT_AUTOSAVE),
    postProcessing: coerceBoolean(o.postProcessing, DEFAULT_POST_PROCESSING),
    reducedMotion: coerceBoolean(o.reducedMotion, DEFAULT_REDUCED_MOTION),
    keyBindings,
  };
}

/** Serialize a settings object to JSON-safe shape (key bindings are strings). */
export function serializeSettings(settings) {
  return JSON.stringify(buildSettings(settings));
}

/** Deserialize a settings JSON string (defensive: falls back to defaults). */
export function deserializeSettings(json) {
  if (typeof json !== 'string' || json.length === 0) return buildSettings();
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return buildSettings();
  }
  return buildSettings(parsed);
}

/** Get a single setting value (defensive; returns the default if missing). */
export function getSetting(settings, key) {
  const s = (settings && typeof settings === 'object') ? settings : {};
  const defaults = buildSettings();
  if (key === 'keyBindings') {
    return (s.keyBindings && typeof s.keyBindings === 'object')
      ? s.keyBindings
      : defaults.keyBindings;
  }
  if (key in s) return s[key];
  return defaults[key];
}

/** Set a single setting value (returns a new settings object). */
export function setSetting(settings, key, value) {
  const s = buildSettings(settings);
  if (key === 'keyBindings') {
    s.keyBindings = { ...s.keyBindings, ...(value || {}) };
  } else {
    s[key] = value;
  }
  return s;
}

/** Resolve the action that owns a given DOM key code (or null). */
export function actionForKey(settings, key) {
  if (typeof key !== 'string') return null;
  const bindings = getSetting(settings, 'keyBindings');
  for (const action in bindings) {
    if (bindings[action] === key) return action;
  }
  return null;
}

export const SETTINGS_DEFAULTS = Object.freeze({
  resolutionScale: DEFAULT_RESOLUTION_SCALE,
  renderDistance: DEFAULT_RENDER_DISTANCE,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  masterVolume: DEFAULT_MASTER_VOLUME,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  sfxVolume: DEFAULT_SFX_VOLUME,
  hudOpacity: DEFAULT_HUD_OPACITY,
  autosave: DEFAULT_AUTOSAVE,
  postProcessing: DEFAULT_POST_PROCESSING,
  reducedMotion: DEFAULT_REDUCED_MOTION,
  keyBindings: DEFAULT_KEYBINDINGS,
  storageKey: SETTINGS_STORAGE_KEY,
  minRenderDistance: MIN_RENDER_DISTANCE,
  maxRenderDistance: MAX_RENDER_DISTANCE,
  minMouseSensitivity: MIN_MOUSE_SENSITIVITY,
  maxMouseSensitivity: MAX_MOUSE_SENSITIVITY,
});

/**
 * Phase 8.4: return a fresh mutable copy of the canonical default
 * settings object. Used by the "Reset to defaults" button in the
 * Settings menu. Returns a NEW object (not the frozen
 * `SETTINGS_DEFAULTS` reference) so the call site can mutate or
 * pass it to `settings.setAll(...)` without affecting other
 * consumers.
 *
 * The keys match `SETTING_KEYS` plus the internal `keyBindings`,
 * `storageKey`, and range bounds. The function is a single source
 * of truth for the default-settings shape.
 */
export function defaultSettings() {
  return {
    resolutionScale: DEFAULT_RESOLUTION_SCALE,
    renderDistance: DEFAULT_RENDER_DISTANCE,
    mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
    masterVolume: DEFAULT_MASTER_VOLUME,
    musicVolume: DEFAULT_MUSIC_VOLUME,
    sfxVolume: DEFAULT_SFX_VOLUME,
    hudOpacity: DEFAULT_HUD_OPACITY,
    autosave: DEFAULT_AUTOSAVE,
    postProcessing: DEFAULT_POST_PROCESSING,
    reducedMotion: DEFAULT_REDUCED_MOTION,
    keyBindings: { ...DEFAULT_KEYBINDINGS },
  };
}
