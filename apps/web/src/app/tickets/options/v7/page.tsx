import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import s from './styles.module.css';

export const dynamic = 'force-dynamic';

/**
 * Option 7 — grouped by what you are buying.
 *
 * Every section is headed by the thing it covers *and* the days that thing
 * runs, so the heading does the explaining and the body can stay short. A
 * reader who skims four headings — the whole week, the conference, the
 * workshops, from anywhere — already knows which section is theirs.
 *
 * The one place this design spends its ink is the saving on the week. Smashing
 * Conference, whose page this borrows its structure from, hides a real €100–200
 * bundle discount in italics inside a collapsed line item, so nothing on the
 * page sells the best ticket. Here the arithmetic is a receipt at the top of
 * the first section: the two halves of the week, their sum, the week's own
 * price, and the difference. All four numbers are computed from the catalogue,
 * so if the organizer re-prices anything the claim follows or disappears.
 */

/*
 * "Monday 3 – Friday 7 May", composed from the two halves rather than typed,
 * so the week cannot disagree with the days printed on the sections below it.
 */
const WEEK_OPENS = (SITE.workshopDays.split('–').at(0) ?? SITE.workshopDays).trim();
const WEEK_CLOSES = (SITE.conferenceDays.split('–').at(-1) ?? SITE.conferenceDays).trim();
const WHOLE_WEEK = `${WEEK_OPENS} – ${WEEK_CLOSES}`;

/**
 * What each ticket is *for*, and when that runs. This is the one piece of copy
 * the design adds: it is a heading about coverage, not a restatement of the
 * catalogue, which supplies every name, price and bullet on the page.
 *
 * Keyed by tier id and not exhaustive on purpose — a fifth ticket added in the
 * dashboard falls through to `sectionFor` and still gets a section.
 */
const SECTION_COPY: Record<string, { label: string; when: string }> = {
  'all-access': { label: 'The whole week', when: WHOLE_WEEK },
  'main-conference': { label: 'The conference', when: SITE.conferenceDays },
  workshops: { label: 'The workshops', when: SITE.workshopDays },
  virtual: { label: 'From anywhere', when: `${WHOLE_WEEK}, online` },
};

function sectionFor(tier: Tier): { label: string; when: string } {
  return (
    SECTION_COPY[tier.id] ?? {
      label: tier.name,
      when: tier.inPerson ? WHOLE_WEEK : `${WHOLE_WEEK}, online`,
    }
  );
}

/** Firestore ids are slugs, but an anchor is not the place to find out. */
const anchor = (id: string) => `t-${id.replace(/[^a-zA-Z0-9-]+/g, '-')}`;

/** Every line a tier promises, whether it is grouped or a flat list. */
function lines(tier: Tier): string[] {
  if (!tier.groups?.length) return tier.includes;
  return tier.groups.flatMap((g) => (g.items?.length ? g.items : [g.heading]));
}

/**
 * The week bought in two halves, priced against the week bought whole.
 *
 * Deliberately narrow: it needs the two named half-week tiers, in the same
 * currency as the top tier, adding up to more than it costs. If the catalogue
 * is ever restructured so that stops being true, the receipt does not render —
 * a comparison that quietly goes stale is worse than no comparison.
 */
function weekSaving(tiers: Tier[]) {
  const top = tiers[0];
  if (!top) return null;
  const parts = ['main-conference', 'workshops']
    .map((id) => tiers.find((t) => t.id === id))
    .filter((t): t is Tier => t !== undefined && t.id !== top.id);
  if (parts.length < 2) return null;
  if (parts.some((p) => p.currency !== top.currency)) return null;
  const separately = parts.reduce((n, p) => n + p.priceCents, 0);
  if (separately <= top.priceCents) return null;
  return { top, parts, separately, saving: separately - top.priceCents };
}

/**
 * The single promise the top ticket makes that no other ticket makes. Read out
 * of the catalogue and checked against every other tier, so it is never a claim
 * the data does not support.
 */
function onlyOnTopTicket(tiers: Tier[]): string | null {
  const top = tiers[0];
  if (!top) return null;
  const mark = /programme committee/i;
  const line = lines(top).find((l) => mark.test(l));
  if (!line) return null;
  const elsewhere = tiers.some((t) => t.id !== top.id && lines(t).some((l) => mark.test(l)));
  return elsewhere ? null : line;
}

