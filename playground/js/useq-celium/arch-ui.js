// arch-ui — framework-free architecture editor for the dual-MLP setup.
//
// Mounts two <fieldset> sections (Rhythm / CV) into a container. Each lets
// the user choose output count + hidden-layer sizes. "Rebuild" validates
// inputs and dispatches an 'archchange' CustomEvent on the container. The
// caller (Round 3 wiring) is responsible for calling dualMlp.rebuildRhythm /
// rebuildCV in response.
//
//   container.addEventListener('archchange', (e) => {
//     const { role, nOutputs, hiddenLayers, voiceCount } = e.detail;
//   });
//
// Styling is minimal & inline — keep this dependency-free so it drops into
// any page.

const DEFAULTS = {
  rhythm: { voiceCount: 4, hiddenLayers: [16, 24] },
  cv:     { nOutputs: 11, hiddenLayers: [24, 32] },
};

const RHYTHM_MIN_VOICES = 1;
const RHYTHM_MAX_VOICES = 4;
const CV_MIN_OUTPUTS = 1;
const CV_MAX_OUTPUTS = 11;

const HIDDEN_LAYER_MAX = 1024;

function parseHiddenLayers(text) {
  const parts = String(text || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length === 0) return null;
  const nums = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = parseInt(p, 10);
    if (!Number.isFinite(n) || n <= 0 || n > HIDDEN_LAYER_MAX) return null;
    nums.push(n);
  }
  return nums;
}

function makeField(label, input) {
  const row = document.createElement('label');
  row.style.display = 'flex';
  row.style.flexDirection = 'column';
  row.style.gap = '4px';
  row.style.marginBottom = '8px';
  row.style.fontSize = '12px';
  const span = document.createElement('span');
  span.textContent = label;
  row.appendChild(span);
  row.appendChild(input);
  return row;
}

function flash(input) {
  const prev = input.style.borderColor;
  input.style.borderColor = '#e55';
  input.style.backgroundColor = '#fee';
  setTimeout(() => {
    input.style.borderColor = prev || '';
    input.style.backgroundColor = '';
  }, 900);
}

/**
 * Mount the architecture editor.
 *
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @param {{rhythm?: {voiceCount:number, hiddenLayers:number[]}, cv?: {nOutputs:number, hiddenLayers:number[]}}} [opts.initial]
 * @returns {{ setDefaults: Function, destroy: Function }}
 */
