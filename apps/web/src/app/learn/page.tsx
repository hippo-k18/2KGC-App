import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Learn',
  description:
    'The Knowledge Graph Learning Program — workshops, courses and the reading that actually helps before you arrive.',
};

/**
 * `/learn`, matching the live site's `Learn` tab.
 *
 * The tab is one of the five in the live site's primary navigation, and matching
 * that row exactly was an explicit instruction — which meant this page had to
 * exist, because a navigation item that 404s is worse than an absent one.
 *
 * It describes the workshop programme, which is real and in Firestore, rather
 * than inventing a course catalogue we do not run.
 */
export default function LearnPage() {
  return (
    <>
      <section>
        <div className="wrap narrow">
          <p className="eyebrow">Knowledge graph learning programme</p>
          <h1>Learn</h1>
          <p className="lede">
            Two of the five days at {SITE.shortName} {SITE.year} are hands-on. This is what that
            actually means, and what is worth reading before you turn up.
          </p>
        </div>
      </section>

      <section className="tint">
        <div className="wrap narrow">
          <h2>The workshop days</h2>
          <p>
            {SITE.workshopDays} are workshops; {SITE.conferenceDays} are the conference proper.
            Workshops are capped at sixty people, run by the person who built the thing being
            taught, and you leave with the notebooks and the datasets rather than a slide deck.
            They are the sessions past attendees rate highest, and they are the first thing to sell
            out.
          </p>
          <p>
            Levels are marked on <Link href="/agenda">the agenda</Link>. Beginner assumes you have
            seen a graph database and nothing more; advanced assumes you have one in production and
            a problem with it.
          </p>

          <h3>What to read first</h3>
          <ul className="ticks">
            <li>
              <strong>The W3C standards, skimmed rather than studied.</strong> RDF for the data
              model, SPARQL for querying it, SHACL for saying what a valid graph looks like. An hour
              across all three is enough to follow any talk here.
            </li>
            <li>
              <strong>One property-graph tutorial.</strong> Half this field models in RDF and half
              in labelled property graphs, and the arguments between them are more interesting once
              you have written a query in both.
            </li>
            <li>
              <strong>Your own organisation&rsquo;s worst join.</strong> The most useful thing you
              can bring is a real problem. Every workshop instructor would rather work through yours
              than the example dataset.
            </li>
          </ul>
        </div>
      </section>

      <section>
        <div className="wrap narrow">
          <h2>After the conference</h2>
          <p>
            Every session is recorded and every ticket — including virtual — includes the video
            library, so the two talks in the same slot are not a choice you have to make.{' '}
            <Link href="/tickets">Tickets</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
