import { Component, createSignal } from 'solid-js';
import { ParamEditor, type ParamDef, type ParamOverride } from './ParamEditor';

const PARAM: ParamDef = {
  name: 'osc1_freq',
  label: 'Osc 1 Freq',
  hardMin: 20,
  hardMax: 8000,
  default: 440,
  curve: 'exp',
  group: 'oscillators',
};

export const ParamEditorDemo: Component = () => {
  const [override, setOverride] = createSignal<ParamOverride>({
    min: 100,
    max: 2000,
    curve: 'exp',
    muted: false,
    pinned: false,
    fixedValue: 440,
  });
  return <ParamEditor param={PARAM} override={override} onChange={setOverride} />;
};
