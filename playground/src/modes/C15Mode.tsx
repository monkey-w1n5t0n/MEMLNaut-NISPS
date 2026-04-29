/**
 * C15Mode — browser-only stub.
 *
 * The C15 (Nonlinear Labs C15) WASM synthesizer is not yet ported into the
 * SolidJS playground; only firmware modes have schemas + WASM engines so
 * far. This file exists so the mode switcher can list all eight firmware
 * modes plus a "C15" entry that surfaces a clear "TODO" rather than 404'ing.
 *
 * Stream 11+ is expected to add a `c15` schema and wire the existing
 * `playground/c15` directory into `nisps/wasm/engines/`.
 */

import { Component } from 'solid-js';

export const C15Mode: Component = () => {
  return (
    <section
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        gap: 'var(--sp-4)',
        padding: 'var(--sp-6)',
        margin: 'var(--sp-5) auto',
        'max-width': '720px',
        'background': 'var(--bg-1)',
        border: '1px dashed var(--line-strong)',
        'border-radius': 'var(--r-3)',
        color: 'var(--fg)',
        'text-align': 'center',
      }}
    >
      <h2 style={{ color: 'var(--accent-2)', margin: 0 }}>C15 mode — TODO</h2>
      <p style={{ color: 'var(--fg-mute)', margin: 0 }}>
        The C15 WASM synthesizer hasn't been ported into the SolidJS rewrite
        yet. The legacy bridge lives in <code>playground/c15/</code> and
        <code>playground/js/synth/c15-bridge.js</code>; stream 11+ will wrap
        it as an AudioWorklet engine alongside the firmware-derived ones.
      </p>
      <p style={{ color: 'var(--fg-dim)', 'font-size': 'var(--fs-sm)', margin: 0 }}>
        Until then, pick one of the firmware modes (PAFSynth, Channel Strip,
        Verb FX, etc.) from the mode switcher above.
      </p>
    </section>
  );
};

export default C15Mode;
