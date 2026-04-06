/**
 * Tests for the midiNote field on pattern step data structures.
 *
 * Covers: createStep, clonePattern, setStep, validatePattern,
 * mergePatterns, and IntervalLock.process() behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStep, createPattern, clonePattern,
  mergePatterns, setStep, validatePattern,
} from '../pattern.js';

import { IntervalLock } from '../primitives.js';
import { createPRNG } from '../prng.js';

// ── createStep ──────────────────────────────────────────────────────

describe('createStep – midiNote', () => {
  it('has midiNote: null by default', () => {
    const step = createStep();
    assert.strictEqual(step.midiNote, null);
  });
});

// ── clonePattern ────────────────────────────────────────────────────

describe('clonePattern – midiNote', () => {
  it('preserves midiNote across clone', () => {
    const p = createPattern(2);
    p.steps[0].midiNote = 60;
    p.steps[1].midiNote = null;

    const c = clonePattern(p);
    assert.strictEqual(c.steps[0].midiNote, 60);
    assert.strictEqual(c.steps[1].midiNote, null);
  });

  it('clone is independent (mutation does not propagate)', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 72;
    const c = clonePattern(p);
    c.steps[0].midiNote = 48;
    assert.strictEqual(p.steps[0].midiNote, 72);
  });
});

// ── setStep ─────────────────────────────────────────────────────────

describe('setStep – midiNote', () => {
  it('can set midiNote to an integer', () => {
    const p = createPattern(1);
    setStep(p, 0, { midiNote: 64 });
    assert.strictEqual(p.steps[0].midiNote, 64);
  });

  it('can set midiNote to null', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 60;
    setStep(p, 0, { midiNote: null });
    assert.strictEqual(p.steps[0].midiNote, null);
  });

  it('coerces midiNote to integer', () => {
    const p = createPattern(1);
    setStep(p, 0, { midiNote: 60.9 });
    assert.strictEqual(p.steps[0].midiNote, 60);
  });

  it('does not touch midiNote when not in stepData', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 72;
    setStep(p, 0, { pitch: 0.3 });
    assert.strictEqual(p.steps[0].midiNote, 72);
  });
});

// ── validatePattern ─────────────────────────────────────────────────

describe('validatePattern – midiNote', () => {
  it('accepts midiNote: null', () => {
    const p = createPattern(1);
    assert.strictEqual(validatePattern(p), true);
  });

  it('accepts midiNote: 0', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 0;
    assert.strictEqual(validatePattern(p), true);
  });

  it('accepts midiNote: 127', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 127;
    assert.strictEqual(validatePattern(p), true);
  });

  it('accepts midiNote: 60 (middle C)', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 60;
    assert.strictEqual(validatePattern(p), true);
  });

  it('rejects midiNote: float (60.5)', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 60.5;
    assert.strictEqual(validatePattern(p), false);
  });

  it('rejects midiNote: -1', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = -1;
    assert.strictEqual(validatePattern(p), false);
  });

  it('rejects midiNote: 128', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 128;
    assert.strictEqual(validatePattern(p), false);
  });

  it('rejects midiNote: string', () => {
    const p = createPattern(1);
    p.steps[0].midiNote = 'C4';
    assert.strictEqual(validatePattern(p), false);
  });
});

// ── mergePatterns ───────────────────────────────────────────────────

describe('mergePatterns – midiNote', () => {
  it('both triggered, both have midiNote → average rounded', () => {
    const a = createPattern(1);
    setStep(a, 0, { trigger: true, midiNote: 60 });
    const b = createPattern(1);
    setStep(b, 0, { trigger: true, midiNote: 65 });

    const m = mergePatterns(a, b, 'additive');
    // (60 + 65) / 2 = 62.5 → 63
    assert.strictEqual(m.steps[0].midiNote, 63);
  });

  it('both triggered, only A has midiNote → use A', () => {
    const a = createPattern(1);
    setStep(a, 0, { trigger: true, midiNote: 72 });
    const b = createPattern(1);
    setStep(b, 0, { trigger: true });

    const m = mergePatterns(a, b, 'additive');
    assert.strictEqual(m.steps[0].midiNote, 72);
  });

  it('both triggered, only B has midiNote → use B', () => {
    const a = createPattern(1);
    setStep(a, 0, { trigger: true });
    const b = createPattern(1);
    setStep(b, 0, { trigger: true, midiNote: 48 });

    const m = mergePatterns(a, b, 'additive');
    assert.strictEqual(m.steps[0].midiNote, 48);
  });

  it('both triggered, neither has midiNote → null', () => {
    const a = createPattern(1);
    setStep(a, 0, { trigger: true });
    const b = createPattern(1);
    setStep(b, 0, { trigger: true });

    const m = mergePatterns(a, b, 'additive');
    assert.strictEqual(m.steps[0].midiNote, null);
  });

  it('only A triggered → uses A midiNote', () => {
    const a = createPattern(1);
    setStep(a, 0, { trigger: true, midiNote: 55 });
    const b = createPattern(1);
    // b not triggered (default)

    const m = mergePatterns(a, b, 'additive');
    assert.strictEqual(m.steps[0].midiNote, 55);
  });

  it('only B triggered → uses B midiNote', () => {
    const a = createPattern(1);
    // a not triggered
    const b = createPattern(1);
    setStep(b, 0, { trigger: true, midiNote: 80 });

    const m = mergePatterns(a, b, 'additive');
    assert.strictEqual(m.steps[0].midiNote, 80);
  });

  it('neither triggered → null', () => {
    const a = createPattern(1);
    const b = createPattern(1);

    const m = mergePatterns(a, b, 'additive');
    assert.strictEqual(m.steps[0].midiNote, null);
  });
});

// ── IntervalLock.process() ──────────────────────────────────────────

describe('IntervalLock – midiNote field', () => {
  it('sets midiNote as integer and leaves pitch as [0,1]', () => {
    const lock = new IntervalLock();
    const rng = createPRNG(42);

    // Create a pattern with a triggered step at pitch 0.5
    const input = createPattern(1);
    setStep(input, 0, { trigger: true, pitch: 0.5 });

    // root=0 (C), mode=0.1 (major), octaveRange=0.25 (1 octave)
    const result = lock.process([0.0, 0.1, 0.25], input, {}, rng);
    const step = result.patternDesc.steps[0];

    // midiNote should be an integer (a MIDI note from the C major scale)
    assert.strictEqual(typeof step.midiNote, 'number');
    assert.strictEqual(step.midiNote, step.midiNote | 0, 'midiNote should be integer');
    assert.ok(step.midiNote >= 0 && step.midiNote <= 127, 'midiNote in MIDI range');

    // pitch should remain a [0,1] float (the original pre-quantization value)
    assert.strictEqual(step.pitch, 0.5, 'pitch should be unchanged from input');
  });

  it('produces different midiNote values for different pitch inputs', () => {
    const lock = new IntervalLock();
    const rng = createPRNG(42);

    const input = createPattern(2);
    setStep(input, 0, { trigger: true, pitch: 0.0 });
    setStep(input, 1, { trigger: true, pitch: 1.0 });

    const result = lock.process([0.0, 0.1, 0.5], input, {}, rng);
    const note0 = result.patternDesc.steps[0].midiNote;
    const note1 = result.patternDesc.steps[1].midiNote;

    assert.notStrictEqual(note0, note1, 'different pitches should produce different MIDI notes');
    assert.ok(note0 < note1, 'higher pitch should produce higher MIDI note');
  });
});
