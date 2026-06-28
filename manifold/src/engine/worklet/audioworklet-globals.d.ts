/**
 * Type declarations for AudioWorkletGlobalScope. The default `lib.dom`
 * and `lib.dom.iterable` files don't include these because they only
 * exist inside an AudioWorklet thread.
 *
 * Keep this file minimal — only what `nisps-processor.ts` actually uses.
 */

declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  constructor(options?: { numberOfInputs?: number; numberOfOutputs?: number; processorOptions?: unknown });
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;
