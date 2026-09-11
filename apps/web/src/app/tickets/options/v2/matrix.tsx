import type { Tier } from '@/lib/tickets';
import { formatPrice } from '@/lib/tickets';
import { SITE } from '@/lib/site';
import s from './styles.module.css';

/**
 * ── Why the rows are derived rather than typed out ──────────────────────────
 *
 * The rows below are the *comparable capabilities* a ticket may carry. Each one
 * owns a regular expression that claims the lines a tier lists in its own
 * words, and a resolver that turns those lines into one of three states. That
 * indirection buys two things the hard-coded alternative cannot:
 *
 *  1. A fifth tier created in the organizer dashboard lands in the matrix with
 *     real marks, because the marks are read off its copy rather than off a
 *     table somebody forgot to update.
 *  2. Nothing a tier says can silently vanish. Every line a row claims is
 *     accounted for; whatever is left over is printed verbatim in the last row.
 *     That is the failure mode of Snowflake Summit's matrix — the cheap tier's
 *     exclusions living in prose underneath — closed by construction.
 *
 * The third state matters more than the other two. "Included, with a limit" is
 * where the honest differences live: Main Conference's recordings are the
 * conference sessions only, Virtual's replays expire. A two-state matrix would
 * have to round both of those to a tick or a dash, and either is a lie.
 */

type CellState = 'yes' | 'limited' | 'no';

interface Cell {
  state: CellState;
  /** The tier's own qualifying words, when it has some. Never invented. */
  note?: string;
}

interface RowSpec {
  key: string;
  label: string;
  /** Lines from a tier's list that this row speaks for. */
  claims: RegExp;
  resolve: (tier: Tier, claimed: string[]) => Cell;
}

/**
 * A tier's contents as flat lines. Grouped tiers carry the same items under
 * headings; a heading with no items *is* the item ("KGC Video Library
 * Subscription (3 months)"), so it counts, and a heading with items is
 * structural, so it does not.
 */
function lines(tier: Tier): string[] {
  if (tier.groups?.length) {
    return tier.groups.flatMap((g) => (g.items?.length ? g.items : [g.heading]));
  }
  return tier.includes;
}

/** The line that *is* the workshop row, as opposed to the ones that qualify it. */
const WORKSHOP_CORE = /workshop (day|session)|in-person workshop/i;

const ROW_GROUPS: { heading: string; rows: RowSpec[] }[] = [
  {
    heading: `In the room, ${SITE.venueShort}`,
    rows: [
      {
        key: 'workshop-days',
        label: 'Both workshop days, Monday and Tuesday',
        claims: /workshop|instructor-led|\blabs?\b|materials|datasets/i,
        resolve(tier, claimed) {
          if (!tier.inPerson) return { state: 'no' };
          const core = claimed.filter((l) => WORKSHOP_CORE.test(l));
          if (core.length === 0) return { state: 'no' };
          const extra = claimed.filter((l) => !WORKSHOP_CORE.test(l));
          return { state: 'yes', note: extra.length ? extra.join('. ') : undefined };
        },
      },
      {
        key: 'conference-days',
        label: 'Every conference session, Wednesday to Friday',
        claims: /conference session|in-person session/i,
        resolve(tier, claimed) {
          if (!tier.inPerson) return { state: 'no' };
          const inRoom = claimed.filter(
            (l) => !/stream|on[- ]demand|recording|replay|virtual/i.test(l),
          );
          return inRoom.length ? { state: 'yes' } : { state: 'no' };
        },
      },
      {
        key: 'happy-hour',
        label: 'Community happy hour',
        claims: /happy hour/i,
        resolve: (_tier, claimed) => (claimed.length ? { state: 'yes' } : { state: 'no' }),
      },
      {
        key: 'committee-hour',
        label: 'VIP happy hour with the programme committee',
        claims: /programme committee|program committee/i,
        resolve: (_tier, claimed) => (claimed.length ? { state: 'yes' } : { state: 'no' }),
      },
      {
        key: 'evenings',
        label: 'Evening networking events, and the Friday watch party',
        claims: /evening networking|watch party/i,
        resolve(_tier, claimed) {
          if (!claimed.length) return { state: 'no' };
          const text = claimed.join(' ');
          const both = /evening networking/i.test(text) && /watch party/i.test(text);
          return both ? { state: 'yes' } : { state: 'limited', note: claimed.join('. ') };
        },
      },
    ],
  },
  {
    heading: 'From wherever you are',
    rows: [
      {
        key: 'live-streams',
        label: 'Live streams of every session, as it happens',
        claims: /live stream/i,
        resolve(_tier, claimed) {
          if (!claimed.length) return { state: 'no' };
          const every = claimed.some((l) => /every/i.test(l));
          return every ? { state: 'yes' } : { state: 'limited', note: claimed.join('. ') };
        },
      },
      {
        key: 'recordings',
        label: 'Recordings to watch on demand',
        claims: /recording|on[- ]demand|replay/i,
        resolve(_tier, claimed) {
          if (!claimed.length) return { state: 'no' };
          const whole = claimed.some((l) => /recordings? of every session/i.test(l));
          return whole ? { state: 'yes' } : { state: 'limited', note: claimed.join('. ') };
        },
      },
    ],
  },
  {
    heading: 'After the week',
    rows: [
      {
        key: 'video-library',
        label: 'KGC Video Library subscription',
        claims: /video library/i,
        resolve(_tier, claimed) {
          if (!claimed.length) return { state: 'no' };
          const term = claimed.map((l) => /\(([^)]+)\)/.exec(l)?.[1]).find(Boolean);
          return { state: 'yes', note: term };
        },
      },
    ],
  },
];

