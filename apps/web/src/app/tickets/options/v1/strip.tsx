import type { CSSProperties } from 'react';
import { formatPrice, type Tier } from '@/lib/tickets';
import s from './styles.module.css';
import {
  boughtSeparately,
  conferenceWeek,
  exclusiveLines,
  onlyInPersonAcrossTheWeek,
  runLabel,
  runSentence,
  runsOf,
  tierDays,
  weekHalves,
  type Run,
  type WeekDay,
} from './week';

/**
 * Grid line numbers, twice, as custom properties.
 *
 * The narrow layout has five columns (one per day) and the wide layout has six
 * (a ticket rail, then the five days), so the same bar needs two different
 * placements. An inline `grid-column` would freeze one of them; a pair of
 * variables lets the media query choose.
 */
function spanVars(from: number, to: number, prefix: 'm' | 'd' | 's'): CSSProperties {
  const offset = prefix === 'd' ? 2 : 1;
  return {
    [`--${prefix}-from`]: from + offset,
    [`--${prefix}-to`]: to + offset + 1,
  } as CSSProperties;
}

function bothLayouts(from: number, to: number): CSSProperties {
  return { ...spanVars(from, to, 'm'), ...spanVars(from, to, 'd') };
}

function barClass(tier: Tier, hero: boolean): string {
  const shape = hero
    ? s.barHero
    : !tier.inPerson
      ? s.barVirtual
      : tier.featured
        ? s.barFeatured
        : s.barPlain;
  return `${s.bar} ${shape}${tier.onSale ? '' : ` ${s.barClosed}`}`;
}

