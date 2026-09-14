'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  googleCalendarUrl,
  outlookCalendarUrl,
  sessionCalendarPath,
} from '@/lib/calendar';
import type { AgendaSession, SpeakerCard } from '@/lib/data';
import { localTime } from '@/lib/site';

/**
 * The agenda's session rows, and the detail dialog they open.
 *
 * ## Why this exists at all
 *
 * `/agenda` rendered a flat list and nothing else: a title, a cached list of
 * speaker *names*, a room and some tags. There was no way to read a session's
 * description, no portrait, no bio, and no way to put a session in your own
 * calendar. Whova's agenda opens a detail view on tap — title, time, room,
 * track, description, speakers with avatars, then "Add to My Agenda" — and the
 * absence of that here was the single largest gap between the two products on
 * this page.
 *
 * ## Why a dialog rather than a route
 *
 * A `/agenda/[id]` page would be the more obvious build, and it is the right one
 * eventually: it is linkable, crawlable and survives a paste into an email, all
 * of which this dialog is not. It is not what went in first for one reason —
 * the page above is `force-dynamic` and already holds every published session in
 * memory, so a dialog costs no extra read and no navigation, and a reader
 * skimming for the talk they want can open six of them in the time one route
 * change takes on a phone. When session detail earns its own address, this
 * component should become the thing that route renders, not a second copy.
 *
 * ## Why one dialog and not one per row
 *
 * There are 85 published sessions. Rendering 85 `<dialog>` elements to show at
 * most one would put 85 copies of every description and every speaker portrait
 * in the document. One element, with the chosen session in state, renders the
 * same thing.
 *
 * The element is a real `<dialog>` opened with `showModal()` rather than a div
 * with `role="dialog"`. That gets focus trapping, focus restoration to the row
 * that opened it, Escape, inertness of the page behind it and the top layer
 * from the browser, all of which are tedious to write and easy to write wrong.
 */

export interface AgendaListDay {
  day: string;
  heading: string;
  sessions: AgendaSession[];
}

