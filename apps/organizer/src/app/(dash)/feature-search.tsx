'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The feature search in the dark header.
 *
 * Whova has one and it is the single most useful thing in their chrome: 215
 * screens is far too many to navigate by clicking, and an organizer who knows
 * they want "badges" should not have to remember that badges live under
 * Attendees. The first pass rendered this as a disabled box, which was the
 * wrong call — we already ship the entire nav tree to the client for the
 * sidebar, so the index costs nothing extra.
 *
 * Matching is a plain substring pass over the title and its ancestors' titles,
 * so "attendee badges" finds `Attendees › Name Badges` and "qa" finds
 * `Session Q&A Manager`. Built screens sort first, because a real screen is a
 * better answer than a placeholder when both match.
 */
export interface SearchEntry {
  title: string;
  path: string;
  trail: string;
  built: boolean;
}

export function FeatureSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const words = needle.split(/\s+/);
    return entries
      .filter((e) => {
        const hay = `${e.trail} ${e.title}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort(
        (a, b) =>
          Number(b.built) - Number(a.built) ||
          Number(a.title.toLowerCase().startsWith(needle)) * -1 -
            Number(b.title.toLowerCase().startsWith(needle)) * -1 ||
          a.title.length - b.title.length,
      )
      .slice(0, 8);
  }, [q, entries]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        className="header-search"
        placeholder="Search features"
        aria-label="Search features"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return setOpen(false);
          if (!hits.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % hits.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + hits.length) % hits.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            router.push(`/${hits[active].path}`);
            setOpen(false);
            setQ('');
          }
        }}
      />

      {open && hits.length > 0 ? (
        <div className="whova-menu" style={{ maxHeight: 420, minWidth: 340, overflowY: 'auto' }}>
          {hits.map((h, i) => (
            <Link
              key={h.path}
              className="whova-menu-item"
              href={`/${h.path}`}
              style={{
                background: i === active ? '#e9ecf1' : undefined,
                height: 'auto',
                padding: '8px 12px',
              }}
              onClick={() => {
                setOpen(false);
                setQ('');
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block' }}>{h.title}</span>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: 12 }}>
                  {h.trail}
                </span>
              </span>
              {h.built ? (
                <span className="whova-tag-main green-tag outline-tag small">built</span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}

      {open && q.trim().length >= 2 && hits.length === 0 ? (
        <div className="whova-menu" style={{ minWidth: 260 }}>
          <div className="whova-menu-item" style={{ color: 'var(--muted)' }}>
            No feature matches “{q.trim()}”.
          </div>
        </div>
      ) : null}
    </div>
  );
}
