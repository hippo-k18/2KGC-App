import { ANNOUNCEMENT } from '@/lib/site';

/**
 * The orange strip under the header.
 *
 * One line, whether a visitor can buy a ticket yet, repeated and scrolling left.
 * The copies are for the eye only: a screen reader hears the line once.
 *
 * `salesOpen` comes from the page, which knows whether a payment processor is
 * connected. That is deliberately not a constant: a bar promising tickets are
 * available while the buy button refuses is the defect this site has already
 * shipped once.
 *
 * Announcements do not appear here. They have their own page and they reach
 * attendees on their phones; a room change borrowing the one strip that tells a
 * visitor whether they can buy a ticket is a bad trade.
 */
export function Ticker({ salesOpen = false }: { salesOpen?: boolean }) {
  const line = salesOpen ? 'Tickets are available now' : ANNOUNCEMENT;

  if (!line) return null;

  // Enough copies to overfill a wide screen, then the whole run twice so the
  // -50% keyframe lands exactly on the start of the second run.
  const run = Array.from({ length: 8 }, (_, i) => i);

  return (
    <div className="ticker" role="complementary" aria-label="Ticket news">
      <p className="sr-only">{line}</p>
      <div className="ticker-track" aria-hidden="true">
        {[0, 1].map((half) => (
          <ul className="ticker-run" key={half}>
            {run.map((i) => (
              <li key={i}>
                {line}
                <span className="ticker-dot" />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
