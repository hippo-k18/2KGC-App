import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import { Rung, Branch, Together } from './ladder';
import s from './styles.module.css';

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. These are layout options for the tickets page and read the same catalogue, so a stale price would be a stale price here too. */
export const dynamic = 'force-dynamic';

/**
 * Option 3 — the inheritance ladder.
 *
 * ── Which tickets form the chain, and why it is not just "all of them" ──────
 *
 * The nesting is real for Virtual → Main Conference → All Access, and false for
 * Workshops: Workshops is the other half of the week, not a smaller version of
 * the conference. Nothing above it contains it (Main Conference does not), and
 * it contains nothing below it. Putting it on the ladder would make the page
 * claim something untrue, so it hangs off the rail at its own price instead.
 *
 * That split is derived rather than hard-coded, because the organizer can add a
 * fifth ticket: the spine is the tiers the catalogue marks `featured` (the
 * headline in-person tickets, which do nest) plus any online-only tier, which
 * is always the cheapest way in and is contained by the top of the ladder.
 * Everything else hangs off as a branch. A tier added in the dashboard lands
 * somewhere sensible without anyone editing this file.
 */
function split(tiers: Tier[]): { ladder: Tier[]; branches: Tier[] } {
  const asc = [...tiers].sort((a, b) => a.priceCents - b.priceCents);
  const onLadder = (t: Tier) => Boolean(t.featured) || !t.inPerson;
  const ladder = asc.filter(onLadder);
  // No featured tier and no online tier is a catalogue nobody has curated;
  // showing one flat ladder is better than showing four orphaned branches, and
  // each step still states what it drops, so it cannot overclaim.
  if (ladder.length === 0) return { ladder: asc, branches: [] };
  return { ladder, branches: asc.filter((t) => !onLadder(t)) };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);
  const { ladder, branches } = split(data.tiers);
  const top = ladder.length > 0 ? ladder[ladder.length - 1] : null;
  const second = ladder.length > 1 ? ladder[ladder.length - 2] : null;
  const cheapest = [...data.tiers].sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;

  // Rungs and branches interleaved by price, so the branch hangs at the height
  // it actually costs rather than being swept to the bottom of the page.
  const rows = [...ladder.map((t) => ({ t, branch: false })), ...branches.map((t) => ({ t, branch: true }))].sort(
    (a, b) => a.t.priceCents - b.t.priceCents,
  );

  return (
    <OptionChrome
      n={3}
      name="The inheritance ladder"
      note="each step states only what it adds to the step before it, diffed from the data"
    >
      <main className={s.page}>
        <header className={s.intro}>
          <h1 className={s.h1}>Each ticket is the one before it, plus something.</h1>
          <p className={s.deck}>
            So a step states only its own difference, and you never read the same benefit twice.
            {cheapest ? ` Start at ${formatPrice(cheapest.priceCents, cheapest.currency)}` : ' Start at the bottom'}
            , take the steps in order, and the last one is the shortest read on the page.
          </p>
          <p className={s.where}>
            {SITE.name}, {SITE.datesLong}, at {SITE.venueShort}. Workshops open the week on{' '}
            {SITE.workshopDays}; the conference runs {SITE.conferenceDays}.
          </p>
          <p className={s.rubric}>
            Anything a step does not mention is unchanged from the step before it. Where a step
            leaves something behind, it says so and names it.
          </p>
          {data.cancelled ? (
            <p className={s.cancelled}>
              That checkout was cancelled and you have not been charged. Pick a ticket again below.
            </p>
          ) : null}
        </header>

        {rows.length > 0 ? (
          <ol className={s.ladder}>
            {rows.map((row) => {
              if (row.branch) {
                return <Branch key={row.t.id} tier={row.t} top={top} />;
              }
              const i = ladder.indexOf(row.t);
              const level = i === 0 ? 'ground' : i === ladder.length - 1 ? 'summit' : 'middle';
              const isTop = level === 'summit' && ladder.length > 1;
              return (
                <Rung
                  key={row.t.id}
                  tier={row.t}
                  previous={i > 0 ? ladder[i - 1] : null}
                  level={level}
                  extra={
                    isTop && second && branches.length > 0 ? (
                      <Together top={row.t} second={second} branch={branches[branches.length - 1]} />
                    ) : null
                  }
                />
              );
            })}
          </ol>
        ) : (
          <p className={s.rubric}>
            The ticket list cannot be read right now, so there is nothing to compare. Write to{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will tell you the
            prices.
          </p>
        )}
      </main>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
