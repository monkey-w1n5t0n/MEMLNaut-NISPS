// training-ui — framework-free training controls for the dual-MLP.
//
// Mounts a row of action buttons + a live status line. Buttons call into the
// passed-in DualMLPManager directly (no event-routing indirection — this
// module is intentionally coupled to dualMlp). Status updates reactively via
// 'trainingdone' / 'rhythmoutputs' / 'cvoutputs' events.

const STYLE_BTN = {
  padding: '6px 10px',
  marginRight: '6px',
  fontSize: '12px',
  cursor: 'pointer',
};

function mkBtn(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  Object.assign(b.style, STYLE_BTN);
  return b;
}

function fmt(loss) {
  if (loss === null || loss === undefined || !Number.isFinite(loss)) return '—';
  return loss.toFixed(3);
}

/**
 * Mount the training UI.
 *
 * @param {HTMLElement} container
 * @param {import('./dual-mlp.js').DualMLPManager} dualMlp
 * @returns {{ destroy: Function }}
 */
export function mountTrainingUI(container, dualMlp) {
  if (!container) throw new Error('mountTrainingUI: container is required');
  if (!dualMlp) throw new Error('mountTrainingUI: dualMlp is required');

  container.classList.add('useq-training-ui');

  const btnRow = document.createElement('div');
  btnRow.style.marginBottom = '8px';

  const btnUp       = mkBtn('Thumbs \u25B2');
  const btnDown     = mkBtn('Thumbs \u25BC');
  const btnAdd      = mkBtn('Add Example');
  const btnClear    = mkBtn('Clear Examples');
  const btnRandom   = mkBtn('Randomise');

  btnRow.appendChild(btnUp);
  btnRow.appendChild(btnDown);
  btnRow.appendChild(btnAdd);
  btnRow.appendChild(btnClear);
  btnRow.appendChild(btnRandom);

  const status = document.createElement('div');
  status.style.fontSize = '12px';
  status.style.fontFamily = 'monospace';
  status.style.color = '#444';
  status.textContent = 'examples: 0 · rhythm loss: — · cv loss: —';

  container.appendChild(btnRow);
  container.appendChild(status);

  // ---- State ----------------------------------------------------------------
  let rhythmLoss = null;
  let cvLoss = null;

  function refreshStatus() {
    const ex = Math.min(
      dualMlp.rhythm?.exampleCount?.() ?? 0,
      dualMlp.cv?.exampleCount?.() ?? 0,
    );
    // Display the minimum (both advance together via thumbsUp); fallback to
    // rhythm's if cv absent.
    status.textContent = `examples: ${ex} · rhythm loss: ${fmt(rhythmLoss)} · cv loss: ${fmt(cvLoss)}`;
  }

  // ---- Button handlers -----------------------------------------------------
  function setBusy(v) {
    const buttons = [btnUp, btnDown, btnAdd, btnClear, btnRandom];
    for (const b of buttons) b.disabled = v;
  }

  async function onUp() {
    setBusy(true);
    try { await dualMlp.thumbsUp(); }
    catch (err) { console.warn('[training-ui] thumbsUp error:', err); }
    finally { setBusy(false); refreshStatus(); }
  }

  async function onDown() {
    setBusy(true);
    try { await dualMlp.thumbsDown(); }
    catch (err) { console.warn('[training-ui] thumbsDown error:', err); }
    finally { setBusy(false); refreshStatus(); }
  }

  async function onAdd() {
    // Add example without training.
    const { rhythm, cv } = dualMlp.getCurrentInputs();
    const rOut = dualMlp.getRhythmOutputs();
    const cOut = dualMlp.getCVOutputs();
    if (rOut) dualMlp.rhythm.addExample([rhythm.x, rhythm.y], Array.from(rOut));
    if (cOut) dualMlp.cv.addExample([cv.x, cv.y], Array.from(cOut));
    refreshStatus();
  }

  function onClear() {
    try { dualMlp.clearExamples(); }
    catch (err) { console.warn('[training-ui] clearExamples error:', err); }
    refreshStatus();
  }

  function onRandom() {
    try {
      dualMlp.rhythm.randomiseWeights();
      dualMlp.cv.randomiseWeights();
    } catch (err) { console.warn('[training-ui] randomise error:', err); }
  }

  btnUp.addEventListener('click', onUp);
  btnDown.addEventListener('click', onDown);
  btnAdd.addEventListener('click', onAdd);
  btnClear.addEventListener('click', onClear);
  btnRandom.addEventListener('click', onRandom);

  // ---- Event subscriptions -------------------------------------------------
  function onTrainingDone(e) {
    rhythmLoss = e.detail?.rhythmLoss ?? null;
    cvLoss = e.detail?.cvLoss ?? null;
    refreshStatus();
  }
  function onOutputs() {
    // Just refresh the example count indirectly — outputs don't change losses.
    refreshStatus();
  }

  dualMlp.addEventListener('trainingdone', onTrainingDone);
  dualMlp.addEventListener('rhythmoutputs', onOutputs);
  dualMlp.addEventListener('cvoutputs', onOutputs);

  refreshStatus();

  return {
    destroy() {
      btnUp.removeEventListener('click', onUp);
      btnDown.removeEventListener('click', onDown);
      btnAdd.removeEventListener('click', onAdd);
      btnClear.removeEventListener('click', onClear);
      btnRandom.removeEventListener('click', onRandom);
      dualMlp.removeEventListener('trainingdone', onTrainingDone);
      dualMlp.removeEventListener('rhythmoutputs', onOutputs);
      dualMlp.removeEventListener('cvoutputs', onOutputs);
      if (btnRow.parentNode) btnRow.parentNode.removeChild(btnRow);
      if (status.parentNode) status.parentNode.removeChild(status);
      container.classList.remove('useq-training-ui');
    },
  };
}
