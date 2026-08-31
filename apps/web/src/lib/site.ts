import { EVENT } from '@kgc/shared';

/**
 * Facts about the event that the marketing pages repeat, in one place.
 *
 * The name, venue and time zone come from `@kgc/shared` so the website and the
 * app cannot disagree about what the conference is called. The dates are here
 * because they are presentation strings — `@kgc/shared` holds the machine
 * truth (`EVENT_ID`, `TIME_ZONE`) and has no business holding "3–7 May 2027".
 *
 * No server imports: client components read this too.
 */
export const SITE = {
  name: EVENT.name,
  shortName: EVENT.shortName,
  venue: EVENT.venue,
  venueShort: 'Cornell Tech, Roosevelt Island',
  city: 'New York City',
  timeZone: EVENT.timeZone,

  /**
   * The edition, on its own, because the hero shouts it as a bare "KGC 2027"
   * above the conference name — the way the live site does.
   */
  year: 2027,

  /** Monday to Friday. Workshops open the week, the main conference closes it. */
  datesLong: '3–7 May 2027',
  datesShort: 'May 3–7, 2027',
  workshopDays: 'Monday 3 – Tuesday 4 May',
  conferenceDays: 'Wednesday 5 – Friday 7 May',

  tagline: 'Where enterprise data becomes something a machine can reason about.',
  contactEmail: 'contact@knowledgegraph.tech',
  /*
   * The conference's real switchboard, read off the live /hcls "Find us" block.
   * Not invented — a wrong phone number on a conference site is worse than none,
   * which is why this had been left out entirely rather than guessed.
   */
  contactPhone: '1-833-857-0355 x 156',

  social: [
    { label: 'LinkedIn', href: 'https://www.linkedin.com/company/knowledge-graph-conference/' },
    { label: 'X', href: 'https://x.com/knowledgegraphc' },
    { label: 'YouTube', href: 'https://www.youtube.com/@knowledgegraphconference' },
    // A `Slack` entry used to sit here pointing at `https://www.knowledgegraph.tech/`
    // — a link that says Slack and lands on the homepage. Restore it with the real
    // workspace invite URL; until someone has that URL, no link is better than a
    // wrong one, for the same reason the `NAV` docblock gives.
  ],
} as const;

/**
 * The standing line at the head of the strip, when there is no live news.
 *
 * On the live site this reads "SOLD OUT – REPLAY PURCHASES OPEN SOON", which is
 * true of the finished 2026 event and would be a lie about 2027. It lives here,
 * as one string, so that changing what the site announces is a one-line edit by
 * someone who knows the answer — rather than a hunt through JSX by someone who
 * does not. Set it to `null` to drop it.
 *
 * ⚠️ This is no longer the only thing the strip can say. Announcements posted
 * from the organizer dashboard are read live by `listAnnouncements()` and
 * displace this line while they exist — see `components/ticker.tsx`. Editing
 * this string will not silence a room change that an organizer has posted, and
 * it should not: the collection is the newer, more specific truth.
 */
export const ANNOUNCEMENT: string | null = 'Tickets for KGC 2027 open soon';

/**
 * What scrolls past in the ticker under the header.
 *
 * The bar was one static sentence. It is the widest, most persistent element on
 * every page of the site and it was spending all of that on six words, so it now
 * carries the handful of facts a visitor is actually deciding on — when, where,
 * how much, how big — and moves, which is what makes a strip that thin worth
 * reading at all.
 *
 * A live announcement leads the loop, and `ANNOUNCEMENT` above leads it when
 * there is none — so the most specific thing anyone has said is the first thing
 * read. Keep these short: they are read in passing.
 */
export const TICKER: string[] = [
  '3–7 May 2027',
  'Cornell Tech, Roosevelt Island, NYC',
  '1,000+ attendees expected',
  'Workshops Mon–Tue · Conference Wed–Fri',
  'Every session recorded',
  'Virtual tickets from $349',
  'HCLS symposium included with any in-person ticket',
];

