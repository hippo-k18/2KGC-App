import { ANNOUNCEMENT_WALL_LIMIT } from '@kgc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { listAnnouncements, siteEvent } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Announcements',
  description:
    'Everything the Knowledge Graph Conference organizers have announced: room changes, schedule updates and notices, newest first.',
};

export const dynamic = 'force-dynamic';

/**
 * `/announcements` — the organizer's broadcast history, in public.
 *
 * ── Why this collection and not the other one ───────────────────────────────
 *
 * There are two streams in this product that look like a feed, and only one of
 * them may ever be published. `communityPosts` is the attendee board: it is
 * gated behind the `registered` claim in `firestore.rules`, and people posted
 * ride shares and dinner plans there on that understanding. Publishing it
 * retroactively changes the deal they agreed to, so it is deliberately absent
 * here and the dashboard's Social Wall screens say so in as many words. Do not
 * "finish" this page by adding it.
 *
 * `announcements` is the opposite case: written by staff, for everybody,
 * already sent over push. There is no per-attendee content in the collection at
 * all — a title, a body, an author id and a push flag — so nothing about
 * putting it on a public URL exposes anybody. It was simply unbuilt, which is
 * why the dashboard's Announcement Wall screen is the one wall in the nav
 * tagged "unbuilt, not blocked".
 *
 * ── Read across a room, which is a real constraint and not a flourish ───────
 *
 * The reason Whova has this page is the screen in the lobby between talks. That
 * puts the reader six metres away rather than sixty centimetres, so the design
 * is inverted from every other page on this site: a dark ground, one column,
 * and a headline size that would be shouting on a laptop and is barely adequate
 * on a 55" panel across a foyer. The body text stays because the same URL is
 * also what an attendee opens on a phone when they missed the push, and a wall
 * that drops the detail sends them to the app for it.
 *
 * ── It refreshes itself now ────────────────────────────────────────────────
 *
 * This page used to say, here and on the dashboard screen that links to it,
 * that a kiosk browser set to reload was the answer. It is not: nobody
 * configures the reload interval of a screen they hung on a wall in a hurry,
 * and a stale wall is indistinguishable from a current one. `AutoRefresh` runs
 * `router.refresh()` on a timer, which re-runs this server component — the
 * route is `force-dynamic`, so that is a genuine re-read — and the head of the
 * page says when it last managed it.
 */

/**
 * `1746453600000` → `Wed 5 May · 09:12`.
 *
 * Formatted in the **venue's** zone, not the server's and not the reader's, for
 * the reason the agenda page's header gives at length: a time rendered in
 * whatever zone the machine happens to be in is how somebody reads "the keynote
 * moved to 14:00" and turns up five hours late. The zone is the one saved on
 * Content > Basics (`siteEvent()`), the same one the programme is authored in.
 */
function announcedAt(ms: number, timeZone: string): string {
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
    .format(new Date(ms))
    .replace(', ', ' · ');
}

/**
 * A minute, which is slower than the room sign and deliberately so.
 *
 * An announcement is typed by a person and read for as long as it stays up; a
 * sign outside a room is counting down to a talk. Re-reading forty documents
 * more often than anybody writes one buys nothing.
 */
const WALL_REFRESH_SECONDS = 60;

export default async function AnnouncementsPage() {
  const ev = await siteEvent();
  /*
   * The wall limit, not the default 3 — see `ANNOUNCEMENT_WALL_LIMIT` in
   * `@kgc/shared` for why the archive wants a different number from the ticker.
   * It is shared because the dashboard's activity-stream screen reports how
   * many notices this page shows, and a literal in each was a number that would
   * disagree the first time either was edited.
   */
  const announcements = await listAnnouncements(ANNOUNCEMENT_WALL_LIMIT);

  return (
    <section className="wall">
      <div className="wrap">
        <header className="wall-head">
          <p className="wall-eyebrow">
            {ev.shortName} {ev.year} · {ev.datesLong}
            <span className="wall-refresh">
              <AutoRefresh seconds={WALL_REFRESH_SECONDS} />
            </span>
          </p>
          <h1>Announcements</h1>
          <p className="wall-sub">
            Everything the organizers have announced, newest first. The same notices reach the{' '}
            <Link href="/tickets">KGC app</Link> as a push.
          </p>
        </header>

        {announcements.length === 0 ? (
          /*
            The honest empty state, and the normal one for most of the year. A
            wall that renders a heading over nothing reads as a broken screen —
            which, on a panel in a foyer with nobody watching it, is exactly the
            fault nobody will report.
          */
          <div className="wall-empty">
            <p>No announcements yet.</p>
            <p className="wall-sub">
              Notices posted during {ev.shortName} appear here, and on the phone of everyone with
              the app.
            </p>
          </div>
        ) : (
          <ol className="wall-list">
            {announcements.map((a, i) => (
              /*
                The newest one is larger than the rest. On a wall the question is
                always "what is the latest thing?", and answering it with position
                alone fails the reader who walks up mid-scroll — the top of a
                page is not visibly the top from six metres away.
              */
              <li className={i === 0 ? 'wall-item latest' : 'wall-item'} key={a.id}>
                <p className="wall-when">
                  {i === 0 && <span className="wall-badge">Latest</span>}
                  {announcedAt(a.createdAtMs, ev.timeZone)}
                </p>
                <h2>{a.title}</h2>
                {a.body && <p className="wall-body">{a.body}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
