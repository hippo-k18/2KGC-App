/**
 * Font Awesome's `linkedin` glyph, the same one the live site inlines.
 *
 * It was inlined twice — once in `/team` and once in `/learn` — as byte-for-byte
 * the same 300-character path, which is two places to fix a glyph nobody would
 * think to look for twice. The `/learn` copy also had the more capable
 * signature: it renders as a plain span when there is no `href`, because that
 * page's continuing-education roster lists people whose profiles the live site
 * does not link, and an anchor to nowhere is worse than an icon that is
 * evidently not a link.
 *
 * `aria-hidden` on the glyph with the label on the anchor: the accessible name
 * is "LinkedIn profile", read once, rather than the SVG announcing itself
 * separately.
 */
export function LinkedIn({ href, size = 20 }: { href?: string; size?: number }) {
  const svg = (
    <svg width={size} height={size} viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
      <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
    </svg>
  );
  if (!href) return <span className="li-icon">{svg}</span>;
  return (
    <a className="li-icon" href={href} target="_blank" rel="noreferrer" aria-label="LinkedIn profile">
      {svg}
    </a>
  );
}
