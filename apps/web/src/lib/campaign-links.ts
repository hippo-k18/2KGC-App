import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type CampaignLinkDoc } from '@kgc/shared';
import { db } from './firestore';

/**
 * Resolving and counting a tracked link.
 *
 * `/r/{code}` is a short link an organizer puts in an email, a LinkedIn post or
 * a partner's newsletter. It redirects to a real page on this site and counts
 * the click on the way through.
 *
 * ── Why the counting lives here rather than in a Cloud Function ─────────────
 *
 * The route runs on the server with the Admin SDK, so it can increment the
 * counter itself. That is not merely convenient: this project is on the Spark
 * plan and cannot deploy a function at all, so anything needing a trigger is
 * blocked indefinitely. A redirect that counts itself is not blocked.
 *
 * ── The count never blocks the redirect ─────────────────────────────────────
 *
 * A visitor who clicked a link in an email is mid-journey. If Firestore is slow
 * or unreachable, the correct outcome is that they still land on the tickets
 * page and the analytics are wrong — never that they see an error because a
 * counter could not be written. So the increment is fired and its failure is
 * logged, not awaited for correctness.
 */

export interface ResolvedLink {
  /** Relative path on this site, always — never an absolute URL. */
  destination: string;
  code: string;
}

/**
 * A code is letters, digits and hyphens.
 *
 * Checked before the read rather than after, because the code comes straight
 * out of a URL segment and `db().doc(userInput)` with a slash in it addresses a
 * different collection entirely.
 */
export function validCode(code: string): boolean {
  return /^[a-z0-9-]{1,48}$/.test(code);
}

/**
 * Look a code up and record the click.
 *
 * Returns `null` for an unknown, inactive or foreign-event code, and the caller
 * 404s. Redirecting an unknown code to the homepage would be friendlier and
 * would also hide a typo in an email that has already gone to a thousand
 * people — a 404 is how that gets noticed.
 */
export async function resolveAndCount(code: string): Promise<ResolvedLink | null> {
  if (!validCode(code)) return null;

  const ref = db().collection(COLLECTIONS.campaignLinks).doc(code);

  let doc: CampaignLinkDoc | undefined;
  try {
    const snap = await ref.get();
    if (!snap.exists) return null;
    doc = snap.data() as CampaignLinkDoc;
  } catch (err) {
    console.error('[campaign-links] lookup failed for', code, err);
    return null;
  }

  if (doc.eventId !== EVENT_ID) return null;
  if (doc.active === false) return null;

  /**
   * A destination is validated on the way out, not only on the way in.
   *
   * The organizer dashboard refuses an absolute URL when the link is created,
   * but this is a redirect handler reading a database — and an open redirect is
   * exactly the primitive a phishing campaign wants. Refusing anything that is
   * not a same-site path is the check that has to be here, because this is the
   * code that performs the redirect.
   */
  const destination = doc.destination ?? '/';
  if (!destination.startsWith('/') || destination.startsWith('//')) {
    console.error('[campaign-links] refusing off-site destination on', code, destination);
    return null;
  }

  // Fire and log. The visitor's redirect does not wait on the analytics.
  ref
    .update({ clicks: FieldValue.increment(1), lastClickedAt: Timestamp.now() })
    .catch((err) => console.error('[campaign-links] could not count click on', code, err));

  return { destination, code };
}

/**
 * How long an attribution cookie lives.
 *
 * Thirty days, matching the window most conference marketing reports use. It is
 * a trade rather than a fact: too short and a buyer who read the email on
 * Monday and bought on Friday looks organic; too long and a link clicked once
 * takes credit for a purchase it had nothing to do with.
 */
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 30;

/** The cookie the redirect sets and checkout reads. First-party, same-site. */
export const ATTRIBUTION_COOKIE = 'kgc_ref';
