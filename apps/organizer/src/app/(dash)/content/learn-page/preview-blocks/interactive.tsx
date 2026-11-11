'use client';

import Image from 'next/image';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { countdownParts } from '@kgc/shared';

/*
 * The only Learn page blocks that run script in the browser (T319): tabs, the
 * gallery's carousel and lightbox, and the countdown. Each renders complete,
 * readable HTML on the server first; the script adds behaviour, not content.
 * Accordions need none: they are `<details>` elements.
 */

/* ── Tabs ─────────────────────────────────────────────────────────────── */

/**
 * WAI-ARIA tabs with automatic activation: arrow keys move between tabs and
 * show the panel, Home and End jump, and only the selected tab is in the tab
 * order. Panels are rendered on the server, so all of their text is in the
 * page for search engines and for anyone without script.
 */
export function LearnTabs({ titles, children }: { titles: string[]; children: ReactNode[] }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (i: number) => {
    const n = (i + titles.length) % titles.length;
    setActive(n);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => go(active + 1),
      ArrowLeft: () => go(active - 1),
      Home: () => go(0),
      End: () => go(titles.length - 1),
    };
    const f = keys[e.key];
    if (f) {
      e.preventDefault();
      f();
    }
  };

  return (
    <>
      <div className="lp-tablist" role="tablist">
        {titles.map((t, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-t${i}`}
            aria-selected={i === active}
            aria-controls={`${base}-p${i}`}
            tabIndex={i === active ? 0 : -1}
            className="lp-tab"
            onClick={() => setActive(i)}
            onKeyDown={onKey}
          >
            {t}
          </button>
        ))}
      </div>
      {children.map((panel, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${base}-p${i}`}
          aria-labelledby={`${base}-t${i}`}
          className="lp-tabpanel"
          hidden={i !== active}
          tabIndex={0}
        >
          {panel}
        </div>
      ))}
    </>
  );
}

/* ── Gallery ──────────────────────────────────────────────────────────── */

/** One gallery image, already resolved by the server (address, optimizer, priority). */
export interface GalleryImage {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  objectPosition?: string;
  unoptimized: boolean;
  priority: boolean;
}

/**
 * Grid, masonry or carousel, with an optional lightbox. The lightbox is a
 * modal `<dialog>`: focus moves into it and back to the picture that opened
 * it, Escape closes, the arrow keys step through, and clicking outside the
 * picture closes.
 */
export function LearnGallery({
  images,
  layout,
  columns,
  lightbox,
}: {
  images: GalleryImage[];
  layout: 'grid' | 'carousel' | 'masonry';
  columns: number;
  lightbox: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [edges, setEdges] = useState({ start: true, end: images.length <= 1 });

  const show = (i: number) => {
    setOpen(i);
    dialog.current?.showModal();
  };
  const step = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + images.length) % images.length)), [images.length]);

  const onDialogKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  };

  // The carousel's buttons are only useful when there is somewhere to go.
  useEffect(() => {
    const el = track.current;
    if (layout !== 'carousel' || !el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [layout]);

  const scrollBy = (d: number) => {
    const el = track.current;
    if (!el) return;
    const item = el.querySelector('li');
    el.scrollBy({ left: d * ((item?.getBoundingClientRect().width ?? el.clientWidth) + 16), behavior: 'smooth' });
  };

  const current = open === null ? undefined : images[open];

  return (
    <>
      <ul
        ref={track}
        className={`lp-gallery-list lp-gallery-${layout} lp-cols-${columns}`}
        aria-label={layout === 'carousel' ? 'Photos, scroll sideways for more' : undefined}
        tabIndex={layout === 'carousel' ? 0 : undefined}
      >
        {images.map((im, i) => {
          const pic = (
            <Image
              src={im.src}
              alt={im.alt}
              width={im.width}
              height={im.height}
              sizes={layout === 'carousel' ? '(width < 860px) 80vw, 33vw' : `(width < 860px) 50vw, ${Math.round(100 / columns)}vw`}
              unoptimized={im.unoptimized}
              priority={im.priority}
              style={im.objectPosition ? { objectPosition: im.objectPosition } : undefined}
            />
          );
          return (
            <li key={im.id}>
              <figure>
                {lightbox ? (
                  <button type="button" className="lp-gallery-open" onClick={() => show(i)} aria-label={`Open photo ${i + 1} of ${images.length}${im.alt ? `: ${im.alt}` : ''}`}>
                    {pic}
                  </button>
                ) : (
                  pic
                )}
                {im.caption && <figcaption>{im.caption}</figcaption>}
              </figure>
            </li>
          );
        })}
      </ul>

      {layout === 'carousel' && images.length > 1 && (
        <div className="lp-carousel-nav">
          <button type="button" className="lp-carousel-btn" onClick={() => scrollBy(-1)} disabled={edges.start} aria-label="Previous photos">
            <Chevron dir="left" />
          </button>
          <button type="button" className="lp-carousel-btn" onClick={() => scrollBy(1)} disabled={edges.end} aria-label="Next photos">
            <Chevron dir="right" />
          </button>
        </div>
      )}

      {lightbox && (
        <dialog
          ref={dialog}
          className="lp-lightbox"
          aria-label="Photo viewer"
          onKeyDown={onDialogKey}
          onClose={() => setOpen(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) dialog.current?.close();
          }}
        >
          {current && (
            <div className="lp-lightbox-body">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- full size, any host, shown on demand */}
                <img src={current.src} alt={current.alt} width={current.width} height={current.height} />
                <figcaption>
                  <span>{current.caption}</span>
                  <span className="lp-lightbox-count" aria-live="polite">
                    {open! + 1} of {images.length}
                  </span>
                </figcaption>
              </figure>
              {images.length > 1 && (
                <>
                  <button type="button" className="lp-lightbox-prev" onClick={() => step(-1)} aria-label="Previous photo">
                    <Chevron dir="left" />
                  </button>
                  <button type="button" className="lp-lightbox-next" onClick={() => step(1)} aria-label="Next photo">
                    <Chevron dir="right" />
                  </button>
                </>
              )}
              <button type="button" className="lp-lightbox-close" onClick={() => dialog.current?.close()} aria-label="Close" autoFocus>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
        </dialog>
      )}
    </>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Countdown ────────────────────────────────────────────────────────── */

/**
 * Drawn on the server from the server's clock (`now`), so the page reads
 * right before any script runs; the first client render uses the same `now`
 * so hydration matches, then it ticks once a second.
 */
export function LearnCountdown({ until, now, doneText }: { until: number; now: number; doneText?: string }) {
  const [t, setT] = useState(now);
  useEffect(() => {
    setT(Date.now());
    const id = window.setInterval(() => setT(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const p = countdownParts(until, t);
  if (p.done) return <p className="lp-countdown-done">{doneText || 'It has started.'}</p>;
  const units: [number, string][] = [
    [p.days, p.days === 1 ? 'day' : 'days'],
    [p.hours, p.hours === 1 ? 'hour' : 'hours'],
    [p.minutes, p.minutes === 1 ? 'minute' : 'minutes'],
    [p.seconds, p.seconds === 1 ? 'second' : 'seconds'],
  ];
  return (
    <ol className="lp-countdown-units">
      {units.map(([n, label]) => (
        <li key={label.replace(/s$/, '')}>
          <span className="lp-countdown-n">{String(n).padStart(2, '0')}</span>
          <span className="lp-countdown-l">{label}</span>
        </li>
      ))}
    </ol>
  );
}
