import Link from 'next/link';
import { formatPrice, type Tier } from '@/lib/tickets';

/**
 * One ticket tier, as a card you can open.
 *
 * ── What this replaced, and why ─────────────────────────────────────────────
 *
 * Two layouts for the same object. The tickets page drew its two flagship tiers
 * as wide centred panels — one navy, one pale, every bullet on show — and then
 * drew whatever was left as a second band of narrower cards on a dark ground,
 * under a second heading and a second lede. Four tickets meant two headings,
 * two ledes, two footnotes and two different card designs, and the narrow ones
 * came out as a column of centred text about 240px wide: the ragged, pinched
 * look of prose that has been centred and then squeezed.
 *
 * One card, one grid, four tiers. The comparison is the page.
 *
 * ── Why the contents are behind a disclosure ────────────────────────────────
 *
 * Because they are not the decision. A buyer picks a tier on name, price and
 * one line of scope; the eleven bullets under "All In-person Sessions" are what
 * they read *after* narrowing to two. Fully expanded, the four tiers ran past
 * three screens and pushed the actual purchase form below the fold on a laptop.
 * Collapsed, all four prices and every call to action sit in one view.
 *
 * `<details>` rather than a `useState` toggle: it is a server component with no
 * hydration cost, it opens on Enter and Space without any work, it is findable
 * by the browser's own in-page search, and it prints expanded.
 *
 * ── Why every collapsed card is exactly as tall as every other ──────────────
 *
 * `.tier-card-line` reserves two lines whether the tagline fills them or not,
 * so the rule, the disclosure and the button land on the same baseline across
 * the row without stretching the cards to match the tallest. That matters once
 * one is open: with equal heights forced by the grid, opening the tier with the
 * longest list would grow all four and leave three of them padded with empty
 * space.
 */
export function TierCard({ tier, href }: { tier: Tier; href: string }) {
  /*
   * The live site groups the flagship tiers' contents under headings and leaves
   * the lighter ones as a flat list. Both shapes render here; a single unnamed
   * group prints its items without a heading, because "Includes" written above
   * a list inside a panel already labelled "What's included" is the same word
   * twice.
   */
  const groups = tier.groups ?? [{ heading: '', items: [...tier.includes] }];
  const named = groups.length > 1 || Boolean(groups[0]?.heading);

  return (
    <article
      className={`tier-card${tier.featured ? ' is-featured' : ''}${
        tier.onSale ? '' : ' is-closed'
      }`}
    >
      <h3 className="tier-card-name">{tier.name}</h3>
      <p className="tier-card-price">{formatPrice(tier.priceCents, tier.currency)}</p>
      <p className="tier-card-line">{tier.tagline}</p>

      <details className="tier-card-more">
        <summary>What&rsquo;s included</summary>
        <div className="tier-card-detail">
          {groups.map((g, i) => (
            <div key={g.heading || i}>
              {named && g.heading ? <p className="tier-card-group">{g.heading}</p> : null}
              {g.items && (
                <ul>
                  {g.items.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </details>

      {tier.onSale ? (
        /*
          "Choose" alone on the face of the button, the tier's name in the
          accessible name. Four buttons reading "Choose All Access (VIP)",
          "Choose Main Conference" and so on wrap to three lines each at this
          column width and turn a row of calls to action into a paragraph;
          inside a card that has just named the ticket, the word is not
          ambiguous to anyone who can see it, and `aria-label` says the whole
          thing to anyone who cannot.
        */
        <Link href={href} className="tier-card-cta" aria-label={`Choose ${tier.name}`}>
          Choose
        </Link>
      ) : (
        /*
          A closed tier keeps its card. One that vanishes reads as a bug to
          somebody who was sent a link to it, and the reason it closed is the
          thing they actually need to know.
        */
        <p className="tier-card-closed">{tier.unavailableReason ?? 'Not available'}</p>
      )}
    </article>
  );
}
