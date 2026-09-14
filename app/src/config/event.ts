/**
 * Event constants for the app.
 *
 * `EVENT` itself lives in `@kgc/shared` because Cloud Functions and the
 * importer need the same id and time zone — a second copy would drift, and the
 * first symptom would be sessions landing on the wrong day tab.
 */
export { EVENT, EVENT_ID, TIME_ZONE } from '@kgc/shared';

/**
 * Where `apps/web` is serving from, as far as this app is concerned.
 *
 * Two surfaces need it and neither can guess: sign-in posts to
 * `/api/auth/request-code` and `/api/auth/verify-code` there, and the session
 * screen's "Add to My Calendar" hands out `/agenda/{id}/calendar.ics` and a
 * "Full programme" link inside the calendar entry itself.
 *
 * ⚠️ **Not `publicSiteOrigin()` from `@kgc/shared`.** That function reads
 * `WEB_PUBLIC_ORIGIN`, a server variable that does not exist on a phone, and
 * falls back to `EVENT.website` — `www.knowledgegraph.tech`, the conference's
 * front door, which is *not* where this Next app is deployed. Calling it here
 * would mint URLs that look exactly right and 404, which is the worst available
 * outcome for a link written into somebody's calendar and trusted for months.
 *
 * The default is the deployed site rather than `localhost`, because a build with
 * no `.env.local` is far more likely to be a phone in a conference hall than a
 * laptop running Next on :3200 — and the failure of getting that backwards is
 * silent in exactly the situation where nobody can fix it.
 *
 * ⚠️ Corrected from `kgc-2027-website.netlify.app` on 2026-09-14. That is an
 * abandoned deploy on a different Netlify account, and because this is the
 * fallback for the phone-in-a-hall case, the wrong value would have sent every
 * sign-in request to a site that has no current code.
 */
export const SITE_ORIGIN = (
  process.env.EXPO_PUBLIC_SITE_ORIGIN ?? 'https://kgc27-website.netlify.app'
).replace(/\/+$/, '');

/** Routes reachable without a session. Everything else redirects to /login. */
export const PUBLIC_ROUTES = ['/login'] as const;
