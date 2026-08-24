/**
 * The tab-strip and sidebar glyphs.
 *
 * Whova uses FontAwesome Pro and its bundle references each icon by minified
 * export name (`{icon: l.YBv}`), which does not resolve back to a glyph name
 * from the outside — so unlike every colour and dimension in `globals.css`,
 * these are the one part of the chrome that is a considered match rather than a
 * copy. They are 16px stroke-1.6 outlines at the same optical weight as
 * FontAwesome's light set, which is what Whova's tab strip reads as.
 *
 * Inline SVG rather than an icon font on purpose: nine glyphs do not justify a
 * webfont request, and a font that fails to load leaves nine empty boxes across
 * the top of the page.
 */
import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Keyed by the top-level `name` in `nav.ts` — Whova's own feature keys. */
export const TAB_ICONS: Record<string, ReactNode> = {
  content: (
    <Svg>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  ),
  virtual_hybrid: (
    <Svg>
      <rect x="2" y="5" width="14" height="10" rx="2" />
      <path d="M16 9l6-3v12l-6-3M6 19h6" />
    </Svg>
  ),
  engagement: (
    <Svg>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l2-4.4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
    </Svg>
  ),
  event_marketing: (
    <Svg>
      <path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" />
      <path d="M17 8.5a5 5 0 0 1 0 7" />
    </Svg>
  ),
  tickets: (
    <Svg>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
      <path d="M13 6v2M13 11v2M13 16v2" />
    </Svg>
  ),
  attendees: (
    <Svg>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 5.6M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </Svg>
  ),
  pay: (
    <Svg>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19M6 15h4" />
    </Svg>
  ),
  publish: (
    <Svg>
      <path d="M12 20V5M12 5l-5 5M12 5l5 5" />
      <path d="M4 20h16" />
    </Svg>
  ),
  tools: (
    <Svg>
      <path d="M14.5 6.5a4 4 0 0 0 5.2 5.2L21 13l-8 8-3-3 8-8 1.3 1.3" />
      <path d="M6.5 13.5l-3 3a2.1 2.1 0 0 0 3 3l3-3" />
    </Svg>
  ),
};

/** The sidebar's second-level bullet — an open circle, 9.75px in Whova. */
export function CircleIcon() {
  return (
    <span className="circle-icon" aria-hidden="true">
      <svg width="7" height="7" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

/** The sidebar's third-level bullet — a filled square. */
export function SquareIcon() {
  return (
    <span className="square-icon" aria-hidden="true">
      <svg width="6" height="6" viewBox="0 0 8 8">
        <rect x="1.5" y="1.5" width="5" height="5" fill="currentColor" />
      </svg>
    </span>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
