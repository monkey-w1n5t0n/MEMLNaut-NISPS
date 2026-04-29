/**
 * Primitives showcase — Storybook-equivalent at /dev/primitives.
 *
 * Each section wraps one primitive's demo. Demos use realistic interactive
 * state so a quick visual scan answers "does this thing actually work?".
 */

import { Component, For, JSX } from 'solid-js';
import styles from './PrimitivesShowcase.module.css';

import { SliderDemo } from '../primitives/Slider.demo';
import { SliderBankDemo } from '../primitives/SliderBank.demo';
import { VirtualJoystickDemo } from '../primitives/VirtualJoystick.demo';
import { XYPadDemo } from '../primitives/XYPad.demo';
import { HeatmapDemo } from '../primitives/Heatmap.demo';
import { OutputDisplayDemo } from '../primitives/OutputDisplay.demo';
import { TrainingControlsDemo } from '../primitives/TrainingControls.demo';
import { DrawerDemo } from '../primitives/Drawer.demo';
import { ControlAxisDemo } from '../primitives/ControlAxis.demo';
import { ProgressRingDemo } from '../primitives/ProgressRing.demo';
import { PillToggleDemo } from '../primitives/PillToggle.demo';
import { ParamEditorDemo } from '../primitives/ParamEditor.demo';
import { JoyMapDemo } from '../primitives/JoyMap.demo';
import { WeightHealthDemo } from '../primitives/WeightHealth.demo';
import { GradientFlowDemo } from '../primitives/GradientFlow.demo';
import { LossPlotDemo } from '../primitives/LossPlot.demo';

interface Section {
  name: string;
  description: string;
  Demo: Component;
}

const SECTIONS: ReadonlyArray<Section> = [
  { name: 'Slider', description: 'Single-value slider with optional curve mapping.', Demo: SliderDemo },
  { name: 'SliderBank', description: 'Vertical stack with collapsible sections.', Demo: SliderBankDemo },
  { name: 'VirtualJoystick', description: 'Touch + pointer 2D input, returns [0,1]^2.', Demo: VirtualJoystickDemo },
  { name: 'XYPad', description: 'Rectangular 2D input pad.', Demo: XYPadDemo },
  { name: 'Heatmap', description: 'NxN colored grid, three color modes.', Demo: HeatmapDemo },
  { name: 'OutputDisplay', description: 'Bar chart of N output values.', Demo: OutputDisplayDemo },
  { name: 'TrainingControls', description: 'RL feedback + status panel.', Demo: TrainingControlsDemo },
  { name: 'Drawer', description: 'Slide-in panel from left/right.', Demo: DrawerDemo },
  { name: 'ControlAxis', description: 'Compound axis slider (Boldness/Memory/Precision shape).', Demo: ControlAxisDemo },
  { name: 'ProgressRing', description: 'Circular progress indicator.', Demo: ProgressRingDemo },
  { name: 'PillToggle', description: 'Segmented control.', Demo: PillToggleDemo },
  { name: 'ParamEditor', description: 'Range/curve/mute/pin for one parameter.', Demo: ParamEditorDemo },
  { name: 'JoyMap', description: 'Zoom minimap with trail, noise rings, region pins.', Demo: JoyMapDemo },
  { name: 'WeightHealth', description: 'Histogram with status glow.', Demo: WeightHealthDemo },
  { name: 'GradientFlow', description: 'Per-layer gradient bars.', Demo: GradientFlowDemo },
  { name: 'LossPlot', description: 'Training-loss line chart over time.', Demo: LossPlotDemo },
];

const PrimitivesShowcase: Component = () => {
  return (
    <div class={styles.root}>
      <header class={styles.header}>
        <h1>Primitive Library</h1>
        <p class={styles.lede}>
          Each card is a live demo. Use this page as a sanity-check during the rewrite.
          Modes (stream 9) and feature parity (stream 10) compose these primitives.
        </p>
      </header>
      <div class={styles.grid}>
        <For each={SECTIONS}>{(section) => (
          <article class={styles.card}>
            <header class={styles.cardHead}>
              <h2 class={styles.cardTitle}>{section.name}</h2>
              <p class={styles.cardDesc}>{section.description}</p>
            </header>
            <div class={styles.cardBody}>
              {section.Demo({}) as unknown as JSX.Element}
            </div>
          </article>
        )}</For>
      </div>
    </div>
  );
};

export default PrimitivesShowcase;
