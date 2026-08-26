import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary, listExhibitors } from '@/lib/exhibitors';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Message Exhibitors.
 *
 * ── Why this is a note and not the working screen ───────────────────────────
 *
 * Everything needed is present except one line. `src/lib/messaging.ts` already
 * has the sender, the segment resolution, the per-recipient `emailLog` write and
 * the sent history; `MessageScreen` renders all of it and is used by two live
 * screens. Exhibitors already carry `contactEmail`. The single missing piece is
 * that `AudienceId` is `'speakers' | 'sponsors'` — a third value plus a
 * `resolveExhibitors` branch would make this real.
 *
 * That edit belongs to `messaging.ts`, which is shared by the two working
 * screens, and it is not being made from here. So: **roughly a day's work once
 * the audience is added**, and until then this page counts who *would* be
 * reachable rather than pretending a send button exists.
 */
export default async function MessageExhibitorsPage() {
  await requireOrganizer();

  const [rows, summary] = await Promise.all([listExhibitors(), exhibitorSummary()]);

  const live = rows.filter((e) => e.status !== 'cancelled');
  const reachable = live.filter((e) => e.contactEmail);
  const unreachable = live.filter((e) => !e.contactEmail);

  return (
    <>
      <PageHeader
        title="Message Exhibitors"
        tags={<Tag color="orange">not sending</Tag>}
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="s" href={ROUTES.messageSponsors}>
            Message Sponsors
          </Link>,
          <Link key="k" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>This screen cannot send.</strong> There is no compose box below because there is no
        send behind it. The email sender, the templates and the delivery log all exist and are used
        by Message Speakers and Message Sponsors — exhibitors are simply not one of the two
        audiences those screens resolve.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: live.length, sub: `${summary.cancelled} cancelled, excluded` },
          { label: 'Would be reachable', value: reachable.length, sub: 'have a contact email' },
          {
            label: 'Would be missed',
            value: unreachable.length,
            sub: unreachable.length === 0 ? 'everybody has an address' : 'no address on file',
          },
        ]}
      />

      {unreachable.length > 0 && (
        <Banner kind="danger">
          <strong>
            {unreachable.length} exhibitor{unreachable.length === 1 ? '' : 's'} would be silently
            left out of any send.
          </strong>{' '}
          A blast that reaches {reachable.length} of {live.length} companies and reports success is
          the worst outcome available, which is why the messaging screens print this count and why
          it is printed here too.
        </Banner>
      )}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Who would receive it</h2>
        {/*
          One equality filter on eventId with the sort done in memory, as
          everywhere in this app: the emulator does not enforce composite
          indexes, so a where + orderBy passes locally and fails in production
          with failed-precondition. That has shipped twice here.
        */}
        <Table
          cols={[
            { key: 'b', label: 'Booth', className: 'cell-xs' },
            { key: 'n', label: 'Company', className: 'cell-fill' },
            { key: 'c', label: 'Would go to', className: 'cell-md' },
          ]}
          rows={live.map((e) => [
            e.boothNumber ? (
              <strong key="b">{e.boothNumber}</strong>
            ) : (
              <Tag key="b" color="orange" fill="outline" small>
                none
              </Tag>
            ),
            <span key="n">{e.name}</span>,
            e.contactEmail ? (
              <span key="c" style={{ fontSize: 12 }}>
                {e.contactName || e.contactEmail}
                <div className="muted" style={{ fontSize: 11 }}>
                  {e.contactEmail}
                </div>
              </span>
            ) : (
              <Tag key="c" color="red" fill="outline" small>
                no address
              </Tag>
            ),
          ])}
          empty="No exhibitors yet"
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it would take</h2>
        <p className="body-2">
          A third value on <code>AudienceId</code> in <code>src/lib/messaging.ts</code>, a{' '}
          <code>resolveExhibitors</code> branch beside the two that exist, and the segments worth
          having: everyone, no booth assigned, and over their staff-pass allocation — the last being
          the one conversation an organizer genuinely needs to start before doors open. The screen
          itself is then four lines, the same as Message Sponsors.
        </p>
        <p className="body-2">
          <strong>Roughly a day</strong>, and almost all of it is deciding the segments rather than
          writing them.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Sending.</strong> No compose box, no send, no sent history for exhibitors.
          </li>
          <li>
            <strong>Booth-staff mail.</strong> Whova messages the individual people staffing a
            booth. We hold one contact per company and no staff records at all.
          </li>
          <li>
            <strong>Scheduling.</strong> Deliberately absent from the built messaging screens too —
            a queued blast fires whether or not anybody is awake to stop it.
          </li>
        </ul>
      </Panel>
    </>
  );
}
