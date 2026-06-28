/**
 * Console barrel — the convertible Console shell, wired to the real engine.
 */
export { ConsoleApp } from './ConsoleApp';
export type { ConsoleAppProps } from './ConsoleApp';
export { CompositeStage } from './CompositeStage';
export { SplitStage } from './SplitStage';
export { OutputStage } from './OutputStage';
export { ReadoutStrip } from './ReadoutStrip';
export { Manifold } from './Manifold';
export { InputMini } from './InputMini';
export { VerdictCluster } from './VerdictCluster';
export { Dock } from './Dock';
export { DRAWERS } from './Drawers';
export { AltitudeNav, MiniMeters, CompactAxis } from './shared-ui';
export { MF_MODES, shapeValues, applyCurve, seededGradient, modeEngineId } from './model';
export type { MFMode, MFParam, ParamStatus } from './model';
export type { Focus, ConsoleCtx } from './types';
