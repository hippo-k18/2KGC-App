import { EVENT } from '@kgc/shared';

import { SITE_ORIGIN } from '@/config/event';

/**
 * Where the app sends people for its privacy policy, terms and help (T212).
 *
 * Both stores want the privacy policy reachable from inside the app, and Apple's
 * guideline 1.2 wants a published contact for an app with user content. The
 * pages are the website's own, so there is one policy, not a copy in the app
 * that drifts from it.
 */
export const PRIVACY_URL = `${SITE_ORIGIN}/privacy`;
export const TERMS_URL = `${SITE_ORIGIN}/terms`;

/**
 * The address to write to: the support address saved on the dashboard, or the
 * conference's own when none is set. Never empty, because "contact us" with no
 * address is the one thing a reviewer looks for and does not find.
 */
export function contactAddress(supportEmail: string | null | undefined): string {
  return supportEmail?.trim() || EVENT.contactEmail;
}
