/// <reference types="vite/client" />

// Type declaration for vite-plugin-cross-origin-isolation
declare module 'vite-plugin-cross-origin-isolation' {
  interface Plugin {
    name: string;
    configureServer?: (server: any) => void;
    configurePreviewServer?: (server: any) => void;
  }
  export default function crossOriginIsolation(): Plugin;
}

// Type declaration for Emscripten-generated nisps.js module (relative to src/core/)
declare module '*/wasm/nisps.js' {
  interface NispsModuleInstance {
    cwrap(
      ident: string,
      returnType: string | null,
      argTypes: string[],
      opts?: unknown
    ): (...args: unknown[]) => unknown;
    HEAPF32: Float32Array;
    HEAP32: Int32Array;
    [key: string]: any;
  }

  type NispsModuleFactory = (moduleArg?: Record<string, any>) => Promise<NispsModuleInstance>;
  const NispsModule: NispsModuleFactory;
  export default NispsModule;
}
