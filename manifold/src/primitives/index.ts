/**
 * Manifold design-system primitives — proper ES-module React + TS components
 * on the Manifold design tokens. Ported from the window-global JSX reference
 * implementations in docs/redesign/manifold-export/components/.
 *
 * Side-effect import: pulls in the `.mf-slider-input` range-input styling that
 * Slider depends on. Importing this barrel anywhere in the app is enough to
 * register those rules.
 *
 * Panel / StatusLine / ControlAxis / CurvePlot / Sparkline were deleted
 * 2026-07 (simplification audit L22) — zero consumers repo-wide. They stay
 * deleted: the training-health diagnostics suite landed (§6.5e) and its loss
 * plot is ~30 lines of inline SVG in `console/TrainingHealth.tsx`, its only
 * consumer. Resurrect a primitive when a SECOND caller exists, not before.
 */
import '../styles/primitives.css';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Slider } from './Slider';
export type { SliderProps } from './Slider';

export { PillToggle } from './PillToggle';
export type { PillToggleProps, PillOption } from './PillToggle';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

export { XYPad } from './XYPad';
export type { XYPadProps } from './XYPad';

export { VirtualJoystick } from './VirtualJoystick';
export type { VirtualJoystickProps } from './VirtualJoystick';
