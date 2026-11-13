/**
 * Where "Speak at KGC" and "call for speakers" links go (T405).
 *
 * Straight to the call page while a call is shown on the website (the same
 * `shownCall()` the footer and `/speakers` use). Only with no call do they fall
 * back to the speaking box on `/sponsor`, whose button is then an email.
 */
export const SPEAK_FALLBACK = '/sponsor#speak';

export function speakHref(call: { id: string } | null | undefined): string {
  return call ? `/submit/${encodeURIComponent(call.id)}` : SPEAK_FALLBACK;
}

/** The close date the speaking box shows when the call does not carry one. */
const DEFAULT_CLOSE = '2027-01-15';

/**
 * `2027-01-15` → "January 15, 2027". A calendar date, so read at noon UTC and
 * formatted in UTC: no zone can move it a day.
 */
export function speakCloseLabel(isoDate: string | undefined): string {
  const day = isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : DEFAULT_CLOSE;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
