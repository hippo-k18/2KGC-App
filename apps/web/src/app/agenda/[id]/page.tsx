import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  agendaSpeakers,
  listAgenda,
  listPublicDocuments,
  siteEvent,
  type AgendaSession,
  type SpeakerCard,
} from '@/lib/data';
import { sessionCalendarPath } from '@kgc/shared';
import { forgetTicketAction } from '@/app/ticket-actions';
import { readTicketPass } from '@/lib/ticket-pass';
import { sessionWatchPanel } from '@/lib/watch';
import { formatDayHeading, localTime } from '@/lib/site';
import { WatchPanel } from './watch-panel';

/**
 * `/agenda/{sessionId}` — one session, as a page rather than a dialog.
 *
 * ── Why this exists when the agenda already opens a dialog ──────────────────
 *
 * The dialog is right for the agenda: 85 sessions, everything already in
 * memory, no navigation, no second read. It is exactly wrong for a video. A
 * dialog is rendered in the browser from data the page shipped, so putting a
 * gated stream in one would mean sending every visitor the URL of every stream
 * and deciding afterwards whether to draw it — which is not a gate, it is a
 * hidden field. The decision has to happen on the server, so the video needs an
 * address of its own.
 *
 * Having one turns out to be worth it for its own sake: a session is the thing
 * people paste into a message, and until now the only per-session URL on this
 * site was the `.ics` download hanging off this same segment.
 *
 * ── Unpublished and nonexistent are one answer ──────────────────────────────
 *
 * Read through `listAgenda()` rather than by fetching the document, for the
 * reason the `.ics` route beside this one gives: whatever "published" means, it
 * has to mean the same thing here, and a second copy of the filter is a second
 * place a draft can escape from. A draft session 404s like a missing one, so a
 * session id cannot be used to learn what the programme committee is
 * considering.
 *
 * ── The watch decision is made here, not in the panel ───────────────────────
 *
 * `sessionWatchPanel()` returns the two decisions and nothing else. This page
 * never holds the stream or recording record, which is the only reliable way to
 * keep a gated URL out of the response: a server component's props are
 * serialised into the response body whether or not the markup renders them, so
 * handing the whole record to a component that decides correctly still ships
 * the link to everybody who opens the page. It did, for a fortnight, and a
 * visitor with no ticket at all could read the stream id out of the HTML.
 */
/** Per-request, and it has to be. Reads the ticket-pass cookie to decide whether this visitor may be handed a stream or recording link. A cached response is a response served to somebody else, and the somebody else here is a visitor with a different ticket or none. */
export const dynamic = 'force-dynamic';

