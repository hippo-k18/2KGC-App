import Link from 'next/link';
import { andList, watchAudienceLines } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { clockOf, dayLabel } from '@/lib/time';
import {
  listWatchOverview,
  watchPromiseTicketNames,
  type WatchOverviewRow,
} from '@/lib/streaming';
import { EmptyState, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Online Session Manager › Streaming Setup.
 *
 * Whova's version is a per-session table: pick a streaming method, paste a
 * link, choose whether the recording is kept. This is that table, reading the
 * two `sessions/{id}/watch` documents per session.
 *
 * Editing happens on the session itself, on Content › Agenda Center › Session
 * Manager, because a stream belongs to a session the way a room does and the
 * person who has the link is the person editing the talk. What this screen is
 * for is the question an organizer asks the week before: which of seventy-two
 * sessions still has nothing set up. So it sorts the gaps to the top by
 * default and counts them in the tiles.
 *
 * ⚠️ This screen said "streaming is not available yet" until 2026-09-23, and
 * the gap panel under it listed what was missing. Both are gone because the
 * fields are here now. What is still true, and is said on the page rather than
 * hidden here, is that nothing *produces* a feed: a camera, an operator per
 * room and an ingest provider are decisions with a cost, and this dashboard
 * only carries the link once somebody has one.
 */
export default async function StreamingSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const show = typeof sp.show === 'string' ? sp.show : 'all';

  const [all, promised] = await Promise.all([listWatchOverview(), watchPromiseTicketNames()]);
  const promisedAny = [...promised.stream, ...promised.recording];
  const rows = all.filter((r) => {
    if (show === 'missing') return !r.stream && !r.recording;
    if (show === 'live') return r.stream?.state === 'live';
    if (show === 'recorded') return Boolean(r.recording);
    return true;
  });

  const withStream = all.filter((r) => r.stream).length;
  const live = all.filter((r) => r.stream?.state === 'live').length;
  const withRecording = all.filter((r) => r.recording).length;
  const restricted = all.filter(
    (r) =>
      (r.stream?.allowedTicketTypes.length ?? 0) > 0 ||
      (r.recording?.allowedTicketTypes.length ?? 0) > 0,
  ).length;

  return (
    <>
      <PageHeader
        title="Streaming Setup"
        links={[
          <Link key="s" href="/virtual-and-hybrid/virtual-and-hybrid-setup">
            Virtual &amp; Hybrid Setup
          </Link>,
          <Link key="m" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="r" href="/virtual-and-hybrid/online-session-manager/rehearsal-sessions">
            Rehearsal Sessions
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Sessions', value: all.length },
          { label: 'With a stream', value: withStream, sub: live ? `${live} on now` : undefined },
          { label: 'With a recording', value: withRecording },
          {
            label: 'Ticket restricted',
            value: restricted,
            sub: restricted ? 'not everybody can watch' : undefined,
          },
        ]}
      />

      <Panel>
        <div className="filter-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {[
            { key: 'all', label: `Every session (${all.length})` },
            {
              key: 'missing',
              label: `Nothing set up (${all.filter((r) => !r.stream && !r.recording).length})`,
            },
            { key: 'live', label: `On now (${live})` },
            { key: 'recorded', label: `Has a recording (${withRecording})` },
          ].map((f) => (
            <Link
              key={f.key}
              href={f.key === 'all' ? ROUTES.streamingSetup : `${ROUTES.streamingSetup}?show=${f.key}`}
              className={`whova-btn-main small${show === f.key ? '' : ' secondary'}`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <Table
          cols={[
            /*
              Three narrow columns and one medium one. The width classes are
              absolute pixels, so a table whose fixed columns sum past the frame
              starves `cell-fill` down to nothing — a Title column one character
              wide, which reads as a rendering bug. Four `cell-md` did exactly
              that here at 1280.
            */
            { key: 'session', label: 'Session', className: 'cell-fill' },
            { key: 'when', label: 'Starts', className: 'cell-sm' },
            { key: 'stream', label: 'Stream', className: 'cell-sm' },
            { key: 'recording', label: 'Recording', className: 'cell-sm' },
            { key: 'who', label: 'Who can watch', className: 'cell-md' },
          ]}
          rows={rows.map((r) => [
            <Link key="t" href={`${ROUTES.sessionManager}/${r.id}`}>
              {r.title}
            </Link>,
            <span key="w" className="muted">
              {/*
                "Mon, May 3 · 08:30", the way every other date in the dashboard
                is written. It read `2027-05-03T08:30` with the T swapped for a
                space, which is a stored value shown raw.
              */}
              {`${dayLabel(r.startsAtLocal.slice(0, 10))} · ${clockOf(r.startsAtLocal)}`}
            </span>,
            <StreamCell key="s" row={r} />,
            <RecordingCell key="r" row={r} />,
            <AudienceCell key="a" row={r} />,
          ])}
          empty={
            <EmptyState>
              <p className="empty-title">Nothing to show</p>
              <p className="empty-sub">No session matches this filter.</p>
            </EmptyState>
          }
        />
      </Panel>

      {/*
        Named here as well as on the two forms. This is the screen an organizer
        reads across all seventy-two sessions, so it is where "why does that row
        list a tier I never ticked" gets asked.
      */}
      {promisedAny.length > 0 && (
        <Panel>
          <h2 className="section-header">Tickets that always get in</h2>
          <p className="body-2">
            {promised.stream.length > 0
              ? `${andList(promised.stream)} ${promised.stream.length === 1 ? 'is' : 'are'} sold live streams, so ${promised.stream.length === 1 ? 'it stays' : 'they stay'} on every stream you restrict.`
              : 'No ticket is sold a live stream, so any stream can be restricted freely.'}
          </p>
          <p className="body-2">
            {promised.recording.length > 0
              ? `${andList(promised.recording)} ${promised.recording.length === 1 ? 'is' : 'are'} sold recordings, so ${promised.recording.length === 1 ? 'it stays' : 'they stay'} on every recording you restrict.`
              : 'No ticket is sold recordings, so any recording can be restricted freely.'}
          </p>
          <p className="body-2">
            This comes from what each ticket says it includes on the tickets page. Change the ticket
            and this changes with it.
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="section-header">Before the event</h2>
        <p className="body-2">
          A link here is only half of it. Each room that goes out live needs a camera, sound and
          somebody watching it, and the video has to be hosted somewhere. Add the link once you
          have it and the session starts showing as streaming.
        </p>
        <p className="body-2">
          Zoom links open outside the app. YouTube and Vimeo play inside it.
        </p>
      </Panel>
    </>
  );
}

function StreamCell({ row }: { row: WatchOverviewRow }) {
  if (!row.stream) return <span className="muted">Not set up</span>;
  const { state, providerLabel: label } = row.stream;
  return (
    <span>
      <Tag color={state === 'live' ? 'green' : state === 'scheduled' ? 'orange' : 'grey'} small>
        {state === 'live' ? 'on now' : state === 'scheduled' ? 'later' : 'finished'}
      </Tag>{' '}
      <span className="muted">{label}</span>
    </span>
  );
}

function RecordingCell({ row }: { row: WatchOverviewRow }) {
  // "Not set up", the same words the Stream column uses. Two columns beside
  // each other saying "Not set up" and "None" about the same absence reads as
  // two different states.
  if (!row.recording) return <span className="muted">Not set up</span>;
  const { window: win, duration } = row.recording;
  return (
    <span>
      <Tag color={win === 'available' ? 'green' : win === 'not-yet' ? 'orange' : 'red'} small>
        {win === 'available' ? 'up' : win === 'not-yet' ? 'not yet' : 'closed'}
      </Tag>{' '}
      <span className="muted">{duration || 'length not given'}</span>
    </span>
  );
}

/**
 * Who may watch, read off both documents.
 *
 * Named tiers rather than a count, because "restricted" without the names is a
 * warning an organizer cannot act on — and the mistake this is watching for is
 * a tier that was renamed on Tickets and left behind here, which hides the
 * video from everybody and looks exactly like one that works.
 *
 * ⚠️ One line per thing there is to watch, never a merged list. This column
 * used to union the stream's restriction with the recording's, so a keynote
 * streaming openly with a gated recording read as though the live stream were
 * gated to four tiers. `watchAudienceLines` keeps them apart and collapses
 * them only when they genuinely agree.
 */
function AudienceCell({ row }: { row: WatchOverviewRow }) {
  if (!row.stream && !row.recording) return <span className="muted">—</span>;
  const lines = watchAudienceLines({ stream: row.stream, recording: row.recording });
  return (
    <span>
      {lines.map((l) => (
        <span key={l.label} style={{ display: 'block' }}>
          {l.label ? <span className="muted">{l.label}: </span> : null}
          {l.who}
        </span>
      ))}
    </span>
  );
}
