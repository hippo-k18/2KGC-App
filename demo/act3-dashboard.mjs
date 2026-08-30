/**
 * Act three — one price, one backend.
 *
 * The loop this records is the whole argument of the video:
 *
 *   1. the public website shows Main Conference at $799
 *   2. the organizer changes it to $699 on the dashboard
 *   3. the public website shows $699 — with nothing rebuilt and nothing deployed
 *
 * ## Why it is one continuous take across two different sites
 *
 * Cutting between two recordings would leave the join doing the persuading, and
 * a join is exactly where an audience assumes the trick is. Both sites are
 * driven in the same browser context, in order, so the price on the public page
 * before and the price on the public page after are separated only by the edit
 * that caused the change.
 *
 * The website page is *dynamic* (`ƒ /tickets` in the Next build output) and
 * reads `ticketTypes` from Firestore per request, so the reload is genuinely
 * re-reading the document the dashboard just wrote. If that route were ever
 * made static this act would silently stop being true.
 *
 * ## Restoring the price afterwards
 *
 * It is deliberately NOT restored. A viewer who opens the site after watching
 * this should find $699 there; putting it back would make the one verifiable
 * claim in the video the one thing that does not check out. `--restore` exists
 * for rehearsals.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { reinstall, wander, clickIt, scrollTo, typeIt, dismissCookie, caption, CAVEATS } from './lib.mjs';

const OUT = new URL('./raw/dash/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const WEB = process.env.WEB_URL ?? 'https://kgc-2027-website.netlify.app';
const DASH = process.env.DASH_URL ?? 'https://kgc-2027-dashboard.netlify.app';
const ORGANIZER = { email: 'demo@knowledgegraph.tech', passphrase: 'kgc-demo-2027' };

/** The edit the act performs. Whole currency units — the form stores cents. */
const TICKET = { id: 'main-conference', name: 'Main Conference', from: '799', to: '699' };

/** HubSpot is the one that belongs on this act; Stripe is carried through too. */
const S = 1.5;

const browser = await chromium.launch({ args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
});
const page = await ctx.newPage();
const cap = (t, sub, ms) => caption(page, t, sub, Math.round(ms * S));

async function go(url, caveats = CAVEATS) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await reinstall(page, caveats);
}

/** Read the price the public page is currently advertising for a tier. */
async function publicPrice(name) {
  return page.evaluate((n) => {
    for (const card of document.querySelectorAll('.kgc-ticket')) {
      if (card.querySelector('h3')?.textContent?.trim() === n) {
        return card.querySelector('.price')?.textContent?.trim() ?? null;
      }
    }
    return null;
  }, name).catch(() => null);
}

// ── 1. What the public page says now ────────────────────────────────────────
await go(`${WEB}/tickets`);
// The consent notice sits bottom-left, exactly where the captions go, and it
// reappears in this act because it is a fresh browser context.
await dismissCookie(page);
await cap('One price, one backend', 'The public site — this is what a buyer sees today', 5000);
await scrollTo(page, 780, { pace: 560 });
const before = await publicPrice(TICKET.name);
console.log('WEBSITE_BEFORE=' + before);
await cap(
  `${TICKET.name} — ${before ?? '$799'}`,
  'Nothing on this page is hard-coded. The figure is read from Firestore on every request.',
  5600,
);
await wander(page, 3000).catch(() => {});

// ── 2. The organizer dashboard ──────────────────────────────────────────────
await go(`${DASH}/login`);
await cap('The organizer dashboard', 'kgc-2027-dashboard.netlify.app — Whova’s EMS, rebuilt', 5200);
await typeIt(page, 'input[name="email"]', ORGANIZER.email, { delay: 40 });
await typeIt(page, 'input[name="passphrase"]', ORGANIZER.passphrase, { delay: 46 });
await clickIt(page, page.locator('button[type="submit"]').first(), { settle: 2200 });
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await reinstall(page, CAVEATS);
await wander(page, 1800).catch(() => {});

// ── 3. The sale from act one, on the organizer's screen ─────────────────────
await go(`${DASH}/tickets/orders-and-transactions/attendee-orders`);
await cap(
  'The ticket bought a minute ago',
  'Same database. The website wrote this order; the dashboard is reading it, not a copy of it.',
  6200,
);
await scrollTo(page, 520, { pace: 480 });
await wander(page, 2600).catch(() => {});

// ── 4. The price list ───────────────────────────────────────────────────────
await go(`${DASH}/tickets/ticket-setup/1-1-create-tickets`);
await cap('Ticket setup', 'The prices the website charges against, and the only place they are set', 5600);
await scrollTo(page, 360, { pace: 460 });
await wander(page, 2400).catch(() => {});

// ── 5. Change it ────────────────────────────────────────────────────────────
await go(`${DASH}/tickets/ticket-setup/1-1-create-tickets?edit=${TICKET.id}`);
await cap(
  `Changing ${TICKET.name}`,
  `$${TICKET.from} to $${TICKET.to}. Prices are typed in dollars and stored in cents, and every edit is audited with a before and after.`,
  6600,
);
await typeIt(page, '#price', TICKET.to, { delay: 190 });
await wander(page, 2200).catch(() => {});

const saved = await clickIt(
  page,
  page.locator('button[type="submit"]').filter({ hasText: /save changes/i }).first(),
  { settle: 2400 },
);
if (!saved) console.log('WARN: save button not found');
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await reinstall(page, CAVEATS);
await cap('Saved', 'One document in `ticketTypes` changed. Nothing was rebuilt and nothing was deployed.', 5600);
await wander(page, 2800).catch(() => {});

// Back to the list, so the new figure is seen in the organizer's own table
// before it is seen on the public page. Two independent reads of one document.
await clickIt(page, page.locator('a', { hasText: /back to list/i }).first(), { settle: 1800 });
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await reinstall(page, CAVEATS);
await scrollTo(page, 300, { pace: 420 });
await wander(page, 2400).catch(() => {});

// ── 6. Back to the public page ──────────────────────────────────────────────
await go(`${WEB}/tickets`);
await scrollTo(page, 780, { pace: 560 });
const after = await publicPrice(TICKET.name);
console.log('WEBSITE_AFTER=' + after);
await cap(
  `${TICKET.name} — ${after ?? '$699'}`,
  'The same public page, reloaded. One backend behind the website, the dashboard and the phone.',
  7000,
);
await wander(page, 3600).catch(() => {});

if (before === after) console.log('WARN: the public price did not change');

await ctx.close();
await browser.close();
console.log('act3 done');