/** Initials for the fallback portrait, the same two-letter rule `speaker-grid` uses. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AgendaList({
  days,
  speakers,
  origin,
}: {
  days: AgendaListDay[];
  /**
   * Speakers by id. A session's `speakerIds` may name a speaker that has no
   * record — `agendaSpeakers()` omits the key rather than inventing a
   * placeholder — so every lookup here is filtered, never defaulted.
   */
  speakers: Record<string, SpeakerCard>;
  /**
   * The canonical site origin, passed down rather than read here.
   *
   * `lib/calendar` defaults it to `publicSiteOrigin()`, which reads an
   * environment variable that carries no `NEXT_PUBLIC_` prefix and is therefore
   * absent in the browser: called from this component it would silently fall
   * back to the production default. That default happens to be the value a
   * calendar entry wants, which is exactly what makes it dangerous — it would
   * be right by luck, and wrong the moment the fallback changed. The server
   * knows the answer, so the server states it.
   */
  origin: string;
}) {
  const [open, setOpen] = useState<{ session: AgendaSession; heading: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  /*
   * `showModal()` is called from an effect rather than at the click, because the
   * element has to be in the document with the new session's content before it
   * is opened. Calling it in the handler opens the dialog one render early, so
   * the first paint is the *previous* session — visible as a flash of the wrong
   * talk every time you open the second one.
   */
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const close = useCallback(() => setOpen(null), []);

  return (
    <>
      {days.map((d) => (
        <div key={d.day}>
          <div className="day-head" id={d.day}>
            <h2>{d.heading}</h2>
            <span className="count">
              {d.sessions.length} session{d.sessions.length === 1 ? '' : 's'}
            </span>
          </div>

          {d.sessions.map((s) => (
            <button
              type="button"
              className="slot"
              key={s.id}
              onClick={() => setOpen({ session: s, heading: d.heading })}
            >
              <div className="when">
                {localTime(s.startsAtLocal)}
                <span>to {localTime(s.endsAtLocal)}</span>
              </div>
              <div>
                <h3>{s.title}</h3>
                {s.speakerNames.length > 0 && <div className="who">{s.speakerNames.join(' · ')}</div>}
                {s.roomName && <div className="where">{s.roomName}</div>}
                <div className="tags">
                  {s.trackName && (
                    <span
                      className="tag track"
                      style={s.trackColor ? ({ '--track': s.trackColor } as React.CSSProperties) : undefined}
                    >
                      {s.trackName}
                    </span>
                  )}
                  <span className="tag">{s.format}</span>
                  {s.skillLevel && <span className="tag">{s.skillLevel}</span>}
                </div>
              </div>
              <span className="slot-chevron" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m9 6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          ))}
        </div>
      ))}

      {/*
        `onClose` keeps React's state in step with the dialog when the browser
        closes it for us — Escape, or the platform's own dismissal. Without it
        the element is shut while `open` still holds a session, and the next
        click on the same row sets identical state, runs no effect and opens
        nothing.

        `onClick` handles the backdrop. A click on the backdrop reports the
        dialog itself as its target, because the backdrop is a pseudo-element
        and has none of its own; a click on anything inside reports that child.
      */}
      <dialog
        ref={dialogRef}
        className="session-dialog"
        aria-labelledby="session-dialog-title"
        onClose={close}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        {open && (
          <div className="session-dialog-inner">
            <button
              type="button"
              className="session-dialog-close"
              onClick={close}
              aria-label="Close session details"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m5 5 14 14M19 5 5 19"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="session-dialog-head">
              <p className="session-dialog-when">
                {open.heading}, {localTime(open.session.startsAtLocal)} to{' '}
                {localTime(open.session.endsAtLocal)}
              </p>
              <h2 id="session-dialog-title">{open.session.title}</h2>
              {open.session.roomName && (
                <p className="session-dialog-where">{open.session.roomName}</p>
              )}
              <div className="tags">
                {open.session.trackName && (
                  <span
                    className="tag track"
                    style={
                      open.session.trackColor
                        ? ({ '--track': open.session.trackColor } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {open.session.trackName}
                  </span>
                )}
                <span className="tag">{open.session.format}</span>
                {open.session.skillLevel && <span className="tag">{open.session.skillLevel}</span>}
              </div>
            </div>

            {open.session.description && (
              <div className="session-dialog-body">
                {/*
                  Split on blank lines rather than rendering one block. Every
                  published description here is prose of a few paragraphs, and
                  Whova's own users complained that their session descriptions
                  render as "a block of text that was difficult to read".
                */}
                {open.session.description
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            )}

            <SessionSpeakers session={open.session} speakers={speakers} />

            <CalendarActions session={open.session} origin={origin} />
          </div>
        )}
      </dialog>
    </>
  );
}

/**
 * The speakers on a session, with whatever the speaker record actually holds.
 *
 * ⚠️ Measured against the live project: 137 speaker documents, of which **none
 * has a bio** and 13 have no portrait. The roster was imported from the 2026
 * Whova export, which carries no bio field, and nobody has written one in
 * Speaker Manager since. So this renders a name, a job title and a company for
 * almost everyone and a paragraph for nobody — and it must not pretend
 * otherwise. Every field below is conditional for that reason, the section
 * disappears entirely when a session has no speakers at all (two do, both
 * receptions), and there is no "Bio coming soon" placeholder, because a promise
 * on a page is a promise somebody has to keep.
 */
function SessionSpeakers({
  session,
  speakers,
}: {
  session: AgendaSession;
  speakers: Record<string, SpeakerCard>;
}) {
  const found = session.speakerIds.map((id) => speakers[id]).filter(Boolean) as SpeakerCard[];

  /*
   * The denormalised names are the fallback, not the primary. If the speaker
   * documents could not be read the names still render, which is a visible
   * degradation rather than a blank panel.
   */
  if (found.length === 0) {
    if (session.speakerNames.length === 0) return null;
    return (
      <section className="session-dialog-speakers">
        <h3>{session.speakerNames.length === 1 ? 'Speaker' : 'Speakers'}</h3>
        <p className="session-speaker-names">{session.speakerNames.join(' · ')}</p>
      </section>
    );
  }

  return (
    <section className="session-dialog-speakers">
      <h3>{found.length === 1 ? 'Speaker' : 'Speakers'}</h3>
      {found.map((s) => (
        <article className="session-speaker" key={s.id}>
          {s.photoURL ? (
            /*
             * A plain <img>, for the reason `speaker-grid.tsx` gives: portraits
             * come from arbitrary upstream hosts and `next/image` would render a
             * 400 for any host not listed in `images.remotePatterns`.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="session-speaker-photo"
              src={s.photoURL}
              alt=""
              width={s.photoWidth ?? 96}
              height={s.photoHeight ?? 96}
              loading="lazy"
            />
          ) : (
            <div className="session-speaker-photo is-fallback" aria-hidden="true">
              {initials(s.name)}
            </div>
          )}
          <div className="session-speaker-text">
            <p className="session-speaker-name">{s.name}</p>
            {s.title && <p className="session-speaker-role">{s.title}</p>}
            {s.company && <p className="session-speaker-org">{s.company}</p>}
            {s.bio && <p className="session-speaker-bio">{s.bio}</p>}
          </div>
        </article>
      ))}
    </section>
  );
}

/**
 * Add to My Calendar.
 *
 * Three plain links rather than a picker that posts somewhere: the `.ics` is a
 * download served by a route, and Google and Outlook take a pre-filled compose
 * URL. All three are `<a>` elements with real `href`s, so they work with
 * JavaScript off and can be opened in a new tab, copied or bookmarked.
 *
 * Whova's web client does the same thing behind one button — "Add to My Agenda"
 * opens a dialog asking which calendar. Here the dialog is already open, so the
 * intermediate step would be a dialog inside a dialog.
 */
function CalendarActions({ session, origin }: { session: AgendaSession; origin: string }) {
  /*
   * Both URLs are built here, for the one session that is open, rather than
   * server-side for all 85.
   *
   * `lib/calendar` is deliberately pure — no `server-only`, no `db()`, no React
   * — so it runs in either place. Building them on the server would mean the
   * page's payload carried two long pre-filled compose URLs per session, each
   * embedding that session's whole description, to render at most one pair. The
   * `.ics` is the opposite case: it is a route, so its href is just a path.
   */
  const google = googleCalendarUrl(session, { origin });
  const outlook = outlookCalendarUrl(session, { origin });

  return (
    <section className="session-dialog-cal">
      <h3>Add to my calendar</h3>
      <div className="cal-links">
        <a className="btn btn-primary btn-sm" href={sessionCalendarPath(session.id)}>
          Apple or Outlook desktop
          <span className="sr-only">, downloads an ics file for {session.title}</span>
        </a>
        <a className="btn btn-outline btn-sm" href={google} target="_blank" rel="noreferrer">
          Google Calendar
        </a>
        <a className="btn btn-outline btn-sm" href={outlook} target="_blank" rel="noreferrer">
          Outlook.com
        </a>
      </div>
      <p className="cal-note">
        Times are local to the venue. Your calendar converts them to whatever zone you are in.
      </p>
    </section>
  );
}
