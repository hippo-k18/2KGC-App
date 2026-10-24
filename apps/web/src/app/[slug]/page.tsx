import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { richTextToPlainText } from '@kgc/shared';
import { RichText } from '@/components/rich-text';
import { brandingSettings, getPublicPage } from '@/lib/data';

/**
 * Two things share this address: the organizer's branded event URL, and the
 * custom content pages they write themselves.
 *
 * ── The branded slug, and why it redirects ──────────────────────────────────
 *
 * Whova sells a vanity address for an event and prints it on badges, posters
 * and email signatures months before anyone types it. There is nothing behind
 * one that is not already the front page — a second homepage at a second
 * address would be two pages to keep in step and two URLs in Google for one
 * conference — so the branded slug is a door into the site rather than a room
 * in it.
 *
 * ⚠️ A **temporary** redirect, deliberately. `redirect()` answers 307;
 * `permanentRedirect()` answers 308, which browsers cache indefinitely and
 * effectively cannot be withdrawn. The slug is a value an organizer can edit in
 * a form — the day they change it, the old address must stop working, and a 308
 * would keep sending anyone who ever visited it to a path we no longer claim.
 *
 * ── Custom pages, and why they are second ───────────────────────────────────
 *
 * Content › Branding Center › Customize Resources writes `pages/{id}`: a title,
 * an address, some Markdown and a switch. This route serves the published ones.
 * The branded slug is checked first because it is the one address an organizer
 * has already printed on physical objects; a page that claimed the same string
 * would quietly break every badge. The dashboard's slug check refuses the
 * website's own static routes for the same class of reason, and cannot know
 * about the branded slug, which is why the order here decides it rather than a
 * validation rule somewhere else.
 *
 * ── Why an exact match and a 404 for everything else ────────────────────────
 *
 * This is a dynamic segment at the root, so it catches every single-segment
 * path that no static route already owns. Next resolves static segments first,
 * so `/about` and `/agenda` are unaffected — but the day somebody adds a new
 * top-level page, this file is what stands between them and a route that
 * silently swallows it. Matching exactly and calling `notFound()` for everything
 * else keeps that failure loud: an unknown path renders the site's own 404,
 * exactly as it did before this route existed.
 *
 * `force-dynamic` because both answers are stored values. Prerendering this
 * would freeze whichever was in Firestore at build time, so an organizer
 * publishing a page would get a 404 on it until the next deploy.
 */
/**
 * Rendered once and reused for up to a minute, rather than from scratch on
 * every visit. Both the address and the body are stored values an organizer edits.
 *
 * Every page on this site was `force-dynamic`, so nothing was ever cached by
 * anybody: the agenda took 0.81 to 0.95 seconds to first byte on the live site
 * against 0.06 for a page that read nothing. No visitor now pays for a query
 * another visitor has already made.
 *
 * Thirty seconds and not sixty, because this window sits on top of the one in
 * `shared()` and the two add up. See `SHARED_SECONDS` in `lib/data.ts`: thirty
 * over thirty is a change on the site inside a minute, which is what an
 * organizer who saves and switches tab is waiting for.
 */
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublicPage(slug);
  if (!page) return {};

  // The summary if the organizer wrote one, otherwise the opening of the page
  // itself flattened to one line. A description assembled from the body is
  // better than none, and much better than an invented one.
  const description = page.summary || richTextToPlainText(page.body).slice(0, 180);
  return { title: page.title, description: description || undefined };
}

export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { brandedSlug } = await brandingSettings();

  // An unset slug matches nothing. Comparing folded case because the value is
  // read off printed material and typed by hand, where capitalisation is not a
  // decision anyone made.
  if (brandedSlug && slug.toLowerCase() === brandedSlug.toLowerCase()) redirect('/');

  const page = await getPublicPage(slug);
  if (!page) notFound();

  return (
    <section>
      <div className="wrap narrow">
        <h1>{page.title}</h1>
        {page.summary && <p className="lede">{page.summary}</p>}
        <RichText body={page.body} />
      </div>
    </section>
  );
}
