import Link from 'next/link';
import { listAgenda, listSponsors, programmeCounts } from '@/lib/data';
import { ATTENDEES_EXPECTED, HCLS_BADGE, SITE } from '@/lib/site';
import { formatPrice, TIERS } from '@/lib/tickets';
import { EventSchedule } from '@/components/event-schedule';
import { HighlightPair } from '@/components/home/highlight-pair';
import { PhotoSplit } from '@/components/home/photo-split';
import { StatBlocks } from '@/components/home/stat-blocks';
import { Testimonials } from '@/components/home/testimonials';

/**
 * The home page reads the real `speakers`, `sessions` and `sponsors`
 * collections. The counts in the stats band and the logos further down are
 * whatever is actually in Firestore, not numbers typed into JSX — so the day a
 * speaker is added in the organizer console, this page says so.
 */
export const dynamic = 'force-dynamic';

/**
 * The five testimonial cards, transcribed from the images they are baked into.
 *
 * These are real people saying real things about a real conference, so the
 * quotations and affiliations were read off each image rather than written to
 * fit — inventing a sentence and attributing it to a named person at IBM or IKEA
 * would be the worst thing on this page.
 *
 * They have to be transcribed at all because the live site ships the quote as
 * pixels. Without this the whole section is silent to a screen reader, and
 * unsearchable to everyone.
 */
const TESTIMONIALS = [
  {
    file: '78e0d42d86194279988dd51d33556de7_3532888051e57c5057b194c4b6010c7a-1.webp',
    quote:
      'The KGC held on Roosevelt Island, much like the island itself, provides an oasis for an practising ontologist like me to meet people solving the exact same problems or at least similar problems, and get inspired by new solutions for building knowledge graphs and realising knowledge-first strategies in their respective companies. I can warmly recommend anyone working with or curious of knowledge graphs to attend the conference.',
    who: 'Katariina Kari, Lead Ontologist, Inter IKEA Systems',
  },
  {
    file: '9f0191bf9a41433d9852204351f4fd63_a4a3dd692336a878d3638d51b4d38deb.webp',
    quote:
      'I think KGC is a one-of-a-kind conference in the field as it maintains its content interesting and at the same time accessible to everyone. I enjoyed the 2023 edition — well organised and full of good inputs.',
    who: 'Tommaso Soru, Artificial Intelligence Lead, Serendipity AI Ltd',
  },
  {
    file: '3ba382772eac4f009cc73eccdb1790f4_a563c9d39d707b9c697324408f6f82ca.webp',
    quote:
      'The conference was amazing. Really enjoyed the organization and the talks, which were informative and timely.',
    who: 'Manas Gaur, Assistant Professor, University of Maryland Baltimore County',
  },
  {
    file: '462516a2d92c41a391a4af4a18cfb61a_bdeec9a1701b5636bc9ec7d7ed5bae22.webp',
    quote:
      'I really enjoyed the Knowledge Graph Conference with the many fine talks and excellent organization.',
    who: 'Laurel Zuckerman, Editor, Open Art Data',
  },
  {
    file: 'e53e9900b096431db06122172c373056_befe653381fdeb2c9cbe785121fa807e.webp',
    quote: 'Yes, the conference is great! Kudos for all the great work you guys put in.',
    who: 'Nandana Mihindukulasooriya, Research Scientist, IBM Research',
  },
];

