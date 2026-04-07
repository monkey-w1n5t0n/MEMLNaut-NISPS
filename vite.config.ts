import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation';

export default defineConfig({
  plugins: [
    solidPlugin(),
    crossOriginIsolation(),
  ],
  cacheDir: 'node_modules/.vite',
  server: {
    port: 5174,
    watch: {
      usePolling: true,
      interval: 1000,
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 5174,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
  },
});
