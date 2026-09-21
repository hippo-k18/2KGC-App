'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { googleCalendarUrl, outlookCalendarUrl, sessionCalendarPath } from '@kgc/shared';
import type { AgendaSession, PublicDocument, SpeakerCard } from '@/lib/data';
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
    .replace(/[^\p{L}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

interface Band {
  startsAtLocal: string;
  endsAtLocal: string;
  sessions: AgendaSession[];
}

/**
 * Consecutive sessions sharing a start time, as one band.
 *
 * `listAgenda()` already sorts by `startsAtLocal`, so a single pass comparing
 * against the previous entry is enough and nothing needs re-sorting here. The
 * band's end time is the *latest* end among its sessions rather than the first
 * one's: four talks starting at 09:00 do not all run to the same minute, and
 * printing the first one's end as though it covered the others would state
 * something false about the three beside it.
 */
function bandsOf(sessions: AgendaSession[]): Band[] {
  const bands: Band[] = [];
  for (const s of sessions) {
    const last = bands[bands.length - 1];
    if (last && last.startsAtLocal === s.startsAtLocal) {
      last.sessions.push(s);
      if (s.endsAtLocal > last.endsAtLocal) last.endsAtLocal = s.endsAtLocal;
    } else {
      bands.push({ startsAtLocal: s.startsAtLocal, endsAtLocal: s.endsAtLocal, sessions: [s] });
    }
  }
  return bands;
}

/**
 * The speakers on a row: a portrait each, then the names.
 *
 * ⚠️ This renders from `speakerIds` resolved against the speaker documents, and
 * falls back to the denormalised `speakerNames` only when none of the ids
 * resolve. The two can disagree — the cache is written by the importer and
 * nothing repairs it — and when they do, the records are the truthful half.
 *
 * 124 of the 137 published speakers have a portrait, so the initials circle is
 * an ordinary case here rather than a defensive one, and it is the same
 * treatment `/speakers` already gives them.
 */
function SessionPeople({
  session,
  speakers,
}: {
  session: AgendaSession;
  speakers: Record<string, SpeakerCard>;
}) {
  const found = session.speakerIds.map((id) => speakers[id]).filter(Boolean) as SpeakerCard[];

  if (found.length === 0) {
    if (session.speakerNames.length === 0) return null;
    return <span className="session-people plain">{session.speakerNames.join(' · ')}</span>;
  }

  return (
    <span className="session-people">
      <span className="session-faces">
        {found.map((s) =>
          s.photoURL ? (
            /* A plain <img> for the reason `speaker-grid.tsx` gives: these come
               from arbitrary upstream hosts and `next/image` would 400 on any
               host missing from `images.remotePatterns`. */
            // eslint-disable-next-line @next/next/no-img-element
            <img key={s.id} src={s.photoURL} alt="" width={26} height={26} loading="lazy" />
          ) : (
            <span key={s.id} className="is-fallback" aria-hidden="true">
              {initials(s.name)}
            </span>
          ),
        )}
      </span>
      <span className="session-names">
        {found.map((s) => (
          <span key={s.id} className="session-name">
            <b>{s.name}</b>
            {s.company && <i>{s.company}</i>}
          </span>
        ))}
      </span>
    </span>
  );
}

export function AgendaList({
  days,
  speakers,
  documentsBySession,
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
   * The handouts attached to each session, keyed by session id.
   *
   * Grouped on the server from `listPublicDocuments()`, which is the
   * unrestricted subset and has no parameter that widens it — so there is no
   * restricted deck to leak here, whatever this component does with the map.
   * Sessions with nothing attached are absent rather than mapped to an empty
   * array, so a lookup is `?? []` at the one place that reads it.
   */
  documentsBySession: Record<string, PublicDocument[]>;
  /**
   * The canonical site origin, passed down rather than read here.
   *
   * `@kgc/shared`'s calendar builders default it to `publicSiteOrigin()`, which reads an
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
          {/*
            The session count that used to sit beside the day heading is gone,
            at the owner's request while reviewing the mockup. The number is
            still in the standfirst at the top of the page, once, for the whole
            programme.
          */}
          <div className="day-head" id={d.day}>
            <h2>{d.heading}</h2>
          </div>

          {bandsOf(d.sessions).map((band) => (
            <section className="timeband" key={band.startsAtLocal}>
              {/*
                One time label for every session that starts at that minute.
                Tuesday runs four sessions at once in each of five slots, so the
                old row-per-session layout printed the same time four times over
                and spent a line doing it. Grouping says the true thing instead:
                these four overlap, so you are choosing between them.
              */}
              <div className="timeband-head">
                <b>{localTime(band.startsAtLocal)}</b>
                <em>to {localTime(band.endsAtLocal)}</em>
                <span className="timeband-rule" />
                <span className="timeband-count">
                  {band.sessions.length} session{band.sessions.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="timeband-grid">
                {band.sessions.map((s) => (
                  <button
                    type="button"
                    className="session"
                    key={s.id}
                    style={s.trackColor ? ({ '--track': s.trackColor } as React.CSSProperties) : undefined}
                    onClick={() => setOpen({ session: s, heading: d.heading })}
                  >
                    {/* The track, as a rule down the edge rather than a chip. */}
                    <span className="session-edge" aria-hidden="true" />
                    <span className="session-main">
                      <span className="session-title">{s.title}</span>
                      <span className="session-meta">
                        {s.trackName && <span className="session-track">{s.trackName}</span>}
                        {s.roomName && <span>{s.roomName}</span>}
                        <span>{s.format}</span>
                        {s.skillLevel && <span>{s.skillLevel}</span>}
                      </span>
                      <SessionPeople session={s} speakers={speakers} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
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

            {/*
              The deck, when the speaker has sent one through their own profile
              link and an organizer has approved it. Conditional like every
              other field in this dialog: most sessions have no slides until the
              day itself, and a "Slides coming soon" line would be a promise
              nobody here can keep.
            */}
            {open.session.slidesUrl && (
              <section className="session-dialog-speakers">
                <h3>Slides</h3>
                <p>
                  <a href={open.session.slidesUrl} target="_blank" rel="noreferrer">
                    Open the slides for this session
                  </a>
                </p>
              </section>
            )}

            <SessionMaterials documents={documentsBySession[open.session.id] ?? []} />

            <CalendarActions session={open.session} origin={origin} />
          </div>
        )}
      </dialog>
    </>
  );
}

/**
 * The handouts an organizer attached to this session.
 *
 * Conditional like every other section in this dialog: most sessions have
 * nothing attached, and a "Materials coming soon" line is a promise somebody
 * would have to keep. The host is printed under each title for the reason
 * `/documents` prints it — every one of these is a link to a file somebody else
 * is hosting, and a reader about to open a 40MB PDF on conference Wi-Fi is
 * entitled to know whose server they are about to reach.
 */
function SessionMaterials({ documents }: { documents: PublicDocument[] }) {
  if (documents.length === 0) return null;

  return (
    <section className="session-dialog-speakers">
      <h3>Materials</h3>
      {documents.map((d) => (
        <p key={d.id}>
          <a href={d.url} target="_blank" rel="noreferrer noopener">
            {d.title}
          </a>
          {d.host && <span className="doc-host"> · {d.host}</span>}
        </p>
      ))}
    </section>
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
   * `@kgc/shared`'s calendar module is deliberately pure — no `server-only`, no
   * `db()`, no React — so it runs in either place, and in the attendee app,
   * which offers the same three destinations on its session screen. Building
   * them on the server would mean the
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
