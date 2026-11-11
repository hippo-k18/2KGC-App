import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { sponsorshipsWithPasses, tiersWithPassCounts } from '@/lib/comp-passes';
import { ROUTES } from '@/lib/nav';
import { AudienceCatalogue } from '../../audience-catalogue';
import { NotInputted, Panel, ProgressBar, Table, Tag } from '../../../ui';
import { PassCountForm } from './pass-forms';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Sponsor Tickets.
 *
 * The same catalogue screen as 2.1 Exhibitor Tickets over a different slice —
 * Whova gives the sponsor flow no step numbers, and neither does the nav tree,
 * so neither does this — plus the one thing a sponsor package has that an
 * attendee ticket does not: complimentary passes.
 *
 * ── The passes used to be a sentence ────────────────────────────────────────
 *
 * A tier's `includes` list said "4 full conference passes" and nothing read it.
 * Buying the sponsorship produced one registration for the buyer, and the four
 * passes existed only as a bullet. The count is a real field on the ticket type
 * now (`complimentaryPasses`) and the panels below are what turns it into
 * people: one seat document per issued pass, keyed so that the fifth pass on a
 * four-pass sponsorship is refused by the database rather than by a check that
 * two simultaneous clicks can both pass.
 *
 * Sponsorship at KGC is still negotiated, invoiced and signed rather than
 * bought from a page, so the catalogue is mostly the price list a sales
 * conversation starts from. What changed is that the passes it promises are now
 * issuable from here whether the money arrived through Stripe or as a wire
 * somebody recorded by hand.
 */
export default async function SponsorTicketsPage() {
  await requireOrganizer();

  const [tiers, sponsorships] = await Promise.all([
    tiersWithPassCounts('sponsor'),
    sponsorshipsWithPasses(),
  ]);

  const outstanding = sponsorships.reduce((n, s) => n + s.remaining, 0);

  return (
    <>
      <AudienceCatalogue
        audience="sponsor"
        title="Sponsor Tickets"
        noun="sponsor"
        info={
          <>
            <strong>Complimentary passes</strong>
            <p>
              Set how many passes each package includes, then name the people who get them. Each
              named pass is a real registration.
            </p>
          </>
        }
        links={[
          <Link key="s" href={ROUTES.sponsorManager}>
            Sponsor Manager
          </Link>,
          <Link key="o" href="/tickets/orders-and-transactions/sponsor-orders">
            Sponsor Orders
          </Link>,
        ]}
        notBuilt={[
          <li key="benefits">
            <strong>The rest of the bundle.</strong> A sponsor tier is logo placement, a booth, a
            session slot and complimentary passes. Only the passes are modelled as an entitlement;
            the booth is allocated by hand on{' '}
            <Link href="/tickets/exhibitor-ticket-setup/2-3-booth-selection">Booth Selection</Link>{' '}
            and the rest are still bullets in <code>includes</code>.
          </li>,
          <li key="invoice">
            <strong>The way sponsorship is really sold.</strong> Negotiated, then invoiced. Stripe
            Invoicing is wired for attendee orders, but there is no sponsor-scoped invoice flow, and{' '}
            <Link href={ROUTES.sponsorManager}>Sponsor Manager</Link> records the sponsor without
            recording what was owed for it.
          </li>,
        ]}
      />

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">Complimentary passes each package includes</h2>
        {tiers.length === 0 ? (
          <NotInputted
            what="sponsor packages"
            compact
            action={
              <Link className="btn btn-primary" href={`${ROUTES.createTickets}?audience=sponsor`}>
                Create one
              </Link>
            }
          />
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              Passes included per package sold.
            </p>
            <PassCountForm tiers={tiers} />
          </>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">
          Passes to be named{outstanding > 0 ? `, ${outstanding} outstanding` : ''}
        </h2>
        {sponsorships.length === 0 ? (
          /**
           * Empty means one of two real things and never a made-up row: no
           * sponsor package declares any passes, or none has been sold yet.
           * Both are answered by the panel above and by Sponsor Orders, which
           * is where the link goes.
           */
          <NotInputted
            what="sponsorships that include passes"
            compact
            action={
              <Link className="btn btn-primary" href="/tickets/orders-and-transactions/sponsor-orders">
                Sponsor Orders
              </Link>
            }
          />
        ) : (
          <Table
            cols={[
              { key: 'sponsor', label: 'Sponsorship', className: 'cell-fill' },
              { key: 'pkg', label: 'Package', className: 'cell-md' },
              { key: 'passes', label: 'Named', className: 'cell-md' },
              { key: 'go', label: '', className: 'cell-sm' },
            ]}
            rows={sponsorships.map((s) => [
              <div key="s">
                <div>{s.companyName || s.buyer}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {s.companyName ? `${s.buyer} · ` : ''}
                  <code>{s.orderId.slice(0, 22)}</code>
                </div>
              </div>,

              <span key="p" style={{ fontSize: 12 }}>
                {s.packages.join(', ')}
                {s.status !== 'paid' ? (
                  <Tag color="grey" small>
                    {s.status}
                  </Tag>
                ) : null}
              </span>,

              <div key="n">
                <div style={{ fontSize: 13 }}>
                  {s.issued} / {s.total}
                </div>
                <ProgressBar pct={s.total > 0 ? Math.min(100, (s.issued / s.total) * 100) : 0} />
              </div>,

              <Link key="g" href={`/tickets/sponsor-ticket-setup/sponsor-tickets/${encodeURIComponent(s.orderId)}`}>
                {s.remaining > 0 ? `Name ${s.remaining} more` : 'Review'}
              </Link>,
            ])}
          />
        )}
      </Panel>
    </>
  );
}
