const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:7331',
    headless: true,
    // WASM + AudioContext require a stable origin
    ignoreHTTPSErrors: true,
  },
  // Start a static file server against the playground/ dir before tests run.
  // python3 -m http.server serves directory listings and static assets fine.
  // WASM files need correct MIME type — Python's server handles .wasm correctly.
  webServer: {
    command: 'python3 -m http.server 7331',
    cwd: './playground',
    url: 'http://localhost:7331',
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
