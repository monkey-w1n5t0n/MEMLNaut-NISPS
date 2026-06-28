import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the Manifold app. The webServer runs `vite preview`
 * against the production build (dist/), which honours the COOP/COEP headers the
 * AudioWorklet + WASM bridge need. Run `bun run build` first.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4273',
    headless: true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'bun run preview',
    cwd: '.',
    url: 'http://localhost:4273',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list']],
});
