/**
 * Primitive library entry-point.
 *
 * Re-exports every UI primitive together with its props type. Modes and the
 * dev showcase import everything from here.
 */

export { Slider, type SliderProps } from './Slider';
export { SliderBank, type SliderBankProps, type SliderConfig } from './SliderBank';
export { VirtualJoystick, type VirtualJoystickProps } from './VirtualJoystick';
export { XYPad, type XYPadProps } from './XYPad';
export { Heatmap, type HeatmapProps, type HeatmapColorMode } from './Heatmap';
export { OutputDisplay, type OutputDisplayProps } from './OutputDisplay';
export { TrainingControls, type TrainingControlsProps } from './TrainingControls';
export { Drawer, type DrawerProps } from './Drawer';
export { ControlAxis, type ControlAxisProps } from './ControlAxis';
export { ProgressRing, type ProgressRingProps } from './ProgressRing';
export { PillToggle, type PillToggleProps, type PillToggleOption } from './PillToggle';
export { ParamEditor, type ParamEditorProps, type ParamDef, type ParamOverride } from './ParamEditor';
export { JoyMap, type JoyMapProps, type TrailPoint, type RegionPin } from './JoyMap';
export { WeightHealth, type WeightHealthProps, type WeightStatus } from './WeightHealth';
export { GradientFlow, type GradientFlowProps, type GradientStatus } from './GradientFlow';
export { LossPlot, type LossPlotProps } from './LossPlot';
