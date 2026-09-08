import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import s from './styles.module.css';

export const dynamic = 'force-dynamic';

/**
 * Option 6 — "Two questions".
 *
 * The page does not lay four tickets out and ask the reader to compare them.
 * It asks where they will be and which part of the week they want, and the two
 * answers resolve to exactly one ticket, shown in full. Every answer is a link
 * that sets a search param, so the whole thing is server-rendered, keyboard
 * operable and correct with JavaScript off.
 *
 * The router archetype's known failure is hiding options somebody wanted to
 * compare, so `?view=all` is one always-visible click away and carries the
 * answers with it, and going back restores them.
 */

type Where = 'nyc' | 'online';
type Part = 'workshops' | 'conference' | 'all';

const WHERE_VALUES = ['nyc', 'online'] as const;
const PART_VALUES = ['workshops', 'conference', 'all'] as const;

const BASE = '/tickets/options/v6';

/** Link back into this page, carrying whichever answers are already given. */
function href(
  params: { where?: Where; part?: Part; view?: 'all'; tier?: string },
  hash = '',
): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const qs = q.toString();
  return `${BASE}${qs ? `?${qs}` : ''}${hash}`;
}

/**
 * What a tier covers, read out of its own copy rather than out of its id.
 *
 * The organizer can add a fifth ticket from the dashboard, so the router has to
 * work from the words the catalogue actually carries. A tier that talks about
 * workshops covers the Monday and Tuesday half; one that talks about the
 * conference covers Wednesday to Friday; one that talks about both is the whole
 * week. Nothing here assumes an id or a price.
 */
function tierProse(t: Tier): string {
  const grouped = (t.groups ?? []).flatMap((g) => [g.heading, ...(g.items ?? [])]);
  return [t.name, t.tagline, ...t.includes, ...grouped].join(' ').toLowerCase();
}

function partOf(t: Tier): Part | null {
  const prose = tierProse(t);
  const workshops = prose.includes('workshop');
  const conference = prose.includes('conference');
  if (workshops && conference) return 'all';
  if (workshops) return 'workshops';
  if (conference) return 'conference';
  return null;
}

function cheapest(list: Tier[]): Tier | undefined {
  return list.reduce<Tier | undefined>(
    (best, t) => (!best || t.priceCents < best.priceCents ? t : best),
    undefined,
  );
}

/**
 * The one honest piece of arithmetic on the page: the two halves of the week
 * bought separately against the ticket that covers both. Computed from the
 * catalogue, so it is right after a price change and absent if it stops being
 * true.
 */
function bundleMaths(tiers: Tier[]) {
  const room = tiers.filter((t) => t.inPerson);
  const workshops = cheapest(room.filter((t) => partOf(t) === 'workshops'));
  const conference = cheapest(room.filter((t) => partOf(t) === 'conference'));
  const whole = cheapest(room.filter((t) => partOf(t) === 'all'));
  if (!workshops || !conference || !whole) return null;
  if (workshops.currency !== whole.currency || conference.currency !== whole.currency) return null;
  const separate = workshops.priceCents + conference.priceCents;
  const saving = separate - whole.priceCents;
  if (saving <= 0) return null;
  return {
    workshops,
    conference,
    whole,
    separate: formatPrice(separate, whole.currency),
    saving: formatPrice(saving, whole.currency),
  };
}

const PART_COPY: Record<Part, { title: string; days: string }> = {
  workshops: { title: 'Just the workshop days', days: SITE.workshopDays },
  conference: { title: 'Just the conference', days: SITE.conferenceDays },
  all: { title: 'All of it', days: 'Monday to Friday, workshops and conference' },
};

function daysFor(t: Tier): string {
  const part = partOf(t);
  return part ? PART_COPY[part].days : 'See what is included';
}

/* ────────────────────────────────────────────────────────────────────────── */

