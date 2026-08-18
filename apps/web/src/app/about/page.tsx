import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About KGC',
  description:
    'What the Knowledge Graph Conference is, where it happens, and how to get to Cornell Tech on Roosevelt Island.',
};

export default function AboutPage() {
  return (
    <>
      <section>
        <div className="wrap narrow">
          <p className="eyebrow">About</p>
          <h1>About KGC</h1>
          <p className="lede">
            The Knowledge Graph Conference started in 2019 as a small academic gathering in New York
            and turned into the place enterprise practitioners go to compare notes on making
            heterogeneous data mean something.
          </p>
          <p>
            The through-line has not changed: knowledge graphs are how organisations get from
            documents and tables to something a machine can reason over — and, lately, how they stop
            a language model from confidently making things up. The technology is old enough to have
            production scar tissue, which is exactly what makes the talks worth attending.
          </p>
          <p>
            KGC is independent. The programme is chosen by a committee of practitioners, sponsors buy
            their placement on the programme, not its content, and the schedule leaves real gaps because the hallway is
            half the value.
          </p>
        </div>
      </section>

      <section className="tint">
        <div className="wrap">
          <h2>Venue and travel</h2>
          <div className="grid g2" style={{ marginTop: 22 }}>
            <div className="card">
              <h3>Cornell Tech, Roosevelt Island</h3>
              <p>
                {SITE.venue}. Purpose-built, sensible rooms, decent coffee and a view of Manhattan
                that makes the tram ride worth it on its own.
              </p>
              <p className="muted" style={{ fontSize: '0.92rem', marginBottom: 0 }}>
                {SITE.datesLong} · all times {SITE.timeZone.replace('_', ' ')}
              </p>
            </div>
            <div className="card">
              <h3>Getting there</h3>
              <p>
                The F train stops at Roosevelt Island. The Roosevelt Island Tramway leaves from 59th
                Street and Second Avenue and takes four minutes — it accepts a MetroCard or OMNY, and
                it is the better arrival.
              </p>
              <p style={{ marginBottom: 0 }}>
                From JFK or LaGuardia, allow an hour. Hotel blocks are announced in the new year.
              </p>
            </div>
            <div className="card">
              <h3>Accessibility</h3>
              <p>
                The venue is step-free throughout. Live captioning runs on the main stage, and
                dietary and access requirements can be sent to{' '}
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> at any point before
                the conference.
              </p>
            </div>
            <div className="card">
              <h3>The KGC app</h3>
              <p>
                Your ticket, agenda, badge QR, the attendee directory and messaging, on iPhone and
                Android. It arrives with your registration — see{' '}
                <Link href="/tickets">tickets</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="code-of-conduct">
        <div className="wrap narrow">
          <h2>Code of conduct</h2>
          <p>
            KGC is a professional event and we expect it to feel like one. Harassment of any kind —
            including sustained disruption of talks, unwelcome attention, and comments directed at
            someone’s identity rather than their argument — is not tolerated, in the venue, in the
            app, or in the conference Slack.
          </p>
          <p>
            Report anything to a staff member in a KGC shirt, through the app, or at{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. Reports are handled by
            the organisers, quickly and without publicity toward the reporter. Sanctions run from a
            word in private to removal without refund.
          </p>
          <p>
            Disagreement is welcome and is most of the point. Contempt is not.
          </p>
        </div>
      </section>
    </>
  );
}
