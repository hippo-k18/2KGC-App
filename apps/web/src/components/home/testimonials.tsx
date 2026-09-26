'use client';

import { useState } from 'react';

/**
 * "The Knowledge Graph Conference in Your Words".
 *
 * One quotation at a time, with its portrait, and arrows and dots to move
 * between them, as on the live site. Nothing advances by itself, so nothing
 * moves under somebody mid-sentence.
 *
 * The quotes are text transcribed from the live site's slides, which are
 * pictures of quotations. The portraits are cut from those same slides and sit
 * beside them as `<prefix>-face.png`.
 */
export interface Testimonial {
  file: string;
  quote: string;
  /** "Name, Job Title, Employer" — as printed on the original slide. */
  who: string;
}

/** The portrait cut from the slide: the first eight characters of its file name. */
const faceOf = (file: string) => `/kgc/testimonials/${file.slice(0, 8)}-face.png`;

export function Testimonials({ heading, items }: { heading: string; items: Testimonial[] }) {
  const [at, setAt] = useState(0);
  const go = (i: number) => setAt((i + items.length) % items.length);

  return (
    <section className="kgc-quotes" aria-label="What attendees say" aria-roledescription="carousel">
      <h2 className="kgc-quotes-heading">{heading}</h2>

      <div className="quote-carousel">
        <button type="button" className="quote-arrow" onClick={() => go(at - 1)} aria-label="Previous quote">
          <Chevron dir="left" />
        </button>

        <div className="quote-viewport">
          <ul className="quote-track" style={{ transform: `translateX(-${at * 100}%)` }}>
            {items.map((t, i) => {
              // "Name, Job title, Employer", as printed on the original slide.
              const [name, ...rest] = t.who.split(',').map((x) => x.trim());
              const employer = rest.length > 1 ? rest[rest.length - 1] : undefined;
              const title = rest.length > 1 ? rest.slice(0, -1).join(', ') : rest[0];
              return (
                <li
                  key={t.file}
                  className="quote-slide"
                  aria-hidden={i !== at}
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${items.length}`}
                >
                  <figure>
                    <blockquote>
                      <span className="quote-open" aria-hidden="true">
                        &ldquo;
                      </span>
                      {t.quote}
                      <span className="quote-close" aria-hidden="true">
                        &rdquo;
                      </span>
                    </blockquote>
                    <figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={faceOf(t.file)} alt="" width={120} height={120} />
                      <span>
                        <strong>{name}</strong>
                        {employer && <b>{employer}</b>}
                        {title && <span>{title}</span>}
                      </span>
                    </figcaption>
                  </figure>
                </li>
              );
            })}
          </ul>
        </div>

        <button type="button" className="quote-arrow" onClick={() => go(at + 1)} aria-label="Next quote">
          <Chevron dir="right" />
        </button>
      </div>

      <div className="quote-dots">
        {items.map((t, i) => (
          <button
            key={t.file}
            type="button"
            aria-label={`Quote ${i + 1}`}
            aria-current={i === at ? 'true' : undefined}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </section>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
