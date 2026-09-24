'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
export function AgendaSearch({
  initialQuery,
  day,
  track,
}: {
  initialQuery: string;
  day?: string;
  track?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  // The first render must not navigate: it would replace the entry the visitor
  // just arrived on, and on a shared link it would strip the query they came for.
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    }, 250);
    return () => clearTimeout(id);
  }, [value, params, pathname, router]);

  return (
    <form
      className="agenda-search"
      role="search"
      action="/agenda"
      method="get"
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
      {day ? <input type="hidden" name="day" value={day} /> : null}
      {track ? <input type="hidden" name="track" value={track} /> : null}
      <button type="submit" className="btn btn-primary" aria-live="polite">
        {pending ? 'Searching' : 'Search'}
      </button>
    </form>
  );
}
