/**
 * hooks/index.ts — re-exports all SolidJS hooks for clean import paths.
 *
 * @example
 *   import { useOutputRouting, useSynthRouting } from '../hooks';
 */

export { useAudioContext } from './useAudioContext';
export { useInputPipeline } from './useInputPipeline';
export { useKeyboard } from './useKeyboard';
export { useOutputPipeline } from './useOutputPipeline';
export type { OutputPipelineController } from './useOutputPipeline';
export { useOutputRouting } from './useOutputRouting';
export { useSynthRouting } from './useSynthRouting';
export type { ArpNoteOnPayload, ArpNoteOffPayload } from './useSynthRouting';
