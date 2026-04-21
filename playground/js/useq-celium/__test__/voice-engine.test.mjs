// Tests for ratio-seq.js + voice-engine.js.
//
// Run with:
//   node playground/js/useq-celium/__test__/voice-engine.test.mjs
//
// No browser globals — pure Node ESM. Exits 1 on any failure.

import { ratioSeq, sumRatios } from '../ratio-seq.js';
import { VoiceEngine } from '../voice-engine.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('  ok :', msg);
  }
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// ratioSeq — canonical vectors
// ---------------------------------------------------------------------------
// ratios = [1, 2, 1], ratioSum = 4, pulseWidth = 0.5, phaseOffset = 0
//   Beats: [0, 1/4) on-portion [0, 1/8)   → phasor ∈ [0, 0.125)   on
//          [1/4, 3/4) on-portion [1/4, 1/2) → phasor ∈ [0.25, 0.5)  on
//          [3/4, 1) on-portion [3/4, 7/8) → phasor ∈ [0.75, 0.875) on
// Values pre-computed by walking the algorithm by hand (see comments in source).
{
  const ratios = [1, 2, 1];
  const sum = sumRatios(ratios);
  assert(sum === 4, 'sumRatios([1,2,1]) == 4');

  // Walk-through: phaseAdj = 4 * (phasor + phaseOffset). The first ratio i
  // where phaseAdj ≤ accumulatedSum "wins"; beatPhase = (phaseAdj - prevSum)/span.
  // Exact integer phaseAdj values land on beat boundaries — `≤` puts them at
  // the END of the previous beat (beatPhase=1 = off with pw=0.5).
  //   phasor=0.25 → phaseAdj=1.0 → beat 0, beatPhase=1.0 > 0.5 → off
  //   phasor=0.75 → phaseAdj=3.0 → beat 1, beatPhase=1.0 > 0.5 → off
  const cases = [
    [0.00, true],    // phaseAdj=0.0 → beat 0, beatPhase=0 → on
    [0.124, true],   // phaseAdj=0.496 → beat 0, beatPhase=0.496 ≤ 0.5 → on
    [0.126, false],  // phaseAdj=0.504 → beat 0, beatPhase=0.504 > 0.5 → off
    [0.25, false],   // phaseAdj=1.0   → beat 0, beatPhase=1.0   > 0.5 → off
    [0.26, true],    // phaseAdj=1.04  → beat 1, beatPhase=0.02  ≤ 0.5 → on
    [0.50, true],    // phaseAdj=2.0   → beat 1, beatPhase=0.5   ≤ 0.5 → on
    [0.51, false],   // phaseAdj=2.04  → beat 1, beatPhase=0.52  > 0.5 → off
    [0.75, false],   // phaseAdj=3.0   → beat 1, beatPhase=1.0   > 0.5 → off
    [0.76, true],    // phaseAdj=3.04  → beat 2, beatPhase=0.04  ≤ 0.5 → on
    [0.99, false],   // phaseAdj=3.96  → beat 2, beatPhase=0.96  > 0.5 → off
  ];

  for (const [phasor, expected] of cases) {
    const got = ratioSeq(phasor, 0, sum, ratios, 0.5);
    assert(got === expected,
      `ratioSeq([1,2,1], pw=0.5, phasor=${phasor}) === ${expected} (got ${got})`);
  }
}

// ---------------------------------------------------------------------------
// ratioSeq — degenerate cases
// ---------------------------------------------------------------------------

// Single ratio [1]: one uniform beat covering [0,1). Gate on when phasor ≤ pw.
{
  const r = [1];
  const s = sumRatios(r);
  assert(ratioSeq(0.1, 0, s, r, 0.5) === true,  'single ratio: phasor=0.1, pw=0.5 → on');
  assert(ratioSeq(0.49, 0, s, r, 0.5) === true, 'single ratio: phasor=0.49, pw=0.5 → on');
  assert(ratioSeq(0.51, 0, s, r, 0.5) === false,'single ratio: phasor=0.51, pw=0.5 → off');
  assert(ratioSeq(0.99, 0, s, r, 0.5) === false,'single ratio: phasor=0.99, pw=0.5 → off');
}