function Included({ tier }: { tier: Tier }) {
  if (tier.groups && tier.groups.length > 0) {
    return (
      <div className={s.groups}>
        {tier.groups.map((group) => (
          <div key={group.heading}>
            <h3 className={s.groupHead}>{group.heading}</h3>
            {group.items && group.items.length > 0 && (
              <ul className={s.items}>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={s.groups}>
      <ul className={s.items}>
        {tier.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One ticket, drawn as the days it covers.
 *
 * The rail says what it is and what it costs; the bar says when you are here.
 * Nothing is behind a disclosure — the point of the layout is that the shape of
 * the week does the comparing, so the contents can simply be printed under each
 * bar and read straight down the page.
 */
function TicketRow({
  tier,
  week,
  runs,
  hero,
  separately,
  exclusive,
  spansTheWeek,
  optionHref,
}: {
  tier: Tier;
  week: WeekDay[];
  runs: Run[];
  hero: boolean;
  separately: ReturnType<typeof boughtSeparately>;
  exclusive: string[];
  spansTheWeek: boolean;
  optionHref: string;
}) {
  const from = runs[0].from;
  const to = runs[runs.length - 1].to;

  return (
    <li className={`${s.row}${hero ? ` ${s.rowHero}` : ''}`} style={bothLayouts(from, to)}>
      <article className={s.rail}>
        <h2 className={s.name}>{tier.name}</h2>
        <span className={s.price}>{formatPrice(tier.priceCents, tier.currency)}</span>
        <p className={s.tagline}>{tier.tagline}</p>
        {tier.onSale ? (
          <a
            className={`${s.choose}${hero ? ` ${s.chooseHero}` : ''}`}
            href={`${optionHref}?tier=${tier.id}#buy`}
          >
            Choose {tier.name}
          </a>
        ) : (
          <span className={s.closed}>{tier.unavailableReason ?? 'Not available'}</span>
        )}
      </article>

      <div className={s.ghost} aria-hidden="true" />

      {runs.map((run) => (
        <span
          key={run.from}
          className={barClass(tier, hero)}
          style={bothLayouts(run.from, run.to)}
        >
          <span className={s.barDays} aria-hidden="true">
            {runLabel([run], week)}
          </span>
          <span className={s.srOnly}>{runSentence([run], week)}</span>
          <span className={s.barWhere}>
            {tier.inPerson ? 'in the room' : 'wherever you are'}
          </span>
        </span>
      ))}

      {separately && (
        <div className={s.sep}>
          <div className={s.sepTrack}>
            {separately.parts
              .map((part) => {
                const days = tierDays(part, week);
                const partRuns = days ? runsOf(days) : [{ from: 0, to: week.length - 1 }];
                return {
                  part,
                  start: partRuns[0].from,
                  end: partRuns[partRuns.length - 1].to,
                };
              })
              /* Calendar order, not catalogue order: on the narrow layout the
                 chips are read as a sentence, and Monday comes first. */
              .sort((a, b) => a.start - b.start)
              .map(({ part, start, end }) => (
                <span key={part.id} className={s.sepChip} style={spanVars(start, end, 's')}>
                  <span className={s.sepChipName}>{part.name}</span>
                  <b>{formatPrice(part.priceCents, part.currency)}</b>
                </span>
              ))}
          </div>
          <p className={s.sepNote}>
            Bought as separate tickets, the same days cost{' '}
            <strong>{formatPrice(separately.totalCents, tier.currency)}</strong>. This one is{' '}
            <strong>{formatPrice(tier.priceCents, tier.currency)}</strong>,{' '}
            <span className={s.saving}>
              {formatPrice(separately.savingCents, tier.currency)} less
            </span>
            {spansTheWeek
              ? ', and it is the only ticket that puts you in the room for both halves of the week.'
              : '.'}
          </p>
        </div>
      )}

      <div className={`${s.detail}${separately ? '' : ` ${s.detailOnly}`}`}>
        {exclusive.length > 0 && (
          <p className={s.only}>
            Only on this ticket: <b>{exclusive.join('. ')}</b>.
          </p>
        )}
        <Included tier={tier} />
      </div>
    </li>
  );
}

/**
 * The conference week, with every ticket laid across it.
 *
 * The header is the calendar — two halves, five days — and each ticket below is
 * a bar over the days it buys. Read down a column and you see which tickets are
 * in the building on Tuesday; read across a row and you see what a ticket is.
 * Neither reading needs a click.
 */
export function WeekStrip({ tiers, optionHref }: { tiers: Tier[]; optionHref: string }) {
  const week = conferenceWeek();
  const halves = weekHalves(week);
  const wholeWeek: Run[] = [{ from: 0, to: week.length - 1 }];

  const rows = tiers.map((tier) => {
    const days = tierDays(tier, week);
    const separately = boughtSeparately(tier, tiers, week);
    return {
      tier,
      runs: days ? runsOf(days) : wholeWeek,
      separately,
      spansTheWeek: onlyInPersonAcrossTheWeek(tier, tiers, week, halves),
      exclusive: separately ? exclusiveLines(tier, tiers) : [],
    };
  });

  /* The emphasised ticket is not chosen by hand: it is the one the catalogue
     shows to be cheaper than buying its own days separately. If no ticket
     bundles anything, nothing is emphasised, which is the right answer. */
  const heroId = rows.find((r) => r.separately)?.tier.id;

  return (
    <div className={s.strip}>
      <div className={`${s.weekHead} ${s.headHalves}`}>
        <div className={s.headRail}>The week</div>
        {halves.map((half) => (
          <div key={half.label} className={s.half} style={bothLayouts(half.from, half.to)}>
            {half.label}
          </div>
        ))}
      </div>
      <div className={s.weekHead}>
        <div className={s.headRail} />
        {week.map((day) => (
          <div key={day.key} className={s.day}>
            <span className={s.dayName}>{day.short}</span>
            <span className={s.dayDate}>{day.date}</span>
          </div>
        ))}
      </div>

      <ol className={s.rows}>
        {rows.map((row) => (
          <TicketRow
            key={row.tier.id}
            tier={row.tier}
            week={week}
            runs={row.runs}
            hero={row.tier.id === heroId}
            separately={row.separately}
            exclusive={row.exclusive}
            spansTheWeek={row.spansTheWeek}
            optionHref={optionHref}
          />
        ))}
      </ol>
    </div>
  );
}