const ALL_ROWS = ROW_GROUPS.flatMap((g) => g.rows);

function cellsFor(tier: Tier): Map<string, Cell> {
  const own = lines(tier);
  return new Map(
    ALL_ROWS.map((row) => [row.key, row.resolve(tier, own.filter((l) => row.claims.test(l)))]),
  );
}

/** Whatever the tier lists that no ticked row already speaks for. */
function leftovers(tier: Tier, cells: Map<string, Cell>): string[] {
  const spokenFor = new Set<string>();
  const own = lines(tier);
  for (const row of ALL_ROWS) {
    if (cells.get(row.key)?.state === 'no') continue;
    for (const line of own) if (row.claims.test(line)) spokenFor.add(line);
  }
  return own.filter((l) => !spokenFor.has(l));
}

/**
 * The two cheaper in-person tickets that between them cover the most rows, and
 * what they cost together.
 *
 * Only in-person tiers are candidates, because buying two tickets to the same
 * conference is only a real alternative when both of them get you through the
 * door — the week splits into workshop days and conference days, and that is
 * the split somebody is actually weighing. Nothing here is asserted unless the
 * arithmetic comes out that way: if the pair is cheaper than the whole-week
 * ticket, the note does not render.
 */
function bundleArithmetic(tiers: Tier[], top: Tier, grid: Map<string, Map<string, Cell>>) {
  const parts = tiers.filter((t) => t.id !== top.id && t.inPerson && t.onSale);
  let best: { a: Tier; b: Tier; sum: number; covered: Set<string> } | null = null;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      const covered = new Set(
        ALL_ROWS.filter(
          (r) =>
            grid.get(a.id)?.get(r.key)?.state !== 'no' || grid.get(b.id)?.get(r.key)?.state !== 'no',
        ).map((r) => r.key),
      );
      const sum = a.priceCents + b.priceCents;
      const better =
        !best ||
        covered.size > best.covered.size ||
        (covered.size === best.covered.size && sum < best.sum);
      if (better) best = { a, b, sum, covered };
    }
  }
  if (!best || best.sum <= top.priceCents) return null;
  const pair = [best.a, best.b].sort((x, y) => y.priceCents - x.priceCents);
  return {
    pair,
    sum: best.sum,
    difference: best.sum - top.priceCents,
    missing: ALL_ROWS.filter((r) => !best.covered.has(r.key)),
  };
}

/**
 * A row label dropped into running prose. Only the first letter is lowered,
 * and only when the first word is not an acronym — "VIP happy hour" must not
 * become "vip happy hour".
 */
function inSentence(label: string): string {
  const first = label.split(' ')[0];
  if (first.length > 1 && first === first.toUpperCase()) return label;
  return first.charAt(0).toLowerCase() + label.slice(1);
}

/** "a", "a and b", "a, b and c" — never a trailing "and" on its own. */
function joiner(index: number, total: number): string {
  if (index === 0) return '';
  return index === total - 1 ? ' and ' : ', ';
}

const STATE_LABEL: Record<CellState, string> = {
  yes: 'Included',
  limited: 'Included, with a limit',
  no: 'Not included',
};

const STATE_CLASS: Record<CellState, string> = {
  yes: s.markYes,
  limited: s.markLimited,
  no: s.markNo,
};

