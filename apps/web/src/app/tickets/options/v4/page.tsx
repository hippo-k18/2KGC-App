import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import { bundleMaths, contents, daysCovered, nextCheapest, notIn, spell } from './derive';
import { ExpandAll } from './expand-all';
import s from './styles.module.css';

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. These are layout options for the tickets page and read the same catalogue, so a stale price would be a stale price here too. */
export const dynamic = 'force-dynamic';

const GRID_ID = 'v4-tickets';

/**
 * Option 4 — honest disclosure cards.
 *
 * The page this replaces put all four tiers behind four identically worded
 * "What's included" disclosures, so a shut page said nothing and comparing two
 * tickets cost four clicks. The disclosure is not the problem; the *summary* was.
 *
 * So the cards keep `<details>` — it needs no JavaScript, the browser's own
 * find-in-page reaches inside it, Enter and Space open it, and it prints
 * expanded — and spend their effort on the four lines above it. Each shut card
 * states the days it covers, whether those days are in the room or on a screen,
 * how many things are inside, and the first thing it has that the next cheapest
 * ticket does not. Those lines are computed in `derive.ts` from the catalogue,
 * so they cannot drift away from the list they summarise, and they differ from
 * card to card because the underlying tickets do.
 *
 * The cards also sit in one grid row aligned to the top, so opening one moves
 * nothing else on the page; for the reader who wants everything at once there
 * is a single control that opens all of them.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);
  const tiers = data.tiers;
  const top = tiers.reduce<Tier | null>(
    (best, tier) => (!best || tier.priceCents > best.priceCents ? tier : best),
    null,
  );

  return (
    <OptionChrome
      n={4}
      name="Honest disclosure cards"
      note="the shut card already answers the question; the disclosure is only for the detail"
    >
      <section className={s.page}>
        <div className={s.inner}>
          <header className={s.masthead}>
            <h1 className={s.h1}>
              How much of the week
              <br />
              do you want?
            </h1>
            <p className={s.deck}>
              {SITE.name} runs {SITE.datesLong} at {SITE.venueShort}. Workshops open the week on
              Monday and Tuesday; the conference itself runs Wednesday to Friday. Every card
              below says what it covers, what it costs and how many things are in it before you
              open anything.
            </p>
            {data.cancelled ? (
              <p className={s.cancelled} role="status">
                Checkout was cancelled and nothing was charged. Pick a ticket again whenever you
                are ready.
              </p>
            ) : null}
          </header>

          <div className={s.controlRow}>
            <h2 className={s.h2}>
              {tiers.length > 0 ? `The ${spell(tiers.length)} tickets` : 'Tickets'}
            </h2>
            <ExpandAll targetId={GRID_ID} className={s.expandAll} />
          </div>

          {tiers.length === 0 ? (
            <p className={s.empty}>
              The ticket catalogue is not published yet. Everything else on this page is current.
            </p>
          ) : (
            <ul className={s.grid} id={GRID_ID}>
              {tiers.map((tier) => (
                <TicketCard key={tier.id} tier={tier} all={tiers} isTop={tier.id === top?.id} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}

function TicketCard({ tier, all, isTop }: { tier: Tier; all: Tier[]; isTop: boolean }) {
  const items = contents(tier);
  const days = daysCovered(tier);
  const cheaper = nextCheapest(tier, all);
  const stepUp = cheaper ? notIn(tier, [cheaper])[0] : undefined;
  const bundle = isTop ? bundleMaths(tier, all) : null;
  const streamed = items.some((line) => /stream|recording|on[- ]demand|replay/i.test(line));
  const price = formatPrice(tier.priceCents, tier.currency);

  return (
    <li className={isTop ? `${s.card} ${s.cardTop}` : s.card}>
      <article className={s.cardInner}>
        <header className={s.head}>
          <h3 className={s.name}>{tier.name}</h3>
          <p className={s.price}>{price}</p>
          <p className={s.tagline}>{tier.tagline}</p>
        </header>

        <dl className={s.spine}>
          {days ? (
            <div className={s.row}>
              <dt>Days</dt>
              <dd>
                {days.label} <span className={s.sub}>{spell(days.indices.length)} days</span>
              </dd>
            </div>
          ) : null}
          <div className={s.row}>
            <dt>Where</dt>
            <dd>
              {tier.inPerson
                ? streamed
                  ? 'In the room, and on screen'
                  : 'In the room only'
                : 'On screen only'}
            </dd>
          </div>
          <div className={s.row}>
            <dt>Inside</dt>
            <dd>
              <span className={s.pips} aria-hidden="true">
                {items.map((item) => (
                  <i key={item} />
                ))}
              </span>{' '}
              {spell(items.length)} things
            </dd>
          </div>
          {stepUp && cheaper ? (
            <div className={s.row}>
              <dt>Not in {cheaper.name}</dt>
              <dd className={s.stepUp}>{stepUp}</dd>
            </div>
          ) : (
            <div className={s.row}>
              <dt>Entry price</dt>
              <dd>Nothing on this page costs less.</dd>
            </div>
          )}
        </dl>

        {bundle ? <Ledger tier={tier} bundle={bundle} price={price} /> : null}

        <details className={s.disclosure}>
          <summary className={s.summary}>
            <span className={s.caret} aria-hidden="true" />
            <span className={s.whenShut}>Show all {spell(items.length)}</span>
            <span className={s.whenOpen}>Hide the list</span>
          </summary>
          <div className={s.body}>
            {tier.groups?.length ? (
              tier.groups.map((group) =>
                group.items?.length ? (
                  <div key={group.heading} className={s.group}>
                    <h4 className={s.groupHeading}>{group.heading}</h4>
                    <ul className={s.list}>
                      {group.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div key={group.heading} className={s.group}>
                    <ul className={s.list}>
                      <li>{group.heading}</li>
                    </ul>
                  </div>
                ),
              )
            ) : (
              <ul className={s.list}>
                {tier.includes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </details>

        {tier.onSale ? (
          <a className={s.choose} href={`/tickets/options/v4?tier=${tier.id}#buy`}>
            Choose {tier.name}
          </a>
        ) : (
          <p className={s.closed}>
            <strong>Not on sale.</strong>{' '}
            {tier.unavailableReason ?? 'This ticket is closed for now.'}
          </p>
        )}
      </article>
    </li>
  );
}

/**
 * The arithmetic that argues for the top ticket, with no adjectives in it.
 *
 * Two tickets that cover the same five days cost more than the one that covers
 * all five, and the one that covers all five still has things neither of them
 * lists. Both halves are computed; if the catalogue ever stops making that
 * true, this block stops rendering rather than being edited.
 */
