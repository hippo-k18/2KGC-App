import { SITE } from '@/lib/site';
import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { WeekStrip } from './strip';
import s from './styles.module.css';

export const dynamic = 'force-dynamic';

const HREF = '/tickets/options/v1';

/**
 * Option 1 — the week strip.
 *
 * The other way to lay out a price list is as four columns of increasing
 * status, which asks the visitor a question they cannot answer: how important
 * am I? This page asks the one they can. The conference is five days with a
 * seam down the middle — workshops Monday and Tuesday, the conference Wednesday
 * to Friday — so the week itself is drawn once, at the top, and every ticket is
 * a bar across the days it buys. Choosing a ticket becomes choosing a span of
 * days, which is a diary question, and everybody already knows their diary.
 *
 * All Access wins the page by being the widest bar, and then by arithmetic that
 * comes out of the catalogue rather than out of a marketing meeting: the two
 * tickets that would cover the same five days add up to more than it costs, and
 * the difference is printed under the bar with the two ghost tickets drawn in
 * their own day columns, so the sum is visible rather than asserted. No badge,
 * no timer, no seat count — none of those are in the data, so none of them are
 * on the page.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);

  return (
    <OptionChrome
      n={1}
      name="The week strip"
      note="the conference calendar is the chooser: a ticket is a span of days, not a rank"
    >
      <section className={s.page}>
        <div className={s.inner}>
          <h1 className={s.h1}>Which days are you coming?</h1>
          <p className={s.lede}>
            {SITE.name} runs {SITE.datesLong} at {SITE.venueShort}. Workshops open the week and
            the conference closes it, so a ticket is really just an answer to{' '}
            <b>which days you want</b>. Here is the week, with each ticket drawn across the days
            it covers.
          </p>

          {data.cancelled && (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Pick your days again below.
            </p>
          )}

          {data.tiers.length > 0 && <WeekStrip tiers={data.tiers} optionHref={HREF} />}

          <p className={s.foot}>
            Prices are per person, in US dollars, before tax. If you are not sure which days you
            need, write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> before
            you buy.
          </p>
        </div>
      </section>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
