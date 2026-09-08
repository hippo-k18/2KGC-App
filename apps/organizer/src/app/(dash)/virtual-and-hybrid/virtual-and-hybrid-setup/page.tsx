import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money, salesSummary } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Virtual & Hybrid Setup.
 *
 * ── This screen exists to report a promise nothing keeps ────────────────────
 *
 * `ROADMAP.md` lists all fifteen Virtual & Hybrid screens as a candidate to
 * cut, not to build: streaming infrastructure for an in-person conference at
 * Cornell Tech whose value is being in the room. That argument is sound and it
 * is repeated across this cluster.
 *
 * It does not cover the one thing that actually matters here. KGC sells a
 * `virtual` ticket at $349 whose bullet list opens with "Live streams of every
 * conference and workshop session", and there is no streaming anywhere in this
 * repo — no player in the app, no stream field on `SessionDoc`, no provider
 * account. That is not a missing feature; it is a paid ticket promising a
 * thing that does not exist, and it is worth a number on a screen rather than
 * a line in a backlog.
 *
 * So this page reads the tier out of `ticketTypes` and the sales out of
 * `orders`, and puts the two side by side. That is its whole job: it is an
 * entitlement report, not an essay about streaming.
 *
 * ── The three options, kept here rather than on screen ──────────────────────
 *
 * They are a decision for the owner, not a thing an organizer reads on the way
 * to a number, so they live in this comment.
 *
 * **Stop selling it.** Set `visible: false` on the tier in Create Tickets and
 * refund the ones already sold. Cheapest, and the only option that is true
 * today.
 *
 * **Sell recordings instead of streams.** Rewrite the tier as post-event
 * access, which is a video-hosting bill rather than a live-production
 * commitment — one provider, one link per session, no rehearsals, no run of
 * show.
 *
 * **Actually stream.** A provider account, a stream key per room, an AV
 * operator per room for five days, a player in the app behind the entitlement,
 * and a rehearsal process. That is a different product with a different cost
 * base, and choosing it because a ticket tier already mentions it is the wrong
 * order to make the decision in.
 */
export default async function VirtualAndHybridSetupPage() {
  await requireOrganizer();
  const [tiers, sales] = await Promise.all([listTicketTypes(), salesSummary()]);

  // `inPerson: false` is the entitlement field, not the marketing copy — the
  // same field `attendees/ticket-session-mapping` refuses to guess at.
  const remote = tiers.filter((t) => !t.inPerson);
  // `byTier` is keyed by ticket *name*, because an order line stores the name
  // it was sold under. Matching on the tier id here would silently find
  // nothing and report zero sales, which is the wrong direction to be wrong in.
  const soldRow = (name: string) => sales.byTier.find((b) => b.name === name);

  const remoteSold = remote.reduce((n, t) => n + (soldRow(t.name)?.sold ?? 0), 0);
  const remoteNet = remote.reduce((n, t) => n + (soldRow(t.name)?.netCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Virtual & Hybrid Setup"
        info={
          <>
            <strong>An entitlement report, not a setup wizard</strong>
            <p>
              This project runs one event format, in person. There is no switch between virtual,
              hybrid and in-person to flip, and no per-session stream configuration. What this
              screen does is compare what remote tiers were sold as against what exists.
            </p>
          </>
        }
        tags={
          remoteSold > 0 ? (
            <Tag color="red" fill="solid">
              Sold, not delivered
            </Tag>
          ) : undefined
        }
        links={[
          <Link key="t" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="v" href="/content/documents-and-videos/video-hosting">
            Video Hosting
          </Link>,
          <Link key="m" href="/attendees/ticket-session-mapping">
            Ticket Session Mapping
          </Link>,
        ]}
      />

      {/*
        The one Banner in this cluster that stays a Banner. It is not a caveat
        about the software's scope — money has changed hands against a promise
        nothing keeps, and every day it stays on sale adds a refund
        conversation. It changes what the organizer does in the next minute.
      */}
      {remoteSold > 0 && (
        <Banner kind="danger">
          <strong>
            {remoteSold} remote {remoteSold === 1 ? 'ticket has' : 'tickets have'} been sold against
            a promise nothing delivers.
          </strong>{' '}
          The remote tiers below are on sale on the public site and nothing in this project streams:
          no player in the app, no stream URL on a session, no provider account. Every one of them is
          a refund conversation waiting to happen.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Remote tiers on sale', value: remote.filter((t) => t.visible).length, sub: `${remote.length} defined` },
          { label: 'Remote tickets sold', value: remoteSold, sub: 'settled orders' },
          { label: 'Money taken for them', value: money(remoteNet, sales.currency), sub: 'net of refunds' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What the buyer was told</h2>
        {remote.length === 0 ? (
          <NotInputted what="remote ticket tiers" />
        ) : (
          remote.map((t) => (
            <div key={t.id} style={{ marginBottom: 18 }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 6 }}>
                <strong>{t.name}</strong>
                <span className="muted">{money(t.priceCents, t.currency)}</span>
                <Tag color={t.visible ? 'green' : 'grey'}>{t.visible ? 'on sale' : 'hidden'}</Tag>
              </div>
              <Table
                cols={[
                  { key: 'c', label: 'Sold as', className: 'cell-fill' },
                  { key: 's', label: 'Delivered by', className: 'cell-md' },
                ]}
                rows={t.includes.map((line) => [
                  line,
                  <span key="s" className="muted">
                    nothing
                  </span>,
                ])}
                empty="This tier lists no inclusions."
              />
            </div>
          ))
        )}
        {/*
          The video-library flag is worth naming separately: the Virtual tier
          promises on-demand replays in its copy while `includesVideoLibrary`
          is false on the document. So even the *entitlement* disagrees with the
          sales page, independently of whether anything serves video.
        */}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          ⚠️ Note the Virtual tier promises &ldquo;on-demand replays&rdquo; in prose while its{' '}
          <code>includesVideoLibrary</code> entitlement is <code>false</code>. Those two disagree
          with each other before any player exists. See{' '}
          <Link href="/content/documents-and-videos/attendee-video-access">
            Attendee Video Access
          </Link>
          .
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Choosing a virtual, hybrid or in-person format.</strong> Whova&rsquo;s setup
            wizard flips the whole event between three modes and hides features accordingly. This
            project has one mode, in person, and no switch to flip.
          </li>
          <li>
            <strong>Per-session stream configuration.</strong> <code>SessionDoc</code> has no
            stream field at all, so there is nowhere to put a URL even as a placeholder. Adding one
            is easy; the thing it points at is not.
          </li>
          <li>
            <strong>A virtual-attendee experience.</strong> The app is built for someone in the
            building — the badge QR, check-in, the room names. A remote attendee opening it today
            gets an agenda and a community board and nothing to watch.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
