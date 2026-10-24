import { defineConfig, devices } from '@playwright/test';

/** The invoice end-to-end run. Started by `run.sh`, which brings up its servers. */
export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://127.0.0.1:3297',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
});
