import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { formatPrice, type Tier } from '@/lib/tickets';
import { SITE } from '@/lib/site';
import { CopyPitch } from './copy-pitch';
import { DAYS, covers, coversWholeWeek, dayState, situation, tierText } from './coverage';
import s from './styles.module.css';

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. These are layout options for the tickets page and read the same catalogue, so a stale price would be a stale price here too. */
export const dynamic = 'force-dynamic';

const HREF = (id: string) => `/tickets/options/v9?tier=${encodeURIComponent(id)}#buy`;

/* ── The week strip ───────────────────────────────────────────────────────────
 *
 * The one drawing on this page, and it carries the argument: five days, lit for
 * the days a ticket actually covers. It is the reason the page does not need a
 * comparison table — you can see that one ticket fills the week and the others
 * fill part of it, in the same shape, in a glance.
 */
function WeekStrip({ tier, tone }: { tier: Tier; tone: 'dark' | 'light' }) {
  const c = covers(tier);
  if (!c.workshops && !c.conference) return null;
  const stateClass = { in: s.dayIn, stream: s.dayStream, off: s.dayOff } as const;
  const stateWords = {
    in: 'included, in person',
    stream: 'included, streamed',
    off: 'not included',
  } as const;
  return (
    <div className={`${s.strip} ${tone === 'dark' ? s.stripDark : s.stripLight}`}>
      <ul className={s.days} aria-label={`Days covered by ${tier.name}`}>
        {DAYS.map((d) => {
          const st = dayState(tier, d.half);
          return (
            <li key={d.label} className={`${s.day} ${stateClass[st]}`}>
              <span className={s.dayName} aria-hidden="true">
                {d.label}
              </span>
              <span className={s.srOnly}>{`${d.long}: ${stateWords[st]}`}</span>
            </li>
          );
        })}
      </ul>
      <div className={s.halves} aria-hidden="true">
        <span className={`${s.halfLabel} ${s.halfWorkshops} ${c.workshops ? '' : s.halfMuted}`}>
          Workshops
        </span>
        <span className={`${s.halfLabel} ${s.halfConference} ${c.conference ? '' : s.halfMuted}`}>
          Conference
        </span>
      </div>
      {tier.inPerson ? null : <p className={s.stripNote}>Streamed, not in the room.</p>}
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);

  /* The week ticket: the dearest in-person tier that covers both halves. Chosen,
     not hard-coded, so a fifth ticket cannot leave the page pointing at the
     wrong hero. */
  const wholeWeek = data.tiers.filter((t) => t.inPerson && coversWholeWeek(t));
  const hero =
    [...wholeWeek].sort((a, b) => b.priceCents - a.priceCents)[0] ??
    data.tiers.find((t) => t.featured) ??
    data.tiers[0];

  const cancelledNotice = data.cancelled ? (
    <p className={s.cancelled} role="status">
      Checkout was cancelled and nothing was charged. Pick up wherever you left off.
    </p>
  ) : null;

  if (!hero) {
    return (
      <OptionChrome
        n={9}
        name="One ticket, then the exceptions"
        note="the week ticket is the page; the other three are a signposted section under it"
      >
        <section className={s.hero}>
          <div className={s.shell}>
            {cancelledNotice}
            <h1 className={s.h1}>
              One ticket for the whole of {SITE.shortName} {SITE.year}
            </h1>
            <p className={s.lede}>
              {SITE.name} runs {SITE.datesLong} at {SITE.venueShort}. Prices are not published
              yet.
            </p>
          </div>
        </section>
        <BuyBand data={data} />
        <AfterBands />
      </OptionChrome>
    );
  }

  const others = data.tiers.filter((t) => t.id !== hero.id);
  const heroPrice = formatPrice(hero.priceCents, hero.currency);
  const heroCovers = covers(hero);
  const heroWholeWeek = heroCovers.workshops && heroCovers.conference;
  const onlyWholeWeek = heroWholeWeek && wholeWeek.length === 1;

  /* The two halves sold on their own, and what they come to together. Computed,
     never typed: if the organizer reprices Workshops tomorrow this sentence
     changes with it or disappears. */
  const workshopsOnly = others.find(
    (t) => t.inPerson && covers(t).workshops && !covers(t).conference,
  );
  const conferenceOnly = others.find(
    (t) => t.inPerson && covers(t).conference && !covers(t).workshops,
  );
  const separateCents =
    workshopsOnly && conferenceOnly && heroWholeWeek
      ? workshopsOnly.priceCents + conferenceOnly.priceCents
      : null;
  const savingCents =
    separateCents !== null && separateCents > hero.priceCents
      ? separateCents - hero.priceCents
      : null;
  const separateText = separateCents !== null ? formatPrice(separateCents, hero.currency) : null;
  const savingText = savingCents !== null ? formatPrice(savingCents, hero.currency) : null;

  /* The lines of the hero ticket that outlive the week itself — the ones an
     approver cares about, because they are what comes back to the team. */
  const heroText = tierText(hero);
  const takeaways = hero.includes.filter((line) => /recording|video library/i.test(line));
  const remote = others.find((t) => !t.inPerson);

  const pitchLines: string[] = [
    `Subject: Attending ${SITE.name}`,
    '',
    `I would like to attend ${SITE.name} at ${SITE.venueShort}, ${SITE.datesLong}.`,
    '',
    heroWholeWeek
      ? `The ticket is ${hero.name}, ${heroPrice}. It covers the whole week: workshops on ${SITE.workshopDays}, and the conference itself, ${SITE.conferenceDays}.`
      : `The ticket is ${hero.name}, ${heroPrice}. ${hero.tagline}`,
  ];
  if (separateText && savingText && workshopsOnly && conferenceOnly) {
    pitchLines.push(
      '',
      `Bought as two separate tickets, ${workshopsOnly.name} at ${formatPrice(workshopsOnly.priceCents, workshopsOnly.currency)} and ${conferenceOnly.name} at ${formatPrice(conferenceOnly.priceCents, conferenceOnly.currency)}, the same five days come to ${separateText}, so the single ticket is ${savingText} less.`,
    );
  }
  if (takeaways.length > 0) {
    pitchLines.push(
      '',
      'It also includes, for the team as much as for me:',
      ...takeaways.map((line) => `- ${line}`),
    );
  }
  const pitch = pitchLines.join('\n');

  return (
    <OptionChrome
      n={9}
      name="One ticket, then the exceptions"
      note="the week ticket is the page; the other three are a signposted section under it"
    >
      {/* ─── The ticket ─────────────────────────────────────────────────── */}
      <section className={s.hero}>
        <div className={s.shell}>
          {cancelledNotice}
          <h1 className={s.h1}>
            One ticket for the whole of {SITE.shortName} {SITE.year}
          </h1>
          <p className={s.lede}>
            {SITE.name} runs {SITE.datesLong} at {SITE.venueShort}: two days of workshops, three
            days of conference, every session recorded. {hero.name} is the ticket for that week. The
            other{' '}
            {others.length === 1 ? 'ticket is' : `${others.length} tickets are`} further down, in
            full, for the situations where the whole week is not what you need.
          </p>
          {others.length > 0 ? (
            <p className={s.heroJump}>
              <a href="#other" className={s.jumpLink}>
                Skip to the {others.length === 1 ? 'other ticket' : `other ${others.length} tickets`}
              </a>
            </p>
          ) : null}

          <article className={s.ticket} aria-labelledby="hero-name">
            <WeekStrip tier={hero} tone="dark" />

            <div className={s.ticketBody}>
              <div className={s.ticketBuy}>
                <h2 className={s.ticketName} id="hero-name">
                  {hero.name}
                </h2>
                <p className={s.ticketTagline}>{hero.tagline}</p>
                <p className={s.price}>
                  <span className={s.priceFigure}>{heroPrice}</span>
                  <span className={s.priceUnit}>for all five days</span>
                </p>

                {hero.onSale ? (
                  <a className={s.buy} href={HREF(hero.id)}>
                    Take the {hero.name} ticket
                  </a>
                ) : (
                  <p className={s.closed}>
                    <strong>Not on sale.</strong>{' '}
                    {hero.unavailableReason ?? 'This ticket is closed for now.'}
                  </p>
                )}

                {separateText && savingText && workshopsOnly && conferenceOnly ? (
                  <p className={s.arithmetic}>
                    The two halves sold separately,{' '}
                    <b>
                      {workshopsOnly.name}{' '}
                      {formatPrice(workshopsOnly.priceCents, workshopsOnly.currency)}
                    </b>{' '}
                    and{' '}
                    <b>
                      {conferenceOnly.name}{' '}
                      {formatPrice(conferenceOnly.priceCents, conferenceOnly.currency)}
                    </b>{' '}
                    come to <b>{separateText}</b> for the same five days. This one is {savingText}{' '}
                    less.
                  </p>
                ) : null}

                {onlyWholeWeek ? (
                  <p className={s.onlyOne}>
                    It is the only ticket that carries both halves of the week.
                  </p>
                ) : null}
              </div>

              <div className={s.ticketWhat}>
                {hero.groups?.length ? (
                  hero.groups.map((g) => (
                    <div key={g.heading} className={s.group}>
                      <h3 className={s.groupHeading}>{g.heading}</h3>
                      {g.items?.length ? (
                        <ul className={s.groupList}>
                          {g.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className={s.group}>
                    <h3 className={s.groupHeading}>What it covers</h3>
                    <ul className={s.groupList}>
                      {hero.includes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* ─── The room the single ticket buys back ───────────────────────── */}
      <section className={s.approval}>
        <div className={s.shell}>
          <h2 className={s.h2}>What to tell whoever is paying</h2>
          <p className={s.sectionLede}>
            Most of the people reading this page will have to ask someone else for the money. Here
            is the note, written out of what is actually in the ticket. No adjectives, and every
            figure on it is a price from this page.
          </p>

          <div className={s.approvalGrid}>
            <div className={s.note}>
              <pre className={s.noteText}>{pitch}</pre>
              <CopyPitch text={pitch} className={s.copy} />
            </div>

            <dl className={s.objections}>
              {takeaways.length > 0 ? (
                <div className={s.objection}>
                  <dt>&ldquo;Can we send one person and share it?&rdquo;</dt>
                  <dd>
                    Yes. What comes back is the sessions themselves rather than a summary of them,
                    because the ticket carries:
                    <ul className={s.ddList}>
                      {takeaways.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}

              {separateText && savingText ? (
                <div className={s.objection}>
                  <dt>&ldquo;Why not the cheaper ticket?&rdquo;</dt>
                  <dd>
                    The cheaper in-person tickets are each half of the week. Bought together they
                    are {separateText}; the week ticket is {heroPrice}. If only one half is needed,
                    say so. The half tickets are real tickets and they are listed below.
                  </dd>
                </div>
              ) : null}

              {remote ? (
                <div className={s.objection}>
                  <dt>&ldquo;What if travel is not approved?&rdquo;</dt>
                  <dd>
                    {remote.name} is {formatPrice(remote.priceCents, remote.currency)} and carries
                    every session live and on demand. <a href="#other">It is in the list below.</a>
                  </dd>
                </div>
              ) : null}

              {/recording/i.test(heroText) ? null : (
                <div className={s.objection}>
                  <dt>&ldquo;What do we get out of it?&rdquo;</dt>
                  <dd>{hero.includes.join('. ')}.</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </section>

      {/* ─── The exceptions ─────────────────────────────────────────────── */}
      {others.length > 0 ? (
        <section className={s.other} id="other">
          <div className={s.shell}>
            <h2 className={s.h2}>
              {others.length === 1 ? 'The other ticket' : `The other ${others.length} tickets`}
            </h2>
            <p className={s.sectionLede}>
              Each of these is for a particular situation, and each is complete. The full contents
              are here, not behind a link. If one of them describes you, buy it; nothing on this
              page is trying to talk you out of it.
            </p>

            <ul className={s.exList}>
              {others.map((tier) => (
                <li key={tier.id}>
                  <article className={s.ex} aria-labelledby={`ex-${tier.id}`}>
                    <div className={s.exHead}>
                      <p className={s.exSituation}>{situation(tier)}</p>
                      <h3 className={s.exName} id={`ex-${tier.id}`}>
                        {tier.name}
                      </h3>
                      <p className={s.exPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>
                      <p className={s.exTagline}>{tier.tagline}</p>
                      {tier.onSale ? (
                        <a className={s.exBuy} href={HREF(tier.id)}>
                          Take {tier.name}
                        </a>
                      ) : (
                        <p className={s.exClosed}>
                          <strong>Not on sale.</strong>{' '}
                          {tier.unavailableReason ?? 'This ticket is closed for now.'}
                        </p>
                      )}
                    </div>
                    <div className={s.exBody}>
                      <WeekStrip tier={tier} tone="light" />
                      <ul className={s.exIncludes}>
                        {tier.includes.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
