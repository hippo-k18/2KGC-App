import type { Metadata } from 'next';
import Link from 'next/link';
import { siteEvent } from '@/lib/data';
import { listSignageRooms } from '@/lib/room-signage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Room screens',
  description: 'The sign for each room, for a screen outside its door.',
  robots: { index: false, follow: false },
};

/**
 * `/rooms` — the list somebody setting up the venue screens works from.
 *
 * Not a visitor page and not linked from the site's navigation: the address of
 * a sign is only useful to the person walking round the building with a laptop
 * on the morning of day one, opening one URL per corridor. It exists so that
 * `/rooms` is that list rather than a 404, and so the dashboard's room list has
 * somewhere to send an organizer who wants to see all of them at once.
 */
export default async function RoomIndexPage() {
  const [rooms, ev] = await Promise.all([listSignageRooms(), siteEvent()]);

  return (
    <section className="wall sign">
      <div className="wrap">
        <header className="wall-head">
          <p className="wall-eyebrow">
            {ev.shortName} {ev.year}
          </p>
          <h1>Room screens</h1>
          <p className="wall-sub">
            One page per room, showing what is on now and next. Open the room&rsquo;s page on the
            screen outside its door and leave it there. Each one keeps itself up to date.
          </p>
        </header>

        {rooms.length === 0 ? (
          <p className="wall-sub">No rooms yet.</p>
        ) : (
          <ol className="sign-later room-index">
            {rooms.map((r) => (
              <li key={r.id}>
                <span className="sign-later-title">
                  <Link href={`/rooms/${encodeURIComponent(r.id)}`}>{r.name}</Link>
                </span>
                <span className="room-index-count">
                  {r.sessions === 0
                    ? 'nothing scheduled'
                    : `${r.sessions} ${r.sessions === 1 ? 'session' : 'sessions'}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