// pulseWidth=0: never on mid-beat (beatPhase > 0 always).
{
  const r = [1, 2, 1];
  const s = sumRatios(r);
  for (const p of [0.1, 0.3, 0.6, 0.8]) {
    assert(ratioSeq(p, 0, s, r, 0) === false, `pulseWidth=0 off at phasor=${p}`);
  }
}

// pulseWidth=1: always on (beatPhase ∈ [0,1], always ≤ 1).
{
  const r = [1, 2, 1];
  const s = sumRatios(r);
  for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.999]) {
    assert(ratioSeq(p, 0, s, r, 1) === true, `pulseWidth=1 on at phasor=${p}`);
  }
}

// phaseOffset wrap: offset=0.5 + phasor=0.5 → wraps to 0 → beat 0 on.
{
  const r = [1, 2, 1];
  const s = sumRatios(r);
  assert(ratioSeq(0.5, 0.5, s, r, 0.5) === true,
    'phaseOffset=0.5 + phasor=0.5 wraps to 0 → on');
  // offset=0.75 + phasor=0.51 → 1.26 → wraps to 0.26 → phaseAdj=1.04 → beat 1,
  // beatPhase=0.02 ≤ 0.5 → on (confirms wrap happened, off->on transition).
  assert(ratioSeq(0.51, 0.75, s, r, 0.5) === true,
    'phaseOffset=0.75 + phasor=0.51 wraps to 0.26 → on');
  // Without wrap check: offset=0.75 + phasor=0.1 → 0.85 → phaseAdj=3.4 →
  // beat 2, beatPhase=0.4 ≤ 0.5 → on.
  assert(ratioSeq(0.1, 0.75, s, r, 0.5) === true,
    'phaseOffset=0.75 + phasor=0.1 (no wrap) → on');
  // offset=0.4 + phasor=0.5 → 0.9 → phaseAdj=3.6 → beat 2 beatPhase=0.6 → off
  assert(ratioSeq(0.5, 0.4, s, r, 0.5) === false,
    'phaseOffset=0.4 + phasor=0.5 → 0.9 → off');
}

// ---------------------------------------------------------------------------
// Param decode (via VoiceEngine.updateParams + inspecting tick behaviour)
// ---------------------------------------------------------------------------
// We can't directly read voice state, but we can verify decode indirectly by
// setting params and observing gate/velocity output. For decode-only checks we
// also assert via a side channel: set all voices to known params and probe
// tick at phase=0.
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });

  // v=0 → ratios all 1, phasorMul 1, phaseOffset 0, ampRatios all 1.
  // ratioSum = 3, so at masterPhase=0 we're at start of beat 0 → gate on.
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  {
    const { gates, velocities } = eng.tick(0);
    assert(gates[0] === true, 'v=0 decode: rising edge at phase=0');
    // ampRatios all 1 → ampRatioSum=2, at phase 0 beat 0 (span 1), beatPhase=0 ≤ 0.5 → highAmp=true
    assert(velocities[0] === 1.0, 'v=0 decode: highAmp → velocity 1.0');
  }
  eng.reset();

  // v=0.9999 → ratios all 4 (from guard clamp), phasorMul 8, phaseOffset 3/4,
  // ampRatios all 4.
  // At masterPhase=0 with phasorMul=8: voicePhase = 0. With phaseOffset=0.75:
  // offsetPhase = 0.75, phaseAdj = 12 * 0.75 = 9. ratios [4,4,4], accumSums:4,8,12.
  // 9 ≤ 12 (beat 2), beatPhase = (9-8)/4 = 0.25 ≤ 0.5 → gate on.
  eng.updateParams(new Float32Array([0.9999, 0.9999, 0.9999, 0.9999, 0.9999, 0.9999, 0.9999]));
  {
    const { gates } = eng.tick(0);
    assert(gates[0] === true,
      'v=0.9999 decode: phaseOffset=0.75 + voicePhase=0 → on (beat 2, beatPhase=0.25)');
  }
  eng.reset();

  // v=0.5 → ratios (0.5*3=1.5→floor=1)+1=2, phasorMul: floor(0.5*3.999999)=1 → muls[1]=2,
  // phaseOffset: floor(0.5*4)=2 → 2/4=0.5.
  // ratioSum = 6. At masterPhase=0, voicePhase = 0*2=0, offsetPhase=0.5 → phaseAdj=3.
  // ratios [2,2,2], accumSums 2,4,6. phaseAdj=3 → beat 1 (3 ≤ 4). beatPhase=(3-2)/2=0.5 ≤ 0.5 → on.
  eng.updateParams(new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
  {
    const { gates } = eng.tick(0);
    assert(gates[0] === true, 'v=0.5 decode: gate on at phase=0');
  }
}