function Included({ tier }: { tier: Tier }) {
  if (tier.groups?.length) {
    return (
      <div className={s.groups}>
        {tier.groups.map((group) => (
          <div key={group.heading} className={s.group}>
            <h3>{group.heading}</h3>
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
    <ul className={s.items}>
      {tier.includes.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Choose({
  tier,
  where,
  part,
  view,
}: {
  tier: Tier;
  where?: Where;
  part?: Part;
  view?: 'all';
}) {
  if (!tier.onSale) {
    return (
      <p className={s.closed}>
        <strong>Not available.</strong> {tier.unavailableReason ?? 'This ticket is closed.'}
      </p>
    );
  }
  return (
    <p className={s.ctaRow}>
      <a className={s.cta} href={href({ where, part, view, tier: tier.id }, '#buy')}>
        Choose {tier.name}
      </a>
      <span className={s.ctaNote}>Fills in the form further down this page.</span>
    </p>
  );
}

/** The resolved ticket, in full: price, everything in it, and the button. */
function Verdict({
  tier,
  where,
  part,
  maths,
}: {
  tier: Tier;
  where?: Where;
  part?: Part;
  maths: ReturnType<typeof bundleMaths>;
}) {
  const covers = partOf(tier);
  const missing =
    maths && covers === 'workshops'
      ? maths.conference
      : maths && covers === 'conference'
        ? maths.workshops
        : null;

  return (
    <article className={s.result}>
      <div className={s.resultHead}>
        <h2>{tier.name}</h2>
        <p className={s.price}>{formatPrice(tier.priceCents, tier.currency)}</p>
        <p className={s.resultTag}>{tier.tagline}</p>
      </div>
      <div className={s.resultBody}>
        <Included tier={tier} />
        <Choose tier={tier} where={where} part={part} />

        {maths && missing ? (
          <div className={s.aside}>
            <p>
              The other half of the week is the {missing.name} ticket, at{' '}
              {formatPrice(missing.priceCents, missing.currency)}. Bought separately the two come
              to {maths.separate}.
            </p>
            <p>
              {maths.whole.name} covers both for{' '}
              {formatPrice(maths.whole.priceCents, maths.whole.currency)} — {maths.saving} less.{' '}
              <a href={href({ where, part: 'all' })}>Change my answer to all of it</a>
            </p>
          </div>
        ) : null}

        {maths && covers === 'all' && tier.id === maths.whole.id ? (
          <div className={s.aside}>
            <p>
              The same week as two tickets — {maths.workshops.name} at{' '}
              {formatPrice(maths.workshops.priceCents, maths.workshops.currency)} and{' '}
              {maths.conference.name} at{' '}
              {formatPrice(maths.conference.priceCents, maths.conference.currency)} — is{' '}
              {maths.separate}. This is {maths.saving} less, for the same five days.
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/* ── The escape hatch: all tickets, plainly, answers kept ─────────────────── */

function AllTickets({ tiers, where, part }: { tiers: Tier[]; where?: Where; part?: Part }) {
  return (
    <div className={s.all}>
      <h2 className={s.allTitle}>All {tiers.length} tickets</h2>
      <p className={s.hint}>
        No questions, nothing folded away.{' '}
        <a href={href({ where, part })}>Back to the two questions</a> — your answers are still
        there.
      </p>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <caption className={s.caption}>Every attendee ticket for {SITE.name}.</caption>
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              <th scope="col">Price</th>
              <th scope="col">Which days</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.id}>
                <th scope="row">{tier.name}</th>
                <td className={s.num}>
                  {formatPrice(tier.priceCents, tier.currency)}
                  {tier.onSale ? null : (
                    <span className={s.rowClosed}>
                      {tier.unavailableReason ?? 'Not available'}
                    </span>
                  )}
                </td>
                <td>{daysFor(tier)}</td>
                <td>{tier.inPerson ? SITE.venueShort : 'Online, wherever you are'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol className={s.allList}>
        {tiers.map((tier) => (
          <li key={tier.id}>
            <article>
              <h3 className={s.allName}>
                {tier.name}
                <span className={s.allPrice}>{formatPrice(tier.priceCents, tier.currency)}</span>
              </h3>
              <p className={s.allTag}>{tier.tagline}</p>
              <Included tier={tier} />
              <Choose tier={tier} where={where} part={part} view="all" />
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    tier?: string;
    cancelled?: string;
    where?: string;
    part?: string;
    view?: string;
  }>;
}) {
  const params = await searchParams;
  const data = await loadOptionData(params);

  const where = WHERE_VALUES.find((w) => w === params.where);
  const part = PART_VALUES.find((p) => p === params.part);
  const view = params.view === 'all' ? ('all' as const) : undefined;

  const tiers = data.tiers;
  const maths = bundleMaths(tiers);

  /* Everything that fits the first answer. */
  const pool = where ? tiers.filter((t) => (where === 'nyc' ? t.inPerson : !t.inPerson)) : [];

  /* Which second answers exist for that pool, and what each one lands on. */
  const options = PART_VALUES.map((value) => ({
    value,
    matches: pool.filter((t) => partOf(t) === value),
  })).filter((o) => o.matches.length > 0);

  /* One ticket in the pool means the second question has nothing to ask. */
  const settledByFirst = pool.length === 1;
  const resolved = settledByFirst
    ? pool
    : part
      ? (options.find((o) => o.value === part)?.matches ?? [])
      : [];
  const answeredPart = settledByFirst ? undefined : part;

  const roomPrice = cheapest(tiers.filter((t) => t.inPerson));
  const onlinePrice = cheapest(tiers.filter((t) => !t.inPerson));

  return (
    <OptionChrome
      n={6}
      name="Two questions"
      note="two answers resolve to one ticket; all four stay one click away"
    >
      <section className={s.page}>
        <div className={s.wrap}>
          <header className={s.head}>
            <h1 className={s.h1}>Let’s work out which ticket you need.</h1>
            <p className={s.lede}>
              Two questions narrow {tiers.length} tickets down to one. {SITE.name} runs{' '}
              {SITE.datesLong} at{' '}
              {SITE.venueShort}: workshops {SITE.workshopDays}, the conference{' '}
              {SITE.conferenceDays}.
            </p>
          </header>

          {data.cancelled ? (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Your ticket is still here whenever you
              want it.
            </p>
          ) : null}

          {tiers.length === 0 ? (
            <p className={s.hint}>
              There is nothing to choose between yet — ticket sales for {SITE.name} have not opened.
            </p>
          ) : view === 'all' ? (
            <AllTickets tiers={tiers} where={where} part={answeredPart} />
          ) : (
            <>
              <ol className={s.thread}>
                {/* ── Question one ─────────────────────────────────────── */}
                <li className={where ? s.stepDone : s.step}>
                  {where ? (
                    <p className={s.answered}>
                      <span className={s.answerLabel}>
                        {where === 'nyc' ? 'Coming to New York' : 'Joining online'}
                      </span>
                      <a className={s.change} href={href({ part: answeredPart })}>
                        Change
                      </a>
                    </p>
                  ) : (
                    <>
                      <h2 className={s.q}>Are you coming to New York, or joining online?</h2>
                      <p className={s.hint}>
                        Start here. It rules out most of the {tiers.length} tickets on its own.
                      </p>
                      <div className={s.choices}>
                        <a className={s.choice} href={href({ where: 'nyc' })}>
                          <span className={s.choiceLabel}>I’ll be there in person</span>
                          <span className={s.choicePrice}>
                            {roomPrice
                              ? `From ${formatPrice(roomPrice.priceCents, roomPrice.currency)}`
                              : ''}
                          </span>
                          <span className={s.choiceWhen}>{SITE.venueShort}</span>
                        </a>
                        <a className={s.choice} href={href({ where: 'online' })}>
                          <span className={s.choiceLabel}>I’m joining online</span>
                          <span className={s.choicePrice}>
                            {onlinePrice
                              ? formatPrice(onlinePrice.priceCents, onlinePrice.currency)
                              : ''}
                          </span>
                          <span className={s.choiceWhen}>
                            Live, then on demand, in your own time zone
                          </span>
                        </a>
                      </div>
                    </>
                  )}
                </li>

                {/* ── Question two ─────────────────────────────────────── */}
                {where && !settledByFirst ? (
                  <li className={part ? s.stepDone : s.step}>
                    {part && resolved.length > 0 ? (
                      <p className={s.answered}>
                        <span className={s.answerLabel}>{PART_COPY[part].title}</span>
                        <a className={s.change} href={href({ where })}>
                          Change
                        </a>
                      </p>
                    ) : (
                      <>
                        <h2 className={s.q}>Which part of the week?</h2>
                        <p className={s.hint}>
                          {pool.length} of the {tiers.length} tickets are still in play.
                        </p>
                        <div className={s.choices}>
                          {options.map((option) => {
                            const lands = cheapest(option.matches)!;
                            const saving =
                              option.value === 'all' && maths && lands.id === maths.whole.id
                                ? `${maths.saving} less than the two halves bought separately`
                                : null;
                            return (
                              <a
                                key={option.value}
                                className={saving ? s.choiceKey : s.choice}
                                href={href({ where, part: option.value })}
                              >
                                <span className={s.choiceLabel}>{PART_COPY[option.value].title}</span>
                                <span className={s.choicePrice}>
                                  {formatPrice(lands.priceCents, lands.currency)}
                                </span>
                                <span className={s.choiceWhen}>{PART_COPY[option.value].days}</span>
                                <span className={s.choiceTicket}>
                                  {option.matches.length === 1
                                    ? lands.name
                                    : `${option.matches.length} tickets`}
                                </span>
                                {saving ? <span className={s.choiceNote}>{saving}</span> : null}
                              </a>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </li>
                ) : null}

                {/* ── The answer ───────────────────────────────────────── */}
                {resolved.length > 0 ? (
                  <li className={s.stepLast}>
                    <p className={s.verdict}>
                      {resolved.length === 1
                        ? settledByFirst
                          ? 'There is one online ticket, and it covers the whole week.'
                          : 'Then this is your ticket.'
                        : `${resolved.length} tickets fit that answer.`}
                    </p>
                    {resolved.map((tier) => (
                      <Verdict
                        key={tier.id}
                        tier={tier}
                        where={where}
                        part={answeredPart}
                        maths={maths}
                      />
                    ))}
                  </li>
                ) : where && !settledByFirst && part ? (
                  <li className={s.stepLast}>
                    <p className={s.verdict}>No ticket matches that combination.</p>
                    <p className={s.hint}>
                      <a href={href({ where, view: 'all' })}>Look at all {tiers.length} tickets</a>{' '}
                      instead.
                    </p>
                  </li>
                ) : null}
              </ol>

              <p className={s.escape}>
                Would you rather just see them all?{' '}
                <a href={href({ where, part: answeredPart, view: 'all' })}>
                  Show me all {tiers.length} tickets
                </a>{' '}
                — the answers you have given are kept.
              </p>
            </>
          )}
        </div>
      </section>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
