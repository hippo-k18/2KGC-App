import type { Metadata } from 'next';
import s from './options.module.css';

export const metadata: Metadata = { title: 'Ticketing options' };

/**
 * Ten designs for one decision.
 *
 * Every option below sells the same four tickets from the same Firestore
 * catalogue and reaches the same checkout form. What differs is only the part
 * that is being judged: how the tiers are laid out, how a buyer reads what is
 * included, and how All Access is made to look like the ticket worth having.
 *
 * Each archetype was drawn from a survey of how real conferences sell tickets,
 * so the ten are structurally different rather than ten arrangements of three
 * cards in a row.
 */
const OPTIONS = [
  {
    n: 1,
    name: 'The week strip',
    note: 'The conference calendar is the chooser. Each ticket is a span of days across Monday to Friday, so the question is “which days am I coming?” rather than “how important am I?”',
  },
  {
    n: 2,
    name: 'The comparison matrix',
    note: 'A real table: what a ticket may include down the side, the four tickets across the top, with a third state for “included, with a condition”.',
  },
  {
    n: 3,
    name: 'The inheritance ladder',
    note: 'Tickets stacked cheapest first, each rung stating only what it adds to the one below, so no benefit is ever read twice.',
  },
  {
    n: 4,
    name: 'Honest disclosure cards',
    note: 'Compact cards whose closed state already tells you the days, the difference and the count. The current page’s shape, fixed where it fails.',
  },
  {
    n: 5,
    name: 'Rows with a live summary',
    note: 'Selectable rows beside a sticky panel that shows the consequence of the choice as it is made, including what upgrading would add and cost.',
  },
  {
    n: 6,
    name: 'Two questions',
    note: 'In the room or online, and which part of the week. Two answers resolve to one ticket, with all four still one click away.',
  },
  {
    n: 7,
    name: 'Grouped by what you’re buying',
    note: 'Sections headed by their dates (the whole week, the conference, the workshops, from anywhere), so the heading does the explaining.',
  },
  {
    n: 8,
    name: 'Lead panel and alternatives',
    note: 'All Access gets a full editorial panel; the other three sit beneath it as compact alternatives for people who only need part of the week.',
  },
  {
    n: 9,
    name: 'One ticket, then the exceptions',
    note: 'The boldest: one ticket presented as the way to attend, with the other three as dignified exceptions, and the freed space spent helping you justify the spend.',
  },
  {
    n: 10,
    name: 'The ledger',
    note: 'No cards at all. A typographic price list where the arithmetic ($699 plus $799 against $1,199) makes the argument by itself.',
  },
];

export default function OptionsIndex() {
  return (
    <main className={s.index}>
      <h1>Ten ticketing pages</h1>
      <p>
        Ten designs for choosing a ticket. All of them sell the same four tickets from the same
        catalogue and reach the same checkout, so the only thing that differs is the part being
        judged. Every one is clickable end to end.
      </p>
      <ul className={s.indexList}>
        {OPTIONS.map((o) => (
          <li key={o.n}>
            <a href={`/tickets/options/v${o.n}`}>
              <span className={s.indexNum}>Option {o.n}</span>
              <span className={s.indexName}>{o.name}</span>
              <span className={s.indexNote}>{o.note}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
