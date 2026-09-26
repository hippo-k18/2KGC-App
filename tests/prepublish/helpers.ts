import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every public page a visitor can reach without a link from an email.
 *
 * Token pages (`/order/…`, `/speaker/…`, `/review/…`) are not here; the
 * security spec checks that a forged token on each of them is refused.
 * `/agenda`, `/rooms` and `/speakers` can be switched off from the dashboard, which is
 * why `optional` pages may answer 404 but must never answer 5xx.
 */
export const ROUTES: { path: string; optional?: boolean }[] = [
  { path: '/' },
  { path: '/about' },
  { path: '/agenda', optional: true },
  { path: '/announcements' },
  { path: '/blog' },
  { path: '/call-for-posters' },
  { path: '/code-of-conduct' },
  { path: '/community' },
  { path: '/documents' },
  { path: '/exhibitors' },
  { path: '/hcls' },
  { path: '/kgc-lifetime-achievement-awards' },
  { path: '/learn' },
  { path: '/previous-events' },
  { path: '/privacy' },
  { path: '/rooms', optional: true }, // follows the agenda switch
  { path: '/search' },
  { path: '/speakers', optional: true },
  { path: '/sponsor' },
  { path: '/startup-pitch' },
  { path: '/team' },
  { path: '/tickets' },
  { path: '/tickets/checkout' },
  { path: '/tickets/invoice' },
  { path: '/tickets/sponsor' },
  { path: '/tickets/exhibitor' },
];

/** The pages that take money, or lead straight to a page that does. */
export const MONEY_ROUTES = ['/tickets', '/tickets/checkout', '/tickets/invoice', '/tickets/sponsor', '/tickets/exhibitor'];

export const SALES = (process.env.PREPUBLISH_SALES ?? 'closed') as 'open' | 'closed';

/** Text a visitor should never be able to read. Checked against rendered text. */
export const BROKEN_TEXT: RegExp[] = [
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
  /Invalid Date/,
  /\blorem ipsum\b/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\{\{\s*\w+\s*\}\}/, // an unfilled template slot
];

/** Things that must never appear anywhere in the HTML sent to a browser. */
export const LEAKS: RegExp[] = [
  /sk_live_[A-Za-z0-9]/,
  /sk_test_[A-Za-z0-9]/,
  /rk_live_[A-Za-z0-9]/,
  /rk_test_[A-Za-z0-9]/,
  /whsec_[A-Za-z0-9]/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"private_key"\s*:/,
  /FIREBASE_SERVICE_ACCOUNT/,
  /FIRESTORE_EMULATOR_HOST/,
  /re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, // a Resend API key
];

/** Hostnames that mean a build picked up the wrong environment. */
export const WRONG_HOSTS: RegExp[] = [
  /[a-z0-9-]+\.netlify\.app/, // Netlify is retired; nothing should point there
  /https?:\/\/localhost[:/]/,
  /https?:\/\/127\.0\.0\.1[:/]/,
  /localhost:8080/,
];

/**
 * Console noise that is not ours and says nothing about the page.
 * Keep this list short: every line here is a class of error the gate ignores.
 */
const IGNORED_CONSOLE: RegExp[] = [
  /Download the React DevTools/,
  /\[Fast Refresh\]/,
];

export interface PageProblems {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
}

/**
 * A `page` that records everything that goes wrong while a test runs, and
 * fails the test at the end if anything did — console errors, uncaught
 * exceptions, and same-origin requests answering 4xx or 5xx.
 *
 * A test that expects a failure (the 404 page, a forged token) calls
 * `allowStatus(404)` or `problems.badResponses.length = 0` before it ends.
 */
export const test = base.extend<{
  problems: PageProblems;
  allowStatus: (...codes: number[]) => void;
}>({
  problems: [
    async ({ page, baseURL }, use, testInfo) => {
      const origin = new URL(baseURL!).origin;
      const problems: PageProblems = { consoleErrors: [], pageErrors: [], badResponses: [] };
      const allowed = new Set<number>();
      (page as Page & { __allowed?: Set<number> }).__allowed = allowed;

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
        // A 404 the test asked for also logs "Failed to load resource".
        if (/Failed to load resource: the server responded with a status of (\d+)/.test(text)) {
          const code = Number(RegExp.$1);
          if (allowed.has(code)) return;
        }
        problems.consoleErrors.push(`${text} @ ${msg.location().url}`);
      });
      page.on('pageerror', (err) => problems.pageErrors.push(err.message));
      page.on('response', (res) => {
        const url = res.url();
        if (!url.startsWith(origin)) return;
        const status = res.status();
        if (status >= 400 && !allowed.has(status)) problems.badResponses.push(`${status} ${url}`);
      });

      await use(problems);

      if (testInfo.status === 'passed' || testInfo.status === testInfo.expectedStatus) {
        expect.soft(problems.pageErrors, 'uncaught exceptions in the page').toEqual([]);
        expect.soft(problems.consoleErrors, 'console errors').toEqual([]);
        expect.soft(problems.badResponses, 'same-origin requests that failed').toEqual([]);
      }
    },
    { auto: true },
  ],
  allowStatus: async ({ page }, use) => {
    await use((...codes: number[]) => {
      const set = (page as Page & { __allowed?: Set<number> }).__allowed!;
      codes.forEach((c) => set.add(c));
    });
  },
});

export { expect };

/** "$1,199" or "$1,199.00" or "USD 1,199" → 119900. Null when there is no price. */
export function parsePrice(text: string): number | null {
  const m = text.replace(/ /g, ' ').match(/(?:[$€£]|USD|EUR|GBP)\s?([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const [whole, cents = '00'] = m[1].replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(cents.padEnd(2, '0'));
}

/**
 * The on-sale tiers as the tickets page shows them: the name, the price, and
 * where "Choose" goes. Read from the accessible name of each Choose link,
 * which is `Choose <tier name>` on every card.
 */
export async function readTiers(page: Page) {
  const links = page.getByRole('link', { name: /^Choose / });
  const count = await links.count();
  const tiers: { name: string; href: string; id: string }[] = [];
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const label = (await link.getAttribute('aria-label')) ?? '';
    const href = (await link.getAttribute('href')) ?? '';
    const id = new URL(href, 'https://x').searchParams.get('tier') ?? '';
    tiers.push({ name: label.replace(/^Choose /, ''), href, id });
  }
  return tiers;
}

/** True when the document is wider than the window, i.e. the page scrolls sideways. */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - window.innerWidth;
    if (over <= 1) return null;
    // Name the widest offenders so the failure says where to look.
    const culprits = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .filter((el) => getComputedStyle(el).position !== 'fixed')
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { over, culprits };
  });
}

/** A unique, obviously-fake address. `example.com` is reserved and never delivers. */
export function fakeEmail(tag: string) {
  return `prepublish+${tag}-${Date.now().toString(36)}@example.com`;
}
