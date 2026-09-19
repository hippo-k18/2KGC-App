import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { allocationFor } from '@/lib/comp-passes';
import { ROUTES } from '@/lib/nav';
import { Banner, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../../ui';
import { IssuePassForm, RenamePassForm } from '../pass-forms';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Sponsor Tickets › one sponsorship&rsquo;s passes.
 *
 * ── Why the seats are their own screen ──────────────────────────────────────
 *
 * A sponsorship is bought once and the people arrive later — often much later,
 * and usually not decided at purchase. So the catalogue lists which
 * sponsorships owe passes and this screen is where one of them is filled in,
 * one attendee at a time, over however many weeks that takes.
 *
 * ── The number on this page is derived, always ──────────────────────────────
 *
 * &ldquo;3 of 4 issued&rdquo; is the tier&rsquo;s count minus the seat documents that
 * exist. Nothing decrements a remaining-passes field, because a field like that
 * is exactly what lets two organizers clicking at once both spend the last
 * pass — see the allocation in `@kgc/scripts/src/lib/comp-passes.ts`.
 */
export default async function SponsorPassSeatsPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireOrganizer();

  const { orderId } = await params;
  const allocation = await allocationFor(decodeURIComponent(orderId));
  if (!allocation) notFound();

  const sponsor = allocation.companyName || allocation.buyerName || allocation.buyerEmail;
  const overIssued = Math.max(0, allocation.issued.length - allocation.total);

  return (
    <>
      <PageHeader
        title={`Complimentary passes · ${sponsor}`}
        info={
          <>
            <strong>Each pass is a real registration</strong>
            <p>
              Naming a seat issues the same ticket a purchase does, with a badge QR and a claim
              code. The email address cannot be changed afterwards.
            </p>
          </>
        }
        tags={
          <Tag color={allocation.remaining > 0 ? 'blue' : 'green'}>
            {allocation.issued.length} of {allocation.total} issued
          </Tag>
        }
        links={[
          <Link key="c" href="/tickets/sponsor-ticket-setup/sponsor-tickets">
            Sponsor Tickets
          </Link>,
          <Link key="o" href={`${ROUTES.attendeeOrders}?order=${encodeURIComponent(allocation.orderId)}`}>
            The order
          </Link>,
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
        ]}
      />

      {allocation.orderStatus !== 'paid' && (
        <Banner kind="warning">
          <strong>This sponsorship is {allocation.orderStatus}.</strong> Passes issued against it
          are live tickets that admit their holders regardless. Settle or withdraw the order before
          naming anybody.
        </Banner>
      )}

      {overIssued > 0 && (
        <Banner kind="danger">
          <strong>
            {allocation.issued.length} passes are issued against an allocation of{' '}
            {allocation.total}.
          </strong>{' '}
          The package&rsquo;s pass count was lowered after these were named. Nobody has been
          withdrawn (every one of them holds a working ticket) so either raise the count back or
          cancel the extra registrations from the order.
        </Banner>
      )}

      <StatTiles
        tiles={[
          {
            label: 'Included',
            value: allocation.total,
            sub: allocation.sources.map((s) => `${s.ticketTypeName} × ${s.quantity}`).join(', '),
          },
          { label: 'Named', value: allocation.issued.length, sub: 'tickets issued' },
          {
            label: 'Remaining',
            value: allocation.remaining,
            sub: allocation.remaining === 0 ? 'fully allocated' : 'still to name',
          },
        ]}
      />

      <Panel>
        <h2 className="section-header">Name an attendee</h2>
        <IssuePassForm orderId={allocation.orderId} remaining={allocation.remaining} />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header">Passes issued</h2>
        <Table
          cols={[
            { key: 'seat', label: 'Seat', className: 'cell-xs' },
            { key: 'who', label: 'Attendee', className: 'cell-fill' },
            { key: 'pkg', label: 'From', className: 'cell-md' },
            { key: 'reg', label: 'Registration', className: 'cell-md' },
          ]}
          rows={allocation.issued.map((p) => [
            <span key="s">
              {p.seat}
              {p.seat > allocation.total ? (
                <Tag color="red" small>
                  over
                </Tag>
              ) : null}
            </span>,

            <div key="w">
              <RenamePassForm orderId={allocation.orderId} seat={p.seat} name={p.name} />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {p.email}
                {p.issuedAt ? ` · named ${p.issuedAt.slice(0, 10)} by ${p.issuedBy}` : null}
              </div>
            </div>,

            <span key="p" style={{ fontSize: 12 }}>
              {p.ticketTypeName || <em className="muted">—</em>}
            </span>,

            p.registrationId ? (
              <code key="r" style={{ fontSize: 11 }}>
                {p.registrationId.slice(0, 16)}
              </code>
            ) : (
              /**
               * The seat was claimed and the registration never written — only
               * possible if the process died between the two. It is shown
               * rather than hidden because the sponsor is a pass down and
               * nobody has a ticket for it.
               */
              <Tag key="r" color="red" small>
                no registration
              </Tag>
            ),
          ])}
          empty={<NotInputted what="named attendees" compact />}
        />
      </Panel>
    </>
  );
}
