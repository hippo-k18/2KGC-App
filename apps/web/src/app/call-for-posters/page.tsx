import { PAGE_CONTENT_KEYS, type CallPageContent } from '@kgc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { callMilestones, pageContent } from '@/lib/data';
import { formatDeadline, SITE } from '@/lib/site';
import { openCallFor, type OpenCall } from '@/lib/submissions';

/**
 * The poster track — transcribed from `knowledgegraph.tech/call-for-posters/`.
 *
 * The submission rules are reproduced exactly, because they are rules: page
 * counts, the CEUR-ART format requirement, that double-blind is *not* required
 * and that proceedings go to CEUR-WS. Getting any of those subtly wrong on a
 * page an author works from is worse than not having the page.
 *
 * The chairs named on the live page are real people and are left as stated.
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
 * Where a poster goes when we are not running the call ourselves.
 *
 * ⚠️ **The URL still names `kgc2026` and that is left exactly as it is.** It is
 * the address that currently works, an organizer can change it without a deploy
 * from Content › Basics › Website Copy, and replacing a working external link
 * with a guess at next year's is not an improvement. What has changed is that
 * this is now the *second* answer rather than the only one — see `defaults()`.
 *
 * `dates` is empty on purpose. It used to hold three deadlines, and they were
 * the 2026 dates shifted forward a year: nobody ever confirmed them, the file
 * said PLACEHOLDER in a comment, and the page printed them under a heading
 * reading "Important dates" with a muted line calling them provisional. An
 * author plans a term around the date, not around the caption. So the page now
 * prints no date section at all until something can source one, rather than a
 * heading standing over a line saying there is nothing to print.
 *
 * The topics, the author guidelines and the CEUR-ART requirement stay in React.
 * They are rules an author formats a paper against, and getting one subtly
 * wrong on the page somebody works from is worse than not having the page —
 * the same reason the code of conduct's policy text stays put.
 */
const EXTERNAL_CALL: CallPageContent = {
  submitUrl: 'https://easychair.org/conferences?conf=kgc2026',
  submitLabel: 'Submit on EasyChair',
  datesConfirmed: false,
  dates: [],
};

/**
 * What the page says before an organizer has edited a word of it.
 *
 * Two answers, and which one renders is read from `calls` on every request
 * rather than from a flag: an open call accepting posters brings submissions
 * in-house, and anything else — no call, a draft one, one that has closed —
 * leaves the external link exactly where it was. `CFA-PLAN.md` §6 held that
 * link back until phase 4 shipped, on the grounds that half a pipeline is worse
 * than an external one that works; phase 4 has shipped, and the fallback is
 * still the whole of that argument for the months when no call is running.
 *
 * ⚠️ Only the **close** is printed. `CallDoc` carries no notification or
 * camera-ready date, so the other two lines this page used to show have nothing
 * behind them and are not invented back. `datesConfirmed` is true here because
 * the deadline came from the call the button points at — which is the only
 * sense in which this page has ever been able to confirm a date.
 *
 * This is the *fallback* handed to `pageContent`, so an organizer who types a
 * deadline into Website Copy still overrides it. That ordering is right: the
 * call is derived, and what a human typed is a statement.
 */
function defaults(open: OpenCall | null): CallPageContent {
  if (!open) return EXTERNAL_CALL;

  const deadline = formatDeadline(open.closesAtLocal, open.timeZone);
  return {
    submitUrl: `/submit/${open.id}`,
    submitLabel: 'Submit a poster',
    datesConfirmed: deadline !== null,
    dates: deadline ? [{ when: deadline, what: 'Poster submission deadline' }] : [],
  };
}

/** Deadlines are read per request: a moved date must not wait for a build. */
/**
 * Rendered once and reused for up to a minute, rather than from scratch on
 * every visit. The deadline is a stored value an organizer moves.
 *
 * Every page on this site was `force-dynamic`, so nothing was ever cached by
 * anybody: the agenda took 0.81 to 0.95 seconds to first byte on the live site
 * against 0.06 for a page that read nothing. No visitor now pays for a query
 * another visitor has already made.
 *
 * Thirty seconds and not sixty, because this window sits on top of the one in
 * `shared()` and the two add up. See `SHARED_SECONDS` in `lib/data.ts`: thirty
 * over thirty is a change on the site inside a minute, which is what an
 * organizer who saves and switches tab is waiting for.
 */
export const revalidate = 30;

export default async function CallForPostersPage() {
  const open = await openCallFor('poster');
  const call = await pageContent(PAGE_CONTENT_KEYS.callForPosters, defaults(open));
  const dates = callMilestones(call.dates);
  /*
   * A relative `submitUrl` is our own portal and must not open in a new tab or
   * carry `rel="noopener"` — both of those describe handing somebody to a third
   * party. It is also a `<Link>`, so the client router keeps the navigation
   * inside the site.
   */
  const ownPortal = call.submitUrl.startsWith('/');

  return (
    <>
      {/*
        Three sections, one background.

        The middle band used to be tinted, which made the page a white / tint /
        white stripe where the only thing separating one part of the argument
        from the next was a change of colour. The sections are now told apart by
        spacing alone: 80px between two of them against 14px between a heading
        and the paragraph under it, so what belongs together sits together.
      */}
      <section style={{ paddingBottom: 40 }}>
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
            knowledge graphs, ontologies or rules complement modern AI systems in accuracy,
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
              {ownPortal ? (
                <Link className="btn btn-primary" href={call.submitUrl}>
                  {call.submitLabel}
                </Link>
              ) : (
                <a
                  className="btn btn-primary"
                  href={call.submitUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {call.submitLabel}
                </a>
              )}
            </p>
          ) : null}
        </div>
      </section>

      <section style={{ paddingBlock: 40 }}>
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

      <section style={{ paddingTop: 40 }}>
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

          <p>
            Questions go to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>

          {/*
            A date is printed only when something could source it — the open
            call's own `closesAtLocal`, or a deadline an organizer typed into
            Website Copy. Otherwise the heading does not appear either, because
            the three deadlines this section used to carry were the 2026 dates
            moved forward a year, the muted line calling them provisional did not
            stop them reading as a date to plan around, and the line that
            replaced them — "Dates to be announced" — was a heading and a stop
            with no fact between them. `datesConfirmed` still gates the caption,
            for the case where an organizer has entered dates they are not
            finished arguing about.
          */}
          {dates.length > 0 ? (
            <>
              <h2 style={{ marginTop: 40 }}>Dates</h2>
              {call.datesConfirmed ? null : (
                <p className="muted">Provisional. The {SITE.year} calendar is not final.</p>
              )}
              <ul>
                {dates.map((d) => (
                  <li key={d.when} style={{ padding: '4px 0' }}>
                    <strong>{d.when}</strong>: {d.what}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

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