/**
 * The badge on the healthcare & life sciences panel.
 *
 * The live site renders "HCLS sold out" — true of the finished 2026 symposium,
 * and a lie about 2027, exactly like `ANNOUNCEMENT` above. Same treatment: one
 * declaration, changed by whoever knows the answer. Set `label` to
 * `'HCLS sold out'` and `href` to `null` to reproduce the live 2026 state; set
 * the whole export to `null` to drop the badge.
 */
export const HCLS_BADGE: { label: string; href: string | null } | null = {
  label: 'HCLS tickets open soon',
  href: null,
};

/**
 * Which roster the public `/speakers` page renders. **This is the switch.**
 *
 * `'2026-roster'` — the real, published KGC 2026 speakers, checked in as data at
 * `lib/speakers-2026.ts`. This is the shipping value and it is a decision, not
 * an oversight: KGC 2027 has no selected programme, and the `speakers`
 * collection currently holds **invented names** written by `npm run seed`. A
 * public page carrying fabricated people with fabricated employers is worse
 * than a page carrying last year's real ones, which is why the page says
 * whose roster it is showing.
 *
 * `'firestore'` — the live `speakers` collection, via `listSpeakers()`. Flip
 * this the day a genuine 2027 roster is in Firestore and the whole change is
 * this one line; both render paths are written and the page picks between them.
 *
 * ⚠️ **Two things must change together with it**, because the dashboard's
 * readiness screen already reports on `/speakers` as though this were
 * `'firestore'` today:
 *
 *   1. `apps/organizer/src/lib/webpages.ts` — `pageReadiness().speakers`
 *      counts speakers with no photo, no bio, no company and calls them
 *      problems with "your speakers page". While this constant is
 *      `'2026-roster'` that page renders none of those documents, so every one
 *      of those counts is about a page nobody can see. That file is owned by
 *      the dashboard and cannot import this constant (the two apps are separate
 *      installs and neither may import the other), so it carries its own copy
 *      of the decision.
 *   2. `ROADMAP.md`'s Phase 5 bullet, which records the same decision in prose.
 */
export const SPEAKERS_PAGE_SOURCE: '2026-roster' | 'firestore' = '2026-roster';

/**
 * The attendance figure in the first stat block.
 *
 * The other two stat blocks count real Firestore documents. This one cannot:
 * `registrations` holds ticket holders for *this* edition mid-sale, which in a
 * seeded demo is fifty-odd people and would render "52 Attendees" under a
 * headline claiming a thousand. So this is what it says it is — a stated
 * expectation, phrased as one — and it is here rather than in JSX so that
 * nobody has to guess whether the number was counted or typed. It was typed.
 */
export const ATTENDEES_EXPECTED = '1,000+';

/**
 * How an attendee actually gets the app, stated as one editable sentence.
 *
 * The confirmation page used to say "Search 'Knowledge Graph Conference' on the
 * App Store or Google Play". The app is published to neither — it runs in Expo
 * Go — so every purchaser was being sent to a store search that returns nothing,
 * on the one page they are guaranteed to read. This is here, next to
 * `ANNOUNCEMENT` and `HCLS_BADGE`, for the same reason those are: it is a claim
 * about the world that only the owner can make true, and it should be changed in
 * one place by whoever knows the answer.
 *
 * Set it to the store sentence on the day the app is actually listed.
 */
export const APP_DISTRIBUTION =
  'We will send you an install link before the conference. The app is not on the public app stores yet.';

/**
 * Where the attendee app is hosted.
 *
 * The Expo app exported to the web, so a buyer can open it from the
 * confirmation page on whatever device they are already holding. It is not the
 * shipping distribution — that is the app stores — but it is the only one that
 * needs nothing installed and no shared Wi-Fi, which is what a demo needs.
 */
export const APP_URL = process.env.APP_PUBLIC_URL ?? 'https://kgc-2027-app.netlify.app';

