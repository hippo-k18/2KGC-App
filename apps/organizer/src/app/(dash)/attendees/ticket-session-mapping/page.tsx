import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { capacityIndex, listTicketEntitlements } from '@/lib/cohorts';
import { listTicketTypes } from '@/lib/commerce';
import { listAttendees, listSessions, type SessionRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { seatCounts } from '@/lib/session-seats';
import { joinNames } from '@/lib/session-seats-core';
import { GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';
import { EligibilityForm, RestrictWorkshopsForm } from './eligibility-form';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Ticket Session Mapping.
 *
 * Whova models this as a matrix: every ticket type against every session, each
 * cell independently on or off, with the app enforcing it at the session door.
 *
 * Here a session carries `eligibleTicketTypes`, a list of ticket type names.
 * Empty means every ticket. It is a list on the session rather than a grid on
 * the ticket type because that is where the app and `firestore.rules` read it:
 * taking a seat compares the list with the ticket type on the caller's own
 * registration, in the app's transaction and again in the rules, so a ticket
 * the session is not for is refused even by a hand-built request.
 *
 * `TicketTypeDoc.includesWorkshops` is still the switch on the ticket form. It
 * decides nothing by itself; "Limit all workshops" below copies it onto every
 * workshop session, which is the step that makes it take effect.
 *
 * A restricted session stays visible in the agenda to everybody. What a ticket
 * it is not for cannot do is add it, and the app says why.
 *
 * ── Reads ───────────────────────────────────────────────────────────────────
 *
 * `listTicketTypes()` for the catalogue, `listTicketEntitlements()` for the two
 * booleans `TicketTypeRow` drops, `listSessions()` for the programme and
 * `listAttendees()` for how many people hold each tier. Each is a single
 * `where('eventId', '==', EVENT_ID)` sorted in memory: that filter is served by
 * Firestore's automatic single-field index, while adding an `orderBy` would
 * need a composite index this repo does not declare — and the emulator ignores
 * index configuration, so the query would pass every local run and fail in
 * production with `failed-precondition`.
 */

/** The one split the model can actually make. Everything else is one bucket. */
function isWorkshop(s: SessionRow) {
  return s.format === 'workshop';
}

export default async function TicketSessionMappingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const editingId = typeof sp.session === 'string' ? sp.session : undefined;

  const [tiers, entitlements, sessions, attendees, caps, counts] = await Promise.all([
    listTicketTypes(),
    listTicketEntitlements(),
    listSessions(),
    listAttendees(),
    capacityIndex(),
    seatCounts(),
  ]);
  const allowedFor = (id: string) => caps.sessionTicketTypes.get(id);
  /** Whether a holder of this ticket type may add the session. */
  const mayJoin = (id: string, tierName: string) => !allowedFor(id) || allowedFor(id)!.includes(tierName);

  const grants = new Map(entitlements.map((e) => [e.id, e]));

  // Cancelled sessions are excluded: a tier cannot grant access to something
  // that is not happening, and counting them makes the totals disagree with the
  // agenda.
  const live = sessions.filter((s) => s.status !== 'cancelled');
  const workshops = live.filter(isWorkshop);
  const general = live.filter((s) => !isWorkshop(s));

  // Held by, joined on the tier's display name — the string the importer writes
  // into `RegistrationDoc.ticketType`. Registrations do not carry the ticket
  // type's document id, so a renamed tier stops matching its own holders here.
  const heldBy = (name: string) => attendees.filter((a) => a.ticketType === name).length;

  const rows = tiers.map((t) => {
    const g = grants.get(t.id);
    const workshopAccess = g?.includesWorkshops === true;
    return {
      tier: t,
      workshopAccess,
      videoLibrary: g?.includesVideoLibrary === true,
      inPersonFlag: g?.inPersonFlag,
      // What the app enforces, from the sessions' own lists.
      generalOpen: general.filter((s) => mayJoin(s.id, t.name)).length,
      workshopsOpen: workshops.filter((s) => mayJoin(s.id, t.name)).length,
      sessionsGranted: live.filter((s) => mayJoin(s.id, t.name)).length,
      holders: heldBy(t.name),
    };
  });

  const restricted = live.filter((s) => allowedFor(s.id));
  const openWorkshops = workshops.filter((s) => !allowedFor(s.id));
  const workshopTierNames = joinNames(rows.filter((r) => r.workshopAccess).map((r) => r.tier.name));
  const editing = editingId ? live.find((s) => s.id === editingId) : undefined;
  const sessionOptions = [...live]
    .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal))
    .map((s) => ({
      value: s.id,
      label: `${s.day} ${s.startsAtLocal.slice(11, 16)} · ${s.title}${allowedFor(s.id) ? ' (limited)' : ''}`,
    }));

  const workshopTiers = rows.filter((r) => r.workshopAccess);
  const workshopHolders = workshopTiers.reduce((n, r) => n + r.holders, 0);
  const videoTiers = rows.filter((r) => r.videoLibrary);
  const unmatched = tiers.filter((t) => !grants.has(t.id));

  const byFormat = [...new Set(live.map((s) => s.format))].sort().map((f) => ({
    format: f,
    count: live.filter((s) => s.format === f).length,
    restricted: live.filter((s) => s.format === f && allowedFor(s.id)).length,
  }));

  return (
    <>
      <PageHeader
        title="Ticket Session Mapping"
        info={
          <>
            <strong>Which tickets may add which sessions</strong>
            <p>
              Limit a session to certain ticket types. Anybody else sees it in the agenda and is
              told their ticket does not cover it when they try to add it.
            </p>
          </>
        }
        links={[
          <Link key="t" href={ROUTES.createTickets}>
            Ticket Setup
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="c" href="/attendees/session-cap">
            Session Cap
          </Link>,
        ]}
      />

      <Panel>
        <StatTiles
          tiles={[
            { label: 'Ticket types', value: tiers.length, sub: `${live.length} live sessions` },
            {
              label: 'Limited sessions',
              value: restricted.length,
              sub: `${openWorkshops.length} of ${workshops.length} workshops still open to all`,
            },
            {
              label: 'Tiers including workshops',
              value: workshopTiers.length,
              sub: `${workshopHolders} attendees hold one`,
            },
            {
              label: 'Open to every ticket',
              value: live.length - restricted.length,
              sub: 'no ticket list set',
            },
          ]}
        />

        <Table
          cols={[
            { key: 't', label: 'Ticket type', className: 'cell-mdsm' },
            { key: 'h', label: 'Held by', className: 'cell-xs' },
            { key: 'g', label: `General sessions (${general.length})`, className: 'cell-sm' },
            { key: 'w', label: `Workshops (${workshops.length})`, className: 'cell-sm' },
            { key: 'v', label: 'Video library', className: 'cell-sm' },
            { key: 'n', label: 'Sessions granted', className: 'cell-fill' },
          ]}
          empty="No ticket types yet. Add one in Ticket Setup."
          rows={rows.map((r) => [
            <span key="t">
              <strong>{r.tier.name}</strong>
              {!r.tier.visible ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  hidden from the tickets page
                </div>
              ) : null}
            </span>,
            r.holders > 0 ? (
              String(r.holders)
            ) : (
              <span key="h" className="muted">
                0
              </span>
            ),
            <Tag key="g" color={r.generalOpen === general.length ? 'green' : 'orange'} fill="outline" small>
              {r.generalOpen === general.length ? `all ${general.length}` : `${r.generalOpen} of ${general.length}`}
            </Tag>,
            <span key="w">
              <Tag
                color={r.workshopsOpen === 0 ? 'grey' : r.workshopsOpen === workshops.length ? 'green' : 'orange'}
                fill="outline"
                small
              >
                {r.workshopsOpen === 0
                  ? 'none'
                  : r.workshopsOpen === workshops.length
                    ? `all ${workshops.length}`
                    : `${r.workshopsOpen} of ${workshops.length}`}
              </Tag>
              {r.workshopsOpen > 0 && !r.workshopAccess && workshops.length > 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  ticket does not include workshops
                </div>
              ) : null}
            </span>,
            r.videoLibrary ? (
              <Tag key="v" color="orange" fill="outline" small>
                included, no videos yet
              </Tag>
            ) : (
              <Tag key="v" color="grey" fill="outline" small>
                no
              </Tag>
            ),
            <span key="n">
              <strong>{r.sessionsGranted}</strong> of {live.length}
              {r.inPersonFlag === false && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Marked not in-person on the tickets page.
                </div>
              )}
            </span>,
          ])}
        />

        {unmatched.length > 0 && (
          <p className="body-2">
            {unmatched.length} tier{unmatched.length === 1 ? '' : 's'} could not be read for
            entitlements and {unmatched.length === 1 ? 'is' : 'are'} shown as granting nothing extra.
          </p>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">Limit a session to ticket types</h2>
        <EligibilityForm
          key={editing?.id ?? 'new'}
          sessions={sessionOptions}
          tiers={rows.map((r) => r.tier.name)}
          sessionId={editing?.id}
          allowed={editing ? (allowedFor(editing.id) ?? []) : []}
        />

        <h3 className="section-header" style={{ marginTop: 24 }}>
          Workshops
        </h3>
        <p className="body-2">
          {workshopTierNames
            ? `Ticket types that include workshops: ${workshopTierNames}.`
            : 'No ticket type includes workshops yet.'}{' '}
          {openWorkshops.length > 0
            ? `${openWorkshops.length} of ${workshops.length} workshops can still be added by any ticket.`
            : 'Every workshop is limited by ticket.'}
        </p>
        <RestrictWorkshopsForm count={workshops.length} names={workshopTierNames} />
      </Panel>

      <Panel>
        <h2 className="section-header">Limited sessions</h2>
        <Table
          stackSm
          cols={[
            { key: 't', label: 'Session', className: 'cell-fill' },
            { key: 'a', label: 'Tickets allowed', className: 'cell-md' },
            { key: 'n', label: 'Seats taken', className: 'cell-xs' },
            { key: 'e', label: '', className: 'cell-sm' },
          ]}
          empty="No session is limited by ticket yet."
          rows={restricted.map((s) => [
            <span key="t">
              <strong>{s.title}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {s.format} · {s.day} {s.startsAtLocal.slice(11, 16)}
              </div>
            </span>,
            joinNames(allowedFor(s.id) ?? []),
            String(counts.get(s.id)?.taken ?? 0),
            <span key="e">
              <Link href={`?session=${encodeURIComponent(s.id)}`}>Edit</Link>
              {' · '}
              <Link href={`/attendees/session-cap?session=${encodeURIComponent(s.id)}`}>People</Link>
            </span>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">By session format</h2>
        <Table
          cols={[
            { key: 'f', label: 'Session format', className: 'cell-sm' },
            { key: 'n', label: 'Sessions', className: 'cell-sm' },
            { key: 'w', label: 'Which tiers get in', className: 'cell-fill' },
          ]}
          empty="No sessions in the programme"
          rows={byFormat.map((f) => [
            <strong key="f">{f.format}</strong>,
            String(f.count),
            f.restricted === 0 ? (
              <span key="w">Every ticket</span>
            ) : (
              <span key="w">
                {f.restricted} of {f.count} limited by ticket
              </span>
            ),
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Before you rely on this</h2>
        <p className="body-2" style={{ marginBottom: 0 }}>
          A limit applies from the next person who tries to add the session. People who already
          hold a seat keep it; remove them in Session Cap. Everybody can still read a limited
          session in the agenda. No session recordings are hosted yet
          {videoTiers.length > 0
            ? `, although ${videoTiers.length} ticket type${videoTiers.length === 1 ? '' : 's'} include the video library.`
            : '.'}
        </p>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Hiding a session from tickets it is not for.</strong> Rules filter documents
            and the agenda is one query, so a limited session is visible and locked, not hidden.
            That is also what Whova does.
          </li>
          <li>
            <strong>Limits by track or by day.</strong> The list is per session. A whole track is
            limited one session at a time, or with the workshop button.
          </li>
          <li>
            <strong>A video library to grant.</strong> No recording storage, no player, no{' '}
            <code>materials</code> rules block. Whova hosts and transcodes; the gap note for Video
            Hosting argues for linking out to wherever the recording already lives instead.
          </li>
          <li>
            <strong>Add-ons.</strong> Whova sells session access as a separate product on top of a
            ticket. Every tier here is all-or-nothing on workshops, and <code>OrderDoc.items</code>{' '}
            has lines for it but <code>ticketTypes</code> has no add-on to sell.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
