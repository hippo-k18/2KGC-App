import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import { reckon, splitPrice, type Reckoning } from './reckoning';
import s from './styles.module.css';

export const dynamic = 'force-dynamic';

/**
 * Option 10 — the ledger.
 *
 * No cards, no panels, no shadows, no chips. One typographic price list: names
 * flush left, figures flush right in tabular numerals, hairlines between the
 * entries, and a reckoning at the foot that sets the cost of buying the week in
 * pieces against the cost of buying it whole. The arithmetic is the argument;
 * every figure in it is computed from the catalogue at render time.
 */

/** A money amount, set as a hanging currency mark plus a column of figures. */
function Amount({
  cents,
  currency,
  op,
  className,
}: {
  cents: number;
  currency: string;
  op?: string;
  className?: string;
}) {
  const { symbol, figure } = splitPrice(cents, currency);
  return (
    <span className={className ? `${s.amount} ${className}` : s.amount}>
      <span className={s.op} aria-hidden="true">
        {op ?? ''}
      </span>
      <span className={s.sym}>{symbol}</span>
      <span className={s.fig}>{figure}</span>
    </span>
  );
}

function Inclusions({ tier }: { tier: Tier }) {
  if (tier.groups?.length) {
    return (
      <div className={s.groups}>
        {tier.groups.map((group) => (
          <div className={s.group} key={group.heading}>
            <h3 className={s.groupHeading}>{group.heading}</h3>
            {group.items?.length ? (
              <ul className={s.items}>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <ul className={`${s.items} ${s.itemsWide}`}>
      {tier.includes.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Entry({
  tier,
  lead,
  reckoning,
}: {
  tier: Tier;
  lead: boolean;
  reckoning: Reckoning | null;
}) {
  const href = `/tickets/options/v10?tier=${encodeURIComponent(tier.id)}#buy`;
  return (
    <li className={lead ? `${s.entry} ${s.entryLead}` : s.entry}>
      <div className={s.head}>
        <h2 className={s.name}>{tier.name}</h2>
        <p className={s.figures}>
          <span className={s.vh}>Price </span>
          <Amount cents={tier.priceCents} currency={tier.currency} className={s.price} />
          <span className={s.where}>{tier.inPerson ? 'in person' : 'online'}</span>
        </p>
      </div>

      <p className={s.tagline}>{tier.tagline}</p>

      {lead && reckoning ? (
        <p className={s.leadNote}>
          {formatPrice(reckoning.differenceCents, reckoning.currency)} less than{' '}
          {reckoning.parts.map((p) => p.name).join(' and ')} bought as two tickets, and the only
          entry here that covers the whole week.
        </p>
      ) : null}

      <Inclusions tier={tier} />

      <p className={s.act}>
        {tier.onSale ? (
          <a className={lead ? `${s.choose} ${s.chooseLead}` : s.choose} href={href}>
            Choose {tier.name}
          </a>
        ) : (
          <span className={s.closed}>
            {tier.unavailableReason ?? 'Not on sale at the moment.'}
          </span>
        )}
      </p>
    </li>
  );
}

function Ledger({ reckoning }: { reckoning: Reckoning }) {
  const { combined, parts, separateCents, differenceCents, currency, steps } = reckoning;
  return (
    <section className={s.reckoning} aria-labelledby="reckoning-title">
      <h2 className={s.reckoningTitle} id="reckoning-title">
        The reckoning
      </h2>

      <table className={s.sums}>
        <caption className={s.vh}>
          {parts.map((p) => p.name).join(' plus ')} bought separately, set against{' '}
          {combined.name} bought as one ticket.
        </caption>
        <tbody>
          {parts.map((part, i) => (
            <tr key={part.id}>
              <th scope="row">{part.name}</th>
              <td>
                <Amount
                  cents={part.priceCents}
                  currency={part.currency}
                  op={i === 0 ? undefined : '+'}
                />
              </td>
            </tr>
          ))}
          <tr className={s.subtotal}>
            <th scope="row">Bought separately</th>
            <td>
              <Amount cents={separateCents} currency={currency} />
            </td>
          </tr>
          <tr className={s.deduct}>
            <th scope="row">Less {combined.name}, one ticket</th>
            <td>
              <Amount cents={combined.priceCents} currency={combined.currency} op={'−'} />
            </td>
          </tr>
          <tr className={s.total}>
            <th scope="row">In your favour</th>
            <td>
              <Amount cents={differenceCents} currency={currency} />
            </td>
          </tr>
        </tbody>
      </table>

      <p className={s.reckoningNote}>
        {combined.name} carries both of those lines and costs{' '}
        {formatPrice(differenceCents, currency)} less than the two of them together. Workshops run{' '}
        {SITE.workshopDays}; the conference runs {SITE.conferenceDays}.
      </p>

      {steps.length > 0 ? (
        <ul className={s.steps}>
          {steps.map((step) => (
            <li key={step.from.id}>
              <span className={s.stepFrom}>From {step.from.name}</span>
              <span className={s.stepBody}>
                {formatPrice(step.extraCents, currency)} more buys {combined.name} — which adds{' '}
                {step.adds.name}, {formatPrice(step.adds.priceCents, step.adds.currency)} on its
                own.
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);
  const reckoning = reckon(data.tiers);

  return (
    <OptionChrome
      n={10}
      name="The ledger"
      note="a typographic price list; the arithmetic does the persuading"
    >
      <section className={s.sheet}>
        <div className={s.measure}>
          <header className={s.masthead}>
            <h1 className={s.h1}>Ticket prices</h1>
            <p className={s.dek}>
              {SITE.name}, {SITE.datesLong}, {SITE.venueShort}. Workshops {SITE.workshopDays};
              the conference {SITE.conferenceDays}.
            </p>
          </header>

          {data.cancelled ? (
            <p className={s.cancelled}>
              That checkout was cancelled and nothing was charged. The prices below are
              unchanged.
            </p>
          ) : null}

          {data.tiers.length > 0 ? (
            <>
              <div className={s.colHead} aria-hidden="true">
                <span>
                  {data.tiers.length} tickets, one price each
                  {reckoning ? ', and one that is the sum of two others' : ''}
                </span>
                <span>Price</span>
              </div>

              <ol className={s.list}>
                {data.tiers.map((tier) => (
                  <Entry
                    key={tier.id}
                    tier={tier}
                    lead={reckoning?.combined.id === tier.id}
                    reckoning={reckoning}
                  />
                ))}
              </ol>

              {reckoning ? <Ledger reckoning={reckoning} /> : null}
            </>
          ) : (
            <p className={s.dek}>
              The catalogue is empty, so there is nothing to price yet. Everything below is
              current.
            </p>
          )}
        </div>
      </section>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
