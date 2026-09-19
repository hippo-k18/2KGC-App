import { PAGE_CONTENT_KEYS, type CallPageContent } from '@kgc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { callMilestones, pageContent } from '@/lib/data';
import { SITE } from '@/lib/site';

/**
 * The startup pitch event — a page the live site has and we did not.
 *
 * Transcribed from `knowledgegraph.tech/startup-pitch/` rather than written, so
 * the framing, the reasons to enter and the format are the conference's own
 * words. One thing was changed deliberately: the edition year, because this
 * build is the 2027 site. The four deadlines the 2026 page carries are **not**
 * reproduced — see the note on `CALL` below.
 *
 * The claim that previous winners have raised over $100M, and the four companies
 * named, are real and are left exactly as the live page states them.
 */

export const metadata: Metadata = {
  title: 'Startup Pitch',
  description: `Pitch your knowledge graph startup to investors at the Knowledge Graph Conference ${SITE.year}, Cornell Tech NYC.`,
};

/**
 * The application link and the calendar — editable without a deploy, for the
 * same reasons as `/call-for-posters`, which shares this shape.
 *
 * ── Why the F6S link stays and the poster page's did not ────────────────────
 *
 * `/call-for-posters` now sends submissions to our own `/submit/{callId}` when
 * a call is open, because `calls` can genuinely serve a poster: `poster` is one
 * of `SessionFormat`'s six values, `CallDoc.sessionTypes` is typed to that
 * vocabulary, and an accepted abstract is promoted into a session on the agenda.
 *
 * A pitch is none of those things. There is no `pitch` session format, so no
 * call can name this audience; what the portal collects is a title, an abstract,
 * a track and a session type, and what this page asks for is a ninety-second
 * video judged by investors. Bending one into the other would put a submission
 * into the reviewers' queue that has no rubric and no track, and would end with
 * a translation table between two vocabularies — the thing `CallDoc` chose
 * `SessionFormat` specifically to avoid. So the link stays external until the
 * pitch competition has a call of its own, and this is where to start when it
 * does.
 *
 * ── The dates are gone, not merely captioned ────────────────────────────────
 *
 * `dates` was four deadlines: the 2026 page's, moved forward a year so the
 * sequence stayed coherent. Nobody ever confirmed them, the page printed them
 * under "Important dates" with a muted line calling them provisional, and a
 * founder plans a quarter around the date rather than the caption. The owner
 * has since confirmed the 2027 calendar is unset, so the page says that and
 * prints nothing that looks like a deadline. An organizer entering real ones in
 * Content › Basics › Website Copy is what brings the list back.
 *
 * The reasons to enter, the format and the $100M claim stay in React — they are
 * the page's argument, not its calendar.
 */
const CALL: CallPageContent = {
  submitUrl: 'https://www.f6s.com/kgc-startup-pitch-2026/apply',
  submitLabel: 'Submit your pitch',
  datesConfirmed: false,
  dates: [],
};

/** Deadlines are read per request: a moved date must not wait for a build. */
export const dynamic = 'force-dynamic';

const REASONS = [
  'Direct feedback on your product and vision from a panel of investors, industry experts and practitioners.',
  'The chance to pitch and network with investors and with other startups working in knowledge graphs.',
  'One complimentary conference ticket for each startup selected to join the event.',
  'The judges pick one startup from the event to present live during the conference.',
];

export default async function StartupPitchPage() {
  const call = await pageContent(PAGE_CONTENT_KEYS.startupPitch, CALL);
  const dates = callMilestones(call.dates);

  return (
    <>
      <section>
        <div className="wrap narrow">
          <p className="eyebrow">KGC {SITE.year}</p>
          <h1>Startup Pitch</h1>
          <p className="lede">
            We invite startups at pre-seed, seed and Series A to submit their product for the
            virtual startup pitch event, held as part of the Knowledge Graph Conference.
          </p>
          <p>
            Previous winners have raised over $100M to date, including Nayya, gdotv, Lettria and
            Curiosity.ai. Connecting the dots is core to what we do, so show us how you are
            connecting the dots through knowledge graphs.
          </p>
          {/* No button when there is no link — see the note in call-for-posters. */}
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
          <h2>Why enter</h2>
          <p>
            The investor and startup event is an opportunity for investors to learn more about this
            domain, and about your company and vision in particular.
          </p>
          <ul>
            {REASONS.map((r) => (
              <li key={r} style={{ padding: '4px 0' }}>
                {r}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="wrap narrow">
          <h2>How to enter</h2>
          <p>
            Submit a short video introduction, 90 seconds maximum, by the application deadline. Do
            not upload sensitive or proprietary information. Startups selected to take part prepare
            a five-minute presentation for a live session with the judging panel.
          </p>
          <p>
            Questions go to{' '}
            <a href="mailto:startup-pitch@knowledgegraph.tech">startup-pitch@knowledgegraph.tech</a>
            .
          </p>

          <h2 style={{ marginTop: 40 }}>Important dates</h2>
          {/*
            Nothing here until a date exists to print. The live 2026 page carries
            firm dates; the four this page used to show were those shifted by a
            year, and a muted line calling them provisional did not stop them
            reading as a calendar to plan around. `datesConfirmed` still gates
            the caption, for dates an organizer has entered but not settled.
          */}
          {dates.length === 0 ? (
            <p className="muted">
              Dates to be announced. Questions:{' '}
              <a href="mailto:startup-pitch@knowledgegraph.tech">
                startup-pitch@knowledgegraph.tech
              </a>
              .
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
            Not a startup? <Link href="/sponsor">Sponsorship packages</Link> and the{' '}
            <Link href="/sponsor#speak">call for speakers</Link> are the other two ways in.
          </p>
        </div>
      </section>
    </>
  );
}