function Ledger({
  tier,
  bundle,
  price,
}: {
  tier: Tier;
  bundle: NonNullable<ReturnType<typeof bundleMaths>>;
  price: string;
}) {
  return (
    <div className={s.ledger}>
      <table className={s.sums}>
        <caption className={s.sumsCaption}>The same days, bought as two tickets</caption>
        <tbody>
          {bundle.parts.map((part) => (
            <tr key={part.id}>
              <th scope="row">{part.name}</th>
              <td>{formatPrice(part.priceCents, part.currency)}</td>
            </tr>
          ))}
          <tr className={s.sumsTotal}>
            <th scope="row">Those two together</th>
            <td>{formatPrice(bundle.sumCents, tier.currency)}</td>
          </tr>
          <tr className={s.sumsThis}>
            <th scope="row">{tier.name}</th>
            <td>{price}</td>
          </tr>
        </tbody>
      </table>
      <p className={s.saving}>
        <strong>{formatPrice(bundle.savingCents, tier.currency)} less</strong> than the two
        tickets it replaces
        {bundle.extras.length > 0 ? (
          <>
            {' '}
            and it still lists {spell(bundle.extras.length)}{' '}
            {bundle.extras.length === 1 ? 'thing' : 'things'} neither of them does:
          </>
        ) : (
          '.'
        )}
      </p>
      {bundle.extras.length > 0 ? (
        <ul className={s.extras}>
          {bundle.extras.map((extra) => (
            <li key={extra}>{extra}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
