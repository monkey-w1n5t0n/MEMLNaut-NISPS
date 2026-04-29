import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// COOP/COEP headers are required for SharedArrayBuffer (used by C15 + AudioWorklet).
// Set on both dev server and the production preview.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5173,
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    port: 4173,
    headers: crossOriginIsolationHeaders,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
