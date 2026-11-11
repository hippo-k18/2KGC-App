'use client';

import { useEffect, useState } from 'react';

/** Lowercase and without accents. The cards' `data-search` is folded the same way. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Filters the server-rendered grid in place by name, company or job title.
 *
 * It sets `hidden` on the cards that do not match rather than rendering its own
 * list, so the page is complete without scripts and a hidden card leaves the
 * accessibility tree and the browser's find-in-page with it.
 */
export function PastSpeakerSearch({ total }: { total: number }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(total);

  useEffect(() => {
    const grid = document.getElementById('ps-grid');
    if (!grid) return;
    const needle = fold(query.trim());
    let count = 0;
    for (const card of grid.children as HTMLCollectionOf<HTMLElement>) {
      const match = !needle || (card.dataset.search ?? '').includes(needle);
      card.hidden = !match;
      if (match) count++;
    }
    setShown(count);
    const none = document.getElementById('ps-none');
    if (none) none.hidden = count > 0;
  }, [query]);

  const searching = query.trim().length > 0;

  return (
    <div className="ps-search">
      <label htmlFor="ps-search-input" className="sr-only">
        Search by name or company
      </label>
      <input
        id="ps-search-input"
        type="search"
        value={query}
        placeholder="Search by name or company"
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      {/* Stays mounted and empties, so a screen reader announces each change. */}
      <p className="ps-count" role="status" aria-live="polite">
        {searching ? `${shown} of ${total}` : ''}
      </p>
    </div>
  );
}
