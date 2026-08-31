import { ANNOUNCEMENT, TICKER } from '@/lib/site';

/**
 * The scrolling strip under the header.
 *
 * It replaces a static one-sentence bar. This is the widest, most persistent
 * element on every page of the site, and it was spending all of that on six
 * words — so it now carries the handful of facts a visitor is actually deciding
 * on, and moves, which is what makes a strip this thin worth reading.
 *
 * ## How it scrolls without JavaScript
 *
 * The list is rendered twice, side by side, and the pair is translated left by
 * exactly half its own width before looping. At the moment the animation
 * restarts, the second copy is sitting precisely where the first one started, so
 * the seam is invisible and there is no measuring, no `requestAnimationFrame`
 * and no client component — this is a server component that ships no JS at all.
 *
 * The duplicate is `aria-hidden`, so a screen reader hears the facts once.
 *
 * ## Two things it deliberately does
 *
 * **Stops on hover and on focus.** A moving target you cannot read is worse than
 * a static one, and this is the only place on the site where the content moves
 * on its own.
 *
 * **Stops completely under `prefers-reduced-motion`.** The rule is in
 * `globals.css`: the animation is removed rather than slowed, and the strip
 * becomes an ordinary horizontally scrollable row — the facts are all still
 * reachable, they simply hold still.
 *
 * ## Where the leading lines come from
 *
 * `announcements` is what the organizer actually posted, read from Firestore by
 * whoever renders this — see `listAnnouncements()` in `lib/data.ts`. It leads
 * the loop, newest first, because a room change is the only thing on this strip
 * that is urgent.
 *
 * `ANNOUNCEMENT` in `lib/site.ts` is the fallback and not dead weight: for most
 * of the year the collection is legitimately empty, and a strip that opens on
 * the standing line ("Tickets for KGC 2027 open soon") is better than one that
 * opens on the venue. The two are never shown together — a live announcement
 * displaces the standing line rather than queueing behind it, because the point
 * of the announcement is that it is the news.
 */
export function Ticker({ announcements = [] }: { announcements?: string[] }) {
  // The organizer's own words lead when there are any; otherwise the one line
  // the owner edits by hand does.
  const lead = announcements.length > 0 ? announcements : ANNOUNCEMENT ? [ANNOUNCEMENT] : [];

  if (lead.length === 0 && TICKER.length === 0) return null;

  const items = [...lead, ...TICKER];

  const run = (hidden: boolean) => (
    <ul className="ticker-run" aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>
          <span className="ticker-dot" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ticker" role="complementary" aria-label="Conference at a glance">
      <div className="ticker-track">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}
