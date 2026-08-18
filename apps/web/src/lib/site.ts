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
 * The strip above the header.
 *
 * On the live site this reads "SOLD OUT – REPLAY PURCHASES OPEN SOON", which is
 * true of the finished 2026 event and would be a lie about 2027. It lives here,
 * as one string, so that changing what the site announces is a one-line edit by
 * someone who knows the answer — rather than a hunt through JSX by someone who
 * does not. Set it to `null` to remove the bar entirely.
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
 * `ANNOUNCEMENT` still leads the loop, so the one line the owner edits by hand
 * is the first thing anyone sees. Keep these short: they are read in passing.
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
  { href: '/sponsor', label: 'Sponsor KGC' },
  { href: '/blog', label: 'Blog' },
  { href: '/learn', label: 'Learn' },
  { href: '/about', label: 'About KGC' },
] as const;

/**
 * The rest of the live site's navigation, behind the hamburger — which is where
 * the live site puts it too, rather than in the primary row.
 *
 * Agenda and HCLS live here rather than in `NAV` for exactly that reason: the
 * live site's primary row is five items and does not include either, and
 * matching that row was an explicit instruction. They are one tap away, and the
 * homepage links to both directly.
 */
export const NAV_MORE = [
  { href: '/agenda', label: 'Agenda' },
  { href: '/hcls', label: 'Healthcare & Life Sciences Symposium' },
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
