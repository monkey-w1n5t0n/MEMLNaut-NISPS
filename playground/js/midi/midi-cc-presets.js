// MIDI CC Presets — bundled device configurations
// Each preset is a JSON file with { name, description, channel, params[] }

const PRESET_URLS = {
  'polybrute': './js/midi/presets/polybrute.json',
};

// In-memory cache
const _cache = new Map();

/**
 * Get list of available preset IDs and names.
 * @returns {Array<{id: string, name: string}>}
 */
export function listPresets() {
  return [
    { id: 'polybrute', name: 'Arturia PolyBrute' },
  ];
}

/**
 * Load a preset by ID. Returns the parsed preset object.
 * @param {string} id — preset identifier
 * @returns {Promise<{name: string, description: string, channel: number, params: Array}>}
 */
export async function loadPreset(id) {
  if (_cache.has(id)) return _cache.get(id);

  const url = PRESET_URLS[id];
  if (!url) throw new Error(`Unknown MIDI CC preset: ${id}`);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load preset ${id}: ${resp.status}`);

  const preset = await resp.json();
  _cache.set(id, preset);
  return preset;
}

/**
 * Load a preset from a user-provided JSON file (File object).
 * @param {File} file
 * @returns {Promise<{name: string, description: string, channel: number, params: Array}|null>}
 */
export async function loadPresetFromFile(file) {
  try {
    const text = await file.text();
    const preset = JSON.parse(text);
    if (!preset.params || !Array.isArray(preset.params) || preset.params.length === 0) {
      return null;
    }
    // Validate param shape
    for (const p of preset.params) {
      if (typeof p.cc !== 'number' || typeof p.channel !== 'number') return null;
    }
    return preset;
  } catch (e) {
    return null;
  }
}
