/**
 * Session and speaker detail — the answer to "there is no detail popup".
 *
 * The client's comment was that an agenda item could not be *read* on the
 * dashboard: the title and the Edit link went to the same form, so the only way
 * to see a session's abstract, its speakers and their faces was to enter a
 * screen whose every control writes. Both detail modals now exist, and this
 * records them on the deployed dashboard against live Firestore.
 *
 * ## Why there is exactly one `page.goto` in this file
 *
 * A recording that moves between screens with `page.goto` proves nothing — the
 * viewer sees pages replace each other with the pointer sitting still, which is
 * indistinguishable from a slideshow of screenshots. Every transition below is
 * therefore a real click on the control that causes it: the Content tab in the
 * top bar, "Agenda Center" and "Session Manager" in the rail, the session title,
 * the modal's own × , then "Speaker Center" and "Speaker Manager", the search
 * button, a speaker row, and that modal's × again. The single `goto` is the one
 * nothing can click its way to: arriving at the sign-in page.
 *
 * ⚠️ `reinstall()` after every click that navigates. The cursor is a DOM node
 * and a Next.js route change replaces the body; forget one and the rest of the
 * take has no pointer, which is the exact failure this act exists to avoid.
 * Opening a modal is *not* a navigation, so it needs no reinstall — but it does
 * need the top-layer re-homing added to `lib.mjs` for it, because an open
 * `<dialog>` paints above every z-index there is.
 *
 * ## The two records it opens, and why those two
 *
 * "From pilot to production" carries two speakers who both have portraits on
 * file, which is the point of the shot — 13 of the 137 imported speakers have
 * none and render an initials tile instead. Tim Berners-Lee is then opened from
 * Speaker Manager, so the same person is seen from both sides of the join: his
 * portrait inside the session, and that session inside his record.
 *
 * ⚠️ Nobody has a bio. All 137 came out of the 2026 Whova export, which has no
 * bio field, so the speaker modal says "No bio on file". That is not a fault to
 * be worked around in the edit — the caption says it plainly, because a video
 * that hurries past an empty field is the reason the field stays empty.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { reinstall, wander, clickIt, glide, scrollTo, typeIt, caption } from './lib.mjs';

const OUT = new URL('./raw/detail/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DASH = process.env.DASH_URL ?? 'https://kgc27-dashboard.netlify.app';

/**
 * From the environment, for the reason recorded in `act3-dashboard.mjs`: this
 * passphrase guards an Admin SDK that bypasses every security rule, and the
 * previous version of that act kept it as a literal in a committed file.
 */
const ORGANIZER = {
  email: process.env.ORGANIZER_EMAIL ?? '',
  passphrase: process.env.ORGANIZER_PASSPHRASE ?? '',
};
if (!ORGANIZER.email || !ORGANIZER.passphrase) {
  console.error('Set ORGANIZER_EMAIL and ORGANIZER_PASSPHRASE before running this act.');
  process.exit(1);
}

/** The session and the speaker the take opens. Both are real rows on the live project. */
const SESSION = 'From pilot to production: lineage across a hundred pipelines';
const SPEAKER = 'Tim Berners-Lee';
const SEARCH = 'Berners';

/** Caption holds are authored 1.5x long, because `build.sh` speeds the capture 1.5x. */
const S = 1.5;

const browser = await chromium.launch({ args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 900 } },
});
/*
 * `installCursor` already carries this rule, but it only lands once the cursor
 * is re-injected — and between a route change painting and `reinstall` running
 * there is a second or two in which Netlify's free-plan badge sits in the
 * bottom-right of the frame. Applying it at document start instead means no
 * frame of the recording has it. The hosting is not being concealed: this is a
 * floating widget over the product, and the dashboard is named in the captions.
 */
await ctx.addInitScript(() => {
  const hide = () => {
    const s = document.createElement('style');
    s.textContent = '#nl-badge-frame,iframe[src*="netlify"]{display:none!important}';
    document.head?.appendChild(s);
  };
  if (document.head) hide();
  else document.addEventListener('DOMContentLoaded', hide);
});

const page = await ctx.newPage();
const cap = (t, sub, ms) => caption(page, t, sub, Math.round(ms * S));

/** Settle after a click that navigates, and put the injected cursor back. */
async function landed() {
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await reinstall(page, []);
}

/** Click something, then treat it as a navigation. Returns false if it was absent. */
async function clickThrough(locator, settle = 1400) {
  const ok = await clickIt(page, locator, { settle });
  if (!ok) console.log('WARN: nothing to click for', String(locator));
  await landed();
  return ok;
}

/** Bring an element into the upper half of the viewport at a reading pace. */
async function scrollToElement(selector, offset = 260) {
  const y = await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return Math.max(0, window.scrollY + el.getBoundingClientRect().top - off);
  }, [selector, offset]).catch(() => null);
  if (y != null) await scrollTo(page, y, { pace: 520 });
}

/** Read the cursor over a region of an open modal, so the eye is led down it. */
async function readModal(points) {
  for (const [x, y, ms] of points) await glide(page, x, y, ms);
}

