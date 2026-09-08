import type { ReactNode } from 'react';
import type { Tier } from '@/lib/tickets';
import { formatPrice } from '@/lib/tickets';
import s from './styles.module.css';

/**
 * ── The inheritance ladder ───────────────────────────────────────────────────
 *
 * Every step states only what it changes from the step before it, so a reader
 * never reads the same benefit twice and the only thing they have to think
 * about is the delta.
 *
 * The deltas are **computed by diffing the tiers' `includes` arrays**, never
 * typed out. The organizer can edit those lists in the dashboard; a hard-coded
 * "what's new" list would go stale silently and the page would start lying
 * about what a $1,199 ticket buys.
 *
 * ── Why the diff is fuzzy rather than exact ─────────────────────────────────
 *
 * Two tiers rarely repeat a benefit word for word. Main Conference says
 * "Community happy hour"; All Access says "VIP community happy hour with the
 * programme committee". An exact-match diff calls the second one *new*, which
 * loses the single most useful fact on the page — that the happy hour you were
 * already getting becomes a better one. So each upper line is matched against
 * the lines below it by token overlap and classified three ways:
 *
 *   same      — the line is repeated (near) verbatim; it is not reprinted
 *   upgraded  — the line below is contained in this one; shown as before → after
 *   new       — nothing below resembles it; shown as an addition
 *
 * ── And why the *dropped* list exists ───────────────────────────────────────
 *
 * KGC's tiers do not form one clean chain. Virtual streams the workshop days;
 * Main Conference does not. A ladder that silently swallowed that would be a
 * ladder that lies about what contains what, which is worse than no ladder at
 * all. So the same matcher is run backwards: any line on the lower tier that
 * nothing on the upper tier matches is printed under "not carried up", worded
 * as the checkable claim it is — one list says this, the other does not.
 *
 * It also earns the opposite statement. When that list comes back empty — as it
 * does for All Access over Main Conference — the page can say "nothing is
 * dropped" and mean it, because it counted.
 */

/**
 * Words carried by almost every benefit line, which would otherwise make
 * unrelated lines look related. "every" and "all" are deliberately *not* here:
 * "every session" versus "every conference session" is a real distinction.
 */
const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'from',
  'your',
  'own',
  'is',
  'it',
  'as',
  'or',
  'including',
  'that',
  'this',
  'their',
  'you',
  'least',
]);

/** Lower-cased content words, with a crude plural stem so `days` ≡ `day`. */
function tokenise(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const stem = raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (stem.length < 2 || STOP.has(stem)) continue;
    out.add(stem);
  }
  return out;
}

interface Candidate {
  item: string;
  /** How much of the *lower* line this upper line restates. */
  coverage: number;
  jaccard: number;
  shared: number;
}

function bestMatch(upper: string, lower: readonly string[]): Candidate | null {
  const u = tokenise(upper);
  let best: Candidate | null = null;
  for (const item of lower) {
    const l = tokenise(item);
    let shared = 0;
    for (const t of l) if (u.has(t)) shared += 1;
    const union = new Set([...u, ...l]).size;
    const cand: Candidate = {
      item,
      shared,
      coverage: l.size ? shared / l.size : 0,
      jaccard: union ? shared / union : 0,
    };
    if (
      !best ||
      cand.coverage > best.coverage ||
      (cand.coverage === best.coverage && cand.jaccard > best.jaccard)
    ) {
      best = cand;
    }
  }
  return best;
}

export type Line =
  | { kind: 'new'; text: string }
  | { kind: 'upgraded'; text: string; from: string }
  | { kind: 'same'; text: string; from: string };

export interface Step {
  added: Line[];
  upgraded: Line[];
  same: Line[];
  /** Lines the tier below lists that nothing on this tier matches. */
  dropped: string[];
}

/** `lower === null` is the ground rung: everything on it is simply itself. */
export function diffTiers(lower: Tier | null, upper: Tier): Step {
  const added: Line[] = [];
  const upgradedLines: Line[] = [];
  const same: Line[] = [];
  const matched = new Set<string>();

  for (const text of upper.includes) {
    const best = lower ? bestMatch(text, lower.includes) : null;
    if (best && best.jaccard >= 0.8) {
      matched.add(best.item);
      same.push({ kind: 'same', text, from: best.item });
    } else if (best && best.coverage >= 0.5 && best.shared >= 2) {
      matched.add(best.item);
      upgradedLines.push({ kind: 'upgraded', text, from: best.item });
    } else {
      added.push({ kind: 'new', text });
    }
  }

  return {
    added,
    upgraded: upgradedLines,
    same,
    dropped: lower ? lower.includes.filter((item) => !matched.has(item)) : [],
  };
}

