/** Toolbar icons: 24px stroke paths, drawn at 16px. */

const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  alignLeft: 'M15 12H3M17 18H3M21 6H3',
  alignCenter: 'M17 12H7M19 18H5M21 6H3',
  alignRight: 'M21 12H9M21 18H7M21 6H3',
  alignJustify: 'M3 12h18M3 18h18M3 6h18',
  bulletList: 'M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13',
  orderedList: 'M10 12h11M10 18h11M10 6h11M4 10h2M4 6h1v4M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  indent: 'M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4',
  outdent: 'M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4',
  quote: 'M6 17c-1.5 0-3-1.2-3-3.5C3 10 5 7.5 8 6.5M15 17c-1.5 0-3-1.2-3-3.5 0-3.5 2-6 5-7M6 11h3v6H6zM15 11h3v6h-3z',
  rule: 'M3 12h18M7 7h10M7 17h10',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  unlink: 'M18.84 12.25l1.72-1.71a4.86 4.86 0 0 0-6.88-6.88l-1.71 1.72M5.17 11.75l-1.71 1.71a4.86 4.86 0 0 0 6.88 6.88l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  smile: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  search: 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM21 21l-4.3-4.3',
  help: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  clear: 'M4 7V4h16v3M5 20h6M13 4 8 20M15 15l5 5M20 15l-5 5',
  paste: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8zM8 12h8M8 16h5',
  highlight: 'm9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
  chevron: 'm6 9 6 6 6-6',
  close: 'M18 6 6 18M6 6l12 12',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
