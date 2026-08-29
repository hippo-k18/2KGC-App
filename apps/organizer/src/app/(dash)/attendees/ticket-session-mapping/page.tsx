import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketEntitlements } from '@/lib/cohorts';
import { listTicketTypes } from '@/lib/commerce';
import { listAttendees, listSessions, type SessionRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Ticket Session Mapping.
 *
 * Whova models this as a matrix: every ticket type against every session, each
 * cell independently on or off, with the app enforcing it at the session door.
 *
 * **We have two booleans.** `TicketTypeDoc` carries `includesWorkshops` and
 * `includesVideoLibrary` and nothing else about access — no per-session list,
 * no per-track list, no per-day list. `SessionDoc.format` has `workshop` as one
 * of its six values. The entire mapping this project can derive is therefore:
 * a tier with `includesWorkshops` gets the workshop-format sessions, and every
 * tier gets everything else. That is what is below. It is an approximation of
 * Whova's matrix collapsed to one bit, and it is labelled as one everywhere it
 * appears rather than dressed up as a grid with two columns filled in.
 *
 * ── Derived, and enforced nowhere ───────────────────────────────────────────
 *
 * The rules do not read either boolean. Sessions are readable by any registered
 * attendee, so an attendee holding a Main Conference ticket can read a workshop
 * session document, see it in the agenda and save it to their schedule. What
 * the booleans do today is decide the bullet list on the tickets page and what
 * the desk is told at the door. Nothing gates a room.
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

export default async function TicketSessionMappingPage() {
  await requireOrganizer();

  const [tiers, entitlements, sessions, attendees] = await Promise.all([
    listTicketTypes(),
    listTicketEntitlements(),
    listSessions(),
    listAttendees(),
  ]);

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
      sessionsGranted: general.length + (workshopAccess ? workshops.length : 0),
      holders: heldBy(t.name),
    };
  });

  const workshopTiers = rows.filter((r) => r.workshopAccess);
  const workshopHolders = workshopTiers.reduce((n, r) => n + r.holders, 0);
  const videoTiers = rows.filter((r) => r.videoLibrary);
  const unmatched = tiers.filter((t) => !grants.has(t.id));

  const byFormat = [...new Set(live.map((s) => s.format))].sort().map((f) => ({
    format: f,
    count: live.filter((s) => s.format === f).length,
    restricted: f === 'workshop',
  }));

  return (
    <>
      <PageHeader
        title="Ticket Session Mapping"
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
        <Banner kind="info">
          <strong>This mapping is derived from two booleans, not authored.</strong> Whova gives you
          a full ticket-by-session matrix with a switch in every cell. The model here has{' '}
          <code>includesWorkshops</code> and <code>includesVideoLibrary</code> on the ticket type,
          and <code>workshop</code> as one value of <code>SessionDoc.format</code> — so the only
          line this data can draw is between the workshops and everything else. There is no cell to
          click, because there is no cell.
        </Banner>

        <StatTiles
          tiles={[
            { label: 'Ticket types', value: tiers.length, sub: `${live.length} live sessions` },
            {
              label: 'Workshop sessions',
              value: workshops.length,
              sub: 'the only sessions any tier restricts',
            },
            {
              label: 'Tiers including workshops',
              value: workshopTiers.length,
              sub: `${workshopHolders} attendees hold one`,
            },
            {
              label: 'Open to every tier',
              value: general.length,
              sub: 'talks, keynotes, panels, posters, socials',
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
          empty="No ticket types exist. ticketTypes is the only source of truth for prices, so run npm run seed."
          rows={rows.map((r) => [
            <span key="t">
              <strong>{r.tier.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                <code>{r.tier.id}</code>
                {!r.tier.visible ? ' · hidden from the catalogue' : ''}
              </div>
            </span>,
            r.holders > 0 ? (
              String(r.holders)
            ) : (
              <span key="h" className="muted">
                0
              </span>
            ),
            // Never a switch, never an editable cell: this is what the data says,
            // and the data does not distinguish between tiers here at all.
            <Tag key="g" color="green" fill="outline" small>
              all {general.length}
            </Tag>,
            r.workshopAccess ? (
              <Tag key="w" color="green" fill="outline" small>
                all {workshops.length}
              </Tag>
            ) : (
              <Tag key="w" color="grey" fill="outline" small>
                none
              </Tag>
            ),
            r.videoLibrary ? (
              <Tag key="v" color="orange" fill="outline" small>
                sold, not modelled
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
                  Marked not in-person on the tickets page — see below, that flag grants nothing.
                </div>
              )}
            </span>,
          ])}
        />

        {unmatched.length > 0 && (
          <p className="body-2">
            {unmatched.length} tier{unmatched.length === 1 ? '' : 's'} could not be read for
            entitlements and {unmatched.length === 1 ? 'is' : 'are'} shown as granting nothing extra.
            An absent boolean is treated as <em>not granted</em> rather than defaulted to true —
            handing out workshop access on the strength of a missing key is the wrong direction to
            fail in.
          </p>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">The same mapping, from the programme&apos;s side</h2>
        <Table
          cols={[
            { key: 'f', label: 'Session format', className: 'cell-sm' },
            { key: 'n', label: 'Sessions', className: 'cell-xs' },
            { key: 'w', label: 'Which tiers get in', className: 'cell-fill' },
          ]}
          empty="No sessions in the programme"
          rows={byFormat.map((f) => [
            <strong key="f">{f.format}</strong>,
            String(f.count),
            f.restricted ? (
              <span key="w">
                {workshopTiers.length > 0 ? (
                  workshopTiers.map((r) => r.tier.name).join(', ')
                ) : (
                  <span className="muted">no tier includes workshops</span>
                )}
                <div className="muted" style={{ fontSize: 12 }}>
                  Because <code>includesWorkshops</code> is true on{' '}
                  {workshopTiers.length === 1 ? 'that tier' : 'those tiers'}, not because anything
                  was mapped session by session.
                </div>
              </span>
            ) : (
              <span key="w">
                Every tier
                <div className="muted" style={{ fontSize: 12 }}>
                  The model has no field that would exclude one, so this is what the data says
                  rather than a decision anybody made.
                </div>
              </span>
            ),
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Three things this mapping does not mean</h2>
        <p className="body-2">
          <strong>Nothing enforces it.</strong> <code>firestore.rules</code> reads neither boolean.
          Sessions are readable by any registered attendee, so somebody holding a tier without
          workshops can still open a workshop in the agenda, read its description and add it to
          their schedule. The booleans decide what the tickets page lists and what the desk is told;
          no door is locked by them, here or in the app.
        </p>
        <p className="body-2">
          <strong>The video library exists on the ticket and nowhere else.</strong>{' '}
          {videoTiers.length} tier{videoTiers.length === 1 ? '' : 's'} sell it, and there is no video
          in this data model to grant: <code>SessionDoc</code> has <code>slidesUrl</code> and no
          recording field, <code>SessionMaterialDoc</code> has a <code>video</code> kind that nothing
          writes, the <code>materials</code> subcollection has no block in <code>firestore.rules</code>{' '}
          at all, and Video Hosting is an honest gap note rather than a screen. The marketing site
          promises recordings of every session. That promise currently has no storage behind it, and
          this row says &ldquo;sold, not modelled&rdquo; rather than a green tick for that reason.
        </p>
        <p className="body-2">
          <strong>In-person is not an entitlement.</strong> <code>TicketTypeDoc.inPerson</code> looks
          like it should split virtual attendees from the room, and it does not:{' '}
          <code>TicketTypeRow</code> reads it as <code>t.inPerson ?? true</code>, it is a checkbox on
          the ticket form that drives a catalogue card, and the seeded <code>virtual</code> tier has
          no such field — so defaulting it would report a virtual ticket as granting in-person
          access. This screen shows the flag where it is explicitly set and derives no access from
          it.
        </p>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>The matrix.</strong> A per-session or per-track grant list on the ticket type,
            plus a UI to edit it. That is a <code>models.ts</code> change, a rules review — the app would have
            to stop showing every attendee every session — and a decision about what an attendee
            sees for a session they cannot attend: hidden entirely, or visible and locked. Whova
            shows it locked, which is the better answer and the more expensive one.
          </li>
          <li>
            <strong>Enforcement anywhere.</strong> Even with a matrix, rules filter documents and
            the agenda is one query; per-ticket session visibility means either a projection per
            tier or an entitlement check the client cannot be trusted to make.{' '}
            <code>users/&#123;uid&#125;/entitlements</code> is modelled and nothing writes it.
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
          <li>
            <strong>Editing either boolean, anywhere.</strong> The ticket form in{' '}
            <Link href={ROUTES.createTickets}>Ticket Setup</Link> has no control for them, and its
            server action carries the existing value forward and writes{' '}
            <code>false</code> for a new tier — so a tier created from this dashboard can never
            include workshops. Both booleans currently arrive from <code>npm run seed</code> and
            from nowhere else. The control belongs on that form, beside the price it justifies,
            rather than here: a second place to change them is a second place for them to disagree.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
