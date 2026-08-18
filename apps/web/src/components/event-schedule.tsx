'use client';

import { useMemo, useState } from 'react';
import type { AgendaDay } from '@/lib/data';
import { formatDayTab, localTime, SITE } from '@/lib/site';

/**
 * The "Event Schedule" panel: search, track filter, day tabs, session list.
 *
 * It lives here rather than inside `components/home/` because the homepage and
 * `/agenda` show the same control and must not drift apart. The live site gets
 * away with duplicating it only because both copies are the same third-party
 * iframe — which is the thing this project exists to delete.
 *
 * **On the blue.** The live widget paints the selected day tab `#2b6cb0`. That
 * colour is not in the KGC theme at all; it is Whova's, and copying it once
 * already cost this stylesheet its palette (see the header of `globals.css`).
 * The selected tab here is `--navy`, the theme's own `--global-palette2`, which
 * is the site's real "solid blue block".
 *
 * Everything is derived from the `sessions` collection that was passed in.
 * There is no second fetch and no client Firebase SDK in this app.
 */

export interface EventScheduleProps {
  days: AgendaDay[];
  /** Rendered above the panel. Omitted on `/agenda`, which has its own `h1`. */
  heading?: string;
  /** Cap the sessions shown per day; the homepage teases, `/agenda` does not. */
  limitPerDay?: number;
  /** Where "see the rest" points, when `limitPerDay` actually hid something. */
  moreHref?: string;
}