async function findSession(id: string): Promise<{ session: AgendaSession; heading: string } | null> {
  const days = await listAgenda();
  for (const d of days) {
    const session = d.sessions.find((s) => s.id === id);
    if (session) return { session, heading: formatDayHeading(d.day) };
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const found = await findSession(decodeURIComponent(id));
  if (!found) return { title: 'Session' };
  const { session } = found;
  return {
    title: session.title,
    description: session.description?.slice(0, 200) ?? `${session.title} at KGC 2027.`,
  };
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = decodeURIComponent(id);

  const found = await findSession(sessionId);
  if (!found) notFound();
  const { session, heading } = found;

  /*
   * Which ticket this device is carrying, if any. Null is the ordinary case:
   * most people reading a session page are deciding whether to come. Read
   * before the rest, because the watch decision is made from it on the server.
   */
  const pass = await readTicketPass();

  const [ev, speakers, documents, watch] = await Promise.all([
    siteEvent(),
    agendaSpeakers(),
    listPublicDocuments(),
    sessionWatchPanel(sessionId, { ticketType: pass?.ticketType ?? null }, Date.now()),
  ]);

  const people = session.speakerIds
    .map((sid) => speakers[sid])
    .filter(Boolean) as SpeakerCard[];
  const materials = documents.filter((d) => d.sessionId === sessionId);

  return (
    <section>
      <div className="wrap">
        <p className="eyebrow">
          <Link href={`/agenda?day=${session.day}`}>Agenda</Link>
        </p>
        <h1>{session.title}</h1>
        <p className="lede">
          {heading}, {localTime(session.startsAtLocal)} to {localTime(session.endsAtLocal)}
          {session.roomName ? ` · ${session.roomName}` : ''}
        </p>

        <div className="tags">
          {session.trackName && (
            <span
              className="tag track"
              style={session.trackColor ? ({ '--track': session.trackColor } as React.CSSProperties) : undefined}
            >
              {session.trackName}
            </span>
          )}
          <span className="tag">{session.format}</span>
          {session.skillLevel && <span className="tag">{session.skillLevel}</span>}
        </div>

        {/*
          The video, or the sentence that stands where it would. Renders nothing
          at all for a session that was never streamed, which is most of them.
        */}
        <WatchPanel
          watch={watch}
          passTicketType={pass?.ticketType ?? null}
          sessionTitle={session.title}
          startsAtLocal={session.startsAtLocal}
        />

        {pass && (
          /*
            Said on every session page, not only where a video is gated: a
            device carrying somebody's ticket should say so where they can see
            it and undo it, rather than only when it is about to matter.
          */
          <div className="watch-whose">
            <span>
              This device is using {pass.name}&rsquo;s ticket (
              {pass.ticketType ?? 'no ticket type'}).
            </span>{' '}
            {/* A form, not a link. Forgetting a ticket is a write, and a GET
                that changes state is one prefetch away from doing it on its
                own. */}
            <form action={forgetTicketAction}>
              <button type="submit" className="linkish">
                Forget it
              </button>
            </form>
          </div>
        )}

        {session.description && (
          <div className="session-dialog-body" style={{ marginTop: 24 }}>
            {session.description
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
        )}

        {people.length > 0 && (
          <section className="session-dialog-speakers">
            <h3>{people.length === 1 ? 'Speaker' : 'Speakers'}</h3>
            {people.map((s) => (
              <article className="session-speaker" key={s.id}>
                {s.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="session-speaker-photo"
                    src={s.photoURL}
                    alt=""
                    width={s.photoWidth ?? 96}
                    height={s.photoHeight ?? 96}
                    loading="lazy"
                  />
                ) : (
                  <div className="session-speaker-photo is-fallback" aria-hidden="true" />
                )}
                <div className="session-speaker-text">
                  <p className="session-speaker-name">{s.name}</p>
                  {s.title && <p className="session-speaker-role">{s.title}</p>}
                  {s.company && <p className="session-speaker-org">{s.company}</p>}
                  {s.bio && <p className="session-speaker-bio">{s.bio}</p>}
                </div>
              </article>
            ))}
          </section>
        )}

        {people.length === 0 && session.speakerNames.length > 0 && (
          <section className="session-dialog-speakers">
            <h3>{session.speakerNames.length === 1 ? 'Speaker' : 'Speakers'}</h3>
            <p className="session-speaker-names">{session.speakerNames.join(' · ')}</p>
          </section>
        )}

        {session.slidesUrl && (
          <section className="session-dialog-speakers">
            <h3>Slides</h3>
            <p>
              <a href={session.slidesUrl} target="_blank" rel="noreferrer">
                Open the slides for this session
              </a>
            </p>
          </section>
        )}

        {materials.length > 0 && (
          <section className="session-dialog-speakers">
            <h3>Materials</h3>
            {materials.map((d) => (
              <p key={d.id}>
                <a href={d.url} target="_blank" rel="noreferrer noopener">
                  {d.title}
                </a>
                {d.host && <span className="doc-host"> · {d.host}</span>}
              </p>
            ))}
          </section>
        )}

        <section className="session-dialog-cal">
          <h3>Add to my calendar</h3>
          <div className="cal-links">
            <a className="btn btn-primary btn-sm" href={sessionCalendarPath(session.id)}>
              Apple or Outlook desktop
            </a>
          </div>
          <p className="cal-note">
            Times are local to the venue ({ev.timeZone.replace('_', ' ')}). Your calendar converts
            them to whatever zone you are in.
          </p>
        </section>
      </div>
    </section>
  );
}
