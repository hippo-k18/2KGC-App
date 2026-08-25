import 'server-only';

/**
 * The facts about how somebody actually gets the KGC app.
 *
 * ── This is the only place in the console that states them ──────────────────
 *
 * `apps/web/src/lib/site.ts` holds the same claim for the public site, with a
 * long comment explaining why: the confirmation page once told buyers to
 * "search the App Store", the app is on no store, and every purchaser was sent
 * to a search returning nothing on the one page they are guaranteed to read.
 *
 * The two websites cannot import from each other, so this is a second copy —
 * which is a real duplication and is flagged here rather than hidden. It is
 * one sentence, it changes on one known day, and every snippet on these screens
 * is generated from the constants below so that day is a single edit.
 *
 * ⚠️ **Do not write store links into any template on these screens.** The
 * whole point of Tools › App Adoption is to hand an organizer text they will
 * paste in front of a thousand attendees.
 */

export const APP_IS_ON_STORES = false;

export const APP_DISTRIBUTION =
  'We will send you an install link before the conference. The app is not on the public app stores yet.';

/** Expo Go is how a phone opens the app today. */
export const EXPO_GO_URL = 'https://expo.dev/go';

export function siteOrigin(): string {
  return (process.env.WEB_PUBLIC_ORIGIN ?? 'https://www.knowledgegraph.tech').replace(/\/$/, '');
}
