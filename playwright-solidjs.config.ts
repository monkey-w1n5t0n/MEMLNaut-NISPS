import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/solidjs',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npx vite --port 5174',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['list']],
});
