import { PAGE_CONTENT_KEYS, type CallPageContent } from '@kgc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { pageContent } from '@/lib/data';
import { SITE } from '@/lib/site';

/**
 * The poster track — transcribed from `knowledgegraph.tech/call-for-posters/`.
 *
 * The submission rules are reproduced exactly, because they are rules: page
 * counts, the CEUR-ART format requirement, that double-blind is *not* required
 * and that proceedings go to CEUR-WS. Getting any of those subtly wrong on a
 * page an author works from is worse than not having the page.
 *
 * The chairs named on the live page are real people and are left as stated. The
 * dates are the 2026 deadlines shifted a year and are marked provisional in the
 * interface — see the same note in `startup-pitch/page.tsx`.
 */

export const metadata: Metadata = {
  title: 'Call for Posters',
  description: `The Knowledge Graph Conference ${SITE.year} poster track: applied research and emerging ideas from graduate students and early-career researchers.`,
};

const TOPICS = [
  'Core knowledge graph technologies, languages and tools',
  'Ontologies, taxonomies and semantic layers',
  'Rules, reasoning and hybrid AI systems',
  'Knowledge graphs with large language models and retrieval',
  'Data governance, quality and interoperability',
  'Applications in industry, healthcare, finance and the public sector',
];

const RULES = [
  'Minimum 5 pages and at most 7 pages, including references.',
  'No double-blind submission required.',
  'PDF or HTML.',
  'Formatted in the CEUR-ART style. An Overleaf template is available for LaTeX users.',
  'Original work that has not been submitted for publication elsewhere.',
];

/**
 * The submission link and the calendar — the two things on this page that go
 * stale, and now the two an organizer can change without a deploy.
 *
 * ⚠️ Both are wrong in the source as shipped, which is the argument for moving
 * them: the deadlines are the 2026 dates shifted a year and were never
 * confirmed, and the EasyChair link still names `kgc2026`. Neither is the kind
 * of mistake that survives because nobody noticed — a comment in this file has
 * said PLACEHOLDER since August. It survives because fixing it is a deploy, and
 * a deadline moves at the moment nobody wants to be running a build.
 *
 * The topics, the author guidelines and the CEUR-ART requirement stay in React.
 * They are rules an author formats a paper against, and getting one subtly
 * wrong on the page somebody works from is worse than not having the page —
 * the same reason the code of conduct's policy text stays put.
 *
 * This constant is the fallback and is what renders when the collection is
 * empty, which is its normal state.
 */
const CALL: CallPageContent = {
  submitUrl: 'https://easychair.org/conferences?conf=kgc2026',
  submitLabel: 'Submit on EasyChair',
  datesConfirmed: false,
  dates: [
    { when: 'March 25, 2027', what: 'Paper submission deadline (11:59pm AoE)' },
    { when: 'April 9, 2027', what: 'Notification of acceptance' },
    { when: 'April 15, 2027', what: 'Camera-ready deadline' },
  ],
};

/** Deadlines are read per request: a moved date must not wait for a build. */
export const dynamic = 'force-dynamic';

export default async function CallForPostersPage() {
  const call = await pageContent(PAGE_CONTENT_KEYS.callForPosters, CALL);

  return (
    <>
      <section>
        <div className="wrap narrow">
          <p className="eyebrow">KGC {SITE.year}</p>
          <h1>Poster track</h1>
          <p className="lede">
            A forum for graduate students and early-career researchers to present applied research
            and emerging ideas to an industrial and interdisciplinary audience.
          </p>
          <p>
            The goal is to bridge research and practice, by highlighting work in knowledge graphs,
            ontologies, rules and hybrid AI systems that can be readily adopted, extended or
            evaluated in real-world settings. We especially encourage submissions showing how
            knowledge graphs, ontologies or rules complement modern AI systems — in accuracy,
            reasoning, governance and interoperability.
          </p>
          <p>
            Selected posters are presented in person at {SITE.venueShort}, {SITE.datesLong}.
          </p>
          {/*
            No button when there is no link. An organizer clearing `submitUrl`
            is saying submissions are not open, and a button that goes nowhere
            is worse than no button — it costs an author a click to find out.
          */}
          {call.submitUrl ? (
            <p>
              <a
                className="btn btn-primary"
                href={call.submitUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {call.submitLabel}
              </a>
            </p>
          ) : null}
        </div>
      </section>

      <section className="tint">
        <div className="wrap narrow">
          <h2>Topics of interest</h2>
          <p>
            Submissions may cover any area of research or application related to knowledge graphs
            and AI, including but not limited to:
          </p>
          <ul>
            {TOPICS.map((t) => (
              <li key={t} style={{ padding: '4px 0' }}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="wrap narrow">
          <h2>Author guidelines</h2>
          <p>
            A poster submission is a paper describing the work, its contribution to the field and
            its innovative aspects.
          </p>
          <ul>
            {RULES.map((r) => (
              <li key={r} style={{ padding: '4px 0' }}>
                {r}
              </li>
            ))}
          </ul>
          <p>
            Accepted poster papers are published in the Proceedings of the KGC {SITE.year} Poster
            Track and submitted to <a href="https://ceur-ws.org/">CEUR-WS.org</a> for online
            publication.
          </p>

          <h2 style={{ marginTop: 40 }}>Important dates</h2>
          {/*
            The provisional note is driven by the organizer's own assertion, not
            inferred from the dates: a full list of plausible deadlines looks
            exactly like a confirmed one, and an author planning their year
            around a date we invented is the failure this line prevents.
          */}
          {call.datesConfirmed ? null : (
            <p className="muted">Provisional — the {SITE.year} calendar is not final.</p>
          )}
          <ul>
            {call.dates.map((d) => (
              <li key={d.when} style={{ padding: '4px 0' }}>
                <strong>{d.when}</strong> — {d.what}
              </li>
            ))}
          </ul>

          <p style={{ marginTop: 32 }}>
            Posters are not the only way to present. The{' '}
            <Link href="/sponsor#speak">call for speakers</Link> covers talks, deep dives, panels
            and workshops.
          </p>
        </div>
      </section>
    </>
  );
}
