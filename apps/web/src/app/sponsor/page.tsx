import type { Metadata } from 'next';
import Link from 'next/link';
import { listSponsorsByTier } from '@/lib/data';
import { tiersOrNull } from '@/lib/catalogue';
import { SponsorTiers } from '@/components/sponsor-tiers';
import { SITE } from '@/lib/site';
import { formatPrice } from '@/lib/tickets';

export const metadata: Metadata = {
  title: 'Sponsor KGC',
  description:
    'Sponsorship and speaking opportunities at the Knowledge Graph Conference 2027, Cornell Tech NYC.',
};

export const dynamic = 'force-dynamic';

/*
 * The packages come from `ticketTypes`, not from a constant here.
 *
 * ── Two public pages were describing one product ────────────────────────────
 *
 * This file held a `PACKAGES` array — Platinum/Gold/Silver/Bronze with a
 * hand-written benefit list each — while `/tickets/sponsor` rendered the
 * `includes` array off the `audience: 'sponsor'` documents that actually sell
 * those packages. Same site, same four tiers, two descriptions, and only one of
 * them was the record a buyer's order is written against. They had already
 * diverged: this page said Gold gets "six full-conference passes" and the tier
 * being sold says eight All Access ones.
 *
 * A constant loses that argument on every axis. It is edited by a deploy rather
 * than by the organizer who priced the tier, and it is the copy nobody thinks
 * to change when the package changes. So the marketing page and the checkout
 * page now read the same documents, and the only thing this one adds is the
 * link that takes you to the other.
 *
 * ── Prices are quoted now, because the sibling page already quotes them ─────
 *
 * The old comment here said no prices were shown because the real prospectus is
 * a Coda doc the live nav links out to and is the authority on what a tier
 * costs. That reasoning stopped holding when `/tickets/sponsor` went live
 * publishing exactly these figures: withholding them here made this page look
 * coy, not discreet, about a number one click away.
 *
 * Catalogue order — `sortOrder`, ascending, which is Bronze first — is the same
 * order `/tickets/sponsor` uses. Reversing it here to lead with Platinum would
 * be a second opinion about the same list.
 */

export default async function SponsorPage() {
  /*
   * `tiersOrNull`, not `listTiers`: this is a marketing page, and an
   * unreachable catalogue should cost it the Packages band, not the sponsor
   * wall and the call for speakers underneath. The tickets pages keep the loud
   * failure, because a price that fails quietly is the one that gets charged.
   */
  const [bands, packages] = await Promise.all([
    listSponsorsByTier(),
    tiersOrNull('sponsor'),
  ]);

  return (
    <>
      <section>
        <div className="wrap">
          <p className="eyebrow">Partnership</p>
          <h1>Sponsor KGC 2027</h1>
          <p className="lede">
            A thousand people who buy, build and operate knowledge graph infrastructure, in one
            building for five days. KGC attendees are unusually senior and unusually technical — the
            room is roughly a third architects and engineers, a third data leadership, a third
            researchers.
          </p>
          <p>
            Sponsorship enquiries:{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. Packages sell out by
            February most years.
          </p>
        </div>
      </section>

      {packages && packages.length > 0 && (
        <section className="tint">
          <div className="wrap">
            <h2>Packages</h2>
            <div className="grid g3" style={{ marginTop: 24 }}>
              {packages.map((p) => (
                <div className="card" key={p.id}>
                  <h3>{p.name}</h3>
                  <p style={{ margin: '4px 0 0', fontWeight: 600 }}>
                    {formatPrice(p.priceCents, p.currency)}
                  </p>
                  {p.tagline && (
                    <p style={{ margin: '4px 0 0', fontSize: '0.93rem' }}>{p.tagline}</p>
                  )}
                  <ul style={{ paddingLeft: 18, margin: '10px 0 0', fontSize: '0.93rem' }}>
                    {p.includes.map((w) => (
                      <li key={w} style={{ padding: '3px 0' }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                  {/*
                    A closed package keeps its card and says why, rather than
                    vanishing — Platinum is capped at one, and "sold out" is the
                    single most useful thing an enquirer can be told about it.
                  */}
                  {!p.onSale && (
                    <p style={{ margin: '10px 0 0', fontSize: '0.93rem', fontWeight: 600 }}>
                      {p.unavailableReason ?? 'Not available'}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p style={{ marginTop: 24 }}>
              <Link className="btn btn-primary" href="/tickets/sponsor">
                Become a sponsor
              </Link>
            </p>
          </div>
        </section>
      )}

      {bands.length > 0 && (
        <section>
          <div className="wrap">
            <h2>Our sponsors</h2>
            <SponsorTiers bands={bands} />
          </div>
        </section>
      )}

      <section className="tint" id="speak">
        <div className="wrap narrow">
          <p className="eyebrow">Call for speakers</p>
          <h2>Speak at KGC</h2>
          <p>
            The programme committee reads every submission. What gets accepted is specific: a system
            you built, a modelling decision you regret, a migration that went sideways, an evaluation
            with numbers in it. What does not get accepted is a product tour — that is what the booth
            is for, and we would rather you sponsored.
          </p>
          <p>
            Formats are a 25-minute talk, a 45-minute deep dive, a panel or a half-day workshop.
            Submissions open in September and close in December.
          </p>
          <p>
            <a className="btn btn-primary" href={`mailto:${SITE.contactEmail}?subject=KGC%202027%20talk%20proposal`}>
              Pitch a talk
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