// ---------------------------------------------------------------------------
// VoiceEngine — voiceCountChange event
// ---------------------------------------------------------------------------
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 4, timeSigBeats: 4 });
  let detail = null;
  eng.addEventListener('voiceCountChange', (e) => { detail = e.detail; });

  eng.setVoiceCount(2);
  assert(detail !== null, 'voiceCountChange fired on resize');
  assert(detail.voiceCount === 2, 'detail.voiceCount === 2');
  assert(detail.expectedParamLen === 2 * VoiceEngine.PARAMS_PER_VOICE,
    'detail.expectedParamLen === voiceCount * 7');
  assert(VoiceEngine.PARAMS_PER_VOICE === 7, 'PARAMS_PER_VOICE === 7');

  // setVoiceCount(2) again → no event (idempotent)
  detail = null;
  eng.setVoiceCount(2);
  assert(detail === null, 'setVoiceCount(same) does not fire event');

  // clamping to [1,4]
  eng.setVoiceCount(99);
  assert(eng.getVoiceCount() === 4, 'setVoiceCount(99) clamped to 4');
  eng.setVoiceCount(0);
  assert(eng.getVoiceCount() === 1, 'setVoiceCount(0) clamped to 1');
}

// ---------------------------------------------------------------------------
// VoiceEngine — updateParams length validation
// ---------------------------------------------------------------------------
{
  const eng = new VoiceEngine({ voiceCount: 2 });
  let threw = false;
  try { eng.updateParams(new Float32Array(13)); } catch (_e) { threw = true; }
  assert(threw, 'updateParams rejects wrong-length (13 vs 14)');

  threw = false;
  try { eng.updateParams(new Float32Array(14)); } catch (_e) { threw = true; }
  assert(!threw, 'updateParams accepts correct length (2 voices * 7 = 14)');

  threw = false;
  try { eng.updateParams(null); } catch (_e) { threw = true; }
  assert(threw, 'updateParams rejects null');

  // After setVoiceCount the expected length should track.
  eng.setVoiceCount(3);
  threw = false;
  try { eng.updateParams(new Float32Array(14)); } catch (_e) { threw = true; }
  assert(threw, 'after setVoiceCount(3), old 14-length buffer rejected');

  threw = false;
  try { eng.updateParams(new Float32Array(21)); } catch (_e) { threw = true; }
  assert(!threw, 'after setVoiceCount(3), 21-length buffer accepted');
}

// ---------------------------------------------------------------------------
// VoiceEngine — phasor accumulation returns to 0 after 1 bar
// ---------------------------------------------------------------------------
// BPM=120, 4/4 → bar = 4 beats = 2 seconds. At 500Hz (dt=2ms) for 2s = 1000 ticks.
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  for (let i = 0; i < 1000; i++) eng.tick(2);
  // Phase should have advanced exactly one bar → back to near 0.
  const phase = eng.getPhase();
  // Accept either very close to 0 or close to 1 due to float accumulation
  // (mod in tick() wraps once phase reaches 1).
  const ok = approx(phase, 0, 1e-9) || approx(phase, 1, 1e-9);
  assert(ok, `after 1 bar, phase near 0 (got ${phase})`);
}

