/**
 * Act two — the ticket, used on the phone.
 *
 * Signs in with the credentials the confirmation page printed thirty seconds
 * earlier in act one, on the deployed app at `kgc-2027-app.netlify.app`, and
 * walks to the badge. The claim code on the badge is the same six characters
 * the website printed, because it is the same registration document.
 *
 * ## Sign-in is verified, never assumed
 *
 * A hard navigation redirects to `/login` while Firebase rehydrates auth, and a
 * frame of the login screen looks perfectly valid — that exact failure once
 * produced fifteen identical "app screens" in a capture run on this project.
 * `open()` checks the login copy is gone and signs in again if it is not.
 *
 * ## No pinned caveat here
 *
 * The Stripe and HubSpot caveats are pinned across acts one and three, where
 * money and CRM are on screen. On a 430px viewport the same card covers a third
 * of the app, and neither claim is being made by any screen in this act.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installCursor, wander, tapAt, clickIt, typeIt, skim, caption } from './lib.mjs';

const OUT = new URL('./raw/app/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const APP = process.env.APP_URL ?? 'https://kgc-2027-app.netlify.app';
const EMAIL = process.env.BUYER_EMAIL ?? 'demo.attendee@example.com';
/**
 * Read from the environment rather than hard-coded.
 *
 * This was the literal shared password, which put a live credential in a
 * committed file. It is also no longer a password anything issues: BUILD-PLAN
 * 1.4 removed demo mode, and an account created by a purchase now has no
 * password at all — see the note at the top of demo/README.md about what this
 * act can and cannot do.
 */
const PASSWORD = process.env.BUYER_PASSWORD ?? '';
const ON_LOGIN = () => document.body.innerText.includes('Demo sign-in');

const browser = await chromium.launch({ args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  recordVideo: { dir: OUT, size: { width: 430, height: 932 } },
});
const page = await ctx.newPage();
const cap = (t, sub, ms) => caption(page, t, sub, Math.round(ms * 1.5), { phone: true });

async function signIn() {
  await typeIt(page, 'input[aria-label="Username"]', EMAIL, { delay: 38 });
  await typeIt(page, 'input[aria-label="Password"]', PASSWORD, { delay: 46 });
  await clickIt(page, page.getByText(/^Sign in$/i).first(), { settle: 1200 });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    if (!(await page.evaluate(ON_LOGIN).catch(() => false))) return true;
  }
  return false;
}

/** Where a tab sits in the bar, so a deep link can still show a press. */
async function tabPoint(name) {
  return page.evaluate((n) => {
    for (const el of document.querySelectorAll('*')) {
      const t = [...el.childNodes].filter((x) => x.nodeType === 3)
        .map((x) => x.textContent.trim()).join('');
      if (t.toLowerCase() === n.toLowerCase()) {
        const r = el.getBoundingClientRect();
        // The web build draws the bar along the bottom; anything matching the
        // label higher up the page is a heading, not the tab.
        if (r.width > 6 && r.top > innerHeight - 140) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
    }
    return null;
  }, name).catch(() => null);
}

async function open(path, label, tab) {
  if (tab) {
    const pt = await tabPoint(tab);
    if (pt) await tapAt(page, pt.x, pt.y, { settle: 300 });
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(APP + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      if (!(await page.evaluate(ON_LOGIN).catch(() => false))) break;
    }
    if (await page.evaluate(ON_LOGIN).catch(() => false)) {
      console.log(`  ${label}: on login, signing in again`);
      await signIn();
      continue;
    }
    // Before the settle, not after: installing the cursor afterwards left the
    // frame frozen for the whole rehydrate, which reads exactly like a hover.
    await installCursor(page);
    await wander(page, 900).catch(() => {});
    return true;
  }
  console.log(`FAIL ${label}`);
  return false;
}

// ── Sign in with what the purchase just printed ─────────────────────────────
await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(11000);
await installCursor(page);
await cap('The same ticket, on the phone', 'Signing in with the address that bought it', 6200);
if (!(await signIn())) console.log('WARN: sign-in did not clear the login screen');
await installCursor(page);
await wander(page, 1600).catch(() => {});

const TOUR = [
  ['/home', 'Home', 'What is on now, and what is next', null],
  ['/agenda', 'Agenda', '72 sessions, by day and by track', 'Agenda'],
  ['/people', 'People', 'Attendees, speakers and sponsors', 'People'],
];

for (const [path, title, sub, tab] of TOUR) {
  if (!(await open(path, title, tab))) continue;
  await cap(title, sub, 5600);
  await wander(page, 1900).catch(() => {});
}

// ── The badge: the ticket, in use ───────────────────────────────────────────
if (await open('/me/badge', 'Badge', 'Me')) {
  await cap('Your ticket', 'The badge QR — cached on the phone, so it scans with no signal', 7200);
  await wander(page, 2600).catch(() => {});
  // The one scroll kept on the phone: the printed claim code sits below the QR,
  // and it is the same code the website put on the confirmation page.
  await skim(page, { pace: 260 });
  await cap('The same claim code', 'One registration document — the website printed it, the app is reading it', 6600);
  await wander(page, 2600).catch(() => {});
  const body = await page.textContent('body').catch(() => '');
  console.log('BADGE_CODES=' + [...new Set(body.match(/\b[A-Z0-9]{6}\b/g) || [])].slice(0, 6).join(','));
}

await wander(page, 800).catch(() => {});
await ctx.close();
await browser.close();
console.log('act2 done');
