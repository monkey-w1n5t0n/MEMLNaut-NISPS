import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the SolidJS playground.
 *
 * The webServer block runs `vite preview` against the build output, so the
 * tests exercise the real production bundle. Vite's preview command honors
 * the COOP/COEP headers configured in vite.config.ts, which the AudioWorklet
 * + WASM bridge needs.
 *
 * To run a fresh build before tests, run `bun run build` separately — the
 * preview server expects `dist/` to already exist. CI does this in the
 * workflow before invoking Playwright.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    // `bun run preview` is `vite preview --port 4173` (see playground/package.json).
    // Reuses an already-running server so `npx playwright test` after `bun
    // dev` Just Works.
    command: 'bun run preview',
    cwd: '.',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: process.env.CI ? [['list'], ['github']] : [['list'], ['html', { open: 'never' }]],
});