// ---------------------------------------------------------------------------
// VoiceEngine — single pulse per bar: 1 rising edge
// ---------------------------------------------------------------------------
// Use v=0 params → ratios [1,1,1], phasorMul=1, phaseOffset=0, pw=0.5.
// ratioSum=3, beats [0,1/3)[1/3,2/3)[2/3,1). On-portion = first half of each
// beat. The gate oscillates on/off 3x per bar (6 edges). Too many.
//
// Instead, use single-ratio config that produces exactly 1 on-portion per bar:
// We don't have a voiceCount-agnostic way to set ratios=[1] (the param array
// always decodes 3 ratios). But with all three ratios equal, the gate goes on
// at the start of each "beat-of-three" and off at the midpoint — 3 rising
// edges per bar, not 1.
//
// To get exactly 1 rising edge per bar, we need phasorMul=1 and the gate to be
// continuously high for an entire half-bar, then low. With ratios [1,1,1] and
// pulseWidth 0.5 we get 3 pulses. But with phasorMul=1 and all ratios equal
// and pulseWidth tuning... no, pw is fixed at 0.5 in this engine.
//
// We relax "exactly 1 rising edge" to "the expected number given the decoded
// params": ratios=[1,1,1] → 3 beats → 3 rising edges per bar.
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  let risingEdges = 0;
  let prevGate = false;
  // 1 full bar at dt=2ms = 1000 ticks. Iterate 999 ticks so we stay strictly
  // within the first bar (at tick 1000 phase wraps back to 0 and triggers a
  // 4th rising edge that's really the START of bar 2).
  for (let i = 0; i < 999; i++) {
    const { gates } = eng.tick(2);
    if (gates[0] && !prevGate) risingEdges++;
    prevGate = gates[0];
  }
  assert(risingEdges === 3,
    `ratios=[1,1,1], phasorMul=1 → 3 rising edges per bar (got ${risingEdges})`);
}

// Single rising edge per bar: phasorMul=1, 3 beats with ratios [1,1,1] gives 3
// gate regions per bar, but with phasorMul=2 we'd see 6. What we actually want
// is just to verify the edge counter on a known config. We already did.

// ---------------------------------------------------------------------------
// VoiceEngine — velocity semantics
// ---------------------------------------------------------------------------
// Constant highAmp: ampRatios also [1,1], pulseWidth_amp=0.5 fixed, so amp
// beat-phase ≤ 0.5 half the time. To get always-high, we need ampRatioSum
// such that every rising edge of the gate falls on an "amp-high" section.
//
// Simpler: rising edges of the gate happen at voicePhase matching beat
// boundaries (0, 1/3, 2/3 for ratios [1,1,1]). At those points, the amp
// divider with ratios [1,1] (ampRatioSum=2) evaluates: phaseAdj = 2 * voicePhase.
// At voicePhase=0 → phaseAdj=0 → beat 0, beatPhase=0 ≤ 0.5 → high.
// At voicePhase=1/3 → phaseAdj=2/3 → beat 0 (2/3 ≤ 1), beatPhase=2/3 > 0.5 → low.
// At voicePhase=2/3 → phaseAdj=4/3 → beat 1 (4/3 ≤ 2), beatPhase=1/3 ≤ 0.5 → high.
// So 2 high + 1 low per bar → velocities alternate 1.0, 0.5, 1.0.
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  const velsSeen = [];
  let prevGate = false;
  for (let i = 0; i < 999; i++) { // see above: 999 to stay inside bar 1
    const { gates, velocities } = eng.tick(2);
    if (gates[0] && !prevGate) velsSeen.push(velocities[0]);
    prevGate = gates[0];
  }
  assert(velsSeen.length === 3, `3 rising edges → 3 velocity samples (got ${velsSeen.length})`);
  assert(velsSeen[0] === 1.0, `first rising: velocity 1.0 (got ${velsSeen[0]})`);
  assert(velsSeen[1] === 0.5, `second rising: velocity 0.5 (got ${velsSeen[1]})`);
  assert(velsSeen[2] === 1.0, `third rising: velocity 1.0 (got ${velsSeen[2]})`);

  // All three velocities should be ∈ {0.5, 1.0} — no other values.
  for (const v of velsSeen) {
    assert(v === 0.5 || v === 1.0, `velocity ∈ {0.5, 1.0} (got ${v})`);
  }
}

