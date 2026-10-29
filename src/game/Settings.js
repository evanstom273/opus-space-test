// Player preferences, persisted per browser. Pure module (no three.js) so the
// quality tier can read it before the renderer is created.
const KEY = 'wayfarer-settings';

export const DEFAULTS = {
  sensitivity: 1,      // look / steering multiplier
  invertLook: false,   // on-foot camera Y
  invertFlight: false, // ship pitch
  quality: 'auto',     // auto | high | low (applies after reload)
  showFps: false,
  lamp: 'auto',        // auto | on | off
  volume: 0.8,
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

export const settings = load();
const listeners = new Set();

export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
  for (const fn of listeners) fn(key, value);
}

export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