export function mountArchUI(container, opts = {}) {
  if (!container) throw new Error('mountArchUI: container is required');
  const initial = {
    rhythm: { ...DEFAULTS.rhythm, ...(opts.initial?.rhythm || {}) },
    cv:     { ...DEFAULTS.cv,     ...(opts.initial?.cv     || {}) },
  };

  container.classList.add('useq-arch-ui');

  // ---- Rhythm fieldset --------------------------------------------------
  const rhythmFs = document.createElement('fieldset');
  rhythmFs.style.marginBottom = '12px';
  rhythmFs.style.padding = '8px 10px';
  const rhythmLegend = document.createElement('legend');
  rhythmLegend.textContent = 'Rhythm';
  rhythmFs.appendChild(rhythmLegend);

  const rhythmVoices = document.createElement('input');
  rhythmVoices.type = 'number';
  rhythmVoices.min = String(RHYTHM_MIN_VOICES);
  rhythmVoices.max = String(RHYTHM_MAX_VOICES);
  rhythmVoices.value = String(initial.rhythm.voiceCount ?? 4);
  rhythmVoices.style.width = '80px';

  const rhythmHidden = document.createElement('input');
  rhythmHidden.type = 'text';
  rhythmHidden.placeholder = 'e.g. 16,24';
  rhythmHidden.value = (initial.rhythm.hiddenLayers || DEFAULTS.rhythm.hiddenLayers).join(',');
  rhythmHidden.style.width = '180px';

  const rhythmBtn = document.createElement('button');
  rhythmBtn.type = 'button';
  rhythmBtn.textContent = 'Rebuild';

  rhythmFs.appendChild(makeField('Voices (1–4)', rhythmVoices));
  rhythmFs.appendChild(makeField('Hidden layers (comma-separated ints)', rhythmHidden));
  rhythmFs.appendChild(rhythmBtn);

  // ---- CV fieldset ------------------------------------------------------
  const cvFs = document.createElement('fieldset');
  cvFs.style.padding = '8px 10px';
  const cvLegend = document.createElement('legend');
  cvLegend.textContent = 'CV';
  cvFs.appendChild(cvLegend);

  const cvOutputs = document.createElement('input');
  cvOutputs.type = 'number';
  cvOutputs.min = String(CV_MIN_OUTPUTS);
  cvOutputs.max = String(CV_MAX_OUTPUTS);
  cvOutputs.value = String(initial.cv.nOutputs ?? 11);
  cvOutputs.style.width = '80px';

  const cvHidden = document.createElement('input');
  cvHidden.type = 'text';
  cvHidden.placeholder = 'e.g. 24,32';
  cvHidden.value = (initial.cv.hiddenLayers || DEFAULTS.cv.hiddenLayers).join(',');
  cvHidden.style.width = '180px';

  const cvBtn = document.createElement('button');
  cvBtn.type = 'button';
  cvBtn.textContent = 'Rebuild';

  cvFs.appendChild(makeField('CV channels (1–11)', cvOutputs));
  cvFs.appendChild(makeField('Hidden layers (comma-separated ints)', cvHidden));
  cvFs.appendChild(cvBtn);

  container.appendChild(rhythmFs);
  container.appendChild(cvFs);

  // ---- Handlers ---------------------------------------------------------
  function onRhythmClick() {
    const hidden = parseHiddenLayers(rhythmHidden.value);
    if (!hidden) { flash(rhythmHidden); return; }
    const voiceCount = parseInt(rhythmVoices.value, 10);
    if (!Number.isInteger(voiceCount) || voiceCount < RHYTHM_MIN_VOICES || voiceCount > RHYTHM_MAX_VOICES) {
      flash(rhythmVoices); return;
    }
    // Voice count maps to output count 1:1 at this level — callers can
    // reinterpret (e.g. 2 outputs per voice) if they want.
    const nOutputs = voiceCount;
    container.dispatchEvent(new CustomEvent('archchange', {
      detail: { role: 'rhythm', nOutputs, hiddenLayers: hidden, voiceCount },
    }));
  }

  function onCVClick() {
    const hidden = parseHiddenLayers(cvHidden.value);
    if (!hidden) { flash(cvHidden); return; }
    const nOutputs = parseInt(cvOutputs.value, 10);
    if (!Number.isInteger(nOutputs) || nOutputs < CV_MIN_OUTPUTS || nOutputs > CV_MAX_OUTPUTS) {
      flash(cvOutputs); return;
    }
    container.dispatchEvent(new CustomEvent('archchange', {
      detail: { role: 'cv', nOutputs, hiddenLayers: hidden },
    }));
  }

  rhythmBtn.addEventListener('click', onRhythmClick);
  cvBtn.addEventListener('click', onCVClick);

  // ---- Public handle ---------------------------------------------------
  return {
    setDefaults(newDefaults) {
      if (!newDefaults) return;
      if (newDefaults.rhythm) {
        if (Number.isInteger(newDefaults.rhythm.voiceCount)) {
          rhythmVoices.value = String(newDefaults.rhythm.voiceCount);
        }
        if (Array.isArray(newDefaults.rhythm.hiddenLayers)) {
          rhythmHidden.value = newDefaults.rhythm.hiddenLayers.join(',');
        }
      }
      if (newDefaults.cv) {
        if (Number.isInteger(newDefaults.cv.nOutputs)) {
          cvOutputs.value = String(newDefaults.cv.nOutputs);
        }
        if (Array.isArray(newDefaults.cv.hiddenLayers)) {
          cvHidden.value = newDefaults.cv.hiddenLayers.join(',');
        }
      }
    },
    destroy() {
      rhythmBtn.removeEventListener('click', onRhythmClick);
      cvBtn.removeEventListener('click', onCVClick);
      if (rhythmFs.parentNode) rhythmFs.parentNode.removeChild(rhythmFs);
      if (cvFs.parentNode) cvFs.parentNode.removeChild(cvFs);
      container.classList.remove('useq-arch-ui');
    },
  };
}
