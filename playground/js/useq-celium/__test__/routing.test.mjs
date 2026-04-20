// Tests for ChannelRouter. Run with:
//   node playground/js/useq-celium/__test__/routing.test.mjs

import {
  ChannelRouter,
  CHANNEL_COUNT,
  HARD_GATE_COUNT,
  MAIN_CV_COUNT,
  EXP_CV_COUNT,
  CV_COUNT,
} from '../routing.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('  ok :', msg); }
};

// ---------------------------------------------------------------------------
// Default config produces expected output
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  const defs = router.getAllConfigs();
  assert(defs.length === CHANNEL_COUNT, `default has ${CHANNEL_COUNT} configs`);
  for (let i = 0; i < HARD_GATE_COUNT; i++) {
    assert(defs[i].mode === 'gate' && defs[i].source === `voice-${i}`,
      `gate ${i} default → voice-${i}`);
  }
  for (let i = 0; i < CV_COUNT; i++) {
    const idx = HARD_GATE_COUNT + i;
    assert(defs[idx].mode === 'continuous' && defs[idx].source === `cv-mlp-${i}`,
      `cv ${idx} default → cv-mlp-${i} continuous`);
  }

  // Mock voice state + cv outputs
  const voiceState = {
    gates: [true, false, true, false], // 4 voices
    velocities: [1.0, 0.5, 0.5, 1.0],
  };
  const cvOutputs = new Float32Array(CV_COUNT);
  for (let i = 0; i < CV_COUNT; i++) cvOutputs[i] = (i + 1) / 12;

  const out = router.compute(voiceState, cvOutputs);
  assert(out.gates.length === HARD_GATE_COUNT, 'gates length === 3');
  assert(out.cvMain.length === MAIN_CV_COUNT, 'cvMain length === 3');
  assert(out.cvExp.length === EXP_CV_COUNT, 'cvExp length === 8');
  assert(out.gates[0] === true && out.gates[1] === false && out.gates[2] === true,
    'gates follow voice gates in default routing');
  for (let i = 0; i < MAIN_CV_COUNT; i++) {
    assert(Math.abs(out.cvMain[i] - cvOutputs[i]) < 1e-7,
      `cvMain[${i}] === cvOutputs[${i}]`);
  }
  for (let i = 0; i < EXP_CV_COUNT; i++) {
    assert(Math.abs(out.cvExp[i] - cvOutputs[MAIN_CV_COUNT + i]) < 1e-7,
      `cvExp[${i}] === cvOutputs[${MAIN_CV_COUNT + i}]`);
  }
}

// ---------------------------------------------------------------------------
// Mode: gate
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  router.setChannelConfig(0, { mode: 'gate', source: 'voice-2' });
  router.setChannelConfig(1, { mode: 'gate', source: 'none' });
  const out = router.compute(
    { gates: [false, false, true, false], velocities: [0, 0, 1, 0] },
    null,
  );
  assert(out.gates[0] === true,  'gate 0 → voice-2 is on');
  assert(out.gates[1] === false, 'gate 1 → none is off');
}

// ---------------------------------------------------------------------------
// Mode: continuous
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  // CV M1 (idx 3) → static 0.42
  router.setChannelConfig(3, { mode: 'continuous', source: 'static', staticValue: 0.42 });
  // CV M2 (idx 4) → cv-mlp-5
  router.setChannelConfig(4, { mode: 'continuous', source: 'cv-mlp-5' });

  const cvOutputs = new Float32Array(CV_COUNT);
  for (let i = 0; i < CV_COUNT; i++) cvOutputs[i] = 0.1 * (i + 1);

  const out = router.compute(
    { gates: [false, false, false, false], velocities: [0, 0, 0, 0] },
    cvOutputs,
  );
  assert(Math.abs(out.cvMain[0] - 0.42) < 1e-7, 'cvMain[0] static value → 0.42');
  assert(Math.abs(out.cvMain[1] - cvOutputs[5]) < 1e-7, 'cvMain[1] → cvOutputs[5]');
}

