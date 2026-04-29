import { Component } from 'solid-js';
import { Slider } from './Slider';
import { PillToggle } from './PillToggle';
import { CURVE_NAMES, type CurveName } from '../output/curves';
import styles from './ParamEditor.module.css';

/**
 * A single parameter definition (subset of mode schema's param entry,
 * shared between modes for the editor).
 */
export interface ParamDef {
  name: string;
  label: string;
  /** Hard min/max for the parameter (used as override clamp limits). */
  hardMin: number;
  hardMax: number;
  /** Authoring default. */
  default: number;
  /** Default curve from schema (overrides may change it). */
  curve: CurveName;
  group?: string;
}

/** Override applied between MLP output and parameter destination. */
export interface ParamOverride {
  min: number;
  max: number;
  curve: CurveName;
  curveParam?: number;
  muted: boolean;
  pinned: boolean;
  fixedValue: number;
}

export interface ParamEditorProps {
  param: ParamDef;
  override: () => ParamOverride;
  onChange: (next: ParamOverride) => void;
  /** Compact rendering for inline use. */
  compact?: boolean;
}

export const ParamEditor: Component<ParamEditorProps> = (props) => {
  const update = (patch: Partial<ParamOverride>) => {
    props.onChange({ ...props.override(), ...patch });
  };

  return (
    <div class={styles.editor} classList={{ [styles.compact]: !!props.compact }}>
      <header class={styles.header}>
        <strong class={styles.name}>{props.param.label}</strong>
        <span class={styles.id}>{props.param.name}</span>
      </header>
      <div class={styles.toggles}>
        <PillToggle
          options={[
            { value: 'live', label: 'Live' },
            { value: 'muted', label: 'Mute' },
            { value: 'pinned', label: 'Pin' },
          ]}
          value={() => props.override().pinned ? 'pinned' : props.override().muted ? 'muted' : 'live'}
          onChange={(v) => {
            if (v === 'live') update({ muted: false, pinned: false });
            else if (v === 'muted') update({ muted: true, pinned: false });
            else update({ muted: false, pinned: true });
          }}
          ariaLabel="param mode"
        />
      </div>
      <div class={styles.fields}>
        <Slider
          label="min"
          min={props.param.hardMin}
          max={props.param.hardMax}
          value={props.override().min}
          onChange={(v) => update({ min: Math.min(v, props.override().max) })}
        />
        <Slider
          label="max"
          min={props.param.hardMin}
          max={props.param.hardMax}
          value={props.override().max}
          onChange={(v) => update({ max: Math.max(v, props.override().min) })}
        />
        <label class={styles.curveRow}>
          <span class={styles.fieldLabel}>curve</span>
          <select
            class={styles.select}
            value={props.override().curve}
            onChange={(e) => update({ curve: e.currentTarget.value as CurveName })}
          >
            {CURVE_NAMES.map((c) => <option value={c}>{c}</option>)}
          </select>
        </label>
        <Slider
          label="fixed value"
          min={props.param.hardMin}
          max={props.param.hardMax}
          value={props.override().fixedValue}
          onChange={(v) => update({ fixedValue: v })}
          disabled={!props.override().muted}
        />
      </div>
    </div>
  );
};
