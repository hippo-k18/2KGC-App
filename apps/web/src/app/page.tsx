import Link from 'next/link';
import { listSponsors, programmeCounts } from '@/lib/data';
import { SITE } from '@/lib/site';
import { formatPrice, TIERS } from '@/lib/tickets';

/**
 * The home page reads the real `speakers`, `sessions` and `sponsors`
 * collections. The counts in the stats band and the logos further down are
 * whatever is actually in Firestore, not numbers typed into JSX — so the day a
 * speaker is added in the organizer console, this page says so.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [counts, sponsors] = await Promise.all([programmeCounts(), listSponsors()]);
  const cheapest = TIERS.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));

  return (
    <>
      <section className="hero">
        <div className="wrap">
          {/*
            The live site's hero is four stacked lines and this matches its
            shape: a plain year, the conference name shouted in italic, the
            positioning line, then the dates in spaced capitals. The old version
            led with a sentence about enterprise data, which buried the one thing
            a visitor arrives wanting to confirm — which conference this is, and
            when.
          */}
          <p className="hero-eyebrow">KGC {SITE.year}</p>
          <h1>The Knowledge Graph Conference</h1>
          <p className="lede">Make Your Enterprise Data AI Ready</p>
          <p className="hero-dates">
            {SITE.datesLong} &nbsp;|&nbsp; {SITE.venueShort}
          </p>

          <div className="meta">
            <div>
              <strong>Dates</strong>
              {SITE.datesLong}
            </div>
            <div>
              <strong>Venue</strong>
              {SITE.venueShort}
            </div>
            <div>
              <strong>City</strong>
              {SITE.city}
            </div>
            <div>
              <strong>From</strong>
              {formatPrice(cheapest.priceCents)} ({cheapest.name.toLowerCase()})
            </div>
          </div>

          <div className="cta">
            <Link href="/tickets" className="btn btn-primary">
              Register now
            </Link>
            <Link href="/agenda" className="btn btn-ghost">
              See the agenda
            </Link>
          </div>
        </div>
      </section>

      <section className="tint">
        <div className="wrap">
          <div className="stats">
            <div>
              <div className="n">1,000+</div>
              <div className="l">Attendees expected</div>
            </div>
            <div>
              <div className="n">{counts.speakers}</div>
              <div className="l">Speakers confirmed so far</div>
            </div>
            <div>
              <div className="n">{counts.sessions}</div>
              <div className="l">Sessions on the programme</div>
            </div>
            <div>
              <div className="n">{counts.sponsors}</div>
              <div className="l">Partners and sponsors</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">What to expect</p>
          <h2>A working conference, not a vendor showcase</h2>
          <p className="lede" style={{ marginBottom: 34 }}>
            KGC is run by practitioners for practitioners. The talks that get accepted are the ones
            with a system diagram and a post-mortem in them.
          </p>

          <div className="grid g3">
            <div className="card">
              <h3>Two days of workshops</h3>
              <p>
                {SITE.workshopDays}. Instructor-led, laptops open, at beginner, intermediate and
                advanced level. You leave with the notebooks and the datasets.
              </p>
            </div>
            <div className="card">
              <h3>Three days of talks</h3>
              <p>
                {SITE.conferenceDays}. Parallel tracks across healthcare and life sciences, finance,
                retail, manufacturing, libraries and the research frontier.
              </p>
            </div>
            <div className="card">
              <h3>Case studies with numbers in them</h3>
              <p>
                Teams describing what they shipped, what it cost, what broke in production and what
                they would model differently a second time.
              </p>
            </div>
            <div className="card">
              <h3>Healthcare &amp; life sciences symposium</h3>
              <p>
                A dedicated day on data integration, ontology mapping and machine learning over
                clinical and biomedical graphs. It sells out first every year.
              </p>
            </div>
            <div className="card">
              <h3>Hallway track, organised</h3>
              <p>
                The KGC app matches you to people working on the problem you are working on, and
                keeps your schedule, messages and contacts in one place all week.
              </p>
            </div>
            <div className="card">
              <h3>Everything recorded</h3>
              <p>
                Every session is streamed and recorded. In-person tickets include three months of the
                KGC Video Library, so you do not have to choose between two parallel talks.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="tint">
        <div className="wrap">
          <p className="eyebrow">Tickets</p>
          <h2>Four ways to come</h2>
          <p className="lede" style={{ marginBottom: 30 }}>
            Prices are per person, in US dollars. Every in-person ticket includes the community happy
            hour and the evening networking events.
          </p>

          <div className="grid g4">
            {TIERS.map((t) => (
              <div key={t.id} className={`card${t.featured ? ' tier featured' : ''}`}>
                <h3>{t.name}</h3>
                <p className="muted" style={{ fontSize: '0.9rem' }}>
                  {t.tagline}
                </p>
                <p style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--ink)', margin: '10px 0 14px' }}>
                  {formatPrice(t.priceCents)}
                </p>
                <Link href={`/tickets#buy`} className="btn btn-outline btn-sm btn-block">
                  Choose {t.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {sponsors.length > 0 && (
        <section>
          <div className="wrap">
            <p className="eyebrow">Sponsors &amp; partners</p>
            <h2>Who backs KGC</h2>
            <p className="lede" style={{ marginBottom: 28 }}>
              The organisations funding the conference, in tier order. Want to join them?{' '}
              <Link href="/sponsor">See the sponsorship packages</Link>.
            </p>
            <div className="logos">
              {sponsors.map((s) =>
                s.website ? (
                  <a
                    key={s.id}
                    className="logo-tile"
                    href={s.website}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <span>
                      {s.name}
                      <span className="tier">{s.tier}</span>
                    </span>
                  </a>
                ) : (
                  <div key={s.id} className="logo-tile">
                    <span>
                      {s.name}
                      <span className="tier">{s.tier}</span>
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        </section>
      )}

      <section className="tint">
        <div className="wrap narrow center">
          <h2>Bring your team</h2>
          <p className="lede" style={{ margin: '0 auto 24px' }}>
            {SITE.datesLong} at {SITE.venue}. Register now, and your ticket appears in the KGC app
            the moment you sign in with the same email address.
          </p>
          <Link href="/tickets" className="btn btn-primary">
            Register now
          </Link>
        </div>
      </section>
    </>
  );
}