export function EventSchedule({
  days,
  heading = 'Event Schedule',
  limitPerDay,
  moreHref,
}: EventScheduleProps) {
  const [dayIndex, setDayIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [track, setTrack] = useState('');

  // Track names come off the sessions themselves (`primaryTrackName` is a
  // denormalised display cache the importer owns), so the filter can never
  // offer a track that no session on the page belongs to.
  const tracks = useMemo(() => {
    const names = new Set<string>();
    for (const d of days) for (const s of d.sessions) if (s.trackName) names.add(s.trackName);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [days]);

  const active = days[Math.min(dayIndex, Math.max(days.length - 1, 0))];

  const matches = useMemo(() => {
    if (!active) return [];
    const q = query.trim().toLowerCase();
    return active.sessions.filter((s) => {
      if (track && s.trackName !== track) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        s.speakerNames.some((n) => n.toLowerCase().includes(q)) ||
        (s.roomName ?? '').toLowerCase().includes(q)
      );
    });
  }, [active, query, track]);

  const shown = limitPerDay ? matches.slice(0, limitPerDay) : matches;
  const hidden = matches.length - shown.length;

  if (days.length === 0) {
    return (
      <div className="schedule">
        <div className="schedule-head">
          <h2>{heading}</h2>
        </div>
        <p className="schedule-empty">
          The {SITE.year} programme is still being assembled. Sessions appear here as they are
          confirmed.
        </p>
      </div>
    );
  }

  return (
    <div className="schedule">
      <div className="schedule-head">
        <h2>{heading}</h2>
        <div className="schedule-tools">
          <ScheduleActions />
          <form className="schedule-search" role="search" onSubmit={(e) => e.preventDefault()}>
            <label className="sr-only" htmlFor="schedule-search">
              Search the schedule
            </label>
            <input
              id="schedule-search"
              type="search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="schedule-search-icon" aria-hidden="true">
              <SearchIcon />
            </span>
          </form>
        </div>
      </div>

      <div className="schedule-filter">
        <label className="sr-only" htmlFor="schedule-track">
          Filter by track
        </label>
        <select id="schedule-track" value={track} onChange={(e) => setTrack(e.target.value)}>
          <option value="">Filter by Track</option>
          {tracks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/*
        Tabs, not links: `role="tablist"` with arrow-key roving focus, because a
        day picker that only answers a mouse is a regression however identical
        it looks. `/agenda` renders every day as a heading instead, so nothing
        here is the only route to a session.
      */}
      <div className="schedule-days" role="tablist" aria-label="Conference days">
        {days.map((d, i) => {
          const { weekday, date } = formatDayTab(d.day);
          const selected = i === dayIndex;
          return (
            <button
              key={d.day}
              type="button"
              role="tab"
              id={`day-tab-${d.day}`}
              aria-selected={selected}
              aria-controls={`day-panel-${d.day}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'day-tab is-selected' : 'day-tab'}
              onClick={() => setDayIndex(i)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = (i + (e.key === 'ArrowRight' ? 1 : days.length - 1)) % days.length;
                setDayIndex(next);
                document.getElementById(`day-tab-${days[next].day}`)?.focus();
              }}
            >
              <span className="weekday">{weekday}</span>
              <span className="date">{date}</span>
            </button>
          );
        })}
      </div>

      <p className="schedule-zone">
        Displaying the agenda in the event timezone ({SITE.timeZone.replace('_', ' ')}).
      </p>

      <div
        className="schedule-list"
        role="tabpanel"
        id={`day-panel-${active.day}`}
        aria-labelledby={`day-tab-${active.day}`}
      >
        {shown.length === 0 ? (
          <p className="schedule-empty">Nothing on this day matches that search.</p>
        ) : (
          shown.map((s) => (
            <article key={s.id} className="schedule-item">
              <h3>{s.title}</h3>
              <p className="when">
                {localTime(s.startsAtLocal)} – {localTime(s.endsAtLocal)}
                {s.roomName ? ` · ${s.roomName}` : ''}
              </p>
              {s.speakerNames.length > 0 && <p className="who">{s.speakerNames.join(', ')}</p>}
              {s.trackName && (
                <span className="schedule-track" style={{ '--track': s.trackColor } as React.CSSProperties}>
                  {s.trackName}
                </span>
              )}
            </article>
          ))
        )}
      </div>

      {hidden > 0 && moreHref && (
        <p className="schedule-more">
          <a href={moreHref}>
            {hidden} more session{hidden === 1 ? '' : 's'} on this day — see the full agenda →
          </a>
        </p>
      )}
    </div>
  );
}

/**
 * Print and share.
 *
 * The live widget's second icon is a phone that advertises Whova's app store
 * listing. Ours points at the KGC app, which is the entire point of the
 * project. The share links are plain intent URLs — no third-party script, so
 * nothing here needs a consent banner entry.
 */
function ScheduleActions() {
  const url = 'https://www.knowledgegraph.tech/';
  const text = `${SITE.name} — ${SITE.datesShort}`;
  return (
    <div className="schedule-actions">
      <button type="button" onClick={() => window.print()} aria-label="Print the schedule">
        <PrintIcon />
      </button>
      <a href="/tickets" aria-label="Get the KGC mobile app">
        <PhoneIcon />
      </a>
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Share on Facebook"
      >
        <FacebookIcon />
      </a>
      <a
        href={`https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Share on X"
      >
        <XIcon />
      </a>
      <a
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Share on LinkedIn"
      >
        <LinkedInIcon />
      </a>
    </div>
  );
}

/* Inline SVG rather than an icon font: five glyphs do not justify a webfont,
   and a webfont is another render-blocking request on the first screen. */

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M6 3h12v4H6zM4 8h16a2 2 0 0 1 2 2v6h-4v5H6v-5H2v-6a2 2 0 0 1 2-2zm4 8h8v4H8z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 4v14h10V5H7zm5 15.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M18.2 2H21l-6.5 7.4L22 22h-6.2l-4.8-6.3L5.4 22H2.6l7-8L2 2h6.3l4.4 5.8L18.2 2zm-1 18h1.6L7.9 3.7H6.2L17.2 20z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.75-1.95C20.5 8.75 21 11 21 14.1V21h-4v-6.1c0-1.5-.03-3.4-2.1-3.4-2.1 0-2.4 1.6-2.4 3.3V21H9z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M10 2a8 8 0 1 1-4.9 14.3l-3.4 3.4-1.4-1.4 3.4-3.4A8 8 0 0 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" />
    </svg>
  );
}
