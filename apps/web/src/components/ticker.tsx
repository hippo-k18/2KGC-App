import { ANNOUNCEMENT } from '@/lib/site';

/**
 * The orange strip under the header.
 *
 * It used to scroll seven facts past. A visitor deciding whether to come reads
 * the hero for the what and the when; this strip is worth one thing, and the
 * one thing is whether they can buy a ticket yet. So it holds still and says
 * that, and nothing else.
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

  return (
    <div className="ticker" role="complementary" aria-label="Conference at a glance">
      <div className="ticker-line">{line}</div>
    </div>
  );
}
