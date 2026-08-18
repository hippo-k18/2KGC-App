import type { Metadata } from 'next';
import Link from 'next/link';
import { HCLS_BADGE, SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Healthcare & Life Sciences Symposium',
  description:
    'The HCLS Symposium, co-located with the Knowledge Graph Conference 2027 at Cornell Tech — health knowledge graphs in practice.',
};

/**
 * The Healthcare and Life Sciences Symposium.
 *
 * `/hcls/` is a real page on the live site and a real part of the programme, and
 * it was the most conspicuous thing missing here: the homepage carries a whole
 * navy band about the symposium whose only destination was an `#hcls` anchor
 * back to itself. A band that describes an event and links nowhere is worse than
 * no band.
 *
 * The structure follows the live page — what it is, what it wants from
 * contributors, the scale of it, and how to take part — with the figures driven
 * from `SITE` and the sale state from `HCLS_BADGE`, so this page cannot end up
 * claiming something the rest of the site contradicts.
 */
export default function HclsPage() {
  return (
    <>
      <section>
        <div className="wrap narrow">
          <p className="eyebrow">Co-located symposium</p>
          <h1>Healthcare &amp; Life Sciences Symposium</h1>
          <p className="lede">
            One day inside {SITE.shortName} {SITE.year}, at {SITE.venueShort}, for the people
            building and maintaining health knowledge graphs — and for the people who have to keep
            them correct once clinicians depend on them.
          </p>
          {HCLS_BADGE ? (
            <p className="notice">
              <strong>{HCLS_BADGE.label}.</strong> The symposium is included with any in-person
              ticket; there is no separate registration.
            </p>
          ) : null}
        </div>
      </section>

      <section className="tint">
        <div className="wrap narrow">
          <h2>About the symposium</h2>
          <p>
            HCLS invites original contributions describing theoretical and practical methods for
            building and maintaining health knowledge graphs. Healthcare is where the field&rsquo;s
            hardest problems are unavoidable rather than academic: identifiers that do not resolve,
            vocabularies that disagree, provenance that has to survive an audit, and a cost of being
            wrong that is measured in people rather than in dashboards.
          </p>

          <h3>What the programme is looking for</h3>
          <ul className="ticks">
            <li>
              Characterising health knowledge graphs — what is actually in them, how they are
              modelled, and where the models break.
            </li>
            <li>
              Applications in the clinic, in research and in industry, described concretely enough to
              be argued with.
            </li>
            <li>
              The challenges nobody has solved: entity resolution across coding systems, keeping
              provenance accurate through a pipeline rewrite, and governance once more than one team
              depends on the graph.
            </li>
            <li>
              Where the research opportunities are, from people who have hit the wall rather than
              read about it.
            </li>
          </ul>
        </div>
      </section>

      <section>
        <div className="wrap narrow">
          <h2>Taking part</h2>
          <p>
            <strong>Speaking.</strong> The call for contributions runs alongside the main
            conference&rsquo;s. Sessions are chosen by the same practitioner committee, on the same
            standard — a talk with a system diagram and a post-mortem in it beats a talk with a
            roadmap in it. <Link href="/sponsor#speak">Pitch a talk</Link>.
          </p>
          <p>
            <strong>Attending.</strong> HCLS runs inside the main conference, so any in-person ticket
            admits you. <Link href="/tickets">Tickets</Link> · <Link href="/agenda">the agenda</Link>.
          </p>
          <p>
            <strong>Partnering.</strong> Organisations working in this area can support the symposium
            specifically rather than the conference generally.{' '}
            <Link href="/sponsor">Sponsorship packages</Link>.
          </p>
          <p className="muted">
            Questions about the symposium go to{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>
        </div>
      </section>
    </>
  );
}
