import 'server-only';

/**
 * What Tools › App Adoption needs to know that is specific to the console.
 *
 * The two facts the *public* side states as well — the site's origin and the
 * sentence about how somebody gets the app — are not here any more. They were,
 * as hand-kept second copies of `apps/web/src/lib/site.ts`, under a comment
 * saying so; a third copy of the sentence and a fourth of the origin were
 * sitting in `snippet.tsx` in this same directory at the same time. Both now
 * come from `@kgc/shared` — `publicSiteOrigin()` and `APP_DISTRIBUTION` — which
 * both apps and the scripts already depend on, so a screen that hands an
 * organizer text to publish and the confirmation page that buyer reads cannot
 * disagree.
 *
 * ⚠️ **Do not write store links into any template on these screens.** The
 * whole point of Tools › App Adoption is to hand an organizer text they will
 * paste in front of a thousand attendees.
 */

export const APP_IS_ON_STORES = false;

/** Expo Go is how a phone opens the app today. */
export const EXPO_GO_URL = 'https://expo.dev/go';
