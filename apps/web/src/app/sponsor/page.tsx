import type { Metadata } from 'next';
import { listSponsorsByTier } from '@/lib/data';
import { SponsorTiers } from '@/components/sponsor-tiers';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Sponsor KGC',
  description:
    'Sponsorship and speaking opportunities at the Knowledge Graph Conference 2027, Cornell Tech NYC.',
};

export const dynamic = 'force-dynamic';

/*
 * Four tiers, because four is what the conference sells.
 *
 * This listed Diamond and Startup as well, which the real event has never had —
 * and the sponsor bands below are grouped from live data, so the page was
 * offering two packages that no sponsor on the same screen held. The line items
 * are still ours rather than the prospectus's: the real prospectus is a Coda doc
 * the live nav links out to, and it is the authority on what a tier includes.
 * No prices are quoted here for that reason.
 */
const PACKAGES = [
  {
    tier: 'Platinum',
    what: [
      'Keynote or main-stage session slot',
      'Largest booth, front of the exhibition hall',
      'Ten full-conference passes',
      'Logo on the badge lanyard and the app home screen',
      'Booth staff badges, and your scanned leads exported after the event',
    ],
  },
  {
    tier: 'Gold',
    what: [
      'Track session slot',
      'Premium booth position',
      'Six full-conference passes',
      'Logo on stage screens and in the app',
      'Booth staff badges, and your scanned leads exported after the event',
    ],
  },
  {
    tier: 'Silver',
    what: ['Standard booth', 'Four full-conference passes', 'Logo in the app'],
  },
  {
    tier: 'Bronze',
    what: ['Exhibition table', 'Two full-conference passes', 'Logo in the app'],
  },
];

export default async function SponsorPage() {
  const bands = await listSponsorsByTier();

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

      <section className="tint">
        <div className="wrap">
          <h2>Packages</h2>
          <div className="grid g3" style={{ marginTop: 24 }}>
            {PACKAGES.map((p) => (
              <div className="card" key={p.tier}>
                <h3>{p.tier}</h3>
                <ul style={{ paddingLeft: 18, margin: '10px 0 0', fontSize: '0.93rem' }}>
                  {p.what.map((w) => (
                    <li key={w} style={{ padding: '3px 0' }}>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

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
