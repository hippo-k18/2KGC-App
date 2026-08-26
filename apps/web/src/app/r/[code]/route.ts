import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE,
  resolveAndCount,
} from '@/lib/campaign-links';

/**
 * `/r/{code}` — a tracked link.
 *
 * Two things happen here and they are independent. The click is counted, which
 * is what Campaign Link Tracking reports. And a first-party cookie is set, so
 * that if this visitor buys a ticket the purchase can be credited back to the
 * link — which is what Referral Contest reports.
 *
 * ── Why a cookie rather than a query parameter carried through ──────────────
 *
 * A parameter survives exactly one navigation. Real buyers land on the tickets
 * page, read the FAQ, look at the agenda, come back and then buy — and the
 * parameter is long gone. The cookie survives that, and it survives the visitor
 * closing the tab and returning on Friday, which is the case that matters most.
 *
 * It is first-party, `SameSite=Lax`, and holds a short code the organizer chose
 * — not an identifier, not a profile, and nothing shared with any third party.
 * There is no analytics vendor anywhere on this site.
 *
 * ── `dynamic` is not optional here ──────────────────────────────────────────
 *
 * A cached response would count one click for every visitor after the first,
 * which is to say it would count one.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;

  const link = await resolveAndCount(code);
  /**
   * A 404, not a redirect to the homepage.
   *
   * Sending an unknown code somewhere friendly would hide a typo in a link that
   * has already gone out to a thousand people. A 404 is how that gets noticed
   * while there is still time to send a correction.
   */
  if (!link) notFound();

  const jar = await cookies();
  jar.set(ATTRIBUTION_COOKIE, link.code, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ATTRIBUTION_MAX_AGE,
  });

  /**
   * Last click wins.
   *
   * `cookies().set` overwrites, so a visitor who arrives via a partner link and
   * later via a speaker's referral is credited to the speaker. That is a
   * choice, and it is the conventional one — the touch closest to the purchase
   * is the one a referral contest is trying to reward.
   */
  redirect(link.destination);
}
