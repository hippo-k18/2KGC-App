import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes, money, salesSummary } from '@/lib/commerce';
import { listWatchOverview } from '@/lib/streaming';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Tag } from '../../ui';

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
 * conference and workshop session", and for a year nothing in this repo could
 * hold a stream at all. That was not a missing feature; it was a paid ticket
 * promising a thing that did not exist, and it was worth a number on a screen
 * rather than a line in a backlog.
 *
 * ⚠️ **Half of that is fixed as of 2026-09-23.** Sessions carry a stream and a
 * recording, gated by ticket type, set up on Session Manager and listed on
 * Streaming Setup. So the number this page reports changed: it is no longer
 * "streaming does not exist", it is how many sessions actually have something
 * against how many remote tickets have been sold. What is still not software
 * is the production — a camera, sound and an operator per room.
 *
 * So this page reads the tiers out of `ticketTypes`, the sales out of `orders`
 * and the setup out of the two `watch` documents per session, and puts the
 * three side by side. That is its whole job: it is an entitlement report, not
 * an essay about streaming.
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
  const [tiers, sales, watch] = await Promise.all([
    listTicketTypes(),
    salesSummary(),
    listWatchOverview(),
  ]);

  const setUp = watch.filter((r) => r.stream || r.recording).length;

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
            <strong>Remote ticket report</strong>
            <p>
              This page lists the remote ticket tiers, what they include and how many have been
              sold, beside how many sessions have a stream or a recording set up.
            </p>
          </>
        }
        tags={
          remoteSold > 0 && setUp === 0 ? (
            <Tag color="red" fill="solid">
              Nothing set up to watch
            </Tag>
          ) : undefined
        }
        links={[
          <Link key="t" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
          <Link key="ss" href={ROUTES.streamingSetup}>
            Streaming Setup
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
      {remoteSold > 0 && setUp === 0 && (
        <Banner kind="danger">
          <strong>
            {remoteSold} remote {remoteSold === 1 ? 'ticket has' : 'tickets have'} been sold and no
            session has a stream or a recording.
          </strong>{' '}
          These buyers have nothing to watch yet. Add a link on{' '}
          <Link href={ROUTES.streamingSetup}>Streaming Setup</Link>, or hide the tier in{' '}
          <Link href={ROUTES.createTickets}>Create Tickets</Link>.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Remote tiers on sale', value: remote.filter((t) => t.visible).length, sub: `${remote.length} defined` },
          { label: 'Remote tickets sold', value: remoteSold, sub: 'settled orders' },
          { label: 'Revenue', value: money(remoteNet, sales.currency), sub: 'net of refunds' },
          {
            label: 'Sessions to watch',
            value: setUp,
            sub: `of ${watch.length} on the agenda`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What each tier includes</h2>
        {remote.length === 0 ? (
          <NotInputted what="remote ticket tiers" />
        ) : (
          remote.map((t) => (
            <div key={t.id} style={{ marginBottom: 18 }}>
              <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <strong>{t.name}</strong>
                <span className="muted">{money(t.priceCents, t.currency)}</span>
                <Tag color={t.visible ? 'green' : 'grey'}>{t.visible ? 'on sale' : 'hidden'}</Tag>
              </div>
              {t.includes.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  This tier lists no inclusions.
                </p>
              ) : (
                <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
                  {t.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
        {/*
          The video-library flag is worth naming separately: the Virtual tier
          promises on-demand replays in its copy while `includesVideoLibrary`
          is false on the document. So even the *entitlement* disagrees with the
          sales page, independently of whether anything serves video.
        */}
        {remote.some((t) => !t.includesVideoLibrary) && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Video library access is turned off for at least one remote tier. If the tier lists
            replays, check{' '}
            <Link href="/content/documents-and-videos/attendee-video-access">
              Attendee Video Access
            </Link>
            .
          </p>
        )}
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
            <strong>Nothing produces a feed.</strong> Per-session stream and recording links are
            built and gated by ticket type; a camera, sound and an operator per room are not
            software and are not here.
          </li>
          <li>
            <strong>A virtual-attendee experience.</strong> The app is built for someone in the
            building — the badge QR, check-in, the room names. A remote attendee opening it today
            gets an agenda, a community board and whatever links have been added.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
