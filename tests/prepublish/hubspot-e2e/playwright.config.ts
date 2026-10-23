import { defineConfig, devices } from '@playwright/test';

/** The HubSpot sync run (T333). Started by `run.sh`, which brings up the emulator, the fake HubSpot and the dashboard. */
export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3333',
    ...devices['Desktop Chrome'],
    headless: true,
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
});
