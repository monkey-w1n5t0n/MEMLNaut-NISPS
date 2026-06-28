/**
 * Minimal Web MIDI API type declarations (the `@types/webmidi` package is not a
 * dependency). Covers only the surface midi-backend.ts uses: requestMIDIAccess,
 * the outputs map, and MIDIOutput.send. Feature-detected at runtime.
 */

interface MIDIOutput {
  readonly id: string;
  readonly name?: string | null;
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

interface MIDIOutputMap {
  forEach(cb: (value: MIDIOutput, key: string, map: MIDIOutputMap) => void): void;
  get(id: string): MIDIOutput | undefined;
  readonly size: number;
  [Symbol.iterator](): IterableIterator<[string, MIDIOutput]>;
}

interface MIDIAccess {
  readonly outputs: MIDIOutputMap;
  onstatechange: ((this: MIDIAccess, ev: Event) => void) | null;
}

interface MIDIOptions {
  sysex?: boolean;
  software?: boolean;
}

interface Navigator {
  requestMIDIAccess?(options?: MIDIOptions): Promise<MIDIAccess>;
}
