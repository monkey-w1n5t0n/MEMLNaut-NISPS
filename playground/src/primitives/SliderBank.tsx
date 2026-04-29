import { Component, createSignal, For, Show } from 'solid-js';
import { Slider } from './Slider';
import type { CurveName } from '../output/curves';
import styles from './SliderBank.module.css';

export interface SliderConfig {
  /** Stable id used as React-style key. */
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  curve?: CurveName;
  curveParam?: number;
  unit?: string;
  /** Optional section header to start a new collapsible group. */
  section?: string;
}

export interface SliderBankProps {
  sliders: ReadonlyArray<SliderConfig>;
  values: () => ReadonlyArray<number>;
  onChange: (id: string, v: number, index: number) => void;
  /** Title rendered at the top of the bank (above all sections). */
  title?: string;
  /** Default-collapsed sections by name. */
  collapsedSections?: ReadonlyArray<string>;
}

interface Section {
  name: string;
  items: Array<{ cfg: SliderConfig; index: number }>;
}

function group(configs: ReadonlyArray<SliderConfig>): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  configs.forEach((cfg, index) => {
    const sectionName = cfg.section ?? '';
    if (!current || current.name !== sectionName) {
      current = { name: sectionName, items: [] };
      sections.push(current);
    }
    current.items.push({ cfg, index });
  });
  return sections;
}

export const SliderBank: Component<SliderBankProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>(
    Object.fromEntries((props.collapsedSections ?? []).map((s) => [s, true])),
  );
  const sections = () => group(props.sliders);

  const toggle = (name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div class={styles.bank}>
      <Show when={props.title}>
        <h3 class={styles.title}>{props.title}</h3>
      </Show>
      <For each={sections()}>{(section) => (
        <section class={styles.section}>
          <Show when={section.name}>
            <button
              type="button"
              class={styles.sectionHeader}
              onClick={() => toggle(section.name)}
              aria-expanded={!collapsed()[section.name]}
            >
              <span class={styles.caret}>{collapsed()[section.name] ? '▸' : '▾'}</span>
              <span class={styles.sectionName}>{section.name}</span>
              <span class={styles.sectionCount}>{section.items.length}</span>
            </button>
          </Show>
          <Show when={!collapsed()[section.name]}>
            <div class={styles.list}>
              <For each={section.items}>{({ cfg, index }) => (
                <Slider
                  value={props.values()[index] ?? 0}
                  onChange={(v) => props.onChange(cfg.id, v, index)}
                  min={cfg.min}
                  max={cfg.max}
                  step={cfg.step}
                  curve={cfg.curve}
                  curveParam={cfg.curveParam}
                  label={cfg.label}
                  unit={cfg.unit}
                />
              )}</For>
            </div>
          </Show>
        </section>
      )}</For>
    </div>
  );
};
