import { defineConfig, devices } from '@playwright/test';

/**
 * The pre-publish gate for the public website.
 *
 * Runs against whatever origin `PREPUBLISH_URL` names, the live site by default
 * (staging.knowledgegraph.tech redirects there since 2026-09-26).
 * `scripts/publish-web.sh` deploys and then runs this against it.
 *
 *   PREPUBLISH_URL    origin under test (default: https://www.knowledgegraph.tech)
 *   PREPUBLISH_SALES  `off`, `closed` or `open`: what state ticket sales must be in.
 *                     `off` is the dashboard switch (Marketing > Event Website)
 *                     with ticket sales turned off. `open` is the default.
 *                     A mismatch fails the run, because a lost Stripe key and a
 *                     newly added one are both things to find out before
 *                     publishing, not after.
 *   PREPUBLISH_ALLOW_WRITES  `1` runs the checks that create Stripe objects (a
 *                     Checkout Session). Off by default: against the live site
 *                     that is a live object on every run.
 *   PREPUBLISH_PAY    `1` completes a Stripe purchase with the 4242 test card,
 *                     and refuses to unless the Stripe page is in test mode.
 *                     Needs PREPUBLISH_ALLOW_WRITES=1 as well.
 *
 * The default run never creates anything in Stripe and never sends an email.
 * (The sign-in endpoint checks can write rate-limit counters for the test
 * machine's IP.) The `local-fulfilment` project only runs on localhost.
 */
const baseURL = (process.env.PREPUBLISH_URL ?? 'https://www.knowledgegraph.tech').replace(/\/$/, '');
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
