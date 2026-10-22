import { defineConfig, devices } from '@playwright/test';

/** The Learn editor v2 release run (T323). Started by `run.sh`, which brings up its emulators and servers. */
export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3323',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
});
