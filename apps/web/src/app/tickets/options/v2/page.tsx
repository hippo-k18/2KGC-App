import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { Matrix } from './matrix';
import s from './styles.module.css';

export const dynamic = 'force-dynamic';

/**
 * Option 2 — the comparison matrix.
 *
 * One table carries the whole offer. Rows are the things a ticket can include,
 * columns are the tickets, and every cell is marked, so the answer to "what
 * does the extra four hundred dollars buy" is four ticks you can point at
 * rather than four disclosures you have to open in turn.
 *
 * All Access wins the page by being the only column ticked all the way down.
 * No ribbon, no fill, no "most popular" — a two-pixel border, which is what
 * SEMANTiCS does and what none of the six conferences that use a popularity
 * badge manage to make believable.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);

  return (
    <OptionChrome
      n={2}
      name="The comparison matrix"
      note="one table, three states per cell, and the only full column wins"
    >
      <section className={s.head}>
        <div className={s.container}>
          <h1 className={s.h1}>Every ticket, side by side</h1>
          <p className={s.lede}>
            {SITE.name} runs {SITE.datesLong} at {SITE.venueShort}. Workshops open the week,
            the conference closes it. The table below is the entire offer: each row is
            something a ticket can include, each column is a ticket, and nothing is folded
            away behind a disclosure.
          </p>
          {data.cancelled && (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Pick a column again whenever you
              are ready.
            </p>
          )}
        </div>
      </section>

      <section className={s.matrixBand}>
        <div className={s.container}>
          {data.tiers.length > 0 ? (
            <Matrix tiers={data.tiers} basePath="/tickets/options/v2" />
          ) : (
            <p className={s.empty}>
              The ticket catalogue could not be read, so there is nothing to compare yet.
            </p>
          )}
        </div>
      </section>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
