/**
 * Tests for configurable mono/poly voice mode in ShapeSeqEngine.
 *
 * Uses lightweight mocks for C15Bridge and EventBus since the full
 * engine requires AudioContext and WASM which aren't available in Node.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We can't fully construct ShapeSeqEngine without AudioContext/WASM,
// so we test the voice mode logic by importing the class and exercising
// the parts we can reach via a minimal mock setup.

import { ShapeSeqEngine } from '../sequencer.js';

// ── Mock factories ─────────────────────────────────────────────────

function createMockC15() {
  const calls = [];
  return {
    calls,
    noteOn(note, vel) { calls.push({ type: 'noteOn', note, vel }); },
    noteOff(note) { calls.push({ type: 'noteOff', note }); },
  };
}

function createMockBus() {
  const handlers = {};
  return {
    on(event, fn) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
    },
    off(event, fn) {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter(h => h !== fn);
      }
    },
    emit(event, data) {
      if (handlers[event]) {
        for (const fn of handlers[event]) fn(data);
      }
    },
    handlers,
  };
}

function createMockAudioContext() {
  return { currentTime: 0 };
}

/**
 * Build a ShapeSeqEngine with mocks injected but WITHOUT calling init()
 * (which needs WASM). We can still test voice mode, noteOn/noteOff
 * handling, and the getter/setter since those don't depend on init.
 */
function createEngine() {
  const c15 = createMockC15();
  const bus = createMockBus();
  const audioCtx = createMockAudioContext();
  const engine = new ShapeSeqEngine({ audioContext: audioCtx, eventBus: bus, c15Bridge: c15 });
  return { engine, c15, bus };
}

// ── Voice mode getter / setter ─────────────────────────────────────

describe('voiceMode property', () => {
  it('defaults to mono', () => {
    const { engine } = createEngine();
    assert.equal(engine.voiceMode, 'mono');
  });

  it('setVoiceMode("poly") changes mode', () => {
    const { engine } = createEngine();
    engine.setVoiceMode('poly');
    assert.equal(engine.voiceMode, 'poly');
  });

  it('setVoiceMode("mono") sets back to mono', () => {
    const { engine } = createEngine();
    engine.setVoiceMode('poly');
    engine.setVoiceMode('mono');
    assert.equal(engine.voiceMode, 'mono');
  });

  it('rejects invalid values', () => {
    const { engine } = createEngine();
    assert.throws(() => engine.setVoiceMode('duophonic'), RangeError);
    assert.throws(() => engine.setVoiceMode(''), RangeError);
    assert.throws(() => engine.setVoiceMode(null), RangeError);
    assert.throws(() => engine.setVoiceMode(undefined), RangeError);
  });

  it('no-ops if mode is already set', () => {
    const { engine, c15 } = createEngine();
    // Trigger a note so _activeNotes is non-empty, then set same mode
    // — _releaseAllNotes should NOT be called (no noteOff emitted).
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    c15.calls.length = 0; // clear
    engine.setVoiceMode('mono'); // already mono
    assert.equal(c15.calls.length, 0, 'no noteOff for same-mode set');
  });
});

// ── Mono mode note handling ────────────────────────────────────────

describe('mono mode noteOn/noteOff', () => {
  let engine, c15;

  beforeEach(() => {
    ({ engine, c15 } = createEngine());
    // default is mono
  });

  it('sends noteOff for previous note before new noteOn', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });

    // Expected: noteOn(60), noteOff(60), noteOn(64)
    assert.equal(c15.calls.length, 3);
    assert.deepEqual(c15.calls[0], { type: 'noteOn', note: 60, vel: 0.8 });
    assert.deepEqual(c15.calls[1], { type: 'noteOff', note: 60 });
    assert.deepEqual(c15.calls[2], { type: 'noteOn', note: 64, vel: 0.7 });
  });

  it('first note has no preceding noteOff', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.5 });
    assert.equal(c15.calls.length, 1);
    assert.deepEqual(c15.calls[0], { type: 'noteOn', note: 60, vel: 0.5 });
  });

  it('_activeNotes contains only the latest note', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });
    // After second noteOn, only 64 should be active (60 was killed)
    assert.equal(engine._activeNotes.size, 1);
    assert.ok(engine._activeNotes.has(64));
  });
});

// ── Poly mode note handling ────────────────────────────────────────

describe('poly mode noteOn/noteOff', () => {
  let engine, c15;

  beforeEach(() => {
    ({ engine, c15 } = createEngine());
    engine.setVoiceMode('poly');
  });

  it('does NOT send noteOff before noteOn for different pitches', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });

    // Expected: noteOn(60), noteOn(64) — no noteOff
    assert.equal(c15.calls.length, 2);
    assert.deepEqual(c15.calls[0], { type: 'noteOn', note: 60, vel: 0.8 });
    assert.deepEqual(c15.calls[1], { type: 'noteOn', note: 64, vel: 0.7 });
  });

  it('tracks multiple active notes', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });
    engine._handleNoteOn({ midiNote: 67, velocity: 0.6 });

    assert.equal(engine._activeNotes.size, 3);
    assert.ok(engine._activeNotes.has(60));
    assert.ok(engine._activeNotes.has(64));
    assert.ok(engine._activeNotes.has(67));
  });

  it('retrigger: sends noteOff then noteOn for same pitch', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 60, velocity: 0.6 });

    // Expected: noteOn(60, 0.8), noteOff(60), noteOn(60, 0.6)
    assert.equal(c15.calls.length, 3);
    assert.deepEqual(c15.calls[0], { type: 'noteOn', note: 60, vel: 0.8 });
    assert.deepEqual(c15.calls[1], { type: 'noteOff', note: 60 });
    assert.deepEqual(c15.calls[2], { type: 'noteOn', note: 60, vel: 0.6 });
  });

  it('noteOff removes specific note from _activeNotes', () => {
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });
    engine._handleNoteOff({ midiNote: 60, velocity: 0 });

    assert.equal(engine._activeNotes.size, 1);
    assert.ok(engine._activeNotes.has(64));
    assert.ok(!engine._activeNotes.has(60));
  });
});

// ── releaseAllNotes ────────────────────────────────────────────────

describe('releaseAllNotes', () => {
  it('releases all notes in poly mode', () => {
    const { engine, c15 } = createEngine();
    engine.setVoiceMode('poly');

    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });
    engine._handleNoteOn({ midiNote: 67, velocity: 0.6 });
    c15.calls.length = 0;

    engine._releaseAllNotes();

    // Should have 3 noteOff calls
    const noteOffs = c15.calls.filter(c => c.type === 'noteOff');
    assert.equal(noteOffs.length, 3);
    assert.equal(engine._activeNotes.size, 0);
  });
});

// ── Mode switching cleans up ───────────────────────────────────────

describe('mode switching cleanup', () => {
  it('releases active notes when switching from poly to mono', () => {
    const { engine, c15 } = createEngine();
    engine.setVoiceMode('poly');
    engine._handleNoteOn({ midiNote: 60, velocity: 0.8 });
    engine._handleNoteOn({ midiNote: 64, velocity: 0.7 });
    c15.calls.length = 0;

    engine.setVoiceMode('mono');

    const noteOffs = c15.calls.filter(c => c.type === 'noteOff');
    assert.equal(noteOffs.length, 2);
    assert.equal(engine._activeNotes.size, 0);
  });
});
