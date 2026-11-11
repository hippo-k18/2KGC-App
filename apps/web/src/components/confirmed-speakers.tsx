'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SpeakerTalk } from '../lib/confirmed-speakers';
import { formatDayHeading, localTime } from '../lib/site';
import { filterSpeakers, initials, type SpeakerTile } from './speaker-grid';

/** A card on `/speakers`: the tile the page always had, plus a bio and talks. */
export interface ConfirmedSpeakerTile extends SpeakerTile {
  bio?: string;
  featured?: boolean;
  talks: SpeakerTalk[];
}

/** Above this many speakers the page offers a search box. */
const SEARCH_FROM = 12;

/** Paragraphs as the agenda's session page splits them: on a blank line. */
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Text cut to a few lines, with "Read more" opening it where it stands.
 *
 * All of it is in the server-rendered HTML; only the height is clamped. That
 * keeps every bio and abstract indexable, and the button only appears once
 * the browser has measured that something is actually hidden, so a two-line
 * bio does not offer to show more of itself.
 */
function Clamp({ text, className, label }: { text: string; className: string; label: string }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);

  return (
    <div className={className}>
      <div id={id} ref={ref} className={open ? 'clamp is-open' : 'clamp'}>
        {paragraphs(text).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {overflows || open ? (
        <button
          type="button"
          className="clamp-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Read more'}
          <span className="sr-only"> {label}</span>
        </button>
      ) : null}
    </div>
  );
}

/** "Keynote · Wednesday 5 May, 09:00", leaving out whatever is not set. */
function talkMeta(t: SpeakerTalk): string {
  const format = t.format ? t.format[0].toUpperCase() + t.format.slice(1) : '';
  const when =
    t.day && t.startsAtLocal
      ? `${formatDayHeading(t.day)}, ${localTime(t.startsAtLocal)}`
      : '';
  return [format, when].filter(Boolean).join(' · ');
}

function SpeakerProfile({ speaker: s, eager }: { speaker: ConfirmedSpeakerTile; eager: boolean }) {
  return (
    <article className="speaker-tile speaker-profile" id={`speaker-${s.id}`}>
      {s.photoURL ? (
        // A plain <img> for the reason `SpeakerCard` gives: portraits come from any host.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="speaker-portrait"
          src={s.photoURL}
          alt=""
          width={s.width ?? 200}
          height={s.height ?? 200}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
        />
      ) : (
        <div className="speaker-portrait is-fallback" aria-hidden="true">
          {initials(s.name)}
        </div>
      )}
      <h2 className="speaker-name">{s.name}</h2>
      {s.company ? <p className="speaker-org">{s.company}</p> : null}
      {s.role ? <p className="speaker-role">{s.role}</p> : null}

      {s.bio?.trim() ? (
        <Clamp text={s.bio} className="speaker-bio" label={`about ${s.name}`} />
      ) : null}

      <ul className="speaker-talks">
        {s.talks.map((t) => {
          const meta = talkMeta(t);
          return (
            <li key={t.id} className="speaker-talk">
              <Link className="speaker-talk-title" href={`/agenda/${t.id}`}>
                {t.title}
              </Link>
              {meta ? <p className="speaker-talk-meta">{meta}</p> : null}
              {t.description?.trim() ? (
                <Clamp
                  text={t.description}
                  className="speaker-talk-desc"
                  label={`about ${t.title}`}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/**
 * The `/speakers` body when it reads the database (T304): every confirmed
 * speaker, featured first, each with a bio and the talks they give.
 *
 * Everybody is rendered on the server, not revealed by a button, so every
 * name, bio and abstract is in the HTML a search engine reads. The list is
 * the announced speakers, which grows a few at a time, not the 137-person
 * imported roster `ViewAllSpeakers` was built to page through.
 */
export function ConfirmedSpeakers({
  speakers,
  applyHref,
}: {
  speakers: ConfirmedSpeakerTile[];
  /** Where "call for speakers" in the empty state leads. */
  applyHref: string;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterSpeakers(speakers, query), [speakers, query]);

  if (!speakers.length) {
    return (
      <>
        <h1 className="speakers-head">Speakers</h1>
        <p className="speakers-empty">
          Speakers will be announced soon.{' '}
          <Link href={applyHref}>See the call for speakers</Link>.
        </p>
      </>
    );
  }

  const searching = query.trim().length > 0;

  return (
    <>
      <h1 className="speakers-head">Our First Speakers</h1>

      {speakers.length > SEARCH_FROM ? (
        <>
          <div className="speaker-toolbar">
            <div className="speaker-tool">
              <label htmlFor="speaker-search">Search</label>
              <input
                id="speaker-search"
                type="search"
                value={query}
                placeholder="Name or company"
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <p className="speaker-count" role="status" aria-live="polite">
            {searching
              ? `${visible.length} of ${speakers.length} ${visible.length === 1 ? 'speaker matches' : 'speakers match'} “${query.trim()}”`
              : ''}
          </p>
        </>
      ) : null}

      {visible.length ? (
        <div className="speaker-list">
          {visible.map((s, i) => (
            <SpeakerProfile key={s.id} speaker={s} eager={i < 3} />
          ))}
        </div>
      ) : (
        <p className="notice">
          No speaker matches “{query.trim()}”.{' '}
          <button type="button" className="speaker-clear" onClick={() => setQuery('')}>
            Clear the search
          </button>
        </p>
      )}
    </>
  );
}
