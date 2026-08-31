import { notFound, redirect } from 'next/navigation';
import { brandingSettings } from '@/lib/data';

/**
 * The organizer's branded event URL — `settings/branding.brandedSlug`.
 *
 * Whova sells a vanity address for an event and prints it on badges, posters
 * and email signatures months before anyone types it. The dashboard has let an
 * organizer reserve one since August; nothing served it, so the screen at
 * `content/branding-center/branded-event-url` had to say out loud that the
 * address they had just chosen did not resolve. This is the route that makes it
 * resolve, and that copy comes down with it.
 *
 * ── Why a redirect rather than a page ───────────────────────────────────────
 *
 * There is nothing behind a vanity URL that is not already the front page. A
 * second homepage at a second address would be two pages to keep in step and
 * two URLs in Google for one conference, so the branded slug is a door into the
 * site rather than a room in it.
 *
 * ⚠️ A **temporary** redirect, deliberately. `redirect()` answers 307;
 * `permanentRedirect()` answers 308, which browsers cache indefinitely and
 * effectively cannot be withdrawn. The slug is a value an organizer can edit in
 * a form — the day they change it, the old address must stop working, and a 308
 * would keep sending anyone who ever visited it to a path we no longer claim.
 *
 * ── Why an exact match and a 404 for everything else ────────────────────────
 *
 * This is a dynamic segment at the root, so it catches every single-segment
 * path that no static route already owns. Next resolves static segments first,
 * so `/about` and `/agenda` are unaffected — but the day somebody adds a new
 * top-level page, this file is what stands between them and a route that
 * silently swallows it. Matching one exact string and calling `notFound()` for
 * everything else keeps that failure loud: an unknown path renders the site's
 * own 404, exactly as it did before this route existed.
 *
 * `force-dynamic` because the slug is a setting. Prerendering this would freeze
 * whichever value was in Firestore at build time, so an organizer changing it
 * would get a 404 on their new address and a working one on their old.
 */
export const dynamic = 'force-dynamic';

export default async function BrandedSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { brandedSlug } = await brandingSettings();

  // An unset slug matches nothing. Comparing folded case because the value is
  // read off printed material and typed by hand, where capitalisation is not a
  // decision anyone made.
  if (!brandedSlug || slug.toLowerCase() !== brandedSlug.toLowerCase()) notFound();

  redirect('/');
}