// ── 1. Sign in. The only `goto` in the file. ────────────────────────────────
await page.goto(`${DASH}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
// Once as soon as there is a body, again after the page settles: `networkidle`
// can be a second behind first paint, and that second would be cursorless.
await reinstall(page, []);
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await reinstall(page, []);
await cap(
  'The organizer dashboard',
  'kgc27-dashboard.netlify.app — deployed, reading the live conference database',
  5200,
);
await typeIt(page, 'input[name="email"]', ORGANIZER.email, { delay: 40 });
await typeIt(page, 'input[name="passphrase"]', ORGANIZER.passphrase, { delay: 46 });
await clickThrough(page.locator('button[type="submit"]').first(), 2200);
await wander(page, 1600).catch(() => {});

// ── 2. Content → Agenda Center → Session Manager, one click at a time ───────
await clickThrough(page.locator('#top-nav a[href="/content"]').first());
await cap('Content', 'Whova’s own navigation tree, tab for tab', 4200);
await wander(page, 2600).catch(() => {});

await clickThrough(page.locator('a.firstlevel-name[href="/content/agenda-center"]').first());
await cap('Agenda Center', '', 3400);
await wander(page, 2200).catch(() => {});

await clickThrough(
  page.locator('ul.treeview-menu a.secondlevel-name[href="/content/agenda-center/session-manager"]').first(),
);
await cap(
  'Session Manager',
  'The programme in hour buckets. 86 sessions across five days, read from Firestore.',
  6000,
);
await scrollTo(page, 420, { pace: 480 });
await wander(page, 2600).catch(() => {});

// ── 3. The session detail modal ─────────────────────────────────────────────
const sessionTrigger = `button[aria-label="Session details: ${SESSION}"]`;
await scrollToElement(sessionTrigger, 300);
await cap(
  'Clicking the title opens the detail',
  'It used to open the editor. There was no way to read a session without entering a screen that writes.',
  6400,
);
await page.waitForTimeout(3600);

const opened = await clickIt(page, page.locator(sessionTrigger).first(), { settle: 1500 });
if (!opened) {
  console.log('FATAL: the session trigger was not found — the programme may have changed');
  process.exit(2);
}

await cap(
  'Everything on the record',
  'Day and local time with the zone, room, track chips, format, skill level, status — then the abstract.',
  7600,
);
// Down the left of the dialog, which is where the labels are.
await readModal([[700, 250, 1100], [700, 330, 900], [700, 420, 900], [820, 480, 1100]]);
await page.waitForTimeout(2800);

await cap(
  'And the speakers, with their faces',
  'Portrait, name, job title and affiliation — resolved from the speaker records, not typed into the session.',
  7800,
);
await readModal([[560, 570, 1100], [560, 640, 1000], [860, 600, 1100]]);
await page.waitForTimeout(3600);

// ── 4. Closed by its own control, not by Escape and not by navigating away ──
await cap('Closed from the modal itself', '', 3200);
await clickIt(page, page.locator('dialog[open] button.whova-modal__close').first(), { settle: 1600 });
await wander(page, 1400).catch(() => {});

// ── 5. Speaker Center → Speaker Manager ─────────────────────────────────────
await clickThrough(page.locator('a.firstlevel-name[href="/content/speaker-center"]').first());
await cap('Speaker Center', '', 3400);
await wander(page, 2200).catch(() => {});

await clickThrough(
  page.locator('ul.treeview-menu a.secondlevel-name[href="/content/speaker-center/speaker-manager"]').first(),
);
await cap(
  'Speaker Manager',
  '137 speakers imported from the 2026 roster. 124 of them arrived with a headshot.',
  6400,
);
await scrollTo(page, 560, { pace: 460 });
await wander(page, 1800).catch(() => {});

// The same person who was just seen inside the session, from the other side of
// the join — which is the claim worth making: one record, two screens.
await scrollToElement('input[name="q"]', 200);
await typeIt(page, 'input[name="q"]', SEARCH, { delay: 130 });
await clickThrough(page.locator('form.toolbar button[type="submit"]').first());
await cap(
  'One of the two from that session',
  'Same record. The session showed his portrait; this shows the sessions he presents.',
  6200,
);
await wander(page, 2600).catch(() => {});

// ── 6. The speaker detail modal ─────────────────────────────────────────────
// A generous offset, so the single result row stays high in the frame and the
// CSV import panel below it does not become the backdrop to the whole modal.
const speakerTrigger = `button[aria-label="Speaker details: ${SPEAKER}"]`;
await scrollToElement(speakerTrigger, 420);
const openedSpeaker = await clickIt(page, page.locator(speakerTrigger).first(), { settle: 1500 });
if (!openedSpeaker) {
  console.log('FATAL: the speaker trigger was not found');
  process.exit(2);
}

await cap(
  'The speaker record',
  'Portrait, job title, affiliation, contact and links — and the sessions they present, at the bottom.',
  7600,
);
await readModal([[640, 300, 1100], [700, 400, 1000], [760, 470, 1000]]);
await page.waitForTimeout(3600);

// Said rather than skipped past. The field is real and the data is not there.
await cap(
  'The bio field is live and empty',
  'None of the 137 has one — the 2026 export carried no bio. The screen says so instead of inventing a placeholder.',
  8000,
);
await readModal([[700, 545, 1100], [700, 640, 1100], [880, 690, 1000]]);
await page.waitForTimeout(4400);

await cap('Closed from the modal itself', '', 3200);
await clickIt(page, page.locator('dialog[open] button.whova-modal__close').first(), { settle: 1600 });

// Back up to the row the modal came out of, so the last thing on screen is the
// list rather than the import panel that happened to be under the dialog.
await scrollTo(page, 120, { pace: 500 });
await cap(
  'Both modals, on the deployed dashboard',
  'Nothing was rebuilt for this recording and every screen change in it was a click.',
  7000,
);
await wander(page, 5200).catch(() => {});

await ctx.close();
await browser.close();
console.log('act4 done');