function Includes({ tier, dark }: { tier: Tier; dark?: boolean }) {
  const list = (items: string[]) => (
    <ul className={s.items}>
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );

  if (!tier.groups?.length) return list(tier.includes);

  return (
    <div className={s.groups}>
      {tier.groups.map((g) => (
        <div key={g.heading} className={s.group}>
          <h4 className={dark ? `${s.groupHeading} ${s.groupHeadingDark}` : s.groupHeading}>
            {g.heading}
          </h4>
          {g.items?.length ? list(g.items) : null}
        </div>
      ))}
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);
  const { tiers } = data;
  const saving = weekSaving(tiers);
  const exclusive = onlyOnTopTicket(tiers);

  return (
    <OptionChrome
      n={7}
      name="Grouped by what you're buying"
      note="Four sections, each headed by what it covers and the days it runs; the week's saving is a receipt, not a footnote."
    >
      <div className={s.page}>
        <div className={s.shell}>
          <header className={s.head}>
            <h1 className={s.h1}>Buy the week, or buy a part of it</h1>
            <p className={s.lede}>
              {SITE.datesLong} at {SITE.venueShort}. Four sections, each headed by what it covers
              and the days it runs, from the whole week down to one strand of it.
            </p>
            {data.cancelled && (
              <p className={s.cancelled}>
                Checkout was cancelled and nothing was charged. Choose again below.
              </p>
            )}
          </header>

          {tiers.length > 0 && (
            <nav className={s.contents} aria-label="The tickets on this page">
              <ul>
                {tiers.map((t) => {
                  const sec = sectionFor(t);
                  return (
                    <li key={t.id}>
                      <a href={`#${anchor(t.id)}`}>
                        <span className={s.contentsText}>
                          <span className={s.contentsLabel}>{sec.label}</span>
                          <span className={s.contentsWhen}>{sec.when}</span>
                        </span>
                        <span className={s.leader} aria-hidden="true" />
                        <span className={s.contentsPrice}>
                          {formatPrice(t.priceCents, t.currency)}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}

          {tiers.map((tier, i) => {
            const sec = sectionFor(tier);
            const lead = i === 0;
            const receipt = lead && saving && saving.top.id === tier.id ? saving : null;
            return (
              <section
                key={tier.id}
                id={anchor(tier.id)}
                className={lead ? `${s.section} ${s.sectionLead}` : s.section}
                aria-labelledby={`${anchor(tier.id)}-h`}
              >
                <div className={s.rail}>
                  <h2 className={s.h2} id={`${anchor(tier.id)}-h`}>
                    <span className={s.label}>{sec.label}</span>
                    <span className={s.when}>{sec.when}</span>
                  </h2>
                </div>

                <div className={lead ? `${s.body} ${s.bodyLead}` : s.body}>
                  <div className={s.tierHead}>
                    <div>
                      <h3 className={s.tierName}>{tier.name}</h3>
                      <p className={s.tagline}>{tier.tagline}</p>
                    </div>
                    <p className={s.price}>{formatPrice(tier.priceCents, tier.currency)}</p>
                  </div>

                  {receipt && (
                    <div className={s.receiptBox}>
                      <div className={s.receiptScroll}>
                        <table className={s.receipt}>
                          <caption className={s.receiptCaption}>
                            The same five days, bought two ways
                          </caption>
                          <tbody>
                            {receipt.parts.map((p) => (
                              <tr key={p.id}>
                                <th scope="row">{p.name}</th>
                                <td>{formatPrice(p.priceCents, p.currency)}</td>
                              </tr>
                            ))}
                            <tr className={s.sumRow}>
                              <th scope="row">Bought separately</th>
                              <td>{formatPrice(receipt.separately, receipt.top.currency)}</td>
                            </tr>
                            <tr className={s.oursRow}>
                              <th scope="row">{receipt.top.name}</th>
                              <td>
                                {formatPrice(receipt.top.priceCents, receipt.top.currency)}
                              </td>
                            </tr>
                          </tbody>
                          <tfoot>
                            <tr className={s.savingRow}>
                              <th scope="row">You save</th>
                              <td>{formatPrice(receipt.saving, receipt.top.currency)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      {exclusive && (
                        <p className={s.exclusive}>
                          <strong>Only on this ticket:</strong> {exclusive}. The two half-week
                          tickets bought together cost more and still leave it out.
                        </p>
                      )}
                    </div>
                  )}

                  <Includes tier={tier} dark={lead} />

                  {tier.onSale ? (
                    <a
                      className={lead ? `${s.cta} ${s.ctaLead}` : s.cta}
                      href={`/tickets/options/v7?tier=${tier.id}#buy`}
                    >
                      Choose {tier.name}
                    </a>
                  ) : (
                    <p className={s.closed}>
                      <strong>Not available.</strong>{' '}
                      {tier.unavailableReason ?? 'This ticket is not on sale.'}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
