/**
 * Act one — buying a ticket, on the deployed website.
 *
 * ## Recorded against production, not localhost
 *
 * The August cut (`whova-rebuild/demo/`) drove `localhost:3200` against the
 * Firebase emulator. This one drives `kgc-2027-website.netlify.app` against the
 * live `kgc-conference-app-and-website` project, for one reason: the closing
 * claim of the video is *"it is all one backend"*, and a recording of three
 * localhost servers talking to an emulator cannot demonstrate that. Every
 * document written here is written to the same database the dashboard reads in
 * act three and the phone reads in act two.
 *
 * The cost is latency — each navigation is a Netlify function, not a warm dev
 * server — which is why the waits below are generous and why `build.sh` speeds
 * the finished capture up rather than the recording being driven harder.
 *
 * ## The caveat is pinned, not captioned
 *
 * The brief asks for Stripe and HubSpot to be marked as not installed. That is
 * a standing fact about every frame of this act, not an event inside it, so it
 * is a pinned card (`caveat()` in `lib.mjs`) re-applied after every navigation
 * rather than a caption that retires itself. A disclaimer that has faded out by
 * the time somebody pauses the video has not been made.
 *
 * Holds are authored 1.5x long because `build.sh` runs the capture at 1.5x.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import {
  reinstall, glide, wander, clickIt, scrollTo, skim, typeIt, dismissCookie, caption, CAVEATS,
} from './lib.mjs';

const OUT = new URL('./raw/buy/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const WEB = process.env.WEB_URL ?? 'https://kgc-2027-website.netlify.app';

/** The buyer printed on the page itself, so the video and the site agree. */
const BUYER = { name: 'Demo Attendee', email: 'demo.attendee@example.com' };
const CARD = { number: '4242 4242 4242 4242', expiry: '12 / 29', cvc: '123' };

const S = 1.5;

const browser = await chromium.launch({ args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
});
const page = await ctx.newPage();
const cap = (t, sub, ms) => caption(page, t, sub, Math.round(ms * S));

async function go(path) {
  await page.goto(WEB + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await reinstall(page, CAVEATS);
}

// ── The tickets page ────────────────────────────────────────────────────────
await go('/tickets');
await dismissCookie(page);
await cap('Buying a ticket', 'kgc-2027-website.netlify.app — the deployed site, not a mock', 5000);
await wander(page, 3000).catch(() => {});

// The four attendee tiers. Prices are read from Firestore at request time —
// there is no hard-coded fallback anywhere on this page.
await scrollTo(page, 760, { pace: 560 });
await cap('Four tiers', 'Every price on this page is read from one Firestore collection', 5200);
await wander(page, 2600).catch(() => {});

// ── Into checkout ───────────────────────────────────────────────────────────
const chose =
  (await clickIt(page, page.locator('a', { hasText: /choose all access/i }).first(), { settle: 1400 })) ||
  (await clickIt(page, page.locator('a.btn', { hasText: /^choose/i }).first(), { settle: 1400 }));
if (!chose) console.log('WARN: no tier button found');
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await reinstall(page, CAVEATS);

await cap('The attendee’s details', 'The price never leaves the server — the form only posts a tier id', 5000);
await wander(page, 2200).catch(() => {});

await typeIt(page, '#name, input[name="name"]', BUYER.name);
await typeIt(page, '#email, input[name="email"]', BUYER.email);

// ── The card box, and the caveat spoken out loud ────────────────────────────
await cap(
  'Stripe is not installed yet',
  'The card box is cosmetic. Nothing here is charged — the order is approved in demo mode and stamped <code>channel: demo</code> so it can never be counted as revenue.',
  6400,
);
await typeIt(page, 'input[aria-label="Card number"]', CARD.number, { delay: 42 });
await typeIt(page, 'input[aria-label="Expiry"]', CARD.expiry, { delay: 60 });
await typeIt(page, 'input[aria-label="CVC"]', CARD.cvc, { delay: 90 });
await wander(page, 1800).catch(() => {});

await cap(
  'HubSpot is not installed yet either',
  'The dashboard carries the connection screen; nothing syncs a contact out of this purchase yet.',
  5200,
);
await wander(page, 3200).catch(() => {});

// ── Pay ─────────────────────────────────────────────────────────────────────
const submit = page.locator('button[type="submit"]').filter({ hasText: /pay|register/i }).first();
await clickIt(page, submit, { settle: 600 });
await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
// The order write, the account provisioning and the redirect all happen here.
await page.waitForURL(/\/order\//, { timeout: 90000 }).catch(() => {});
await reinstall(page, CAVEATS);
await wander(page, 1600).catch(() => {});

// ── The confirmation ────────────────────────────────────────────────────────
await cap(
  'Registered',
  'A real registration in the live project — with a claim code, a QR to the app, and the account this purchase just created',
  6000,
);
await wander(page, 3400).catch(() => {});
// Below the pass: the sign-in details the purchase created. This is the hinge
// between the two acts — act two types exactly what is printed here.
await cap(
  'The account already exists',
  'The purchase created it. The email and password below are what act two signs in with.',
  6000,
);
await skim(page, { pace: 420 });

const body = await page.textContent('body').catch(() => '');
const claim = (body.match(/Claim code\s*([A-Z0-9]{6})/) || [])[1]
  ?? [...new Set(body.match(/\b[A-Z0-9]{6}\b/g) || [])][0];
console.log('CLAIM=' + (claim ?? 'unknown'));
console.log('BUYER=' + BUYER.email);
console.log('ORDER_URL=' + page.url());

await wander(page, 900).catch(() => {});
await ctx.close();
await browser.close();
console.log('act1 done');
