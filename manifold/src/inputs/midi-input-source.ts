/**
 * WebMidiInputSource — a MIDI controller as an N-axis input source (NEW).
 *
 * Uses `navigator.requestMIDIAccess()` (feature-detected; graceful degrade) and
 * listens on every input port. Incoming Control-Change and Note messages drive
 * "learned" axes:
 *
 *  - **CC axis**: a learned CC# (per channel) → its 7-bit value mapped to [0,1].
 *  - **Note axis**: a learned note → 1 while held (note-on, velocity>0), 0 on
 *    note-off. Note-on ALSO surfaces a discrete action (so a pad can fire
 *    commit/perturb without the keyboard).
 *
 * **Learn-map.** When `armLearn()` is active, the NEXT distinct CC or note seen
 * is bound to a new axis (appended). This is the standard "MIDI learn" gesture:
 * arm → wiggle the knob/pad → it captures. Axes can be cleared individually.
 * The bindings are exposed for the dock channel-layout view.
 *
 * Pull-based: messages latch the latest per-binding value into `values`;
 * `sample()` copies them out. Hot path performs no IO/allocation.
 *
 * NOTE: the canonical learn-map spec was `docs/redesign/inputs-spec.md`, which
 * is absent from this tree. The shape here follows the WebMidiBackend output
 * pattern (src/backends/midi-backend.ts) for symmetry.
 */
import { BaseSource } from './base-source';
import type { InputSourceKind } from './types';

export type MidiBindingKind = 'cc' | 'note';

export interface MidiBinding {
  kind: MidiBindingKind;
  /** CC number or note number. */
  number: number;
  /** 1-based MIDI channel (1..16). */
  channel: number;
  /** Latest normalised value ∈ [0,1]. */
  value: number;
  /** Human label ("CC74 ch1", "Note 60 ch1"). */
  label: string;
}

const STATUS_BYTE_CC = 0xb0;
const STATUS_BYTE_NOTE_ON = 0x90;
const STATUS_BYTE_NOTE_OFF = 0x80;

export class WebMidiInputSource extends BaseSource {
  readonly kind: InputSourceKind = 'midi';
  readonly label = 'MIDI';

  private access: MIDIAccess | null = null;
  private inputs: MIDIInput[] = [];
  private bindings: MidiBinding[] = [];
  private learnArmed = false;
  private bindingsListeners = new Set<(b: MidiBinding[]) => void>();

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  axisCount(): number {
    return this.bindings.length;
  }

  axisLabels(): string[] {
    return this.bindings.map((b) => b.label);
  }

  sample(out: Float32Array, offset: number): number {
    const n = this.bindings.length;
    for (let i = 0; i < n; i++) out[offset + i] = this.bindings[i].value;
    return n;
  }

  // ---- Learn-map API (consumed by the dock) -------------------------------

  /** Arm/disarm MIDI-learn: the next distinct CC/note is captured as an axis. */
  armLearn(armed: boolean): void {
    this.learnArmed = armed;
    this.setStatus(
      armed
        ? { state: 'ready', message: 'Learn armed — move a knob or hit a pad' }
        : this.readyStatus(),
    );
  }

  isLearnArmed(): boolean {
    return this.learnArmed;
  }

  getBindings(): ReadonlyArray<MidiBinding> {
    return this.bindings;
  }

  /** Remove the binding (axis) at index. */
  clearBinding(index: number): void {
    if (index < 0 || index >= this.bindings.length) return;
    this.bindings.splice(index, 1);
    this.notifyBindings();
  }

  clearAllBindings(): void {
    this.bindings = [];
    this.notifyBindings();
  }

  onBindingsChange(cb: (b: MidiBinding[]) => void): () => void {
    this.bindingsListeners.add(cb);
    return () => {
      this.bindingsListeners.delete(cb);
    };
  }

  // ---- Lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'Web MIDI not supported in this browser' });
      return;
    }
    this.setStatus({ state: 'connecting', message: 'Requesting MIDI access…' });
    try {
      this.access = await navigator.requestMIDIAccess!({ sysex: false });
      this.access.onstatechange = () => this.rewire();
      this.rewire();
      this.setStatus(this.readyStatus());
    } catch (err) {
      this.setStatus({ state: 'error', message: `MIDI access denied: ${(err as Error).message}` });
    }
  }

  stop(): void {
    for (const inp of this.inputs) inp.onmidimessage = null;
    this.inputs = [];
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.learnArmed = false;
    this.setStatus({ state: 'idle', message: 'MIDI input off' });
  }

  /** Enumerate the connected input ports (for the dock readout). */
  listInputs(): { id: string; name: string }[] {
    if (!this.access) return [];
    const out: { id: string; name: string }[] = [];
    this.access.inputs.forEach((inp, id) => out.push({ id, name: inp.name ?? `MIDI Input ${id}` }));
    return out;
  }

  private rewire(): void {
    if (!this.access) return;
    for (const inp of this.inputs) inp.onmidimessage = null;
    this.inputs = [];
    this.access.inputs.forEach((inp) => {
      inp.onmidimessage = (e) => this.onMessage(e);
      this.inputs.push(inp);
    });
    if (this.statusState.state !== 'connecting') this.setStatus(this.readyStatus());
  }

  private readyStatus(): { state: 'ready'; message: string } {
    const n = this.inputs.length;
    return {
      state: 'ready',
      message: n ? `MIDI in — ${n} port${n > 1 ? 's' : ''}, ${this.bindings.length} axes` : 'MIDI ready — no input ports',
    };
  }

  private onMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    if (status === STATUS_BYTE_CC) {
      this.handleBindable('cc', d1, channel, d2 / 127);
    } else if (status === STATUS_BYTE_NOTE_ON && d2 > 0) {
      this.handleBindable('note', d1, channel, 1);
      this.emitAction({ source: this.kind, id: `note:${d1}`, label: `Note ${d1}`, value: d2 / 127 });
    } else if (status === STATUS_BYTE_NOTE_OFF || (status === STATUS_BYTE_NOTE_ON && d2 === 0)) {
      this.handleBindable('note', d1, channel, 0, /*onlyUpdate*/ true);
    }
  }

  /**
   * Route an incoming bindable message: update a matching binding's value, or —
   * if learn is armed — create a new axis binding for it.
   */
  private handleBindable(
    kind: MidiBindingKind,
    number: number,
    channel: number,
    value: number,
    onlyUpdate = false,
  ): void {
    const existing = this.bindings.find(
      (b) => b.kind === kind && b.number === number && b.channel === channel,
    );
    if (existing) {
      existing.value = value;
      this.notifyBindings();
      return;
    }
    if (onlyUpdate) return; // note-off for an unbound note: ignore
    if (this.learnArmed) {
      const label =
        kind === 'cc' ? `CC${number} ch${channel}` : `Note ${number} ch${channel}`;
      this.bindings.push({ kind, number, channel, value, label });
      this.learnArmed = false; // learn one binding per arm
      this.setStatus(this.readyStatus());
      this.notifyBindings();
    }
  }

  private notifyBindings(): void {
    const snapshot = this.bindings.map((b) => ({ ...b }));
    for (const cb of this.bindingsListeners) cb(snapshot);
  }
}
