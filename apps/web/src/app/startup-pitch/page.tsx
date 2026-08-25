import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

/**
 * The startup pitch event — a page the live site has and we did not.
 *
 * Transcribed from `knowledgegraph.tech/startup-pitch/` rather than written, so
 * the framing, the reasons to enter and the format are the conference's own
 * words. Two things were changed deliberately and both are marked below: the
 * edition year, because this build is the 2027 site, and the deadlines, which
 * are the 2026 dates shifted by a year and are therefore **placeholders** — the
 * real ones do not exist yet and inventing a precise date that reads as
 * confirmed is the defect this repo keeps having.
 *
 * The claim that previous winners have raised over $100M, and the four companies
 * named, are real and are left exactly as the live page states them.
 */

export const metadata: Metadata = {
  title: 'Startup Pitch',
  description: `Pitch your knowledge graph startup to investors at the Knowledge Graph Conference ${SITE.year}, Cornell Tech NYC.`,
};

/**
 * PLACEHOLDER dates — the 2026 page's deadlines moved forward a year so the
 * sequence stays coherent. Replace when the real calendar is set.
 */
const DATES = [
  { when: 'April 16, 2027', what: 'Application deadline' },
  { when: 'April 23, 2027', what: 'Notification of acceptance' },
  { when: 'April 30, 2027', what: 'Startup pitch event, online' },
  { when: 'May 6, 2027', what: 'Winner announced live at the conference' },
];

const REASONS = [
  'Direct feedback on your product and vision from a panel of investors, industry experts and practitioners.',
  'The chance to pitch and network with investors and with other startups working in knowledge graphs.',
  'One complimentary conference ticket for each startup selected to join the event.',
  'The judges pick one startup from the event to present live during the conference.',
];

export default function StartupPitchPage() {
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
          <p>
            <a
              className="btn btn-primary"
              href="https://www.f6s.com/kgc-startup-pitch-2026/apply"
              target="_blank"
              rel="noreferrer noopener"
            >
              Submit your pitch
            </a>
          </p>
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
            Marked as provisional in the interface, not only in a comment. The
            live 2026 page carries firm dates; ours are shifted and nobody has
            confirmed them, and a date that looks confirmed is worse than no date.
          */}
          <p className="muted">Provisional — the {SITE.year} calendar is not final.</p>
          <ul>
            {DATES.map((d) => (
              <li key={d.when} style={{ padding: '4px 0' }}>
                <strong>{d.when}</strong> — {d.what}
              </li>
            ))}
          </ul>

          <p style={{ marginTop: 32 }}>
            Not a startup? <Link href="/sponsor">Sponsorship packages</Link> and the{' '}
            <Link href="/sponsor#speak">call for speakers</Link> are the other two ways in.
          </p>
        </div>
      </section>
    </>
  );
}
