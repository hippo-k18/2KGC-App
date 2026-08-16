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
    { label: 'Slack', href: 'https://www.knowledgegraph.tech/' },
  ],
} as const;

export const NAV = [
  { href: '/speakers', label: 'Speakers' },
  { href: '/agenda', label: 'Agenda' },
  { href: '/sponsor', label: 'Sponsor KGC' },
  { href: '/about', label: 'About KGC' },
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

/** `2027-05-05T09:00` → `09:00`. The stored wall clock is already event-local. */
export function localTime(wallClock: string): string {
  return wallClock.slice(11, 16);
}