// ---------------------------------------------------------------------------
// VoiceEngine — velocity held during gate-hold (no re-sampling mid-beat)
// ---------------------------------------------------------------------------
// On the rising edge we decide 1.0 or 0.5; during the gate-on interval we
// should NOT change velocity even if the amp divider would disagree partway
// through. Take many samples during beat 0 of ratios=[1,1,1] config and
// confirm velocity stays constant.
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  // tick(0) → rising edge at phase=0 (velocity=1.0). Next ticks advance phase
  // slightly while still in beat-0 on-portion (phase ∈ [0, 1/6)).
  const first = eng.tick(0);
  assert(first.velocities[0] === 1.0, 'initial tick: velocity 1.0');
  // Advance a little (0.5ms at BPM=120 = tiny phase bump).
  for (let i = 0; i < 10; i++) {
    const { gates, velocities } = eng.tick(0.5);
    if (gates[0]) {
      assert(velocities[0] === 1.0, 'held velocity stays 1.0 during beat-0 on');
    }
  }
}

// ---------------------------------------------------------------------------
// VoiceEngine — reset()
// ---------------------------------------------------------------------------
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  for (let i = 0; i < 100; i++) eng.tick(2);
  const phaseBefore = eng.getPhase();
  assert(phaseBefore > 0, 'phase advanced before reset');
  eng.reset();
  assert(eng.getPhase() === 0, 'reset() returns phase to 0');
  // After reset, next tick(0) should produce a fresh rising edge (lastTrig
  // cleared).
  const { gates, velocities } = eng.tick(0);
  assert(gates[0] === true && velocities[0] === 1.0,
    'reset() clears lastTrig: next tick sees rising edge, velocity 1.0');
}

// ---------------------------------------------------------------------------
// VoiceEngine — setBPM recalculates rate
// ---------------------------------------------------------------------------
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 1, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([0, 0, 0, 0, 0, 0, 0]));
  eng.setBPM(240);
  // At 240 BPM, 4/4, bar = 1 second. 500 ticks of dt=2ms = 1 second = 1 bar.
  for (let i = 0; i < 500; i++) eng.tick(2);
  const phase = eng.getPhase();
  const ok = approx(phase, 0, 1e-9) || approx(phase, 1, 1e-9);
  assert(ok, `at 240 BPM, 1 bar = 1s, phase near 0 after 500 ticks (got ${phase})`);

  assert(eng.getBPM() === 240, 'getBPM returns 240');

  let threw = false;
  try { eng.setBPM(-1); } catch (_e) { threw = true; }
  assert(threw, 'setBPM rejects bpm <= 0');
  assert(eng.getBPM() === 240, 'failed setBPM leaves bpm unchanged');
}

