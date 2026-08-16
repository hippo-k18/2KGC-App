/**
 * Event constants for the app.
 *
 * `EVENT` itself lives in `@kgc/shared` because Cloud Functions and the
 * importer need the same id and time zone — a second copy would drift, and the
 * first symptom would be sessions landing on the wrong day tab.
 */
export { EVENT, EVENT_ID, TIME_ZONE } from '@kgc/shared';

/** Routes reachable without a session. Everything else redirects to /login. */
export const PUBLIC_ROUTES = ['/login'] as const;
