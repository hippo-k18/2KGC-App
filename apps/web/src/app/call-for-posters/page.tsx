import { PAGE_CONTENT_KEYS, type CallPageContent } from '@kgc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { callMilestones, pageContent } from '@/lib/data';
import { SITE } from '@/lib/site';
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
 * states that the calendar is not settled and prints nothing that looks like a
 * deadline until something can source one.
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

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * A call's `closesAtLocal` as a printed deadline, or null if it cannot be read.
 *
 * String surgery rather than `Date`, deliberately. `closesAtLocal` is wall time
 * in the call's own zone — the authoring truth, exactly as on `SessionDoc` —
 * and putting it through a `Date` on a server that runs in UTC on Netlify and
 * in something else on a laptop is how "23:59 in New York" becomes 03:59 the
 * next morning on the public page. The zone is printed beside it because a
 * deadline without one is not a deadline.
 */
function printedDeadline(closesAtLocal: string, timeZone: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(closesAtLocal);
  if (!parts) return null;
  const [, year, month, day, hour, minute] = parts;
  const name = MONTHS[Number(month) - 1];
  if (!name) return null;
  return `${name} ${Number(day)}, ${year}, ${hour}:${minute} (${timeZone})`;
}

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

  const deadline = printedDeadline(open.closesAtLocal, open.timeZone);
  return {
    submitUrl: `/submit/${open.id}`,
    submitLabel: 'Submit a poster',
    datesConfirmed: deadline !== null,
    dates: deadline ? [{ when: deadline, what: 'Poster submission deadline' }] : [],
  };
}

/** Deadlines are read per request: a moved date must not wait for a build. */
export const dynamic = 'force-dynamic';

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
            A date is printed only when something could source it — the open
            call's own `closesAtLocal`, or a deadline an organizer typed into
            Website Copy. Otherwise the page says the calendar is not settled and
            prints nothing, because the three deadlines this section used to
            carry were the 2026 dates moved forward a year and the muted line
            calling them provisional did not stop them reading as a date to plan
            around. `datesConfirmed` still gates the caption, for the case where
            an organizer has entered dates they are not finished arguing about.
          */}
          {dates.length === 0 ? (
            <p className="muted">
              Dates to be announced. Questions:{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
            </p>
          ) : (
            <>
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
          )}

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