export default async function HomePage() {
  const [counts, sponsors, agenda] = await Promise.all([
    programmeCounts(),
    listSponsors(),
    listAgenda(),
  ]);
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

      {/*
        Three cards, as on the live site, not the four this used to show. Two of
        the numbers are `count()` results against Firestore; the attendance
        figure cannot be, because `registrations` holds ticket holders for this
        edition mid-sale — fifty-odd in a seeded demo, which would render
        "52 Attendees" beneath a headline claiming a thousand. So it is declared
        in `site.ts` as a stated expectation and the noun says "expected", rather
        than a typed number wearing the costume of a measurement.
      */}
      <StatBlocks
        stats={[
          {
            value: ATTENDEES_EXPECTED,
            noun: 'Attendees expected',
            blurb:
              'Leading practitioners across hybrid AI, LLMs, NLP, machine learning and data management, for five days on Roosevelt Island.',
          },
          {
            value: String(counts.sponsors),
            noun: counts.sponsors === 1 ? 'Partner' : 'Partners',
            blurb:
              'Supported by organisations building the tools and the standards the rest of the field runs on.',
          },
          {
            value: String(counts.speakers),
            noun: counts.speakers === 1 ? 'Speaker' : 'Speakers',
            blurb:
              'Data scientists, healthcare and life-sciences researchers, finance analysts, knowledge engineers and ontologists.',
          },
        ]}
      />

      {/*
        The agenda, on the homepage, from our own data — where the live site
        embeds Whova's widget. This is the single most pointed replacement on the
        page: the thing being demonstrated sits exactly where the incumbent used
        to be. Capped per day, because the homepage teases and `/agenda` does not.
      */}
      <section className="kgc-wide" aria-labelledby="schedule-heading">
        <h2 id="schedule-heading" className="hero-headline" style={{ fontSize: 32 }}>
          KGC {SITE.year} Full Agenda
        </h2>
        <EventSchedule days={agenda} limitPerDay={4} moreHref="/agenda" />
      </section>

      {/* "Why Attend" — photograph left, prose right, as on the live page. */}
      <PhotoSplit
        heading="Why Attend"
        photo="/kgc/photos/1746718623163.jpeg"
        alt="Attendees at tables during a KGC workshop session, laptops open."
        aspect="3 / 2"
      >
        <p>
          The applications of knowledge graphs are growing fast across healthcare and life sciences,
          finance, manufacturing, retail and government. KGC is run by practitioners for
          practitioners: the talks that get accepted are the ones with a system diagram and a
          post-mortem in them.
        </p>
        <p>
          {SITE.workshopDays} are workshops. {SITE.conferenceDays} are parallel tracks. Everything
          is recorded, so you do not have to choose between two talks in the same slot.
        </p>
      </PhotoSplit>

      {/*
        The two numbered highlights. Numbering is the live site's and it earns its
        place — these are its two headline reasons to come, ranked.
      */}
      <HighlightPair
        items={[
          {
            heading: '#1 Invaluable Workshops',
            photo: '/kgc/photos/1746718623813.jpeg',
            alt: 'A workshop in progress, an instructor at the front and the room following along.',
            aspect: '3 / 2',
            body: (
              <>
                Workshops are the thing past attendees rate highest. Hands-on and instructor-led, at
                beginner, intermediate and advanced level — you leave with the notebooks and the
                datasets, not a slide deck.
              </>
            ),
            // The live site spells this "Limitied". Reproduced in shape, not in
            // spelling; a typo is not a design decision.
            note: '*Limited availability',
            link: { label: 'Learn more', href: '/agenda' },
          },
          {
            heading: '#2 Networking Opportunities',
            photo: '/kgc/photos/1747294709286.jpeg',
            alt: 'Attendees talking in small groups between sessions.',
            aspect: '4 / 3',
            body: (
              <>
                Build relationships, trade notes and find the people solving the problem you are
                solving. The app keeps your schedule, your messages and the people you have met in
                one place for the whole week.
              </>
            ),
          },
        ]}
      />

      {/* HCLS — equal columns and a navy ground on the live page. */}
      {/*
        `5 / 4`, not the `4 / 3` this passed: the file is 1919x1536 = 1.249, and
        under `object-fit: cover` a 1.333 box cropped 6% off its height.
        `photo-split.tsx` already documented this photo as 5/4.
      */}
      <PhotoSplit
        id="hcls"
        heading="Healthcare and Life Sciences (HCLS) symposium"
        photo="/kgc/photos/1746718624050.jpeg"
        alt="A packed symposium room during a healthcare and life sciences session."
        aspect="5 / 4"
        photoSide="right"
        tone="navy"
        columns="equal"
        footer={
          HCLS_BADGE ? (
            <p className="kgc-pair-note" style={{ marginTop: 16 }}>
              {HCLS_BADGE.label}
            </p>
          ) : null
        }
      >
        <p>
          A dedicated strand on data integration, profiling, curation, querying and ontology mapping
          over clinical and biomedical graphs — and on the machine learning built on top of them.
        </p>
        <p>It is the part of the programme that sells out first, every year.</p>
      </PhotoSplit>

      <Testimonials
        heading="The Knowledge Graph Conference in Your Words"
        items={TESTIMONIALS}
      />

      <section className="tint">
        <div className="wrap">
          <p className="eyebrow">Tickets</p>
          <h2>Four ways to come</h2>
          <p className="lede" style={{ marginBottom: 30 }}>
            Prices are per person, in US dollars. Every in-person ticket includes the community happy
            hour and the evening networking events.
          </p>

          <div className="grid g4">
            {/*
              All four carry `card tier`; only the highlight is conditional. The
              featured card used to be the only one with `tier`, which brought
              `.tier`'s 24px padding and `display: flex` while its three siblings
              kept `.card`'s 22px and normal flow — so it sat 2px out, and flex
              suppressed the margin collapse between the tagline and the price,
              pushing the price and the button a further 10px down. The result was
              a four-card row whose prices did not line up, on the one card the
              eye is meant to land on.
            */}
            {TIERS.map((t) => (
              <div key={t.id} className={`card tier${t.featured ? ' featured' : ''}`}>
                <h3>{t.name}</h3>
                <p className="muted" style={{ fontSize: '0.9rem' }}>
                  {t.tagline}
                </p>
                <p style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--ink)', margin: '10px 0 14px' }}>
                  {formatPrice(t.priceCents)}
                </p>
                {/*
                  `?tier=` matters: the tickets page reads it and preselects the
                  form, and without it all four of these buttons landed on the
                  same page with All Access selected — so "Choose Workshops"
                  offered to charge $1,199 for a $699 ticket. The tickets page's
                  own tier buttons already carry the param; these were the copy
                  that lost it.
                */}
                <Link href={`/tickets?tier=${t.id}#buy`} className="btn btn-outline btn-block">
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

      {/*
        Built on `<details>`/`<summary>` rather than buttons and state. It is
        keyboard-operable, screen-reader-announced and findable by the browser's
        own in-page search with no JavaScript at all — and on this page the
        alternative was a hand-rolled accordion that only answered a mouse.
        The first item is open, as it is in the live site's served HTML.
      */}
      <section className="kgc-faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">Frequently Asked Questions</h2>

        <details open>
          <summary>Where should I make hotel arrangements?</summary>
          <div className="answer">
            <p>
              For KGC {SITE.year} we recommend the following, both within easy reach of the campus
              and the city:
            </p>
            <ul>
              <li>TownePlace Suites — Long Island City</li>
              <li>Hotel 57</li>
            </ul>
            <p>
              Discounted room blocks are arranged closer to the conference; both hotels take
              reservations at their standard rates in the meantime.
            </p>
          </div>
        </details>

        <details>
          <summary>Will I qualify for the KGC Video Library subscription?</summary>
          <div className="answer">
            <p>
              In-person and virtual tickets both include access to the recordings. Every session is
              streamed and recorded, so two talks in the same slot is not a choice you have to make.
            </p>
          </div>
        </details>

        <details>
          <summary>
            Are discounted tickets available for students, academics or non-profits?
          </summary>
          <div className="answer">
            <p>
              Yes. Academic, student and non-profit rates are available — see the{' '}
              <Link href="/tickets">ticket page</Link> for the current tiers, or write to us at{' '}
              {SITE.contactEmail ?? 'contact@knowledgegraph.tech'} if your situation does not fit
              one of them.
            </p>
          </div>
        </details>

        <details>
          <summary>Will the in-person presentations be available online?</summary>
          <div className="answer">
            <p>
              Yes — every session is recorded and published to the video library after the
              conference.
            </p>
          </div>
        </details>

        <details>
          <summary>How do I get to the Cornell Tech campus?</summary>
          <div className="answer">
            <p>
              The campus is on Roosevelt Island. The tram from 59th Street and 2nd Avenue runs every
              few minutes and takes about four; the F train stops on the island; and the ferry is
              slower but you get a seat and the view.
            </p>
          </div>
        </details>
      </section>

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
