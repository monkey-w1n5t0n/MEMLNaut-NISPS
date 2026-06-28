import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// COOP/COEP are required for SharedArrayBuffer + the AudioWorklet path (the
// browser-only C15 / "Powerful Synth Engine" SAB ring needs them; nisps audio
// itself uses per-thread instances). Set on dev server AND preview. In prod the
// nginx vhost sets them at server scope, so every sub-path (/next) inherits.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // base:'./' → relative asset URLs so one dist/ mounts at both / and /next.
  // WASM URLs must be resolved via import.meta.env.BASE_URL, never hardcoded.
  base: './',
  server: {
    port: 5273,
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    port: 4273,
    headers: crossOriginIsolationHeaders,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