function Glyph({ state }: { state: CellState }) {
  return (
    <svg className={s.glyph} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {state === 'yes' && (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path
            d="M5.7 10.4 8.7 13.3 14.4 7.1"
            fill="none"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === 'limited' && (
        <>
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M10 2 A8 8 0 0 0 10 18 Z" fill="currentColor" />
        </>
      )}
      {state === 'no' && (
        <path d="M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function Mark({ cell }: { cell: Cell }) {
  return (
    <>
      <span className={`${s.mark} ${STATE_CLASS[cell.state]}`}>
        <Glyph state={cell.state} />
        <span className={s.srOnly}>{STATE_LABEL[cell.state]}</span>
      </span>
      {cell.note && <span className={s.cellNote}>{cell.note}</span>}
    </>
  );
}

export function Matrix({ tiers, basePath }: { tiers: Tier[]; basePath: string }) {
  const grid = new Map(tiers.map((t) => [t.id, cellsFor(t)]));

  /**
   * The highlight is a fact, not a recommendation: the column that is ticked on
   * every single row. If two tiers manage it, or none do, nothing is
   * highlighted — a border that means "we would like you to buy this" is the
   * thing every conference site does and the thing nobody believes.
   */
  const complete = tiers.filter((t) =>
    ALL_ROWS.every((r) => grid.get(t.id)?.get(r.key)?.state === 'yes'),
  );
  const lead = complete.length === 1 ? complete[0] : null;
  const arithmetic = lead ? bundleArithmetic(tiers, lead, grid) : null;

  const columnClass = (t: Tier) =>
    [s.col, t.id === lead?.id ? s.colLead : '', t.onSale ? '' : s.colClosed]
      .filter(Boolean)
      .join(' ');

  const anyLeftovers = tiers.some((t) => leftovers(t, grid.get(t.id)!).length > 0);

  return (
    <>
      <div className={s.tableHead}>
        <h2 className={s.h2} id="matrix-heading">
          What each ticket includes
        </h2>
        <ul className={s.legend}>
          {(['yes', 'limited', 'no'] as CellState[]).map((state) => (
            <li key={state}>
              <span className={`${s.mark} ${STATE_CLASS[state]}`}>
                <Glyph state={state} />
              </span>
              {STATE_LABEL[state]}
            </li>
          ))}
        </ul>
      </div>

      <p className={s.scrollHint}>Scroll the table sideways to reach every ticket.</p>

      <div
        className={s.scroller}
        role="region"
        aria-labelledby="matrix-heading"
        tabIndex={0}
      >
        <table className={s.matrix}>
          <caption className={s.srOnly}>
            Every row is something a ticket can include; every column is a ticket. Each cell is
            marked included, included with a limit, or not included.
          </caption>
          <thead>
            <tr>
              <td className={s.corner} />
              {tiers.map((t) => (
                <th key={t.id} scope="col" className={`${columnClass(t)} ${s.tierHead}`}>
                  <span className={s.tierName}>{t.name}</span>
                  <span className={s.tierPrice}>{formatPrice(t.priceCents, t.currency)}</span>
                  <span className={s.tierTagline}>{t.tagline}</span>
                  {t.id === lead?.id && (
                    <span className={s.tierFlag}>Ticked on every row below</span>
                  )}
                  {!t.onSale && (
                    <span className={s.tierClosed}>{t.unavailableReason ?? 'Not on sale.'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {ROW_GROUPS.map((group) => (
            <tbody key={group.heading}>
              <tr className={s.groupRow}>
                <th scope="colgroup" colSpan={tiers.length + 1} className={s.groupCell}>
                  <span className={s.groupLabel}>{group.heading}</span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.key} className={s.row}>
                  <th scope="row" className={s.rowLabel}>
                    {row.label}
                  </th>
                  {tiers.map((t) => {
                    const cell = grid.get(t.id)!.get(row.key)!;
                    return (
                      <td key={t.id} className={`${columnClass(t)} ${s.cell}`}>
                        <Mark cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}

          {anyLeftovers && (
            <tbody>
              <tr className={s.groupRow}>
                <th scope="colgroup" colSpan={tiers.length + 1} className={s.groupCell}>
                  <span className={s.groupLabel}>The rest of what this ticket says</span>
                </th>
              </tr>
              <tr className={s.row}>
                <th scope="row" className={s.rowLabel}>
                  Anything the rows above do not cover
                </th>
                {tiers.map((t) => {
                  const rest = leftovers(t, grid.get(t.id)!);
                  return (
                    <td key={t.id} className={`${columnClass(t)} ${s.cell} ${s.cellRest}`}>
                      {rest.length ? (
                        <ul className={s.restList}>
                          {rest.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <>
                          <span aria-hidden="true" className={s.restNone}>
                            &mdash;
                          </span>
                          <span className={s.srOnly}>Nothing beyond the rows above.</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          )}

          <tfoot>
            <tr>
              <th scope="row" className={`${s.rowLabel} ${s.footLabel}`}>
                Take this one
              </th>
              {tiers.map((t) => (
                <td key={t.id} className={`${columnClass(t)} ${s.cell} ${s.footCell}`}>
                  {t.onSale ? (
                    <a
                      className={`${s.cta} ${t.id === lead?.id ? s.ctaLead : ''}`}
                      href={`${basePath}?tier=${encodeURIComponent(t.id)}#buy`}
                    >
                      Choose {t.name}
                    </a>
                  ) : (
                    <span className={s.ctaOff}>Not on sale</span>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {arithmetic && lead && (
        <p className={s.arithmetic}>
          The two tickets that come nearest to it are separate purchases:{' '}
          {arithmetic.pair.map((t, i) => (
            <span key={t.id}>
              {joiner(i, arithmetic.pair.length)}
              <strong>{t.name}</strong> at {formatPrice(t.priceCents, t.currency)}
            </span>
          ))}
          , which is {formatPrice(arithmetic.sum, arithmetic.pair[0].currency)},{' '}
          {formatPrice(arithmetic.difference, lead.currency)} more than {lead.name}
          {arithmetic.missing.length > 0 && (
            <>
              , and between them they still leave{' '}
              {arithmetic.missing.map((r, i) => (
                <span key={r.key}>
                  {joiner(i, arithmetic.missing.length)}
                  <em>{inSentence(r.label)}</em>
                </span>
              ))}{' '}
              unticked
            </>
          )}
          .
        </p>
      )}
    </>
  );
}