/** The lines of the top tier that cover a branch tier's lines, for citation. */
export function coveringLines(top: Tier, branch: Tier): string[] {
  const step = diffTiers(branch, top);
  const cited = [...step.same, ...step.upgraded].map((l) => l.text);
  return [...new Set(cited)];
}

function money(t: Tier): string {
  return formatPrice(t.priceCents, t.currency);
}

function Choose({ tier }: { tier: Tier }) {
  if (!tier.onSale) {
    return (
      <p className={s.closed}>
        <span className={s.closedMark} aria-hidden="true" />
        {tier.unavailableReason ?? 'Not on sale'}
      </p>
    );
  }
  return (
    <a className={s.cta} href={`/tickets/options/v3?tier=${encodeURIComponent(tier.id)}#buy`}>
      Take {tier.name} for {money(tier)}
    </a>
  );
}

/**
 * The little segmented bar under a price: one segment per line on the ticket,
 * quiet for what was already yours, bright for what this step puts there.
 * Decorative — the same counts are stated in words beside it.
 */
function Meter({ step }: { step: Step }) {
  const segments = [
    ...step.same.map(() => 'same'),
    ...step.upgraded.map(() => 'up'),
    ...step.added.map(() => 'new'),
  ];
  return (
    <span className={s.meter} aria-hidden="true">
      {segments.map((kind, i) => (
        <i key={i} className={kind === 'new' ? s.mNew : kind === 'up' ? s.mUp : s.mSame} />
      ))}
    </span>
  );
}

function Tally({ step, ground }: { step: Step; ground: boolean }) {
  if (ground) {
    return <p className={s.tally}>{step.added.length} things, listed in full</p>;
  }
  const parts: string[] = [];
  if (step.added.length) parts.push(`adds ${step.added.length}`);
  if (step.upgraded.length) parts.push(`upgrades ${step.upgraded.length}`);
  if (step.same.length) parts.push(`keeps ${step.same.length}`);
  return <p className={s.tally}>{parts.length ? parts.join(', ') : 'no change'}</p>;
}

/**
 * `from` is named on every upgraded line rather than left implicit. "Live
 * streams of every session" *becoming* "every session in the room" is not
 * automatically a gain — you lose the workshop stream — so the page says which
 * ticket the earlier wording belongs to and lets the reader judge the trade.
 */