/**
 * The header navigation.
 *
 * The live site's own navigation, scraped: `2026 Speakers`, `Sponsor KGC`,
 * `Blog`, `Learn`, `About KGC`, `Community`, `Resource Hub`, `Healthcare & Life
 * Sciences Symposium`, `Meet the Team`, and a `Previous Events` menu going back
 * to KGC 2019 — twenty internal pages in all. This list is that one intersected
 * with what exists here, because a navigation item that 404s is worse than an
 * absent one.
 *
 * `HCLS` has just moved from the second list to the first. Still missing, in
 * rough order of how much they would be missed: `/team`, `/community`,
 * `/knowledge-graph-learning-program`, `/blog`, and the 2019–2025 archive pages.
 */
export const NAV = [
  { href: '/speakers', label: `${2027} Speakers` },
  /*
   * Agenda is here and not behind the dropdown, which is the one deliberate
   * departure from the live site's row. Its agenda is a homepage widget; ours
   * is a page, and the single thing people come to a conference site for should
   * not be two interactions away.
   */
  { href: '/agenda', label: 'Agenda' },
  { href: '/sponsor', label: 'Sponsor KGC' },
  { href: '/blog', label: 'Blog' },
  { href: '/learn', label: 'Learn' },
] as const;

export interface NavChild {
  href: string;
  label: string;
  /** Opens in a new tab and gets the external affordance. */
  external?: boolean;
  /** Rendered but not yet built here — see the note below. */
  todo?: boolean;
}

/**
 * The "About KGC" dropdown, transcribed from the live site's own menu on
 * 2026-08-19 by opening it and reading the rendered anchors.
 *
 * This exists because the previous arrangement hid real pages. `NAV_MORE`
 * computed to `display: none` at desktop widths, so `/hcls` and `/tickets` were
 * reachable only from the hamburger — which desktop visitors never open. The
 * live site solves the same problem with this dropdown, and so do we.
 *
 * Every entry resolves. Community, Meet the Team and the Lifetime Achievement
 * Award were built on 2026-08-20 for exactly this reason — a menu entry with
 * nowhere to point is worse than no entry. The `todo` flag stays on the type
 * because the next entry added may well arrive before its page does.
 */
export const ABOUT_MENU: readonly NavChild[] = [
  { href: '/about', label: 'About KGC' },
  { href: '/community', label: 'Community' },
  { href: 'https://hub.knowledgegraph.tech/', label: 'Resource Hub', external: true },
  { href: '/hcls', label: 'Healthcare & Life Sciences Symposium' },
  { href: '/team', label: 'Meet the Team' },
  { href: '/blog', label: 'KGC Talks' },
  { href: '/kgc-lifetime-achievement-awards', label: 'Lifetime Achievement Award' },
  /*
   * The live menu expands this into seven per-edition links. Ours is one index
   * page that links out to the same seven archives — see `previous-events/page.tsx`
   * for why they are not rebuilt here.
   */
  { href: '/previous-events', label: 'Previous Events' },
  {
    href: 'https://the-knowledge-graph-conference.myspreadshop.com/',
    label: 'KGC Store',
    external: true,
  },
] as const;

/** Kept for the mobile menu, which shows everything in one flat list. */
export const NAV_MORE = [
  { href: '/tickets', label: 'Tickets' },
] as const;

/** `2027-05-05` → `Wednesday 5 May`. Parsed as a plain date, never as an instant. */
export function formatDayHeading(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  // `Date.UTC` + a UTC formatter: constructing `new Date('2027-05-05')` and
  // formatting it locally shifts the label a day west of Greenwich.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt);
}

/**
 * `2027-05-05` → `{ weekday: 'Wed', date: 'May 05' }`.
 *
 * The two-line label the day tabs show, stacked. Same UTC-anchored parse as
 * `formatDayHeading` and for the same reason: these are plain dates, and
 * `new Date('2027-05-05')` formatted locally reads a day early west of
 * Greenwich.
 */
export function formatDayTab(day: string): { weekday: string; date: string } {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(dt);
  return { weekday: fmt({ weekday: 'short' }), date: fmt({ month: 'short', day: '2-digit' }) };
}

/** `2027-05-05T09:00` → `09:00`. The stored wall clock is already event-local. */
export function localTime(wallClock: string): string {
  return wallClock.slice(11, 16);
}