// ---------------------------------------------------------------------------
// Mode: dynamic-gate — velocity when gate on, 0 otherwise
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  // CV E1 (idx 6) → dynamic-gate voice-1
  router.setChannelConfig(6, { mode: 'dynamic-gate', source: 'voice-1' });

  const offOut = router.compute(
    { gates: [false, false, false, false], velocities: [0, 0, 0, 0] },
    new Float32Array(CV_COUNT),
  );
  assert(offOut.cvExp[0] === 0, 'dynamic-gate → 0 when gate off');

  const onOut = router.compute(
    { gates: [false, true, false, false], velocities: [0, 0.5, 0, 0] },
    new Float32Array(CV_COUNT),
  );
  assert(Math.abs(onOut.cvExp[0] - 0.5) < 1e-7, 'dynamic-gate → velocity when gate on');

  const onHighOut = router.compute(
    { gates: [false, true, false, false], velocities: [0, 1.0, 0, 0] },
    new Float32Array(CV_COUNT),
  );
  assert(Math.abs(onHighOut.cvExp[0] - 1.0) < 1e-7, 'dynamic-gate follows high velocity');
}

// ---------------------------------------------------------------------------
// Out-of-range voice index → 0
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  router.setChannelConfig(0, { mode: 'gate', source: 'voice-3' });
  // Only 2 voices active.
  const out = router.compute(
    { gates: [true, true], velocities: [1, 1] },
    null,
  );
  assert(out.gates[0] === false, 'voice index >= voiceCount → 0');
}

// ---------------------------------------------------------------------------
// Null cvOutputs → 0 for continuous-mode channels
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  // Default: CV M1 → cv-mlp-0 continuous
  const out = router.compute(
    { gates: [false, false, false, false], velocities: [0, 0, 0, 0] },
    null,
  );
  assert(out.cvMain[0] === 0, 'null cvOutputs + continuous → 0');
  assert(out.cvMain[1] === 0, 'null cvOutputs + continuous → 0');
  // Static should still produce value.
  router.setChannelConfig(3, { mode: 'continuous', source: 'static', staticValue: 0.5 });
  const out2 = router.compute(
    { gates: [false, false, false, false], velocities: [0, 0, 0, 0] },
    null,
  );
  assert(Math.abs(out2.cvMain[0] - 0.5) < 1e-7, 'static source still works w/ null cvOutputs');
}

// ---------------------------------------------------------------------------
// Validation: gate channel rejecting continuous mode
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  let threw = false;
  try { router.setChannelConfig(0, { mode: 'continuous', source: 'cv-mlp-0' }); }
  catch { threw = true; }
  assert(threw, 'gate channel rejects continuous mode');

  threw = false;
  try { router.setChannelConfig(5, { mode: 'gate', source: 'voice-0' }); }
  catch { threw = true; }
  assert(threw, 'cv channel rejects gate mode');

  threw = false;
  try { router.setChannelConfig(0, { mode: 'gate', source: 'voice-9' }); }
  catch { threw = true; }
  assert(threw, 'invalid voice index rejected at set time');

  threw = false;
  try { router.setChannelConfig(3, { mode: 'continuous', source: 'cv-mlp-99' }); }
  catch { threw = true; }
  assert(threw, 'invalid cv-mlp index rejected at set time');
}

// ---------------------------------------------------------------------------
// Clamping: continuous values outside [0,1]
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  const cvOutputs = new Float32Array(CV_COUNT);
  cvOutputs[0] = 1.5;  // out of range
  cvOutputs[1] = -0.3; // out of range
  cvOutputs[2] = NaN;
  const out = router.compute({ gates: [false, false, false, false], velocities: [0, 0, 0, 0] }, cvOutputs);
  assert(out.cvMain[0] === 1, 'cvMain[0] clamped to 1');
  assert(out.cvMain[1] === 0, 'cvMain[1] clamped to 0');
  assert(out.cvMain[2] === 0, 'cvMain[2] NaN → 0');
}

// ---------------------------------------------------------------------------
// importConfigs round-trip
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  router.setChannelConfig(0, { mode: 'gate', source: 'voice-1' });
  router.setChannelConfig(5, { mode: 'dynamic-gate', source: 'voice-2' });
  const saved = router.getAllConfigs();

  const r2 = new ChannelRouter();
  r2.importConfigs(saved);
  const restored = r2.getAllConfigs();
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    assert(restored[i].mode === saved[i].mode && restored[i].source === saved[i].source,
      `channel ${i} round-trips`);
  }
}

// ---------------------------------------------------------------------------
if (failed) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\nall ok');
