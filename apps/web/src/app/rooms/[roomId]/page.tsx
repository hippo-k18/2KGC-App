import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { siteEvent, siteVisibility } from '@/lib/data';
import { roomSignage } from '@/lib/room-signage';
import { clockOf, signageView, untilLabel } from '@/lib/room-signage-core';

/** Per-request, and it has to be. This is the sign outside a room. Same reason as `/announcements`: it refreshes itself, and a cache would stack staleness on top of staleness. */
export const dynamic = 'force-dynamic';

/**
 * `/rooms/{roomId}` — the sign outside one room.
 *
 * ── Why this is public, when the poll room view is not ─────────────────────
 *
 * The dashboard's projector page for a poll sits behind the organizer sign-in,
 * because a result the room has not been shown yet is not public. A room sign
 * is the opposite: it carries the published programme, which is already on
 * `/agenda` for anybody to read, and it has to open on a venue screen that
 * nobody is going to sign in on, months of conference wifi and a locked-down
 * kiosk browser later. So it is a plain URL, and it holds nothing that is not
 * already published.
 *
 * ── Read from the corridor ─────────────────────────────────────────────────
 *
 * Same inversion as the announcement wall, for the same reason, using the same
 * dark ground: a lit corridor, a reader at three or four metres, and a glance
 * rather than a read. What is on now is the largest thing on the screen, what
 * is next is second, and the rest of the day is a strip along the bottom for
 * the person deciding whether to come back after lunch.
 *
 * It refreshes itself. A sign is the one page on this site nobody will ever
 * reload by hand.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;
  const room = await roomSignage(roomId);
  if (!room) return { title: 'Room' };
  return {
    title: room.roomName,
    description: `What is on now and next in ${room.roomName}.`,
    // A screen in a corridor is not a search result, and a sign indexed out of
    // context is a page that answers "what is on" with whatever was true when
    // the crawler came past.
    robots: { index: false, follow: false },
  };
}

/** How often the sign re-reads the programme. */
const REFRESH_SECONDS = 60;

/** `2027-05-05` → `Wed 5 May`, in the day's own terms rather than a reader's. */
function dayName(day: string): string {
  if (!day) return '';
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

export default async function RoomSignPage({ params }: { params: Promise<{ roomId: string }> }) {
  if (!(await siteVisibility()).agenda) notFound();
  const { roomId } = await params;
  const [room, ev] = await Promise.all([roomSignage(roomId), siteEvent()]);
  if (!room) notFound();

  /*
   * The venue's clock, not the server's and not the reader's — the same
   * `sv-SE` trick the dashboard's check-in screen uses, which yields
   * `YYYY-MM-DD HH:mm:ss` and so matches `startsAtLocal` once the space is a
   * `T`. A sign rendered from a Netlify box in another region would otherwise
   * be hours out while looking entirely plausible.
   */
  const now = new Date()
    .toLocaleString('sv-SE', { timeZone: ev.timeZone })
    .replace(' ', 'T')
    .slice(0, 16);

  const { current, next, later, finished } = signageView(room.sessions, now);
  const where = [room.building, room.floor ? `floor ${room.floor}` : ''].filter(Boolean).join(', ');

  return (
    <section className="wall sign sign-screen">
      <div className="wrap">
        <header className="wall-head sign-head">
          <div>
            <p className="wall-eyebrow">
              {ev.shortName} {ev.year}
              {where ? ` · ${where}` : ''}
            </p>
            <h1>{room.roomName}</h1>
          </div>
          <AutoRefresh seconds={REFRESH_SECONDS} />
        </header>

        <div className="sign-now">
          <p className="wall-when">Now</p>
          {current ? (
            <>
              <p className="sign-clock">
                {clockOf(current.startsAtLocal)}
                {current.endsAtLocal ? ` to ${clockOf(current.endsAtLocal)}` : ''}
              </p>
              <h2 className="sign-title">{current.title}</h2>
              {current.speakerNames.length > 0 && (
                <p className="sign-people">{current.speakerNames.join(' · ')}</p>
              )}
              {current.trackName && <p className="sign-track">{current.trackName}</p>}
            </>
          ) : (
            /*
              Two different blanks, said differently. "Nothing on now" with a
              talk coming is a gap to wait out; a room that is finished sends
              the reader somewhere else, and the corridor is exactly where that
              decision gets made.
            */
            <h2 className="sign-title sign-quiet">
              {finished
                ? 'Nothing further in this room.'
                : 'Nothing on in this room at the moment.'}
            </h2>
          )}
        </div>

        {next && (
          <div className="sign-next">
            {/*
              The countdown and the date are the same fact said two ways, so
              only one of them is on the screen: a talk later today is "in 25
              minutes", and one on another day is that day's name beside the
              clock. Printing both gave "Next Wed 5 May" over "Wed 5 May,
              09:00".
            */}
            <p className="wall-when">
              Next{' '}
              {next.day === now.slice(0, 10) && (
                <span className="sign-until">
                  {untilLabel(next.startsAtLocal, now, dayName(next.day))}
                </span>
              )}
            </p>
            <p className="sign-clock">
              {next.day !== now.slice(0, 10) ? `${dayName(next.day)}, ` : ''}
              {clockOf(next.startsAtLocal)}
            </p>
            <h2 className="sign-title">{next.title}</h2>
            {next.speakerNames.length > 0 && (
              <p className="sign-people">{next.speakerNames.join(' · ')}</p>
            )}
          </div>
        )}

        {later.length > 0 && (
          <ol className="sign-later">
            {later.map((s) => (
              <li key={s.id}>
                <span className="sign-later-time">{clockOf(s.startsAtLocal)}</span>
                <span className="sign-later-title">{s.title}</span>
              </li>
            ))}
          </ol>
        )}

        {room.sessions.length === 0 && (
          <p className="wall-sub">
            Nothing is scheduled in this room yet. The full programme is on the{' '}
            <Link href="/agenda">agenda</Link>.
          </p>
        )}

        <p className="sign-foot">
          <Link href="/agenda">Full programme</Link> · {ev.datesShort}
        </p>
      </div>
    </section>
  );
}
