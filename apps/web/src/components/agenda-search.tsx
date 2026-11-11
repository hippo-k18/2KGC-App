'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The programme search box.
 *
 * It was a plain GET form, so typing did nothing until you pressed Enter or the
 * button. People type and wait, decide the box is broken, and leave — which is
 * what happened here. It now filters as you type.
 *
 * ## Why the URL still changes
 *
 * The filtering itself is done on the server, by the same `q` the form used, so
 * a search can still be linked to, bookmarked, and read by a crawler. This
 * component only drives the address; the results are rendered exactly as they
 * were before. That also means the day and track chips keep working, because
 * they are links carrying the same `q` along.
 *
 * `replace` rather than `push`, so eight keystrokes do not leave eight entries
 * in the back button.
 *
 * ## Why it waits
 *
 * 250ms after the last keystroke. Short enough that it feels immediate, long
 * enough that typing a whole word is one request rather than five.
 *
 * The form still submits on Enter and the button still works, for anyone whose
 * JavaScript never arrives: this is an enhancement over the old form, not a
 * replacement for it.
 */
export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Search, day and track on one line.
 *
 * The day and track pickers are dropdowns that change the address the moment
 * one is picked, so they filter on the server exactly as the old rows of chips
 * did and a filtered agenda is still a link someone can share.
 */
export function AgendaSearch({
  initialQuery,
  day,
  track,
  days,
  tracks,
}: {
  initialQuery: string;
  day?: string;
  track?: string;
  days: FilterOption[];
  tracks: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  // The first render must not navigate: it would replace the entry the visitor
  // just arrived on, and on a shared link it would strip the query they came for.
  const typed = useRef(false);

  const go = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (!typed.current) return;
    const id = setTimeout(() => go({ q: value.trim() }), 250);
    return () => clearTimeout(id);
  }, [value, go]);

  return (
    <form
      className="agenda-search"
      role="search"
      action="/agenda"
      method="get"
      aria-busy={pending}
      onSubmit={(e) => {
        // The typing has already navigated. Submitting again would only reload
        // the same address and scroll the page back to the top.
        e.preventDefault();
      }}
    >
      <label className="sr-only" htmlFor="agenda-search">
        Search the programme
      </label>
      <input
        id="agenda-search"
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          typed.current = true;
          setValue(e.target.value);
        }}
        placeholder="Search sessions, speakers and rooms"
        autoComplete="off"
      />

      <label className="sr-only" htmlFor="agenda-day">
        Day
      </label>
      <select
        id="agenda-day"
        name="day"
        value={day ?? ''}
        onChange={(e) => go({ day: e.target.value })}
      >
        <option value="">All days</option>
        {days.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      {tracks.length > 0 && (
        <>
          <label className="sr-only" htmlFor="agenda-track">
            Track
          </label>
          <select
            id="agenda-track"
            name="track"
            value={track ?? ''}
            onChange={(e) => go({ track: e.target.value })}
          >
            <option value="">All tracks</option>
            {tracks.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </>
      )}

      {/* Without script the dropdowns cannot navigate by themselves. */}
      <noscript>
        <button type="submit" className="btn btn-primary">
          Filter
        </button>
      </noscript>
    </form>
  );
}
