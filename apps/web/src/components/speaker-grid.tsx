'use client';

import { useState } from 'react';

export interface SpeakerTile {
  id: string;
  name: string;
  /** Where they work. Rendered on its own line, as the live page does. */
  company?: string;
  /** Their job title. Its own line under the company. */
  role?: string;
  photoURL?: string;
  /** Intrinsic size of a local portrait, so the box is reserved before it loads. */
  width?: number;
  height?: number;
}

/** Initials for the fallback portrait. Two at most, so the circle stays legible. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The speaker grid, framed the way the live `2026-speakers` page frames it: a
 * large circular portrait centred over a centred name, company and role, on a
 * pale card with no border.
 *
 * ## Why there is a "show more" rather than all of them
 *
 * Forty-five cards is about four thousand pixels of scrolling before anything
 * else on the page exists, and the live page solves it the same way. The first
 * batch is a screen and a half; the rest arrive on request.
 *
 * The hidden speakers are **not rendered and then hidden** — they are absent
 * from the DOM until asked for. Hiding them with CSS would keep them in the
 * accessibility tree and in the browser's in-page search, so a keyboard user
 * would tab into cards nobody can see. `aria-expanded` on the button and a live
 * count in its label are what make the state legible without sight.
 */
export function SpeakerGrid({
  speakers,
  initial = 12,
}: {
  speakers: SpeakerTile[];
  initial?: number;
}) {
  const [shown, setShown] = useState(initial);
  const visible = speakers.slice(0, shown);
  const remaining = speakers.length - visible.length;

  return (
    <>
      <div className="speaker-grid">
        {visible.map((s) => (
          <article className="speaker-tile" key={s.id}>
            {s.photoURL ? (
              /*
               * A plain <img>: portraits come from the conference database and,
               * for the imported set, from arbitrary upstream hosts. `next/image`
               * would need every one of those hosts in `images.remotePatterns`,
               * and a speaker added in the console with a new host would render a
               * 400 instead of a face.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="speaker-portrait"
                src={s.photoURL}
                alt=""
                width={s.width ?? 200}
                height={s.height ?? 200}
                loading="lazy"
              />
            ) : (
              <div className="speaker-portrait is-fallback" aria-hidden="true">
                {initials(s.name)}
              </div>
            )}
            <h3 className="speaker-name">{s.name}</h3>
            {s.company ? <p className="speaker-org">{s.company}</p> : null}
            {s.role ? <p className="speaker-role">{s.role}</p> : null}
          </article>
        ))}
      </div>

      {remaining > 0 ? (
        <div className="speaker-more">
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={false}
            onClick={() => setShown((n) => n + initial)}
          >
            Show {Math.min(remaining, initial)} more
            <span className="sr-only"> speakers, {remaining} remaining</span>
          </button>
        </div>
      ) : speakers.length > initial ? (
        <div className="speaker-more">
          <button
            type="button"
            className="btn btn-ghost-quiet"
            aria-expanded
            onClick={() => setShown(initial)}
          >
            Show fewer
          </button>
        </div>
      ) : null}
    </>
  );
}
