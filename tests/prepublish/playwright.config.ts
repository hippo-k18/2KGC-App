import { defineConfig, devices } from '@playwright/test';

/**
 * The pre-publish gate for the public website.
 *
 * Runs against whatever origin `PREPUBLISH_URL` names, staging by default.
 * `scripts/publish-web.sh` deploys staging and then runs this against it.
 *
 *   PREPUBLISH_URL    origin under test (default: https://staging.knowledgegraph.tech)
 *   PREPUBLISH_SALES  `closed` or `open`: what state ticket sales must be in.
 *                     A mismatch fails the run, because a lost Stripe key and a
 *                     newly added one are both things to find out before
 *                     publishing, not after.
 *   PREPUBLISH_PAY    `1` completes a Stripe purchase with the 4242 test card,
 *                     and refuses to unless the Stripe page is in test mode.
 *
 * The default run never writes to Firestore and never sends an email. The
 * `local-fulfilment` project is the one exception and only runs on localhost.
 */
const baseURL = (process.env.PREPUBLISH_URL ?? 'https://staging.knowledgegraph.tech').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseURL);

export default defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // One retry absorbs a slow first request after a restart without hiding
  // a page that fails twice.
  retries: 1,
  workers: isLocal ? 2 : 3, // staging is one small droplet shared with WordPress
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /local-fulfilment/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testIgnore: /local-fulfilment/,
      // Chromium with an iPhone-sized viewport and touch, so no WebKit download
      // is needed. Layout and tap behaviour are what this project checks.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      grep: /@mobile|@tickets|@smoke/,
    },
    {
      name: 'local-fulfilment',
      testMatch: /local-fulfilment/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
