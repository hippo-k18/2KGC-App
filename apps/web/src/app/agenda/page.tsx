import type { Metadata } from 'next';
import Link from 'next/link';
import { listAgenda } from '@/lib/data';
import { formatDayHeading, localTime, SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Agenda',
  description: 'The full five-day programme for the Knowledge Graph Conference 2027.',
};

/**
 * The programme, read from the `sessions` collection and grouped by day.
 *
 * Times shown are the stored wall clock, which is already local to the venue
 * (`SessionDoc.startsAtLocal`, interpreted against `TIME_ZONE`). Nothing here
 * touches the visitor's own zone: an agenda that silently renders in the
 * reader's timezone is how someone in London turns up to a 09:00 keynote at
 * 14:00. The zone is stated on the page instead.
 */
export const dynamic = 'force-dynamic';

export default async function AgendaPage() {
  const days = await listAgenda();
  const total = days.reduce((n, d) => n + d.sessions.length, 0);

  return (
    <section>
      <div className="wrap">
        <p className="eyebrow">{SITE.datesLong}</p>
        <h1>Agenda</h1>
        <p className="lede">
          {total} published sessions across {days.length} days at {SITE.venue}. All times are local
          to the venue ({SITE.timeZone.replace('_', ' ')}). The programme firms up through the
          spring; the <Link href="/tickets">KGC app</Link> keeps your own schedule in sync.
        </p>

        {days.length === 0 ? (
          <p className="notice" style={{ marginTop: 28 }}>
            The programme is still being assembled. <Link href="/speakers">Speakers</Link> are being
            announced as they are confirmed.
          </p>
        ) : (
          <>
            <nav className="day-nav" aria-label="Jump to day" style={{ marginTop: 28 }}>
              {days.map((d) => (
                <a key={d.day} href={`#${d.day}`}>
                  {formatDayHeading(d.day)}
                </a>
              ))}
            </nav>

            {days.map((d) => (
              <div key={d.day}>
                <div className="day-head" id={d.day}>
                  <h2>{formatDayHeading(d.day)}</h2>
                  <span className="count">
                    {d.sessions.length} session{d.sessions.length === 1 ? '' : 's'}
                  </span>
                </div>

                {d.sessions.map((s) => (
                  <article className="slot" key={s.id}>
                    <div className="when">
                      {localTime(s.startsAtLocal)}
                      <span>to {localTime(s.endsAtLocal)}</span>
                    </div>
                    <div>
                      <h3>{s.title}</h3>
                      {s.speakerNames.length > 0 && (
                        <div className="who">{s.speakerNames.join(' · ')}</div>
                      )}
                      {s.roomName && <div className="where">{s.roomName}</div>}
                      <div className="tags">
                        {s.trackName && (
                          <span
                            className="tag track"
                            style={
                              s.trackColor
                                ? ({ '--track': s.trackColor } as React.CSSProperties)
                                : undefined
                            }
                          >
                            {s.trackName}
                          </span>
                        )}
                        <span className="tag">{s.format}</span>
                        {s.skillLevel && <span className="tag">{s.skillLevel}</span>}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