// ---------------------------------------------------------------------------
// VoiceEngine — phaseOffset double-application matches MEMLCelium firmware
// ---------------------------------------------------------------------------
// Per H3 in the opus47 review: voice-engine intentionally folds phaseOffset
// into voicePhase AND lets ratioSeq() add it again (matches RatioSeqEngine.hpp
// :79-81 + RatioSeq.hpp:26). This test compares the engine's gate edges over
// one bar against a tiny inline reference that mirrors that double-offset
// formula. Two voices with identical params except for phaseOffset slot
// (params[4]).
{
  // Walk a deterministic phase trajectory and compare gate sequences.
  // BPM=120, 4/4 → bar = 2s → 1000 ticks at dt=2ms.
  // Voice A: params[4] = 0       → phaseOffset = 0/4 = 0
  // Voice B: params[4] = 0.5     → phaseOffset = 2/4 = 0.5
  // ratios all 1 → ratioSum=3, ampRatios all 1 → ampRatioSum=2.
  // phasorMul slot = 0 → 1.

  const eng = new VoiceEngine({ bpm: 120, voiceCount: 2, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([
    0, 0, 0, 0, 0,   0, 0,   // voice 0: phaseOffset=0
    0, 0, 0, 0, 0.5, 0, 0,   // voice 1: phaseOffset=0.5 (decodes to 2/4)
  ]));

  // Reference impl mirroring the C++ double-offset formula.
  function refGate(masterPhase, phasorMul, phaseOffset, ratioSum, ratios, pw) {
    let voicePhase = masterPhase * phasorMul + phaseOffset;
    voicePhase -= Math.floor(voicePhase);
    let off = phaseOffset + voicePhase;
    if (off >= 1) off -= 1;
    const phaseAdj = ratioSum * off;
    let acc = 0, last = 0;
    for (let i = 0; i < ratios.length; i++) {
      acc += ratios[i];
      if (phaseAdj <= acc) {
        const span = acc - last;
        if (span <= 0) return false;
        return ((phaseAdj - last) / span) <= pw;
      }
      last = acc;
    }
    return false;
  }

  const phaseInc = (120 / 60) / 4 / 1000; // per-ms increment
  let mp = 0;
  let edgesA = 0, edgesB = 0;
  let prevA = false, prevB = false;
  for (let i = 0; i < 999; i++) {
    mp += 2 * phaseInc;
    if (mp >= 1) mp -= Math.floor(mp);
    const expectA = refGate(mp, 1, 0,   3, [1,1,1], 0.5);
    const expectB = refGate(mp, 1, 0.5, 3, [1,1,1], 0.5);
    const { gates } = eng.tick(2);
    assert(gates[0] === expectA,
      `phaseOffset double-app: voice A tick ${i} gate matches ref (got ${gates[0]}, want ${expectA})`);
    assert(gates[1] === expectB,
      `phaseOffset double-app: voice B tick ${i} gate matches ref (got ${gates[1]}, want ${expectB})`);
    if (gates[0] && !prevA) edgesA++;
    if (gates[1] && !prevB) edgesB++;
    prevA = gates[0]; prevB = gates[1];
  }
  // Sanity: with ratios [1,1,1] + phasorMul 1 we expect 3 rising edges per
  // bar regardless of phaseOffset (offset shifts the pattern in time, doesn't
  // change density). If the double-app was buggy w.r.t. wrapping we'd see 0/6.
  assert(edgesA === 3, `voice A: 3 rising edges per bar (got ${edgesA})`);
  assert(edgesB === 3, `voice B: 3 rising edges per bar (got ${edgesB})`);
}

// ---------------------------------------------------------------------------
// VoiceEngine — multi-voice smoke test
// ---------------------------------------------------------------------------
{
  const eng = new VoiceEngine({ bpm: 120, voiceCount: 3, timeSigBeats: 4 });
  eng.updateParams(new Float32Array([
    0, 0, 0, 0, 0, 0, 0,     // voice 0: all v=0
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, // voice 1: all v=0.5
    0.9999, 0.9999, 0.9999, 0.9999, 0.9999, 0.9999, 0.9999, // voice 2
  ]));
  const { gates, velocities } = eng.tick(0);
  assert(gates.length === 3, 'multi-voice: 3 gates returned');
  assert(velocities.length === 3, 'multi-voice: 3 velocities returned');
  for (let i = 0; i < 3; i++) {
    assert(typeof gates[i] === 'boolean', `multi-voice: gates[${i}] is boolean`);
    assert(typeof velocities[i] === 'number'
      && velocities[i] >= 0 && velocities[i] <= 1,
      `multi-voice: velocities[${i}] ∈ [0,1]`);
  }
}

// ---------------------------------------------------------------------------
if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nall ok');
