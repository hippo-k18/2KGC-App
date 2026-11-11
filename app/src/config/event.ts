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
 * Its own constant rather than `publicSiteOrigin()` from `@kgc/shared`, which
 * reads `WEB_PUBLIC_ORIGIN`, a server variable a phone does not have. Since the
 * www cutover on 2026-10-03 both name the same site, but a build can still
 * point this one somewhere else (a laptop on :3200) through
 * `EXPO_PUBLIC_SITE_ORIGIN`.
 *
 * The default is the deployed site rather than `localhost`, because a build with
 * no `.env.local` is far more likely to be a phone in a conference hall than a
 * laptop running Next on :3200 — and the failure of getting that backwards is
 * silent in exactly the situation where nobody can fix it.
 *
 * ⚠️ The default was `kgc27-website.netlify.app` until 2026-10-12 (T212). That
 * site was deleted on 2026-09-25 and answers 404, so every store build would
 * have failed to sign anybody in and handed out dead calendar links. The
 * website, its sign-in API and the `.ics` route all live on www now. `||`
 * rather than `??`, so a variable that is set but blank also falls back.
 */
export const SITE_ORIGIN = (
  process.env.EXPO_PUBLIC_SITE_ORIGIN || 'https://www.knowledgegraph.tech'
).replace(/\/+$/, '');

/** Routes reachable without a session. Everything else redirects to /login. */
export const PUBLIC_ROUTES = ['/login'] as const;