function Delta({ lines, from }: { lines: Line[]; from?: string }) {
  return (
    <ul className={s.lines}>
      {lines.map((line) =>
        line.kind === 'upgraded' ? (
          <li key={line.text} className={s.upgrade}>
            <span className={s.was}>
              {from ? <span className={s.wasFrom}>On {from}:</span> : null} {line.from}
            </span>
            <span className={s.now}>{line.text}</span>
          </li>
        ) : (
          <li key={line.text} className={s.gain}>
            {line.text}
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * One rung. `previous` is the rung under it on the ladder — the thing this
 * step's whole body is measured against.
 */
export function Rung({
  tier,
  previous,
  level,
  extra,
}: {
  tier: Tier;
  previous: Tier | null;
  level: 'ground' | 'middle' | 'summit';
  extra?: ReactNode;
}) {
  const step = diffTiers(previous, tier);
  const gains = [...step.added, ...step.upgraded];
  const climb = previous ? tier.priceCents - previous.priceCents : 0;

  return (
    <li className={`${s.rail} ${s[level]}`}>
      {previous ? (
        <p className={s.step}>
          <span className={s.stepDelta}>+{formatPrice(climb, tier.currency)}</span>
          <span className={s.stepFrom}>over {previous.name}</span>
        </p>
      ) : null}

      <article className={s.rung} aria-labelledby={`rung-${tier.id}`}>
        <header className={s.head}>
          <span className={s.node} aria-hidden="true" />
          <div className={s.headText}>
            <h2 className={s.name} id={`rung-${tier.id}`}>
              {tier.name}
            </h2>
            {tier.tagline ? <p className={s.tagline}>{tier.tagline}</p> : null}
          </div>
          <div className={s.headPrice}>
            <p className={s.price}>{money(tier)}</p>
            <Meter step={step} />
            <Tally step={step} ground={!previous} />
          </div>
        </header>

        <div className={s.body}>
          {previous ? (
            <>
              {/* "Adds" is only claimed where the step drops nothing. Where it
                  does drop something, the heading says "changes" instead. */}
              <h3 className={s.deltaHead}>
                {gains.length === 0
                  ? `Nothing on this list changes from ${previous.name}`
                  : step.dropped.length > 0
                    ? `What changes from ${previous.name}`
                    : `What this adds to ${previous.name}`}
              </h3>
              {gains.length > 0 ? <Delta lines={gains} from={previous.name} /> : null}
              {step.same.length > 0 ? (
                <p className={s.kept}>
                  <span className={s.keptLabel}>Carried up word for word:</span>{' '}
                  {step.same.map((l) => l.text).join('; ')}.
                </p>
              ) : null}
              {step.dropped.length > 0 ? (
                <div className={s.dropped}>
                  <h4 className={s.droppedHead}>Not carried up</h4>
                  <p className={s.droppedNote}>
                    {previous.name} lists these; {tier.name} does not.
                  </p>
                  <ul className={s.droppedList}>
                    {step.dropped.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className={s.nothingLost}>
                  Every line on {previous.name} is carried up. Nothing is dropped.
                </p>
              )}
            </>
          ) : (
            <>
              <h3 className={s.deltaHead}>The ground floor, in full</h3>
              <Delta lines={step.added} />
            </>
          )}

          {extra}

          <Choose tier={tier} />
        </div>
      </article>
    </li>
  );
}

/**
 * A ticket that is not a rung: it buys a different part of the week rather than
 * a bigger version of the same one, so nothing inherits from it and it inherits
 * from nothing. Drawn hanging off the rail at its own price, deliberately not
 * in the climb.
 */
export function Branch({ tier, top }: { tier: Tier; top: Tier | null }) {
  // Two lines of evidence, not the whole list: the summit rung prints all of it.
  const cited = top ? coveringLines(top, tier).slice(0, 2) : [];
  const gap = top ? top.priceCents - tier.priceCents : 0;

  return (
    <li className={`${s.rail} ${s.branchRail}`}>
      <article className={s.branch} aria-labelledby={`rung-${tier.id}`}>
        <p className={s.branchTag}>Off the ladder</p>
        <header className={s.head}>
          <div className={s.headText}>
            <h2 className={s.name} id={`rung-${tier.id}`}>
              {tier.name}
            </h2>
            {tier.tagline ? <p className={s.tagline}>{tier.tagline}</p> : null}
          </div>
          <div className={s.headPrice}>
            <p className={s.price}>{money(tier)}</p>
          </div>
        </header>
        <div className={s.body}>
          <p className={s.branchWhy}>
            A different part of the week, not a bigger version of the one before it. It has no
            step to state, so here is the whole ticket.
          </p>
          <ul className={s.lines}>
            {tier.includes.map((item) => (
              <li key={item} className={s.gain}>
                {item}
              </li>
            ))}
          </ul>
          {top && gap > 0 && cited.length > 0 ? (
            <p className={s.branchNote}>
              {top.name} costs {formatPrice(gap, tier.currency)} more than this and its own list
              carries {cited.map((c) => `“${c}”`).join(', ')}.
            </p>
          ) : null}
          <Choose tier={tier} />
        </div>
      </article>
    </li>
  );
}

/**
 * The arithmetic of buying the two halves of the week separately, computed from
 * the catalogue rather than typed, and shown only when there is genuinely money
 * in it.
 */
export function Together({ top, second, branch }: { top: Tier; second: Tier; branch: Tier }) {
  const apart = branch.priceCents + second.priceCents;
  if (apart <= top.priceCents) return null;
  // Only claim the two are covered here if the diff says so.
  if (coveringLines(top, branch).length === 0) return null;
  return (
    <dl className={s.sums}>
      <div>
        <dt>
          {branch.name} and {second.name}, bought separately
        </dt>
        <dd>{formatPrice(apart, top.currency)}</dd>
      </div>
      <div>
        <dt>{top.name}, in one ticket</dt>
        <dd>{formatPrice(top.priceCents, top.currency)}</dd>
      </div>
      <div className={s.sumsLast}>
        <dt>Difference</dt>
        <dd>{formatPrice(apart - top.priceCents, top.currency)}</dd>
      </div>
    </dl>
  );
}
