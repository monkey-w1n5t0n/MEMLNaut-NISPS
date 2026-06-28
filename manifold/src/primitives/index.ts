/**
 * Manifold design-system primitives — proper ES-module React + TS components
 * on the Manifold design tokens. Ported from the window-global JSX reference
 * implementations in docs/redesign/manifold-export/components/.
 *
 * Side-effect import: pulls in the `.mf-slider-input` / `.mf-axis-input`
 * range-input styling that Slider and ControlAxis depend on. Importing this
 * barrel anywhere in the app is enough to register those rules.
 */
import '../styles/primitives.css';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Slider } from './Slider';
export type { SliderProps } from './Slider';

export { PillToggle } from './PillToggle';
export type { PillToggleProps, PillOption } from './PillToggle';

export { Panel } from './Panel';
export type { PanelProps } from './Panel';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

export { StatusLine } from './StatusLine';
export type {
  StatusLineProps,
  StatusItem,
  StatusItemObject,
  StatusTone,
} from './StatusLine';

export { XYPad } from './XYPad';
export type { XYPadProps } from './XYPad';

export { VirtualJoystick } from './VirtualJoystick';
export type { VirtualJoystickProps } from './VirtualJoystick';

export { ControlAxis } from './ControlAxis';
export type { ControlAxisProps } from './ControlAxis';

export { CurvePlot } from './CurvePlot';
export type { CurvePlotProps, CurveName } from './CurvePlot';

export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
