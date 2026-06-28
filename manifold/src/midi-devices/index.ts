/**
 * External MIDI synth device templates.
 *
 * Re-exports the codegen output (generated from schemas/midi_devices/ via
 * `bun run codegen/generate-midi-devices.ts`). Import from here, not from
 * ./generated directly, so the path stays stable if non-generated helpers are
 * added later.
 */
export * from './generated';
