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
 */
export function Ticker() {
  if (!ANNOUNCEMENT && TICKER.length === 0) return null;

  // The hand-edited announcement leads, so the one line the owner controls is
  // the first thing anyone reads.
  const items = ANNOUNCEMENT ? [ANNOUNCEMENT, ...TICKER] : TICKER;

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
