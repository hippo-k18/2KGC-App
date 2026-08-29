import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Whova Listing › My Event Listing.
 *
 * ── Not applicable: this is Whova's directory entry, not ours ───────────────
 *
 * Whova runs a public event directory and this screen edits the card your event
 * shows in it — the blurb, the categories, the cover image, whether the listing
 * is public at all. It is a page on whova.com.
 *
 * Reproducing it would mean building an event directory: a second public
 * surface listing many conferences, with search, categories and moderation.
 * That is a different product, and one KGC has no reason to be in.
 *
 * ── But the underlying need is real and already met ─────────────────────────
 *
 * What an organizer actually wants from a directory listing is to be found. The
 * mechanism for that on the open web is the site's own metadata — title,
 * description, Open Graph card, `Event` structured data — which lives in
 * `apps/web`, not in a directory somebody else owns. So the useful thing this
 * screen can do is name that equivalence rather than leave the nav item blank.
 */
export default async function MyEventListingPage() {
  await requireOrganizer();

  // The mapping that makes "not applicable" useful rather than dismissive:
  // every field of a Whova listing has somewhere it already lives for us.
  const EQUIVALENTS = [
    { whova: 'Listing title', ours: 'The <title> on knowledgegraph.tech', where: 'apps/web layout' },
    { whova: 'Short description', ours: 'The meta description and OG description', where: 'apps/web layout' },
    { whova: 'Cover image', ours: 'The Open Graph image', where: 'apps/web layout' },
    { whova: 'Dates, venue, price', ours: 'Written into the pages themselves', where: '/about, /agenda, /tickets' },
    { whova: 'Categories and tags', ours: 'Not applicable — no directory to be filed in', where: '—' },
    { whova: 'Public / private toggle', ours: 'Not applicable — the site is public', where: '—' },
  ];

  return (
    <>
      <PageHeader
        title="My Event Listing"
        tags={<Tag color="grey" fill="outline">not applicable</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Open the site ↗
          </a>
        }
        links={[
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
          <Link key="t" href="/marketing/whova-listing/traffic-analytics">
            Traffic analytics
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>There is no directory to be listed in.</strong> This screen edits{' '}
        {EVENT.shortName}&rsquo;s card inside Whova&rsquo;s public event directory. Building an
        equivalent means building a directory of other people&rsquo;s conferences — a different
        product, not a missing screen. What the listing is <em>for</em> is being found, and on the
        open web that is the site&rsquo;s own metadata.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where each listing field already lives</h2>
        <Table
          cols={[
            { key: 'w', label: 'Whova listing field', className: 'cell-md' },
            { key: 'o', label: 'Our equivalent', className: 'cell-fill' },
            { key: 'p', label: 'Maintained in', className: 'cell-md' },
          ]}
          rows={EQUIVALENTS.map((e) => [
            e.whova,
            e.ours,
            e.where === '—' ? (
              <span key="p" className="muted">
                —
              </span>
            ) : (
              <code key="p" style={{ fontSize: 12 }}>
                {e.where}
              </code>
            ),
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          All four of the ones that map are code, so changing them is a deploy — the same trade the
          Event Website screen describes for the sixteen static pages.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A public event directory.</strong> Not applicable, and not planned. This is the
            clearest case in the whole nav of a Whova feature that exists because Whova is a
            platform rather than because organizers asked for it.
          </li>
          <li>
            <strong>Editing site metadata from this dashboard.</strong> Title, description and the
            Open Graph card are code in <code>apps/web</code>. A settings bag could hold them, but
            nothing in <code>apps/web</code> reads settings at request time, so saving one here
            would change nothing.
          </li>
          <li>
            <strong>Structured data for search engines.</strong> An <code>Event</code> JSON-LD
            block would let Google show dates and a venue directly in results. It is the real
            version of &ldquo;being listed&rdquo;, it is roughly an hour of work in{' '}
            <code>apps/web</code>, and nobody has done it.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
