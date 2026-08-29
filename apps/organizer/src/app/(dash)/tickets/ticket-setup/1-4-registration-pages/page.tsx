import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.4 Registration Pages.
 *
 * The registration page exists and sells real tickets — it is `/tickets` on the
 * marketing site, and everything on it that is *data* already comes from
 * Firestore: the tiers, prices, taglines, inclusion lists, sold-out state and
 * sales windows are all read through `catalogue.ts` at request time, with no
 * hard-coded fallback.
 *
 * What does not come from Firestore is the page itself. Headings, ordering of
 * the sections, the FAQ and the surrounding copy are JSX in `apps/web`, so
 * changing them is a deploy. That is the same limitation `ROADMAP.md` records
 * against the whole website under Phase 5, and it is the honest thing to say
 * here rather than offering a page builder that would edit nothing.
 */
export default async function RegistrationPagesPage() {
  await requireOrganizer();
  const tiers = await listTicketTypes();
  const visible = tiers.filter((t) => t.visible);

  return (
    <>
      <PageHeader
        title="1.4 Registration Pages"
        tags={<Tag color="green" fill="outline">{visible.length} tiers live</Tag>}
        links={[
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="s" href="/tickets/ticket-setup/1-7-registration-settings">
            Registration Settings
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>The page is real; the editor is not.</strong> Prices, tiers and availability are
        read live from <code>ticketTypes</code> — edit them in{' '}
        <Link href={ROUTES.createTickets}>Create Tickets</Link> and the public page changes on the
        next request. Headings and copy are React components in <code>apps/web</code> and change
        with a deploy.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What the buyer sees right now</h2>
        <Table
          cols={[
            { key: 'n', label: 'Tier', className: 'cell-md' },
            { key: 'p', label: 'Price', className: 'cell-sm' },
            { key: 'o', label: 'Order', className: 'cell-sm' },
            { key: 's', label: 'State', className: 'cell-fill' },
          ]}
          rows={tiers.map((t) => [
            <span key="n">
              {t.name}
              {t.featured ? (
                <>
                  {' '}
                  <Tag color="purple" small>
                    featured
                  </Tag>
                </>
              ) : null}
            </span>,
            money(t.priceCents, t.currency),
            t.sortOrder,
            t.visible ? (
              <span key="s">
                In the catalogue
                {typeof t.quantityTotal === 'number' ? (
                  <span className="muted">
                    {' '}
                    · {t.quantitySold}/{t.quantityTotal} sold
                  </span>
                ) : null}
              </span>
            ) : (
              <span key="s" className="muted">
                Hidden — purchasable by direct link only
              </span>
            ),
          ])}
          empty="No ticket types. The catalogue throws rather than falling back to a stale price list — run `npm run seed`."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does that this does not</h2>
        <p className="body-2">
          Hosts the registration page on their own domain with a theme editor: banner image, colours,
          custom sections, a terms checkbox, multiple pages for different audiences. The one that
          would earn its keep for KGC is <strong>separate pages per audience</strong> — attendee,
          exhibitor and sponsor registration are three different conversations, and the nav already
          has three ticket-setup trees to match. Ours has one page with one catalogue on it, filtered
          by the tier&rsquo;s <code>audience</code> field.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No page builder or theming.</strong> Copy and layout are code; this is Phase 5
            in the roadmap, and it is a content-management project rather than a screen.
          </li>
          <li>
            <strong>No preview from this dashboard.</strong> Checking a price change means opening
            the site itself, which runs separately on port 3200 — the two apps share a database and
            nothing else.
          </li>
          <li>
            <strong>No terms-acceptance record.</strong> A checkbox is easy; storing who accepted
            which version of the terms and when is a legal record, and belongs with Release &amp;
            Consent Forms rather than being bolted onto the buy button.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
