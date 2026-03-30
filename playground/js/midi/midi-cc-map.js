// MIDI CC Map — user-defined CC parameter definitions
// Each param maps one MLP output to a MIDI CC message.

const STORAGE_KEY = 'nisps-midi-cc-map';

// Default starter set — common CC numbers
const DEFAULT_CC_MAP = [
  { name: 'Cutoff',    cc: 74, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Resonance', cc: 71, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Attack',    cc: 73, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Release',   cc: 72, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Mod Wheel', cc:  1, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Volume',    cc:  7, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Pan',       cc: 10, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
  { name: 'Expression',cc: 11, channel: 1, min: 0, max: 1, curve: 0.5, muted: false, fixedValue: 0.5 },
];

// Well-known CC names for auto-labeling
const CC_NAMES = {
  1: 'Mod Wheel', 2: 'Breath', 5: 'Portamento Time', 7: 'Volume', 10: 'Pan',
  11: 'Expression', 64: 'Sustain', 65: 'Portamento', 66: 'Sostenuto',
  67: 'Soft Pedal', 70: 'Sound Variation', 71: 'Resonance', 72: 'Release',
  73: 'Attack', 74: 'Cutoff', 75: 'Decay', 76: 'Vib Rate', 77: 'Vib Depth',
  78: 'Vib Delay', 91: 'Reverb', 92: 'Tremolo', 93: 'Chorus', 94: 'Detune',
  95: 'Phaser',
};

/**
 * Create a fresh CC param with defaults.
 * @param {number} [cc=74] — CC number
 * @param {number} [channel=1] — MIDI channel 1-16
 * @returns {object} CC param definition
 */
export function createCCParam(cc = 74, channel = 1) {
  return {
    name: CC_NAMES[cc] || `CC ${cc}`,
    cc,
    channel,
    min: 0,
    max: 1,
    curve: 0.5,
    muted: false,
    fixedValue: 0.5,
  };
}

/**
 * Load CC map from localStorage, or return default.
 * @returns {Array} CC param definitions
 */
export function loadCCMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0) return saved;
    }
  } catch (e) {
    console.warn('[MIDI CC] Failed to load map:', e);
  }
  return DEFAULT_CC_MAP.map(p => ({ ...p }));
}

/**
 * Save CC map to localStorage.
 * @param {Array} ccMap
 */
export function saveCCMap(ccMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ccMap));
  } catch (e) {
    console.warn('[MIDI CC] Failed to save map:', e);
  }
}

/**
 * Export CC map as JSON string (for sharing).
 * @param {Array} ccMap
 * @returns {string}
 */
export function exportCCMap(ccMap) {
  return JSON.stringify(ccMap, null, 2);
}

/**
 * Import CC map from JSON string.
 * @param {string} json
 * @returns {Array|null} parsed map or null on failure
 */
export function importCCMap(json) {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Validate shape
    for (const p of parsed) {
      if (typeof p.cc !== 'number' || typeof p.channel !== 'number') return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

export { CC_NAMES, DEFAULT_CC_MAP };
