import { defineConfig, devices } from '@playwright/test';

/** The Learn page editor end-to-end run. Started by `run.sh`, which brings up its servers. */
export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3298',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
});
