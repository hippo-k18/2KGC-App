import { Fragment } from 'react';
import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { Chooser } from './chooser';
import { buildModel } from './model';
import s from './styles.module.css';

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. These are layout options for the tickets page and read the same catalogue, so a stale price would be a stale price here too. */
export const dynamic = 'force-dynamic';

const BASE = '/tickets/options/v5';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);
  const model = buildModel(data.tiers, data.preselected, BASE);

  return (
    <OptionChrome
      n={5}
      name="Selectable rows with a live summary"
      note="the panel beside the rows prices the choice you have not made yet"
    >
      <section className={s.head}>
        <div className={s.headInner}>
          <h1 className={s.h1}>Pick a ticket, and see what the other one would cost you</h1>
          <p className={s.lede}>
            {SITE.name}, {SITE.datesLong}, {SITE.venueShort}. Choose a row; the panel keeps a
            running summary of what you have chosen, and of what moving up would add, and what
            it would cost.
          </p>
          {data.cancelled && (
            <p className={s.cancelled}>
              That checkout was cancelled and nothing was charged. Your ticket is still selected
              below.
            </p>
          )}
        </div>
      </section>

      <section className={s.choose}>
        <div className={s.chooseInner}>
          {model.rows.length > 0 ? (
            <Chooser model={model} basePath={BASE} />
          ) : (
            <p className={s.lede}>
              Ticket prices are not available at the moment. Everything below is still current.
            </p>
          )}
        </div>
      </section>

      {/*
       * `BuyBand` is rendered exactly as shipped, but keyed on the selected
       * tier. The shared `CheckoutForm` seeds a `useState` from `initialTier`,
       * so a soft navigation that only changes `?tier=` would update the prop
       * and leave the picker on the old ticket. Changing the key remounts it,
       * which is what a full page load does anyway — so the checkout agrees
       * with the panel whether or not JavaScript ran.
       */}
      <Fragment key={data.preselected}>
        <BuyBand data={data} />
      </Fragment>
      <AfterBands />
    </OptionChrome>
  );
}
