import Image from 'next/image';
import type { SponsorCard } from '@/lib/data';
import type { SponsorTier } from '@kgc/shared';

/**
 * The sponsor logo bands, shared by the homepage and `/sponsor`.
 *
 * Both pages used to carry their own copy of a flat name-in-a-box grid, and the
 * two copies had already drifted — one wrapped its tiles in links and the other
 * did not, while both kept the hover style. One component now, because the live
 * site renders one widget in both places.
 *
 * Geometry, sizing and row behaviour are all in `.logo-card` in `globals.css`;
 * this file only decides which size step each band gets and whether a card is a
 * link. See that block for where the numbers come from.
 */

/** Title case for the band heading. Tiers are stored lower case. */
function tierLabel(tier: SponsorTier): string {
  return tier[0].toUpperCase() + tier.slice(1);
}

export interface SponsorBand {
  tier: SponsorTier;
  size: 1 | 2 | 3;
  sponsors: SponsorCard[];
}

function Logo({ sponsor, size }: { sponsor: SponsorCard; size: 1 | 2 | 3 }) {
  /*
   * The intrinsic box, so Next can reserve space and the row does not reflow as
   * logos arrive. These are the card's inner dimensions — card size minus its
   * padding — and they match `.logo-card.size-N` exactly.
   */
  const box = { 3: { w: 228, h: 169 }, 2: { w: 168, h: 124 }, 1: { w: 130, h: 96 } }[size];

  /*
   * `alt` is always the company name, never empty. Most of these logos are
   * wordmarks that carry the name as pixels, so this is the only place that name
   * exists for a screen reader or when the image fails to load.
   *
   * Two renderers, chosen by whether the URL is ours. `listSponsors()` rewrites
   * every sponsor we self-host to a local path, so `next/image` handles the
   * eighteen we have. A sponsor added later without a local file still holds its
   * original absolute URL, and `next/image` throws on a host that is not in
   * `images.remotePatterns` — which is nothing, deliberately. A plain `img`
   * degrades instead of taking the page down, and it is the safer default: we do
   * not want to declare a third-party CDN trusted just to avoid a branch.
   */
  const image = !sponsor.logoURL ? (
    /* No logo at all: fall back to the name rather than an empty card. */
    <span className="logo-fallback">{sponsor.name}</span>
  ) : sponsor.logoURL.startsWith('/') ? (
    <Image src={sponsor.logoURL} alt={sponsor.name} width={box.w} height={box.h} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- see above: an
    // un-configured remote host cannot go through next/image.
    <img src={sponsor.logoURL} alt={sponsor.name} width={box.w} height={box.h} loading="lazy" />
  );

  const className = `logo-card size-${size}`;

  return sponsor.website ? (
    <a className={className} href={sponsor.website} target="_blank" rel="noreferrer noopener">
      {image}
    </a>
  ) : (
    <div className={className}>{image}</div>
  );
}

export function SponsorTiers({ bands }: { bands: SponsorBand[] }) {
  if (bands.length === 0) return null;

  return (
    <div className="sponsor-tiers">
      {bands.map((band) => (
        <section className="tier-band" key={band.tier} aria-labelledby={`tier-${band.tier}`}>
          <h3 className="tier-title" id={`tier-${band.tier}`}>
            {tierLabel(band.tier)}
          </h3>
          <div className="logo-row">
            {band.sponsors.map((s) => (
              <Logo key={s.id} sponsor={s} size={band.size} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
