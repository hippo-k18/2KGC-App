import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { programmeCounts } from '@/lib/data';
import { ATTENDEES_EXPECTED, SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Healthcare & Life Sciences Symposium',
  description:
    'The HCLS Symposium, co-located with the Knowledge Graph Conference 2027 at Cornell Tech.',
};

/**
 * Rebuilt against the live /hcls page on 2026-08-18.
 *
 * Structure, in the live page's order: a pale split hero with the title set in
 * four short lines beside a photograph; a navy "About The Event" band; the
 * call for contributions with its four numbered objectives; a stats band with
 * three cards; and a partner call to action.
 *
 * The live page also embeds a Whova agenda widget below all this. It is
 * deliberately not reproduced — replacing that widget is the point of this
 * project, and /agenda is where its replacement lives.
 */

const OBJECTIVES = [
  'Characterisation of healthcare and life sciences knowledge graphs',
  'Opportunities for applying knowledge graphs in healthcare and life sciences',
  'Challenges of creating and maintaining such knowledge graphs',
  'Opportunities for knowledge graph research in this space',
];

/**
 * The three stat cards, from the same sources the homepage's are.
 *
 * ── Four numbers for three facts ────────────────────────────────────────────
 *
 * These were hardcoded as "2,000+ Attendees", "40+ Partners" and "150+
 * Speakers" while the homepage's own three cards said "1,000+ Attendees
 * expected" and counted sponsors and speakers out of Firestore. One site, one
 * conference, and a visitor who opened both pages was told the attendance twice
 * with a factor of two between the answers.
 *
 * The figures were the live 2026 page's, and they are cumulative claims about
 * every KGC to date rather than about this edition — which is exactly why they
 * cannot sit beside a count of it. So this page now defers: the expectation
 * comes from the one declaration that owns it, and the other two are `count()`
 * results, matching the homepage card for card.
 *
 * `Attendees expected` rather than `Attendees`, for the reason `site.ts` gives:
 * the noun has to say whether the number was counted or stated, because these
 * three cards sit in a row and two of them were counted.
 */
function stats(counts: { speakers: number; sponsors: number }) {
  return [
    {
      n: ATTENDEES_EXPECTED,
      label: 'Attendees expected',
      body: 'Leading experts and award winners across hybrid AI, LLMs, NLP, machine learning and data management make an annual visit to the conference.',
      href: '/tickets',
      cta: 'Get tickets →',
    },
    {
      n: String(counts.sponsors),
      label: counts.sponsors === 1 ? 'Partner' : 'Partners',
      body: 'We are supported by a distinguished group of sponsors, each playing a pivotal role in advancing knowledge graph technologies and their applications.',
      href: '/sponsor',
      cta: 'Partner with us →',
    },
    {
      n: String(counts.speakers),
      label: counts.speakers === 1 ? 'Speaker' : 'Speakers',
      body: 'Data scientists, healthcare and life-sciences researchers, finance analysts, knowledge engineers and ontologists.',
      /*
        `/sponsor#speak` and not `/speakers`. This card's call to action is
        "Become a speaker" and it pointed at the roster — a list of people who
        already are one, with no submission path on it. The call for speakers
        lives on `/sponsor#speak`, which is where `/call-for-posters` and
        `/startup-pitch` have always sent people.
      */
      href: '/sponsor#speak',
      cta: 'Become a speaker →',
    },
  ];
}

/*
 * Counted per request, like the homepage. This page was static and read nothing
 * because every number on it was typed; two of them are now measurements, and a
 * measurement cached at build time is a measurement that goes stale silently.
 */
export const dynamic = 'force-dynamic';

export default async function HclsPage() {
  const counts = await programmeCounts();

  return (
    <>
      <section className="band band-wash">
        <div className="wrap split-hero">
          <div>
            <h1>
              The
              <br />
              Healthcare and
              <br />
              Life Sciences
              <br />
              Symposium (HCLS)
            </h1>
            <p className="when">
              {SITE.datesLong} | {SITE.venueShort} + Virtual
            </p>
            <div className="cta">
              <Link href="/tickets" className="btn btn-primary">
                Grab a seat now
              </Link>
              {/* The call for speakers, not the roster — see `stats()`. */}
              <Link href="/sponsor#speak" className="btn btn-outline">
                Become a speaker
              </Link>
            </div>
          </div>
          <Image
            src="/kgc/hcls-hero.jpeg"
            alt="A panel discussion at the Healthcare and Life Sciences Symposium"
            width={1536}
            height={1024}
            priority
          />
        </div>
      </section>

      <section className="band band-navy band-centred" style={{ padding: '44px 0' }}>
        <div className="wrap narrow">
          <h2>About the event</h2>
          <p style={{ margin: 0 }}>
            The Healthcare and Life Sciences Symposium is co-located with the{' '}
            {SITE.name}.
          </p>
        </div>
      </section>

      <section className="band band-centred hcls-cfp">
        <div className="wrap narrow">
          <p>
            We seek original contributions describing theoretical and practical methods and
            techniques for building and maintaining health knowledge graphs for the healthcare and
            life sciences domain. The symposium covers data integration, data profiling, data
            curation, querying, knowledge discovery, ontology mapping, matching, reconciliation,
            machine learning approaches and applications. Several invited speakers are thought
            leaders in the healthcare and life sciences space, and a panel discussion brings together
            experts from industry, government and academia.
          </p>
          <p>In summary, the symposium is a platform to discuss:</p>
        </div>

        {/*
          The four objectives sit at full content width on the live page, not
          inside the prose measure — at 842px the fourth column wraps onto its
          own row and the set stops reading as four peers.
        */}
        <div className="wrap">
          <div className="pillars">
            {OBJECTIVES.map((o, i) => (
              <div key={o}>
                <p className="n">{i + 1}.</p>
                <p>{o}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-pale band-centred">
        <div className="wrap">
          <h2>It’s a call for speakers and partners.</h2>
          <p className="lede">We’d love to see you here in May.</p>

          <div className="stat-cards">
            {stats(counts).map((s) => (
              <div key={s.label} className="stat-card">
                <h3>
                  <strong>{s.n}</strong> {s.label}
                </h3>
                <p>{s.body}</p>
                <Link href={s.href}>{s.cta}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-wash band-centred">
        <div className="wrap narrow">
          <h2 style={{ fontStyle: 'italic' }}>Become our partner for {SITE.year}</h2>
          <p className="lede" style={{ marginBottom: 24 }}>
            Below you’ll find our partners. We welcome any enquiries or feedback.
          </p>
          <Link href="/sponsor" className="btn btn-primary">
            Learn more
          </Link>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="find-us">
            <h2>Find us</h2>
            <div className="cols">
              <div>
                <p className="k">Email</p>
                <p className="v">
                  <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
                </p>
              </div>
              {/* Three columns, as on the live page — Email, Phone, Address. The
                  phone column was missing entirely. */}
              <div>
                <p className="k">Phone</p>
                <p className="v">
                  <a href={`tel:${SITE.contactPhone.replace(/[^0-9+]/g, '')}`}>
                    {SITE.contactPhone}
                  </a>
                </p>
              </div>
              <div>
                <p className="k">Address</p>
                <p className="v">Cornell Tech &amp; globally online</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
