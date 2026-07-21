/**
 * L18 regression (simplification audit): `WebMidiInputSource` must notify
 * `onBindingsChange` listeners only when the binding LIST changes (learn
 * capture, clearBinding, clearAllBindings) — NOT on every incoming CC value
 * update. Pre-fix, every CC message on an already-learned axis pushed a full
 * bindings-array snapshot to every listener (a React state update per MIDI
 * message in the real app, via useInputLayer.ts's `onBindingsChange`
 * subscription).
 *
 * `onMessage` is private — there is no other public seam to feed synthetic
 * MIDI bytes in, so this test invokes it through a narrow cast (a normal
 * white-box technique for a class with no public message-injection API).
 *
 * Run with `bun test tests/midi-notify-churn.test.ts` (see the `bun run test`
 * wiring note in tests/backend-manager-switch.test.ts — the same applies).
 */
import { expect, test } from 'bun:test';
import { WebMidiInputSource } from '../src/inputs/midi-input-source';

function ccMessage(cc: number, channel1based: number, value7bit: number): MIDIMessageEvent {
  const statusByte = 0xb0 | ((channel1based - 1) & 0x0f);
  return { data: new Uint8Array([statusByte, cc, value7bit]) } as unknown as MIDIMessageEvent;
}

function feedCc(midi: WebMidiInputSource, cc: number, channel: number, value7bit: number): void {
  (midi as unknown as { onMessage(e: MIDIMessageEvent): void }).onMessage(ccMessage(cc, channel, value7bit));
}

test('repeated CC value updates on an EXISTING binding do not re-notify', () => {
  const midi = new WebMidiInputSource();
  let notifyCount = 0;
  midi.onBindingsChange(() => {
    notifyCount++;
  });

  midi.armLearn(true);
  feedCc(midi, 74, 1, 10); // new axis captured — the list changed → 1 notify
  expect(notifyCount).toBe(1);
  midi.armLearn(false);

  // Flood the SAME learned CC with 50 more value updates (the "wiggle a
  // fader" case that used to flood React with one state update each).
  for (let v = 0; v < 50; v++) feedCc(midi, 74, 1, v);

  expect(notifyCount).toBe(1); // still just the one list-change notify
  expect(midi.getBindings()[0].value).toBeCloseTo(49 / 127, 5); // value still latches
});

test('learn capture / clearBinding / clearAllBindings still notify (the list DID change)', () => {
  const midi = new WebMidiInputSource();
  let notifyCount = 0;
  midi.onBindingsChange(() => {
    notifyCount++;
  });

  midi.armLearn(true);
  feedCc(midi, 1, 1, 10);
  feedCc(midi, 2, 1, 20);
  expect(notifyCount).toBe(2); // two NEW axes captured
  midi.armLearn(false);

  midi.clearBinding(0);
  expect(notifyCount).toBe(3);
  midi.clearAllBindings();
  expect(notifyCount).toBe(4);
});

test('note gate updates never notify (no note binding can ever be created)', () => {
  const midi = new WebMidiInputSource();
  let notifyCount = 0;
  midi.onBindingsChange(() => {
    notifyCount++;
  });

  // Note ON then OFF, repeatedly — no path creates a 'note' binding, so the
  // list never changes and this must never notify.
  const noteOn = { data: new Uint8Array([0x90, 60, 100]) } as unknown as MIDIMessageEvent;
  const noteOff = { data: new Uint8Array([0x80, 60, 0]) } as unknown as MIDIMessageEvent;
  const inject = midi as unknown as { onMessage(e: MIDIMessageEvent): void };
  for (let i = 0; i < 10; i++) {
    inject.onMessage(noteOn);
    inject.onMessage(noteOff);
  }

  expect(notifyCount).toBe(0);
});
