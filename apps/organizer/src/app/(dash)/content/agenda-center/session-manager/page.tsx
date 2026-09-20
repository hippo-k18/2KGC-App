import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import {
  listSessions,
  listSpeakerCards,
  listTrackOptions,
  type SessionRow,
  type SpeakerCard,
} from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { clockOf, todayInEventZone } from '@/lib/time';
import {
  Banner,
  DetailList,
  GapPanel,
  NotInputted,
  PageHeader,
  Panel,
  Portrait,
  StatusTag,
  Tag,
} from '../../../ui';
import { DetailDisclosure } from '../../../form';
import { CsvImportPanel } from '../../csv-import-panel';
import { commitSessionImportAction, previewSessionImportAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Content > Agenda Center > Session Manager.
 *
 * Whova's agenda is deliberately *not* a table and not a calendar grid. It is a
 * vertical stack of hour buckets — one white card per clock hour, with the hour
 * label at top-left and an "Add session" control at top-right — and sessions
 * live inside the bucket their start time falls in. Each session is a dark
 * charcoal header strip (drag handle, underlined title, type pill, and the
 * Edit / Duplicate / Swap / More actions in white text) over a white body
 * carrying the time and the speakers.
 *
 * That shape is unusual enough that it is worth saying why it is copied rather
 * than replaced with a table: it is the layout an organizer scans to answer
 * "what is happening at 2pm and is there a hole", which is the actual question,
 * and a sortable table answers it worse. The overnight hours collapse into a
 * single `12:00 AM – 7:00 AM` bucket for the same reason.
 *
 * The day tabs are two-line (weekday over `Mmm D`), which is Whova's, and the
 * day is a query parameter so a link to "Tuesday" is shareable — Whova keeps it
 * in component state and loses it on reload, which is one of the specific
 * complaints in the research.
 *
 * Creating and editing a session is real: the hour bucket's "Add session" link
 * carries its own hour into the form, and the editor writes twelve `SessionDoc`
 * fields directly, three denormalised caches beside the ids they mirror, and the
 * six derived time fields — with `qaEnabled` / `pollsEnabled` owned by Session
 * Q&A Manager. Four fields still have no writer, and three of them have no
 * *reader* either (`tags`, `slidesUrl`, `seriesId`); the fourth is `deletedAt`,
 * which is deliberate — retiring a session is `status: 'cancelled'`.
 *
 * Clicking a session title opens the detail modal rather than the editor, which
 * is Whova's behaviour and was the one thing missing: the title and the `Edit`
 * link beside it both went to the same form, so there was no way to *read* a
 * session — abstract, speakers, faces and all — without entering a screen whose
 * every control writes. Whova's ordering is title, time, room, tracks,
 * description, speakers, and it is followed below.
 *
 * Not built here, and it is the expensive half: the multi-sheet Excel
 * round-trip *in*, bulk edit, block move and swap, and the drag-drop calendar.
 * A programme is authored in a spreadsheet by a committee anyway, which is why
 * that whole family is traded for one good importer.
 */

function prettyDayTab(day: string): { weekday: string; date: string } {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
    date: dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }),
  };
}

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${ampm}`;
}

function twelveHour(wall: string): string {
  const [hh, mm] = clockOf(wall).split(':').map(Number);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** `2027-05-04` → `Tuesday, May 4, 2027`, in the event's zone and not the server's. */
function prettyDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const CHARCOAL = '#3f3f3f';

/**
 * One speaker inside the session detail: face, name, job title, affiliation.
 *
 * ── There is no bio line, and that is measured rather than forgotten ────────
 *
 * `SpeakerCard.bio` is rendered only when there is one, and on the live project
 * there never is: those 137 speakers were imported from the 2026 Whova export
 * by `scripts/src/import-speakers-2026.ts`, and `speakers-2026.ts` has no bio
 * field to import. ⚠️ The seeded emulator disagrees — `fixtures.ts` writes a
 * bio for every speaker — so this block renders locally and is empty in front
 * of the client, which is the direction that matters.
 *
 * A "Bio coming soon" placeholder is therefore out: it would be the dashboard
 * claiming something that exists nowhere, the defect class AGENTS.md counts
 * fourteen instances of. A "no bio on file" line under every speaker would be
 * noise on a screen about a session. The absence is worth surfacing where it
 * can be acted on, so Speaker Manager states it per speaker and keeps its "No
 * bio" filter; here the block is simply not drawn.
 */
function SpeakerLine({ p }: { p: SpeakerCard }) {
  const affiliation = [p.title, p.company].filter(Boolean).join(', ');
  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0' }}>
      <Portrait src={p.photoURL} name={p.name} size={48} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        {affiliation ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {affiliation}
          </div>
        ) : null}
        {p.bio ? <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>{p.bio}</p> : null}
      </div>
    </div>
  );
}

/**
 * The whole session record, read-only.
 *
 * Rendered on the server and handed to `DetailDisclosure` as `children`, which
 * is what lets it use `Tag`, `StatusTag`, `DetailList` and `Portrait` — see
 * that component's header for why a client component may not import them.
 */
function SessionDetail({
  s,
  trackNames,
  speakers,
}: {
  s: SessionRow;
  trackNames: string[];
  speakers: SpeakerCard[];
}) {
  return (
    <>
      <DetailList
        items={[
          {
            label: 'Time',
            value: (
              <>
                {prettyDay(s.day)}
                <br />
                {twelveHour(s.startsAtLocal)} – {twelveHour(s.endsAtLocal)}{' '}
                <span className="muted">{s.timeZone}</span>
              </>
            ),
          },
          {
            label: 'Room',
            value: s.roomName ?? <span className="muted">Not set</span>,
          },
          {
            label: 'Track',
            value: trackNames.length ? (
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                {trackNames.map((t) => (
                  <Tag key={t} color={t === s.primaryTrackName ? 'blue' : 'grey'}>
                    {t}
                  </Tag>
                ))}
              </span>
            ) : (
              <span className="muted">Not set</span>
            ),
          },
          { label: 'Format', value: <span style={{ textTransform: 'capitalize' }}>{s.format}</span> },
          {
            label: 'Skill level',
            value: s.skillLevel ? (
              <span style={{ textTransform: 'capitalize' }}>{s.skillLevel}</span>
            ) : (
              <span className="muted">Not set</span>
            ),
          },
          { label: 'Status', value: <StatusTag status={s.status} /> },
        ]}
      />

      <h3 className="section-header">Description</h3>
      {s.description ? (
        <p style={{ lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{s.description}</p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No description yet. Attendees see only the title and the time.
        </p>
      )}

      <h3 className="section-header">
        Speakers {speakers.length ? <span className="muted">({speakers.length})</span> : null}
      </h3>
      {speakers.length ? (
        speakers.map((p) => <SpeakerLine key={p.id} p={p} />)
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Nobody is assigned to this session.
        </p>
      )}

      {/*
        `speakerNames` is a denormalised cache of the same list, and the agenda
        card above renders *that* rather than the speakers resolved here. When
        the two disagree the cache is the stale one, and saying so is the point:
        the agenda in every attendee's phone shows the cache.
      */}
      {speakers.length !== s.speakerIds.length ? (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          {s.speakerIds.length - speakers.length} of the {s.speakerIds.length} speakers on this
          session could not be found. Edit the session to fix the list.
        </p>
      ) : null}
    </>
  );
}

function SessionCard({
  s,
  trackNames,
  speakers,
}: {
  s: SessionRow;
  trackNames: string[];
  speakers: SpeakerCard[];
}) {
  return (
    <div style={{ border: '1px solid var(--hairline)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
      <div
        style={{
          alignItems: 'center',
          background: CHARCOAL,
          color: '#fff',
          display: 'flex',
          gap: 10,
          minHeight: 34,
          padding: '6px 10px',
        }}
      >
        <DetailDisclosure
          trigger={s.title}
          triggerLabel={`Session details: ${s.title}`}
          triggerStyle={{
            background: 'none',
            border: 0,
            color: '#fff',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 14,
            padding: 0,
            textAlign: 'left',
            textDecoration: 'underline',
          }}
          title={s.title}
          footer={
            <Link className="whova-btn-main small secondary" href={`${ROUTES.sessionManager}/${s.id}`}>
              Edit session
            </Link>
          }
        >
          <SessionDetail s={s} trackNames={trackNames} speakers={speakers} />
        </DetailDisclosure>
        {s.format ? (
          <span
            style={{
              background: s.status === 'published' ? '#00a65a' : '#adb0b6',
              borderRadius: 12,
              color: '#fff',
              fontSize: 11,
              padding: '2px 8px',
              textTransform: 'capitalize',
            }}
          >
            {s.format}
          </span>
        ) : null}
        {s.status !== 'published' ? (
          <span
            style={{ background: '#ffdb00', borderRadius: 12, color: '#333', fontSize: 11, padding: '2px 8px' }}
          >
            {s.status}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 13 }}>
          <Link href={`${ROUTES.sessionManager}/${s.id}`} style={{ color: '#fff' }}>
            Edit
          </Link>
        </span>
      </div>
      <div
        style={{
          background: '#fff',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          fontSize: 13,
          padding: '10px 12px',
        }}
      >
        <span>
          🕐 {twelveHour(s.startsAtLocal)} – {twelveHour(s.endsAtLocal)}
        </span>
        {s.roomName ? <span>📍 {s.roomName}</span> : null}
        {s.primaryTrackName ? <span>🏷 {s.primaryTrackName}</span> : null}
        {s.speakerNames.length ? <span>👤 {s.speakerNames.join(', ')}</span> : null}
      </div>
    </div>
  );
}

export default async function SessionManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; q?: string }>;
}) {
  await requireOrganizer();

  const { day, q } = await searchParams;
  /*
   * Tracks and speakers are read for the detail modals, which are rendered with
   * the page rather than fetched on click — there is no Firebase client in this
   * app to fetch one with. Both are single-equality reads of small collections
   * (11 tracks, 137 speakers) and they run alongside the session read rather
   * than after it.
   */
  const [all, trackOptions, speakerCards] = await Promise.all([
    listSessions(),
    listTrackOptions(),
    listSpeakerCards(),
  ]);
  const trackNameById = new Map(trackOptions.map((t) => [t.id, t.name]));
  const speakerById = new Map(speakerCards.map((p) => [p.id, p]));
  const detailOf = (s: SessionRow) => ({
    trackNames: s.trackIds.map((id) => trackNameById.get(id)).filter((n): n is string => Boolean(n)),
    speakers: s.speakerIds.map((id) => speakerById.get(id)).filter((p): p is SpeakerCard => Boolean(p)),
  });

  const days = [...new Set(all.map((s) => s.day))].sort();
  const activeDay = day && days.includes(day) ? day : (days[0] ?? '');

  const needle = (q ?? '').trim().toLowerCase();
  const onDay = all.filter((s) => s.day === activeDay);
  const rows =
    needle.length >= 3
      ? onDay.filter((s) =>
          [s.title, ...s.speakerNames, s.roomName ?? '', s.primaryTrackName ?? '']
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : onDay;

  // Everything before 07:00 collapses into one bucket, then one per hour through
  // the last hour that actually has something in it.
  const byHour = new Map<number, SessionRow[]>();
  for (const s of rows) {
    const h = Number(clockOf(s.startsAtLocal).slice(0, 2));
    const bucket = h < 7 ? -1 : h;
    byHour.set(bucket, [...(byHour.get(bucket) ?? []), s]);
  }
  const lastHour = Math.max(7, ...[...byHour.keys()].filter((h) => h >= 0));
  const hours = Array.from({ length: lastHour - 7 + 1 }, (_, i) => 7 + i);
  const unscheduled = all.filter((s) => !s.day);

  /**
   * The fallback day for "Add session" when the programme is empty and there is
   * therefore no active tab. In the *event's* zone, never the server's — a
   * dashboard rendered on a UTC host would otherwise offer tomorrow's date to an
   * organizer sitting in New York at 8pm.
   */
  const today = todayInEventZone();

  const qs = (d: string) => `${ROUTES.sessionManager}?day=${d}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <>
      <PageHeader
        title="Session Manager"
        actions={
          <Link className="whova-btn-main small secondary" href={ROUTES.trackManager}>
            Track Manager
          </Link>
        }
        links={[
          <Link key="c" href="/content/agenda-center">
            Agenda Center
          </Link>,
          <Link key="cc" href="/content/agenda-center/conflict-check">
            Conflict Check
          </Link>,
          /*
           * Promotion out of the call for abstracts is a step *here*, and
           * deliberately not a side effect of accepting a submission. Whova's
           * marketing claims acceptance synchronises with the agenda; Whova's
           * own help centre says it does not, and the help centre is right — a
           * session needs a day, a time and a room, and acceptance decides none
           * of them. See `CFA-PLAN.md` §4.
           */
          <Link key="fa" href="/content/agenda-center/session-manager/from-accepted">
            From accepted submissions
          </Link>,
          <span key="n" className="muted">
            {all.length} sessions · {days.length} days
          </span>,
        ]}
      />

      <Panel>
        {unscheduled.length ? (
          <Banner kind="warning">
            <strong>{unscheduled.length}</strong> sessions are not scheduled.
          </Banner>
        ) : null}

        {/*
          Four controls that used to sit here — Import, Reuse from past event,
          Copy day, Bulk edit — were rendered `disabled` with a tooltip saying
          so, which is the failure mode `SHOW_GAP_NOTES` was invented to
          prevent: a greyed-out button is a promise made in the demo and broken
          in the room. They are gone.

          The two that survive are the two that are real. Export was disabled
          although `lib/exports.ts` has served the programme CSV all along — it
          needed a link, not a feature.
        */}
        <div className="toolbar">
          <Link className="btn btn-primary" href={`${ROUTES.sessionManager}/new?day=${activeDay || today}`}>
            Add session
          </Link>
          <span className="spacer" />
          <a className="btn btn-default" href="/export/sessions" download>
            Export programme (CSV)
          </a>
        </div>

        <form method="get" className="toolbar">
          <input type="hidden" name="day" value={activeDay} />
          <input
            className="whova-text-input"
            name="q"
            defaultValue={q ?? ''}
            autoComplete="off"
            placeholder="Search by session name, speaker name, room or track (min 3 chars)"
            style={{ maxWidth: 520 }}
          />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={qs(activeDay)}>
              Clear
            </Link>
          ) : null}
        </form>

        <div style={{ display: 'flex', gap: 1, marginBottom: 16, flexWrap: 'wrap' }}>
          {days.map((d) => {
            const t = prettyDayTab(d);
            const on = d === activeDay;
            return (
              <Link
                key={d}
                href={qs(d)}
                style={{
                  background: on ? 'var(--interactive)' : '#fdfdfd',
                  border: on ? '1px solid var(--interactive)' : '1px solid var(--line-strong)',
                  color: on ? '#fff' : 'var(--body)',
                  fontWeight: on ? 700 : 400,
                  lineHeight: '17px',
                  minWidth: 74,
                  padding: '8px 14px',
                  textAlign: 'center',
                  textDecoration: 'none',
                }}
              >
                <span style={{ display: 'block', fontSize: 12 }}>{t.weekday}</span>
                <span style={{ display: 'block', fontSize: 13 }}>{t.date}</span>
              </Link>
            );
          })}
        </div>

        {all.length === 0 ? (
          <NotInputted
            what="sessions"
            action={
              <Link className="whova-btn-main secondary" href={`${ROUTES.sessionManager}/new?day=${today}`}>
                Add the first one
              </Link>
            }
          />
        ) : (
        <div style={{ background: 'var(--surface-alt)', borderRadius: 4, padding: 10 }}>
          {byHour.has(-1) ? (
            <div style={{ background: '#fff', border: '1px solid var(--hairline)', borderRadius: 4, marginBottom: 10, padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>12:00 AM – 7:00 AM</div>
              {byHour.get(-1)!.map((s) => (
                <SessionCard key={s.id} s={s} {...detailOf(s)} />
              ))}
            </div>
          ) : null}

          {hours.map((h) => (
            <div
              key={h}
              style={{
                background: '#fff',
                border: '1px solid var(--hairline)',
                borderRadius: 4,
                marginBottom: 10,
                padding: 10,
              }}
            >
              <div style={{ alignItems: 'center', display: 'flex', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{hourLabel(h)}</span>
                <span style={{ flex: 1 }} />
                <Link
                  className="btn btn-default btn-sm"
                  href={`${ROUTES.sessionManager}/new?day=${activeDay || today}&hour=${h}`}
                >
                  Add session
                </Link>
              </div>
              {(byHour.get(h) ?? []).map((s) => (
                <SessionCard key={s.id} s={s} {...detailOf(s)} />
              ))}
              {(byHour.get(h) ?? []).length === 0 ? (
                <div className="muted" style={{ fontSize: 12, paddingLeft: 2 }}>
                  Nothing scheduled.
                </div>
              ) : null}
            </div>
          ))}
        </div>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Import the agenda
        </h2>
        <p className="body-2">
          Use the same columns as the programme export. Speakers, tracks and rooms are matched{' '}
          <strong>by name</strong>, and a row naming one that does not exist is reported, not
          created. Import the speaker and track lists first.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Times are read in the event&rsquo;s time zone. New sessions arrive as drafts, so nothing
          reaches attendees until you publish it.
        </p>
        <CsvImportPanel
          previewAction={previewSessionImportAction}
          commitAction={commitSessionImportAction}
          nounSingular="session"
          nounPlural="sessions"
          columnHint={
            <>
              Needs <strong>Title</strong>, <strong>Day</strong> and <strong>Start</strong>. End,
              End date, Room, Track, Speakers, Format, Status, Skill level, Capacity and
              Description are used if present. Separate several speakers or tracks in one cell with
              a semicolon, not a comma.
            </>
          }
          placeholder={'Day,Start,End,Title,Room,Track,Speakers\n2027-05-04,09:00,10:00,Knowledge graphs at scale,Bloomberg 165,Graph ML,Ada Okonkwo; Jae Vance'}
          additiveNote={
            <>
              Nothing was removed. A session missing from the file stays on the programme. To
              retire one, set its status to cancelled. A session whose time changed is reported, not
              written. Change the time on the session itself.
            </>
          }
        />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A single multi-sheet workbook.</strong> The CSV importer above covers the
            agenda itself and uses the same id function the CLI importer and the seed use, so all
            three agree about which document a re-import updates. What it does not read is one file
            holding three linked sheets. Here the three entities are three files imported in order,
            which is the same information with a simpler failure mode.
          </li>
          <li>
            <strong>Sub-sessions and non-session items.</strong> Adding a session is built; nesting
            one inside another is not, and neither is the time cascade a parent move would need to
            shuffle its children into the new bounds. <code>SessionDoc</code> has{' '}
            <code>seriesId</code> for repeated runs but no parent link, and nothing reads{' '}
            <code>seriesId</code> today — which is why the editor has no control for it.
          </li>
          <li>
            <strong>Bulk edit, block move and swap, copy a day, and reuse a past event</strong>,
            plus the neighbour-aware prompts that offer to extend or shorten an adjacent session
            when an edit opens a gap. That last one is small and genuinely good; the rest is what
            the CSV importer trades away. All five were <code>disabled</code> buttons on the
            toolbar until now; a greyed-out control is a promise made in the demo and broken in the
            room, so they are described here instead of being shown.
          </li>
          <li>
            <strong>Telling attendees a session moved.</strong> No versioning, no diff, no
            automatic notice — only a manual announcement. Editing a session below writes one
            document that every phone watching it picks up within about a second.
            The people who saved it are notified by the <code>onSessionAgendaChange</code> Cloud
            Function, which fires on that write whoever made it — the CSV importer included — and
            targets savers rather than broadcasting. <code>roomChangePush()</code> in{' '}
            <code>src/lib/push.ts</code> reports the audience here and deliberately sends nothing,
            so one room change cannot produce two notifications.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
