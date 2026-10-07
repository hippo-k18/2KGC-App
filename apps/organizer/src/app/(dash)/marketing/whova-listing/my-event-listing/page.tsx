import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { publicUrl } from '@/lib/webpages';
import { GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

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

  /*
   * What a stranger has to be able to find, and where each answer is kept.
   *
   * This was a Whova-listing-field-to-ours mapping, which made the screen a
   * comparison rather than a piece of information: an organizer looking for
   * "how do people find us" had to read a column about a product they are not
   * using to reach the column they wanted.
   */
  const DISCOVERY = [
    {
      need: 'The name shown in a search result',
      ours: 'The site title',
      where: '',
      live: false,
    },
    {
      need: 'The sentence under it',
      ours: 'The site description, also used when a link is shared',
      where: '',
      live: false,
    },
    {
      need: 'The picture when a link is shared',
      ours: 'The site share image',
      where: '',
      live: false,
    },
    {
      need: 'The dates and the venue',
      ours: 'The About page',
      where: '/about',
      live: false,
    },
    {
      need: 'The programme',
      ours: 'Session Manager',
      where: '/agenda',
      live: true,
    },
    {
      need: 'The price',
      ours: 'Create Tickets',
      where: '/tickets',
      live: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="My Event Listing"
        info={
          <>
            <strong>No event directory</strong>
            <p>
              A directory listing is not available. This screen shows what people see when they
              find {EVENT.shortName} through search or a shared link.
            </p>
          </>
        }
        tags={<Tag color="grey" fill="outline">not applicable</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main secondary">
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

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What people see in search and shared links</h2>
        <Table
          cols={[
            { key: 'n', label: 'What people see', className: 'cell-md' },
            { key: 'o', label: 'Where it comes from', className: 'cell-fill' },
            { key: 'p', label: 'Maintained in', className: 'cell-md' },
          ]}
          rows={DISCOVERY.map((e) => [
            e.need,
            e.ours,
            e.live ? (
              <span key="p" style={{ fontSize: 12 }}>
                <Tag color="green" fill="outline" small>
                  live
                </Tag>{' '}
                <a href={publicUrl(e.where)} target="_blank" rel="noreferrer">
                  <code>{e.where}</code> ↗
                </a>
              </span>
            ) : (
              <span key="p" className="muted" style={{ fontSize: 12 }}>
                {e.where ? <code>{e.where}</code> : null}
                {e.where ? '. ' : ''}Ask the developer
              </span>
            ),
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          <Link href="/marketing/event-website">Event Website</Link> lists every page and where it
          is edited.
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
